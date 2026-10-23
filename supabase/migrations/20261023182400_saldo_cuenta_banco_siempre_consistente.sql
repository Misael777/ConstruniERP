-- Saldo de cuentas bancarias SIEMPRE consistente con sus transacciones (a pedido del usuario, tras el
-- descuadre de S/ 107,000 en Control Financiero → Conciliación → Cruce interno).
--
-- Causa: `cuenta_banco.saldo_actual` es una columna guardada que solo se recalculaba cuando la APP llamaba a
-- fn_recalcular_saldo_cuenta_banco. Varios caminos borran o cambian transacciones SIN llamarla (ej. eliminar
-- una Cuenta por Cobrar / por Pagar borra sus transacciones directo), y el saldo quedaba con dinero que ya
-- no existe. En Producción: "BCP GUILLERMO SOLES" guardaba 37,000 y "EFECTIVO - WILLY" 70,000 sin ninguna
-- transacción, saldo inicial ni apertura (el usuario confirmó que ese dinero no existe).
--
-- Arreglo: la BASE DE DATOS recalcula sola, con triggers, sin depender de qué pantalla hizo el cambio:
--   1) transaccion: al crear, borrar o cambiar cuenta/monto/estado/fecha → recalcula las cuentas de antes y de después.
--   2) apertura_financiera: al crear, borrar o cambiar una apertura de cuenta → recalcula esa cuenta.
--   3) cuenta_banco: al crearla o cambiar su saldo inicial o su número → recalcula esa cuenta.
--   4) Recalcula UNA VEZ todas las cuentas (corrige los 107,000 de hoy).
-- Las llamadas que ya hace la app quedan redundantes pero inofensivas (el recálculo es idempotente).
-- Idempotente.

-- 1) Transacciones
CREATE OR REPLACE FUNCTION public.fn_trg_transaccion_recalcular_cuentas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cuentas TEXT[] := ARRAY[]::TEXT[];
    v_cuenta TEXT;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        v_cuentas := v_cuentas || ARRAY[OLD.cuente_origen::TEXT, OLD.cuente_destino::TEXT];
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        v_cuentas := v_cuentas || ARRAY[NEW.cuente_origen::TEXT, NEW.cuente_destino::TEXT];
    END IF;
    FOR v_cuenta IN SELECT DISTINCT c FROM unnest(v_cuentas) AS c WHERE c IS NOT NULL AND c <> '' LOOP
        PERFORM public.fn_recalcular_saldo_cuenta_banco(v_cuenta);
    END LOOP;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_transaccion_recalcular_cuentas ON public.transaccion;
CREATE TRIGGER trg_transaccion_recalcular_cuentas
    AFTER INSERT OR DELETE OR UPDATE OF cuente_origen, cuente_destino, monto_total, estado, fecha
    ON public.transaccion
    FOR EACH ROW EXECUTE FUNCTION public.fn_trg_transaccion_recalcular_cuentas();

-- 2) Aperturas financieras (punto de corte de una cuenta)
CREATE OR REPLACE FUNCTION public.fn_trg_apertura_recalcular_cuenta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_numero TEXT;
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
END;
$$;

DROP TRIGGER IF EXISTS trg_apertura_recalcular_cuenta ON public.apertura_financiera;
CREATE TRIGGER trg_apertura_recalcular_cuenta
    AFTER INSERT OR DELETE OR UPDATE OF id_cuenta_banco, monto, fecha_corte
    ON public.apertura_financiera
    FOR EACH ROW EXECUTE FUNCTION public.fn_trg_apertura_recalcular_cuenta();

-- 3) La propia cuenta (el recálculo solo escribe saldo_actual, así que este trigger no se dispara a sí mismo)
CREATE OR REPLACE FUNCTION public.fn_trg_cuenta_banco_recalcular()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.fn_recalcular_saldo_cuenta_banco(NEW.numero_cuenta);
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_cuenta_banco_recalcular ON public.cuenta_banco;
CREATE TRIGGER trg_cuenta_banco_recalcular
    AFTER INSERT OR UPDATE OF saldo_inicial, numero_cuenta
    ON public.cuenta_banco
    FOR EACH ROW EXECUTE FUNCTION public.fn_trg_cuenta_banco_recalcular();

-- 4) Corrección de los saldos actuales: recalcula todas las cuentas una vez.
DO $$
DECLARE
    v_numero TEXT;
BEGIN
    FOR v_numero IN SELECT DISTINCT numero_cuenta FROM public.cuenta_banco WHERE numero_cuenta IS NOT NULL LOOP
        PERFORM public.fn_recalcular_saldo_cuenta_banco(v_numero);
    END LOOP;
END $$;
