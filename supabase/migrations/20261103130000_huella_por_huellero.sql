-- Huella o rostro por trabajador y huellero (aviso de alta prioridad "Sin huella" en Personal).
-- personal_huellero guarda CUÁNTAS huellas y rostros tiene cada trabajador en cada huellero: solo el número, nunca la
-- plantilla, así que vale para todos (con o sin consentimiento, Ley 29733). Se actualiza:
--   - cuando el huellero envía plantillas (al registrar una huella en el equipo, o al Sincronizar);
--   - Sincronizar ahora también pide las plantillas (DATA QUERY biodata), además de los usuarios;
--   - cuando el huellero confirma una huella o rostro que el ERP le copió (orden BIODATA).
-- Idempotente.

ALTER TABLE public.personal_huellero ADD COLUMN IF NOT EXISTS huellas smallint NOT NULL DEFAULT 0;
ALTER TABLE public.personal_huellero ADD COLUMN IF NOT EXISTS rostros smallint NOT NULL DEFAULT 0;
ALTER TABLE public.personal_huellero ADD COLUMN IF NOT EXISTS biometria_at timestamptz;
ALTER TABLE public.personal_huellero ADD COLUMN IF NOT EXISTS dedos smallint[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.personal_huellero.huellas IS 'Huellas registradas del trabajador en este huellero (solo el número).';
COMMENT ON COLUMN public.personal_huellero.rostros IS 'Rostros registrados del trabajador en este huellero (solo el número).';
COMMENT ON COLUMN public.personal_huellero.dedos IS 'Dedos (0-9) con huella en este huellero; huellas = cuántos.';
COMMENT ON COLUMN public.personal_huellero.biometria_at IS 'Última vez que el huellero informó sus huellas/rostros.';

-- 1) Plantillas que llegan del huellero: igual que antes + el conteo -------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_asistencia_biometria(p_token text, p_sn text, p_plantillas jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_clave text;
    v_disp bigint;
    v_total integer;
BEGIN
    PERFORM public.fn_asistencia_validar_token(p_token);
    SELECT valor INTO v_clave FROM public.asistencia_config WHERE clave = 'clave_biometria';
    SELECT id_dispositivo INTO v_disp FROM public.asistencia_dispositivo WHERE numero_serie = p_sn AND estado <> 'baja';
    IF v_disp IS NULL OR v_clave IS NULL THEN RETURN 0; END IF;

    INSERT INTO public.personal_biometria AS b (id_personal, tipo, numero, indice, campos, plantilla, id_dispositivo_origen, updated_at)
    SELECT DISTINCT ON (p.id_personal, (x->>'tipo')::smallint, COALESCE(NULLIF(x->>'numero', '')::smallint, 0), COALESCE(NULLIF(x->>'indice', '')::smallint, 0))
           p.id_personal, (x->>'tipo')::smallint, COALESCE(NULLIF(x->>'numero', '')::smallint, 0), COALESCE(NULLIF(x->>'indice', '')::smallint, 0),
           jsonb_strip_nulls(jsonb_build_object('valid', x->>'valid', 'duress', x->>'duress', 'majorver', x->>'majorver',
                                                'minorver', x->>'minorver', 'format', x->>'format')),
           pgp_sym_encrypt(x->>'tmp', v_clave), v_disp, now()
    FROM jsonb_array_elements(COALESCE(p_plantillas, '[]'::jsonb)) x
    JOIN public.personal p ON p.pin = left(x->>'pin', 20) AND p.consentimiento_biometrico
    WHERE x->>'tipo' ~ '^\d{1,3}$' AND COALESCE(x->>'numero', '') ~ '^\d{0,3}$' AND COALESCE(x->>'indice', '') ~ '^\d{0,3}$'
      AND length(COALESCE(x->>'tmp', '')) > 0 AND COALESCE(x->>'valid', '1') <> '0'
    ON CONFLICT (id_personal, tipo, numero, indice) DO UPDATE
        SET campos = EXCLUDED.campos, plantilla = EXCLUDED.plantilla,
            id_dispositivo_origen = EXCLUDED.id_dispositivo_origen, updated_at = now();
    GET DIAGNOSTICS v_total = ROW_COUNT;

    -- Cuántas huellas y rostros tiene cada trabajador en este huellero (para todos, con o sin consentimiento;
    -- solo el número, nunca la plantilla). Al registrar una huella nueva el huellero envía solo esa: los dedos se
    -- acumulan (unión) y los rostros se quedan con el mayor.
    UPDATE public.personal_huellero ph
    SET dedos = (SELECT COALESCE(array_agg(DISTINCT d ORDER BY d), '{}') FROM unnest(ph.dedos || c.dedos) d),
        huellas = (SELECT count(DISTINCT d) FROM unnest(ph.dedos || c.dedos) d),
        rostros = GREATEST(ph.rostros, c.rostros), biometria_at = now()
    FROM (
        SELECT p.id_personal,
               COALESCE(array_agg(DISTINCT COALESCE(NULLIF(x->>'numero', ''), '0')::smallint) FILTER (WHERE x->>'tipo' = '1' AND COALESCE(x->>'numero', '') ~ '^\d{0,2}$'), '{}') AS dedos,
               count(*) FILTER (WHERE x->>'tipo' IN ('2', '9'))::smallint AS rostros
        FROM jsonb_array_elements(COALESCE(p_plantillas, '[]'::jsonb)) x
        JOIN public.personal p ON p.pin = left(x->>'pin', 20)
        WHERE length(COALESCE(x->>'tmp', '')) > 0 AND COALESCE(x->>'valid', '1') <> '0'
        GROUP BY p.id_personal
    ) c
    WHERE ph.id_personal = c.id_personal AND ph.id_dispositivo = v_disp;

    RETURN v_total;
END $$;
REVOKE ALL ON FUNCTION public.fn_asistencia_biometria(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_asistencia_biometria(text, text, jsonb) TO anon, authenticated;

-- 2) Sincronizar: además de los usuarios, pide sus plantillas para saber quién tiene huella ---------------------
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
    INSERT INTO public.asistencia_comando (id_dispositivo, descripcion, comando) VALUES
        (p_id_dispositivo, 'Traer los usuarios del huellero al ERP', 'DATA QUERY tablename=user,fielddesc=*,filter=*'),
        (p_id_dispositivo, 'Revisar quién tiene huella o rostro', 'DATA QUERY tablename=biodata,fielddesc=*,filter=*');
    FOR r IN SELECT p.pin, p.nombre FROM public.personal_huellero ph JOIN public.personal p USING (id_personal)
             WHERE ph.id_dispositivo = p_id_dispositivo AND p.estado = 'activo' ORDER BY p.id_personal LOOP
        PERFORM public.fn_asistencia_encolar_alta(p_id_dispositivo, r.pin, r.nombre);
        v_total := v_total + 1;
    END LOOP;
    RETURN v_total;
END $$;

-- 3) Huella o rostro copiado por el ERP y confirmado por el huellero: cuenta para ese huellero -----------------
CREATE OR REPLACE FUNCTION public.fn_asistencia_biodata_confirmada() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tipo smallint; v_numero smallint; v_personal bigint;
BEGIN
    IF NEW.estado = 'ok' AND OLD.estado IS DISTINCT FROM 'ok' AND NEW.comando ~ '^BIODATA \d+$' THEN
        SELECT tipo, numero, id_personal INTO v_tipo, v_numero, v_personal FROM public.personal_biometria
        WHERE id_biometria = substring(NEW.comando FROM 9)::bigint;
        IF FOUND THEN
            UPDATE public.personal_huellero
            SET dedos = CASE WHEN v_tipo = 1 AND NOT v_numero = ANY (dedos) THEN dedos || v_numero ELSE dedos END,
                huellas = cardinality(CASE WHEN v_tipo = 1 AND NOT v_numero = ANY (dedos) THEN dedos || v_numero ELSE dedos END),
                rostros = GREATEST(rostros, CASE WHEN v_tipo IN (2, 9) THEN 1 ELSE 0 END),
                biometria_at = now()
            WHERE id_personal = v_personal AND id_dispositivo = NEW.id_dispositivo;
        END IF;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_asistencia_biodata_confirmada ON public.asistencia_comando;
CREATE TRIGGER trg_asistencia_biodata_confirmada AFTER UPDATE OF estado ON public.asistencia_comando
    FOR EACH ROW EXECUTE FUNCTION public.fn_asistencia_biodata_confirmada();

NOTIFY pgrst, 'reload schema';
