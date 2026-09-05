-- ============================================================================
-- MIGRACIÓN: Integridad transaccional del módulo financiero (RPC atómicos)
-- ============================================================================
-- Contexto: ConstruniERP es 100% cliente-Supabase (clave anon, sin RLS, sin backend
-- propio). Una auditoría de integridad financiera confirmó que NINGUNA operación de
-- dinero (crear transacción, confirmar un pago/cobro, anular una transacción) es
-- atómica hoy: cada una es una secuencia de SELECT/INSERT/UPDATE independientes desde
-- el cliente, sin locks, sin transacción envolvente y sin idempotencia — lo que
-- permite condiciones de carrera confirmadas (sobregiro, "lost update" en saldos,
-- transacciones huérfanas si un paso intermedio falla, doble-envío por doble-click o
-- retry de red).
--
-- Esta migración agrega 7 funciones Postgres (`SECURITY DEFINER`, invocadas vía
-- `supabase.rpc(...)` desde el cliente) que ejecutan como UNA sola transacción de BD
-- con bloqueo de filas (`SELECT ... FOR UPDATE`) en un orden determinista, más una
-- idempotency key y un puñado de CHECK constraints de respaldo. No reemplaza nada del
-- resto del ERP — el resto de la app sigue igual.
--
-- Orden determinista de bloqueo (evita deadlocks entre cualquier combinación de las 4
-- funciones de negocio): fila de `transaccion` existente (solo al anular) -> fila de
-- `cuentas_pagar`/`cuentas_cobrar` (solo al confirmar pago/cobro o anular) -> fila de
-- `centro_costo` origen -> fila(s) de `cuenta_banco` en orden ascendente de id.
--
-- Idempotente: se puede correr más de una vez sin error (CREATE OR REPLACE FUNCTION,
-- ADD COLUMN IF NOT EXISTS, DO $$...$$ para constraints buscando por definición real
-- en vez de por nombre asumido).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Idempotency key en `transaccion`
-- ----------------------------------------------------------------------------
-- Nullable a propósito: las filas existentes quedan en NULL, el índice único es
-- parcial (solo aplica cuando el cliente sí manda una key), así que no rompe nada.
ALTER TABLE transaccion ADD COLUMN IF NOT EXISTS idempotency_key UUID;
CREATE UNIQUE INDEX IF NOT EXISTS uq_transaccion_idempotency_key
    ON transaccion (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. CHECK constraints de respaldo
-- ----------------------------------------------------------------------------

-- `transaccion.tipo`: bug real confirmado — el CHECK vivo solo permitía
-- 'ingreso'/'egreso', pero la app también escribe 'financiamiento'/'transferencia'.
-- Word-boundary (\m..\M) para no atrapar de paso el CHECK de `tipo_alcance`.
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'transaccion'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ~ '\mtipo\M'
    LOOP
        EXECUTE format('ALTER TABLE transaccion DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;
ALTER TABLE transaccion
    ADD CONSTRAINT transaccion_tipo_check
    CHECK (tipo IN ('ingreso', 'egreso', 'financiamiento', 'transferencia'));

-- `transaccion.estado`: hoy sin restricción alguna (VARCHAR(10) libre).
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'transaccion'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ~ '\mestado\M'
    LOOP
        EXECUTE format('ALTER TABLE transaccion DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;
ALTER TABLE transaccion
    ADD CONSTRAINT transaccion_estado_check
    CHECK (estado IN ('activo', 'anulado', 'consulta'));

-- Saldos no negativos — respaldo además del bloqueo atómico de los RPC de abajo.
-- Confirmado con el usuario: ninguna cuenta bancaria del ERP debe poder ir en negativo.
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'cuenta_banco'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ~ '\msaldo_actual\M'
    LOOP
        EXECUTE format('ALTER TABLE cuenta_banco DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;
ALTER TABLE cuenta_banco ADD CONSTRAINT cuenta_banco_saldo_actual_check CHECK (saldo_actual >= 0);

DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'cuentas_pagar'::regclass AND contype = 'c'
          AND (pg_get_constraintdef(oid) ~ '\msaldo_pendiente\M' OR pg_get_constraintdef(oid) ~ '\mmonto_pagado\M')
    LOOP
        EXECUTE format('ALTER TABLE cuentas_pagar DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;
ALTER TABLE cuentas_pagar ADD CONSTRAINT cuentas_pagar_saldo_pendiente_check CHECK (saldo_pendiente >= 0);
ALTER TABLE cuentas_pagar ADD CONSTRAINT cuentas_pagar_monto_pagado_check CHECK (monto_pagado >= 0);

DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'cuentas_cobrar'::regclass AND contype = 'c'
          AND (pg_get_constraintdef(oid) ~ '\msaldo_pendiente\M' OR pg_get_constraintdef(oid) ~ '\mmonto_cobrado\M')
    LOOP
        EXECUTE format('ALTER TABLE cuentas_cobrar DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;
ALTER TABLE cuentas_cobrar ADD CONSTRAINT cuentas_cobrar_saldo_pendiente_check CHECK (saldo_pendiente >= 0);
ALTER TABLE cuentas_cobrar ADD CONSTRAINT cuentas_cobrar_monto_cobrado_check CHECK (monto_cobrado >= 0);

-- Enum real de estado_pago/estado_cobro (ver Pago/Cobro en cuentasPagar.service.ts /
-- cuentasCobrar.service.ts — hoy solo viven como tipos de TypeScript, sin CHECK en BD).
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'pagos'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ~ '\mestado_pago\M'
    LOOP
        EXECUTE format('ALTER TABLE pagos DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;
ALTER TABLE pagos ADD CONSTRAINT pagos_estado_pago_check CHECK (estado_pago IN ('programado', 'pagado', 'cancelado'));

DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'cobros'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ~ '\mestado_cobro\M'
    LOOP
        EXECUTE format('ALTER TABLE cobros DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;
ALTER TABLE cobros ADD CONSTRAINT cobros_estado_cobro_check CHECK (estado_cobro IN ('programado', 'cobrado', 'cancelado'));

-- ----------------------------------------------------------------------------
-- 3. Primitivas de recálculo atómico (reemplazan recalcularSaldoCuentaBanco /
--    recalcularCuentaPagar / recalcularCuentaCobrar de TS 1:1 en su fórmula — ver esos
--    archivos —, pero ahora bajo `FOR UPDATE`: cualquier llamada concurrente sobre la
--    misma fila espera su turno en vez de pisar el UPDATE de otra con un cálculo viejo).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_recalcular_saldo_cuenta_banco(p_numero_cuenta VARCHAR)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cuenta cuenta_banco;
    v_neto NUMERIC;
BEGIN
    IF p_numero_cuenta IS NULL THEN RETURN; END IF;

    SELECT * INTO v_cuenta FROM cuenta_banco WHERE numero_cuenta = p_numero_cuenta FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT COALESCE(SUM(
        CASE WHEN cuente_origen = p_numero_cuenta THEN -monto_total ELSE 0 END +
        CASE WHEN cuente_destino = p_numero_cuenta THEN monto_total ELSE 0 END
    ), 0) INTO v_neto
    FROM transaccion
    WHERE estado = 'activo' AND (cuente_origen = p_numero_cuenta OR cuente_destino = p_numero_cuenta);

    UPDATE cuenta_banco SET saldo_actual = v_cuenta.saldo_inicial + v_neto WHERE id_cuenta_banco = v_cuenta.id_cuenta_banco;
END;
$$;

CREATE OR REPLACE FUNCTION fn_recalcular_cuenta_pagar(p_id_cuenta_pagar BIGINT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cuenta cuentas_pagar;
    v_total_pagado NUMERIC;
    v_fecha_prog DATE;
    v_saldo NUMERIC;
    v_estado VARCHAR;
BEGIN
    SELECT * INTO v_cuenta FROM cuentas_pagar WHERE id_cuenta_pagar = p_id_cuenta_pagar FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT COALESCE(SUM(monto) FILTER (WHERE estado_pago = 'pagado'), 0),
           MIN(fecha_pago) FILTER (WHERE estado_pago = 'programado')
      INTO v_total_pagado, v_fecha_prog
      FROM pagos WHERE id_cuenta_pagar = p_id_cuenta_pagar;

    v_saldo := GREATEST(v_cuenta.monto_comprometido - v_total_pagado, 0);
    v_estado := CASE
        WHEN v_saldo <= 0 THEN 'pagado'
        WHEN COALESCE(v_fecha_prog, v_cuenta.fecha_vencimiento) < CURRENT_DATE THEN 'vencido'
        ELSE 'pendiente'
    END;

    UPDATE cuentas_pagar
    SET monto_pagado = v_total_pagado, saldo_pendiente = v_saldo, estado = v_estado, fecha_pago_programada = v_fecha_prog
    WHERE id_cuenta_pagar = p_id_cuenta_pagar;
END;
$$;

CREATE OR REPLACE FUNCTION fn_recalcular_cuenta_cobrar(p_id_cuenta_cobrar BIGINT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cuenta cuentas_cobrar;
    v_recibido NUMERIC := 0;
    v_saldo NUMERIC;
    v_estado VARCHAR;
BEGIN
    SELECT * INTO v_cuenta FROM cuentas_cobrar WHERE id_cuenta_cobrar = p_id_cuenta_cobrar FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;

    IF v_cuenta.id_centro_costo IS NOT NULL THEN
        SELECT COALESCE(SUM(monto_total), 0) INTO v_recibido
        FROM transaccion
        WHERE id_centro_costo_destino = v_cuenta.id_centro_costo AND tipo = 'ingreso' AND estado = 'activo';
    END IF;

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

-- ----------------------------------------------------------------------------
-- 4. fn_crear_transaccion — reemplaza el cuerpo de createTransaccion en
--    transacciones.service.ts. `p_payload` es el MISMO objeto que la función TS ya
--    arma (`insertData`), pasado tal cual como jsonb — `jsonb_populate_record` contra
--    el tipo fila real de `transaccion` hace el cast automático (texto->date/numeric/
--    bigint/boolean) sin que esta función tenga que conocer cada tipo de columna a
--    mano. `id_transaccion`/`created_at`/`aprobado*` quedan fuera del INSERT (los
--    maneja la BD sola, igual que antes).
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
        comprobante_autogenerado_url, tipo_alcance, idempotency_key
    ) VALUES (
        v_row.id_centro_costo_origen, v_row.id_centro_costo_destino, v_row.fecha, v_row.id_nombre, v_row.tipo_documento,
        v_row.num_documento, v_row.tipo_transaccion, v_row.num_operacion, v_row.tipo_gasto, v_row.num_comprobante_interno,
        v_row.num_recibo_pago, v_row.num_recibo_pago_no_efectivo, v_row.num_recibo_pago_proveedor, v_row.forma_pago,
        v_row.descripcion, v_row.tipo, v_row.monto_total, v_row.medio_pago, v_row.cuente_origen, v_row.cuente_destino,
        v_row.estado, v_row.usuario_registro, v_row.comprobante_url, v_row.factura_url,
        v_row.comprobante_autogenerado_url, v_row.tipo_alcance, p_idempotency_key
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

-- ----------------------------------------------------------------------------
-- 5. fn_confirmar_pago — reemplaza confirmarPagoPagado Y registrarPagoDesdeTransaccion
--    (cuentasPagar.service.ts): con `p_id_pago`, flipea una cuota 'programado' ya
--    existente a 'pagado'; sin él, inserta un pago 'pagado' nuevo directo. Ambos casos
--    corren la creación de la transacción (fn_crear_transaccion) DENTRO de la misma
--    transacción de BD que el pago y el recálculo — si cualquier paso falla, TODO se
--    revierte (ya no puede quedar una transacción huérfana sin su pago vinculado).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_confirmar_pago(
    p_id_cuenta_pagar BIGINT,
    p_transaccion_payload JSONB,
    p_id_pago BIGINT DEFAULT NULL,
    p_pago_payload JSONB DEFAULT NULL,
    p_idempotency_key UUID DEFAULT NULL
)
RETURNS pagos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cuenta cuentas_pagar;
    v_pago pagos;
    v_pago_existente pagos;
    v_transaccion transaccion;
    v_comprometido NUMERIC;
    v_disponible NUMERIC;
    v_monto_nuevo NUMERIC;
BEGIN
    SELECT * INTO v_cuenta FROM cuentas_pagar WHERE id_cuenta_pagar = p_id_cuenta_pagar FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cuenta por pagar % no encontrada', p_id_cuenta_pagar USING HINT = 'CUENTA_NO_ENCONTRADA';
    END IF;

    IF p_id_pago IS NOT NULL THEN
        SELECT * INTO v_pago FROM pagos WHERE id_pago = p_id_pago FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Pago % no encontrado', p_id_pago USING HINT = 'CUENTA_NO_ENCONTRADA';
        END IF;
        IF v_pago.estado_pago = 'pagado' THEN
            RETURN v_pago; -- doble-click/reintento: ya estaba confirmado, no-op idempotente
        END IF;
    ELSE
        -- Mismo guard que montoDisponible en cuentasPagar.service.ts, pero ahora bajo
        -- el lock de arriba — cierra el TOCTOU del chequeo original.
        SELECT COALESCE(SUM(monto), 0) INTO v_comprometido FROM pagos
            WHERE id_cuenta_pagar = p_id_cuenta_pagar AND estado_pago <> 'cancelado';
        v_disponible := v_cuenta.monto_comprometido - v_comprometido;
        v_monto_nuevo := (p_pago_payload ->> 'monto')::NUMERIC;
        IF v_monto_nuevo - v_disponible > 0.01 THEN
            RAISE EXCEPTION 'El monto % supera lo disponible % en la cuenta', v_monto_nuevo, v_disponible
                USING HINT = 'MONTO_EXCEDE_COMPROMETIDO';
        END IF;
    END IF;

    v_transaccion := fn_crear_transaccion(p_transaccion_payload, p_idempotency_key);

    IF p_id_pago IS NOT NULL THEN
        UPDATE pagos SET estado_pago = 'pagado', id_transaccion = v_transaccion.id_transaccion
            WHERE id_pago = p_id_pago
            RETURNING * INTO v_pago;
    ELSE
        SELECT * INTO v_pago_existente FROM pagos WHERE id_transaccion = v_transaccion.id_transaccion;
        IF FOUND THEN
            v_pago := v_pago_existente; -- ya se había insertado en un reintento anterior con la misma key
        ELSE
            INSERT INTO pagos (id_cuenta_pagar, monto, fecha_pago, medio_pago, num_operacion, usuario_registro, referencia, estado_pago, id_transaccion)
            SELECT p_id_cuenta_pagar, r.monto, r.fecha_pago, r.medio_pago, r.num_operacion, r.usuario_registro, r.referencia, 'pagado', v_transaccion.id_transaccion
            FROM jsonb_populate_record(NULL::pagos, p_pago_payload) r
            RETURNING * INTO v_pago;
        END IF;
    END IF;

    PERFORM fn_recalcular_cuenta_pagar(p_id_cuenta_pagar);

    RETURN v_pago;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. fn_confirmar_cobro — espejo de fn_confirmar_pago para cuentas_cobrar/cobros,
--    reemplaza confirmarCobroCobrado Y registrarCobroDesdeTransaccion.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_confirmar_cobro(
    p_id_cuenta_cobrar BIGINT,
    p_transaccion_payload JSONB,
    p_id_cobro BIGINT DEFAULT NULL,
    p_cobro_payload JSONB DEFAULT NULL,
    p_idempotency_key UUID DEFAULT NULL
)
RETURNS cobros
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cuenta cuentas_cobrar;
    v_cobro cobros;
    v_cobro_existente cobros;
    v_transaccion transaccion;
    v_comprometido NUMERIC;
    v_disponible NUMERIC;
    v_monto_nuevo NUMERIC;
BEGIN
    SELECT * INTO v_cuenta FROM cuentas_cobrar WHERE id_cuenta_cobrar = p_id_cuenta_cobrar FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cuenta por cobrar % no encontrada', p_id_cuenta_cobrar USING HINT = 'CUENTA_NO_ENCONTRADA';
    END IF;

    IF p_id_cobro IS NOT NULL THEN
        SELECT * INTO v_cobro FROM cobros WHERE id_cobro = p_id_cobro FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Cobro % no encontrado', p_id_cobro USING HINT = 'CUENTA_NO_ENCONTRADA';
        END IF;
        IF v_cobro.estado_cobro = 'cobrado' THEN
            RETURN v_cobro;
        END IF;
    ELSE
        SELECT COALESCE(SUM(monto), 0) INTO v_comprometido FROM cobros
            WHERE id_cuenta_cobrar = p_id_cuenta_cobrar AND estado_cobro <> 'cancelado';
        v_disponible := v_cuenta.monto - v_comprometido;
        v_monto_nuevo := (p_cobro_payload ->> 'monto')::NUMERIC;
        IF v_monto_nuevo - v_disponible > 0.01 THEN
            RAISE EXCEPTION 'El monto % supera lo disponible % en la cuenta', v_monto_nuevo, v_disponible
                USING HINT = 'MONTO_EXCEDE_COMPROMETIDO';
        END IF;
    END IF;

    v_transaccion := fn_crear_transaccion(p_transaccion_payload, p_idempotency_key);

    IF p_id_cobro IS NOT NULL THEN
        UPDATE cobros SET estado_cobro = 'cobrado', id_transaccion = v_transaccion.id_transaccion
            WHERE id_cobro = p_id_cobro
            RETURNING * INTO v_cobro;
    ELSE
        SELECT * INTO v_cobro_existente FROM cobros WHERE id_transaccion = v_transaccion.id_transaccion;
        IF FOUND THEN
            v_cobro := v_cobro_existente;
        ELSE
            INSERT INTO cobros (id_cuenta_cobrar, monto, fecha_cobro, medio_cobro, num_operacion, cuenta_banco, usuario_registro, referencia, estado_cobro, id_transaccion)
            SELECT p_id_cuenta_cobrar, r.monto, r.fecha_cobro, r.medio_cobro, r.num_operacion, r.cuenta_banco, r.usuario_registro, r.referencia, 'cobrado', v_transaccion.id_transaccion
            FROM jsonb_populate_record(NULL::cobros, p_cobro_payload) r
            RETURNING * INTO v_cobro;
        END IF;
    END IF;

    PERFORM fn_recalcular_cuenta_cobrar(p_id_cuenta_cobrar);

    RETURN v_cobro;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. fn_anular_transaccion — reemplaza anularTransaccion (transacciones.service.ts).
--    Bloquea la fila de `transaccion` primero (esto la hace naturalmente idempotente:
--    una segunda llamada la encuentra ya 'anulado' y no repite nada), luego cada
--    cuenta_pagar/cuenta_cobrar vinculada, en el mismo orden determinista que usan
--    fn_confirmar_pago/fn_confirmar_cobro/fn_crear_transaccion.
--
--    esAdmin sigue siendo un chequeo de UI (TransaccionModal.svelte) — igual que hoy:
--    esta BD no tiene autenticación/roles reales del lado servidor (anon key, sin
--    RLS), así que un RPC no puede verificar el rol de forma más confiable que el
--    resto del ERP. No es una regresión frente al comportamiento actual.
-- ----------------------------------------------------------------------------

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

    RETURN v_transaccion;
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. Permisos — Supabase no otorga EXECUTE en funciones nuevas por defecto; el
--    cliente llama con la clave anon, así que hace falta el GRANT explícito (mismo
--    nivel de acceso que ya tiene hoy sobre las tablas vía PostgREST).
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION fn_recalcular_saldo_cuenta_banco(VARCHAR) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_recalcular_cuenta_pagar(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_recalcular_cuenta_cobrar(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_crear_transaccion(JSONB, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_confirmar_pago(BIGINT, JSONB, BIGINT, JSONB, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_confirmar_cobro(BIGINT, JSONB, BIGINT, JSONB, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_anular_transaccion(BIGINT) TO anon, authenticated;

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
