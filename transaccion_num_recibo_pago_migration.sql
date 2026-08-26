ALTER TABLE transaccion
    ADD COLUMN IF NOT EXISTS num_recibo_pago INTEGER;

CREATE INDEX IF NOT EXISTS idx_transaccion_num_recibo_pago
    ON transaccion (num_recibo_pago);

NOTIFY pgrst, 'reload schema';
