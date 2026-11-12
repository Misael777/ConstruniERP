-- Hallado por la suite de punta a punta de Control Financiero (12/11/2026, scripts/tests-negocio-control-financiero.mjs):
-- `cobros.cuenta_banco` era VARCHAR(20) pero `cuenta_banco.numero_cuenta` es VARCHAR(30). Registrar el cobro de una
-- Cuenta por Cobrar hacia una cuenta con número largo fallaba con "value too long for type character varying(20)"
-- — en Producción, "EFECTIVO - CAJA FUERTE S/" (25) y "EFECTIVO - CAJA FUERTE $" (24) no podían recibir cobros.
-- Mismo problema con el N° de operación: transaccion.num_operacion es VARCHAR(30) y cobros/pagos lo copiaban en
-- columnas de 20.
-- Solo AMPLÍA columnas (no cambia ni borra ningún dato; en Postgres ampliar un varchar no reescribe la tabla).
ALTER TABLE public.cobros ALTER COLUMN cuenta_banco TYPE varchar(30);
ALTER TABLE public.cobros ALTER COLUMN num_operacion TYPE varchar(30);
ALTER TABLE public.cobros ALTER COLUMN numero_opracion TYPE varchar(30);
ALTER TABLE public.pagos ALTER COLUMN num_operacion TYPE varchar(30);

NOTIFY pgrst, 'reload schema';
