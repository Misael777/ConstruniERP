-- ============================================================
-- MIGRACIÓN: Revertir el proyecto a 'activo' cuando se anula la transacción que cerró su venta
-- ============================================================
-- A pedido explícito del usuario: "cuando se elimine una transacción enlazada (cerrar una venta,
-- abono o adelanto) a un proyecto el proyecto debe regresar al estado anterior de la ejecución de
-- esa transacción". Decisiones confirmadas con el usuario (AskUserQuestion):
--   1. Solo revierte cuando se anula ESPECÍFICAMENTE la transacción que cerró la venta (el adelanto
--      que crea cerrarVentaAprobada) — no cualquier abono/adelanto posterior del proyecto.
--   2. Solo aplica a la ANULACIÓN (fn_anular_transaccion / "Anular" en TransaccionModal.svelte), no al
--      borrado duro (deleteTransaccion) — ese ya queda bloqueado la mayoría de las veces porque este
--      adelanto suele quedar 'aprobado'.
--
-- No existía ningún vínculo que dijera "esta transacción fue la que cerró esta venta" (proyecto.
-- estado_proyecto es un VARCHAR libre sin historial, ver factura_migration.sql-style de esta app: no
-- hay tabla de auditoría de estados) — esta migración agrega ese vínculo explícito.
-- Idempotente: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION, se puede correr más de una vez.
-- ============================================================

-- 1. Vínculo explícito "esta transacción es la que cerró esta venta" — ver cerrarVentaAprobada en
--    aprobaciones.service.ts, que ahora lo completa al crear el adelanto de cierre. NULL = venta
--    cerrada sin una transacción de cierre identificable (ej. "adelanto ya registrado" de antes, donde
--    no hay forma de saber cuál transacción vieja fue). ON DELETE SET NULL: mismo criterio que
--    cobros/pagos/cuentas_cobrar/cuentas_pagar.id_transaccion — si la transacción desaparece del todo
--    (borrado duro), la referencia se limpia sola en vez de quedar colgando.
ALTER TABLE proyecto ADD COLUMN IF NOT EXISTS id_transaccion_cierre BIGINT REFERENCES transaccion(id_transaccion) ON DELETE SET NULL;

-- 2. fn_anular_transaccion — mismo cuerpo que financial_integrity_rpc_migration.sql, con un paso nuevo
--    al final: si la transacción anulada era la que cerró la venta de algún proyecto (y ese proyecto
--    sigue en 'venta_cerrada' — no pisa un estado distinto si alguien ya lo cambió a mano), ese
--    proyecto vuelve a 'activo' y se limpia el vínculo. Atómico junto con el resto de la anulación.
CREATE OR REPLACE FUNCTION fn_anular_transaccion(p_id_transaccion BIGINT)
RETURNS transaccion
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
        RETURN v_transaccion; -- idempotente: ya estaba anulada
    END IF;

    FOR v_cobro IN SELECT id_cobro, id_cuenta_cobrar FROM cobros WHERE id_transaccion = p_id_transaccion ORDER BY id_cuenta_cobrar
    LOOP
        PERFORM 1 FROM cuentas_cobrar WHERE id_cuenta_cobrar = v_cobro.id_cuenta_cobrar FOR UPDATE;
        UPDATE cobros SET estado_cobro = 'programado', id_transaccion = NULL WHERE id_cobro = v_cobro.id_cobro;
        PERFORM fn_recalcular_cuenta_cobrar(v_cobro.id_cuenta_cobrar);
    END LOOP;

    FOR v_pago IN SELECT id_pago, id_cuenta_pagar FROM pagos WHERE id_transaccion = p_id_transaccion ORDER BY id_cuenta_pagar
    LOOP
        PERFORM 1 FROM cuentas_pagar WHERE id_cuenta_pagar = v_pago.id_cuenta_pagar FOR UPDATE;
        UPDATE pagos SET estado_pago = 'programado', id_transaccion = NULL WHERE id_pago = v_pago.id_pago;
        PERFORM fn_recalcular_cuenta_pagar(v_pago.id_cuenta_pagar);
    END LOOP;

    UPDATE transaccion SET estado = 'anulado' WHERE id_transaccion = p_id_transaccion RETURNING * INTO v_transaccion;

    PERFORM fn_recalcular_saldo_cuenta_banco(v_transaccion.cuente_origen);
    PERFORM fn_recalcular_saldo_cuenta_banco(v_transaccion.cuente_destino);

    -- Si esta transacción era la que cerró una venta, esa venta vuelve a 'activo' (borrador) — a pedido
    -- explícito del usuario. `estado_proyecto = 'venta_cerrada'` en el WHERE: si alguien ya lo cambió a
    -- mano (ej. lo dio de baja) no lo pisa de vuelta a 'activo'.
    UPDATE proyecto
    SET estado_proyecto = 'activo', id_transaccion_cierre = NULL
    WHERE id_transaccion_cierre = p_id_transaccion AND estado_proyecto = 'venta_cerrada';

    RETURN v_transaccion;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_anular_transaccion(BIGINT) TO anon, authenticated;

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
