-- ============================================================
-- MIGRACIÓN: cuentas_pagar.frecuencia_pago
-- Periodicidad del pago (a pedido del usuario: se pide en el formulario de Nueva/Editar Cuenta por
-- Pagar, justo después de "Forma de Pago"). Texto libre con los 4 valores fijos que ofrece el
-- formulario — sin tabla de catálogo aparte, mismo criterio que el resto de los select de texto de
-- esta tabla (ej. `estado`).
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

ALTER TABLE cuentas_pagar
    ADD COLUMN IF NOT EXISTS frecuencia_pago VARCHAR(20) NOT NULL DEFAULT 'sin_periodicidad';

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'cuentas_pagar'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%frecuencia_pago%'
    LOOP
        EXECUTE format('ALTER TABLE cuentas_pagar DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE cuentas_pagar
    ADD CONSTRAINT cuentas_pagar_frecuencia_pago_check
    CHECK (frecuencia_pago IN ('sin_periodicidad', 'mensual', 'quincenal', 'semanal'));

NOTIFY pgrst, 'reload schema';
