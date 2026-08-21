-- ============================================================
-- MIGRACIÓN: Número de Operación en Transacciones — a pedido del usuario, se
-- lee automáticamente del boucher/comprobante vía OCR (ver ocr-comprobante
-- Edge Function) igual que ya se hace con Fecha/Monto, y se muestra como
-- tercer campo "reconocido" junto a esos dos en TransaccionModal.svelte.
-- Idempotente: usa ALTER TABLE … ADD COLUMN IF NOT EXISTS
-- ============================================================

ALTER TABLE transaccion
    ADD COLUMN IF NOT EXISTS num_operacion VARCHAR(30);

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
