-- Pedido de la clienta (27/11/2026): en Nueva transacción, Egreso con Clase "Empleados", el Centro de costo destino debe
-- salir de la lista del Personal (Personal y Asistencia), no solo de los usuarios del ERP.
--
-- Cada trabajador de `personal` tiene su centro de costo tipo 'empleado' enlazado por centro_costo.id_personal. Se crea y
-- se mantiene solo (trigger): nombre y estado (activo/baja) siguen a la ficha del trabajador. Si el trabajador ya tiene
-- usuario del ERP con un centro de empleado (personal.id_empleado = centro_costo.id_empleado), se reutiliza ese centro
-- (solo se le pone id_personal; su nombre y código no cambian) para no duplicar a la persona.
--
-- Estos centros son cuentas de un tercero (como los de empleado/proveedor/cliente), no fondos propios: se ajusta
-- fn_crear_transaccion para que no audite sobregiro sobre ellos.

ALTER TABLE public.centro_costo ADD COLUMN IF NOT EXISTS id_personal bigint REFERENCES public.personal(id_personal) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS centro_costo_id_personal_key ON public.centro_costo(id_personal) WHERE id_personal IS NOT NULL;

-- id_personal convive solo con id_empleado (la misma persona con usuario del ERP), nunca con proyecto/cliente/proveedor.
ALTER TABLE public.centro_costo DROP CONSTRAINT IF EXISTS chk_centro_costo_personal;
ALTER TABLE public.centro_costo ADD CONSTRAINT chk_centro_costo_personal
	CHECK (id_personal IS NULL OR (id_proyecto IS NULL AND id_cliente IS NULL AND id_proveedor IS NULL));

CREATE OR REPLACE FUNCTION public.fn_personal_sincronizar_centro(p_id_personal bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
	v_p public.personal%ROWTYPE;
	v_nombre text;
	v_estado text;
	v_centro bigint;
BEGIN
	SELECT * INTO v_p FROM public.personal WHERE id_personal = p_id_personal;
	IF NOT FOUND THEN
		RETURN;
	END IF;
	v_nombre := coalesce(nullif(trim(v_p.nombre), ''), nullif(trim(concat_ws(' ', v_p.nombres, v_p.apellidos)), ''), 'Trabajador ' || v_p.id_personal);
	v_estado := CASE WHEN v_p.estado = 'activo' THEN 'activo' ELSE 'baja' END;

	SELECT id_centro_costo INTO v_centro FROM public.centro_costo WHERE id_personal = v_p.id_personal;
	IF FOUND THEN
		-- Solo los centros propios del trabajador siguen su nombre/estado; uno reutilizado de un usuario del ERP no se toca.
		UPDATE public.centro_costo
		SET nombre = v_nombre, estado = v_estado
		WHERE id_centro_costo = v_centro AND id_empleado IS NULL AND (nombre IS DISTINCT FROM v_nombre OR estado IS DISTINCT FROM v_estado);
		RETURN;
	END IF;

	IF v_p.id_empleado IS NOT NULL THEN
		SELECT min(id_centro_costo) INTO v_centro FROM public.centro_costo WHERE id_empleado = v_p.id_empleado AND id_personal IS NULL;
		IF v_centro IS NOT NULL THEN
			UPDATE public.centro_costo SET id_personal = v_p.id_personal WHERE id_centro_costo = v_centro;
			RETURN;
		END IF;
	END IF;

	INSERT INTO public.centro_costo (codigo, nombre, tipo, estado, monto_actual, id_personal, descripcion)
	VALUES ('PER-' || lpad(v_p.id_personal::text, 3, '0'), v_nombre, 'empleado', v_estado, 0, v_p.id_personal, 'Trabajador (Personal y Asistencia)');
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_personal_centro_costo_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
	PERFORM public.fn_personal_sincronizar_centro(NEW.id_personal);
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_personal_centro_costo ON public.personal;
CREATE TRIGGER trg_personal_centro_costo
	AFTER INSERT OR UPDATE OF nombre, nombres, apellidos, estado, id_empleado ON public.personal
	FOR EACH ROW EXECUTE FUNCTION public.fn_personal_centro_costo_trg();

-- Al borrar un trabajador: su centro propio se borra si no tiene movimientos; si los tiene, queda dado de baja
-- (y el FK lo deja sin id_personal, conservando su historial).
CREATE OR REPLACE FUNCTION public.fn_personal_borrar_centro_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
	BEGIN
		DELETE FROM public.centro_costo WHERE id_personal = OLD.id_personal AND id_empleado IS NULL;
	EXCEPTION WHEN foreign_key_violation THEN
		UPDATE public.centro_costo SET estado = 'baja' WHERE id_personal = OLD.id_personal AND id_empleado IS NULL;
	END;
	RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_personal_borrar_centro ON public.personal;
CREATE TRIGGER trg_personal_borrar_centro
	BEFORE DELETE ON public.personal
	FOR EACH ROW EXECUTE FUNCTION public.fn_personal_borrar_centro_trg();

REVOKE ALL ON FUNCTION public.fn_personal_sincronizar_centro(bigint) FROM PUBLIC, anon, authenticated;

-- Crear los centros de los trabajadores que ya existen.
SELECT public.fn_personal_sincronizar_centro(id_personal) FROM public.personal ORDER BY id_personal;

-- fn_crear_transaccion: un centro de un trabajador no es fondo propio (no se audita su saldo).
DO $$
DECLARE
	v_def text;
	v_viejo constant text := '(id_cliente IS NULL AND id_proveedor IS NULL AND id_empleado IS NULL)';
	v_nuevo constant text := '(id_cliente IS NULL AND id_proveedor IS NULL AND id_empleado IS NULL AND id_personal IS NULL)';
BEGIN
	SELECT pg_get_functiondef('public.fn_crear_transaccion'::regproc) INTO v_def;
	IF position(v_nuevo IN v_def) > 0 THEN
		RETURN;
	END IF;
	IF position(v_viejo IN v_def) = 0 THEN
		RAISE EXCEPTION 'fn_crear_transaccion no tiene la condición esperada de fondo propio; revisar a mano';
	END IF;
	EXECUTE replace(v_def, v_viejo, v_nuevo);
END;
$$;
