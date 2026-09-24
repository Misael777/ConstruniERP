-- Bundle de cambios de negocio de Cuentas por Pagar/Cobrar (ver Documentacion/tests/README.md, H4, H6, H7):
--
--  H4  Cuentas por Pagar pueden estar en dólares (igual que Cobrar): columnas moneda/monto_dolares/tipo_cambio.
--      Toda cuenta lleva su monto en SOLES (monto_comprometido = monto_dolares x tipo_cambio si es USD); los
--      pagos/cobros descuentan el equivalente en soles de su transacción (fn_monto_soles_transaccion), así que
--      un pago de US$100 a TC 3.75 descuenta 375, no 100. fn_crear_transaccion además exige tipo_cambio en
--      transacciones en dólares y calcula monto_convertido si no vino.
--  H7  Pago parcial de una cuota = fraccionamiento: pagar una cuota programada con una transacción MENOR parte
--      la cuota (lo pagado queda 'pagado' por ese monto y el resto sigue 'programado' en la misma fecha). Una
--      transacción MAYOR que la cuota se rechaza (MONTO_EXCEDE_CUOTA).
--  H6  El saldo de una Cuenta por Cobrar sale de SUS PROPIOS cobros 'cobrado' (igual que Pagar sale de sus
--      pagos), ya no de todos los ingresos hacia el centro de costo destino.
--
-- Todo CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS: no borra ni reescribe filas. Las columnas
-- monto_cobrado/saldo_pendiente/estado de las cuentas por cobrar EXISTENTES se corrigen la próxima vez que
-- se recalculen (al registrar un cobro o al listar la pantalla).

-- ---------- H4: moneda en Cuentas por Pagar ----------
ALTER TABLE cuentas_pagar ADD COLUMN IF NOT EXISTS moneda VARCHAR(3) NOT NULL DEFAULT 'PEN';
ALTER TABLE cuentas_pagar ADD COLUMN IF NOT EXISTS monto_dolares NUMERIC;
ALTER TABLE cuentas_pagar ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(12,2);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cuentas_pagar_moneda_check') THEN
        ALTER TABLE cuentas_pagar ADD CONSTRAINT cuentas_pagar_moneda_check CHECK (moneda IN ('PEN', 'USD'));
    END IF;
END $$;

-- Monto de una transacción expresado en soles (lo que descuenta de la cuenta).
CREATE OR REPLACE FUNCTION fn_monto_soles_transaccion(t transaccion) RETURNS NUMERIC
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN COALESCE(t.tipo_moneda, 'soles') = 'dolares'
                THEN COALESCE(t.monto_convertido, ROUND(t.monto_total * COALESCE(t.tipo_cambio, 0), 2))
                ELSE t.monto_total END
$$;

-- ---------- fn_crear_transaccion: exige tipo de cambio en dólares ----------
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

    -- Transacción en dólares: exige tipo de cambio y calcula el monto en soles si no vino (antes solo lo
    -- calculaba el formulario, así que cualquier otro camino lo dejaba en NULL).
    IF COALESCE(v_row.tipo_moneda, 'soles') = 'dolares' THEN
        IF v_row.tipo_cambio IS NULL OR v_row.tipo_cambio <= 0 THEN
            RAISE EXCEPTION 'Una transacción en dólares requiere tipo de cambio' USING HINT = 'TIPO_CAMBIO_REQUERIDO';
        END IF;
        IF v_row.monto_convertido IS NULL THEN
            v_row.monto_convertido := ROUND(v_row.monto_total * v_row.tipo_cambio, 2);
        END IF;
    END IF;

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

-- ---------- H7 + H4: fn_confirmar_pago ----------
CREATE OR REPLACE FUNCTION fn_confirmar_pago(
    p_id_cuenta_pagar BIGINT, p_transaccion_payload JSONB, p_id_pago BIGINT DEFAULT NULL,
    p_pago_payload JSONB DEFAULT NULL, p_idempotency_key UUID DEFAULT NULL
) RETURNS pagos
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
    v_cuenta cuentas_pagar;
    v_pago pagos;
    v_pago_existente pagos;
    v_transaccion transaccion;
    v_t transaccion;
    v_comprometido NUMERIC;
    v_disponible NUMERIC;
    v_soles NUMERIC;
    v_resto NUMERIC;
BEGIN
    SELECT * INTO v_cuenta FROM cuentas_pagar WHERE id_cuenta_pagar = p_id_cuenta_pagar FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cuenta por pagar % no encontrada', p_id_cuenta_pagar USING HINT = 'CUENTA_NO_ENCONTRADA';
    END IF;

    v_t := jsonb_populate_record(NULL::transaccion, p_transaccion_payload);
    v_soles := fn_monto_soles_transaccion(v_t);

    IF p_id_pago IS NOT NULL THEN
        SELECT * INTO v_pago FROM pagos WHERE id_pago = p_id_pago FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Pago % no encontrado', p_id_pago USING HINT = 'CUENTA_NO_ENCONTRADA';
        END IF;
        IF v_pago.estado_pago = 'pagado' THEN
            RETURN v_pago; -- doble-click/reintento: ya estaba confirmado, no-op idempotente
        END IF;
        IF v_soles - v_pago.monto > 0.01 THEN
            RAISE EXCEPTION 'El monto % supera el de la cuota %', v_soles, v_pago.monto USING HINT = 'MONTO_EXCEDE_CUOTA';
        END IF;
    ELSE
        SELECT COALESCE(SUM(monto), 0) INTO v_comprometido FROM pagos
            WHERE id_cuenta_pagar = p_id_cuenta_pagar AND estado_pago <> 'cancelado';
        v_disponible := v_cuenta.monto_comprometido - v_comprometido;
        IF v_soles - v_disponible > 0.01 THEN
            RAISE EXCEPTION 'El monto % supera lo disponible % en la cuenta', v_soles, v_disponible
                USING HINT = 'MONTO_EXCEDE_COMPROMETIDO';
        END IF;
    END IF;

    v_transaccion := fn_crear_transaccion(p_transaccion_payload, p_idempotency_key);
    v_soles := fn_monto_soles_transaccion(v_transaccion);

    IF p_id_pago IS NOT NULL THEN
        v_resto := ROUND(v_pago.monto - v_soles, 2);
        UPDATE pagos SET estado_pago = 'pagado', id_transaccion = v_transaccion.id_transaccion, monto = v_soles
            WHERE id_pago = p_id_pago
            RETURNING * INTO v_pago;
        IF v_resto > 0.01 THEN
            -- Pago parcial de una cuota: el resto sigue programado en la misma fecha (fraccionamiento).
            INSERT INTO pagos (id_cuenta_pagar, monto, fecha_pago, estado_pago)
            VALUES (p_id_cuenta_pagar, v_resto, v_pago.fecha_pago, 'programado');
        END IF;
    ELSE
        SELECT * INTO v_pago_existente FROM pagos WHERE id_transaccion = v_transaccion.id_transaccion;
        IF FOUND THEN
            v_pago := v_pago_existente; -- ya se había insertado en un reintento anterior con la misma key
        ELSE
            INSERT INTO pagos (id_cuenta_pagar, monto, fecha_pago, medio_pago, num_operacion, usuario_registro, referencia, estado_pago, id_transaccion)
            SELECT p_id_cuenta_pagar, v_soles, r.fecha_pago, r.medio_pago, r.num_operacion, r.usuario_registro, r.referencia, 'pagado', v_transaccion.id_transaccion
            FROM jsonb_populate_record(NULL::pagos, p_pago_payload) r
            RETURNING * INTO v_pago;
        END IF;
    END IF;

    PERFORM fn_recalcular_cuenta_pagar(p_id_cuenta_pagar);

    RETURN v_pago;
END;
$$;

-- ---------- H7 + H4: fn_confirmar_cobro ----------
CREATE OR REPLACE FUNCTION fn_confirmar_cobro(
    p_id_cuenta_cobrar BIGINT, p_transaccion_payload JSONB, p_id_cobro BIGINT DEFAULT NULL,
    p_cobro_payload JSONB DEFAULT NULL, p_idempotency_key UUID DEFAULT NULL
) RETURNS cobros
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
    v_cuenta cuentas_cobrar;
    v_cobro cobros;
    v_cobro_existente cobros;
    v_transaccion transaccion;
    v_t transaccion;
    v_comprometido NUMERIC;
    v_disponible NUMERIC;
    v_soles NUMERIC;
    v_resto NUMERIC;
BEGIN
    SELECT * INTO v_cuenta FROM cuentas_cobrar WHERE id_cuenta_cobrar = p_id_cuenta_cobrar FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cuenta por cobrar % no encontrada', p_id_cuenta_cobrar USING HINT = 'CUENTA_NO_ENCONTRADA';
    END IF;

    v_t := jsonb_populate_record(NULL::transaccion, p_transaccion_payload);
    v_soles := fn_monto_soles_transaccion(v_t);

    IF p_id_cobro IS NOT NULL THEN
        SELECT * INTO v_cobro FROM cobros WHERE id_cobro = p_id_cobro FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Cobro % no encontrado', p_id_cobro USING HINT = 'CUENTA_NO_ENCONTRADA';
        END IF;
        IF v_cobro.estado_cobro = 'cobrado' THEN
            RETURN v_cobro;
        END IF;
        IF v_soles - v_cobro.monto > 0.01 THEN
            RAISE EXCEPTION 'El monto % supera el de la cuota %', v_soles, v_cobro.monto USING HINT = 'MONTO_EXCEDE_CUOTA';
        END IF;
    ELSE
        SELECT COALESCE(SUM(monto), 0) INTO v_comprometido FROM cobros
            WHERE id_cuenta_cobrar = p_id_cuenta_cobrar AND estado_cobro <> 'cancelado';
        v_disponible := v_cuenta.monto - v_comprometido;
        IF v_soles - v_disponible > 0.01 THEN
            RAISE EXCEPTION 'El monto % supera lo disponible % en la cuenta', v_soles, v_disponible
                USING HINT = 'MONTO_EXCEDE_COMPROMETIDO';
        END IF;
    END IF;

    v_transaccion := fn_crear_transaccion(p_transaccion_payload, p_idempotency_key);
    v_soles := fn_monto_soles_transaccion(v_transaccion);

    IF p_id_cobro IS NOT NULL THEN
        v_resto := ROUND(v_cobro.monto - v_soles, 2);
        UPDATE cobros SET estado_cobro = 'cobrado', id_transaccion = v_transaccion.id_transaccion, monto = v_soles
            WHERE id_cobro = p_id_cobro
            RETURNING * INTO v_cobro;
        IF v_resto > 0.01 THEN
            INSERT INTO cobros (id_cuenta_cobrar, monto, fecha_cobro, estado_cobro)
            VALUES (p_id_cuenta_cobrar, v_resto, v_cobro.fecha_cobro, 'programado');
        END IF;
    ELSE
        SELECT * INTO v_cobro_existente FROM cobros WHERE id_transaccion = v_transaccion.id_transaccion;
        IF FOUND THEN
            v_cobro := v_cobro_existente;
        ELSE
            INSERT INTO cobros (id_cuenta_cobrar, monto, fecha_cobro, medio_cobro, num_operacion, cuenta_banco, usuario_registro, referencia, estado_cobro, id_transaccion)
            SELECT p_id_cuenta_cobrar, v_soles, r.fecha_cobro, r.medio_cobro, r.num_operacion, r.cuenta_banco, r.usuario_registro, r.referencia, 'cobrado', v_transaccion.id_transaccion
            FROM jsonb_populate_record(NULL::cobros, p_cobro_payload) r
            RETURNING * INTO v_cobro;
        END IF;
    END IF;

    PERFORM fn_recalcular_cuenta_cobrar(p_id_cuenta_cobrar);

    RETURN v_cobro;
END;
$$;

-- ---------- H6: el saldo de una cuenta por cobrar sale de sus propios cobros ----------
CREATE OR REPLACE FUNCTION fn_recalcular_cuenta_cobrar(p_id_cuenta_cobrar BIGINT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
    v_cuenta cuentas_cobrar;
    v_recibido NUMERIC := 0;
    v_saldo NUMERIC;
    v_estado VARCHAR;
BEGIN
    SELECT * INTO v_cuenta FROM cuentas_cobrar WHERE id_cuenta_cobrar = p_id_cuenta_cobrar FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT COALESCE(SUM(monto) FILTER (WHERE estado_cobro = 'cobrado'), 0) INTO v_recibido
    FROM cobros WHERE id_cuenta_cobrar = p_id_cuenta_cobrar;

    v_saldo := GREATEST(v_cuenta.monto - v_recibido, 0);
    v_estado := CASE
        WHEN v_saldo <= 0 THEN 'pagado'
        WHEN v_cuenta.fecha_vencimiento IS NOT NULL AND v_cuenta.fecha_vencimiento < CURRENT_DATE THEN 'vencido'
        ELSE 'pendiente'
    END;

    UPDATE cuentas_cobrar SET monto_cobrado = v_recibido, saldo_pendiente = v_saldo, estado = v_estado
    WHERE id_cuenta_cobrar = p_id_cuenta_cobrar;
END;
$$;

NOTIFY pgrst, 'reload schema';
