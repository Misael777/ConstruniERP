-- Agrega la columna 'prioridad' a cuentas_pagar ('alto' | 'media' | 'bajo', ver cuentaPagar.config.ts).
ALTER TABLE cuentas_pagar ADD COLUMN IF NOT EXISTS prioridad VARCHAR(10);

NOTIFY pgrst, 'reload schema';
