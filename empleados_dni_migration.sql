ALTER TABLE empleados
    ADD COLUMN IF NOT EXISTS dni VARCHAR(15);

NOTIFY pgrst, 'reload schema';
