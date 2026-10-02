-- Sincronización: cambios que YA estaban en Producción pero nunca pasaron a supabase/migrations/.
-- Se corrieron a mano desde tres archivos sueltos de la raíz del repo (2026-09-28):
--   proyecto_reversion_venta_migration.sql, proyecto_reversion_venta_fallback_migration.sql,
--   verificar_admin_sin_sesion_migration.sql
-- y el código de la app ya depende de ellos (aprobaciones.service.ts, transacciones.service.ts, adminAuth.ts).
-- Las definiciones de abajo se copiaron TAL CUAL de Producción (pg_get_functiondef, 2026-10-02), así Dev
-- queda idéntico. En Producción esta migración no cambia nada (todo es IF NOT EXISTS / CREATE OR REPLACE con
-- el mismo contenido): solo hay que registrarla con `supabase migration repair --status applied 20261002130000`.

-- Proyecto: transacción que cerró la venta, para poder reabrirla si esa transacción se anula.
ALTER TABLE proyecto ADD COLUMN IF NOT EXISTS id_transaccion_cierre BIGINT REFERENCES transaccion(id_transaccion) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.fn_revertir_venta_por_transaccion(p_id_transaccion bigint, p_categoria text, p_tipo text, p_id_centro_costo_destino bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_id_proyecto BIGINT;
BEGIN
    IF p_tipo IS DISTINCT FROM 'ingreso' OR p_id_centro_costo_destino IS NULL THEN
        RETURN;
    END IF;

    SELECT id_proyecto INTO v_id_proyecto FROM centro_costo WHERE id_centro_costo = p_id_centro_costo_destino;
    IF v_id_proyecto IS NULL THEN
        RETURN;
    END IF;

    UPDATE proyecto
    SET estado_proyecto = 'activo', id_transaccion_cierre = NULL
    WHERE id_proyecto = v_id_proyecto AND id_transaccion_cierre = p_id_transaccion AND estado_proyecto = 'venta_cerrada';
    IF FOUND THEN
        RETURN;
    END IF;

    IF p_categoria = 'Adelanto' THEN
        PERFORM 1 FROM proyecto WHERE id_proyecto = v_id_proyecto AND estado_proyecto = 'venta_cerrada' AND id_transaccion_cierre IS NULL;
        IF FOUND THEN
            PERFORM 1 FROM transaccion
            WHERE id_centro_costo_destino = p_id_centro_costo_destino AND tipo = 'ingreso' AND estado = 'activo';
            IF NOT FOUND THEN
                UPDATE proyecto SET estado_proyecto = 'activo' WHERE id_proyecto = v_id_proyecto AND estado_proyecto = 'venta_cerrada';
            END IF;
        END IF;
    END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_anular_transaccion(p_id_transaccion bigint)
 RETURNS transaccion
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        RETURN v_transaccion;
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

    PERFORM fn_revertir_venta_por_transaccion(v_transaccion.id_transaccion, v_transaccion.categoria, v_transaccion.tipo, v_transaccion.id_centro_costo_destino);

    RETURN v_transaccion;
END;
$function$
;

-- Verifica correo + contraseña de un administrador sin abrir sesión (confirmaciones de acciones sensibles).
CREATE OR REPLACE FUNCTION public.fn_verificar_credenciales_admin(p_email text, p_password text)
 RETURNS TABLE(es_valido boolean, es_admin boolean, mensaje text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'auth'
AS $function$
DECLARE
    v_user_id UUID;
    v_rol_nombre TEXT;
BEGIN
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE lower(email) = lower(p_email)
      AND encrypted_password IS NOT NULL
      AND encrypted_password = crypt(p_password, encrypted_password)
    LIMIT 1;

    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, false, 'Correo o contraseña incorrectos.'::TEXT;
        RETURN;
    END IF;

    SELECT r.nombre INTO v_rol_nombre
    FROM empleados e
    JOIN roles r ON r.id = e.rol_id
    WHERE e.auth_user_id = v_user_id
    LIMIT 1;

    IF v_rol_nombre IS NULL THEN
        RETURN QUERY SELECT true, false, 'No se encontró un empleado vinculado a esa cuenta.'::TEXT;
        RETURN;
    END IF;

    IF v_rol_nombre <> 'administrador' THEN
        RETURN QUERY SELECT true, false, 'Esa cuenta no tiene permisos de administrador.'::TEXT;
        RETURN;
    END IF;

    RETURN QUERY SELECT true, true, 'Identidad de administrador verificada.'::TEXT;
END;
$function$
;

GRANT EXECUTE ON FUNCTION fn_revertir_venta_por_transaccion(BIGINT, TEXT, TEXT, BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_anular_transaccion(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_verificar_credenciales_admin(TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
