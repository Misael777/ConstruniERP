-- Agrega la columna 'prioridad' a cuentas_cobrar ('alto' | 'medio' | 'bajo', ver cuentaCobrar.config.ts).
ALTER TABLE cuentas_cobrar ADD COLUMN IF NOT EXISTS prioridad VARCHAR(10);

NOTIFY pgrst, 'reload schema';
