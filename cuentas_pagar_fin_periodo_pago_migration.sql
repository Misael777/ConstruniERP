-- ============================================================
-- MIGRACIÓN: cuentas_pagar.fin_periodo_pago
-- Fecha de fin del periodo de pago (a pedido del usuario: se pide en el formulario de Nueva/Editar
-- Cuenta por Pagar, junto a "Frecuencia de Pago" — solo tiene sentido si la cuenta es recurrente, se
-- deshabilita cuando frecuencia_pago='sin_periodicidad', ver cuentaPagar.config.ts).
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

ALTER TABLE cuentas_pagar
    ADD COLUMN IF NOT EXISTS fin_periodo_pago DATE;

NOTIFY pgrst, 'reload schema';
