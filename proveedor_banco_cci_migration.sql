-- ============================================================
-- MIGRACIÓN: proveedor.banco / proveedor.cci
-- A pedido explícito del usuario: además del número de cuenta bancaria
-- (proveedor.cuenta_banco, ver proveedor_cuenta_banco_migration.sql), el
-- popup de Nuevo/Editar Proveedor necesita indicar A QUÉ BANCO corresponde
-- esa cuenta, y el CCI (Código de Cuenta Interbancario) para transferencias
-- entre bancos distintos. Texto libre en ambos, mismo criterio que
-- cuenta_banco (el formato de CCI varía y no aporta validarlo acá).
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

ALTER TABLE proveedor
    ADD COLUMN IF NOT EXISTS banco VARCHAR(100),
    ADD COLUMN IF NOT EXISTS cci VARCHAR(30);

NOTIFY pgrst, 'reload schema';
