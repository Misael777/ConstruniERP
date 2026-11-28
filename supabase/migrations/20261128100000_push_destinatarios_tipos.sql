-- Ticket #113 (28/11/2026): el aviso al celular cuando un ticket cambia de estado nunca salía. fn_push_destinatarios
-- devolvía ticket.titulo (varchar(150)) en una columna `text` y Postgres cortaba con "structure of query does not
-- match function result type" (net._http_response de Prod: 500 en cada cambio de estado de ticket). Se castea a text
-- todo lo que sale de columnas varchar. Misma función, mismo resultado; no modifica datos. Idempotente.

CREATE OR REPLACE FUNCTION public.fn_push_destinatarios(p_tabla text, p_id bigint, p_evento text)
 RETURNS TABLE(auth_user_id uuid, titulo text, cuerpo text, categoria text, categoria_nombre text, url text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    s solicitud_aprobacion;
    t ticket;
    v_cat text;
    v_nombre text;
    v_accion text;
BEGIN
    IF p_tabla = 'solicitud' THEN
        SELECT * INTO s FROM solicitud_aprobacion WHERE id_solicitud = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        v_cat := CASE
            WHEN s.tipo_entidad = 'transaccion' THEN 'finanzas'
            WHEN s.tipo_entidad = 'cliente' THEN 'comercial'
            WHEN s.tipo_entidad = 'exportacion' AND s.descripcion_entidad ILIKE '%cliente%' THEN 'comercial'
            ELSE 'ventas' END;
        v_nombre := CASE v_cat WHEN 'finanzas' THEN 'Finanzas' WHEN 'comercial' THEN 'Comercial' ELSE 'Ventas' END;
        v_accion := CASE s.tipo_accion WHEN 'editar' THEN 'Editar' WHEN 'eliminar' THEN 'Eliminar' WHEN 'cerrar_venta' THEN 'Cerrar venta'
            WHEN 'exportar' THEN 'Exportar' WHEN 'quitar_aprobacion' THEN 'Quitar aprobación' ELSE s.tipo_accion END;
        IF p_evento = 'nueva' AND s.estado = 'pendiente' THEN
            RETURN QUERY
            SELECT DISTINCT e.auth_user_id,
                   format('%s · por aprobar', v_accion),
                   format('%s%s', COALESCE(s.descripcion_entidad, ''), CASE WHEN s.solicitado_por IS NOT NULL THEN E'\nSolicitado por: ' || s.solicitado_por ELSE '' END),
                   v_cat, v_nombre, '/dashboard'
            FROM empleados e
            JOIN roles r ON r.id = e.rol_id
            WHERE e.estado = 'activo' AND e.auth_user_id IS NOT NULL
              AND e.auth_user_id IS DISTINCT FROM s.solicitado_por_id
              AND (r.nombre = 'administrador' OR EXISTS (
                    SELECT 1 FROM roles_permisos rp JOIN permisos p ON p.id = rp.permiso_id
                    WHERE rp.rol_id = e.rol_id AND p.nombre = 'aprobar_solicitudes_' || CASE WHEN v_cat = 'finanzas' THEN 'finanzas' WHEN v_cat = 'comercial' THEN 'comercial' ELSE 'ventas' END));
        ELSIF p_evento = 'resuelta' AND s.estado <> 'pendiente' AND s.solicitado_por_id IS NOT NULL THEN
            RETURN QUERY SELECT s.solicitado_por_id,
                   format('Solicitud %s', CASE WHEN s.estado = 'aprobado' THEN 'aprobada' ELSE 'rechazada' END),
                   format('%s · %s%s', v_accion, COALESCE(s.descripcion_entidad, ''), CASE WHEN s.resuelto_por IS NOT NULL THEN E'\nPor: ' || s.resuelto_por ELSE '' END),
                   v_cat, v_nombre, '/dashboard';
        END IF;
    ELSIF p_tabla = 'ticket' THEN
        SELECT * INTO t FROM ticket WHERE id_ticket = p_id;
        IF NOT FOUND THEN RETURN; END IF;
        IF p_evento = 'nueva' THEN
            RETURN QUERY
            SELECT DISTINCT e.auth_user_id, format('Ticket nuevo #%s', t.id_ticket), format('%s%s', t.titulo, CASE WHEN t.creado_por IS NOT NULL THEN E'\nReportado por: ' || t.creado_por ELSE '' END),
                   'soporte', 'Soporte', '/soporte/developer'
            FROM empleados e JOIN roles r ON r.id = e.rol_id
            WHERE e.estado = 'activo' AND e.auth_user_id IS NOT NULL AND r.nombre = 'developer' AND e.auth_user_id IS DISTINCT FROM t.creado_por_id;
        ELSIF p_evento = 'estado' AND t.creado_por_id IS NOT NULL THEN
            RETURN QUERY SELECT t.creado_por_id, format('Ticket #%s: %s', t.id_ticket, t.estado), t.titulo::text, 'soporte', 'Soporte', '/soporte/tickets';
        END IF;
    END IF;
END $function$

;

NOTIFY pgrst, 'reload schema';
