-- Huelleros donde marca cada trabajador, independiente de su obra (ej. un huellero de oficina para el personal
-- administrativo, o un trabajador que marca en dos obras). Reemplaza la regla de 20261102150000 ("se envía a los
-- huelleros de la obra del trabajador") por la tabla personal_huellero:
--   vínculo nuevo            → DATA UPDATE user + userauthorize en ese huellero
--   vínculo quitado          → DATA DELETE user en ese huellero
--   cambio de código/nombre/estado del trabajador → se reenvía (o se retira) en todos sus huelleros
--   huellero asignado a una obra/área → se vincula al personal activo de esa obra/área
-- Los usuarios y marcas que llegan DESDE un huellero lo vinculan sin enviarle nada (ya están en él): la ingesta
-- marca la sesión con asistencia.desde_huellero = '1' y los triggers no encolan órdenes.
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.personal_huellero (
    id_personal     bigint NOT NULL REFERENCES public.personal (id_personal) ON DELETE CASCADE,
    id_dispositivo  bigint NOT NULL REFERENCES public.asistencia_dispositivo (id_dispositivo) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id_personal, id_dispositivo)
);
CREATE INDEX IF NOT EXISTS idx_personal_huellero_dispositivo ON public.personal_huellero (id_dispositivo);

ALTER TABLE public.personal_huellero ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS personal_huellero_autenticados ON public.personal_huellero;
CREATE POLICY personal_huellero_autenticados ON public.personal_huellero TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, DELETE ON public.personal_huellero TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_asistencia_desde_huellero() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('asistencia.desde_huellero', true), '') = '1' $$;

-- Vínculos existentes según la regla anterior (personal activo ↔ huelleros activos de su obra).
INSERT INTO public.personal_huellero (id_personal, id_dispositivo)
SELECT p.id_personal, d.id_dispositivo
FROM public.personal p
JOIN public.asistencia_dispositivo d ON d.id_centro_costo = p.id_centro_costo AND d.estado = 'activo'
WHERE p.estado = 'activo'
ON CONFLICT DO NOTHING;

-- 1) Vínculos → órdenes ----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_personal_huellero_ordenes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_p public.personal%ROWTYPE;
    v_activo boolean;
BEGIN
    IF public.fn_asistencia_desde_huellero() THEN RETURN NULL; END IF;
    SELECT * INTO v_p FROM public.personal WHERE id_personal = COALESCE(NEW.id_personal, OLD.id_personal);
    -- Sin trabajador = se está borrando la ficha: el retiro lo encola fn_personal_a_huelleros (BEFORE DELETE).
    IF NOT FOUND OR v_p.estado <> 'activo' THEN RETURN NULL; END IF;
    SELECT estado = 'activo' INTO v_activo FROM public.asistencia_dispositivo
    WHERE id_dispositivo = COALESCE(NEW.id_dispositivo, OLD.id_dispositivo);
    IF NOT COALESCE(v_activo, false) THEN RETURN NULL; END IF;
    IF TG_OP = 'INSERT' THEN
        PERFORM public.fn_asistencia_encolar_alta(NEW.id_dispositivo, v_p.pin, v_p.nombre);
    ELSE
        PERFORM public.fn_asistencia_encolar_retiro(OLD.id_dispositivo, v_p.pin, v_p.nombre);
    END IF;
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_personal_huellero_ordenes ON public.personal_huellero;
CREATE TRIGGER trg_personal_huellero_ordenes
AFTER INSERT OR DELETE ON public.personal_huellero
FOR EACH ROW EXECUTE FUNCTION public.fn_personal_huellero_ordenes();

-- 2) Cambios del trabajador → órdenes en todos sus huelleros (ya no depende de la obra) -----------------------
CREATE OR REPLACE FUNCTION public.fn_personal_a_huelleros() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_disp bigint;
BEGIN
    IF public.fn_asistencia_desde_huellero() THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NULL END;
    END IF;
    FOR v_disp IN
        SELECT ph.id_dispositivo FROM public.personal_huellero ph
        JOIN public.asistencia_dispositivo d USING (id_dispositivo)
        WHERE ph.id_personal = OLD.id_personal AND d.estado = 'activo'
    LOOP
        IF TG_OP = 'DELETE' THEN
            IF OLD.estado = 'activo' THEN PERFORM public.fn_asistencia_encolar_retiro(v_disp, OLD.pin, OLD.nombre); END IF;
        ELSIF OLD.estado = 'activo' AND NEW.estado <> 'activo' THEN
            PERFORM public.fn_asistencia_encolar_retiro(v_disp, OLD.pin, OLD.nombre);
        ELSIF NEW.estado = 'activo' AND OLD.estado <> 'activo' THEN
            PERFORM public.fn_asistencia_encolar_alta(v_disp, NEW.pin, NEW.nombre);
        ELSIF NEW.estado = 'activo' AND NEW.pin IS DISTINCT FROM OLD.pin THEN
            PERFORM public.fn_asistencia_encolar_retiro(v_disp, OLD.pin, OLD.nombre);
            PERFORM public.fn_asistencia_encolar_alta(v_disp, NEW.pin, NEW.nombre);
        ELSIF NEW.estado = 'activo' AND NEW.nombre IS DISTINCT FROM OLD.nombre THEN
            PERFORM public.fn_asistencia_encolar_alta(v_disp, NEW.pin, NEW.nombre);
        END IF;
    END LOOP;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NULL END;
END $$;

DROP TRIGGER IF EXISTS trg_personal_a_huelleros ON public.personal;
DROP TRIGGER IF EXISTS trg_personal_a_huelleros_cambios ON public.personal;
DROP TRIGGER IF EXISTS trg_personal_a_huelleros_borrado ON public.personal;
CREATE TRIGGER trg_personal_a_huelleros_cambios
AFTER UPDATE OF pin, nombre, estado ON public.personal
FOR EACH ROW EXECUTE FUNCTION public.fn_personal_a_huelleros();
CREATE TRIGGER trg_personal_a_huelleros_borrado
BEFORE DELETE ON public.personal
FOR EACH ROW EXECUTE FUNCTION public.fn_personal_a_huelleros();

-- 3) Huellero asignado a obra/área o restaurado ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_huellero_recibe_personal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
    IF NEW.estado <> 'activo' THEN RETURN NULL; END IF;
    -- Restaurado (o recién activado): reenviar a sus trabajadores ya vinculados.
    IF OLD.estado IS DISTINCT FROM 'activo' THEN
        FOR r IN SELECT p.pin, p.nombre FROM public.personal_huellero ph JOIN public.personal p USING (id_personal)
                 WHERE ph.id_dispositivo = NEW.id_dispositivo AND p.estado = 'activo' ORDER BY p.id_personal LOOP
            PERFORM public.fn_asistencia_encolar_alta(NEW.id_dispositivo, r.pin, r.nombre);
        END LOOP;
    END IF;
    -- Obra/área nueva: vincular al personal activo de esa obra/área (el trigger del vínculo encola el alta).
    IF NEW.id_centro_costo IS NOT NULL AND OLD.id_centro_costo IS DISTINCT FROM NEW.id_centro_costo THEN
        INSERT INTO public.personal_huellero (id_personal, id_dispositivo)
        SELECT id_personal, NEW.id_dispositivo FROM public.personal
        WHERE id_centro_costo = NEW.id_centro_costo AND estado = 'activo'
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NULL;
END $$;

-- 4) Sincronizar: trae usuarios y reenvía a los trabajadores vinculados ----------------------------------------
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
    FOR r IN SELECT p.pin, p.nombre FROM public.personal_huellero ph JOIN public.personal p USING (id_personal)
             WHERE ph.id_dispositivo = p_id_dispositivo AND p.estado = 'activo' ORDER BY p.id_personal LOOP
        PERFORM public.fn_asistencia_encolar_alta(p_id_dispositivo, r.pin, r.nombre);
        v_total := v_total + 1;
    END LOOP;
    RETURN v_total;
END $$;

-- 5) Ingesta: lo que llega de un huellero lo vincula, sin devolverle órdenes -----------------------------------
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
    v_disp public.asistencia_dispositivo%ROWTYPE;
    v_insertadas integer := 0;
BEGIN
    PERFORM public.fn_asistencia_validar_token(p_token);
    IF p_sn IS NULL OR p_sn !~ '^[A-Za-z0-9_-]{1,40}$' THEN
        RAISE EXCEPTION 'Número de serie inválido' USING ERRCODE = '22023';
    END IF;
    PERFORM set_config('asistencia.desde_huellero', '1', true);

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
        PERFORM set_config('asistencia.desde_huellero', '', true);
        RETURN jsonb_build_object('ok', false, 'motivo', 'dispositivo dado de baja');
    END IF;

    -- Dos sentencias: el vínculo debe ver a los trabajadores recién creados (un CTE no los vería).
    INSERT INTO public.personal AS t (pin, nombre)
    SELECT DISTINCT ON (left(x->>'pin', 20)) left(x->>'pin', 20), NULLIF(left(btrim(x->>'nombre'), 150), '')
    FROM jsonb_array_elements(COALESCE(p_usuarios, '[]'::jsonb)) x
    WHERE COALESCE(x->>'pin', '') <> ''
    ON CONFLICT (pin) DO UPDATE
        SET nombre = EXCLUDED.nombre
        WHERE (t.nombre IS NULL OR t.nombre = '') AND EXCLUDED.nombre IS NOT NULL;
    INSERT INTO public.personal_huellero (id_personal, id_dispositivo)
    SELECT p.id_personal, v_disp.id_dispositivo FROM public.personal p
    WHERE p.pin IN (SELECT left(x->>'pin', 20) FROM jsonb_array_elements(COALESCE(p_usuarios, '[]'::jsonb)) x)
    ON CONFLICT DO NOTHING;

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
    )
    SELECT count(*) INTO v_insertadas FROM nuevas;

    -- Quien marcó en este huellero queda vinculado a él (y registrado en Personal si no existía).
    INSERT INTO public.personal (pin)
    SELECT DISTINCT left(x->>'pin', 20) FROM jsonb_array_elements(COALESCE(p_marcaciones, '[]'::jsonb)) x
    WHERE COALESCE(x->>'pin', '') NOT IN ('', '0')
    ON CONFLICT (pin) DO NOTHING;
    INSERT INTO public.personal_huellero (id_personal, id_dispositivo)
    SELECT p.id_personal, v_disp.id_dispositivo FROM public.personal p
    WHERE p.pin IN (SELECT left(x->>'pin', 20) FROM jsonb_array_elements(COALESCE(p_marcaciones, '[]'::jsonb)) x)
    ON CONFLICT DO NOTHING;

    PERFORM set_config('asistencia.desde_huellero', '', true);
    RETURN jsonb_build_object('ok', true, 'insertadas', v_insertadas, 'estado', v_disp.estado);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_asistencia_ingesta(text, text, text, text, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_asistencia_ingesta(text, text, text, text, jsonb, jsonb, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
