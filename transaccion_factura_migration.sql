-- ============================================================
-- MIGRACIÓN: Factura o boleta de venta (imagen/PDF) — adjunto SEPARADO del
-- comprobante de pago. A pedido del usuario, el nuevo diseño de "Nueva
-- Transacción" tiene DOS cajas de carga: "Adjuntar boucher de pago"
-- (comprobante_url, obligatorio) y "Adjuntar factura o boleta de venta"
-- (factura_url, opcional, dentro de "Otros campos") — ver TransaccionModal.svelte.
-- Idempotente: usa ALTER TABLE … ADD COLUMN IF NOT EXISTS
-- ============================================================

ALTER TABLE transaccion
    ADD COLUMN IF NOT EXISTS factura_url TEXT;

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
