-- "Número en huellero" (personal.pin) autogenerado y correlativo (a pedido del usuario): al crear un trabajador
-- desde el ERP sin número, la base le asigna el siguiente: 5, 6, 7… Se usa una secuencia para que un número no
-- se repita nunca (las marcas se enlazan por pin: reusar el de un trabajador eliminado le pasaría sus marcas).
-- Arranca después del mayor número corto (hasta 6 dígitos) ya usado en personal o en marcas; los DNI que se
-- usaron antes como número quedan como están. Los trabajadores que llegan desde el huellero traen su propio
-- número y no pasan por aquí. Idempotente.

CREATE SEQUENCE IF NOT EXISTS public.personal_pin_seq;
GRANT USAGE, SELECT ON SEQUENCE public.personal_pin_seq TO authenticated;

DO $$
DECLARE
    v_max bigint;
BEGIN
    SELECT GREATEST(
        COALESCE((SELECT max(pin::bigint) FROM public.personal WHERE pin ~ '^\d{1,6}$'), 0),
        COALESCE((SELECT max(pin::bigint) FROM public.asistencia_marcacion WHERE pin ~ '^\d{1,6}$'), 0)
    ) INTO v_max;
    -- Solo se adelanta: volver a correr la migración no retrocede el contador.
    IF v_max > 0 AND v_max >= (SELECT CASE WHEN is_called THEN last_value ELSE last_value - 1 END FROM public.personal_pin_seq) THEN
        PERFORM setval('public.personal_pin_seq', v_max, true);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_personal_asignar_pin() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_pin text;
BEGIN
    IF NEW.pin IS NULL OR btrim(NEW.pin) = '' THEN
        -- Salta los números que ya estén ocupados (por ejemplo, un trabajador creado en el huellero con ese número).
        LOOP
            v_pin := nextval('public.personal_pin_seq')::text;
            EXIT WHEN NOT EXISTS (SELECT 1 FROM public.personal WHERE pin = v_pin)
                  AND NOT EXISTS (SELECT 1 FROM public.asistencia_marcacion WHERE pin = v_pin);
        END LOOP;
        NEW.pin := v_pin;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_personal_asignar_pin ON public.personal;
CREATE TRIGGER trg_personal_asignar_pin BEFORE INSERT ON public.personal
    FOR EACH ROW EXECUTE FUNCTION public.fn_personal_asignar_pin();

NOTIFY pgrst, 'reload schema';
