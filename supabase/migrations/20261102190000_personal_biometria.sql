-- La huella / el rostro viajan con el trabajador entre huelleros (Ley 29733: dato sensible, requiere
-- consentimiento). Solo para quien tiene personal.consentimiento_biometrico = true:
--   * Cuando un huellero envía sus plantillas (tabledata/querydata biodata), el Worker llama a
--     fn_asistencia_biometria y se guardan CIFRADAS (pgp_sym_encrypt con una clave propia de cada entorno,
--     generada aquí en asistencia_config.clave_biometria). Nadie las lee por la API: la tabla no tiene políticas.
--   * Al registrar al trabajador en otro huellero (fn_asistencia_encolar_alta) se encola "BIODATA <id>"; el texto
--     real (DATA UPDATE biodata …) se arma y descifra recién al entregarlo (fn_asistencia_comandos), así la
--     plantilla nunca queda en asistencia_comando.
--   * Al marcar el consentimiento se pide a sus huelleros que reenvíen las plantillas; al quitarlo se borran.
-- Idempotente.

ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS consentimiento_biometrico boolean NOT NULL DEFAULT false;
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS consentimiento_fecha date;

INSERT INTO public.asistencia_config (clave, valor)
SELECT 'clave_biometria', encode(extensions.gen_random_bytes(32), 'hex')
WHERE NOT EXISTS (SELECT 1 FROM public.asistencia_config WHERE clave = 'clave_biometria');

-- tipo (ZKTeco): 1 huella, 2 rostro (infrarrojo), 9 rostro (luz visible), 8 palma. numero = dedo; indice = parte.
CREATE TABLE IF NOT EXISTS public.personal_biometria (
    id_biometria           bigserial PRIMARY KEY,
    id_personal            bigint NOT NULL REFERENCES public.personal (id_personal) ON DELETE CASCADE,
    tipo                   smallint NOT NULL,
    numero                 smallint NOT NULL DEFAULT 0,
    indice                 smallint NOT NULL DEFAULT 0,
    campos                 jsonb NOT NULL DEFAULT '{}'::jsonb,
    plantilla              bytea NOT NULL,
    id_dispositivo_origen  bigint REFERENCES public.asistencia_dispositivo (id_dispositivo) ON DELETE SET NULL,
    updated_at             timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id_personal, tipo, numero, indice)
);
ALTER TABLE public.personal_biometria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.personal_biometria FROM anon, authenticated;

-- 1) Recibir plantillas desde el Worker -------------------------------------------------------------------
-- p_plantillas: [{pin, tipo, numero, indice, valid, duress, majorver, minorver, format, tmp}]
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
    RETURN v_total;
END $$;
REVOKE ALL ON FUNCTION public.fn_asistencia_biometria(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_asistencia_biometria(text, text, jsonb) TO anon, authenticated;

-- 2) Alta en un huellero: además del usuario, sus plantillas guardadas ---------------------------------------
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
    -- Plantillas (solo existen si dio su consentimiento), excepto en el huellero de donde salieron.
    INSERT INTO public.asistencia_comando (id_dispositivo, pin, descripcion, comando)
    SELECT p_id_dispositivo, p_pin,
           CASE WHEN b.tipo = 1 THEN 'Copiar huella de ' ELSE 'Copiar rostro de ' END || v_nombre,
           'BIODATA ' || b.id_biometria
    FROM public.personal_biometria b JOIN public.personal p USING (id_personal)
    WHERE p.pin = p_pin AND p.consentimiento_biometrico
      AND b.id_dispositivo_origen IS DISTINCT FROM p_id_dispositivo
    ORDER BY b.tipo, b.numero, b.indice;
END $$;

-- 3) Entregar órdenes: "BIODATA <id>" se arma y descifra aquí ------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_asistencia_comandos(p_token text, p_sn text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_clave text;
    v_resultado jsonb := '[]'::jsonb;
    r record;
    b record;
BEGIN
    PERFORM public.fn_asistencia_validar_token(p_token);
    SELECT valor INTO v_clave FROM public.asistencia_config WHERE clave = 'clave_biometria';
    FOR r IN
        WITH elegidos AS (
            SELECT c.id_comando FROM public.asistencia_comando c
            JOIN public.asistencia_dispositivo d USING (id_dispositivo)
            WHERE d.numero_serie = p_sn AND d.estado <> 'baja'
              AND (c.estado = 'pendiente' OR (c.estado = 'enviado' AND c.enviado_at < now() - interval '10 minutes'))
            ORDER BY c.id_comando
            LIMIT 20
            FOR UPDATE OF c SKIP LOCKED
        )
        UPDATE public.asistencia_comando c SET estado = 'enviado', enviado_at = now()
        FROM elegidos e WHERE c.id_comando = e.id_comando
        RETURNING c.id_comando, c.comando, c.pin
    LOOP
        IF r.comando LIKE 'BIODATA %' THEN
            SELECT bio.*, p.consentimiento_biometrico INTO b FROM public.personal_biometria bio JOIN public.personal p USING (id_personal)
            WHERE bio.id_biometria = substr(r.comando, 9)::bigint;
            IF NOT FOUND OR NOT b.consentimiento_biometrico OR v_clave IS NULL THEN
                UPDATE public.asistencia_comando SET estado = 'error', resultado = 'Plantilla ya no disponible', respondido_at = now()
                WHERE id_comando = r.id_comando;
                CONTINUE;
            END IF;
            v_resultado := v_resultado || jsonb_build_object('id', r.id_comando, 'comando',
                'DATA UPDATE biodata Pin=' || r.pin || E'\t' || 'No=' || b.numero || E'\t' || 'Index=' || b.indice
                || E'\t' || 'Valid=' || COALESCE(b.campos->>'valid', '1') || E'\t' || 'Duress=' || COALESCE(b.campos->>'duress', '0')
                || E'\t' || 'Type=' || b.tipo || E'\t' || 'MajorVer=' || COALESCE(b.campos->>'majorver', '0')
                || E'\t' || 'MinorVer=' || COALESCE(b.campos->>'minorver', '0') || E'\t' || 'Format=' || COALESCE(b.campos->>'format', '0')
                || E'\t' || 'Tmp=' || pgp_sym_decrypt(b.plantilla, v_clave));
        ELSE
            v_resultado := v_resultado || jsonb_build_object('id', r.id_comando, 'comando', r.comando);
        END IF;
    END LOOP;
    RETURN (SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'id')::bigint), '[]'::jsonb) FROM jsonb_array_elements(v_resultado) x);
END $$;

-- 4) Consentimiento: al darlo se piden las plantillas a sus huelleros; al quitarlo se borran ---------------
CREATE OR REPLACE FUNCTION public.fn_personal_consentimiento() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.consentimiento_biometrico AND NOT OLD.consentimiento_biometrico AND NEW.estado = 'activo' THEN
        INSERT INTO public.asistencia_comando (id_dispositivo, pin, descripcion, comando)
        SELECT d.id_dispositivo, NULL, 'Traer huellas y rostros guardados (consentimiento de ' || left(COALESCE(NEW.nombre, NEW.pin), 24) || ')',
               'DATA QUERY tablename=biodata,fielddesc=*,filter=*'
        FROM public.personal_huellero ph JOIN public.asistencia_dispositivo d USING (id_dispositivo)
        WHERE ph.id_personal = NEW.id_personal AND d.estado = 'activo';
    ELSIF OLD.consentimiento_biometrico AND NOT NEW.consentimiento_biometrico THEN
        DELETE FROM public.personal_biometria WHERE id_personal = NEW.id_personal;
    END IF;
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_personal_consentimiento ON public.personal;
CREATE TRIGGER trg_personal_consentimiento
AFTER UPDATE OF consentimiento_biometrico ON public.personal
FOR EACH ROW EXECUTE FUNCTION public.fn_personal_consentimiento();

-- 5) Resumen para la ficha (cuántas huellas y rostros hay guardados, nunca la plantilla) ------------------
CREATE OR REPLACE FUNCTION public.fn_personal_biometria_resumen()
RETURNS TABLE (id_personal bigint, huellas integer, rostros integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sesión requerida' USING ERRCODE = '28000';
    END IF;
    RETURN QUERY
    SELECT b.id_personal, count(*) FILTER (WHERE b.tipo = 1)::integer, count(*) FILTER (WHERE b.tipo IN (2, 9))::integer
    FROM public.personal_biometria b GROUP BY b.id_personal;
END $$;
REVOKE ALL ON FUNCTION public.fn_personal_biometria_resumen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_personal_biometria_resumen() TO authenticated;

NOTIFY pgrst, 'reload schema';
