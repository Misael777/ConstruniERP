-- Ticket #113 (app, 26/11/2026): notificaciones en el CELULAR aunque la app esté cerrada (Firebase Cloud Messaging),
-- agrupadas por categoría como en la imagen de la clienta ("CONSTRUNI ERP · Finanzas · 3 notificaciones").
--  - dispositivo_push: el token FCM de cada celular con su usuario (lo registra la app Android al entrar).
--  - push_config: URL de la Edge Function notificar-push y un secreto compartido. Sin políticas: solo la leen las
--    funciones SECURITY DEFINER de aquí y la Edge Function (service role). La URL se completa por entorno:
--      UPDATE public.push_config SET url = 'https://<ref>.supabase.co/functions/v1/notificar-push';
--  - Triggers (pg_net, asíncronos: no frenan el guardado): solicitud de aprobación nueva → a quienes la aprueban
--    (administradores y quien tenga aprobar_solicitudes_<categoría>); solicitud resuelta → a quien la pidió; ticket
--    nuevo → developers; ticket que cambia de estado → a quien lo reportó.
--  - fn_push_destinatarios: arma el aviso (título, texto, categoría) y los usuarios que lo reciben.
-- No modifica datos existentes. Idempotente.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.dispositivo_push (
    token          text PRIMARY KEY CHECK (length(token) BETWEEN 20 AND 4096),
    auth_user_id   uuid NOT NULL,
    plataforma     text NOT NULL DEFAULT 'android',
    actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dispositivo_push_usuario ON public.dispositivo_push (auth_user_id);
ALTER TABLE public.dispositivo_push ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dispositivo_push_propios ON public.dispositivo_push;
CREATE POLICY dispositivo_push_propios ON public.dispositivo_push FOR SELECT TO authenticated USING (auth_user_id = auth.uid());
GRANT SELECT ON public.dispositivo_push TO authenticated;

-- El mismo celular puede pasar de un usuario a otro (cierra sesión y entra otra persona): el token queda con el último.
CREATE OR REPLACE FUNCTION public.fn_registrar_dispositivo_push(p_token text, p_plataforma text DEFAULT 'android')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sin sesión.' USING ERRCODE = '42501'; END IF;
    INSERT INTO dispositivo_push (token, auth_user_id, plataforma, actualizado_en)
    VALUES (btrim(p_token), auth.uid(), COALESCE(NULLIF(btrim(p_plataforma), ''), 'android'), now())
    ON CONFLICT (token) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id, plataforma = EXCLUDED.plataforma, actualizado_en = now();
END $$;
REVOKE ALL ON FUNCTION public.fn_registrar_dispositivo_push(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_registrar_dispositivo_push(text, text) TO authenticated;

-- Al cerrar sesión en el celular: deja de recibir avisos de ese usuario.
CREATE OR REPLACE FUNCTION public.fn_quitar_dispositivo_push(p_token text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
    DELETE FROM dispositivo_push WHERE token = btrim(p_token) AND auth_user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.fn_quitar_dispositivo_push(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_quitar_dispositivo_push(text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.push_config (
    id      boolean PRIMARY KEY DEFAULT true CHECK (id),
    url     text,
    secreto text NOT NULL DEFAULT encode(extensions.gen_random_bytes(24), 'hex')
);
INSERT INTO public.push_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.push_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_config FROM anon, authenticated;

-- Usuarios (auth) que reciben el aviso, con su texto. p_tabla: 'solicitud' | 'ticket'; p_evento: 'nueva' | 'resuelta' | 'estado'.
CREATE OR REPLACE FUNCTION public.fn_push_destinatarios(p_tabla text, p_id bigint, p_evento text)
RETURNS TABLE (auth_user_id uuid, titulo text, cuerpo text, categoria text, categoria_nombre text, url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
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
            RETURN QUERY SELECT t.creado_por_id, format('Ticket #%s: %s', t.id_ticket, t.estado), t.titulo, 'soporte', 'Soporte', '/soporte/tickets';
        END IF;
    END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_push_destinatarios(text, bigint, text) FROM PUBLIC, anon, authenticated;

-- Llama a la Edge Function sin esperar respuesta. Si falta la URL (entorno sin configurar) o algo falla, no hace nada:
-- un aviso al celular nunca debe impedir guardar una solicitud o un ticket.
CREATE OR REPLACE FUNCTION public.fn_push_enviar(p_tabla text, p_id bigint, p_evento text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c push_config;
BEGIN
    SELECT * INTO c FROM push_config WHERE id;
    IF c.url IS NULL THEN RETURN; END IF;
    PERFORM net.http_post(
        url := c.url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', c.secreto),
        body := jsonb_build_object('tabla', p_tabla, 'id', p_id, 'evento', p_evento)
    );
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'push no enviado: %', SQLERRM;
END $$;
REVOKE ALL ON FUNCTION public.fn_push_enviar(text, bigint, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_push_solicitud() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.estado = 'pendiente' THEN
        PERFORM fn_push_enviar('solicitud', NEW.id_solicitud, 'nueva');
    ELSIF TG_OP = 'UPDATE' AND OLD.estado = 'pendiente' AND NEW.estado <> 'pendiente' THEN
        PERFORM fn_push_enviar('solicitud', NEW.id_solicitud, 'resuelta');
    END IF;
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS push_solicitud ON public.solicitud_aprobacion;
CREATE TRIGGER push_solicitud AFTER INSERT OR UPDATE OF estado ON public.solicitud_aprobacion
    FOR EACH ROW EXECUTE FUNCTION public.trg_push_solicitud();

CREATE OR REPLACE FUNCTION public.trg_push_ticket() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM fn_push_enviar('ticket', NEW.id_ticket, 'nueva');
    ELSIF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado THEN
        PERFORM fn_push_enviar('ticket', NEW.id_ticket, 'estado');
    END IF;
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS push_ticket ON public.ticket;
CREATE TRIGGER push_ticket AFTER INSERT OR UPDATE OF estado ON public.ticket
    FOR EACH ROW EXECUTE FUNCTION public.trg_push_ticket();

NOTIFY pgrst, 'reload schema';
