-- ============================================================
-- MIGRACIÓN: Revertir venta cerrada también cuando NO hay vínculo explícito guardado
-- ============================================================
-- Bug reportado por el usuario: eliminó el adelanto de una venta ya cerrada y la venta se quedó en
-- "Venta Cerrada" en vez de volver a "activo" (pendiente).
--
-- Causa: proyecto_reversion_venta_migration.sql solo revierte cuando `proyecto.id_transaccion_cierre`
-- apunta EXACTAMENTE a la transacción que se anuló — ese vínculo solo se completa para ventas cerradas
-- DESPUÉS de esa migración (ver cerrarVentaAprobada en aprobaciones.service.ts). Cualquier venta que ya
-- estaba cerrada ANTES de esa migración (o cerrada con "adelanto ya registrado", donde nunca se supo
-- cuál transacción vieja era) queda con `id_transaccion_cierre IS NULL` — sin vínculo que revertir,
-- aunque su adelanto se elimine.
--
-- Fix: se agrega un CASO 2 (respaldo) — si no hay vínculo explícito, pero la transacción que se está
-- anulando/eliminando es de categoría 'Adelanto' y, después de quitarla, el proyecto se queda SIN
-- ningún otro ingreso activo hacia su centro de costo, la venta igual vuelve a 'activo'. Cubre tanto
-- las ventas cerradas antes de esta funcionalidad como las cerradas con "adelanto ya registrado".
-- Aplica tanto a la ANULACIÓN (fn_anular_transaccion) como al BORRADO DURO (deleteTransaccion, ahora
-- vía este mismo RPC) — a pedido explícito del usuario, que no distingue entre ambas al decir
-- "eliminé el adelanto".
-- Idempotente: CREATE OR REPLACE, se puede correr más de una vez.
-- ============================================================

-- 1. Función compartida: dado que una transacción se acaba de anular o borrar, revierte la venta del
--    proyecto de destino si corresponde. Se llama DESPUÉS de que la transacción ya quedó anulada/borrada
--    (para que el conteo de "ingresos activos restantes" no la vuelva a contar).
CREATE OR REPLACE FUNCTION fn_revertir_venta_por_transaccion(
    p_id_transaccion BIGINT,
    p_categoria TEXT,
    p_tipo TEXT,
    p_id_centro_costo_destino BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id_proyecto BIGINT;
BEGIN
    IF p_tipo IS DISTINCT FROM 'ingreso' OR p_id_centro_costo_destino IS NULL THEN
        RETURN;
    END IF;

    SELECT id_proyecto INTO v_id_proyecto FROM centro_costo WHERE id_centro_costo = p_id_centro_costo_destino;
    IF v_id_proyecto IS NULL THEN
        RETURN;
    END IF;

    -- Caso 1: vínculo explícito (ver proyecto_reversion_venta_migration.sql) — esta transacción era LA
    -- que cerró la venta. Si ya se revirtió por acá, no hace falta seguir al caso 2.
    UPDATE proyecto
    SET estado_proyecto = 'activo', id_transaccion_cierre = NULL
    WHERE id_proyecto = v_id_proyecto AND id_transaccion_cierre = p_id_transaccion AND estado_proyecto = 'venta_cerrada';
    IF FOUND THEN
        RETURN;
    END IF;

    -- Caso 2 (respaldo, sin vínculo guardado): era un Adelanto de una venta cerrada sin vínculo, y tras
    -- quitarlo no queda NINGÚN otro ingreso activo hacia el centro de costo del proyecto — se asume que
    -- ya no hay evidencia de venta cerrada y se revierte igual.
    IF p_categoria = 'Adelanto' THEN
        PERFORM 1 FROM proyecto WHERE id_proyecto = v_id_proyecto AND estado_proyecto = 'venta_cerrada' AND id_transaccion_cierre IS NULL;
        IF FOUND THEN
            PERFORM 1 FROM transaccion
            WHERE id_centro_costo_destino = p_id_centro_costo_destino AND tipo = 'ingreso' AND estado = 'activo';
            IF NOT FOUND THEN
                UPDATE proyecto SET estado_proyecto = 'activo' WHERE id_proyecto = v_id_proyecto AND estado_proyecto = 'venta_cerrada';
            END IF;
        END IF;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_revertir_venta_por_transaccion(BIGINT, TEXT, TEXT, BIGINT) TO anon, authenticated;

-- 2. fn_anular_transaccion ahora delega el paso final a fn_revertir_venta_por_transaccion (mismo
--    comportamiento de antes + el caso 2 de respaldo).
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

    PERFORM fn_revertir_venta_por_transaccion(v_transaccion.id_transaccion, v_transaccion.categoria, v_transaccion.tipo, v_transaccion.id_centro_costo_destino);

    RETURN v_transaccion;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_anular_transaccion(BIGINT) TO anon, authenticated;

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
