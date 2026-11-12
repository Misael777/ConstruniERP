-- SEGURIDAD (revisión del merge con los avances de Personal, 12/11/2026): fn_historial_detalle_obra y
-- fn_historial_detalle_huellero (migración 20261112120100) son SECURITY DEFINER y, por los privilegios por defecto de
-- Supabase, el rol `anon` (sin iniciar sesión) podía llamarlas y leer nombres de obras/proyectos y de huelleros.
-- Solo las usan los triggers del historial (que corren como su dueño), así que basta con usuarios con sesión.
-- No cambia ningún dato.
REVOKE EXECUTE ON FUNCTION public.fn_historial_detalle_obra(bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_historial_detalle_huellero(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_historial_detalle_obra(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_historial_detalle_huellero(bigint) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
