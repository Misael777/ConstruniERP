-- ============================================================
-- RPC FUNCTIONS FOR IAM & AUTHENTICATION (TAURI EXE COMPATIBILITY)
-- Ejecutar este script en el SQL Editor de Supabase
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. FUNCIÓN PARA CREAR EMPLEADO Y USUARIO EN AUTH
CREATE OR REPLACE FUNCTION public.crear_usuario_empleado(
  p_nombre text,
  p_correo text,
  p_telefono text,
  p_rol_id int,
  p_area_id int,
  p_fecha_ingreso date,
  p_salario numeric,
  p_horas numeric,
  p_periodo text,
  p_nivel text
)
RETURNS json
SECURITY DEFINER
AS $$
DECLARE
  emp_record json;
  clean_email text := lower(trim(p_correo));
BEGIN
  -- Validar permisos de administrador
  IF NOT public.is_admin() THEN
    RETURN json_build_object('success', false, 'error', 'No autorizado: Se requiere rol de administrador.');
  END IF;

  -- Este RPC ya no maneja directamente auth.users / auth.identities.
  -- Use /api/create-employee-user para crear el usuario en Supabase Auth de forma segura.
  IF EXISTS (SELECT 1 FROM public.empleados WHERE lower(correo) = clean_email) THEN
    RETURN json_build_object('success', false, 'error', 'El correo electrónico ya está registrado en empleados.');
  END IF;

  INSERT INTO public.empleados (
    nombre,
    correo,
    telefono,
    rol_id,
    area_id,
    fecha_ingreso,
    salario,
    horas,
    periodo,
    nivel
  ) VALUES (
    p_nombre,
    clean_email,
    p_telefono,
    p_rol_id,
    p_area_id,
    p_fecha_ingreso,
    p_salario,
    p_horas,
    p_periodo,
    p_nivel
  )
  RETURNING json_build_object(
    'id', id,
    'nombre', nombre,
    'telefono', telefono,
    'correo', correo,
    'rol_id', rol_id,
    'auth_user_id', auth_user_id
  ) INTO emp_record;

  RETURN json_build_object('success', true, 'empleado', emp_record);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

-- 2. FUNCIÓN PARA ACTUALIZAR EMPLEADO Y USUARIO EN AUTH
CREATE OR REPLACE FUNCTION public.actualizar_usuario_empleado(
  p_id int,
  p_auth_user_id uuid,
  p_nombre text,
  p_correo text,
  p_telefono text,
  p_rol_id int,
  p_area_id int,
  p_fecha_ingreso date,
  p_salario numeric,
  p_horas numeric,
  p_periodo text,
  p_nivel text
)
RETURNS json
SECURITY DEFINER
AS $$
DECLARE
  emp_record json;
  clean_email text := lower(trim(p_correo));
BEGIN
  -- Validar permisos de administrador
  IF NOT public.is_admin() THEN
    RETURN json_build_object('success', false, 'error', 'No autorizado: Se requiere rol de administrador.');
  END IF;

  -- Este RPC ya no actualiza directamente auth.users / auth.identities.
  -- Use /api/update-employee-user para sincronizar el correo y metadata en Supabase Auth.
  UPDATE public.empleados
  SET
    nombre = p_nombre,
    correo = clean_email,
    telefono = p_telefono,
    rol_id = p_rol_id,
    area_id = p_area_id,
    fecha_ingreso = p_fecha_ingreso,
    salario = p_salario,
    horas = p_horas,
    periodo = p_periodo,
    nivel = p_nivel
  WHERE id = p_id
  RETURNING json_build_object(
    'id', id,
    'nombre', nombre,
    'telefono', telefono,
    'correo', correo,
    'rol_id', rol_id,
    'auth_user_id', auth_user_id,
    'area_id', area_id,
    'fecha_ingreso', fecha_ingreso,
    'salario', salario,
    'horas', horas,
    'periodo', periodo,
    'nivel', nivel
  ) INTO emp_record;

  RETURN json_build_object('success', true, 'empleado', emp_record);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

-- 3. FUNCIÓN PARA ELIMINAR EMPLEADO Y SU USUARIO DE AUTH
CREATE OR REPLACE FUNCTION public.eliminar_usuario_empleado(
  p_id int
)
RETURNS json
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('success', false, 'error', 'No autorizado: Se requiere rol de administrador.');
  END IF;

  -- Esta función solo elimina el registro local de empleado.
  -- Para eliminar el usuario de Supabase Auth, use /api/delete-employee-user.
  DELETE FROM public.empleados WHERE id = p_id;

  RETURN json_build_object('success', true, 'empleado_id', p_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

-- 4. FUNCIÓN PARA CONFIGURAR O RESTABLECER CONTRASEÑA DE UN EMPLEADO
CREATE OR REPLACE FUNCTION public.configurar_contrasena_empleado(
  p_email text,
  p_password text,
  p_type text
)
RETURNS json
SECURITY DEFINER
AS $$
BEGIN
  RETURN json_build_object(
    'success', false,
    'error', 'Direct password configuration via SQL function is deprecated. Use /api/setup-password with the Supabase Admin API instead.'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;
