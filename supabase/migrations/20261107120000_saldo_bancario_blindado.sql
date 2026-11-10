-- Saldo de cuentas bancarias blindado (reclamo del cliente 07/11/2026: se eliminó de forma permanente un adelanto de
-- S/ 300,000 y un ingreso de prueba de S/ 0.50, y los saldos de "EFECTIVO - CAJA FUERTE S/" y "EFECTIVO - WILLY"
-- siguieron mostrando ese dinero; Control Financiero → Conciliación mostraba una diferencia de S/ 307,500.50 = la suma
-- de los saldos sin respaldo de 5 cuentas: 300,000 + 7,040 + 360 + 100 + 0.50).
--
-- Causa (confirmada): en Producción NO estaba instalado el trigger trg_transaccion_recalcular_cuentas de
-- 20261023182400_saldo_cuenta_banco_siempre_consistente.sql (en la tabla transaccion solo existía auditoria_cambio).
-- Sin ese trigger, el saldo solo se recalcula cuando la pantalla lo pide, y varios caminos borran transacciones sin
-- pedirlo (eliminar una Cuenta por Cobrar / por Pagar borra sus transacciones directo).
-- Reproducido en Dev: sin el trigger el saldo queda en 300,000 tras borrar; con el trigger vuelve a 0.
--
-- Esta migración (idempotente, segura de correr más de una vez):
--   1) Una sola fórmula del saldo: fn_saldo_calculado_cuenta_banco (última Apertura + transacciones activas posteriores;
--      sin Apertura: saldo inicial + todas las transacciones activas). El recálculo y la verificación usan la misma.
--   2) Reinstala los triggers en transaccion, apertura_financiera y cuenta_banco (los mismos de 20261023182400).
--   3) fn_verificar_saldos_bancarios(): Control Financiero la usa para mostrar, cuenta por cuenta, saldo guardado vs
--      calculado, y avisa si el trigger falta (para que esto no vuelva a pasar en silencio).
--   4) Recalcula TODAS las cuentas una vez (corrige los S/ 307,500.50 de hoy).

-- 1) Fórmula única del saldo ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_saldo_calculado_cuenta_banco(p_numero_cuenta character varying)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cuenta cuenta_banco;
    v_apertura_monto numeric;
    v_apertura_fecha date;
    v_neto numeric;
BEGIN
    IF p_numero_cuenta IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO v_cuenta FROM cuenta_banco WHERE numero_cuenta = p_numero_cuenta;
    IF NOT FOUND THEN RETURN NULL; END IF;

    -- Apertura Financiera más reciente de ESTA cuenta (por fecha_corte, empate por created_at).
    SELECT monto, fecha_corte INTO v_apertura_monto, v_apertura_fecha
    FROM apertura_financiera
    WHERE id_cuenta_banco = v_cuenta.id_cuenta_banco
    ORDER BY fecha_corte DESC, created_at DESC
    LIMIT 1;

    SELECT COALESCE(sum(
        CASE WHEN cuente_origen = p_numero_cuenta THEN -monto_total ELSE 0 END +
        CASE WHEN cuente_destino = p_numero_cuenta THEN monto_total ELSE 0 END
    ), 0) INTO v_neto
    FROM transaccion
    WHERE estado = 'activo'
      AND (cuente_origen = p_numero_cuenta OR cuente_destino = p_numero_cuenta)
      AND (v_apertura_fecha IS NULL OR fecha > v_apertura_fecha);

    RETURN COALESCE(v_apertura_monto, v_cuenta.saldo_inicial) + v_neto;
END $$;

CREATE OR REPLACE FUNCTION public.fn_recalcular_saldo_cuenta_banco(p_numero_cuenta character varying)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_numero_cuenta IS NULL THEN RETURN; END IF;
    SELECT id_cuenta_banco INTO v_id FROM cuenta_banco WHERE numero_cuenta = p_numero_cuenta FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    UPDATE cuenta_banco SET saldo_actual = fn_saldo_calculado_cuenta_banco(p_numero_cuenta)
    WHERE id_cuenta_banco = v_id;
END $$;

-- 2) Triggers: la base recalcula sola, sin depender de qué pantalla hizo el cambio ------------------------------------
CREATE OR REPLACE FUNCTION public.fn_trg_transaccion_recalcular_cuentas()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cuentas text[] := ARRAY[]::text[];
    v_cuenta text;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        v_cuentas := v_cuentas || ARRAY[OLD.cuente_origen::text, OLD.cuente_destino::text];
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        v_cuentas := v_cuentas || ARRAY[NEW.cuente_origen::text, NEW.cuente_destino::text];
    END IF;
    FOR v_cuenta IN SELECT DISTINCT c FROM unnest(v_cuentas) AS c WHERE c IS NOT NULL AND c <> '' LOOP
        PERFORM public.fn_recalcular_saldo_cuenta_banco(v_cuenta);
    END LOOP;
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_transaccion_recalcular_cuentas ON public.transaccion;
CREATE TRIGGER trg_transaccion_recalcular_cuentas
    AFTER INSERT OR DELETE OR UPDATE OF cuente_origen, cuente_destino, monto_total, estado, fecha
    ON public.transaccion
    FOR EACH ROW EXECUTE FUNCTION public.fn_trg_transaccion_recalcular_cuentas();

CREATE OR REPLACE FUNCTION public.fn_trg_apertura_recalcular_cuenta()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_numero text;
BEGIN
    FOR v_numero IN
        SELECT DISTINCT cb.numero_cuenta FROM public.cuenta_banco cb
        WHERE cb.id_cuenta_banco IN (
            CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.id_cuenta_banco END,
            CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.id_cuenta_banco END
        )
    LOOP
        PERFORM public.fn_recalcular_saldo_cuenta_banco(v_numero);
    END LOOP;
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_apertura_recalcular_cuenta ON public.apertura_financiera;
CREATE TRIGGER trg_apertura_recalcular_cuenta
    AFTER INSERT OR DELETE OR UPDATE OF id_cuenta_banco, monto, fecha_corte
    ON public.apertura_financiera
    FOR EACH ROW EXECUTE FUNCTION public.fn_trg_apertura_recalcular_cuenta();

-- (el recálculo solo escribe saldo_actual, así que este trigger no se dispara a sí mismo)
CREATE OR REPLACE FUNCTION public.fn_trg_cuenta_banco_recalcular()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.fn_recalcular_saldo_cuenta_banco(NEW.numero_cuenta);
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_cuenta_banco_recalcular ON public.cuenta_banco;
CREATE TRIGGER trg_cuenta_banco_recalcular
    AFTER INSERT OR UPDATE OF saldo_inicial, numero_cuenta
    ON public.cuenta_banco
    FOR EACH ROW EXECUTE FUNCTION public.fn_trg_cuenta_banco_recalcular();

-- 3) Verificación para Control Financiero ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_verificar_saldos_bancarios()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT jsonb_build_object(
        'triggers_ok', (
            SELECT count(*) = 3 FROM pg_trigger
            WHERE NOT tgisinternal AND tgenabled <> 'D'
              AND tgname IN ('trg_transaccion_recalcular_cuentas', 'trg_apertura_recalcular_cuenta', 'trg_cuenta_banco_recalcular')),
        'cuentas', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'numero_cuenta', x.numero_cuenta,
                'saldo_inicial', x.saldo_inicial,
                'apertura', x.apertura,
                'saldo_actual', x.saldo_actual,
                'saldo_calculado', x.calc,
                'diferencia', round(x.saldo_actual - x.calc, 2)) ORDER BY x.numero_cuenta)
            FROM (
                SELECT cb.numero_cuenta, cb.saldo_inicial, cb.saldo_actual,
                       fn_saldo_calculado_cuenta_banco(cb.numero_cuenta) AS calc,
                       (SELECT jsonb_build_object('monto', a.monto, 'fecha_corte', a.fecha_corte)
                          FROM apertura_financiera a WHERE a.id_cuenta_banco = cb.id_cuenta_banco
                          ORDER BY a.fecha_corte DESC, a.created_at DESC LIMIT 1) AS apertura
                FROM cuenta_banco cb
                WHERE cb.activo
            ) x), '[]'::jsonb)
    );
$$;

REVOKE ALL ON FUNCTION public.fn_saldo_calculado_cuenta_banco(character varying), public.fn_verificar_saldos_bancarios() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_saldo_calculado_cuenta_banco(character varying), public.fn_verificar_saldos_bancarios() TO authenticated;

-- 4) Corrige los saldos de hoy: recalcula todas las cuentas una vez ----------------------------------------------------
DO $$
DECLARE
    v_numero text;
BEGIN
    FOR v_numero IN SELECT DISTINCT numero_cuenta FROM public.cuenta_banco WHERE numero_cuenta IS NOT NULL LOOP
        PERFORM public.fn_recalcular_saldo_cuenta_banco(v_numero);
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
