-- ============================================================
-- MIGRACIÓN: N° de comprobante de transferencia interna
-- A pedido explícito del usuario: al crear (o editar) una transacción Interna, el sistema emite un PDF
-- "RECIBO - TRANSFERENCIA INTERNA" con un correlativo propio (N° 0000306, etc.), independiente del
-- id_transaccion interno. Este número se asigna UNA sola vez al crearse (no cambia si se edita después,
-- igual que un comprobante contable real) — se guarda acá para poder reimprimir el mismo PDF con el
-- mismo número si se vuelve a editar/guardar esa transacción.
-- Idempotente: usa ADD COLUMN IF NOT EXISTS.
-- ============================================================

ALTER TABLE transaccion
    ADD COLUMN IF NOT EXISTS num_comprobante_interno INTEGER;

CREATE INDEX IF NOT EXISTS idx_transaccion_num_comprobante_interno
    ON transaccion (num_comprobante_interno);

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
