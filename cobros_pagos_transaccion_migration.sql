-- ============================================================
-- MIGRACIÓN: Enlazar cobros/pagos con su transacción de respaldo
-- Un cobro no puede quedar 'cobrado' (ni un pago 'pagado') sin una
-- transacción real que lo respalde — ver cuentasCobrar.service.ts /
-- cuentasPagar.service.ts (createCobro/createPago, confirmarCobroCobrado/
-- confirmarPagoPagado).
-- Idempotente: usa ALTER TABLE … ADD COLUMN IF NOT EXISTS
-- ============================================================

ALTER TABLE cobros
    ADD COLUMN IF NOT EXISTS id_transaccion BIGINT REFERENCES transaccion(id_transaccion) ON DELETE SET NULL;

ALTER TABLE pagos
    ADD COLUMN IF NOT EXISTS id_transaccion BIGINT REFERENCES transaccion(id_transaccion) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cobros_id_transaccion ON cobros(id_transaccion);
CREATE INDEX IF NOT EXISTS idx_pagos_id_transaccion  ON pagos(id_transaccion);

-- Fuerza a PostgREST a recargar el schema cache de inmediato (si no, tarda unos segundos en notarlo).
NOTIFY pgrst, 'reload schema';