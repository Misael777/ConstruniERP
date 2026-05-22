-- ============================================================
-- MIGRACIÓN: Agregar campo correo a la tabla empleados
-- Ejecutar en el SQL Editor de Supabase
-- ============================================================

-- 1. Agregar columna correo a empleados
ALTER TABLE empleados
    ADD COLUMN IF NOT EXISTS correo VARCHAR(255) UNIQUE;

-- Comentario descriptivo
COMMENT ON COLUMN empleados.correo IS 'Correo electrónico del empleado, vinculado al usuario de Supabase Auth';
