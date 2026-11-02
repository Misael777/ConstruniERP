-- Asistencia con huelleros ZKTeco (SenseFace 2A y similares) por ADMS, sin servidor propio:
-- el huellero envía cada marcación a un Worker de Cloudflare (servicios/huellero-adms/worker.js),
-- que llama a fn_asistencia_ingesta con un token. El token se guarda aquí solo como hash SHA-256
-- (asistencia_config.token_ingesta_sha256) y se carga a mano en cada entorno; esta migración no lo trae.
-- Un huellero se identifica por su número de serie; uno nuevo queda 'pendiente' hasta que se le
-- asigna una obra (centro de costo) en el ERP. El trabajador se identifica por su ID en el huellero (pin),
-- que debe ser el mismo en todos los huelleros. Idempotente.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 1) Huelleros -----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.asistencia_dispositivo (
    id_dispositivo   bigserial PRIMARY KEY,
    numero_serie     varchar(40) NOT NULL UNIQUE,
    nombre           varchar(100),
    id_centro_costo  bigint REFERENCES public.centro_costo (id_centro_costo) ON DELETE SET NULL,
    estado           varchar(10) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'activo', 'baja')),
    ultima_conexion  timestamptz,
    ultima_ip        varchar(45),
    info             varchar(300),
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- 2) Trabajadores (personal de obra; no son usuarios del ERP, pero pueden vincularse a uno) --------------------
CREATE TABLE IF NOT EXISTS public.asistencia_trabajador (
    id_trabajador  bigserial PRIMARY KEY,
    pin            varchar(20) NOT NULL UNIQUE,
    nombre         varchar(150),
    dni            varchar(15),
    id_empleado    integer REFERENCES public.empleados (id) ON DELETE SET NULL,
    estado         varchar(10) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'baja')),
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- 3) Marcaciones -------------------------------------------------------------------------------------------
-- estado_marca (del huellero): 0 entrada, 1 salida, 2 salida a descanso, 3 regreso de descanso,
-- 4 entrada horas extra, 5 salida horas extra. modo_verificacion: 1 huella, 15 rostro, 0/3 clave, 4 tarjeta.
-- evento: solo en huelleros en modo control de acceso (protocolo PUSH 3.x, rtlog/transaction); código de
-- evento de ZKTeco (0 = verificación normal); NULL en los de asistencia (ATTLOG).
-- id_centro_costo es la obra del huellero al momento de recibir la marca (si luego se mueve, no cambia).
CREATE TABLE IF NOT EXISTS public.asistencia_marcacion (
    id_marcacion       bigserial PRIMARY KEY,
    id_dispositivo     bigint NOT NULL REFERENCES public.asistencia_dispositivo (id_dispositivo) ON DELETE CASCADE,
    pin                varchar(20) NOT NULL,
    marcado_en         timestamptz NOT NULL,
    estado_marca       smallint,
    modo_verificacion  smallint,
    evento             smallint,
    id_centro_costo    bigint REFERENCES public.centro_costo (id_centro_costo) ON DELETE SET NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id_dispositivo, pin, marcado_en)
);
ALTER TABLE public.asistencia_marcacion ADD COLUMN IF NOT EXISTS evento smallint;
CREATE INDEX IF NOT EXISTS idx_asistencia_marcacion_obra_fecha ON public.asistencia_marcacion (id_centro_costo, marcado_en);
CREATE INDEX IF NOT EXISTS idx_asistencia_marcacion_pin_fecha ON public.asistencia_marcacion (pin, marcado_en);

-- 3b) Tráfico crudo de los huelleros (diagnóstico de formatos por modelo/firmware; se conserva 15 días) -------
CREATE TABLE IF NOT EXISTS public.asistencia_trafico (
    id_trafico    bigserial PRIMARY KEY,
    numero_serie  varchar(40) NOT NULL,
    metodo        varchar(8),
    ruta          varchar(100),
    consulta      varchar(500),
    cuerpo        text,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asistencia_trafico_fecha ON public.asistencia_trafico (created_at);

-- 4) Configuración privada (solo la leen las funciones SECURITY DEFINER) -------------------------------------
CREATE TABLE IF NOT EXISTS public.asistencia_config (
    clave  varchar(40) PRIMARY KEY,
    valor  text NOT NULL
);

ALTER TABLE public.asistencia_dispositivo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asistencia_trabajador ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asistencia_marcacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asistencia_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asistencia_trafico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asistencia_dispositivo_autenticados ON public.asistencia_dispositivo;
CREATE POLICY asistencia_dispositivo_autenticados ON public.asistencia_dispositivo TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS asistencia_trabajador_autenticados ON public.asistencia_trabajador;
CREATE POLICY asistencia_trabajador_autenticados ON public.asistencia_trabajador TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS asistencia_marcacion_autenticados ON public.asistencia_marcacion;
CREATE POLICY asistencia_marcacion_autenticados ON public.asistencia_marcacion TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS asistencia_trafico_lectura ON public.asistencia_trafico;
CREATE POLICY asistencia_trafico_lectura ON public.asistencia_trafico FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.asistencia_trafico TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asistencia_dispositivo, public.asistencia_trabajador, public.asistencia_marcacion TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.asistencia_dispositivo_id_dispositivo_seq,
    public.asistencia_trabajador_id_trabajador_seq, public.asistencia_marcacion_id_marcacion_seq TO authenticated;
REVOKE ALL ON public.asistencia_config FROM anon, authenticated;

-- 5) Ingesta desde el Worker ---------------------------------------------------------------------------------
-- p_marcaciones: [{pin, fecha_hora 'YYYY-MM-DD HH:MM:SS' (hora de Lima del huellero), estado, verificacion, evento}]
-- p_usuarios: [{pin, nombre}] (el nombre del huellero solo se usa si en el ERP aún no tiene uno).
-- p_crudo: {metodo, ruta, consulta, cuerpo} de la petición, para asistencia_trafico.
-- Registra el latido del huellero aunque no traiga datos. Las marcas repetidas y las de pin 0 (persona no
-- registrada) se ignoran.
DROP FUNCTION IF EXISTS public.fn_asistencia_ingesta(text, text, text, text, jsonb, jsonb);
CREATE OR REPLACE FUNCTION public.fn_asistencia_ingesta(
    p_token text,
    p_sn text,
    p_ip text DEFAULT NULL,
    p_info text DEFAULT NULL,
    p_marcaciones jsonb DEFAULT '[]'::jsonb,
    p_usuarios jsonb DEFAULT '[]'::jsonb,
    p_crudo jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_hash text;
    v_disp public.asistencia_dispositivo%ROWTYPE;
    v_insertadas integer := 0;
BEGIN
    SELECT valor INTO v_hash FROM public.asistencia_config WHERE clave = 'token_ingesta_sha256';
    IF v_hash IS NULL OR p_token IS NULL OR encode(digest(p_token, 'sha256'), 'hex') <> v_hash THEN
        RAISE EXCEPTION 'Token de ingesta inválido' USING ERRCODE = '28000';
    END IF;
    IF p_sn IS NULL OR p_sn !~ '^[A-Za-z0-9_-]{1,40}$' THEN
        RAISE EXCEPTION 'Número de serie inválido' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.asistencia_dispositivo (numero_serie, ultima_conexion, ultima_ip, info)
    VALUES (p_sn, now(), left(p_ip, 45), left(p_info, 300))
    ON CONFLICT (numero_serie) DO UPDATE
        SET ultima_conexion = now(),
            ultima_ip = COALESCE(left(EXCLUDED.ultima_ip, 45), asistencia_dispositivo.ultima_ip),
            info = COALESCE(EXCLUDED.info, asistencia_dispositivo.info)
    RETURNING * INTO v_disp;

    IF p_crudo IS NOT NULL THEN
        INSERT INTO public.asistencia_trafico (numero_serie, metodo, ruta, consulta, cuerpo)
        VALUES (p_sn, left(p_crudo->>'metodo', 8), left(p_crudo->>'ruta', 100), left(p_crudo->>'consulta', 500),
                left(p_crudo->>'cuerpo', 20000));
        DELETE FROM public.asistencia_trafico WHERE created_at < now() - interval '15 days';
    END IF;

    IF v_disp.estado = 'baja' THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'dispositivo dado de baja');
    END IF;

    INSERT INTO public.asistencia_trabajador AS t (pin, nombre)
    SELECT left(u->>'pin', 20), NULLIF(left(btrim(u->>'nombre'), 150), '')
    FROM jsonb_array_elements(COALESCE(p_usuarios, '[]'::jsonb)) u
    WHERE COALESCE(u->>'pin', '') <> ''
    ON CONFLICT (pin) DO UPDATE
        SET nombre = EXCLUDED.nombre
        WHERE (t.nombre IS NULL OR t.nombre = '') AND EXCLUDED.nombre IS NOT NULL;

    WITH m AS (
        SELECT left(x->>'pin', 20) AS pin,
               (x->>'fecha_hora')::timestamp AT TIME ZONE 'America/Lima' AS marcado_en,
               NULLIF(x->>'estado', '')::smallint AS estado_marca,
               NULLIF(x->>'verificacion', '')::smallint AS modo_verificacion,
               NULLIF(x->>'evento', '')::smallint AS evento
        FROM jsonb_array_elements(COALESCE(p_marcaciones, '[]'::jsonb)) x
        WHERE COALESCE(x->>'pin', '') NOT IN ('', '0')
          AND x->>'fecha_hora' ~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$'
          AND COALESCE(x->>'estado', '') ~ '^\d{0,4}$'
          AND COALESCE(x->>'verificacion', '') ~ '^\d{0,4}$'
          AND COALESCE(x->>'evento', '') ~ '^\d{0,4}$'
    ), nuevas AS (
        INSERT INTO public.asistencia_marcacion (id_dispositivo, pin, marcado_en, estado_marca, modo_verificacion, evento, id_centro_costo)
        SELECT v_disp.id_dispositivo, m.pin, m.marcado_en, m.estado_marca, m.modo_verificacion, m.evento, v_disp.id_centro_costo
        FROM m
        ON CONFLICT (id_dispositivo, pin, marcado_en) DO NOTHING
        RETURNING pin
    ), trab AS (
        INSERT INTO public.asistencia_trabajador (pin)
        SELECT DISTINCT pin FROM nuevas
        ON CONFLICT (pin) DO NOTHING
    )
    SELECT count(*) INTO v_insertadas FROM nuevas;

    RETURN jsonb_build_object('ok', true, 'insertadas', v_insertadas, 'estado', v_disp.estado);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_asistencia_ingesta(text, text, text, text, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_asistencia_ingesta(text, text, text, text, jsonb, jsonb, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
