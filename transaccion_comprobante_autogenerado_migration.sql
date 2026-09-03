-- ============================================================
-- MIGRACIÓN: Comprobante autogenerado por el ERP (columna separada)
-- A pedido explícito del usuario: el PDF que el propio sistema autogenera (Boucher de Transferencia
-- Interna / Recibo de Pago / Recibo de Pago a Proveedor) NO es lo mismo que el comprobante que el
-- usuario sube a mano en "Adjuntar boucher de pago" (columna comprobante_url) ni un documento de
-- terceros de "Comprobantes de pago" — antes se guardaba reusando comprobante_url, lo que pisaba/
-- borraba el boucher que el usuario ya había subido. Ahora vive en su propio campo, independiente.
-- Idempotente: usa ADD COLUMN IF NOT EXISTS.
-- ============================================================

ALTER TABLE transaccion
    ADD COLUMN IF NOT EXISTS comprobante_autogenerado_url TEXT;

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
