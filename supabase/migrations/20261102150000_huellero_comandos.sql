-- Envío de trabajadores del ERP a los huelleros (protocolo PUSH 3.x de ZKTeco).
-- Los cambios en `personal` encolan órdenes en asistencia_comando para los huelleros activos de la obra del
-- trabajador; el Worker (servicios/huellero-adms) las entrega en /iclock/getrequest y recibe el resultado en
-- /iclock/devicecmd. El huellero solo recibe código + nombre: la huella o el rostro se registran en el equipo.
--   alta/cambio  → DATA UPDATE user + DATA UPDATE userauthorize (permiso de marcar)
--   baja, cambio de obra o de código → DATA DELETE user en los huelleros donde ya no debe estar
-- "Sincronizar" (fn_asistencia_sincronizar) pide al huellero todos sus usuarios (DATA QUERY) y le reenvía el
-- personal activo de su obra. Idempotente.

CREATE TABLE IF NOT EXISTS public.asistencia_comando (
    id_comando     bigserial PRIMARY KEY,
    id_dispositivo bigint NOT NULL REFERENCES public.asistencia_dispositivo (id_dispositivo) ON DELETE CASCADE,
    pin            varchar(20),
    descripcion    varchar(150) NOT NULL,
    comando        text NOT NULL,
    estado         varchar(10) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviado', 'ok', 'error')),
    resultado      varchar(200),
    created_at     timestamptz NOT NULL DEFAULT now(),
    enviado_at     timestamptz,
    respondido_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_asistencia_comando_pendientes ON public.asistencia_comando (id_dispositivo, id_comando) WHERE estado IN ('pendiente', 'enviado');
CREATE INDEX IF NOT EXISTS idx_asistencia_comando_pin ON public.asistencia_comando (pin, created_at);

ALTER TABLE public.asistencia_comando ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asistencia_comando_lectura ON public.asistencia_comando;
CREATE POLICY asistencia_comando_lectura ON public.asistencia_comando FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.asistencia_comando TO authenticated;

-- Token del Worker (mismo hash que fn_asistencia_ingesta). Solo para uso interno de las funciones.
CREATE OR REPLACE FUNCTION public.fn_asistencia_validar_token(p_token text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_hash text;
BEGIN
    SELECT valor INTO v_hash FROM public.asistencia_config WHERE clave = 'token_ingesta_sha256';
    IF v_hash IS NULL OR p_token IS NULL OR encode(digest(p_token, 'sha256'), 'hex') <> v_hash THEN
        RAISE EXCEPTION 'Token de ingesta inválido' USING ERRCODE = '28000';
    END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_asistencia_validar_token(text) FROM PUBLIC, anon, authenticated;

-- Órdenes para un trabajador en un huellero -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_asistencia_encolar_alta(p_id_dispositivo bigint, p_pin text, p_nombre text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    -- El huellero guarda hasta 24 caracteres de nombre; tabuladores y saltos de línea romperían el protocolo.
    v_nombre text := left(regexp_replace(COALESCE(NULLIF(btrim(p_nombre), ''), p_pin), '[\t\r\n]+', ' ', 'g'), 24);
BEGIN
    INSERT INTO public.asistencia_comando (id_dispositivo, pin, descripcion, comando) VALUES
        (p_id_dispositivo, p_pin, 'Registrar o actualizar ' || v_nombre,
         'DATA UPDATE user CardNo=' || E'\t' || 'Pin=' || p_pin || E'\t' || 'Group=0' || E'\t' || 'StartTime=0' || E'\t' || 'EndTime=0' || E'\t' || 'Name=' || v_nombre),
        (p_id_dispositivo, p_pin, 'Permitir marcar a ' || v_nombre,
         'DATA UPDATE userauthorize Pin=' || p_pin || E'\t' || 'AuthorizeTimezoneId=1' || E'\t' || 'AuthorizeDoorId=1' || E'\t' || 'DevID=1');
END $$;

CREATE OR REPLACE FUNCTION public.fn_asistencia_encolar_retiro(p_id_dispositivo bigint, p_pin text, p_nombre text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO public.asistencia_comando (id_dispositivo, pin, descripcion, comando)
    VALUES (p_id_dispositivo, p_pin,
            'Retirar a ' || left(regexp_replace(COALESCE(NULLIF(btrim(p_nombre), ''), p_pin), '[\t\r\n]+', ' ', 'g'), 24),
            'DATA DELETE user Pin=' || p_pin);
END $$;
REVOKE ALL ON FUNCTION public.fn_asistencia_encolar_alta(bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_asistencia_encolar_retiro(bigint, text, text) FROM PUBLIC, anon, authenticated;

-- Cambios en personal → órdenes ---------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_personal_a_huelleros() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_antes bigint[] := '{}';
    v_ahora bigint[] := '{}';
    v_disp bigint;
BEGIN
    IF TG_OP <> 'INSERT' AND OLD.estado = 'activo' AND OLD.id_centro_costo IS NOT NULL THEN
        SELECT COALESCE(array_agg(id_dispositivo), '{}') INTO v_antes FROM public.asistencia_dispositivo
        WHERE id_centro_costo = OLD.id_centro_costo AND estado = 'activo';
    END IF;
    IF TG_OP <> 'DELETE' AND NEW.estado = 'activo' AND NEW.id_centro_costo IS NOT NULL THEN
        SELECT COALESCE(array_agg(id_dispositivo), '{}') INTO v_ahora FROM public.asistencia_dispositivo
        WHERE id_centro_costo = NEW.id_centro_costo AND estado = 'activo';
    END IF;

    -- Retirar donde ya no corresponde (o con el código antiguo si cambió).
    IF TG_OP <> 'INSERT' THEN
        FOREACH v_disp IN ARRAY v_antes LOOP
            IF TG_OP = 'DELETE' OR NOT (v_disp = ANY (v_ahora)) OR NEW.pin IS DISTINCT FROM OLD.pin THEN
                PERFORM public.fn_asistencia_encolar_retiro(v_disp, OLD.pin, OLD.nombre);
            END IF;
        END LOOP;
    END IF;

    -- Registrar donde corresponde, solo si cambió algo que el huellero conoce.
    IF TG_OP <> 'DELETE' THEN
        FOREACH v_disp IN ARRAY v_ahora LOOP
            IF TG_OP = 'INSERT' OR NOT (v_disp = ANY (v_antes)) OR NEW.pin IS DISTINCT FROM OLD.pin
               OR NEW.nombre IS DISTINCT FROM OLD.nombre THEN
                PERFORM public.fn_asistencia_encolar_alta(v_disp, NEW.pin, NEW.nombre);
            END IF;
        END LOOP;
    END IF;
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_personal_a_huelleros ON public.personal;
CREATE TRIGGER trg_personal_a_huelleros
AFTER INSERT OR DELETE OR UPDATE OF pin, nombre, id_centro_costo, estado ON public.personal
FOR EACH ROW EXECUTE FUNCTION public.fn_personal_a_huelleros();

-- Huellero asignado a una obra (o restaurado) → recibe el personal activo de esa obra --------------------------
CREATE OR REPLACE FUNCTION public.fn_huellero_recibe_personal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
    IF NEW.estado = 'activo' AND NEW.id_centro_costo IS NOT NULL
       AND (OLD.estado IS DISTINCT FROM 'activo' OR OLD.id_centro_costo IS DISTINCT FROM NEW.id_centro_costo) THEN
        FOR r IN SELECT pin, nombre FROM public.personal
                 WHERE id_centro_costo = NEW.id_centro_costo AND estado = 'activo' ORDER BY id_personal LOOP
            PERFORM public.fn_asistencia_encolar_alta(NEW.id_dispositivo, r.pin, r.nombre);
        END LOOP;
    END IF;
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_huellero_recibe_personal ON public.asistencia_dispositivo;
CREATE TRIGGER trg_huellero_recibe_personal
AFTER UPDATE OF id_centro_costo, estado ON public.asistencia_dispositivo
FOR EACH ROW EXECUTE FUNCTION public.fn_huellero_recibe_personal();

-- Botón "Sincronizar" del ERP -------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_asistencia_sincronizar(p_id_dispositivo bigint) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_disp public.asistencia_dispositivo%ROWTYPE;
    v_total integer := 0;
    r record;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sesión requerida' USING ERRCODE = '28000';
    END IF;
    SELECT * INTO v_disp FROM public.asistencia_dispositivo WHERE id_dispositivo = p_id_dispositivo;
    IF NOT FOUND OR v_disp.estado = 'baja' THEN
        RAISE EXCEPTION 'Huellero no disponible';
    END IF;
    INSERT INTO public.asistencia_comando (id_dispositivo, descripcion, comando)
    VALUES (p_id_dispositivo, 'Traer los usuarios del huellero al ERP', 'DATA QUERY tablename=user,fielddesc=*,filter=*');
    IF v_disp.id_centro_costo IS NOT NULL THEN
        FOR r IN SELECT pin, nombre FROM public.personal
                 WHERE id_centro_costo = v_disp.id_centro_costo AND estado = 'activo' ORDER BY id_personal LOOP
            PERFORM public.fn_asistencia_encolar_alta(p_id_dispositivo, r.pin, r.nombre);
            v_total := v_total + 1;
        END LOOP;
    END IF;
    RETURN v_total;
END $$;
REVOKE ALL ON FUNCTION public.fn_asistencia_sincronizar(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_asistencia_sincronizar(bigint) TO authenticated;

-- Worker: entregar órdenes y recibir resultados ----------------------------------------------------------------
-- Se reenvían las órdenes entregadas hace más de 10 minutos sin respuesta (huellero apagado a mitad de camino).
CREATE OR REPLACE FUNCTION public.fn_asistencia_comandos(p_token text, p_sn text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_resultado jsonb;
BEGIN
    PERFORM public.fn_asistencia_validar_token(p_token);
    WITH elegidos AS (
        SELECT c.id_comando FROM public.asistencia_comando c
        JOIN public.asistencia_dispositivo d USING (id_dispositivo)
        WHERE d.numero_serie = p_sn AND d.estado <> 'baja'
          AND (c.estado = 'pendiente' OR (c.estado = 'enviado' AND c.enviado_at < now() - interval '10 minutes'))
        ORDER BY c.id_comando
        LIMIT 20
        FOR UPDATE OF c SKIP LOCKED
    ), marcados AS (
        UPDATE public.asistencia_comando c SET estado = 'enviado', enviado_at = now()
        FROM elegidos e WHERE c.id_comando = e.id_comando
        RETURNING c.id_comando, c.comando
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id_comando, 'comando', comando) ORDER BY id_comando), '[]'::jsonb)
    INTO v_resultado FROM marcados;
    RETURN v_resultado;
END $$;

-- p_resultados: [{id, retorno}] (retorno 0 = correcto; otro número = código de error del huellero).
CREATE OR REPLACE FUNCTION public.fn_asistencia_resultados(p_token text, p_sn text, p_resultados jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total integer;
BEGIN
    PERFORM public.fn_asistencia_validar_token(p_token);
    UPDATE public.asistencia_comando c
    SET estado = CASE WHEN r->>'retorno' ~ '^-?\d+$' AND (r->>'retorno')::int >= 0 THEN 'ok' ELSE 'error' END,
        resultado = left('Return=' || COALESCE(r->>'retorno', '?'), 200),
        respondido_at = now()
    FROM jsonb_array_elements(COALESCE(p_resultados, '[]'::jsonb)) r, public.asistencia_dispositivo d
    WHERE r->>'id' ~ '^\d+$' AND c.id_comando = (r->>'id')::bigint
      AND d.id_dispositivo = c.id_dispositivo AND d.numero_serie = p_sn;
    GET DIAGNOSTICS v_total = ROW_COUNT;
    RETURN v_total;
END $$;

REVOKE ALL ON FUNCTION public.fn_asistencia_comandos(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_asistencia_resultados(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_asistencia_comandos(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_asistencia_resultados(text, text, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
