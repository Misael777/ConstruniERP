-- ----------------------------------------------------------------------------
-- Arregla el doble conteo de fn_recalcular_saldo_cuenta_banco tras un "Corte
-- Financiero" (Control Financiero -> Conciliación) — a pedido explícito del
-- usuario, investigado a raíz del ticket "SALDO NEGATIVO" y una diferencia
-- real de ~S/ 2,500,000 vista en el chequeo "Saldos consistentes".
--
-- PROBLEMA: antes, un Corte Financiero sobre una cuenta bancaria escribía
-- `cuenta_banco.saldo_inicial` DE VERDAD (crearAperturaFinancieraLote en
-- conciliacion.service.ts), y fn_recalcular_saldo_cuenta_banco sumaba TODO el
-- historial de transacciones de esa cuenta encima de ese saldo_inicial nuevo,
-- SIN filtrar por fecha — cualquier transacción anterior a la fecha de corte
-- quedaba contada DOS veces (una ya implícita en el monto declarado del
-- corte, otra de nuevo por la suma completa). Centro de Costo NUNCA tuvo este
-- bug: su saldo "vigente" (ver getSaldosDetalleCentrosCosto en
-- conciliacion.service.ts) ya excluye las transacciones anteriores a su
-- última apertura.
--
-- FIX: fn_recalcular_saldo_cuenta_banco ahora busca la Apertura Financiera
-- MÁS RECIENTE de esa cuenta (si existe) y la usa como base + fecha de corte
-- — mismo criterio que Centro de Costo, ahora simétrico en ambos lados:
--   - CON apertura: saldo_actual = apertura.monto + Σ(transacciones con
--     fecha POSTERIOR a apertura.fecha_corte).
--   - SIN apertura (cuenta que nunca tuvo un corte): comportamiento de
--     siempre, saldo_inicial + Σ(TODAS las transacciones).
--
-- Acompaña un cambio en conciliacion.service.ts: crearAperturaFinancieraLote
-- deja de escribir cuenta_banco.saldo_inicial directo — un Corte Financiero
-- ahora solo inserta en apertura_financiera (igual que ya hacía para Centro
-- de Costo), y esta función ya sabe leerla sola. saldo_inicial vuelve a ser
-- lo que su propio nombre dice: el valor de una sola vez al crear la cuenta,
-- nunca más pisado por un corte posterior.
--
-- GAP REAL encontrado al correr esta migración por primera vez: además del
-- chequeo de aplicación que transaccion_permitir_saldo_negativo_cuenta_banco_
-- migration.sql ya había quitado de fn_crear_transaccion, existía un CHECK
-- constraint de BASE DE DATOS aparte (cuenta_banco_saldo_actual_check,
-- agregado en financial_integrity_rpc_migration.sql, de ANTES de que se
-- pidiera permitir saldo negativo) que esa migración nunca tocó — bloqueaba
-- CUALQUIER UPDATE que dejara saldo_actual negativo, sin importar qué RPC lo
-- intentara. Se quita acá, idempotente (IF EXISTS).
-- ----------------------------------------------------------------------------

ALTER TABLE cuenta_banco DROP CONSTRAINT IF EXISTS cuenta_banco_saldo_actual_check;

CREATE OR REPLACE FUNCTION fn_recalcular_saldo_cuenta_banco(p_numero_cuenta VARCHAR)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cuenta cuenta_banco;
    v_neto NUMERIC;
    v_apertura_monto NUMERIC;
    v_apertura_fecha DATE;
    v_base NUMERIC;
BEGIN
    IF p_numero_cuenta IS NULL THEN RETURN; END IF;

    SELECT * INTO v_cuenta FROM cuenta_banco WHERE numero_cuenta = p_numero_cuenta FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;

    -- Apertura Financiera más reciente de ESTA cuenta (por fecha_corte, empate por created_at) —
    -- mismo criterio que getUltimasAperturasPorCentroCosto en conciliacion.service.ts.
    SELECT monto, fecha_corte INTO v_apertura_monto, v_apertura_fecha
    FROM apertura_financiera
    WHERE id_cuenta_banco = v_cuenta.id_cuenta_banco
    ORDER BY fecha_corte DESC, created_at DESC
    LIMIT 1;

    IF FOUND THEN
        v_base := v_apertura_monto;
        SELECT COALESCE(SUM(
            CASE WHEN cuente_origen = p_numero_cuenta THEN -monto_total ELSE 0 END +
            CASE WHEN cuente_destino = p_numero_cuenta THEN monto_total ELSE 0 END
        ), 0) INTO v_neto
        FROM transaccion
        WHERE estado = 'activo' AND (cuente_origen = p_numero_cuenta OR cuente_destino = p_numero_cuenta)
            AND fecha > v_apertura_fecha;
    ELSE
        v_base := v_cuenta.saldo_inicial;
        SELECT COALESCE(SUM(
            CASE WHEN cuente_origen = p_numero_cuenta THEN -monto_total ELSE 0 END +
            CASE WHEN cuente_destino = p_numero_cuenta THEN monto_total ELSE 0 END
        ), 0) INTO v_neto
        FROM transaccion
        WHERE estado = 'activo' AND (cuente_origen = p_numero_cuenta OR cuente_destino = p_numero_cuenta);
    END IF;

    UPDATE cuenta_banco SET saldo_actual = v_base + v_neto WHERE id_cuenta_banco = v_cuenta.id_cuenta_banco;
END;
$$;

-- Recalcula TODAS las cuentas activas de una — corrige de inmediato cualquier saldo_actual que haya
-- quedado inflado por el bug de arriba (ej. las cuentas con un corte de ~250,000 de prueba). Idempotente:
-- correr esta migración de nuevo simplemente vuelve a calcular lo mismo.
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT numero_cuenta FROM cuenta_banco WHERE activo = true LOOP
        PERFORM fn_recalcular_saldo_cuenta_banco(r.numero_cuenta);
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
