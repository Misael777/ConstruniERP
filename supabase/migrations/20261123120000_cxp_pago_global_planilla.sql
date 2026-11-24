-- Tickets #134 y #122 (23/11/2026): en el "Resumen de pago" de una CxP de planilla (tareo), Romina selecciona varios
-- trabajadores y los paga juntos con UNA transacción (una sola transferencia). Cada cuota queda 'pagado' apuntando a esa
-- transacción (pagos.id_transaccion se repite: varias cuotas, un movimiento).
--
-- 1) fn_confirmar_pagos_global: igual que fn_confirmar_pago pero para varias cuotas programadas de la MISMA cuenta.
--    El monto de la transacción debe ser exactamente la suma de las cuotas (no hay pago parcial en el pago global).
--    Idempotente: si todas ya estaban pagadas (doble clic / reintento) no hace nada.
-- 2) fn_reactivar_transaccion: al reactivar una transacción anulada que respaldaba varias cuotas, compara la SUMA de
--    esas cuotas con el monto de la transacción (antes comparaba cada cuota con el total, lo que fallaría).
-- No modifica datos existentes. Idempotente.

CREATE OR REPLACE FUNCTION public.fn_confirmar_pagos_global(
    p_id_cuenta_pagar bigint,
    p_ids_pago bigint[],
    p_transaccion_payload jsonb,
    p_idempotency_key uuid DEFAULT NULL
) RETURNS transaccion
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
    v_t transaccion;
    v_transaccion transaccion;
    v_soles numeric;
    v_suma numeric;
    v_cant int;
    v_pagados int;
    v_ids bigint[];
BEGIN
    SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(p_ids_pago) x WHERE x IS NOT NULL;
    IF v_ids IS NULL OR array_length(v_ids, 1) = 0 THEN
        RAISE EXCEPTION 'Selecciona al menos una cuota' USING HINT = 'SIN_CUOTAS';
    END IF;

    PERFORM 1 FROM cuentas_pagar WHERE id_cuenta_pagar = p_id_cuenta_pagar FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cuenta por pagar % no encontrada', p_id_cuenta_pagar USING HINT = 'CUENTA_NO_ENCONTRADA';
    END IF;

    PERFORM 1 FROM pagos WHERE id_pago = ANY (v_ids) FOR UPDATE;
    SELECT count(*), count(*) FILTER (WHERE estado_pago = 'pagado'), COALESCE(sum(monto) FILTER (WHERE estado_pago = 'programado'), 0)
        INTO v_cant, v_pagados, v_suma
        FROM pagos WHERE id_pago = ANY (v_ids) AND id_cuenta_pagar = p_id_cuenta_pagar;
    IF v_cant <> array_length(v_ids, 1) THEN
        RAISE EXCEPTION 'Alguna de las cuotas no pertenece a esta cuenta por pagar o ya no existe' USING HINT = 'CUENTA_NO_ENCONTRADA';
    END IF;
    IF v_pagados = v_cant THEN
        -- Doble clic / reintento: ya estaban todas pagadas.
        SELECT t.* INTO v_transaccion FROM transaccion t JOIN pagos p ON p.id_transaccion = t.id_transaccion WHERE p.id_pago = v_ids[1];
        RETURN v_transaccion;
    END IF;
    IF EXISTS (SELECT 1 FROM pagos WHERE id_pago = ANY (v_ids) AND estado_pago <> 'programado') THEN
        RAISE EXCEPTION 'Alguna de las cuotas seleccionadas ya no está pendiente. Actualiza el resumen y vuelve a seleccionar.' USING HINT = 'CUOTA_NO_PENDIENTE';
    END IF;

    v_t := jsonb_populate_record(NULL::transaccion, p_transaccion_payload);
    v_soles := fn_monto_soles_transaccion(v_t);
    IF abs(v_soles - v_suma) > 0.01 THEN
        RAISE EXCEPTION 'El monto de la transacción (%) debe ser igual a la suma de las cuotas seleccionadas (%)', v_soles, v_suma
            USING HINT = 'MONTO_DISTINTO_SUMA';
    END IF;

    v_transaccion := fn_crear_transaccion(p_transaccion_payload, p_idempotency_key);

    -- fn_pagos_proteger_proyeccion impide pagar la "Proyección de planilla" (lanza su propio error).
    UPDATE pagos SET estado_pago = 'pagado', id_transaccion = v_transaccion.id_transaccion
        WHERE id_pago = ANY (v_ids);

    PERFORM fn_recalcular_cuenta_pagar(p_id_cuenta_pagar);
    RETURN v_transaccion;
END $$;

REVOKE ALL ON FUNCTION public.fn_confirmar_pagos_global(bigint, bigint[], jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_confirmar_pagos_global(bigint, bigint[], jsonb, uuid) TO authenticated;

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
    v_suma_pagos numeric;
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

    -- Ticket #134: una transacción puede respaldar varias cuotas (pago global de planilla): se compara la SUMA.
    SELECT sum(monto) INTO v_suma_pagos FROM pagos WHERE id_transaccion_anulada = p_id_transaccion;
    FOR v_pago IN SELECT * FROM pagos WHERE id_transaccion_anulada = p_id_transaccion ORDER BY id_cuenta_pagar FOR UPDATE
    LOOP
        PERFORM 1 FROM cuentas_pagar WHERE id_cuenta_pagar = v_pago.id_cuenta_pagar FOR UPDATE;
        IF v_pago.estado_pago <> 'programado' OR v_pago.id_transaccion IS NOT NULL OR abs(v_suma_pagos - v_monto_soles) > 0.01 THEN
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

NOTIFY pgrst, 'reload schema';
