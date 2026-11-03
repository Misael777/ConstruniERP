-- Los usuarios que el ERP envía al huellero van al grupo de acceso 1 (antes 0).
-- El SenseFace 2A (modo control de acceso) verifica por combinación de grupos: un usuario en el grupo 0 queda fuera de
-- toda combinación y el equipo lo rechaza aunque reconozca su huella ("Verificación fallida", evento 48 en rtlog).
-- Los usuarios creados en el propio equipo quedan en el grupo 1 (el de fábrica), así que el ERP usa ese mismo.
-- Tras aplicarla: Huelleros → 🔄 Sincronizar en cada huellero, para reenviar a todos con el grupo 1.
-- Idempotente.

CREATE OR REPLACE FUNCTION public.fn_asistencia_encolar_alta(p_id_dispositivo bigint, p_pin text, p_nombre text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    -- El huellero guarda hasta 24 caracteres de nombre; tabuladores y saltos de línea romperían el protocolo.
    v_nombre text := left(regexp_replace(COALESCE(NULLIF(btrim(p_nombre), ''), p_pin), '[\t\r\n]+', ' ', 'g'), 24);
BEGIN
    INSERT INTO public.asistencia_comando (id_dispositivo, pin, descripcion, comando) VALUES
        (p_id_dispositivo, p_pin, 'Registrar o actualizar ' || v_nombre,
         'DATA UPDATE user CardNo=' || E'\t' || 'Pin=' || p_pin || E'\t' || 'Group=1' || E'\t' || 'StartTime=0' || E'\t' || 'EndTime=0' || E'\t' || 'Name=' || v_nombre),
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

NOTIFY pgrst, 'reload schema';
