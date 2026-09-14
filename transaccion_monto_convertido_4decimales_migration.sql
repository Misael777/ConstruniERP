-- ----------------------------------------------------------------------------
-- Ensancha transaccion.monto_convertido de NUMERIC(14,2) a NUMERIC(14,4) — a
-- pedido explícito del usuario, "Monto Convertido" (Monto × Tipo de Cambio) se
-- muestra con 4 decimales, no 2. Sin este cambio, la columna redondearía a 2
-- decimales al guardar y se perdería la precisión que ya se calcula/muestra en
-- el formulario (ver el $effect en TransaccionModal.svelte).
--
-- Ya corriste transaccion_moneda_migration.sql (que creó esta columna en
-- NUMERIC(14,2)) — este archivo solo la ensancha, no toca ninguna fila
-- existente.
-- ----------------------------------------------------------------------------

ALTER TABLE transaccion ALTER COLUMN monto_convertido TYPE NUMERIC(14,4);
