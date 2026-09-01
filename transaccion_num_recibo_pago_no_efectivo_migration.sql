-- El "RECIBO DE PAGO" en Efectivo y el "RECIBO DE PAGO" NO Efectivo (Transferencia/Depósito/Yape o
-- Plin/Otros) son dos recibos DIFERENTES (distinto color de fondo, ver reciboPagoEfectivo.ts) — a
-- pedido explícito del usuario, cada uno lleva su propia numeración serial independiente, no comparten
-- el mismo correlativo. Este es el mismo tipo de migración simple (ALTER TABLE ADD COLUMN) que ya
-- funcionó de forma confiable toda la sesión para num_comprobante_interno/num_recibo_pago/dni, a
-- diferencia de los intentos con función/tabla nueva que no llegaron a aplicarse.
ALTER TABLE transaccion
    ADD COLUMN IF NOT EXISTS num_recibo_pago_no_efectivo INTEGER;

CREATE INDEX IF NOT EXISTS idx_transaccion_num_recibo_pago_no_efectivo
    ON transaccion (num_recibo_pago_no_efectivo);

NOTIFY pgrst, 'reload schema';
