-- ----------------------------------------------------------------------------
-- Fix: fn_crear_transaccion nunca guardaba `categoria` — bug preexistente encontrado
-- al verificar (insert de prueba real, ver sesión de Claude) el flujo nuevo
-- "Préstamo"/"Préstamo Otorgado" (crearTransaccionSistema en transacciones.service.ts).
--
-- La lista de columnas del INSERT en fn_crear_transaccion (ver 4. en
-- financial_integrity_rpc_migration.sql) se armó copiando los campos de
-- construirInsertDataTransaccion, pero se olvidó `categoria` — desde que esta función
-- reemplazó el INSERT directo de createTransaccion(), TODA transacción creada desde
-- Nueva Transacción (cualquier Categoría: Adelanto, Honorarios, Préstamo, etc.) se
-- guarda con categoria=NULL, sin importar lo que el usuario elija en el formulario.
-- `updateTransaccion` (que sigue haciendo un `.update()` directo, no pasa por esta
-- función) sí guarda `categoria` correctamente — por eso algunas transacciones viejas
-- (creadas antes de esta función, o editadas después) sí tienen el valor.
--
-- Este archivo es un CREATE OR REPLACE — mismo cuerpo que la versión original, solo
-- con `categoria` agregado a la lista de columnas y de valores del INSERT. Reemplaza
-- la función existente sin tocar ninguna fila ya guardada.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_crear_transaccion(p_payload JSONB, p_idempotency_key UUID DEFAULT NULL)
RETURNS transaccion
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    v_saldo_cuenta NUMERIC;
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
    -- dos cuentas propias, sin importar cuál es origen/destino en esta llamada.
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

    IF v_tipo IN ('egreso', 'transferencia') AND v_id_cb_origen IS NOT NULL THEN
        SELECT COALESCE(SUM(
            CASE WHEN cuente_origen = v_cuenta_origen THEN -monto_total ELSE 0 END +
            CASE WHEN cuente_destino = v_cuenta_origen THEN monto_total ELSE 0 END
        ), 0) INTO v_saldo_cuenta
        FROM transaccion
        WHERE estado = 'activo' AND (cuente_origen = v_cuenta_origen OR cuente_destino = v_cuenta_origen);

        IF v_saldo_cuenta - v_monto < -0.01 THEN
            RAISE EXCEPTION 'Saldo insuficiente en la cuenta bancaria %: disponible %, se requieren %', v_cuenta_origen, v_saldo_cuenta, v_monto
                USING HINT = 'SALDO_INSUFICIENTE';
        END IF;
    END IF;

    INSERT INTO transaccion (
        id_centro_costo_origen, id_centro_costo_destino, fecha, id_nombre, tipo_documento, num_documento,
        tipo_transaccion, num_operacion, tipo_gasto, num_comprobante_interno, num_recibo_pago,
        num_recibo_pago_no_efectivo, num_recibo_pago_proveedor, forma_pago, descripcion, tipo, monto_total,
        medio_pago, cuente_origen, cuente_destino, estado, usuario_registro, comprobante_url, factura_url,
        comprobante_autogenerado_url, tipo_alcance, categoria, idempotency_key
    ) VALUES (
        v_row.id_centro_costo_origen, v_row.id_centro_costo_destino, v_row.fecha, v_row.id_nombre, v_row.tipo_documento,
        v_row.num_documento, v_row.tipo_transaccion, v_row.num_operacion, v_row.tipo_gasto, v_row.num_comprobante_interno,
        v_row.num_recibo_pago, v_row.num_recibo_pago_no_efectivo, v_row.num_recibo_pago_proveedor, v_row.forma_pago,
        v_row.descripcion, v_row.tipo, v_row.monto_total, v_row.medio_pago, v_row.cuente_origen, v_row.cuente_destino,
        v_row.estado, v_row.usuario_registro, v_row.comprobante_url, v_row.factura_url,
        v_row.comprobante_autogenerado_url, v_row.tipo_alcance, v_row.categoria, p_idempotency_key
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
