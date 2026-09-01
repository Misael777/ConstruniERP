-- El "RECIBO DE PAGO A PROVEEDOR" (Externa + Egreso + Efectivo, ver reciboPagoProveedor.ts) es un
-- documento DIFERENTE del "RECIBO DE PAGO" (Externa + Ingreso, ver reciboPagoEfectivo.ts) y del "RECIBO
-- DE PAGO" NO Efectivo — a pedido explícito del usuario, cada uno lleva su propia numeración serial
-- independiente. Mismo tipo de migración simple (ALTER TABLE ADD COLUMN) que ya funcionó de forma
-- confiable toda la sesión para num_comprobante_interno/num_recibo_pago/num_recibo_pago_no_efectivo/dni.
ALTER TABLE transaccion
    ADD COLUMN IF NOT EXISTS num_recibo_pago_proveedor INTEGER;

CREATE INDEX IF NOT EXISTS idx_transaccion_num_recibo_pago_proveedor
    ON transaccion (num_recibo_pago_proveedor);

NOTIFY pgrst, 'reload schema';
