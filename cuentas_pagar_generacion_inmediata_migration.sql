-- ============================================================
-- MIGRACIÓN: cuentas por pagar recurrentes — generación INMEDIATA en vez de cron
-- Aclaración explícita del usuario sobre el diseño anterior (cuentas_pagar_recurrencia_mensual_migration.sql
-- y cuentas_pagar_recurrencia_todas_frecuencias_migration.sql):
--   1. "Frecuencia de Pago" NO divide el Monto Comprometido entre las cuotas — cada cuenta generada
--      conserva el monto íntegro (ej. Internet S/180 mensual -> 12 cuentas de S/180, no 12 de S/15).
--   2. Como "Fin de Periodo de Pago" ya delimita el rango completo desde que se crea la cuenta, el ERP
--      debe generar TODAS las cuentas de la serie de una sola vez al guardar "Nueva Cuenta por Pagar"
--      (con vista previa antes de confirmar) — no esperar día a día a que cada fecha vaya llegando vía
--      un cron en el servidor.
--   3. "Frecuencia de Pago" ahora incluye también 'contado' (además de sin_periodicidad/mensual/
--      quincenal/semanal) — mismo comportamiento que 'sin_periodicidad': una sola cuenta, sin serie.
--
-- Esto vuelve innecesario el cron que agregaron las dos migraciones de arriba — se retira acá para no
-- dejar dos mecanismos de generación divergentes (uno en Postgres vía pg_cron, otro client-side al
-- crear la cuenta). Las columnas que esas migraciones agregaron (id_cuenta_pagar_padre) SIGUEN en uso:
-- la generación inmediata del cliente las usa igual para encadenar cada cuenta generada con la
-- anterior de su serie (ver createCuentasPagarRecurrentes en cuentasPagar.service.ts).
--
-- Requiere haber corrido antes cuentas_pagar_frecuencia_pago_migration.sql. Es seguro correr esta
-- migración aunque las de pg_cron nunca se hayan corrido (el DO $$ atrapa el error si el cron job no
-- existía, DROP FUNCTION usa IF EXISTS).
--
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

-- 1. Agrega 'contado' a los valores válidos de frecuencia_pago.
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
    CHECK (frecuencia_pago IN ('sin_periodicidad', 'contado', 'mensual', 'quincenal', 'semanal'));

-- 2. Retira el cron de generación recurrente — reemplazado por generación inmediata client-side.
DO $$
BEGIN
    PERFORM cron.unschedule('generar-cuentas-pagar-recurrentes');
EXCEPTION WHEN OTHERS THEN
    NULL; -- no existía (pg_cron nunca se activó, o esta migración ya se corrió antes) — no es un error
END $$;

DROP FUNCTION IF EXISTS generar_cuentas_pagar_recurrentes();

NOTIFY pgrst, 'reload schema';
