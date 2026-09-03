-- Saldo Inicial / Saldo Actual de cada cuenta bancaria — a pedido explícito del usuario. Mismo tipo de
-- migración simple (ALTER TABLE ADD COLUMN) que ya funcionó de forma confiable toda la sesión.
-- NOT NULL DEFAULT 0: las cuentas ya existentes (nunca modificadas) arrancan en 0.00 / 0.00.
ALTER TABLE cuenta_banco
    ADD COLUMN IF NOT EXISTS saldo_inicial NUMERIC(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS saldo_actual NUMERIC(14,2) NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
