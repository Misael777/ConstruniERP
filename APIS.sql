-- ============================================================
-- APIS SQL Metadata
-- Este script crea una tabla de metadatos de APIs y almacena
-- los endpoints definidos para la gestión de usuarios Auth de Supabase.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.apis (
  id serial PRIMARY KEY,
  name text NOT NULL,
  method text NOT NULL,
  route text NOT NULL,
  description text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.refresh_api_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS apis_update_timestamp ON public.apis;
CREATE TRIGGER apis_update_timestamp
BEFORE UPDATE ON public.apis
FOR EACH ROW
EXECUTE FUNCTION public.refresh_api_updated_at();

INSERT INTO public.apis (name, method, route, description)
VALUES
  ('List users', 'GET', '/functions/v1/user-admin', 'Lista todos los usuarios de Supabase Auth y sus registros de empleados.'),
  ('Get user', 'GET', '/functions/v1/user-admin?id=<auth_user_id>', 'Obtiene un usuario Auth por auth_user_id y su registro de empleado asociado.'),
  ('Create user', 'POST', '/functions/v1/user-admin', 'Crea un usuario en Supabase Auth y un registro de empleado asociado en public.empleados.'),
  ('Update user', 'PUT', '/functions/v1/user-admin', 'Actualiza la información del usuario Auth y su registro en public.empleados.'),
  ('Delete user', 'DELETE', '/functions/v1/user-admin', 'Elimina el usuario de Supabase Auth y el registro asociado en public.empleados.'),
  ('Reset password', 'POST', '/functions/v1/user-admin?action=reset-password', 'Actualiza la contraseña de un usuario Auth mediante la API de administración.');
