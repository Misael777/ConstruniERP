-- Fix: fn_crear_transaccion descartaba columnas al crear una transacción.
--
-- La lista de columnas del INSERT no incluía `categoria` (ya arreglado una vez en
-- fn_crear_transaccion_categoria_fix_migration.sql, el 2026-09-11, pero las migraciones
-- transaccion_permitir_saldo_negativo_cuenta_banco_migration.sql y
-- cuenta_banco_saldo_fecha_corte_migration.sql, posteriores, redefinieron la función desde una
-- versión anterior y volvieron a perderla), ni las columnas agregadas después:
-- tipo_moneda, tipo_cambio, monto_convertido, documento_pendiente,
-- responsable_documento_pendiente y fecha_vencimiento_documento.
--
-- Efecto real: toda transacción creada desde la app quedaba con categoria=NULL, tipo_moneda='soles'
-- (default) aunque se eligiera dólares, y documento_pendiente='no' aunque se marcara 'si'.
--
-- Este archivo es el cuerpo VIGENTE en Producción (sin auditoría de saldo de cuenta bancaria, ver
-- transaccion_permitir_saldo_negativo_cuenta_banco_migration.sql) más esas columnas. No toca filas ya
-- guardadas — las transacciones existentes con categoria=NULL se corrigen aparte, si hace falta.
-- COALESCE en tipo_moneda/documento_pendiente: son NOT NULL con default, y jsonb_populate_record no
-- aplica defaults cuando la clave no viene en el payload.

CREATE OR REPLACE FUNCTION "public"."fn_crear_transaccion"("p_payload" "jsonb", "p_idempotency_key" "uuid" DEFAULT NULL::"uuid") RETURNS "public"."transaccion"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_row transaccion;
    v_existente transaccion;
    v_tipo VARCHAR;
    v_monto NUMERIC;
    v_id_centro_origen BIGINT;
    v_es_interno BOOLEAN;
    v_saldo_centro NUMERIC;
    v_cuenta_origen VARCHAR;
    v_cuenta_destino VARCHAR;
    v_id_cb_origen BIGINT;
    v_id_cb_destino BIGINT;
BEGIN
    -- Idempotencia: un reintento con la MISMA key (doble-click, timeout de red) no
    -- vuelve a insertar ni a mover saldos — devuelve la transacción que ya se creó.
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existente FROM transaccion WHERE idempotency_key = p_idempotency_key;
        IF FOUND THEN RETURN v_existente; END IF;
    END IF;

    v_row := jsonb_populate_record(NULL::transaccion, p_payload);
    v_tipo := v_row.tipo;
    v_monto := v_row.monto_total;
    v_id_centro_origen := v_row.id_centro_costo_origen;
    v_cuenta_origen := v_row.cuente_origen;
    v_cuenta_destino := v_row.cuente_destino;

    -- Auditoría de saldo (mismo criterio de negocio que validarSaldoSuficiente en
    -- transacciones.service.ts — ver ese comentario para el porqué): Egreso/Transferencia
    -- se audita SOLO si el origen es demostrablemente nuestro (centro de costo sin
    -- cliente/proveedor/empleado vinculado, o número de cuenta que matchea cuenta_banco).
    -- Ingreso/Financiamiento nunca generan sobregiro, no se audita.
    IF v_tipo IN ('egreso', 'transferencia') AND v_id_centro_origen IS NOT NULL THEN
        SELECT (id_cliente IS NULL AND id_proveedor IS NULL AND id_empleado IS NULL) INTO v_es_interno
        FROM centro_costo WHERE id_centro_costo = v_id_centro_origen FOR UPDATE;

        IF v_es_interno THEN
            SELECT COALESCE(SUM(
                CASE WHEN id_centro_costo_origen = v_id_centro_origen AND tipo IN ('egreso', 'transferencia') THEN -monto_total ELSE 0 END +
                CASE WHEN id_centro_costo_destino = v_id_centro_origen AND tipo IN ('ingreso', 'financiamiento', 'transferencia') THEN monto_total ELSE 0 END
            ), 0) INTO v_saldo_centro
            FROM transaccion
            WHERE estado = 'activo' AND (id_centro_costo_origen = v_id_centro_origen OR id_centro_costo_destino = v_id_centro_origen);

            IF v_saldo_centro - v_monto < -0.01 THEN
                RAISE EXCEPTION 'Saldo insuficiente en el centro de costo de origen: disponible %, se requieren %', v_saldo_centro, v_monto
                    USING HINT = 'SALDO_INSUFICIENTE';
            END IF;
        END IF;
    END IF;

    IF v_cuenta_origen IS NOT NULL THEN
        SELECT id_cuenta_banco INTO v_id_cb_origen FROM cuenta_banco WHERE numero_cuenta = v_cuenta_origen;
    END IF;
    IF v_cuenta_destino IS NOT NULL THEN
        SELECT id_cuenta_banco INTO v_id_cb_destino FROM cuenta_banco WHERE numero_cuenta = v_cuenta_destino;
    END IF;

    -- Orden determinista ascendente de id — evita deadlock en una Transferencia entre
    -- dos cuentas propias, sin importar cuál es origen/destino en esta llamada. Este
    -- bloqueo se mantiene aunque ya no se audite el saldo de la cuenta (abajo): sigue
    -- haciendo falta para que fn_recalcular_saldo_cuenta_banco (al final) nunca corra
    -- dos veces en paralelo sobre la misma cuenta.
    IF v_id_cb_origen IS NOT NULL AND v_id_cb_destino IS NOT NULL THEN
        IF v_id_cb_origen < v_id_cb_destino THEN
            PERFORM 1 FROM cuenta_banco WHERE id_cuenta_banco = v_id_cb_origen FOR UPDATE;
            PERFORM 1 FROM cuenta_banco WHERE id_cuenta_banco = v_id_cb_destino FOR UPDATE;
        ELSE
            PERFORM 1 FROM cuenta_banco WHERE id_cuenta_banco = v_id_cb_destino FOR UPDATE;
            PERFORM 1 FROM cuenta_banco WHERE id_cuenta_banco = v_id_cb_origen FOR UPDATE;
        END IF;
    ELSIF v_id_cb_origen IS NOT NULL THEN
        PERFORM 1 FROM cuenta_banco WHERE id_cuenta_banco = v_id_cb_origen FOR UPDATE;
    ELSIF v_id_cb_destino IS NOT NULL THEN
        PERFORM 1 FROM cuenta_banco WHERE id_cuenta_banco = v_id_cb_destino FOR UPDATE;
    END IF;

    -- A pedido explícito del usuario: ya NO se audita el saldo de la cuenta bancaria de
    -- origen — puede quedar en negativo. (Antes acá había un chequeo idéntico al del
    -- centro de costo de arriba, contra v_saldo_cuenta, que rechazaba con
    -- HINT='SALDO_INSUFICIENTE' si la cuenta no alcanzaba.)

    INSERT INTO transaccion (
        id_centro_costo_origen, id_centro_costo_destino, fecha, id_nombre, tipo_documento, num_documento,
        tipo_transaccion, num_operacion, tipo_gasto, num_comprobante_interno, num_recibo_pago,
        num_recibo_pago_no_efectivo, num_recibo_pago_proveedor, forma_pago, descripcion, tipo, monto_total,
        medio_pago, cuente_origen, cuente_destino, estado, usuario_registro, comprobante_url, factura_url,
        comprobante_autogenerado_url, tipo_alcance, categoria, tipo_moneda, tipo_cambio, monto_convertido,
        documento_pendiente, responsable_documento_pendiente, fecha_vencimiento_documento, idempotency_key
    ) VALUES (
        v_row.id_centro_costo_origen, v_row.id_centro_costo_destino, v_row.fecha, v_row.id_nombre, v_row.tipo_documento,
        v_row.num_documento, v_row.tipo_transaccion, v_row.num_operacion, v_row.tipo_gasto, v_row.num_comprobante_interno,
        v_row.num_recibo_pago, v_row.num_recibo_pago_no_efectivo, v_row.num_recibo_pago_proveedor, v_row.forma_pago,
        v_row.descripcion, v_row.tipo, v_row.monto_total, v_row.medio_pago, v_row.cuente_origen, v_row.cuente_destino,
        v_row.estado, v_row.usuario_registro, v_row.comprobante_url, v_row.factura_url,
        v_row.comprobante_autogenerado_url, v_row.tipo_alcance, v_row.categoria,
        COALESCE(v_row.tipo_moneda, 'soles'), v_row.tipo_cambio, v_row.monto_convertido,
        COALESCE(v_row.documento_pendiente, 'no'), v_row.responsable_documento_pendiente,
        v_row.fecha_vencimiento_documento, p_idempotency_key
    )
    RETURNING * INTO v_row;

    PERFORM fn_recalcular_saldo_cuenta_banco(v_row.cuente_origen);
    PERFORM fn_recalcular_saldo_cuenta_banco(v_row.cuente_destino);

    RETURN v_row;
EXCEPTION
    WHEN unique_violation THEN
        -- Doble-envío real: dos llamadas con la MISMA idempotency_key llegaron casi
        -- juntas y ambas pasaron el chequeo de arriba antes de que la primera
        -- confirmara — el índice único parcial es el árbitro final; se devuelve la
        -- fila que sí quedó insertada, en vez de propagar el error al usuario.
        SELECT * INTO v_existente FROM transaccion WHERE idempotency_key = p_idempotency_key;
        RETURN v_existente;
END;
$$;



NOTIFY pgrst, 'reload schema';
