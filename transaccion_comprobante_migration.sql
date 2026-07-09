-- ============================================================
-- MIGRACIÓN: Comprobante (imagen/PDF) obligatorio por transacción
-- Cada fila de `transaccion` debe tener su comprobante de respaldo
-- subido a Google Drive — ver TransaccionModal.svelte / transacciones.service.ts.
-- Idempotente: usa ALTER TABLE … ADD COLUMN IF NOT EXISTS
-- ============================================================

ALTER TABLE transaccion
    ADD COLUMN IF NOT EXISTS comprobante_url TEXT;

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
