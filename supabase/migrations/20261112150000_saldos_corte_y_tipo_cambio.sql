-- Decisiones del cliente (12/11/2026), tras la suite de punta a punta de Control Financiero:
--   (1) El PUNTO DE CORTE vale en todo el sistema, no solo en Control Financiero: el saldo de un centro de costo es su
--       última apertura + los movimientos POSTERIORES a la fecha de corte (igual que ya pasaba con las cuentas
--       bancarias). Antes el bloqueo por saldo y el "Saldo actual" del formulario usaban todo el historial: después de
--       un corte no se podía gastar lo declarado.
--   (2) "Toda transacción en diferente moneda debe aplicar el tipo de cambio, como en el banco":
--       - los centros de costo se llevan en SOLES: un movimiento en dólares cuenta monto × tipo de cambio;
--       - cada cuenta bancaria se lleva en SU moneda: soles que entran/salen de una cuenta en dólares se dividen entre
--         el tipo de cambio, dólares que entran/salen de una cuenta en soles se multiplican;
--       - el tipo de cambio es obligatorio cuando la moneda de la transacción y la de alguna de sus cuentas difieren.
-- Una sola fuente de verdad: fn_saldo_centro_costo / fn_saldos_centros_costo / fn_saldos_cuentas_banco las usan el
-- bloqueo (fn_crear_transaccion), el formulario, Centros de Costo y Control Financiero.
-- No cambia ningún dato existente.

-- ───────── Monto de una transacción en la moneda de una cuenta bancaria ─────────
CREATE OR REPLACE FUNCTION public.fn_monto_en_moneda_cuenta(t transaccion, p_moneda_cuenta text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
    SELECT CASE
        WHEN COALESCE(p_moneda_cuenta, 'soles') NOT IN ('soles', 'dolares') THEN t.monto_total
        WHEN COALESCE(t.tipo_moneda, 'soles') = COALESCE(p_moneda_cuenta, 'soles') THEN t.monto_total
        WHEN p_moneda_cuenta = 'soles' THEN fn_monto_soles_transaccion(t)          -- dólares que entran/salen de una cuenta en soles
        ELSE ROUND(t.monto_total / NULLIF(t.tipo_cambio, 0), 2)                   -- soles que entran/salen de una cuenta en dólares
    END
$function$;

-- ───────── Saldo de una cuenta bancaria, en SU moneda (misma regla de corte de siempre) ─────────
CREATE OR REPLACE FUNCTION public.fn_saldo_calculado_cuenta_banco(p_numero_cuenta character varying)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_cuenta cuenta_banco;
    v_apertura_monto numeric;
    v_apertura_fecha date;
    v_neto numeric;
BEGIN
    IF p_numero_cuenta IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO v_cuenta FROM cuenta_banco WHERE numero_cuenta = p_numero_cuenta;
    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT monto, fecha_corte INTO v_apertura_monto, v_apertura_fecha
    FROM apertura_financiera
    WHERE id_cuenta_banco = v_cuenta.id_cuenta_banco
    ORDER BY fecha_corte DESC, created_at DESC
    LIMIT 1;

    SELECT COALESCE(sum(
        CASE WHEN t.cuente_origen = p_numero_cuenta THEN -fn_monto_en_moneda_cuenta(t, v_cuenta.tipo_moneda) ELSE 0 END +
        CASE WHEN t.cuente_destino = p_numero_cuenta THEN fn_monto_en_moneda_cuenta(t, v_cuenta.tipo_moneda) ELSE 0 END
    ), 0) INTO v_neto
    FROM transaccion t
    WHERE t.estado = 'activo'
      AND (t.cuente_origen = p_numero_cuenta OR t.cuente_destino = p_numero_cuenta)
      AND (v_apertura_fecha IS NULL OR t.fecha > v_apertura_fecha);

    RETURN COALESCE(v_apertura_monto, v_cuenta.saldo_inicial) + v_neto;
END $function$;

-- ───────── Saldos de cuentas bancarias: en su moneda y su equivalente en soles (para el cuadre) ─────────
-- Equivalente en soles = base (apertura o saldo inicial) + movimientos posteriores, cada uno por su monto EN SOLES. La
-- base de una cuenta en dólares no tiene tipo de cambio propio: se convierte con el último tipo de cambio usado en un
-- movimiento de esa cuenta (sin ninguno, queda tal cual y `base_sin_tipo_cambio` lo avisa).
CREATE OR REPLACE FUNCTION public.fn_saldos_cuentas_banco()
 RETURNS TABLE (numero_cuenta varchar, titular_cuenta varchar, tipo_moneda varchar, saldo numeric, saldo_soles numeric, base_sin_tipo_cambio boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    WITH cb AS (
        SELECT c.*, a.monto AS ap_monto, a.fecha_corte AS ap_fecha
        FROM cuenta_banco c
        LEFT JOIN LATERAL (
            SELECT monto, fecha_corte FROM apertura_financiera a
            WHERE a.id_cuenta_banco = c.id_cuenta_banco ORDER BY fecha_corte DESC, created_at DESC LIMIT 1
        ) a ON true
        WHERE c.activo
    )
    SELECT cb.numero_cuenta, cb.titular_cuenta, cb.tipo_moneda, cb.saldo_actual,
        ROUND(
            CASE WHEN cb.tipo_moneda = 'dolares'
                 THEN COALESCE(cb.ap_monto, cb.saldo_inicial) * COALESCE(tc.tc, 1)
                 ELSE COALESCE(cb.ap_monto, cb.saldo_inicial) END
          + COALESCE((
                SELECT sum(CASE WHEN t.cuente_destino = cb.numero_cuenta THEN fn_monto_soles_transaccion(t) ELSE 0 END
                         - CASE WHEN t.cuente_origen = cb.numero_cuenta THEN fn_monto_soles_transaccion(t) ELSE 0 END)
                FROM transaccion t
                WHERE t.estado = 'activo'
                  AND (t.cuente_origen = cb.numero_cuenta OR t.cuente_destino = cb.numero_cuenta)
                  AND (cb.ap_fecha IS NULL OR t.fecha > cb.ap_fecha)), 0), 2),
        (cb.tipo_moneda = 'dolares' AND COALESCE(cb.ap_monto, cb.saldo_inicial) <> 0 AND tc.tc IS NULL)
    FROM cb
    LEFT JOIN LATERAL (
        SELECT t.tipo_cambio AS tc FROM transaccion t
        WHERE t.estado = 'activo' AND t.tipo_cambio IS NOT NULL AND (t.cuente_origen = cb.numero_cuenta OR t.cuente_destino = cb.numero_cuenta)
        ORDER BY t.fecha DESC, t.id_transaccion DESC LIMIT 1
    ) tc ON cb.tipo_moneda = 'dolares'
$function$;

-- ───────── Saldo de un centro de costo, en soles, con su punto de corte ─────────
-- p_excluir: no cuenta esa transacción (al editarla). p_fecha: si se pasa y cae EN o ANTES del corte del centro,
-- devuelve NULL = "esa transacción no afecta el saldo vigente" (misma regla que las cuentas bancarias).
CREATE OR REPLACE FUNCTION public.fn_saldo_centro_costo(p_id_centro_costo bigint, p_excluir bigint DEFAULT NULL, p_fecha date DEFAULT NULL)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
    v_monto numeric;
    v_corte date;
    v_neto numeric;
BEGIN
    SELECT monto, fecha_corte INTO v_monto, v_corte
    FROM apertura_financiera WHERE id_centro_costo = p_id_centro_costo
    ORDER BY fecha_corte DESC, created_at DESC LIMIT 1;

    IF p_fecha IS NOT NULL AND v_corte IS NOT NULL AND p_fecha <= v_corte THEN
        RETURN NULL;
    END IF;

    SELECT COALESCE(sum(
        CASE WHEN t.id_centro_costo_destino = p_id_centro_costo AND t.tipo IN ('ingreso', 'financiamiento', 'transferencia') THEN fn_monto_soles_transaccion(t) ELSE 0 END -
        CASE WHEN t.id_centro_costo_origen = p_id_centro_costo AND t.tipo IN ('egreso', 'transferencia') THEN fn_monto_soles_transaccion(t) ELSE 0 END
    ), 0) INTO v_neto
    FROM transaccion t
    WHERE t.estado = 'activo'
      AND (t.id_centro_costo_origen = p_id_centro_costo OR t.id_centro_costo_destino = p_id_centro_costo)
      AND (v_corte IS NULL OR t.fecha > v_corte)
      AND (p_excluir IS NULL OR t.id_transaccion <> p_excluir);

    RETURN ROUND(COALESCE(v_monto, 0) + v_neto, 2);
END $function$;

-- Todos los centros de un tirón (formulario, Centros de Costo, Control Financiero).
CREATE OR REPLACE FUNCTION public.fn_saldos_centros_costo()
 RETURNS TABLE (id_centro_costo bigint, saldo numeric, fecha_corte date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    WITH ap AS (
        SELECT DISTINCT ON (a.id_centro_costo) a.id_centro_costo, a.monto, a.fecha_corte
        FROM apertura_financiera a WHERE a.id_centro_costo IS NOT NULL
        ORDER BY a.id_centro_costo, a.fecha_corte DESC, a.created_at DESC
    ), mov AS (
        SELECT t.id_centro_costo_destino AS id, t.fecha, fn_monto_soles_transaccion(t) AS m
        FROM transaccion t WHERE t.estado = 'activo' AND t.tipo IN ('ingreso', 'financiamiento', 'transferencia') AND t.id_centro_costo_destino IS NOT NULL
        UNION ALL
        SELECT t.id_centro_costo_origen, t.fecha, -fn_monto_soles_transaccion(t)
        FROM transaccion t WHERE t.estado = 'activo' AND t.tipo IN ('egreso', 'transferencia') AND t.id_centro_costo_origen IS NOT NULL
    )
    SELECT c.id_centro_costo,
           ROUND(COALESCE(ap.monto, 0) + COALESCE(sum(mov.m) FILTER (WHERE ap.fecha_corte IS NULL OR mov.fecha > ap.fecha_corte), 0), 2),
           ap.fecha_corte
    FROM centro_costo c
    LEFT JOIN ap ON ap.id_centro_costo = c.id_centro_costo
    LEFT JOIN mov ON mov.id = c.id_centro_costo
    GROUP BY c.id_centro_costo, ap.monto, ap.fecha_corte
$function$;

-- ───────── Tipo de cambio obligatorio cuando hay dos monedas (cualquier camino: crear, editar, scripts) ─────────
CREATE OR REPLACE FUNCTION public.fn_trg_transaccion_tipo_cambio()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    v_moneda text := COALESCE(NEW.tipo_moneda, 'soles');
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.monto_total IS NOT DISTINCT FROM OLD.monto_total AND NEW.tipo_moneda IS NOT DISTINCT FROM OLD.tipo_moneda
       AND NEW.tipo_cambio IS NOT DISTINCT FROM OLD.tipo_cambio AND NEW.monto_convertido IS NOT DISTINCT FROM OLD.monto_convertido
       AND NEW.cuente_origen IS NOT DISTINCT FROM OLD.cuente_origen AND NEW.cuente_destino IS NOT DISTINCT FROM OLD.cuente_destino THEN
        RETURN NEW; -- ej. anular/aprobar: no toca montos ni cuentas
    END IF;

    IF v_moneda = 'dolares' OR EXISTS (
        SELECT 1 FROM cuenta_banco cb
        WHERE cb.numero_cuenta IN (NEW.cuente_origen, NEW.cuente_destino)
          AND cb.tipo_moneda IN ('soles', 'dolares') AND cb.tipo_moneda <> v_moneda
    ) THEN
        IF NEW.tipo_cambio IS NULL OR NEW.tipo_cambio <= 0 THEN
            RAISE EXCEPTION 'Esta transacción mueve dinero entre soles y dólares: ingresa el tipo de cambio (S/ por US$).'
                USING HINT = 'TIPO_CAMBIO_REQUERIDO';
        END IF;
    END IF;

    -- En dólares, el equivalente en soles siempre = monto × tipo de cambio (si se editó el monto o el tipo de cambio,
    -- un monto_convertido viejo dejaría el centro de costo con un valor equivocado).
    IF v_moneda = 'dolares' AND (NEW.monto_convertido IS NULL OR abs(NEW.monto_convertido - NEW.monto_total * NEW.tipo_cambio) > 0.005) THEN
        NEW.monto_convertido := ROUND(NEW.monto_total * NEW.tipo_cambio, 4);
    END IF;
    RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_transaccion_tipo_cambio ON public.transaccion;
CREATE TRIGGER trg_transaccion_tipo_cambio
    BEFORE INSERT OR UPDATE ON public.transaccion
    FOR EACH ROW EXECUTE FUNCTION fn_trg_transaccion_tipo_cambio();

-- ───────── fn_crear_transaccion: el bloqueo por saldo usa fn_saldo_centro_costo (corte + soles) ─────────
-- Igual a la versión vigente salvo: (a) el cálculo del saldo del centro, (b) el monto que se compara está en soles,
-- (c) el tipo de cambio se resuelve ANTES del chequeo (lo necesita para pasar a soles).
CREATE OR REPLACE FUNCTION public.fn_crear_transaccion(p_payload jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS transaccion
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_row transaccion;
    v_existente transaccion;
    v_tipo VARCHAR;
    v_id_centro_origen BIGINT;
    v_es_interno BOOLEAN;
    v_saldo_centro NUMERIC;
    v_monto_soles NUMERIC;
    v_cuenta_origen VARCHAR;
    v_cuenta_destino VARCHAR;
    v_id_cb_origen BIGINT;
    v_id_cb_destino BIGINT;
BEGIN
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existente FROM transaccion WHERE idempotency_key = p_idempotency_key;
        IF FOUND THEN RETURN v_existente; END IF;
    END IF;

    v_row := jsonb_populate_record(NULL::transaccion, p_payload);
    v_tipo := v_row.tipo;
    v_id_centro_origen := v_row.id_centro_costo_origen;
    v_cuenta_origen := v_row.cuente_origen;
    v_cuenta_destino := v_row.cuente_destino;

    IF COALESCE(v_row.tipo_moneda, 'soles') = 'dolares' THEN
        IF v_row.tipo_cambio IS NULL OR v_row.tipo_cambio <= 0 THEN
            RAISE EXCEPTION 'Una transacción en dólares requiere tipo de cambio' USING HINT = 'TIPO_CAMBIO_REQUERIDO';
        END IF;
        IF v_row.monto_convertido IS NULL THEN
            v_row.monto_convertido := ROUND(v_row.monto_total * v_row.tipo_cambio, 2);
        END IF;
    END IF;
    v_monto_soles := fn_monto_soles_transaccion(v_row);

    -- Auditoría de saldo: Egreso/Transferencia desde un centro PROPIO (sin cliente/proveedor/empleado). Saldo vigente =
    -- último corte + movimientos posteriores, en soles (fn_saldo_centro_costo). Si la transacción cae en o antes del
    -- corte del centro, no afecta su saldo vigente y no se audita (misma regla que las cuentas bancarias).
    IF v_tipo IN ('egreso', 'transferencia') AND v_id_centro_origen IS NOT NULL THEN
        SELECT (id_cliente IS NULL AND id_proveedor IS NULL AND id_empleado IS NULL) INTO v_es_interno
        FROM centro_costo WHERE id_centro_costo = v_id_centro_origen FOR UPDATE;

        IF v_es_interno THEN
            v_saldo_centro := fn_saldo_centro_costo(v_id_centro_origen, NULL, v_row.fecha);
            IF v_saldo_centro IS NOT NULL AND v_saldo_centro - v_monto_soles < -0.01 THEN
                RAISE EXCEPTION 'Saldo insuficiente en el centro de costo de origen: disponible %, se requieren %', v_saldo_centro, v_monto_soles
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
        SELECT * INTO v_existente FROM transaccion WHERE idempotency_key = p_idempotency_key;
        RETURN v_existente;
END;
$function$;

-- Permisos: lectura de saldos para usuarios con sesión (y service_role); nunca anon.
REVOKE ALL ON FUNCTION public.fn_saldo_centro_costo(bigint, bigint, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_saldos_centros_costo() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_saldos_cuentas_banco() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_crear_transaccion(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_saldo_centro_costo(bigint, bigint, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_saldos_centros_costo() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_saldos_cuentas_banco() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_crear_transaccion(jsonb, uuid) TO authenticated, service_role;

-- saldo_actual es derivado: se recalcula con la regla nueva (solo cambia en cuentas con movimientos en otra moneda).
SELECT fn_recalcular_saldo_cuenta_banco(numero_cuenta) FROM cuenta_banco;

NOTIFY pgrst, 'reload schema';
