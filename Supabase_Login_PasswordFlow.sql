-- ============================================================
-- MIGRACIÓN: Agregar campo password_creada a la tabla empleados
-- Ejecutar en el SQL Editor de Supabase
-- ============================================================

ALTER TABLE empleados
    ADD COLUMN IF NOT EXISTS password_creada BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN empleados.password_creada IS 
    'Indica si el empleado ya configuró su contraseña de acceso al sistema.';
