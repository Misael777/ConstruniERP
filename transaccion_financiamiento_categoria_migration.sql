-- 1. Agrega 'financiamiento' como tercer tipo válido de transaccion.tipo (además de
--    'ingreso'/'egreso'). Mismo patrón dinámico que las migraciones anteriores de este ERP: no
--    asume el nombre exacto del constraint (aunque hoy se llama transaccion_tipo_check).
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'transaccion'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%tipo%'
          AND pg_get_constraintdef(oid) ILIKE '%ingreso%'
    LOOP
        EXECUTE format('ALTER TABLE transaccion DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE transaccion
    ADD CONSTRAINT transaccion_tipo_check
    CHECK (tipo IN ('ingreso', 'egreso', 'financiamiento'));

-- 2. Agrega la columna `categoria` (texto libre, sin CHECK real — mismo criterio que `estado`:
--    las opciones del dropdown son solo convención del ERP, ver transaccion.config.ts).
ALTER TABLE transaccion ADD COLUMN IF NOT EXISTS categoria VARCHAR(50);

NOTIFY pgrst, 'reload schema';
