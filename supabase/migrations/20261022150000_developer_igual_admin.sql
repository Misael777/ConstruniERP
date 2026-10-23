-- A pedido del usuario (22/10/2026): el rol "developer" tiene automáticamente los mismos permisos que el
-- administrador. En la base eso es is_admin() (lo usan tiene_permiso() y las políticas RLS) y la verificación de
-- contraseña de administrador (borrados permanentes, etc.). En la app, ver ROLES_ADMIN en config/modules.ts.
-- Idempotente.

-- El rol existe en Prod (id 12); en Dev u otra base nueva se crea.
INSERT INTO public.roles (nombre, descripcion)
SELECT 'developer', 'Desarrollador del ERP: mismos permisos que el administrador'
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE nombre = 'developer');

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM empleados e JOIN roles r ON e.rol_id = r.id
        WHERE e.auth_user_id = auth.uid() AND r.nombre IN ('administrador', 'developer')
    );
$$;

CREATE OR REPLACE FUNCTION public.fn_verificar_credenciales_admin(p_email text, p_password text)
 RETURNS TABLE(es_valido boolean, es_admin boolean, mensaje text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'auth'
AS $function$
DECLARE
    v_user_id UUID;
    v_rol_nombre TEXT;
BEGIN
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE lower(email) = lower(p_email)
      AND encrypted_password IS NOT NULL
      AND encrypted_password = crypt(p_password, encrypted_password)
    LIMIT 1;

    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, false, 'Correo o contraseña incorrectos.'::TEXT;
        RETURN;
    END IF;

    SELECT r.nombre INTO v_rol_nombre
    FROM empleados e
    JOIN roles r ON r.id = e.rol_id
    WHERE e.auth_user_id = v_user_id
    LIMIT 1;

    IF v_rol_nombre IS NULL THEN
        RETURN QUERY SELECT true, false, 'No se encontró un empleado vinculado a esa cuenta.'::TEXT;
        RETURN;
    END IF;

    IF v_rol_nombre NOT IN ('administrador', 'developer') THEN
        RETURN QUERY SELECT true, false, 'Esa cuenta no tiene permisos de administrador.'::TEXT;
        RETURN;
    END IF;

    RETURN QUERY SELECT true, true, 'Identidad de administrador verificada.'::TEXT;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_verificar_credenciales_admin(TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
