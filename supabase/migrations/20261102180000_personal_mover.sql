-- "Mover a otra obra" masivo (Personal): cambia la obra o área de varios trabajadores a la vez y, si se pide,
-- también sus huelleros: quita los de la obra anterior y agrega los de la nueva. Los triggers de
-- personal_huellero (20261102170000) encolan el retiro y el alta en cada equipo. Los huelleros que no son de la
-- obra anterior (p. ej. el de oficina) se conservan. Las marcas ya registradas no cambian de obra.
-- Idempotente.

CREATE OR REPLACE FUNCTION public.fn_personal_mover(p_ids bigint[], p_id_centro_costo bigint, p_cambiar_huelleros boolean DEFAULT true)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
    v_total integer := 0;
    r record;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sesión requerida' USING ERRCODE = '28000';
    END IF;
    IF p_id_centro_costo IS NULL OR NOT EXISTS (SELECT 1 FROM public.centro_costo WHERE id_centro_costo = p_id_centro_costo AND estado = 'activo') THEN
        RAISE EXCEPTION 'Elige una obra o área de destino activa';
    END IF;

    FOR r IN SELECT id_personal, id_centro_costo FROM public.personal
             WHERE id_personal = ANY (p_ids) AND estado = 'activo' ORDER BY id_personal FOR UPDATE LOOP
        IF p_cambiar_huelleros THEN
            IF r.id_centro_costo IS NOT NULL AND r.id_centro_costo <> p_id_centro_costo THEN
                DELETE FROM public.personal_huellero ph
                USING public.asistencia_dispositivo d
                WHERE ph.id_personal = r.id_personal AND d.id_dispositivo = ph.id_dispositivo
                  AND d.id_centro_costo = r.id_centro_costo;
            END IF;
            INSERT INTO public.personal_huellero (id_personal, id_dispositivo)
            SELECT r.id_personal, d.id_dispositivo FROM public.asistencia_dispositivo d
            WHERE d.id_centro_costo = p_id_centro_costo AND d.estado <> 'baja'
            ON CONFLICT DO NOTHING;
        END IF;
        UPDATE public.personal SET id_centro_costo = p_id_centro_costo, updated_at = now() WHERE id_personal = r.id_personal;
        v_total := v_total + 1;
    END LOOP;
    RETURN v_total;
END $$;

REVOKE ALL ON FUNCTION public.fn_personal_mover(bigint[], bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_personal_mover(bigint[], bigint, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
