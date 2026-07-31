-- ============================================================
-- MIGRACIÓN: centro_costo.descripcion
-- Campo de texto libre opcional para el detalle de un centro de costo
-- (a pedido del usuario: el panel de detalle que se abre al hacer clic
-- en un centro de costo debe mostrar su descripción además de la
-- entidad a la que está vinculado).
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

ALTER TABLE centro_costo
    ADD COLUMN IF NOT EXISTS descripcion TEXT;

NOTIFY pgrst, 'reload schema';
