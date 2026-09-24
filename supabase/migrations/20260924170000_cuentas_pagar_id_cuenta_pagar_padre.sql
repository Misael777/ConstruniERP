-- Fix H2 (ver Documentacion/tests/cuentas-pagar.md, caso P-15): la columna id_cuenta_pagar_padre nunca
-- existió en Producción — su migración original (cuentas_pagar_recurrencia_mensual_migration.sql) no se
-- aplicó — pero createCuentasPagarRecurrentes (cuentasPagar.service.ts) la usa para encadenar las cuentas
-- de una serie por "Frecuencia de Pago" y IGNORA el error del UPDATE, así que la serie se creaba sin
-- encadenar en silencio.
--
-- Solo se agrega la columna y su índice. El cron pg_cron de esa migración original fue retirado a propósito
-- (ver cuentas_pagar_generacion_inmediata_migration.sql) y NO se recrea acá.
-- Idempotente: no toca ninguna fila existente.

ALTER TABLE cuentas_pagar
    ADD COLUMN IF NOT EXISTS id_cuenta_pagar_padre BIGINT REFERENCES cuentas_pagar(id_cuenta_pagar) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cuentas_pagar_padre
    ON cuentas_pagar(id_cuenta_pagar_padre) WHERE id_cuenta_pagar_padre IS NOT NULL;

NOTIFY pgrst, 'reload schema';
