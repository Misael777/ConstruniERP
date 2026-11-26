-- Pedido de la clienta (26/11/2026, para el tareo): en Control de Accesos → Empleados el nombre se registra en
-- NOMBRES y APELLIDOS por separado, y al registrar un empleado se crea su ficha de Personal (o se enlaza la que ya
-- existe con su DNI) para que sus datos pasen solos a Personal y al tareo.
--  - empleados.nombres / empleados.apellidos (empleados.nombre sigue siendo el nombre completo que usa todo el ERP).
--  - fn_empleado_enlazar_personal: enlaza la ficha (personal.id_empleado) o la crea. Nunca duplica: busca primero la
--    ficha ya enlazada a ese usuario y luego una ficha activa con el mismo DNI. En una ficha existente solo completa los
--    datos vacíos (no pisa lo que RR.HH. ya registró). Solo administradores (los que registran empleados).
-- No modifica datos existentes. Idempotente.

ALTER TABLE public.empleados ADD COLUMN IF NOT EXISTS nombres text;
ALTER TABLE public.empleados ADD COLUMN IF NOT EXISTS apellidos text;

CREATE OR REPLACE FUNCTION public.fn_empleado_enlazar_personal(
    p_id_empleado integer, p_nombres text, p_apellidos text, p_dni text DEFAULT NULL, p_telefono text DEFAULT NULL, p_fecha_ingreso date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
    v_p personal;
    v_dni text := NULLIF(btrim(COALESCE(p_dni, '')), '');
    v_nombres text := NULLIF(btrim(COALESCE(p_nombres, '')), '');
    v_apellidos text := NULLIF(btrim(COALESCE(p_apellidos, '')), '');
    v_accion text;
BEGIN
    IF NOT is_admin() THEN
        RAISE EXCEPTION 'Solo un administrador registra empleados.' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM empleados WHERE id = p_id_empleado) THEN
        RAISE EXCEPTION 'Empleado % no encontrado.', p_id_empleado;
    END IF;
    UPDATE empleados SET nombres = COALESCE(v_nombres, nombres), apellidos = COALESCE(v_apellidos, apellidos) WHERE id = p_id_empleado;

    -- 1) Ficha ya enlazada a este usuario; 2) ficha activa con el mismo DNI y sin otro usuario.
    SELECT * INTO v_p FROM personal WHERE id_empleado = p_id_empleado AND estado <> 'baja' ORDER BY id_personal LIMIT 1;
    IF NOT FOUND AND v_dni IS NOT NULL THEN
        SELECT * INTO v_p FROM personal
        WHERE numero_documento = v_dni AND estado <> 'baja' AND (id_empleado IS NULL OR id_empleado = p_id_empleado)
        ORDER BY id_personal LIMIT 1;
    END IF;

    IF FOUND THEN
        UPDATE personal SET
            id_empleado = p_id_empleado,
            nombres = COALESCE(NULLIF(btrim(COALESCE(nombres, '')), ''), v_nombres),
            apellidos = COALESCE(NULLIF(btrim(COALESCE(apellidos, '')), ''), v_apellidos),
            numero_documento = COALESCE(NULLIF(btrim(COALESCE(numero_documento, '')), ''), v_dni),
            telefono = COALESCE(NULLIF(btrim(COALESCE(telefono, '')), ''), NULLIF(btrim(COALESCE(p_telefono, '')), '')),
            fecha_ingreso = COALESCE(fecha_ingreso, p_fecha_ingreso),
            updated_at = now()
        WHERE id_personal = v_p.id_personal;
        v_accion := 'enlazada';
    ELSE
        INSERT INTO personal (tipo_documento, numero_documento, nombres, apellidos, telefono, fecha_ingreso, estado, id_empleado)
        VALUES ('DNI', v_dni, v_nombres, v_apellidos, NULLIF(btrim(COALESCE(p_telefono, '')), ''), p_fecha_ingreso, 'activo', p_id_empleado)
        RETURNING * INTO v_p;
        v_accion := 'creada';
    END IF;
    RETURN jsonb_build_object('id_personal', v_p.id_personal, 'accion', v_accion);
END $$;
REVOKE ALL ON FUNCTION public.fn_empleado_enlazar_personal(integer, text, text, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_empleado_enlazar_personal(integer, text, text, text, text, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
