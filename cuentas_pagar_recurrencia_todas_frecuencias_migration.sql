-- ============================================================
-- MIGRACIÓN: generaliza generar_cuentas_pagar_recurrentes() a las 3 frecuencias (antes solo 'mensual')
-- A pedido del usuario: 'semanal' debe generar cada 7 días desde la primera creación de la cuenta, y
-- dejar de generarse en cuanto la siguiente generación caería después de `fin_periodo_pago` (columna
-- agregada en cuentas_pagar_fin_periodo_pago_migration.sql). Mismo criterio aplicado también a
-- 'quincenal' (cada 15 días) y a 'mensual' (que ya generaba, ahora respeta fin_periodo_pago también —
-- antes no existía esa columna, así que corría indefinidamente).
--
-- Requiere haber corrido antes cuentas_pagar_recurrencia_mensual_migration.sql (columna
-- id_cuenta_pagar_padre + pg_cron ya programado) y cuentas_pagar_fin_periodo_pago_migration.sql
-- (columna fin_periodo_pago). Este archivo solo reemplaza el CUERPO de la función — el cron.schedule
-- ya programado sigue apuntando al mismo nombre, no hace falta reprogramarlo.
--
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

-- Reemplaza la función completa: busca la CABEZA de cada cadena (frecuencia_pago en
-- mensual/quincenal/semanal, activa, sin hija todavía), calcula la siguiente fecha de emisión según
-- el intervalo de su frecuencia, y solo genera la hija si:
--   1. Ya llegó o pasó esa fecha (CURRENT_DATE >= siguiente fecha_emision).
--   2. fin_periodo_pago está vacío, O la siguiente fecha_emision todavía cae DENTRO de ese límite
--      (fin_periodo_pago IS NULL OR siguiente_fecha_emision <= fin_periodo_pago) — a pedido explícito
--      del usuario. Una vez que la siguiente generación se pasaría de fin_periodo_pago, esa cadena
--      deja de generarse para siempre (la cabeza nunca gana una hija que la reemplace, así que este
--      chequeo la vuelve a evaluar y a saltar en cada corrida del cron, sin generar nada más).
-- Copia TODOS los campos de la cuenta original salvo las 3 fechas (corridas +intervalo cada una,
-- Postgres ajusta solo días/meses que no existen y el año cuando corresponde) y
-- monto_pagado/saldo_pendiente/estado (la cuenta nueva arranca sin pagos, mismo criterio que la
-- versión anterior de esta función).
CREATE OR REPLACE FUNCTION generar_cuentas_pagar_recurrentes()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    r RECORD;
    intervalo INTERVAL;
    nueva_fecha_emision DATE;
    nueva_fecha_vencimiento DATE;
    nueva_fecha_pago_programada DATE;
    estado_calculado VARCHAR(10);
BEGIN
    FOR r IN
        SELECT cp.*
        FROM cuentas_pagar cp
        WHERE cp.frecuencia_pago IN ('mensual', 'quincenal', 'semanal')
          AND cp.activo = true
          AND NOT EXISTS (
              SELECT 1 FROM cuentas_pagar hijo WHERE hijo.id_cuenta_pagar_padre = cp.id_cuenta_pagar
          )
    LOOP
        intervalo := CASE r.frecuencia_pago
            WHEN 'mensual' THEN INTERVAL '1 month'
            WHEN 'quincenal' THEN INTERVAL '15 days'
            WHEN 'semanal' THEN INTERVAL '7 days'
        END;

        nueva_fecha_emision := (r.fecha_emision + intervalo)::date;

        -- Todavía no pasó el intervalo desde la última generación -> nada que hacer con esta cadena hoy.
        CONTINUE WHEN CURRENT_DATE < nueva_fecha_emision;

        -- Ya se pasó de fin_periodo_pago -> la cadena queda cerrada, no se genera más.
        CONTINUE WHEN r.fin_periodo_pago IS NOT NULL AND nueva_fecha_emision > r.fin_periodo_pago;

        nueva_fecha_vencimiento := CASE WHEN r.fecha_vencimiento IS NOT NULL THEN (r.fecha_vencimiento + intervalo)::date ELSE NULL END;
        nueva_fecha_pago_programada := CASE WHEN r.fecha_pago_programada IS NOT NULL THEN (r.fecha_pago_programada + intervalo)::date ELSE NULL END;

        estado_calculado := CASE
            WHEN COALESCE(nueva_fecha_pago_programada, nueva_fecha_vencimiento) < CURRENT_DATE THEN 'vencido'
            ELSE 'pendiente'
        END;

        INSERT INTO cuentas_pagar (
            id_proveedor, id_centro_costo, id_presupuesto, id_partida,
            tipo_documento, num_documento, monto_comprometido, monto_pagado, saldo_pendiente,
            fotma_pago, frecuencia_pago, fin_periodo_pago, categoria_gasto, condicion_pago, responsable,
            fecha_emision, fecha_vencimiento, fecha_pago_programada,
            monto_imponible, monto_igv, detraccion, monto_retencion,
            estado, observacion, prioridad, usuario_registro, activo,
            id_cuenta_pagar_padre
        ) VALUES (
            r.id_proveedor, r.id_centro_costo, r.id_presupuesto, r.id_partida,
            r.tipo_documento, r.num_documento, r.monto_comprometido, 0, r.monto_comprometido,
            r.fotma_pago, r.frecuencia_pago, r.fin_periodo_pago, r.categoria_gasto, r.condicion_pago, r.responsable,
            nueva_fecha_emision, nueva_fecha_vencimiento, nueva_fecha_pago_programada,
            r.monto_imponible, r.monto_igv, r.detraccion, r.monto_retencion,
            estado_calculado, r.observacion, r.prioridad, r.usuario_registro, true,
            r.id_cuenta_pagar
        );
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
