-- ============================================================
-- MIGRACIÓN: generación automática de cuentas por pagar RECURRENTES mensuales
-- A pedido del usuario: si frecuencia_pago='mensual', cada mes debe generarse sola una nueva cuenta
-- por pagar con los mismos datos que la anterior — solo cambian las fechas (mes, y año cuando
-- corresponda). Esta app es 100% client-side (sin servidor propio corriendo todo el tiempo), así que
-- la única forma de que esto pase SIN que alguien tenga que abrir la app ese día es un cron real del
-- lado de Supabase (pg_cron) — a pedido explícito del usuario, no el patrón "corregir al abrir la
-- app" que ya usa autoCorregirVencidos en cuentasPagar.service.ts.
--
-- OJO — pg_cron requiere un plan de Supabase que lo soporte (no está disponible en todos los planes
-- Free) y que actives la extensión desde el dashboard del proyecto (Database > Extensions > pg_cron)
-- ANTES de correr este archivo, o el primer CREATE EXTENSION de abajo puede fallar por permisos según
-- el plan. Si tu proyecto no lo soporta, esta migración deja la función y las columnas creadas igual
-- (útiles para disparar la generación manualmente o desde una Edge Function programada aparte) — solo
-- el `cron.schedule` final no se aplicaría.
--
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Encadena cada cuenta generada automáticamente con la cuenta de la que salió (la del mes anterior).
-- NULL = cuenta creada a mano (por el usuario) o la primera de una cadena recurrente. El índice único
-- parcial evita que la misma cuenta "padre" genere dos hijas (protección extra ante una corrida doble
-- del cron, además del NOT EXISTS de la función de abajo).
ALTER TABLE cuentas_pagar
    ADD COLUMN IF NOT EXISTS id_cuenta_pagar_padre BIGINT REFERENCES cuentas_pagar(id_cuenta_pagar) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cuentas_pagar_padre
    ON cuentas_pagar(id_cuenta_pagar_padre) WHERE id_cuenta_pagar_padre IS NOT NULL;

-- Genera la siguiente cuenta por pagar de cada cadena "mensual" que ya le toque — busca las cuentas
-- CABEZA de cadena (frecuencia_pago='mensual', activas, sin ninguna hija todavía) cuyo fecha_emision +
-- 1 mes ya llegó o pasó, y les crea la siguiente. Copia TODOS los campos de la cuenta original salvo:
--   - Las tres fechas (fecha_emision/fecha_vencimiento/fecha_pago_programada), que se corren +1 mes
--     cada una (Postgres ajusta solo días/meses que no existen, ej. 31 ene -> 28/29 feb, y el año
--     cuando el mes cruza a enero — a pedido explícito del usuario).
--   - monto_pagado/saldo_pendiente/estado: la cuenta nueva arranca sin pagos (monto_pagado=0,
--     saldo_pendiente=monto_comprometido, estado recalculado con las fechas nuevas) — copiar el estado
--     de pagos de la cuenta anterior tal cual la dejaría marcada como ya pagada/vencida por error.
-- No duplica las cuotas (`pagos`) de la cuenta original si estaba fraccionada — solo la cuenta madre;
-- si hace falta fraccionamiento, se configura a mano en la cuenta recién generada.
CREATE OR REPLACE FUNCTION generar_cuentas_pagar_recurrentes()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    r RECORD;
    nueva_fecha_emision DATE;
    nueva_fecha_vencimiento DATE;
    nueva_fecha_pago_programada DATE;
    estado_calculado VARCHAR(10);
BEGIN
    FOR r IN
        SELECT cp.*
        FROM cuentas_pagar cp
        WHERE cp.frecuencia_pago = 'mensual'
          AND cp.activo = true
          AND CURRENT_DATE >= (cp.fecha_emision + INTERVAL '1 month')::date
          AND NOT EXISTS (
              SELECT 1 FROM cuentas_pagar hijo WHERE hijo.id_cuenta_pagar_padre = cp.id_cuenta_pagar
          )
    LOOP
        nueva_fecha_emision := (r.fecha_emision + INTERVAL '1 month')::date;
        nueva_fecha_vencimiento := CASE WHEN r.fecha_vencimiento IS NOT NULL THEN (r.fecha_vencimiento + INTERVAL '1 month')::date ELSE NULL END;
        nueva_fecha_pago_programada := CASE WHEN r.fecha_pago_programada IS NOT NULL THEN (r.fecha_pago_programada + INTERVAL '1 month')::date ELSE NULL END;

        -- Mismo criterio que computeEstadoCuentaPagar (cuentasPagar.service.ts): con monto_pagado=0
        -- nunca puede nacer 'pagado'; 'vencido' si la fecha a evaluar (pago programada, o vencimiento
        -- como respaldo) ya pasó, si no 'pendiente'.
        estado_calculado := CASE
            WHEN COALESCE(nueva_fecha_pago_programada, nueva_fecha_vencimiento) < CURRENT_DATE THEN 'vencido'
            ELSE 'pendiente'
        END;

        INSERT INTO cuentas_pagar (
            id_proveedor, id_centro_costo, id_presupuesto, id_partida,
            tipo_documento, num_documento, monto_comprometido, monto_pagado, saldo_pendiente,
            fotma_pago, frecuencia_pago, categoria_gasto, condicion_pago, responsable,
            fecha_emision, fecha_vencimiento, fecha_pago_programada,
            monto_imponible, monto_igv, detraccion, monto_retencion,
            estado, observacion, prioridad, usuario_registro, activo,
            id_cuenta_pagar_padre
        ) VALUES (
            r.id_proveedor, r.id_centro_costo, r.id_presupuesto, r.id_partida,
            r.tipo_documento, r.num_documento, r.monto_comprometido, 0, r.monto_comprometido,
            r.fotma_pago, r.frecuencia_pago, r.categoria_gasto, r.condicion_pago, r.responsable,
            nueva_fecha_emision, nueva_fecha_vencimiento, nueva_fecha_pago_programada,
            r.monto_imponible, r.monto_igv, r.detraccion, r.monto_retencion,
            estado_calculado, r.observacion, r.prioridad, r.usuario_registro, true,
            r.id_cuenta_pagar
        );
    END LOOP;
END;
$$;

-- Corre todos los días a las 06:00 (hora del servidor de Supabase, UTC) — sobra de margen: la función
-- es idempotente (NOT EXISTS de arriba) así que no pasa nada si corre de más, solo genera cuando de
-- verdad ya toca. unschedule primero para poder re-correr esta migración sin duplicar el job.
DO $$
BEGIN
    PERFORM cron.unschedule('generar-cuentas-pagar-recurrentes');
EXCEPTION WHEN OTHERS THEN
    NULL; -- no existía todavía, primera vez que se corre esta migración
END $$;

SELECT cron.schedule(
    'generar-cuentas-pagar-recurrentes',
    '0 6 * * *',
    $$SELECT generar_cuentas_pagar_recurrentes();$$
);

NOTIFY pgrst, 'reload schema';
