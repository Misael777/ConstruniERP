-- ============================================================
-- MIGRACIÓN: proveedor.cuenta_banco
-- Número de cuenta bancaria del proveedor (a pedido del usuario: se solicita
-- en los popups de Nuevo/Editar Proveedor). Texto libre porque el formato
-- varía por banco (cuenta simple, CCI, etc.) — sin CHECK de longitud/formato.
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

ALTER TABLE proveedor
    ADD COLUMN IF NOT EXISTS cuenta_banco VARCHAR(50);

NOTIFY pgrst, 'reload schema';
