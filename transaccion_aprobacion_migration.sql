-- ============================================================
-- MIGRACIÓN: Aprobación de comprobante por administrador
-- Una vez aprobada, la transacción (y la cuenta por pagar/cobrar,
-- y el cobro/pago vinculados) quedan bloqueados para edición/borrado
-- excepto por un administrador — ver transacciones.service.ts,
-- cuentasCobrar.service.ts, cuentasPagar.service.ts.
-- Idempotente: usa ALTER TABLE … ADD COLUMN IF NOT EXISTS
-- ============================================================

ALTER TABLE transaccion
    ADD COLUMN IF NOT EXISTS aprobado     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS aprobado_por VARCHAR(100),
    ADD COLUMN IF NOT EXISTS aprobado_en  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_transaccion_aprobado ON transaccion(aprobado);

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
