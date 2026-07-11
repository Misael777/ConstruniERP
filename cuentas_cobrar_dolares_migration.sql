-- Agrega monto_dolares y tipo_cambio a cuentas_cobrar para cuentas en Dólares (USD).
-- Con moneda='USD', el formulario bloquea `monto` y lo calcula solo como monto_dolares × tipo_cambio
-- (ver cuentaCobrar.config.ts, campo `monto`.disabledValue). Con moneda='PEN' estas dos quedan
-- bloqueadas/vacías y `monto` es el campo libre de siempre.
ALTER TABLE cuentas_cobrar ADD COLUMN IF NOT EXISTS monto_dolares NUMERIC;
ALTER TABLE cuentas_cobrar ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(12,2); -- parte entera + hasta 2 decimales

NOTIFY pgrst, 'reload schema';
