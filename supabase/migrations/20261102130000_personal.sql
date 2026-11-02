-- Ficha del personal (módulo Personal y Asistencia). La tabla asistencia_trabajador (creada por el huellero con
-- solo pin + nombre, migración 20261030120000) pasa a ser la ficha completa: public.personal.
-- pin = código del trabajador en los huelleros (por defecto su DNI); las marcaciones se enlazan por pin.
-- nombre = nombre tal como está en el huellero; nombres/apellidos = los del ERP (lo que se envía al huellero).
-- Régimen: construcción civil (categoría + jornal diario) o general (cargo + sueldo mensual).
-- Obligatorios solo en el formulario (documento, nombres, apellidos, régimen, pin): los registros que crea el
-- huellero llegan sin ellos y se completan después. Dar de baja = estado 'baja' (skill dar-de-baja-pattern).
-- Idempotente.

-- 1) Renombrar la tabla y sus columnas base ---------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.personal') IS NULL AND to_regclass('public.asistencia_trabajador') IS NOT NULL THEN
        ALTER TABLE public.asistencia_trabajador RENAME TO personal;
        ALTER TABLE public.personal RENAME COLUMN id_trabajador TO id_personal;
        ALTER TABLE public.personal RENAME COLUMN dni TO numero_documento;
        ALTER SEQUENCE public.asistencia_trabajador_id_trabajador_seq RENAME TO personal_id_personal_seq;
    END IF;
END $$;

-- 2) Campos de la ficha ------------------------------------------------------------------------------------------
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS tipo_documento varchar(3) NOT NULL DEFAULT 'DNI';
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS nombres varchar(100);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS apellidos varchar(100);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS fecha_nacimiento date;
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS sexo char(1);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS telefono varchar(20);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS direccion varchar(200);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS contacto_emergencia_nombre varchar(100);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS contacto_emergencia_telefono varchar(20);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS regimen varchar(20);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS categoria varchar(10);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS cargo varchar(100);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS jornal_diario numeric(10,2);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS sueldo_mensual numeric(10,2);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS id_centro_costo bigint REFERENCES public.centro_costo (id_centro_costo) ON DELETE SET NULL;
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS fecha_ingreso date;
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS fecha_cese date;
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS motivo_cese varchar(200);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS sistema_pension varchar(20);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS cuspp varchar(15);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS banco varchar(60);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS numero_cuenta varchar(30);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS cci varchar(25);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS sctr_poliza varchar(40);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS sctr_vencimiento date;
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS examen_medico_vencimiento date;
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.personal DROP CONSTRAINT IF EXISTS personal_tipo_documento_check;
ALTER TABLE public.personal ADD CONSTRAINT personal_tipo_documento_check CHECK (tipo_documento IN ('DNI', 'CE', 'PAS'));
ALTER TABLE public.personal DROP CONSTRAINT IF EXISTS personal_sexo_check;
ALTER TABLE public.personal ADD CONSTRAINT personal_sexo_check CHECK (sexo IS NULL OR sexo IN ('M', 'F'));
ALTER TABLE public.personal DROP CONSTRAINT IF EXISTS personal_regimen_check;
ALTER TABLE public.personal ADD CONSTRAINT personal_regimen_check CHECK (regimen IS NULL OR regimen IN ('construccion_civil', 'general'));
ALTER TABLE public.personal DROP CONSTRAINT IF EXISTS personal_categoria_check;
ALTER TABLE public.personal ADD CONSTRAINT personal_categoria_check CHECK (categoria IS NULL OR categoria IN ('operario', 'oficial', 'peon'));
ALTER TABLE public.personal DROP CONSTRAINT IF EXISTS personal_sistema_pension_check;
ALTER TABLE public.personal ADD CONSTRAINT personal_sistema_pension_check CHECK (sistema_pension IS NULL OR sistema_pension IN ('ONP', 'AFP Integra', 'AFP Prima', 'AFP Profuturo', 'AFP Habitat'));
ALTER TABLE public.personal DROP CONSTRAINT IF EXISTS personal_montos_check;
ALTER TABLE public.personal ADD CONSTRAINT personal_montos_check CHECK (COALESCE(jornal_diario, 0) >= 0 AND COALESCE(sueldo_mensual, 0) >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS uq_personal_documento ON public.personal (tipo_documento, numero_documento) WHERE numero_documento IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_personal_obra ON public.personal (id_centro_costo) WHERE estado = 'activo';

-- 3) RLS (se conserva la de asistencia_trabajador con nombre nuevo) ---------------------------------------------
DROP POLICY IF EXISTS asistencia_trabajador_autenticados ON public.personal;
DROP POLICY IF EXISTS personal_autenticados ON public.personal;
CREATE POLICY personal_autenticados ON public.personal TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.personal TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.personal_id_personal_seq TO authenticated;

-- 4) La ingesta del huellero ahora escribe en personal ------------------------------------------------------------
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

    INSERT INTO public.personal AS t (pin, nombre)
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
        INSERT INTO public.personal (pin)
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
