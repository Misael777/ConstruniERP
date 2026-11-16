-- Hallado por la suite de punta a punta de Control Financiero (12/11/2026):
-- "Reactivar" una transacción anulada que respaldaba un cobro/pago la volvía a contar en el centro de costo y la
-- cuenta bancaria, pero el cobro/pago seguía "programado" (fn_anular_transaccion lo había desvinculado) — la Cuenta
-- por Cobrar/Pagar seguía debiendo ese monto y la proyección lo contaba otra vez: DINERO CONTADO DOS VECES, y ningún
-- chequeo lo detectaba (el vínculo se perdía al anular).
--
-- Arreglo:
--   1) Al anular, el cobro/pago recuerda qué transacción lo respaldaba (id_transaccion_anulada).
--   2) fn_reactivar_transaccion deshace la anulación COMPLETA y atómica: la transacción vuelve a 'activo' y su
--      cobro/pago vuelve a "cobrado"/"pagado" con su cuenta recalculada. Si ese cobro/pago ya no está como lo dejó
--      la anulación (se volvió a cobrar/pagar con otra transacción, se canceló o se le cambió el monto), NO reactiva
--      y explica qué hacer — nunca cuenta el dinero dos veces.
-- Solo AGREGA columnas (nulas) y funciones; no cambia ningún dato existente.

ALTER TABLE public.cobros ADD COLUMN IF NOT EXISTS id_transaccion_anulada bigint;
ALTER TABLE public.pagos ADD COLUMN IF NOT EXISTS id_transaccion_anulada bigint;
CREATE INDEX IF NOT EXISTS idx_cobros_id_transaccion_anulada ON public.cobros (id_transaccion_anulada) WHERE id_transaccion_anulada IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pagos_id_transaccion_anulada ON public.pagos (id_transaccion_anulada) WHERE id_transaccion_anulada IS NOT NULL;
COMMENT ON COLUMN public.cobros.id_transaccion_anulada IS 'Transacción que respaldaba este cobro y fue ANULADA (fn_anular_transaccion). Permite que fn_reactivar_transaccion lo restaure.';
COMMENT ON COLUMN public.pagos.id_transaccion_anulada IS 'Transacción que respaldaba este pago y fue ANULADA (fn_anular_transaccion). Permite que fn_reactivar_transaccion lo restaure.';

-- Igual a la versión vigente (financial_integrity_rpc_migration.sql) + guarda id_transaccion_anulada.
CREATE OR REPLACE FUNCTION public.fn_anular_transaccion(p_id_transaccion bigint)
 RETURNS transaccion
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_transaccion transaccion;
    v_cobro RECORD;
    v_pago RECORD;
BEGIN
    SELECT * INTO v_transaccion FROM transaccion WHERE id_transaccion = p_id_transaccion FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transacción % no encontrada', p_id_transaccion USING HINT = 'CUENTA_NO_ENCONTRADA';
    END IF;
    IF v_transaccion.estado = 'anulado' THEN
        RETURN v_transaccion;
    END IF;

    FOR v_cobro IN SELECT id_cobro, id_cuenta_cobrar FROM cobros WHERE id_transaccion = p_id_transaccion ORDER BY id_cuenta_cobrar
    LOOP
        PERFORM 1 FROM cuentas_cobrar WHERE id_cuenta_cobrar = v_cobro.id_cuenta_cobrar FOR UPDATE;
        UPDATE cobros SET estado_cobro = 'programado', id_transaccion = NULL, id_transaccion_anulada = p_id_transaccion WHERE id_cobro = v_cobro.id_cobro;
        PERFORM fn_recalcular_cuenta_cobrar(v_cobro.id_cuenta_cobrar);
    END LOOP;

    FOR v_pago IN SELECT id_pago, id_cuenta_pagar FROM pagos WHERE id_transaccion = p_id_transaccion ORDER BY id_cuenta_pagar
    LOOP
        PERFORM 1 FROM cuentas_pagar WHERE id_cuenta_pagar = v_pago.id_cuenta_pagar FOR UPDATE;
        UPDATE pagos SET estado_pago = 'programado', id_transaccion = NULL, id_transaccion_anulada = p_id_transaccion WHERE id_pago = v_pago.id_pago;
        PERFORM fn_recalcular_cuenta_pagar(v_pago.id_cuenta_pagar);
    END LOOP;

    UPDATE transaccion SET estado = 'anulado' WHERE id_transaccion = p_id_transaccion RETURNING * INTO v_transaccion;

    PERFORM fn_recalcular_saldo_cuenta_banco(v_transaccion.cuente_origen);
    PERFORM fn_recalcular_saldo_cuenta_banco(v_transaccion.cuente_destino);

    PERFORM fn_revertir_venta_por_transaccion(v_transaccion.id_transaccion, v_transaccion.categoria, v_transaccion.tipo, v_transaccion.id_centro_costo_destino);

    RETURN v_transaccion;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_reactivar_transaccion(p_id_transaccion bigint)
 RETURNS transaccion
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_transaccion transaccion;
    v_monto_soles numeric;
    v_cobro RECORD;
    v_pago RECORD;
BEGIN
    SELECT * INTO v_transaccion FROM transaccion WHERE id_transaccion = p_id_transaccion FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transacción % no encontrada', p_id_transaccion USING HINT = 'CUENTA_NO_ENCONTRADA';
    END IF;
    IF v_transaccion.estado <> 'anulado' THEN
        RETURN v_transaccion; -- ya activa: no-op, igual que anular dos veces
    END IF;
    v_monto_soles := fn_monto_soles_transaccion(v_transaccion);

    FOR v_cobro IN SELECT * FROM cobros WHERE id_transaccion_anulada = p_id_transaccion ORDER BY id_cuenta_cobrar FOR UPDATE
    LOOP
        PERFORM 1 FROM cuentas_cobrar WHERE id_cuenta_cobrar = v_cobro.id_cuenta_cobrar FOR UPDATE;
        IF v_cobro.estado_cobro <> 'programado' OR v_cobro.id_transaccion IS NOT NULL OR abs(v_cobro.monto - v_monto_soles) > 0.01 THEN
            RAISE EXCEPTION 'No se puede reactivar: esta transacción respaldaba un cobro de la cuenta por cobrar #% que ya se volvió a registrar o cambió desde que se anuló. Si falta cobrarlo, hazlo desde Cuentas por Cobrar.', v_cobro.id_cuenta_cobrar
                USING HINT = 'REACTIVAR_COBRO_CAMBIADO';
        END IF;
        UPDATE cobros SET estado_cobro = 'cobrado', id_transaccion = p_id_transaccion, id_transaccion_anulada = NULL WHERE id_cobro = v_cobro.id_cobro;
        PERFORM fn_recalcular_cuenta_cobrar(v_cobro.id_cuenta_cobrar);
    END LOOP;

    FOR v_pago IN SELECT * FROM pagos WHERE id_transaccion_anulada = p_id_transaccion ORDER BY id_cuenta_pagar FOR UPDATE
    LOOP
        PERFORM 1 FROM cuentas_pagar WHERE id_cuenta_pagar = v_pago.id_cuenta_pagar FOR UPDATE;
        IF v_pago.estado_pago <> 'programado' OR v_pago.id_transaccion IS NOT NULL OR abs(v_pago.monto - v_monto_soles) > 0.01 THEN
            RAISE EXCEPTION 'No se puede reactivar: esta transacción respaldaba un pago de la cuenta por pagar #% que ya se volvió a registrar o cambió desde que se anuló. Si falta pagarlo, hazlo desde Cuentas por Pagar.', v_pago.id_cuenta_pagar
                USING HINT = 'REACTIVAR_PAGO_CAMBIADO';
        END IF;
        UPDATE pagos SET estado_pago = 'pagado', id_transaccion = p_id_transaccion, id_transaccion_anulada = NULL WHERE id_pago = v_pago.id_pago;
        PERFORM fn_recalcular_cuenta_pagar(v_pago.id_cuenta_pagar);
    END LOOP;

    UPDATE transaccion SET estado = 'activo' WHERE id_transaccion = p_id_transaccion RETURNING * INTO v_transaccion;

    PERFORM fn_recalcular_saldo_cuenta_banco(v_transaccion.cuente_origen);
    PERFORM fn_recalcular_saldo_cuenta_banco(v_transaccion.cuente_destino);

    RETURN v_transaccion;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_reactivar_transaccion(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reactivar_transaccion(bigint) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
