-- A qué base envía sus datos cada huellero: 'produccion' (por defecto) o 'desarrollo', para probar con un equipo
-- real sin tocar datos reales. Producción es quien decide: el receptor de Cloudflare (servicios/huellero-adms)
-- consulta fn_asistencia_destino con su token y, si dice 'desarrollo', reenvía todo a la base Dev.
-- Solo el rol developer puede cambiarlo (botón "Huelleros PRD/DEV" de la barra superior, junto al cambio de base).
-- En Dev la columna existe por igualdad de esquema, pero no se usa. Idempotente.

ALTER TABLE public.asistencia_dispositivo ADD COLUMN IF NOT EXISTS destino varchar(12) NOT NULL DEFAULT 'produccion';
ALTER TABLE public.asistencia_dispositivo DROP CONSTRAINT IF EXISTS asistencia_dispositivo_destino_check;
ALTER TABLE public.asistencia_dispositivo ADD CONSTRAINT asistencia_dispositivo_destino_check CHECK (destino IN ('produccion', 'desarrollo'));
COMMENT ON COLUMN public.asistencia_dispositivo.destino IS 'Base a la que el receptor envía los datos de este huellero (produccion/desarrollo). Solo lo cambia el rol developer.';

-- Para el receptor: destino del huellero (uno desconocido va a Producción, donde queda como pendiente).
CREATE OR REPLACE FUNCTION public.fn_asistencia_destino(p_token text, p_sn text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
    PERFORM public.fn_asistencia_validar_token(p_token);
    RETURN COALESCE((SELECT destino FROM public.asistencia_dispositivo WHERE numero_serie = p_sn), 'produccion');
END $$;
REVOKE ALL ON FUNCTION public.fn_asistencia_destino(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_asistencia_destino(text, text) TO anon, authenticated;

-- Solo el rol developer cambia el destino (los usuarios del ERP sí pueden editar nombre y obra del huellero).
-- Sin usuario del ERP (SQL Editor, service role) se permite.
CREATE OR REPLACE FUNCTION public.fn_asistencia_destino_solo_developer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.destino IS DISTINCT FROM OLD.destino AND auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM empleados e JOIN roles r ON r.id = e.rol_id
        WHERE e.auth_user_id = auth.uid() AND e.estado = 'activo' AND r.nombre = 'developer'
    ) THEN
        RAISE EXCEPTION 'Solo un usuario con rol developer puede cambiar a qué base envía un huellero.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_asistencia_destino_solo_developer ON public.asistencia_dispositivo;
CREATE TRIGGER trg_asistencia_destino_solo_developer BEFORE UPDATE OF destino ON public.asistencia_dispositivo
    FOR EACH ROW EXECUTE FUNCTION public.fn_asistencia_destino_solo_developer();

NOTIFY pgrst, 'reload schema';
