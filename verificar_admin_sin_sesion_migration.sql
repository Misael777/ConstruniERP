-- ============================================================
-- MIGRACIÓN: Verificar credenciales de administrador SIN iniciar sesión real
-- ============================================================
-- Bug reportado por el usuario: al confirmar cualquier acción que pide contraseña de administrador
-- (ej. eliminar una transacción) y presionar Enter, la app lo saca del ERP (a /login) sin llegar a
-- ejecutar la acción.
--
-- Causa: verifyAdminCredentials (adminAuth.ts) llamaba a supabase.auth.signInWithPassword en un
-- cliente Supabase APARTE (con persistSession apagado) para "no pisar la sesión real ya logueada".
-- Eso aísla el ESTADO LOCAL (localStorage/BroadcastChannel), pero si el proyecto de Supabase tiene
-- habilitado "Single session per user" en la configuración de Auth, ese signInWithPassword invalida
-- del lado del SERVIDOR cualquier OTRA sesión activa del MISMO usuario — sin importar en qué cliente
-- se hizo el login original. Como quien confirma la acción suele ser el propio admin usando SU
-- cuenta, esto revocaba la sesión real de la app: el siguiente refresco de token fallaba, supabase-js
-- emitía SIGNED_OUT, y el layout ((app)/+layout.svelte, líneas 61-66) redirigía a /login.
--
-- Fix: esta función verifica el correo/contraseña DIRECTO contra auth.users con pgcrypto (mismo hash
-- que usa Supabase Auth internamente), sin pasar nunca por signInWithPassword — no crea ni toca
-- ninguna sesión, así que no puede revocar nada sin importar la configuración de Auth del proyecto.
-- Idempotente: CREATE OR REPLACE, se puede correr más de una vez.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_verificar_credenciales_admin(p_email TEXT, p_password TEXT)
RETURNS TABLE(es_valido BOOLEAN, es_admin BOOLEAN, mensaje TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE
    v_user_id UUID;
    v_rol_nombre TEXT;
BEGIN
    -- crypt(password, encrypted_password) recalcula el hash bcrypt con la MISMA sal ya guardada —
    -- si coincide, la contraseña es correcta. Mismo mecanismo que usa Supabase Auth por dentro.
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

    -- 'administrador' debe coincidir exactamente con ADMIN_ROLE en app/src/lib/config/modules.ts.
    IF v_rol_nombre <> 'administrador' THEN
        RETURN QUERY SELECT true, false, 'Esa cuenta no tiene permisos de administrador.'::TEXT;
        RETURN;
    END IF;

    RETURN QUERY SELECT true, true, 'Identidad de administrador verificada.'::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_verificar_credenciales_admin(TEXT, TEXT) TO anon, authenticated;

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
