


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."actualizar_usuario_empleado"("p_id" integer, "p_auth_user_id" "uuid", "p_nombre" "text", "p_correo" "text", "p_telefono" "text", "p_rol_id" integer, "p_fecha_ingreso" "date", "p_salario" numeric, "p_horas" numeric, "p_periodo" "text", "p_nivel" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE emp_record json; clean_email text := lower(trim(p_correo));
BEGIN
  IF NOT public.is_admin() THEN RETURN json_build_object('success', false, 'error', 'No autorizado'); END IF;
  UPDATE public.empleados SET nombre = p_nombre, correo = clean_email, telefono = p_telefono, rol_id = p_rol_id,
  fecha_ingreso = p_fecha_ingreso, salario = p_salario, horas = p_horas, periodo = p_periodo, nivel = p_nivel WHERE id = p_id
  RETURNING json_build_object('id', id, 'nombre', nombre, 'telefono', telefono, 'correo', correo, 'rol_id', rol_id, 'auth_user_id', auth_user_id) INTO emp_record;
  RETURN json_build_object('success', true, 'empleado', emp_record);
EXCEPTION WHEN OTHERS THEN RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;


ALTER FUNCTION "public"."actualizar_usuario_empleado"("p_id" integer, "p_auth_user_id" "uuid", "p_nombre" "text", "p_correo" "text", "p_telefono" "text", "p_rol_id" integer, "p_fecha_ingreso" "date", "p_salario" numeric, "p_horas" numeric, "p_periodo" "text", "p_nivel" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."actualizar_usuario_empleado"("p_id" integer, "p_auth_user_id" "uuid", "p_nombre" "text", "p_correo" "text", "p_telefono" "text", "p_rol_id" integer, "p_area_id" integer, "p_fecha_ingreso" "date", "p_salario" numeric, "p_horas" numeric, "p_periodo" "text", "p_nivel" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE emp_record json; clean_email text := lower(trim(p_correo));
BEGIN
  IF NOT public.is_admin() THEN RETURN json_build_object('success', false, 'error', 'No autorizado'); END IF;
  UPDATE public.empleados SET nombre = p_nombre, correo = clean_email, telefono = p_telefono, rol_id = p_rol_id, area_id = p_area_id,
  fecha_ingreso = p_fecha_ingreso, salario = p_salario, horas = p_horas, periodo = p_periodo, nivel = p_nivel WHERE id = p_id
  RETURNING json_build_object('id', id, 'nombre', nombre, 'telefono', telefono, 'correo', correo, 'rol_id', rol_id, 'auth_user_id', auth_user_id) INTO emp_record;
  RETURN json_build_object('success', true, 'empleado', emp_record);
EXCEPTION WHEN OTHERS THEN RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;


ALTER FUNCTION "public"."actualizar_usuario_empleado"("p_id" integer, "p_auth_user_id" "uuid", "p_nombre" "text", "p_correo" "text", "p_telefono" "text", "p_rol_id" integer, "p_area_id" integer, "p_fecha_ingreso" "date", "p_salario" numeric, "p_horas" numeric, "p_periodo" "text", "p_nivel" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."capture_instance_audit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_project_id BIGINT;
    v_table_name TEXT := TG_TABLE_NAME;
    v_old_json   JSONB;
    v_new_json   JSONB;
    v_row_json   JSONB;
    v_record_id  BIGINT;
    v_actor      UUID;
BEGIN
    BEGIN
        v_actor := auth.uid();
    EXCEPTION WHEN OTHERS THEN
        v_actor := NULL;
    END;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new_json := to_jsonb(NEW); END IF;
    IF TG_OP IN ('DELETE',  'UPDATE') THEN v_old_json := to_jsonb(OLD);  END IF;

    v_row_json := COALESCE(v_new_json, v_old_json);

    -- ── Resolve project_id ─────────────────────────────────────────────────────
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        IF jsonb_exists(v_new_json, 'id_proyecto') THEN
            v_project_id := (v_new_json ->> 'id_proyecto')::BIGINT;
        ELSIF v_table_name = 'presupuesto_detalle' THEN
            SELECT p.id_proyecto INTO v_project_id
            FROM presupuesto p WHERE p.id_presupuesto = NEW.id_presupuesto;
        ELSIF v_table_name = 'valorizacion_partida' THEN
            SELECT vs.id_proyecto INTO v_project_id
            FROM valorizacion_semanal vs WHERE vs.id_valorizacion = NEW.id_valorizacion;
        ELSIF v_table_name = 'cronograma_detalle_semanal' THEN
            SELECT ca.id_proyecto INTO v_project_id
            FROM cronograma_actividad ca WHERE ca.id_cronograma_actividad = NEW.id_cronograma_actividad;
        END IF;
    END IF;

    IF v_project_id IS NULL AND TG_OP IN ('UPDATE', 'DELETE') THEN
        IF jsonb_exists(v_old_json, 'id_proyecto') THEN
            v_project_id := (v_old_json ->> 'id_proyecto')::BIGINT;
        ELSIF v_table_name = 'presupuesto_detalle' THEN
            SELECT p.id_proyecto INTO v_project_id
            FROM presupuesto p WHERE p.id_presupuesto = OLD.id_presupuesto;
        ELSIF v_table_name = 'valorizacion_partida' THEN
            SELECT vs.id_proyecto INTO v_project_id
            FROM valorizacion_semanal vs WHERE vs.id_valorizacion = OLD.id_valorizacion;
        ELSIF v_table_name = 'cronograma_detalle_semanal' THEN
            SELECT ca.id_proyecto INTO v_project_id
            FROM cronograma_actividad ca WHERE ca.id_cronograma_actividad = OLD.id_cronograma_actividad;
        END IF;
    END IF;

    -- No project → nothing to audit
    IF v_project_id IS NULL THEN RETURN NULL; END IF;

    -- ── Resolve record_id ──────────────────────────────────────────────────────
    -- Convention: PK is id_<table_name>.  Fallback: 'id'.
    v_record_id := COALESCE(
        (v_row_json ->> ('id_' || v_table_name))::BIGINT,
        (v_row_json ->> 'id')::BIGINT
    );

    -- Still NULL (unusual PK name) → skip silently, don't crash the caller
    IF v_record_id IS NULL THEN RETURN NULL; END IF;

    -- ── Write audit row ────────────────────────────────────────────────────────
    -- "Best effort": si esto falla (ej. el proyecto referenciado ya no existe
    -- porque estamos en medio de un DELETE en cascada que lo está borrando en
    -- la misma sentencia), se ignora el error y se continúa — un log de
    -- auditoría nunca debe poder tumbar la operación real que intenta registrar.
    BEGIN
        INSERT INTO instance_audit_log (project_id, table_name, record_id, action, old_data, new_data, changed_by)
        VALUES (v_project_id, v_table_name, v_record_id, TG_OP, v_old_json, v_new_json, v_actor);
    EXCEPTION WHEN OTHERS THEN
        NULL; -- no-op: se descarta el error de auditoría a propósito
    END;

    RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."capture_instance_audit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_cronograma_actividad_cycle"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_parent BIGINT := NEW.id_actividad_padre;
BEGIN
    IF NEW.id_cronograma_actividad = NEW.id_actividad_padre THEN
        RAISE EXCEPTION 'Una actividad no puede ser su propio padre';
    END IF;
    WHILE v_parent IS NOT NULL LOOP
        IF v_parent = NEW.id_cronograma_actividad THEN
            RAISE EXCEPTION 'Ciclo detectado en jerarquía de cronograma_actividad';
        END IF;
        SELECT id_actividad_padre INTO v_parent FROM cronograma_actividad WHERE id_cronograma_actividad = v_parent;
    END LOOP;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_cronograma_actividad_cycle"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_partida_cycle"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_parent BIGINT := NEW.id_partida_padre;
BEGIN
    IF NEW.id_partida = NEW.id_partida_padre THEN
        RAISE EXCEPTION 'Una partida no puede ser su propio padre';
    END IF;

    WHILE v_parent IS NOT NULL LOOP
        IF v_parent = NEW.id_partida THEN
            RAISE EXCEPTION 'Ciclo detectado en jerarquía de partidas';
        END IF;
        SELECT id_partida_padre INTO v_parent FROM partida WHERE id_partida = v_parent;
    END LOOP;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_partida_cycle"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."configurar_contrasena_empleado"("p_email" "text", "p_password" "text", "p_type" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN json_build_object(
    'success', false,
    'error', 'Direct password configuration via SQL function is deprecated. Use /api/setup-password with the Supabase Admin API instead.'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;


ALTER FUNCTION "public"."configurar_contrasena_empleado"("p_email" "text", "p_password" "text", "p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."crear_usuario_empleado"("p_nombre" "text", "p_correo" "text", "p_telefono" "text", "p_rol_id" integer, "p_fecha_ingreso" "date", "p_salario" numeric, "p_horas" numeric, "p_periodo" "text", "p_nivel" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE emp_record json; clean_email text := lower(trim(p_correo));
BEGIN
  IF NOT public.is_admin() THEN RETURN json_build_object('success', false, 'error', 'No autorizado'); END IF;
  IF EXISTS (SELECT 1 FROM public.empleados WHERE lower(correo) = clean_email) THEN RETURN json_build_object('success', false, 'error', 'El correo ya existe'); END IF;
  INSERT INTO public.empleados (nombre, correo, telefono, rol_id, fecha_ingreso, salario, horas, periodo, nivel)
  VALUES (p_nombre, clean_email, p_telefono, p_rol_id, p_fecha_ingreso, p_salario, p_horas, p_periodo, p_nivel)
  RETURNING json_build_object('id', id, 'nombre', nombre, 'telefono', telefono, 'correo', correo, 'rol_id', rol_id, 'auth_user_id', auth_user_id) INTO emp_record;
  RETURN json_build_object('success', true, 'empleado', emp_record);
EXCEPTION WHEN OTHERS THEN RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;


ALTER FUNCTION "public"."crear_usuario_empleado"("p_nombre" "text", "p_correo" "text", "p_telefono" "text", "p_rol_id" integer, "p_fecha_ingreso" "date", "p_salario" numeric, "p_horas" numeric, "p_periodo" "text", "p_nivel" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."crear_usuario_empleado"("p_nombre" "text", "p_correo" "text", "p_telefono" "text", "p_rol_id" integer, "p_area_id" integer, "p_fecha_ingreso" "date", "p_salario" numeric, "p_horas" numeric, "p_periodo" "text", "p_nivel" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE emp_record json; clean_email text := lower(trim(p_correo));
BEGIN
  IF NOT public.is_admin() THEN RETURN json_build_object('success', false, 'error', 'No autorizado'); END IF;
  IF EXISTS (SELECT 1 FROM public.empleados WHERE lower(correo) = clean_email) THEN RETURN json_build_object('success', false, 'error', 'El correo ya existe'); END IF;
  INSERT INTO public.empleados (nombre, correo, telefono, rol_id, area_id, fecha_ingreso, salario, horas, periodo, nivel)
  VALUES (p_nombre, clean_email, p_telefono, p_rol_id, p_area_id, p_fecha_ingreso, p_salario, p_horas, p_periodo, p_nivel)
  RETURNING json_build_object('id', id, 'nombre', nombre, 'telefono', telefono, 'correo', correo, 'rol_id', rol_id, 'auth_user_id', auth_user_id) INTO emp_record;
  RETURN json_build_object('success', true, 'empleado', emp_record);
EXCEPTION WHEN OTHERS THEN RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;


ALTER FUNCTION "public"."crear_usuario_empleado"("p_nombre" "text", "p_correo" "text", "p_telefono" "text", "p_rol_id" integer, "p_area_id" integer, "p_fecha_ingreso" "date", "p_salario" numeric, "p_horas" numeric, "p_periodo" "text", "p_nivel" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."eliminar_usuario_empleado"("p_id" integer) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NOT public.is_admin() THEN RETURN json_build_object('success', false, 'error', 'No autorizado'); END IF;
  DELETE FROM public.empleados WHERE id = p_id;
  RETURN json_build_object('success', true, 'empleado_id', p_id);
EXCEPTION WHEN OTHERS THEN RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;


ALTER FUNCTION "public"."eliminar_usuario_empleado"("p_id" integer) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."transaccion" (
    "id_transaccion" bigint NOT NULL,
    "id_centro_costo_origen" bigint NOT NULL,
    "id_centro_costo_destino" bigint NOT NULL,
    "fecha" "date" NOT NULL,
    "id_nombre" character varying(20),
    "tipo_documento" character varying(2),
    "num_documento" character varying(20),
    "tipo_transaccion" character varying(2),
    "forma_pago" character varying(2),
    "descripcion" "text",
    "tipo" character varying(20),
    "monto_total" numeric(12,2) NOT NULL,
    "medio_pago" character varying(2),
    "cuente_origen" character varying(100),
    "cuente_destino" character varying(100),
    "estado" character varying(10),
    "usuario_registro" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "comprobante_url" "text",
    "aprobado" boolean DEFAULT false NOT NULL,
    "aprobado_por" character varying(100),
    "aprobado_en" timestamp with time zone,
    "categoria" character varying(50),
    "tipo_alcance" character varying(10) DEFAULT 'externa'::character varying NOT NULL,
    "factura_url" "text",
    "num_operacion" character varying(30),
    "tipo_gasto" character varying(50),
    "honorarios" character varying(50),
    "alquiler" character varying(50),
    "servicios" character varying(50),
    "subcontrata" character varying(50),
    "compras" character varying(50),
    "movilidad" character varying(50),
    "impuestos" character varying(50),
    "material" character varying(50),
    "equipos" character varying(50),
    "gastos_generales" character varying(50),
    "prestamo" character varying(50),
    "inversion" character varying(50),
    "num_comprobante_interno" integer,
    "num_recibo_pago" integer,
    "num_recibo_pago_no_efectivo" integer,
    "num_recibo_pago_proveedor" integer,
    "comprobante_autogenerado_url" "text",
    "comprobante_autogenerado_url_final" "text",
    "idempotency_key" "uuid",
    "tipo_moneda" character varying(10) DEFAULT 'soles'::character varying NOT NULL,
    "tipo_cambio" numeric(12,2),
    "monto_convertido" numeric(14,4),
    "documento_pendiente" character varying(3) DEFAULT 'no'::character varying NOT NULL,
    "responsable_documento_pendiente" character varying(100),
    "fecha_vencimiento_documento" "date",
    "id_factura" bigint,
    CONSTRAINT "transaccion_documento_pendiente_check" CHECK ((("documento_pendiente")::"text" = ANY ((ARRAY['si'::character varying, 'no'::character varying])::"text"[]))),
    CONSTRAINT "transaccion_estado_check" CHECK ((("estado")::"text" = ANY ((ARRAY['activo'::character varying, 'anulado'::character varying, 'consulta'::character varying])::"text"[]))),
    CONSTRAINT "transaccion_tipo_alcance_check" CHECK ((("tipo_alcance")::"text" = ANY ((ARRAY['interna'::character varying, 'externa'::character varying])::"text"[]))),
    CONSTRAINT "transaccion_tipo_check" CHECK ((("tipo")::"text" = ANY ((ARRAY['ingreso'::character varying, 'egreso'::character varying, 'financiamiento'::character varying, 'transferencia'::character varying])::"text"[]))),
    CONSTRAINT "transaccion_tipo_moneda_check" CHECK ((("tipo_moneda")::"text" = ANY ((ARRAY['soles'::character varying, 'dolares'::character varying])::"text"[])))
);


ALTER TABLE "public"."transaccion" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_anular_transaccion"("p_id_transaccion" bigint) RETURNS "public"."transaccion"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."fn_anular_transaccion"("p_id_transaccion" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_asignar_folio_factura"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    IF NEW.folio IS NULL OR NEW.folio = '' THEN
        NEW.folio := CASE NEW.tipo_comprobante
            WHEN 'boleta' THEN 'B001-' || LPAD(nextval('boleta_folio_seq')::text, 8, '0')
            WHEN 'nota_credito' THEN 'NC01-' || LPAD(nextval('nota_credito_folio_seq')::text, 8, '0')
            WHEN 'nota_debito' THEN 'ND01-' || LPAD(nextval('nota_debito_folio_seq')::text, 8, '0')
            ELSE 'E001-' || LPAD(nextval('factura_folio_seq')::text, 8, '0')
        END;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_asignar_folio_factura"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cobros" (
    "id_cobro" bigint NOT NULL,
    "id_cuenta_cobrar" bigint NOT NULL,
    "monto" numeric(12,2) NOT NULL,
    "fecha_cobro" "date" NOT NULL,
    "medio_cobro" smallint,
    "num_operacion" character varying(20),
    "cuenta_banco" character varying(20),
    "numero_opracion" character varying(20),
    "usuario_registro" character varying(100),
    "referencia" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "estado_cobro" character varying(20) DEFAULT 'cobrado'::character varying NOT NULL,
    "id_transaccion" bigint,
    "panorama_id" smallint,
    "panorama_orden" integer,
    CONSTRAINT "cobros_estado_cobro_check" CHECK ((("estado_cobro")::"text" = ANY ((ARRAY['programado'::character varying, 'cobrado'::character varying, 'cancelado'::character varying])::"text"[])))
);


ALTER TABLE "public"."cobros" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_confirmar_cobro"("p_id_cuenta_cobrar" bigint, "p_transaccion_payload" "jsonb", "p_id_cobro" bigint DEFAULT NULL::bigint, "p_cobro_payload" "jsonb" DEFAULT NULL::"jsonb", "p_idempotency_key" "uuid" DEFAULT NULL::"uuid") RETURNS "public"."cobros"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."fn_confirmar_cobro"("p_id_cuenta_cobrar" bigint, "p_transaccion_payload" "jsonb", "p_id_cobro" bigint, "p_cobro_payload" "jsonb", "p_idempotency_key" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pagos" (
    "id_pago" bigint NOT NULL,
    "id_cuenta_pagar" bigint NOT NULL,
    "monto" numeric(12,2) NOT NULL,
    "fecha_pago" "date" NOT NULL,
    "medio_pago" character varying(50),
    "num_operacion" character varying(20),
    "usuario_registro" character varying(100),
    "referencia" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "estado_pago" character varying(20) DEFAULT 'pagado'::character varying NOT NULL,
    "id_transaccion" bigint,
    "panorama_id" smallint,
    "panorama_orden" integer,
    CONSTRAINT "pagos_estado_pago_check" CHECK ((("estado_pago")::"text" = ANY ((ARRAY['programado'::character varying, 'pagado'::character varying, 'cancelado'::character varying])::"text"[])))
);


ALTER TABLE "public"."pagos" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_confirmar_pago"("p_id_cuenta_pagar" bigint, "p_transaccion_payload" "jsonb", "p_id_pago" bigint DEFAULT NULL::bigint, "p_pago_payload" "jsonb" DEFAULT NULL::"jsonb", "p_idempotency_key" "uuid" DEFAULT NULL::"uuid") RETURNS "public"."pagos"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."fn_confirmar_pago"("p_id_cuenta_pagar" bigint, "p_transaccion_payload" "jsonb", "p_id_pago" bigint, "p_pago_payload" "jsonb", "p_idempotency_key" "uuid") OWNER TO "postgres";


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


ALTER FUNCTION "public"."fn_crear_transaccion"("p_payload" "jsonb", "p_idempotency_key" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."factura" (
    "id_factura" bigint NOT NULL,
    "folio" character varying(20) NOT NULL,
    "id_cliente" bigint NOT NULL,
    "fecha_emision" "date" DEFAULT CURRENT_DATE NOT NULL,
    "estado" character varying(20) DEFAULT 'borrador'::character varying NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "usuario_registro" character varying(200),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id_proyecto" bigint,
    "cliente_nombre" character varying(200),
    "cliente_tipo_doc" character varying(10),
    "cliente_documento" character varying(20),
    "cliente_direccion" "text",
    "forma_pago" character varying(20) DEFAULT 'contado'::character varying NOT NULL,
    "observacion" "text",
    "moneda" character varying(3) DEFAULT 'PEN'::character varying NOT NULL,
    "tipo_cambio" numeric(10,4),
    "sub_total_ventas" numeric(14,2) DEFAULT 0 NOT NULL,
    "anticipos" numeric(14,2) DEFAULT 0 NOT NULL,
    "descuentos" numeric(14,2) DEFAULT 0 NOT NULL,
    "valor_venta" numeric(14,2) DEFAULT 0 NOT NULL,
    "isc" numeric(14,2) DEFAULT 0 NOT NULL,
    "monto_igv" numeric(14,2) DEFAULT 0 NOT NULL,
    "otros_cargos" numeric(14,2) DEFAULT 0 NOT NULL,
    "otros_tributos" numeric(14,2) DEFAULT 0 NOT NULL,
    "redondeo" numeric(14,2) DEFAULT 0 NOT NULL,
    "monto_total" numeric(14,2) DEFAULT 0 NOT NULL,
    "sujeta_detraccion" boolean DEFAULT false NOT NULL,
    "porcentaje_detraccion" numeric(5,2),
    "monto_detraccion" numeric(14,2),
    "detraccion_bien_servicio" character varying(200),
    "detraccion_medio_pago" character varying(50),
    "detraccion_cuenta_bn" character varying(40),
    "imagen_url" "text",
    "autorizado_por" character varying(200),
    "fecha_autorizacion" timestamp with time zone,
    "tipo_comprobante" character varying(20) DEFAULT 'factura'::character varying NOT NULL,
    CONSTRAINT "factura_estado_check" CHECK ((("estado")::"text" = ANY ((ARRAY['borrador'::character varying, 'emitida'::character varying, 'anulada'::character varying])::"text"[]))),
    CONSTRAINT "factura_tipo_comprobante_check" CHECK ((("tipo_comprobante")::"text" = ANY ((ARRAY['factura'::character varying, 'boleta'::character varying, 'nota_credito'::character varying, 'nota_debito'::character varying])::"text"[])))
);


ALTER TABLE "public"."factura" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_emitir_factura"("p_id_factura" bigint, "p_imagen_url" "text", "p_usuario" "text") RETURNS "public"."factura"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_factura factura;
    v_total INTEGER;
    v_asignadas INTEGER;
BEGIN
    SELECT * INTO v_factura FROM factura WHERE id_factura = p_id_factura FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Factura no encontrada' USING HINT = 'FACTURA_NO_ENCONTRADA';
    END IF;
    IF v_factura.estado = 'emitida' THEN
        RETURN v_factura;
    END IF;
    IF v_factura.estado <> 'borrador' THEN
        RAISE EXCEPTION 'Solo se puede emitir una factura en borrador' USING HINT = 'FACTURA_NO_EMITIBLE';
    END IF;

    SELECT COUNT(DISTINCT id_transaccion) INTO v_total
    FROM factura_detalle WHERE id_factura = p_id_factura AND id_transaccion IS NOT NULL;
    IF v_total = 0 THEN
        RAISE EXCEPTION 'La factura no tiene transacciones seleccionadas' USING HINT = 'FACTURA_SIN_TRANSACCIONES';
    END IF;

    UPDATE transaccion SET id_factura = p_id_factura
    WHERE id_factura IS NULL
      AND id_transaccion IN (SELECT id_transaccion FROM factura_detalle WHERE id_factura = p_id_factura AND id_transaccion IS NOT NULL);
    GET DIAGNOSTICS v_asignadas = ROW_COUNT;
    IF v_asignadas <> v_total THEN
        RAISE EXCEPTION 'Alguna de las transacciones ya fue facturada' USING HINT = 'TRANSACCION_YA_FACTURADA';
    END IF;

    UPDATE factura
    SET estado = 'emitida', imagen_url = p_imagen_url, autorizado_por = p_usuario,
        fecha_autorizacion = NOW(), updated_at = NOW()
    WHERE id_factura = p_id_factura
    RETURNING * INTO v_factura;
    RETURN v_factura;
END;
$$;


ALTER FUNCTION "public"."fn_emitir_factura"("p_id_factura" bigint, "p_imagen_url" "text", "p_usuario" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_recalcular_cuenta_cobrar"("p_id_cuenta_cobrar" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."fn_recalcular_cuenta_cobrar"("p_id_cuenta_cobrar" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_recalcular_cuenta_pagar"("p_id_cuenta_pagar" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."fn_recalcular_cuenta_pagar"("p_id_cuenta_pagar" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_recalcular_saldo_cuenta_banco"("p_numero_cuenta" character varying) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_cuenta cuenta_banco;
    v_neto NUMERIC;
    v_apertura_monto NUMERIC;
    v_apertura_fecha DATE;
    v_base NUMERIC;
BEGIN
    IF p_numero_cuenta IS NULL THEN RETURN; END IF;

    SELECT * INTO v_cuenta FROM cuenta_banco WHERE numero_cuenta = p_numero_cuenta FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;

    -- Apertura Financiera más reciente de ESTA cuenta (por fecha_corte, empate por created_at) —
    -- mismo criterio que getUltimasAperturasPorCentroCosto en conciliacion.service.ts.
    SELECT monto, fecha_corte INTO v_apertura_monto, v_apertura_fecha
    FROM apertura_financiera
    WHERE id_cuenta_banco = v_cuenta.id_cuenta_banco
    ORDER BY fecha_corte DESC, created_at DESC
    LIMIT 1;

    IF FOUND THEN
        v_base := v_apertura_monto;
        SELECT COALESCE(SUM(
            CASE WHEN cuente_origen = p_numero_cuenta THEN -monto_total ELSE 0 END +
            CASE WHEN cuente_destino = p_numero_cuenta THEN monto_total ELSE 0 END
        ), 0) INTO v_neto
        FROM transaccion
        WHERE estado = 'activo' AND (cuente_origen = p_numero_cuenta OR cuente_destino = p_numero_cuenta)
            AND fecha > v_apertura_fecha;
    ELSE
        v_base := v_cuenta.saldo_inicial;
        SELECT COALESCE(SUM(
            CASE WHEN cuente_origen = p_numero_cuenta THEN -monto_total ELSE 0 END +
            CASE WHEN cuente_destino = p_numero_cuenta THEN monto_total ELSE 0 END
        ), 0) INTO v_neto
        FROM transaccion
        WHERE estado = 'activo' AND (cuente_origen = p_numero_cuenta OR cuente_destino = p_numero_cuenta);
    END IF;

    UPDATE cuenta_banco SET saldo_actual = v_base + v_neto WHERE id_cuenta_banco = v_cuenta.id_cuenta_banco;
END;
$$;


ALTER FUNCTION "public"."fn_recalcular_saldo_cuenta_banco"("p_numero_cuenta" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    AS $$
    SELECT EXISTS (
        SELECT 1 FROM empleados e JOIN roles r ON e.rol_id = r.id WHERE e.auth_user_id = auth.uid() AND r.nombre = 'administrador'
    );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_api_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."refresh_api_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_set_updated_at_documento"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_set_updated_at_documento"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."acero_detalle" (
    "id_acero" bigint NOT NULL,
    "id_proyecto" bigint NOT NULL,
    "id_partida" bigint,
    "elemento" character varying(100),
    "diametro" character varying(10),
    "longitud_m" numeric(10,2),
    "cantidad_varillas" integer,
    "precio_total_kg" numeric(12,2),
    "usuario_registro" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."acero_detalle" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."acero_detalle_id_acero_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."acero_detalle_id_acero_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."acero_detalle_id_acero_seq" OWNED BY "public"."acero_detalle"."id_acero";



CREATE TABLE IF NOT EXISTS "public"."adelanto" (
    "id_adelanto" bigint NOT NULL,
    "id_proyecto" bigint NOT NULL,
    "fecha" "date" NOT NULL,
    "monto" numeric(12,2) NOT NULL,
    "cuenta" character varying(100),
    "tipo" character varying(50),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."adelanto" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."adelanto_id_adelanto_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."adelanto_id_adelanto_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."adelanto_id_adelanto_seq" OWNED BY "public"."adelanto"."id_adelanto";



CREATE TABLE IF NOT EXISTS "public"."anuncios" (
    "id_anuncio" bigint NOT NULL,
    "titulo" character varying(200) NOT NULL,
    "contenido" "text" NOT NULL,
    "imagen_url" "text",
    "autor" character varying(100),
    "fecha_publicacion" "date" DEFAULT CURRENT_DATE NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."anuncios" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."anuncios_id_anuncio_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."anuncios_id_anuncio_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."anuncios_id_anuncio_seq" OWNED BY "public"."anuncios"."id_anuncio";



CREATE TABLE IF NOT EXISTS "public"."apertura_financiera" (
    "id_apertura" bigint NOT NULL,
    "fecha_corte" "date" NOT NULL,
    "monto" numeric(14,2) NOT NULL,
    "id_cuenta_banco" bigint,
    "fuente" character varying(30) NOT NULL,
    "observaciones" "text",
    "usuario_registro" character varying(200),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id_centro_costo" bigint,
    CONSTRAINT "apertura_financiera_fuente_check" CHECK ((("fuente")::"text" = ANY ((ARRAY['estado_de_cuenta_bancario'::character varying, 'migracion_inicial'::character varying, 'auditoria_externa'::character varying, 'otro'::character varying])::"text"[]))),
    CONSTRAINT "chk_apertura_financiera_un_ambito" CHECK (("num_nonnulls"("id_cuenta_banco", "id_centro_costo") <= 1))
);


ALTER TABLE "public"."apertura_financiera" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."apertura_financiera_id_apertura_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."apertura_financiera_id_apertura_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."apertura_financiera_id_apertura_seq" OWNED BY "public"."apertura_financiera"."id_apertura";



CREATE TABLE IF NOT EXISTS "public"."app_release" (
    "id_release" bigint NOT NULL,
    "version" character varying(20) NOT NULL,
    "changelog" "text",
    "url_manifest_win" "text",
    "url_instalador_win" "text",
    "url_apk_drive" "text",
    "publicado_por" character varying(200),
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."app_release" REPLICA IDENTITY FULL;


ALTER TABLE "public"."app_release" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."app_release_id_release_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."app_release_id_release_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."app_release_id_release_seq" OWNED BY "public"."app_release"."id_release";



CREATE TABLE IF NOT EXISTS "public"."app_version_usuario" (
    "id_registro" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "usuario" character varying(200),
    "plataforma" character varying(20) NOT NULL,
    "version" character varying(20) NOT NULL,
    "ultima_conexion" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."app_version_usuario" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."app_version_usuario_id_registro_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."app_version_usuario_id_registro_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."app_version_usuario_id_registro_seq" OWNED BY "public"."app_version_usuario"."id_registro";



CREATE TABLE IF NOT EXISTS "public"."area" (
    "id" integer NOT NULL,
    "nombre" character varying(100) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."area" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."area_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."area_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."area_id_seq" OWNED BY "public"."area"."id";



CREATE SEQUENCE IF NOT EXISTS "public"."boleta_folio_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."boleta_folio_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."centro_costo" (
    "id_centro_costo" bigint NOT NULL,
    "codigo" character varying(50) NOT NULL,
    "nombre" character varying(200) NOT NULL,
    "tipo" character varying(20) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "monto_actual" numeric(10,2),
    "id_proyecto" bigint,
    "id_cliente" bigint,
    "id_proveedor" bigint,
    "id_empleado" bigint,
    "descripcion" "text",
    "estado" character varying(10) DEFAULT 'activo'::character varying NOT NULL,
    CONSTRAINT "centro_costo_estado_check" CHECK ((("estado")::"text" = ANY ((ARRAY['activo'::character varying, 'baja'::character varying])::"text"[]))),
    CONSTRAINT "centro_costo_tipo_check" CHECK ((("tipo")::"text" = ANY ((ARRAY['obra'::character varying, 'consultoria'::character varying, 'area'::character varying, 'otro'::character varying, 'proyecto'::character varying, 'cliente'::character varying, 'proveedor'::character varying, 'empleado'::character varying, 'bolsa general'::character varying, 'subcontratista'::character varying, 'prestamo'::character varying])::"text"[]))),
    CONSTRAINT "chk_centro_costo_una_entidad" CHECK (("num_nonnulls"("id_proyecto", "id_cliente", "id_proveedor", "id_empleado") <= 1))
);


ALTER TABLE "public"."centro_costo" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."centro_costo_id_centro_costo_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."centro_costo_id_centro_costo_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."centro_costo_id_centro_costo_seq" OWNED BY "public"."centro_costo"."id_centro_costo";



CREATE TABLE IF NOT EXISTS "public"."cliente" (
    "id_cliente" bigint NOT NULL,
    "tip_persona" character varying(4),
    "nombre" character varying(200) NOT NULL,
    "tipo_doc" character varying(4),
    "num_documento" character varying(11),
    "direccion" "text",
    "telefono" character varying(20),
    "email" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "usuario_registro" character varying(100),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "estado" character varying(10) DEFAULT 'activo'::character varying NOT NULL
);

ALTER TABLE ONLY "public"."cliente" REPLICA IDENTITY FULL;


ALTER TABLE "public"."cliente" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."cliente_id_cliente_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cliente_id_cliente_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cliente_id_cliente_seq" OWNED BY "public"."cliente"."id_cliente";



CREATE SEQUENCE IF NOT EXISTS "public"."cobros_id_cobro_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cobros_id_cobro_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cobros_id_cobro_seq" OWNED BY "public"."cobros"."id_cobro";



CREATE TABLE IF NOT EXISTS "public"."conciliacion_financiera" (
    "id_conciliacion" bigint NOT NULL,
    "fecha" "date" DEFAULT CURRENT_DATE NOT NULL,
    "tipo" character varying(20) NOT NULL,
    "saldo_a" numeric(14,2) NOT NULL,
    "saldo_b" numeric(14,2) NOT NULL,
    "diferencia" numeric(14,2) NOT NULL,
    "estado" character varying(20) DEFAULT 'cuadrada'::character varying NOT NULL,
    "id_incidencia" bigint,
    "usuario_registro" character varying(200),
    "observaciones" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "conciliacion_financiera_estado_check" CHECK ((("estado")::"text" = ANY ((ARRAY['cuadrada'::character varying, 'con_diferencia'::character varying])::"text"[]))),
    CONSTRAINT "conciliacion_financiera_tipo_check" CHECK ((("tipo")::"text" = ANY ((ARRAY['interna'::character varying, 'banco_manual'::character varying])::"text"[])))
);


ALTER TABLE "public"."conciliacion_financiera" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."conciliacion_financiera_id_conciliacion_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."conciliacion_financiera_id_conciliacion_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."conciliacion_financiera_id_conciliacion_seq" OWNED BY "public"."conciliacion_financiera"."id_conciliacion";



CREATE TABLE IF NOT EXISTS "public"."contrato_proyecto" (
    "id_contrato" bigint NOT NULL,
    "id_proyecto" bigint NOT NULL,
    "monto_total" numeric(12,2) NOT NULL,
    "tipo_contrato" character varying(50) DEFAULT 'a suma alzada'::character varying,
    "fecha_inicio" "date",
    "fecha_fin" "date",
    "usuario_registro" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."contrato_proyecto" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."contrato_proyecto_id_contrato_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."contrato_proyecto_id_contrato_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."contrato_proyecto_id_contrato_seq" OWNED BY "public"."contrato_proyecto"."id_contrato";



CREATE TABLE IF NOT EXISTS "public"."cronograma_actividad" (
    "id_cronograma_actividad" bigint NOT NULL,
    "id_proyecto" bigint NOT NULL,
    "nombre_actividad" character varying(200) NOT NULL,
    "nivel" integer NOT NULL,
    "id_actividad_padre" bigint,
    "semana_inicio_plan" integer,
    "semana_fin_plan" integer,
    "duracion_semanas" integer GENERATED ALWAYS AS ((("semana_fin_plan" - "semana_inicio_plan") + 1)) STORED,
    "fecha_inicio_real" "date",
    "fecha_fin_real" "date",
    "porcentaje_avance_real" numeric(5,2) DEFAULT 0,
    "orden" integer,
    "usuario_registro" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "fecha_inicio_plan" "date",
    "fecha_fin_plan" "date",
    "plan_base_inicio" "date",
    "plan_base_fin" "date",
    "id_partida" bigint,
    "color" character varying(20)
);


ALTER TABLE "public"."cronograma_actividad" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."cronograma_actividad_id_cronograma_actividad_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cronograma_actividad_id_cronograma_actividad_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cronograma_actividad_id_cronograma_actividad_seq" OWNED BY "public"."cronograma_actividad"."id_cronograma_actividad";



CREATE TABLE IF NOT EXISTS "public"."cronograma_dependencia" (
    "id_dependencia" bigint NOT NULL,
    "id_actividad_origen" bigint NOT NULL,
    "id_actividad_destino" bigint NOT NULL,
    "tipo_dependencia" character varying(5) DEFAULT 'FS'::character varying NOT NULL,
    "lag_dias" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "chk_no_self_dep" CHECK (("id_actividad_origen" <> "id_actividad_destino")),
    CONSTRAINT "cronograma_dependencia_tipo_dependencia_check" CHECK ((("tipo_dependencia")::"text" = ANY ((ARRAY['FS'::character varying, 'SS'::character varying, 'FF'::character varying, 'SF'::character varying])::"text"[])))
);


ALTER TABLE "public"."cronograma_dependencia" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."cronograma_dependencia_id_dependencia_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cronograma_dependencia_id_dependencia_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cronograma_dependencia_id_dependencia_seq" OWNED BY "public"."cronograma_dependencia"."id_dependencia";



CREATE TABLE IF NOT EXISTS "public"."cronograma_detalle_semanal" (
    "id_cronograma_detalle" bigint NOT NULL,
    "id_cronograma_actividad" bigint NOT NULL,
    "semana_numero" integer NOT NULL,
    "avance_planificado_semanal" numeric(5,2) DEFAULT 0,
    "avance_real_semanal" numeric(5,2) DEFAULT 0,
    "observaciones" "text",
    "usuario_registro" character varying(100)
);


ALTER TABLE "public"."cronograma_detalle_semanal" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."cronograma_detalle_semanal_id_cronograma_detalle_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cronograma_detalle_semanal_id_cronograma_detalle_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cronograma_detalle_semanal_id_cronograma_detalle_seq" OWNED BY "public"."cronograma_detalle_semanal"."id_cronograma_detalle";



CREATE TABLE IF NOT EXISTS "public"."cronograma_plan_base" (
    "id_plan_base" bigint NOT NULL,
    "id_proyecto" bigint NOT NULL,
    "nombre" character varying(100) DEFAULT 'Plan Base'::character varying NOT NULL,
    "fecha_snapshot" "date" DEFAULT CURRENT_DATE NOT NULL,
    "datos_json" "jsonb" NOT NULL,
    "usuario_registro" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."cronograma_plan_base" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."cronograma_plan_base_id_plan_base_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cronograma_plan_base_id_plan_base_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cronograma_plan_base_id_plan_base_seq" OWNED BY "public"."cronograma_plan_base"."id_plan_base";



CREATE TABLE IF NOT EXISTS "public"."cuenta_banco" (
    "id_cuenta_banco" bigint NOT NULL,
    "numero_cuenta" character varying(30) NOT NULL,
    "titular_cuenta" character varying(150) NOT NULL,
    "nombre_banco" character varying(100) NOT NULL,
    "tipo_cuenta" character varying(20) NOT NULL,
    "tipo_moneda" character varying(10) NOT NULL,
    "cci_cuenta" character varying(20),
    "numero_tarjeta" character varying(20),
    "estado" character varying(15) DEFAULT 'activa'::character varying NOT NULL,
    "usuario" character varying(100),
    "fecha_autorizacion" "date",
    "observacion" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "saldo_inicial" numeric(14,2) DEFAULT 0 NOT NULL,
    "saldo_actual" numeric(14,2) DEFAULT 0 NOT NULL,
    CONSTRAINT "cuenta_banco_estado_check" CHECK ((("estado")::"text" = ANY ((ARRAY['activa'::character varying, 'inactiva'::character varying, 'autorizada'::character varying, 'no_autorizada'::character varying])::"text"[]))),
    CONSTRAINT "cuenta_banco_tipo_cuenta_check" CHECK ((("tipo_cuenta")::"text" = ANY ((ARRAY['corriente'::character varying, 'ahorros'::character varying, 'plazo_fijo'::character varying, 'mancomunada'::character varying, 'sueldo'::character varying, 'efectivo'::character varying])::"text"[]))),
    CONSTRAINT "cuenta_banco_tipo_moneda_check" CHECK ((("tipo_moneda")::"text" = ANY ((ARRAY['soles'::character varying, 'dolares'::character varying, 'otro'::character varying])::"text"[])))
);


ALTER TABLE "public"."cuenta_banco" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."cuenta_banco_id_cuenta_banco_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cuenta_banco_id_cuenta_banco_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cuenta_banco_id_cuenta_banco_seq" OWNED BY "public"."cuenta_banco"."id_cuenta_banco";



CREATE TABLE IF NOT EXISTS "public"."cuentas_cobrar" (
    "id_cuenta_cobrar" bigint NOT NULL,
    "id_cliente" bigint NOT NULL,
    "id_proyecto" bigint,
    "tipo_documento" smallint,
    "num_documento" character varying(50),
    "monto" numeric(12,2) NOT NULL,
    "monto_cobrado" numeric(12,2) NOT NULL,
    "saldo_pendiente" numeric(12,2) NOT NULL,
    "forma_pago" smallint,
    "condición_pago" smallint,
    "responsable" character varying(100),
    "fecha_emision" "date" NOT NULL,
    "fecha_vencimiento" "date",
    "moneda" character varying(3),
    "observaciones" character varying(200),
    "estado" character varying(20) DEFAULT 'pendiente'::character varying,
    "usuario_registro" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "id_centro_costo" bigint,
    "monto_dolares" numeric,
    "tipo_cambio" numeric,
    "prioridad" character varying(10),
    "panorama_id" smallint,
    "panorama_orden" integer,
    "activo" boolean DEFAULT true NOT NULL,
    "id_transaccion" bigint,
    CONSTRAINT "cuentas_cobrar_monto_cobrado_check" CHECK (("monto_cobrado" >= (0)::numeric)),
    CONSTRAINT "cuentas_cobrar_saldo_pendiente_check" CHECK (("saldo_pendiente" >= (0)::numeric))
);


ALTER TABLE "public"."cuentas_cobrar" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."cuentas_cobrar_id_cuenta_cobrar_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cuentas_cobrar_id_cuenta_cobrar_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cuentas_cobrar_id_cuenta_cobrar_seq" OWNED BY "public"."cuentas_cobrar"."id_cuenta_cobrar";



CREATE TABLE IF NOT EXISTS "public"."cuentas_pagar" (
    "id_cuenta_pagar" bigint NOT NULL,
    "id_proveedor" bigint NOT NULL,
    "id_presupuesto" bigint,
    "id_partida" bigint,
    "tipo_documento" smallint,
    "num_documento" character varying(20),
    "monto_comprometido" numeric(12,2) NOT NULL,
    "monto_pagado" numeric(12,2) NOT NULL,
    "saldo_pendiente" numeric(12,2) NOT NULL,
    "fotma_pago" smallint,
    "categoria_gasto" smallint,
    "condicion_pago" character varying(100),
    "responsable" character varying(100),
    "fecha_emision" "date" NOT NULL,
    "fecha_vencimiento" "date",
    "fecha_pago_programada" "date",
    "monto_imponible" numeric(12,2) NOT NULL,
    "monto_igv" numeric(12,2) NOT NULL,
    "detraccion" numeric(12,2),
    "monto_retencion" numeric(12,2),
    "estado" character varying(20) DEFAULT 'pendiente'::character varying,
    "observacion" character varying(200),
    "usuario_registro" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "panorama_id" smallint,
    "panorama_orden" integer,
    "id_centro_costo" bigint,
    "prioridad" character varying(10),
    "activo" boolean DEFAULT true NOT NULL,
    "frecuencia_pago" character varying(20) DEFAULT 'sin_periodicidad'::character varying NOT NULL,
    "fin_periodo_pago" "date",
    "id_transaccion" bigint,
    CONSTRAINT "cuentas_pagar_frecuencia_pago_check" CHECK ((("frecuencia_pago")::"text" = ANY ((ARRAY['sin_periodicidad'::character varying, 'mensual'::character varying, 'quincenal'::character varying, 'semanal'::character varying])::"text"[]))),
    CONSTRAINT "cuentas_pagar_monto_pagado_check" CHECK (("monto_pagado" >= (0)::numeric)),
    CONSTRAINT "cuentas_pagar_saldo_pendiente_check" CHECK (("saldo_pendiente" >= (0)::numeric))
);


ALTER TABLE "public"."cuentas_pagar" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."cuentas_pagar_id_cuenta_pagar_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cuentas_pagar_id_cuenta_pagar_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cuentas_pagar_id_cuenta_pagar_seq" OWNED BY "public"."cuentas_pagar"."id_cuenta_pagar";



CREATE TABLE IF NOT EXISTS "public"."documento_proyecto" (
    "id_documento" bigint NOT NULL,
    "id_proyecto" bigint NOT NULL,
    "nombre" character varying(200) NOT NULL,
    "tipo_documento" character varying(80) DEFAULT 'Otro'::character varying NOT NULL,
    "descripcion" "text",
    "version" character varying(20) DEFAULT 'V1.0'::character varying NOT NULL,
    "estado" character varying(30) DEFAULT 'borrador'::character varying NOT NULL,
    "storage_path" "text",
    "storage_url" "text",
    "file_size" bigint,
    "file_type" character varying(100),
    "creado_por" character varying(100),
    "responsable" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "es_proforma_final" boolean DEFAULT false NOT NULL,
    CONSTRAINT "documento_proyecto_estado_check" CHECK ((("estado")::"text" = ANY ((ARRAY['borrador'::character varying, 'revision'::character varying, 'aprobado'::character varying, 'rechazado'::character varying])::"text"[])))
);


ALTER TABLE "public"."documento_proyecto" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."documento_proyecto_id_documento_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."documento_proyecto_id_documento_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."documento_proyecto_id_documento_seq" OWNED BY "public"."documento_proyecto"."id_documento";



CREATE TABLE IF NOT EXISTS "public"."egreso_semanal" (
    "id_egreso" bigint NOT NULL,
    "id_proyecto" bigint NOT NULL,
    "semana_numero" integer NOT NULL,
    "concepto" character varying(100) NOT NULL,
    "monto" numeric(12,2) NOT NULL,
    "usuario_registro" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."egreso_semanal" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."egreso_semanal_id_egreso_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."egreso_semanal_id_egreso_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."egreso_semanal_id_egreso_seq" OWNED BY "public"."egreso_semanal"."id_egreso";



CREATE TABLE IF NOT EXISTS "public"."empleados" (
    "id" integer NOT NULL,
    "nombre" "text" NOT NULL,
    "correo" "text" NOT NULL,
    "telefono" character varying(20),
    "rol_id" integer,
    "area_id" integer,
    "auth_user_id" "uuid",
    "fecha_ingreso" "date",
    "salario" numeric,
    "horas" numeric,
    "periodo" "text",
    "nivel" "text",
    "password_creada" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "password_configurado" boolean DEFAULT false NOT NULL,
    "estado" character varying(10) DEFAULT 'activo'::character varying NOT NULL,
    CONSTRAINT "empleados_estado_check" CHECK ((("estado")::"text" = ANY ((ARRAY['activo'::character varying, 'baja'::character varying])::"text"[])))
);


ALTER TABLE "public"."empleados" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."empleados_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."empleados_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."empleados_id_seq" OWNED BY "public"."empleados"."id";



CREATE TABLE IF NOT EXISTS "public"."factura_archivo" (
    "id_archivo" bigint NOT NULL,
    "id_factura" bigint NOT NULL,
    "tipo" character varying(10) NOT NULL,
    "url" "text" NOT NULL,
    "nombre_archivo" character varying(255),
    "usuario_registro" character varying(200),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "factura_archivo_tipo_check" CHECK ((("tipo")::"text" = ANY ((ARRAY['png'::character varying, 'pdf'::character varying])::"text"[])))
);


ALTER TABLE "public"."factura_archivo" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."factura_archivo_id_archivo_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."factura_archivo_id_archivo_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."factura_archivo_id_archivo_seq" OWNED BY "public"."factura_archivo"."id_archivo";



CREATE TABLE IF NOT EXISTS "public"."factura_detalle" (
    "id_factura_detalle" bigint NOT NULL,
    "id_factura" bigint NOT NULL,
    "descripcion" character varying(300) NOT NULL,
    "cantidad" numeric(12,4) DEFAULT 1 NOT NULL,
    "precio_unitario" numeric(14,2) DEFAULT 0 NOT NULL,
    "orden" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id_transaccion" bigint,
    "unidad" character varying(20) DEFAULT 'Servicio'::character varying,
    "monto_total_linea" numeric(14,2),
    "subtotal" numeric(14,2) GENERATED ALWAYS AS (("cantidad" * "precio_unitario")) STORED
);


ALTER TABLE "public"."factura_detalle" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."factura_detalle_id_factura_detalle_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."factura_detalle_id_factura_detalle_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."factura_detalle_id_factura_detalle_seq" OWNED BY "public"."factura_detalle"."id_factura_detalle";



CREATE SEQUENCE IF NOT EXISTS "public"."factura_folio_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."factura_folio_seq" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."factura_id_factura_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."factura_id_factura_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."factura_id_factura_seq" OWNED BY "public"."factura"."id_factura";



CREATE TABLE IF NOT EXISTS "public"."igv_objetivo" (
    "id" smallint DEFAULT 1 NOT NULL,
    "objetivo_mensual" numeric(14,2) DEFAULT 5000 NOT NULL,
    "usuario_registro" character varying(200),
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "igv_objetivo_singleton" CHECK (("id" = 1))
);


ALTER TABLE "public"."igv_objetivo" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."incidencia" (
    "id_incidencia" bigint NOT NULL,
    "severidad" character varying(10) NOT NULL,
    "estado" character varying(25) DEFAULT 'OPEN'::character varying NOT NULL,
    "fecha_deteccion" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tipo_entidad" character varying(30) NOT NULL,
    "id_entidad" bigint,
    "origen_check" character varying(60),
    "causa" "text",
    "descripcion" "text" NOT NULL,
    "monto_diferencia" numeric(14,2),
    "creado_por" character varying(200),
    "resuelto_por" character varying(200),
    "resuelto_en" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "incidencia_estado_check" CHECK ((("estado")::"text" = ANY ((ARRAY['OPEN'::character varying, 'INVESTIGATING'::character varying, 'CAUSE_IDENTIFIED'::character varying, 'ADJUSTMENT_REQUIRED'::character varying, 'RESOLVED'::character varying, 'CLOSED'::character varying])::"text"[]))),
    CONSTRAINT "incidencia_severidad_check" CHECK ((("severidad")::"text" = ANY ((ARRAY['baja'::character varying, 'media'::character varying, 'alta'::character varying, 'critica'::character varying])::"text"[]))),
    CONSTRAINT "incidencia_tipo_entidad_check" CHECK ((("tipo_entidad")::"text" = ANY ((ARRAY['conciliacion'::character varying, 'centro_costo'::character varying, 'cuenta_banco'::character varying, 'transaccion'::character varying, 'revision_financiera'::character varying, 'otro'::character varying])::"text"[])))
);


ALTER TABLE "public"."incidencia" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."incidencia_evento" (
    "id_evento" bigint NOT NULL,
    "id_incidencia" bigint NOT NULL,
    "tipo_evento" character varying(30) NOT NULL,
    "estado_anterior" character varying(25),
    "estado_nuevo" character varying(25),
    "comentario" "text",
    "usuario" character varying(200),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "incidencia_evento_tipo_evento_check" CHECK ((("tipo_evento")::"text" = ANY ((ARRAY['creacion'::character varying, 'cambio_estado'::character varying, 'nota'::character varying, 'ajuste_registrado'::character varying])::"text"[])))
);


ALTER TABLE "public"."incidencia_evento" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."incidencia_evento_id_evento_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."incidencia_evento_id_evento_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."incidencia_evento_id_evento_seq" OWNED BY "public"."incidencia_evento"."id_evento";



CREATE SEQUENCE IF NOT EXISTS "public"."incidencia_id_incidencia_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."incidencia_id_incidencia_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."incidencia_id_incidencia_seq" OWNED BY "public"."incidencia"."id_incidencia";



CREATE TABLE IF NOT EXISTS "public"."instance_audit_log" (
    "id_audit" bigint NOT NULL,
    "project_id" bigint NOT NULL,
    "table_name" "text" NOT NULL,
    "record_id" bigint NOT NULL,
    "action" "text" NOT NULL,
    "old_data" "jsonb",
    "new_data" "jsonb",
    "changed_by" "uuid",
    "changed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."instance_audit_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."instance_audit_log_id_audit_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."instance_audit_log_id_audit_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."instance_audit_log_id_audit_seq" OWNED BY "public"."instance_audit_log"."id_audit";



CREATE TABLE IF NOT EXISTS "public"."lookahead" (
    "id_lookahead" bigint NOT NULL,
    "id_proyecto" bigint NOT NULL,
    "id_partida" bigint,
    "fecha_plan" "date" NOT NULL,
    "cantidad_plan" numeric(12,4),
    "recurso_asignado" character varying(200),
    "restriccion" character varying(200),
    "usuario_registro" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."lookahead" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."lookahead_id_lookahead_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."lookahead_id_lookahead_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."lookahead_id_lookahead_seq" OWNED BY "public"."lookahead"."id_lookahead";



CREATE TABLE IF NOT EXISTS "public"."metrado" (
    "id_metrado" bigint NOT NULL,
    "id_proyecto" bigint NOT NULL,
    "id_partida" bigint,
    "descripcion" "text",
    "unidad" character varying(10),
    "cantidad" numeric(12,4),
    "largo" numeric(10,2),
    "ancho" numeric(10,2),
    "alto" numeric(10,2),
    "formula" "text",
    "total" numeric(12,4) GENERATED ALWAYS AS (((("cantidad" * COALESCE("largo", (1)::numeric)) * COALESCE("ancho", (1)::numeric)) * COALESCE("alto", (1)::numeric))) STORED,
    "usuario_registro" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."metrado" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."metrado_id_metrado_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."metrado_id_metrado_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."metrado_id_metrado_seq" OWNED BY "public"."metrado"."id_metrado";



CREATE TABLE IF NOT EXISTS "public"."partida" (
    "id_partida" bigint NOT NULL,
    "codigo" character varying(20) NOT NULL,
    "tipo_partida" character varying(2),
    "descripcion" "text" NOT NULL,
    "unidad" character varying(10),
    "cuadrilla" integer,
    "precio_unitario" numeric(12,2),
    "precio_parcial" numeric(12,2),
    "nivel" integer NOT NULL,
    "id_partida_padre" bigint,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "metrado" numeric
);


ALTER TABLE "public"."partida" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."mv_partida_tree" AS
 WITH RECURSIVE "arbol" AS (
         SELECT "partida"."id_partida",
            "partida"."id_partida_padre",
            "partida"."codigo",
            "partida"."descripcion",
            1 AS "nivel"
           FROM "public"."partida"
          WHERE ("partida"."id_partida_padre" IS NULL)
        UNION ALL
         SELECT "p"."id_partida",
            "p"."id_partida_padre",
            "p"."codigo",
            "p"."descripcion",
            ("a"."nivel" + 1)
           FROM ("public"."partida" "p"
             JOIN "arbol" "a" ON (("p"."id_partida_padre" = "a"."id_partida")))
        )
 SELECT "id_partida",
    "id_partida_padre",
    "codigo",
    "descripcion",
    "nivel"
   FROM "arbol"
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."mv_partida_tree" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."nota_credito_folio_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."nota_credito_folio_seq" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."nota_debito_folio_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."nota_debito_folio_seq" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pagos_id_pago_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pagos_id_pago_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pagos_id_pago_seq" OWNED BY "public"."pagos"."id_pago";



CREATE SEQUENCE IF NOT EXISTS "public"."partida_id_partida_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."partida_id_partida_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."partida_id_partida_seq" OWNED BY "public"."partida"."id_partida";



CREATE TABLE IF NOT EXISTS "public"."permisos" (
    "id" integer NOT NULL,
    "nombre" character varying(100) NOT NULL,
    "descripcion" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."permisos" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."permisos_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."permisos_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."permisos_id_seq" OWNED BY "public"."permisos"."id";



CREATE TABLE IF NOT EXISTS "public"."plantilla_actividad" (
    "id_plantilla_actividad" bigint NOT NULL,
    "id_plantilla" bigint NOT NULL,
    "id_partida" bigint,
    "nombre_actividad" character varying(200) NOT NULL,
    "nivel" integer DEFAULT 1 NOT NULL,
    "id_actividad_padre_template" bigint,
    "duracion_dias" integer DEFAULT 7 NOT NULL,
    "lag_inicio_dias" integer DEFAULT 0 NOT NULL,
    "orden" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."plantilla_actividad" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."plantilla_actividad_id_plantilla_actividad_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."plantilla_actividad_id_plantilla_actividad_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."plantilla_actividad_id_plantilla_actividad_seq" OWNED BY "public"."plantilla_actividad"."id_plantilla_actividad";



CREATE TABLE IF NOT EXISTS "public"."plantilla_cronograma" (
    "id_plantilla" bigint NOT NULL,
    "nombre" character varying(100) NOT NULL,
    "descripcion" "text",
    "categoria" character varying(50),
    "usuario_registro" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."plantilla_cronograma" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."plantilla_cronograma_id_plantilla_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."plantilla_cronograma_id_plantilla_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."plantilla_cronograma_id_plantilla_seq" OWNED BY "public"."plantilla_cronograma"."id_plantilla";



CREATE TABLE IF NOT EXISTS "public"."plantilla_detalle" (
    "id_plantilla_detalle" bigint NOT NULL,
    "id_plantilla" bigint NOT NULL,
    "id_partida" bigint NOT NULL,
    "cantidad_sugerida" numeric(12,4),
    "orden" integer,
    "usuario_registro" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."plantilla_detalle" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."plantilla_detalle_id_plantilla_detalle_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."plantilla_detalle_id_plantilla_detalle_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."plantilla_detalle_id_plantilla_detalle_seq" OWNED BY "public"."plantilla_detalle"."id_plantilla_detalle";



CREATE TABLE IF NOT EXISTS "public"."plantilla_presupuesto" (
    "id_plantilla" bigint NOT NULL,
    "nombre" character varying(200) NOT NULL,
    "descripcion" "text",
    "tipo" character varying(50),
    "usuario_registro" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."plantilla_presupuesto" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."plantilla_presupuesto_id_plantilla_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."plantilla_presupuesto_id_plantilla_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."plantilla_presupuesto_id_plantilla_seq" OWNED BY "public"."plantilla_presupuesto"."id_plantilla";



CREATE TABLE IF NOT EXISTS "public"."presupuesto" (
    "id_presupuesto" bigint NOT NULL,
    "id_proyecto" bigint NOT NULL,
    "nombre" character varying(200) NOT NULL,
    "fecha_creacion" "date" DEFAULT CURRENT_DATE,
    "moneda" character varying(3) DEFAULT 'PEN'::character varying,
    "tipo" character varying(20) DEFAULT 'obra'::character varying,
    "usuario_registro" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "gastos_generales_pct" numeric(5,2) DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."presupuesto" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."presupuesto_detalle" (
    "id_presupuesto_detalle" bigint NOT NULL,
    "id_presupuesto" bigint NOT NULL,
    "id_partida" bigint NOT NULL,
    "cantidad" numeric(12,4) NOT NULL,
    "precio_mo" numeric(12,2) DEFAULT 0,
    "precio_mat" numeric(12,2) DEFAULT 0,
    "precio_unitario" numeric(12,2) GENERATED ALWAYS AS ((COALESCE("precio_mo", (0)::numeric) + COALESCE("precio_mat", (0)::numeric))) STORED,
    "total" numeric(12,2) GENERATED ALWAYS AS (("cantidad" * (COALESCE("precio_mo", (0)::numeric) + COALESCE("precio_mat", (0)::numeric)))) STORED,
    "usuario_registro" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."presupuesto_detalle" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."presupuesto_detalle_id_presupuesto_detalle_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."presupuesto_detalle_id_presupuesto_detalle_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."presupuesto_detalle_id_presupuesto_detalle_seq" OWNED BY "public"."presupuesto_detalle"."id_presupuesto_detalle";



CREATE SEQUENCE IF NOT EXISTS "public"."presupuesto_id_presupuesto_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."presupuesto_id_presupuesto_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."presupuesto_id_presupuesto_seq" OWNED BY "public"."presupuesto"."id_presupuesto";



CREATE TABLE IF NOT EXISTS "public"."proveedor" (
    "id_proveedor" bigint NOT NULL,
    "razon_social" character varying(200) NOT NULL,
    "ruc" character varying(11),
    "contacto" character varying(100),
    "telefono" character varying(20),
    "email" character varying(100),
    "vendedor" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "usuario_registro" character varying(100),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "estado" character varying(10) DEFAULT 'activo'::character varying NOT NULL,
    "banco" character varying(100),
    "cci" character varying(30),
    "cuenta_banco" character varying(50)
);


ALTER TABLE "public"."proveedor" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."proveedor_id_proveedor_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."proveedor_id_proveedor_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."proveedor_id_proveedor_seq" OWNED BY "public"."proveedor"."id_proveedor";



CREATE TABLE IF NOT EXISTS "public"."proyecto" (
    "id_proyecto" bigint NOT NULL,
    "id_cliente" bigint NOT NULL,
    "tip_proyecto" character varying(10),
    "nombre_proyecto" character varying(200) NOT NULL,
    "ubicacion" "text",
    "fecha_inicio_plan" "date",
    "fecha_fin_plan" "date",
    "estado_predio" character varying(4),
    "tipo_edifica" character varying(4),
    "nro_pisos" integer,
    "distrito" character varying(4),
    "provincia" character varying(4),
    "departamento" character varying(4),
    "costo_estima" double precision,
    "precio_venta" double precision,
    "descripcion" character varying(200),
    "responsable" character varying(200),
    "duracion_semanas" integer,
    "usuario_registro" character varying(200),
    "contrato" character varying(200),
    "estado_proyecto" character varying(20) DEFAULT 'activo'::character varying,
    "id_pres_inicial" bigint,
    "id_pres_final" bigint,
    "area_terreno" numeric(12,2),
    "area_construida" numeric(12,2),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "asesor_comercial_id" character varying(200),
    "comision_asesor" numeric(5,2),
    "direccion_predio" "text",
    "tipo_edificacion2" character varying(20),
    "tipo_venta" character varying(20) DEFAULT 'obra'::character varying NOT NULL,
    "tipo_obra" character varying(10),
    "tipo_tramite" character varying(10),
    "tipo_intervencion" character varying(10),
    "tipo_edificacion_obra" character varying(10),
    "mes_obra" character varying(2),
    "anio_obra" integer,
    "alcance_obra" character varying(2),
    "tipo_contratacion" character varying(2),
    "correlativo_distrito" integer,
    CONSTRAINT "chk_proyecto_tipo_venta" CHECK ((("tipo_venta")::"text" = ANY ((ARRAY['obra'::character varying, 'consultoria'::character varying])::"text"[])))
);

ALTER TABLE ONLY "public"."proyecto" REPLICA IDENTITY FULL;


ALTER TABLE "public"."proyecto" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."proyecto_id_proyecto_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."proyecto_id_proyecto_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."proyecto_id_proyecto_seq" OWNED BY "public"."proyecto"."id_proyecto";



CREATE TABLE IF NOT EXISTS "public"."recurso_precio" (
    "id_recurso" bigint NOT NULL,
    "tipo" character varying(20) NOT NULL,
    "nombre" character varying(100) NOT NULL,
    "unidad" character varying(20),
    "precio_unitario" numeric(12,2) NOT NULL,
    "fecha_vigencia" "date" DEFAULT CURRENT_DATE,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "recurso_precio_tipo_check" CHECK ((("tipo")::"text" = ANY ((ARRAY['mano_obra'::character varying, 'material'::character varying, 'equipo'::character varying])::"text"[])))
);


ALTER TABLE "public"."recurso_precio" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."recurso_precio_id_recurso_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."recurso_precio_id_recurso_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."recurso_precio_id_recurso_seq" OWNED BY "public"."recurso_precio"."id_recurso";



CREATE TABLE IF NOT EXISTS "public"."restriccion" (
    "id_restriccion" bigint NOT NULL,
    "id_proyecto" bigint NOT NULL,
    "actividad_relacionada" character varying(200) NOT NULL,
    "monto_estimado" numeric(12,2),
    "fecha_maxima" "date" NOT NULL,
    "es_finanzas" boolean DEFAULT false,
    "es_of_tecnica" boolean DEFAULT false,
    "es_mobra" boolean DEFAULT false,
    "responsable" character varying(200),
    "usuario_registro" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "estado" character varying(20) DEFAULT 'abierta'::character varying NOT NULL,
    "tipo_restriccion" character varying(50),
    "descripcion" "text",
    "id_cronograma_actividad" bigint,
    CONSTRAINT "restriccion_estado_check" CHECK ((("estado")::"text" = ANY ((ARRAY['abierta'::character varying, 'en_seguimiento'::character varying, 'resuelta'::character varying])::"text"[])))
);


ALTER TABLE "public"."restriccion" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."restriccion_id_restriccion_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."restriccion_id_restriccion_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."restriccion_id_restriccion_seq" OWNED BY "public"."restriccion"."id_restriccion";



CREATE TABLE IF NOT EXISTS "public"."revision_financiera" (
    "id_revision" bigint NOT NULL,
    "fecha" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resultado" "jsonb" NOT NULL,
    "controles_ok" smallint DEFAULT 0 NOT NULL,
    "controles_alerta" smallint DEFAULT 0 NOT NULL,
    "controles_error" smallint DEFAULT 0 NOT NULL,
    "usuario_registro" character varying(200),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."revision_financiera" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."revision_financiera_id_revision_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."revision_financiera_id_revision_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."revision_financiera_id_revision_seq" OWNED BY "public"."revision_financiera"."id_revision";



CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" integer NOT NULL,
    "nombre" character varying(50) NOT NULL,
    "descripcion" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."roles_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."roles_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."roles_id_seq" OWNED BY "public"."roles"."id";



CREATE TABLE IF NOT EXISTS "public"."roles_permisos" (
    "rol_id" integer NOT NULL,
    "permiso_id" integer NOT NULL
);


ALTER TABLE "public"."roles_permisos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."seguimiento_proyecto" (
    "id_seguimiento" bigint NOT NULL,
    "id_proyecto" bigint NOT NULL,
    "fecha_seguimiento" "date" NOT NULL,
    "porcentaje_avance_fisico" numeric(5,2) DEFAULT 0,
    "porcentaje_avance_financiero" numeric(5,2) DEFAULT 0,
    "costo_real_acumulado" numeric(12,2) DEFAULT 0,
    "ingreso_real_acumulado" numeric(12,2) DEFAULT 0,
    "horas_trabajadas_acum" numeric(10,2),
    "observaciones" "text",
    "usuario_registro" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."seguimiento_proyecto" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."seguimiento_proyecto_id_seguimiento_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."seguimiento_proyecto_id_seguimiento_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."seguimiento_proyecto_id_seguimiento_seq" OWNED BY "public"."seguimiento_proyecto"."id_seguimiento";



CREATE TABLE IF NOT EXISTS "public"."solicitud_aprobacion" (
    "id_solicitud" bigint NOT NULL,
    "tipo_entidad" character varying(20) NOT NULL,
    "id_entidad" bigint,
    "tipo_accion" character varying(20) NOT NULL,
    "descripcion_entidad" character varying(200),
    "payload_cambios" "jsonb",
    "solicitado_por" character varying(200),
    "solicitado_por_id" "uuid",
    "estado" character varying(20) DEFAULT 'pendiente'::character varying NOT NULL,
    "resuelto_por" character varying(200),
    "resuelto_en" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "visto_por_solicitante" boolean DEFAULT false NOT NULL,
    "visto_por_admin" boolean DEFAULT false NOT NULL,
    "payload_anterior" "jsonb",
    CONSTRAINT "solicitud_aprobacion_estado_check" CHECK ((("estado")::"text" = ANY ((ARRAY['pendiente'::character varying, 'aprobado'::character varying, 'rechazado'::character varying])::"text"[]))),
    CONSTRAINT "solicitud_aprobacion_tipo_accion_check" CHECK ((("tipo_accion")::"text" = ANY ((ARRAY['editar'::character varying, 'eliminar'::character varying, 'cerrar_venta'::character varying, 'exportar'::character varying, 'quitar_aprobacion'::character varying])::"text"[]))),
    CONSTRAINT "solicitud_aprobacion_tipo_entidad_check" CHECK ((("tipo_entidad")::"text" = ANY ((ARRAY['cliente'::character varying, 'proyecto'::character varying, 'exportacion'::character varying, 'transaccion'::character varying])::"text"[])))
);

ALTER TABLE ONLY "public"."solicitud_aprobacion" REPLICA IDENTITY FULL;


ALTER TABLE "public"."solicitud_aprobacion" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."solicitud_aprobacion_id_solicitud_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."solicitud_aprobacion_id_solicitud_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."solicitud_aprobacion_id_solicitud_seq" OWNED BY "public"."solicitud_aprobacion"."id_solicitud";



CREATE TABLE IF NOT EXISTS "public"."solicitud_notificacion" (
    "id_notificacion" bigint NOT NULL,
    "id_solicitud" bigint NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "estado_anterior" character varying(20),
    "notificado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."solicitud_notificacion" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."solicitud_notificacion_id_notificacion_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."solicitud_notificacion_id_notificacion_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."solicitud_notificacion_id_notificacion_seq" OWNED BY "public"."solicitud_notificacion"."id_notificacion";



CREATE TABLE IF NOT EXISTS "public"."ticket" (
    "id_ticket" bigint NOT NULL,
    "tipo" character varying(20) NOT NULL,
    "modulo" character varying(60),
    "titulo" character varying(150) NOT NULL,
    "descripcion" "text" NOT NULL,
    "prioridad" character varying(10) DEFAULT 'media'::character varying NOT NULL,
    "estado" character varying(15) DEFAULT 'abierto'::character varying NOT NULL,
    "creado_por" character varying(200),
    "creado_por_id" "uuid",
    "resuelto_por" character varying(200),
    "resuelto_en" timestamp with time zone,
    "aprobado_por" character varying(200),
    "aprobado_en" timestamp with time zone,
    "motivo_rechazo" "text",
    "id_release" bigint,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "imagen_url" "text",
    CONSTRAINT "ticket_estado_check" CHECK ((("estado")::"text" = ANY ((ARRAY['abierto'::character varying, 'en_progreso'::character varying, 'resuelto'::character varying, 'aprobado'::character varying, 'rechazado'::character varying, 'cerrado'::character varying])::"text"[]))),
    CONSTRAINT "ticket_prioridad_check" CHECK ((("prioridad")::"text" = ANY ((ARRAY['baja'::character varying, 'media'::character varying, 'alta'::character varying, 'critica'::character varying])::"text"[]))),
    CONSTRAINT "ticket_tipo_check" CHECK ((("tipo")::"text" = ANY ((ARRAY['reclamo'::character varying, 'sugerencia'::character varying, 'incidencia'::character varying, 'requerimiento'::character varying])::"text"[])))
);

ALTER TABLE ONLY "public"."ticket" REPLICA IDENTITY FULL;


ALTER TABLE "public"."ticket" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ticket_comentario" (
    "id_comentario" bigint NOT NULL,
    "id_ticket" bigint NOT NULL,
    "autor" character varying(200),
    "autor_id" "uuid",
    "mensaje" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "imagen_url" "text"
);

ALTER TABLE ONLY "public"."ticket_comentario" REPLICA IDENTITY FULL;


ALTER TABLE "public"."ticket_comentario" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."ticket_comentario_id_comentario_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ticket_comentario_id_comentario_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ticket_comentario_id_comentario_seq" OWNED BY "public"."ticket_comentario"."id_comentario";



CREATE TABLE IF NOT EXISTS "public"."ticket_evento" (
    "id_evento" bigint NOT NULL,
    "id_ticket" bigint NOT NULL,
    "estado_anterior" character varying(15),
    "estado_nuevo" character varying(15),
    "usuario" character varying(200),
    "comentario" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."ticket_evento" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."ticket_evento_id_evento_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ticket_evento_id_evento_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ticket_evento_id_evento_seq" OWNED BY "public"."ticket_evento"."id_evento";



CREATE SEQUENCE IF NOT EXISTS "public"."ticket_id_ticket_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ticket_id_ticket_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ticket_id_ticket_seq" OWNED BY "public"."ticket"."id_ticket";



CREATE TABLE IF NOT EXISTS "public"."trans_detalle" (
    "id_trans_detalle" bigint NOT NULL,
    "id_transaccion" bigint NOT NULL,
    "id_partida" bigint,
    "cantidad" numeric(12,4),
    "precio_unitario" numeric(12,2),
    "monto_igv" numeric(12,2),
    "porc_detraccion" numeric(5,2),
    "monto_detraccion" numeric(12,2),
    "subtotal" numeric(12,2) GENERATED ALWAYS AS (("cantidad" * "precio_unitario")) STORED,
    "usuario_registro" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."trans_detalle" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."trans_detalle_id_trans_detalle_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."trans_detalle_id_trans_detalle_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."trans_detalle_id_trans_detalle_seq" OWNED BY "public"."trans_detalle"."id_trans_detalle";



CREATE TABLE IF NOT EXISTS "public"."transaccion_comprobante_pago" (
    "id_comprobante_pago" bigint NOT NULL,
    "id_transaccion" bigint NOT NULL,
    "tipo_documento" character varying(30),
    "num_documento" character varying(30),
    "monto" numeric,
    "url" "text" NOT NULL,
    "nombre_archivo" character varying(255),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."transaccion_comprobante_pago" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."transaccion_comprobante_pago_id_comprobante_pago_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."transaccion_comprobante_pago_id_comprobante_pago_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."transaccion_comprobante_pago_id_comprobante_pago_seq" OWNED BY "public"."transaccion_comprobante_pago"."id_comprobante_pago";



CREATE TABLE IF NOT EXISTS "public"."transaccion_detalle_categoria" (
    "id_detalle_categoria" bigint NOT NULL,
    "id_transaccion" bigint NOT NULL,
    "subcategoria" character varying(100) NOT NULL,
    "descripcion" character varying(200),
    "cantidad" numeric NOT NULL,
    "unidad" character varying(20),
    "precio_unitario" numeric NOT NULL,
    "total" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."transaccion_detalle_categoria" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."transaccion_detalle_categoria_id_detalle_categoria_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."transaccion_detalle_categoria_id_detalle_categoria_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."transaccion_detalle_categoria_id_detalle_categoria_seq" OWNED BY "public"."transaccion_detalle_categoria"."id_detalle_categoria";



CREATE SEQUENCE IF NOT EXISTS "public"."transaccion_id_transaccion_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."transaccion_id_transaccion_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."transaccion_id_transaccion_seq" OWNED BY "public"."transaccion"."id_transaccion";



CREATE TABLE IF NOT EXISTS "public"."valorizacion_partida" (
    "id_valorizacion_partida" bigint NOT NULL,
    "id_valorizacion" bigint NOT NULL,
    "id_partida" bigint NOT NULL,
    "monto" numeric(12,2) NOT NULL,
    "porcentaje_avance" numeric(5,2),
    "usuario_registro" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."valorizacion_partida" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."valorizacion_partida_id_valorizacion_partida_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."valorizacion_partida_id_valorizacion_partida_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."valorizacion_partida_id_valorizacion_partida_seq" OWNED BY "public"."valorizacion_partida"."id_valorizacion_partida";



CREATE TABLE IF NOT EXISTS "public"."valorizacion_semanal" (
    "id_valorizacion" bigint NOT NULL,
    "id_proyecto" bigint NOT NULL,
    "semana_numero" integer NOT NULL,
    "fecha_inicio" "date",
    "fecha_fin" "date",
    "monto_total" numeric(12,2) NOT NULL,
    "porcentaje_acumulado" numeric(5,2),
    "usuario_registro" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."valorizacion_semanal" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."valorizacion_semanal_id_valorizacion_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."valorizacion_semanal_id_valorizacion_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."valorizacion_semanal_id_valorizacion_seq" OWNED BY "public"."valorizacion_semanal"."id_valorizacion";



ALTER TABLE ONLY "public"."acero_detalle" ALTER COLUMN "id_acero" SET DEFAULT "nextval"('"public"."acero_detalle_id_acero_seq"'::"regclass");



ALTER TABLE ONLY "public"."adelanto" ALTER COLUMN "id_adelanto" SET DEFAULT "nextval"('"public"."adelanto_id_adelanto_seq"'::"regclass");



ALTER TABLE ONLY "public"."anuncios" ALTER COLUMN "id_anuncio" SET DEFAULT "nextval"('"public"."anuncios_id_anuncio_seq"'::"regclass");



ALTER TABLE ONLY "public"."apertura_financiera" ALTER COLUMN "id_apertura" SET DEFAULT "nextval"('"public"."apertura_financiera_id_apertura_seq"'::"regclass");



ALTER TABLE ONLY "public"."app_release" ALTER COLUMN "id_release" SET DEFAULT "nextval"('"public"."app_release_id_release_seq"'::"regclass");



ALTER TABLE ONLY "public"."app_version_usuario" ALTER COLUMN "id_registro" SET DEFAULT "nextval"('"public"."app_version_usuario_id_registro_seq"'::"regclass");



ALTER TABLE ONLY "public"."area" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."area_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."centro_costo" ALTER COLUMN "id_centro_costo" SET DEFAULT "nextval"('"public"."centro_costo_id_centro_costo_seq"'::"regclass");



ALTER TABLE ONLY "public"."cliente" ALTER COLUMN "id_cliente" SET DEFAULT "nextval"('"public"."cliente_id_cliente_seq"'::"regclass");



ALTER TABLE ONLY "public"."cobros" ALTER COLUMN "id_cobro" SET DEFAULT "nextval"('"public"."cobros_id_cobro_seq"'::"regclass");



ALTER TABLE ONLY "public"."conciliacion_financiera" ALTER COLUMN "id_conciliacion" SET DEFAULT "nextval"('"public"."conciliacion_financiera_id_conciliacion_seq"'::"regclass");



ALTER TABLE ONLY "public"."contrato_proyecto" ALTER COLUMN "id_contrato" SET DEFAULT "nextval"('"public"."contrato_proyecto_id_contrato_seq"'::"regclass");



ALTER TABLE ONLY "public"."cronograma_actividad" ALTER COLUMN "id_cronograma_actividad" SET DEFAULT "nextval"('"public"."cronograma_actividad_id_cronograma_actividad_seq"'::"regclass");



ALTER TABLE ONLY "public"."cronograma_dependencia" ALTER COLUMN "id_dependencia" SET DEFAULT "nextval"('"public"."cronograma_dependencia_id_dependencia_seq"'::"regclass");



ALTER TABLE ONLY "public"."cronograma_detalle_semanal" ALTER COLUMN "id_cronograma_detalle" SET DEFAULT "nextval"('"public"."cronograma_detalle_semanal_id_cronograma_detalle_seq"'::"regclass");



ALTER TABLE ONLY "public"."cronograma_plan_base" ALTER COLUMN "id_plan_base" SET DEFAULT "nextval"('"public"."cronograma_plan_base_id_plan_base_seq"'::"regclass");



ALTER TABLE ONLY "public"."cuenta_banco" ALTER COLUMN "id_cuenta_banco" SET DEFAULT "nextval"('"public"."cuenta_banco_id_cuenta_banco_seq"'::"regclass");



ALTER TABLE ONLY "public"."cuentas_cobrar" ALTER COLUMN "id_cuenta_cobrar" SET DEFAULT "nextval"('"public"."cuentas_cobrar_id_cuenta_cobrar_seq"'::"regclass");



ALTER TABLE ONLY "public"."cuentas_pagar" ALTER COLUMN "id_cuenta_pagar" SET DEFAULT "nextval"('"public"."cuentas_pagar_id_cuenta_pagar_seq"'::"regclass");



ALTER TABLE ONLY "public"."documento_proyecto" ALTER COLUMN "id_documento" SET DEFAULT "nextval"('"public"."documento_proyecto_id_documento_seq"'::"regclass");



ALTER TABLE ONLY "public"."egreso_semanal" ALTER COLUMN "id_egreso" SET DEFAULT "nextval"('"public"."egreso_semanal_id_egreso_seq"'::"regclass");



ALTER TABLE ONLY "public"."empleados" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."empleados_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."factura" ALTER COLUMN "id_factura" SET DEFAULT "nextval"('"public"."factura_id_factura_seq"'::"regclass");



ALTER TABLE ONLY "public"."factura_archivo" ALTER COLUMN "id_archivo" SET DEFAULT "nextval"('"public"."factura_archivo_id_archivo_seq"'::"regclass");



ALTER TABLE ONLY "public"."factura_detalle" ALTER COLUMN "id_factura_detalle" SET DEFAULT "nextval"('"public"."factura_detalle_id_factura_detalle_seq"'::"regclass");



ALTER TABLE ONLY "public"."incidencia" ALTER COLUMN "id_incidencia" SET DEFAULT "nextval"('"public"."incidencia_id_incidencia_seq"'::"regclass");



ALTER TABLE ONLY "public"."incidencia_evento" ALTER COLUMN "id_evento" SET DEFAULT "nextval"('"public"."incidencia_evento_id_evento_seq"'::"regclass");



ALTER TABLE ONLY "public"."instance_audit_log" ALTER COLUMN "id_audit" SET DEFAULT "nextval"('"public"."instance_audit_log_id_audit_seq"'::"regclass");



ALTER TABLE ONLY "public"."lookahead" ALTER COLUMN "id_lookahead" SET DEFAULT "nextval"('"public"."lookahead_id_lookahead_seq"'::"regclass");



ALTER TABLE ONLY "public"."metrado" ALTER COLUMN "id_metrado" SET DEFAULT "nextval"('"public"."metrado_id_metrado_seq"'::"regclass");



ALTER TABLE ONLY "public"."pagos" ALTER COLUMN "id_pago" SET DEFAULT "nextval"('"public"."pagos_id_pago_seq"'::"regclass");



ALTER TABLE ONLY "public"."partida" ALTER COLUMN "id_partida" SET DEFAULT "nextval"('"public"."partida_id_partida_seq"'::"regclass");



ALTER TABLE ONLY "public"."permisos" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."permisos_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."plantilla_actividad" ALTER COLUMN "id_plantilla_actividad" SET DEFAULT "nextval"('"public"."plantilla_actividad_id_plantilla_actividad_seq"'::"regclass");



ALTER TABLE ONLY "public"."plantilla_cronograma" ALTER COLUMN "id_plantilla" SET DEFAULT "nextval"('"public"."plantilla_cronograma_id_plantilla_seq"'::"regclass");



ALTER TABLE ONLY "public"."plantilla_detalle" ALTER COLUMN "id_plantilla_detalle" SET DEFAULT "nextval"('"public"."plantilla_detalle_id_plantilla_detalle_seq"'::"regclass");



ALTER TABLE ONLY "public"."plantilla_presupuesto" ALTER COLUMN "id_plantilla" SET DEFAULT "nextval"('"public"."plantilla_presupuesto_id_plantilla_seq"'::"regclass");



ALTER TABLE ONLY "public"."presupuesto" ALTER COLUMN "id_presupuesto" SET DEFAULT "nextval"('"public"."presupuesto_id_presupuesto_seq"'::"regclass");



ALTER TABLE ONLY "public"."presupuesto_detalle" ALTER COLUMN "id_presupuesto_detalle" SET DEFAULT "nextval"('"public"."presupuesto_detalle_id_presupuesto_detalle_seq"'::"regclass");



ALTER TABLE ONLY "public"."proveedor" ALTER COLUMN "id_proveedor" SET DEFAULT "nextval"('"public"."proveedor_id_proveedor_seq"'::"regclass");



ALTER TABLE ONLY "public"."proyecto" ALTER COLUMN "id_proyecto" SET DEFAULT "nextval"('"public"."proyecto_id_proyecto_seq"'::"regclass");



ALTER TABLE ONLY "public"."recurso_precio" ALTER COLUMN "id_recurso" SET DEFAULT "nextval"('"public"."recurso_precio_id_recurso_seq"'::"regclass");



ALTER TABLE ONLY "public"."restriccion" ALTER COLUMN "id_restriccion" SET DEFAULT "nextval"('"public"."restriccion_id_restriccion_seq"'::"regclass");



ALTER TABLE ONLY "public"."revision_financiera" ALTER COLUMN "id_revision" SET DEFAULT "nextval"('"public"."revision_financiera_id_revision_seq"'::"regclass");



ALTER TABLE ONLY "public"."roles" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."roles_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."seguimiento_proyecto" ALTER COLUMN "id_seguimiento" SET DEFAULT "nextval"('"public"."seguimiento_proyecto_id_seguimiento_seq"'::"regclass");



ALTER TABLE ONLY "public"."solicitud_aprobacion" ALTER COLUMN "id_solicitud" SET DEFAULT "nextval"('"public"."solicitud_aprobacion_id_solicitud_seq"'::"regclass");



ALTER TABLE ONLY "public"."solicitud_notificacion" ALTER COLUMN "id_notificacion" SET DEFAULT "nextval"('"public"."solicitud_notificacion_id_notificacion_seq"'::"regclass");



ALTER TABLE ONLY "public"."ticket" ALTER COLUMN "id_ticket" SET DEFAULT "nextval"('"public"."ticket_id_ticket_seq"'::"regclass");



ALTER TABLE ONLY "public"."ticket_comentario" ALTER COLUMN "id_comentario" SET DEFAULT "nextval"('"public"."ticket_comentario_id_comentario_seq"'::"regclass");



ALTER TABLE ONLY "public"."ticket_evento" ALTER COLUMN "id_evento" SET DEFAULT "nextval"('"public"."ticket_evento_id_evento_seq"'::"regclass");



ALTER TABLE ONLY "public"."trans_detalle" ALTER COLUMN "id_trans_detalle" SET DEFAULT "nextval"('"public"."trans_detalle_id_trans_detalle_seq"'::"regclass");



ALTER TABLE ONLY "public"."transaccion" ALTER COLUMN "id_transaccion" SET DEFAULT "nextval"('"public"."transaccion_id_transaccion_seq"'::"regclass");



ALTER TABLE ONLY "public"."transaccion_comprobante_pago" ALTER COLUMN "id_comprobante_pago" SET DEFAULT "nextval"('"public"."transaccion_comprobante_pago_id_comprobante_pago_seq"'::"regclass");



ALTER TABLE ONLY "public"."transaccion_detalle_categoria" ALTER COLUMN "id_detalle_categoria" SET DEFAULT "nextval"('"public"."transaccion_detalle_categoria_id_detalle_categoria_seq"'::"regclass");



ALTER TABLE ONLY "public"."valorizacion_partida" ALTER COLUMN "id_valorizacion_partida" SET DEFAULT "nextval"('"public"."valorizacion_partida_id_valorizacion_partida_seq"'::"regclass");



ALTER TABLE ONLY "public"."valorizacion_semanal" ALTER COLUMN "id_valorizacion" SET DEFAULT "nextval"('"public"."valorizacion_semanal_id_valorizacion_seq"'::"regclass");



ALTER TABLE ONLY "public"."acero_detalle"
    ADD CONSTRAINT "acero_detalle_pkey" PRIMARY KEY ("id_acero");



ALTER TABLE ONLY "public"."adelanto"
    ADD CONSTRAINT "adelanto_pkey" PRIMARY KEY ("id_adelanto");



ALTER TABLE ONLY "public"."anuncios"
    ADD CONSTRAINT "anuncios_pkey" PRIMARY KEY ("id_anuncio");



ALTER TABLE ONLY "public"."apertura_financiera"
    ADD CONSTRAINT "apertura_financiera_pkey" PRIMARY KEY ("id_apertura");



ALTER TABLE ONLY "public"."app_release"
    ADD CONSTRAINT "app_release_pkey" PRIMARY KEY ("id_release");



ALTER TABLE ONLY "public"."app_release"
    ADD CONSTRAINT "app_release_version_key" UNIQUE ("version");



ALTER TABLE ONLY "public"."app_version_usuario"
    ADD CONSTRAINT "app_version_usuario_pkey" PRIMARY KEY ("id_registro");



ALTER TABLE ONLY "public"."area"
    ADD CONSTRAINT "area_nombre_key" UNIQUE ("nombre");



ALTER TABLE ONLY "public"."area"
    ADD CONSTRAINT "area_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."centro_costo"
    ADD CONSTRAINT "centro_costo_pkey" PRIMARY KEY ("id_centro_costo");



ALTER TABLE ONLY "public"."cliente"
    ADD CONSTRAINT "cliente_pkey" PRIMARY KEY ("id_cliente");



ALTER TABLE ONLY "public"."cobros"
    ADD CONSTRAINT "cobros_pkey" PRIMARY KEY ("id_cobro");



ALTER TABLE ONLY "public"."conciliacion_financiera"
    ADD CONSTRAINT "conciliacion_financiera_pkey" PRIMARY KEY ("id_conciliacion");



ALTER TABLE ONLY "public"."contrato_proyecto"
    ADD CONSTRAINT "contrato_proyecto_pkey" PRIMARY KEY ("id_contrato");



ALTER TABLE ONLY "public"."cronograma_actividad"
    ADD CONSTRAINT "cronograma_actividad_pkey" PRIMARY KEY ("id_cronograma_actividad");



ALTER TABLE ONLY "public"."cronograma_dependencia"
    ADD CONSTRAINT "cronograma_dependencia_pkey" PRIMARY KEY ("id_dependencia");



ALTER TABLE ONLY "public"."cronograma_detalle_semanal"
    ADD CONSTRAINT "cronograma_detalle_semanal_id_cronograma_actividad_semana_n_key" UNIQUE ("id_cronograma_actividad", "semana_numero");



ALTER TABLE ONLY "public"."cronograma_detalle_semanal"
    ADD CONSTRAINT "cronograma_detalle_semanal_pkey" PRIMARY KEY ("id_cronograma_detalle");



ALTER TABLE ONLY "public"."cronograma_plan_base"
    ADD CONSTRAINT "cronograma_plan_base_pkey" PRIMARY KEY ("id_plan_base");



ALTER TABLE ONLY "public"."cuenta_banco"
    ADD CONSTRAINT "cuenta_banco_pkey" PRIMARY KEY ("id_cuenta_banco");



ALTER TABLE ONLY "public"."cuentas_cobrar"
    ADD CONSTRAINT "cuentas_cobrar_pkey" PRIMARY KEY ("id_cuenta_cobrar");



ALTER TABLE ONLY "public"."cuentas_pagar"
    ADD CONSTRAINT "cuentas_pagar_pkey" PRIMARY KEY ("id_cuenta_pagar");



ALTER TABLE ONLY "public"."documento_proyecto"
    ADD CONSTRAINT "documento_proyecto_pkey" PRIMARY KEY ("id_documento");



ALTER TABLE ONLY "public"."egreso_semanal"
    ADD CONSTRAINT "egreso_semanal_pkey" PRIMARY KEY ("id_egreso");



ALTER TABLE ONLY "public"."empleados"
    ADD CONSTRAINT "empleados_auth_user_id_key" UNIQUE ("auth_user_id");



ALTER TABLE ONLY "public"."empleados"
    ADD CONSTRAINT "empleados_correo_key" UNIQUE ("correo");



ALTER TABLE ONLY "public"."empleados"
    ADD CONSTRAINT "empleados_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."factura_archivo"
    ADD CONSTRAINT "factura_archivo_pkey" PRIMARY KEY ("id_archivo");



ALTER TABLE ONLY "public"."factura_detalle"
    ADD CONSTRAINT "factura_detalle_pkey" PRIMARY KEY ("id_factura_detalle");



ALTER TABLE ONLY "public"."factura"
    ADD CONSTRAINT "factura_folio_key" UNIQUE ("folio");



ALTER TABLE ONLY "public"."factura"
    ADD CONSTRAINT "factura_pkey" PRIMARY KEY ("id_factura");



ALTER TABLE ONLY "public"."igv_objetivo"
    ADD CONSTRAINT "igv_objetivo_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."incidencia_evento"
    ADD CONSTRAINT "incidencia_evento_pkey" PRIMARY KEY ("id_evento");



ALTER TABLE ONLY "public"."incidencia"
    ADD CONSTRAINT "incidencia_pkey" PRIMARY KEY ("id_incidencia");



ALTER TABLE ONLY "public"."instance_audit_log"
    ADD CONSTRAINT "instance_audit_log_pkey" PRIMARY KEY ("id_audit");



ALTER TABLE ONLY "public"."lookahead"
    ADD CONSTRAINT "lookahead_pkey" PRIMARY KEY ("id_lookahead");



ALTER TABLE ONLY "public"."metrado"
    ADD CONSTRAINT "metrado_pkey" PRIMARY KEY ("id_metrado");



ALTER TABLE ONLY "public"."pagos"
    ADD CONSTRAINT "pagos_pkey" PRIMARY KEY ("id_pago");



ALTER TABLE ONLY "public"."partida"
    ADD CONSTRAINT "partida_codigo_key" UNIQUE ("codigo");



ALTER TABLE ONLY "public"."partida"
    ADD CONSTRAINT "partida_pkey" PRIMARY KEY ("id_partida");



ALTER TABLE ONLY "public"."permisos"
    ADD CONSTRAINT "permisos_nombre_key" UNIQUE ("nombre");



ALTER TABLE ONLY "public"."permisos"
    ADD CONSTRAINT "permisos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plantilla_actividad"
    ADD CONSTRAINT "plantilla_actividad_pkey" PRIMARY KEY ("id_plantilla_actividad");



ALTER TABLE ONLY "public"."plantilla_cronograma"
    ADD CONSTRAINT "plantilla_cronograma_pkey" PRIMARY KEY ("id_plantilla");



ALTER TABLE ONLY "public"."plantilla_detalle"
    ADD CONSTRAINT "plantilla_detalle_id_plantilla_id_partida_key" UNIQUE ("id_plantilla", "id_partida");



ALTER TABLE ONLY "public"."plantilla_detalle"
    ADD CONSTRAINT "plantilla_detalle_pkey" PRIMARY KEY ("id_plantilla_detalle");



ALTER TABLE ONLY "public"."plantilla_presupuesto"
    ADD CONSTRAINT "plantilla_presupuesto_pkey" PRIMARY KEY ("id_plantilla");



ALTER TABLE ONLY "public"."presupuesto_detalle"
    ADD CONSTRAINT "presupuesto_detalle_pkey" PRIMARY KEY ("id_presupuesto_detalle");



ALTER TABLE ONLY "public"."presupuesto"
    ADD CONSTRAINT "presupuesto_pkey" PRIMARY KEY ("id_presupuesto");



ALTER TABLE ONLY "public"."proveedor"
    ADD CONSTRAINT "proveedor_pkey" PRIMARY KEY ("id_proveedor");



ALTER TABLE ONLY "public"."proyecto"
    ADD CONSTRAINT "proyecto_pkey" PRIMARY KEY ("id_proyecto");



ALTER TABLE ONLY "public"."recurso_precio"
    ADD CONSTRAINT "recurso_precio_pkey" PRIMARY KEY ("id_recurso");



ALTER TABLE ONLY "public"."restriccion"
    ADD CONSTRAINT "restriccion_pkey" PRIMARY KEY ("id_restriccion");



ALTER TABLE ONLY "public"."revision_financiera"
    ADD CONSTRAINT "revision_financiera_pkey" PRIMARY KEY ("id_revision");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_nombre_key" UNIQUE ("nombre");



ALTER TABLE ONLY "public"."roles_permisos"
    ADD CONSTRAINT "roles_permisos_pkey" PRIMARY KEY ("rol_id", "permiso_id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seguimiento_proyecto"
    ADD CONSTRAINT "seguimiento_proyecto_pkey" PRIMARY KEY ("id_seguimiento");



ALTER TABLE ONLY "public"."solicitud_aprobacion"
    ADD CONSTRAINT "solicitud_aprobacion_pkey" PRIMARY KEY ("id_solicitud");



ALTER TABLE ONLY "public"."solicitud_notificacion"
    ADD CONSTRAINT "solicitud_notificacion_id_solicitud_usuario_id_key" UNIQUE ("id_solicitud", "usuario_id");



ALTER TABLE ONLY "public"."solicitud_notificacion"
    ADD CONSTRAINT "solicitud_notificacion_pkey" PRIMARY KEY ("id_notificacion");



ALTER TABLE ONLY "public"."ticket_comentario"
    ADD CONSTRAINT "ticket_comentario_pkey" PRIMARY KEY ("id_comentario");



ALTER TABLE ONLY "public"."ticket_evento"
    ADD CONSTRAINT "ticket_evento_pkey" PRIMARY KEY ("id_evento");



ALTER TABLE ONLY "public"."ticket"
    ADD CONSTRAINT "ticket_pkey" PRIMARY KEY ("id_ticket");



ALTER TABLE ONLY "public"."trans_detalle"
    ADD CONSTRAINT "trans_detalle_pkey" PRIMARY KEY ("id_trans_detalle");



ALTER TABLE ONLY "public"."transaccion_comprobante_pago"
    ADD CONSTRAINT "transaccion_comprobante_pago_pkey" PRIMARY KEY ("id_comprobante_pago");



ALTER TABLE ONLY "public"."transaccion_detalle_categoria"
    ADD CONSTRAINT "transaccion_detalle_categoria_pkey" PRIMARY KEY ("id_detalle_categoria");



ALTER TABLE ONLY "public"."transaccion"
    ADD CONSTRAINT "transaccion_pkey" PRIMARY KEY ("id_transaccion");



ALTER TABLE ONLY "public"."app_version_usuario"
    ADD CONSTRAINT "uq_app_version_usuario" UNIQUE ("user_id", "plataforma");



ALTER TABLE ONLY "public"."cronograma_dependencia"
    ADD CONSTRAINT "uq_dep" UNIQUE ("id_actividad_origen", "id_actividad_destino");



ALTER TABLE ONLY "public"."valorizacion_partida"
    ADD CONSTRAINT "valorizacion_partida_pkey" PRIMARY KEY ("id_valorizacion_partida");



ALTER TABLE ONLY "public"."valorizacion_semanal"
    ADD CONSTRAINT "valorizacion_semanal_pkey" PRIMARY KEY ("id_valorizacion");



CREATE UNIQUE INDEX "documento_proyecto_proforma_final_unique" ON "public"."documento_proyecto" USING "btree" ("id_proyecto") WHERE ("es_proforma_final" = true);



CREATE INDEX "idx_acero_proyecto" ON "public"."acero_detalle" USING "btree" ("id_proyecto");



CREATE INDEX "idx_apertura_financiera_centro_costo" ON "public"."apertura_financiera" USING "btree" ("id_centro_costo");



CREATE INDEX "idx_apertura_financiera_fecha" ON "public"."apertura_financiera" USING "btree" ("fecha_corte");



CREATE INDEX "idx_app_version_usuario_version" ON "public"."app_version_usuario" USING "btree" ("version");



CREATE INDEX "idx_audit_changed_at" ON "public"."instance_audit_log" USING "btree" ("changed_at" DESC);



CREATE INDEX "idx_audit_project_table" ON "public"."instance_audit_log" USING "btree" ("project_id", "table_name", "changed_at" DESC);



CREATE INDEX "idx_audit_record" ON "public"."instance_audit_log" USING "btree" ("record_id", "table_name");



CREATE INDEX "idx_centro_costo_id_cliente" ON "public"."centro_costo" USING "btree" ("id_cliente");



CREATE INDEX "idx_centro_costo_id_empleado" ON "public"."centro_costo" USING "btree" ("id_empleado");



CREATE INDEX "idx_centro_costo_id_proveedor" ON "public"."centro_costo" USING "btree" ("id_proveedor");



CREATE INDEX "idx_centro_costo_id_proyecto" ON "public"."centro_costo" USING "btree" ("id_proyecto");



CREATE INDEX "idx_cobros_id_transaccion" ON "public"."cobros" USING "btree" ("id_transaccion");



CREATE INDEX "idx_cobros_panorama" ON "public"."cobros" USING "btree" ("panorama_id");



CREATE INDEX "idx_conciliacion_fecha" ON "public"."conciliacion_financiera" USING "btree" ("fecha");



CREATE INDEX "idx_crono_act_padre" ON "public"."cronograma_actividad" USING "btree" ("id_actividad_padre");



CREATE INDEX "idx_crono_dep_destino" ON "public"."cronograma_dependencia" USING "btree" ("id_actividad_destino");



CREATE INDEX "idx_crono_dep_origen" ON "public"."cronograma_dependencia" USING "btree" ("id_actividad_origen");



CREATE INDEX "idx_crono_pb_proyecto" ON "public"."cronograma_plan_base" USING "btree" ("id_proyecto");



CREATE INDEX "idx_cronograma_proyecto" ON "public"."cronograma_actividad" USING "btree" ("id_proyecto");



CREATE INDEX "idx_cuentas_cobrar_id_transaccion" ON "public"."cuentas_cobrar" USING "btree" ("id_transaccion");



CREATE INDEX "idx_cuentas_cobrar_panorama" ON "public"."cuentas_cobrar" USING "btree" ("panorama_id");



CREATE INDEX "idx_cuentas_pagar_id_transaccion" ON "public"."cuentas_pagar" USING "btree" ("id_transaccion");



CREATE INDEX "idx_cuentas_pagar_presupuesto" ON "public"."cuentas_pagar" USING "btree" ("id_presupuesto");



CREATE INDEX "idx_documento_proyecto_proyecto" ON "public"."documento_proyecto" USING "btree" ("id_proyecto");



CREATE INDEX "idx_egreso_proyecto_semana" ON "public"."egreso_semanal" USING "btree" ("id_proyecto", "semana_numero");



CREATE INDEX "idx_factura_archivo_factura" ON "public"."factura_archivo" USING "btree" ("id_factura");



CREATE INDEX "idx_factura_cliente" ON "public"."factura" USING "btree" ("id_cliente");



CREATE INDEX "idx_factura_detalle_factura" ON "public"."factura_detalle" USING "btree" ("id_factura");



CREATE INDEX "idx_factura_detalle_transaccion" ON "public"."factura_detalle" USING "btree" ("id_transaccion");



CREATE INDEX "idx_factura_tipo_comprobante" ON "public"."factura" USING "btree" ("tipo_comprobante");



CREATE INDEX "idx_incidencia_estado" ON "public"."incidencia" USING "btree" ("estado");



CREATE INDEX "idx_incidencia_evento_incidencia" ON "public"."incidencia_evento" USING "btree" ("id_incidencia");



CREATE INDEX "idx_incidencia_severidad" ON "public"."incidencia" USING "btree" ("severidad");



CREATE INDEX "idx_lookahead_proyecto" ON "public"."lookahead" USING "btree" ("id_proyecto");



CREATE INDEX "idx_metrado_proyecto" ON "public"."metrado" USING "btree" ("id_proyecto");



CREATE INDEX "idx_pagos_id_transaccion" ON "public"."pagos" USING "btree" ("id_transaccion");



CREATE INDEX "idx_pagos_panorama" ON "public"."pagos" USING "btree" ("panorama_id");



CREATE INDEX "idx_partida_id_partida_padre" ON "public"."partida" USING "btree" ("id_partida_padre");



CREATE INDEX "idx_partida_padre" ON "public"."partida" USING "btree" ("id_partida_padre");



CREATE INDEX "idx_presupuesto_detalle_partida" ON "public"."presupuesto_detalle" USING "btree" ("id_partida");



CREATE INDEX "idx_presupuesto_proyecto" ON "public"."presupuesto" USING "btree" ("id_proyecto");



CREATE INDEX "idx_proyecto_cliente" ON "public"."proyecto" USING "btree" ("id_cliente");



CREATE INDEX "idx_restriccion_proyecto" ON "public"."restriccion" USING "btree" ("id_proyecto");



CREATE INDEX "idx_revision_financiera_fecha" ON "public"."revision_financiera" USING "btree" ("fecha" DESC);



CREATE INDEX "idx_solicitud_estado" ON "public"."solicitud_aprobacion" USING "btree" ("estado");



CREATE INDEX "idx_solicitud_notificacion_solicitud" ON "public"."solicitud_notificacion" USING "btree" ("id_solicitud");



CREATE INDEX "idx_solicitud_notificacion_usuario" ON "public"."solicitud_notificacion" USING "btree" ("usuario_id");



CREATE INDEX "idx_ticket_comentario_ticket" ON "public"."ticket_comentario" USING "btree" ("id_ticket");



CREATE INDEX "idx_ticket_creado_por_id" ON "public"."ticket" USING "btree" ("creado_por_id");



CREATE INDEX "idx_ticket_estado" ON "public"."ticket" USING "btree" ("estado");



CREATE INDEX "idx_ticket_evento_ticket" ON "public"."ticket_evento" USING "btree" ("id_ticket");



CREATE INDEX "idx_ticket_id_release" ON "public"."ticket" USING "btree" ("id_release");



CREATE INDEX "idx_transaccion_aprobado" ON "public"."transaccion" USING "btree" ("aprobado");



CREATE INDEX "idx_transaccion_centro" ON "public"."transaccion" USING "btree" ("id_centro_costo_origen", "id_centro_costo_destino");



CREATE INDEX "idx_transaccion_comprobante_pago_id_transaccion" ON "public"."transaccion_comprobante_pago" USING "btree" ("id_transaccion");



CREATE INDEX "idx_transaccion_detalle_categoria_id_transaccion" ON "public"."transaccion_detalle_categoria" USING "btree" ("id_transaccion");



CREATE INDEX "idx_transaccion_id_factura" ON "public"."transaccion" USING "btree" ("id_factura");



CREATE INDEX "idx_transaccion_num_comprobante_interno" ON "public"."transaccion" USING "btree" ("num_comprobante_interno");



CREATE INDEX "idx_transaccion_num_recibo_pago" ON "public"."transaccion" USING "btree" ("num_recibo_pago");



CREATE INDEX "idx_transaccion_num_recibo_pago_no_efectivo" ON "public"."transaccion" USING "btree" ("num_recibo_pago_no_efectivo");



CREATE INDEX "idx_transaccion_num_recibo_pago_proveedor" ON "public"."transaccion" USING "btree" ("num_recibo_pago_proveedor");



CREATE INDEX "idx_valorizacion_proyecto" ON "public"."valorizacion_semanal" USING "btree" ("id_proyecto");



CREATE UNIQUE INDEX "uq_centro_costo_cliente" ON "public"."centro_costo" USING "btree" ("id_cliente") WHERE ("id_cliente" IS NOT NULL);



CREATE UNIQUE INDEX "uq_centro_costo_consultoria_compartido" ON "public"."centro_costo" USING "btree" ("tipo") WHERE ((("tipo")::"text" = 'consultoria'::"text") AND ("id_proyecto" IS NULL));



CREATE UNIQUE INDEX "uq_centro_costo_empleado" ON "public"."centro_costo" USING "btree" ("id_empleado") WHERE ("id_empleado" IS NOT NULL);



CREATE UNIQUE INDEX "uq_centro_costo_proveedor" ON "public"."centro_costo" USING "btree" ("id_proveedor") WHERE ("id_proveedor" IS NOT NULL);



CREATE UNIQUE INDEX "uq_centro_costo_proyecto" ON "public"."centro_costo" USING "btree" ("id_proyecto") WHERE ("id_proyecto" IS NOT NULL);



CREATE UNIQUE INDEX "uq_transaccion_idempotency_key" ON "public"."transaccion" USING "btree" ("idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE OR REPLACE TRIGGER "trg_asignar_folio_factura" BEFORE INSERT ON "public"."factura" FOR EACH ROW EXECUTE FUNCTION "public"."fn_asignar_folio_factura"();



CREATE OR REPLACE TRIGGER "trg_audit_cobros" AFTER INSERT OR DELETE OR UPDATE ON "public"."cobros" FOR EACH ROW EXECUTE FUNCTION "public"."capture_instance_audit"();



CREATE OR REPLACE TRIGGER "trg_audit_cronograma_actividad" AFTER INSERT OR DELETE OR UPDATE ON "public"."cronograma_actividad" FOR EACH ROW EXECUTE FUNCTION "public"."capture_instance_audit"();



CREATE OR REPLACE TRIGGER "trg_audit_cronograma_detalle_semanal" AFTER INSERT OR DELETE OR UPDATE ON "public"."cronograma_detalle_semanal" FOR EACH ROW EXECUTE FUNCTION "public"."capture_instance_audit"();



CREATE OR REPLACE TRIGGER "trg_audit_cuentas_cobrar" AFTER INSERT OR DELETE OR UPDATE ON "public"."cuentas_cobrar" FOR EACH ROW EXECUTE FUNCTION "public"."capture_instance_audit"();



CREATE OR REPLACE TRIGGER "trg_audit_cuentas_pagar" AFTER INSERT OR DELETE OR UPDATE ON "public"."cuentas_pagar" FOR EACH ROW EXECUTE FUNCTION "public"."capture_instance_audit"();



CREATE OR REPLACE TRIGGER "trg_audit_egreso_semanal" AFTER INSERT OR DELETE OR UPDATE ON "public"."egreso_semanal" FOR EACH ROW EXECUTE FUNCTION "public"."capture_instance_audit"();



CREATE OR REPLACE TRIGGER "trg_audit_lookahead" AFTER INSERT OR DELETE OR UPDATE ON "public"."lookahead" FOR EACH ROW EXECUTE FUNCTION "public"."capture_instance_audit"();



CREATE OR REPLACE TRIGGER "trg_audit_metrado" AFTER INSERT OR DELETE OR UPDATE ON "public"."metrado" FOR EACH ROW EXECUTE FUNCTION "public"."capture_instance_audit"();



CREATE OR REPLACE TRIGGER "trg_audit_pagos" AFTER INSERT OR DELETE OR UPDATE ON "public"."pagos" FOR EACH ROW EXECUTE FUNCTION "public"."capture_instance_audit"();



CREATE OR REPLACE TRIGGER "trg_audit_presupuesto_detalle" AFTER INSERT OR DELETE OR UPDATE ON "public"."presupuesto_detalle" FOR EACH ROW EXECUTE FUNCTION "public"."capture_instance_audit"();



CREATE OR REPLACE TRIGGER "trg_audit_restriccion" AFTER INSERT OR DELETE OR UPDATE ON "public"."restriccion" FOR EACH ROW EXECUTE FUNCTION "public"."capture_instance_audit"();



CREATE OR REPLACE TRIGGER "trg_audit_seguimiento_proyecto" AFTER INSERT OR DELETE OR UPDATE ON "public"."seguimiento_proyecto" FOR EACH ROW EXECUTE FUNCTION "public"."capture_instance_audit"();



CREATE OR REPLACE TRIGGER "trg_audit_valorizacion_partida" AFTER INSERT OR DELETE OR UPDATE ON "public"."valorizacion_partida" FOR EACH ROW EXECUTE FUNCTION "public"."capture_instance_audit"();



CREATE OR REPLACE TRIGGER "trg_check_cronograma_actividad_cycle" BEFORE INSERT OR UPDATE ON "public"."cronograma_actividad" FOR EACH ROW EXECUTE FUNCTION "public"."check_cronograma_actividad_cycle"();



CREATE OR REPLACE TRIGGER "trg_check_partida_cycle" BEFORE INSERT OR UPDATE ON "public"."partida" FOR EACH ROW EXECUTE FUNCTION "public"."check_partida_cycle"();



CREATE OR REPLACE TRIGGER "trg_documento_proyecto_updated_at" BEFORE UPDATE ON "public"."documento_proyecto" FOR EACH ROW EXECUTE FUNCTION "public"."trg_set_updated_at_documento"();



ALTER TABLE ONLY "public"."acero_detalle"
    ADD CONSTRAINT "acero_detalle_id_partida_fkey" FOREIGN KEY ("id_partida") REFERENCES "public"."partida"("id_partida");



ALTER TABLE ONLY "public"."acero_detalle"
    ADD CONSTRAINT "acero_detalle_id_proyecto_fkey" FOREIGN KEY ("id_proyecto") REFERENCES "public"."proyecto"("id_proyecto") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."adelanto"
    ADD CONSTRAINT "adelanto_id_proyecto_fkey" FOREIGN KEY ("id_proyecto") REFERENCES "public"."proyecto"("id_proyecto");



ALTER TABLE ONLY "public"."apertura_financiera"
    ADD CONSTRAINT "apertura_financiera_id_centro_costo_fkey" FOREIGN KEY ("id_centro_costo") REFERENCES "public"."centro_costo"("id_centro_costo");



ALTER TABLE ONLY "public"."apertura_financiera"
    ADD CONSTRAINT "apertura_financiera_id_cuenta_banco_fkey" FOREIGN KEY ("id_cuenta_banco") REFERENCES "public"."cuenta_banco"("id_cuenta_banco");



ALTER TABLE ONLY "public"."centro_costo"
    ADD CONSTRAINT "centro_costo_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "public"."cliente"("id_cliente") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."centro_costo"
    ADD CONSTRAINT "centro_costo_id_empleado_fkey" FOREIGN KEY ("id_empleado") REFERENCES "public"."empleados"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."centro_costo"
    ADD CONSTRAINT "centro_costo_id_proveedor_fkey" FOREIGN KEY ("id_proveedor") REFERENCES "public"."proveedor"("id_proveedor") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."centro_costo"
    ADD CONSTRAINT "centro_costo_id_proyecto_fkey" FOREIGN KEY ("id_proyecto") REFERENCES "public"."proyecto"("id_proyecto") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."partida"
    ADD CONSTRAINT "chk_partida_no_auto" FOREIGN KEY ("id_partida_padre") REFERENCES "public"."partida"("id_partida");



ALTER TABLE ONLY "public"."cobros"
    ADD CONSTRAINT "cobros_id_cuenta_cobrar_fkey" FOREIGN KEY ("id_cuenta_cobrar") REFERENCES "public"."cuentas_cobrar"("id_cuenta_cobrar") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cobros"
    ADD CONSTRAINT "cobros_id_transaccion_fkey" FOREIGN KEY ("id_transaccion") REFERENCES "public"."transaccion"("id_transaccion") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conciliacion_financiera"
    ADD CONSTRAINT "conciliacion_financiera_id_incidencia_fkey" FOREIGN KEY ("id_incidencia") REFERENCES "public"."incidencia"("id_incidencia");



ALTER TABLE ONLY "public"."contrato_proyecto"
    ADD CONSTRAINT "contrato_proyecto_id_proyecto_fkey" FOREIGN KEY ("id_proyecto") REFERENCES "public"."proyecto"("id_proyecto");



ALTER TABLE ONLY "public"."cronograma_actividad"
    ADD CONSTRAINT "cronograma_actividad_id_actividad_padre_fkey" FOREIGN KEY ("id_actividad_padre") REFERENCES "public"."cronograma_actividad"("id_cronograma_actividad");



ALTER TABLE ONLY "public"."cronograma_actividad"
    ADD CONSTRAINT "cronograma_actividad_id_partida_fkey" FOREIGN KEY ("id_partida") REFERENCES "public"."partida"("id_partida") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cronograma_actividad"
    ADD CONSTRAINT "cronograma_actividad_id_proyecto_fkey" FOREIGN KEY ("id_proyecto") REFERENCES "public"."proyecto"("id_proyecto") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cronograma_dependencia"
    ADD CONSTRAINT "cronograma_dependencia_id_actividad_destino_fkey" FOREIGN KEY ("id_actividad_destino") REFERENCES "public"."cronograma_actividad"("id_cronograma_actividad") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cronograma_dependencia"
    ADD CONSTRAINT "cronograma_dependencia_id_actividad_origen_fkey" FOREIGN KEY ("id_actividad_origen") REFERENCES "public"."cronograma_actividad"("id_cronograma_actividad") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cronograma_detalle_semanal"
    ADD CONSTRAINT "cronograma_detalle_semanal_id_cronograma_actividad_fkey" FOREIGN KEY ("id_cronograma_actividad") REFERENCES "public"."cronograma_actividad"("id_cronograma_actividad") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cronograma_plan_base"
    ADD CONSTRAINT "cronograma_plan_base_id_proyecto_fkey" FOREIGN KEY ("id_proyecto") REFERENCES "public"."proyecto"("id_proyecto") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cuentas_cobrar"
    ADD CONSTRAINT "cuentas_cobrar_id_centro_costo_fkey" FOREIGN KEY ("id_centro_costo") REFERENCES "public"."centro_costo"("id_centro_costo");



ALTER TABLE ONLY "public"."cuentas_cobrar"
    ADD CONSTRAINT "cuentas_cobrar_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "public"."cliente"("id_cliente");



ALTER TABLE ONLY "public"."cuentas_cobrar"
    ADD CONSTRAINT "cuentas_cobrar_id_proyecto_fkey" FOREIGN KEY ("id_proyecto") REFERENCES "public"."proyecto"("id_proyecto");



ALTER TABLE ONLY "public"."cuentas_cobrar"
    ADD CONSTRAINT "cuentas_cobrar_id_transaccion_fkey" FOREIGN KEY ("id_transaccion") REFERENCES "public"."transaccion"("id_transaccion") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cuentas_pagar"
    ADD CONSTRAINT "cuentas_pagar_id_centro_costo_fkey" FOREIGN KEY ("id_centro_costo") REFERENCES "public"."centro_costo"("id_centro_costo");



ALTER TABLE ONLY "public"."cuentas_pagar"
    ADD CONSTRAINT "cuentas_pagar_id_partida_fkey" FOREIGN KEY ("id_partida") REFERENCES "public"."partida"("id_partida");



ALTER TABLE ONLY "public"."cuentas_pagar"
    ADD CONSTRAINT "cuentas_pagar_id_presupuesto_fkey" FOREIGN KEY ("id_presupuesto") REFERENCES "public"."presupuesto"("id_presupuesto");



ALTER TABLE ONLY "public"."cuentas_pagar"
    ADD CONSTRAINT "cuentas_pagar_id_proveedor_fkey" FOREIGN KEY ("id_proveedor") REFERENCES "public"."proveedor"("id_proveedor");



ALTER TABLE ONLY "public"."cuentas_pagar"
    ADD CONSTRAINT "cuentas_pagar_id_transaccion_fkey" FOREIGN KEY ("id_transaccion") REFERENCES "public"."transaccion"("id_transaccion") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."documento_proyecto"
    ADD CONSTRAINT "documento_proyecto_id_proyecto_fkey" FOREIGN KEY ("id_proyecto") REFERENCES "public"."proyecto"("id_proyecto") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."egreso_semanal"
    ADD CONSTRAINT "egreso_semanal_id_proyecto_fkey" FOREIGN KEY ("id_proyecto") REFERENCES "public"."proyecto"("id_proyecto") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."empleados"
    ADD CONSTRAINT "empleados_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "public"."area"("id");



ALTER TABLE ONLY "public"."empleados"
    ADD CONSTRAINT "empleados_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "public"."roles"("id");



ALTER TABLE ONLY "public"."factura_archivo"
    ADD CONSTRAINT "factura_archivo_id_factura_fkey" FOREIGN KEY ("id_factura") REFERENCES "public"."factura"("id_factura") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."factura_detalle"
    ADD CONSTRAINT "factura_detalle_id_factura_fkey" FOREIGN KEY ("id_factura") REFERENCES "public"."factura"("id_factura") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."factura"
    ADD CONSTRAINT "factura_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "public"."cliente"("id_cliente");



ALTER TABLE ONLY "public"."factura"
    ADD CONSTRAINT "factura_id_proyecto_fkey" FOREIGN KEY ("id_proyecto") REFERENCES "public"."proyecto"("id_proyecto");



ALTER TABLE ONLY "public"."partida"
    ADD CONSTRAINT "fk_partida_padre" FOREIGN KEY ("id_partida_padre") REFERENCES "public"."partida"("id_partida");



ALTER TABLE ONLY "public"."incidencia_evento"
    ADD CONSTRAINT "incidencia_evento_id_incidencia_fkey" FOREIGN KEY ("id_incidencia") REFERENCES "public"."incidencia"("id_incidencia") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."instance_audit_log"
    ADD CONSTRAINT "instance_audit_log_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."proyecto"("id_proyecto") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lookahead"
    ADD CONSTRAINT "lookahead_id_partida_fkey" FOREIGN KEY ("id_partida") REFERENCES "public"."partida"("id_partida");



ALTER TABLE ONLY "public"."lookahead"
    ADD CONSTRAINT "lookahead_id_proyecto_fkey" FOREIGN KEY ("id_proyecto") REFERENCES "public"."proyecto"("id_proyecto") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."metrado"
    ADD CONSTRAINT "metrado_id_partida_fkey" FOREIGN KEY ("id_partida") REFERENCES "public"."partida"("id_partida");



ALTER TABLE ONLY "public"."metrado"
    ADD CONSTRAINT "metrado_id_proyecto_fkey" FOREIGN KEY ("id_proyecto") REFERENCES "public"."proyecto"("id_proyecto") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pagos"
    ADD CONSTRAINT "pagos_id_cuenta_pagar_fkey" FOREIGN KEY ("id_cuenta_pagar") REFERENCES "public"."cuentas_pagar"("id_cuenta_pagar") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pagos"
    ADD CONSTRAINT "pagos_id_transaccion_fkey" FOREIGN KEY ("id_transaccion") REFERENCES "public"."transaccion"("id_transaccion") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."partida"
    ADD CONSTRAINT "partida_id_partida_padre_fkey" FOREIGN KEY ("id_partida_padre") REFERENCES "public"."partida"("id_partida");



ALTER TABLE ONLY "public"."plantilla_actividad"
    ADD CONSTRAINT "plantilla_actividad_id_actividad_padre_template_fkey" FOREIGN KEY ("id_actividad_padre_template") REFERENCES "public"."plantilla_actividad"("id_plantilla_actividad") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plantilla_actividad"
    ADD CONSTRAINT "plantilla_actividad_id_partida_fkey" FOREIGN KEY ("id_partida") REFERENCES "public"."partida"("id_partida") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."plantilla_actividad"
    ADD CONSTRAINT "plantilla_actividad_id_plantilla_fkey" FOREIGN KEY ("id_plantilla") REFERENCES "public"."plantilla_cronograma"("id_plantilla") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plantilla_detalle"
    ADD CONSTRAINT "plantilla_detalle_id_partida_fkey" FOREIGN KEY ("id_partida") REFERENCES "public"."partida"("id_partida");



ALTER TABLE ONLY "public"."plantilla_detalle"
    ADD CONSTRAINT "plantilla_detalle_id_plantilla_fkey" FOREIGN KEY ("id_plantilla") REFERENCES "public"."plantilla_presupuesto"("id_plantilla") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."presupuesto_detalle"
    ADD CONSTRAINT "presupuesto_detalle_id_partida_fkey" FOREIGN KEY ("id_partida") REFERENCES "public"."partida"("id_partida");



ALTER TABLE ONLY "public"."presupuesto_detalle"
    ADD CONSTRAINT "presupuesto_detalle_id_presupuesto_fkey" FOREIGN KEY ("id_presupuesto") REFERENCES "public"."presupuesto"("id_presupuesto") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."presupuesto"
    ADD CONSTRAINT "presupuesto_id_proyecto_fkey" FOREIGN KEY ("id_proyecto") REFERENCES "public"."proyecto"("id_proyecto");



ALTER TABLE ONLY "public"."proyecto"
    ADD CONSTRAINT "proyecto_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "public"."cliente"("id_cliente");



ALTER TABLE ONLY "public"."restriccion"
    ADD CONSTRAINT "restriccion_id_cronograma_actividad_fkey" FOREIGN KEY ("id_cronograma_actividad") REFERENCES "public"."cronograma_actividad"("id_cronograma_actividad") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."restriccion"
    ADD CONSTRAINT "restriccion_id_proyecto_fkey" FOREIGN KEY ("id_proyecto") REFERENCES "public"."proyecto"("id_proyecto") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roles_permisos"
    ADD CONSTRAINT "roles_permisos_permiso_id_fkey" FOREIGN KEY ("permiso_id") REFERENCES "public"."permisos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roles_permisos"
    ADD CONSTRAINT "roles_permisos_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seguimiento_proyecto"
    ADD CONSTRAINT "seguimiento_proyecto_id_proyecto_fkey" FOREIGN KEY ("id_proyecto") REFERENCES "public"."proyecto"("id_proyecto") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."solicitud_notificacion"
    ADD CONSTRAINT "solicitud_notificacion_id_solicitud_fkey" FOREIGN KEY ("id_solicitud") REFERENCES "public"."solicitud_aprobacion"("id_solicitud") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ticket_comentario"
    ADD CONSTRAINT "ticket_comentario_id_ticket_fkey" FOREIGN KEY ("id_ticket") REFERENCES "public"."ticket"("id_ticket") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ticket_evento"
    ADD CONSTRAINT "ticket_evento_id_ticket_fkey" FOREIGN KEY ("id_ticket") REFERENCES "public"."ticket"("id_ticket") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ticket"
    ADD CONSTRAINT "ticket_id_release_fkey" FOREIGN KEY ("id_release") REFERENCES "public"."app_release"("id_release");



ALTER TABLE ONLY "public"."trans_detalle"
    ADD CONSTRAINT "trans_detalle_id_partida_fkey" FOREIGN KEY ("id_partida") REFERENCES "public"."partida"("id_partida");



ALTER TABLE ONLY "public"."trans_detalle"
    ADD CONSTRAINT "trans_detalle_id_transaccion_fkey" FOREIGN KEY ("id_transaccion") REFERENCES "public"."transaccion"("id_transaccion") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transaccion_comprobante_pago"
    ADD CONSTRAINT "transaccion_comprobante_pago_id_transaccion_fkey" FOREIGN KEY ("id_transaccion") REFERENCES "public"."transaccion"("id_transaccion") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transaccion_detalle_categoria"
    ADD CONSTRAINT "transaccion_detalle_categoria_id_transaccion_fkey" FOREIGN KEY ("id_transaccion") REFERENCES "public"."transaccion"("id_transaccion") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transaccion"
    ADD CONSTRAINT "transaccion_id_factura_fkey" FOREIGN KEY ("id_factura") REFERENCES "public"."factura"("id_factura") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."valorizacion_partida"
    ADD CONSTRAINT "valorizacion_partida_id_partida_fkey" FOREIGN KEY ("id_partida") REFERENCES "public"."partida"("id_partida");



ALTER TABLE ONLY "public"."valorizacion_partida"
    ADD CONSTRAINT "valorizacion_partida_id_valorizacion_fkey" FOREIGN KEY ("id_valorizacion") REFERENCES "public"."valorizacion_semanal"("id_valorizacion") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."valorizacion_semanal"
    ADD CONSTRAINT "valorizacion_semanal_id_proyecto_fkey" FOREIGN KEY ("id_proyecto") REFERENCES "public"."proyecto"("id_proyecto") ON DELETE CASCADE;



CREATE POLICY "Admin CRUD empleados" ON "public"."empleados" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin CRUD permisos" ON "public"."permisos" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin CRUD roles" ON "public"."roles" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin CRUD roles_permisos" ON "public"."roles_permisos" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Lectura publica de empleados" ON "public"."empleados" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Lectura publica de permisos" ON "public"."permisos" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Lectura publica de roles" ON "public"."roles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Lectura publica de roles_permisos" ON "public"."roles_permisos" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."app_version_usuario" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_version_usuario_insert" ON "public"."app_version_usuario" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "app_version_usuario_select" ON "public"."app_version_usuario" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "app_version_usuario_update" ON "public"."app_version_usuario" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "auth_full_crono_act" ON "public"."cronograma_actividad" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "auth_full_crono_dep" ON "public"."cronograma_dependencia" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "auth_full_crono_pb" ON "public"."cronograma_plan_base" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "auth_full_plantilla" ON "public"."plantilla_cronograma" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "auth_full_plantilla_act" ON "public"."plantilla_actividad" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "auth_full_restriccion" ON "public"."restriccion" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "authenticated_full_access_documento" ON "public"."documento_proyecto" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."cronograma_actividad" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cronograma_dependencia" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cronograma_plan_base" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."documento_proyecto" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."empleados" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permisos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."plantilla_actividad" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."plantilla_cronograma" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."restriccion" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roles_permisos" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."actualizar_usuario_empleado"("p_id" integer, "p_auth_user_id" "uuid", "p_nombre" "text", "p_correo" "text", "p_telefono" "text", "p_rol_id" integer, "p_fecha_ingreso" "date", "p_salario" numeric, "p_horas" numeric, "p_periodo" "text", "p_nivel" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."actualizar_usuario_empleado"("p_id" integer, "p_auth_user_id" "uuid", "p_nombre" "text", "p_correo" "text", "p_telefono" "text", "p_rol_id" integer, "p_fecha_ingreso" "date", "p_salario" numeric, "p_horas" numeric, "p_periodo" "text", "p_nivel" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."actualizar_usuario_empleado"("p_id" integer, "p_auth_user_id" "uuid", "p_nombre" "text", "p_correo" "text", "p_telefono" "text", "p_rol_id" integer, "p_fecha_ingreso" "date", "p_salario" numeric, "p_horas" numeric, "p_periodo" "text", "p_nivel" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."actualizar_usuario_empleado"("p_id" integer, "p_auth_user_id" "uuid", "p_nombre" "text", "p_correo" "text", "p_telefono" "text", "p_rol_id" integer, "p_area_id" integer, "p_fecha_ingreso" "date", "p_salario" numeric, "p_horas" numeric, "p_periodo" "text", "p_nivel" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."actualizar_usuario_empleado"("p_id" integer, "p_auth_user_id" "uuid", "p_nombre" "text", "p_correo" "text", "p_telefono" "text", "p_rol_id" integer, "p_area_id" integer, "p_fecha_ingreso" "date", "p_salario" numeric, "p_horas" numeric, "p_periodo" "text", "p_nivel" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."actualizar_usuario_empleado"("p_id" integer, "p_auth_user_id" "uuid", "p_nombre" "text", "p_correo" "text", "p_telefono" "text", "p_rol_id" integer, "p_area_id" integer, "p_fecha_ingreso" "date", "p_salario" numeric, "p_horas" numeric, "p_periodo" "text", "p_nivel" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."capture_instance_audit"() TO "anon";
GRANT ALL ON FUNCTION "public"."capture_instance_audit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."capture_instance_audit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_cronograma_actividad_cycle"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_cronograma_actividad_cycle"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_cronograma_actividad_cycle"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_partida_cycle"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_partida_cycle"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_partida_cycle"() TO "service_role";



GRANT ALL ON FUNCTION "public"."configurar_contrasena_empleado"("p_email" "text", "p_password" "text", "p_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."configurar_contrasena_empleado"("p_email" "text", "p_password" "text", "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."configurar_contrasena_empleado"("p_email" "text", "p_password" "text", "p_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."crear_usuario_empleado"("p_nombre" "text", "p_correo" "text", "p_telefono" "text", "p_rol_id" integer, "p_fecha_ingreso" "date", "p_salario" numeric, "p_horas" numeric, "p_periodo" "text", "p_nivel" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."crear_usuario_empleado"("p_nombre" "text", "p_correo" "text", "p_telefono" "text", "p_rol_id" integer, "p_fecha_ingreso" "date", "p_salario" numeric, "p_horas" numeric, "p_periodo" "text", "p_nivel" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."crear_usuario_empleado"("p_nombre" "text", "p_correo" "text", "p_telefono" "text", "p_rol_id" integer, "p_fecha_ingreso" "date", "p_salario" numeric, "p_horas" numeric, "p_periodo" "text", "p_nivel" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."crear_usuario_empleado"("p_nombre" "text", "p_correo" "text", "p_telefono" "text", "p_rol_id" integer, "p_area_id" integer, "p_fecha_ingreso" "date", "p_salario" numeric, "p_horas" numeric, "p_periodo" "text", "p_nivel" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."crear_usuario_empleado"("p_nombre" "text", "p_correo" "text", "p_telefono" "text", "p_rol_id" integer, "p_area_id" integer, "p_fecha_ingreso" "date", "p_salario" numeric, "p_horas" numeric, "p_periodo" "text", "p_nivel" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."crear_usuario_empleado"("p_nombre" "text", "p_correo" "text", "p_telefono" "text", "p_rol_id" integer, "p_area_id" integer, "p_fecha_ingreso" "date", "p_salario" numeric, "p_horas" numeric, "p_periodo" "text", "p_nivel" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."eliminar_usuario_empleado"("p_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."eliminar_usuario_empleado"("p_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."eliminar_usuario_empleado"("p_id" integer) TO "service_role";



GRANT ALL ON TABLE "public"."transaccion" TO "anon";
GRANT ALL ON TABLE "public"."transaccion" TO "authenticated";
GRANT ALL ON TABLE "public"."transaccion" TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_anular_transaccion"("p_id_transaccion" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_anular_transaccion"("p_id_transaccion" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_anular_transaccion"("p_id_transaccion" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_asignar_folio_factura"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_asignar_folio_factura"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_asignar_folio_factura"() TO "service_role";



GRANT ALL ON TABLE "public"."cobros" TO "anon";
GRANT ALL ON TABLE "public"."cobros" TO "authenticated";
GRANT ALL ON TABLE "public"."cobros" TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_confirmar_cobro"("p_id_cuenta_cobrar" bigint, "p_transaccion_payload" "jsonb", "p_id_cobro" bigint, "p_cobro_payload" "jsonb", "p_idempotency_key" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_confirmar_cobro"("p_id_cuenta_cobrar" bigint, "p_transaccion_payload" "jsonb", "p_id_cobro" bigint, "p_cobro_payload" "jsonb", "p_idempotency_key" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_confirmar_cobro"("p_id_cuenta_cobrar" bigint, "p_transaccion_payload" "jsonb", "p_id_cobro" bigint, "p_cobro_payload" "jsonb", "p_idempotency_key" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."pagos" TO "anon";
GRANT ALL ON TABLE "public"."pagos" TO "authenticated";
GRANT ALL ON TABLE "public"."pagos" TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_confirmar_pago"("p_id_cuenta_pagar" bigint, "p_transaccion_payload" "jsonb", "p_id_pago" bigint, "p_pago_payload" "jsonb", "p_idempotency_key" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_confirmar_pago"("p_id_cuenta_pagar" bigint, "p_transaccion_payload" "jsonb", "p_id_pago" bigint, "p_pago_payload" "jsonb", "p_idempotency_key" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_confirmar_pago"("p_id_cuenta_pagar" bigint, "p_transaccion_payload" "jsonb", "p_id_pago" bigint, "p_pago_payload" "jsonb", "p_idempotency_key" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_crear_transaccion"("p_payload" "jsonb", "p_idempotency_key" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_crear_transaccion"("p_payload" "jsonb", "p_idempotency_key" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_crear_transaccion"("p_payload" "jsonb", "p_idempotency_key" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."factura" TO "anon";
GRANT ALL ON TABLE "public"."factura" TO "authenticated";
GRANT ALL ON TABLE "public"."factura" TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_emitir_factura"("p_id_factura" bigint, "p_imagen_url" "text", "p_usuario" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fn_emitir_factura"("p_id_factura" bigint, "p_imagen_url" "text", "p_usuario" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_emitir_factura"("p_id_factura" bigint, "p_imagen_url" "text", "p_usuario" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_recalcular_cuenta_cobrar"("p_id_cuenta_cobrar" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_recalcular_cuenta_cobrar"("p_id_cuenta_cobrar" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_recalcular_cuenta_cobrar"("p_id_cuenta_cobrar" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_recalcular_cuenta_pagar"("p_id_cuenta_pagar" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_recalcular_cuenta_pagar"("p_id_cuenta_pagar" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_recalcular_cuenta_pagar"("p_id_cuenta_pagar" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_recalcular_saldo_cuenta_banco"("p_numero_cuenta" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."fn_recalcular_saldo_cuenta_banco"("p_numero_cuenta" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_recalcular_saldo_cuenta_banco"("p_numero_cuenta" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_api_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_api_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_api_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_set_updated_at_documento"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_set_updated_at_documento"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_set_updated_at_documento"() TO "service_role";



GRANT ALL ON TABLE "public"."acero_detalle" TO "anon";
GRANT ALL ON TABLE "public"."acero_detalle" TO "authenticated";
GRANT ALL ON TABLE "public"."acero_detalle" TO "service_role";



GRANT ALL ON SEQUENCE "public"."acero_detalle_id_acero_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."acero_detalle_id_acero_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."acero_detalle_id_acero_seq" TO "service_role";



GRANT ALL ON TABLE "public"."adelanto" TO "anon";
GRANT ALL ON TABLE "public"."adelanto" TO "authenticated";
GRANT ALL ON TABLE "public"."adelanto" TO "service_role";



GRANT ALL ON SEQUENCE "public"."adelanto_id_adelanto_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."adelanto_id_adelanto_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."adelanto_id_adelanto_seq" TO "service_role";



GRANT ALL ON TABLE "public"."anuncios" TO "anon";
GRANT ALL ON TABLE "public"."anuncios" TO "authenticated";
GRANT ALL ON TABLE "public"."anuncios" TO "service_role";



GRANT ALL ON SEQUENCE "public"."anuncios_id_anuncio_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."anuncios_id_anuncio_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."anuncios_id_anuncio_seq" TO "service_role";



GRANT ALL ON TABLE "public"."apertura_financiera" TO "anon";
GRANT ALL ON TABLE "public"."apertura_financiera" TO "authenticated";
GRANT ALL ON TABLE "public"."apertura_financiera" TO "service_role";



GRANT ALL ON SEQUENCE "public"."apertura_financiera_id_apertura_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."apertura_financiera_id_apertura_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."apertura_financiera_id_apertura_seq" TO "service_role";



GRANT ALL ON TABLE "public"."app_release" TO "anon";
GRANT ALL ON TABLE "public"."app_release" TO "authenticated";
GRANT ALL ON TABLE "public"."app_release" TO "service_role";



GRANT ALL ON SEQUENCE "public"."app_release_id_release_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."app_release_id_release_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."app_release_id_release_seq" TO "service_role";



GRANT ALL ON TABLE "public"."app_version_usuario" TO "anon";
GRANT ALL ON TABLE "public"."app_version_usuario" TO "authenticated";
GRANT ALL ON TABLE "public"."app_version_usuario" TO "service_role";



GRANT ALL ON SEQUENCE "public"."app_version_usuario_id_registro_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."app_version_usuario_id_registro_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."app_version_usuario_id_registro_seq" TO "service_role";



GRANT ALL ON TABLE "public"."area" TO "anon";
GRANT ALL ON TABLE "public"."area" TO "authenticated";
GRANT ALL ON TABLE "public"."area" TO "service_role";



GRANT ALL ON SEQUENCE "public"."area_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."area_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."area_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."boleta_folio_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."boleta_folio_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."boleta_folio_seq" TO "service_role";



GRANT ALL ON TABLE "public"."centro_costo" TO "anon";
GRANT ALL ON TABLE "public"."centro_costo" TO "authenticated";
GRANT ALL ON TABLE "public"."centro_costo" TO "service_role";



GRANT ALL ON SEQUENCE "public"."centro_costo_id_centro_costo_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."centro_costo_id_centro_costo_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."centro_costo_id_centro_costo_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cliente" TO "anon";
GRANT ALL ON TABLE "public"."cliente" TO "authenticated";
GRANT ALL ON TABLE "public"."cliente" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cliente_id_cliente_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cliente_id_cliente_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cliente_id_cliente_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cobros_id_cobro_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cobros_id_cobro_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cobros_id_cobro_seq" TO "service_role";



GRANT ALL ON TABLE "public"."conciliacion_financiera" TO "anon";
GRANT ALL ON TABLE "public"."conciliacion_financiera" TO "authenticated";
GRANT ALL ON TABLE "public"."conciliacion_financiera" TO "service_role";



GRANT ALL ON SEQUENCE "public"."conciliacion_financiera_id_conciliacion_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."conciliacion_financiera_id_conciliacion_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."conciliacion_financiera_id_conciliacion_seq" TO "service_role";



GRANT ALL ON TABLE "public"."contrato_proyecto" TO "anon";
GRANT ALL ON TABLE "public"."contrato_proyecto" TO "authenticated";
GRANT ALL ON TABLE "public"."contrato_proyecto" TO "service_role";



GRANT ALL ON SEQUENCE "public"."contrato_proyecto_id_contrato_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."contrato_proyecto_id_contrato_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."contrato_proyecto_id_contrato_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cronograma_actividad" TO "anon";
GRANT ALL ON TABLE "public"."cronograma_actividad" TO "authenticated";
GRANT ALL ON TABLE "public"."cronograma_actividad" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cronograma_actividad_id_cronograma_actividad_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cronograma_actividad_id_cronograma_actividad_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cronograma_actividad_id_cronograma_actividad_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cronograma_dependencia" TO "anon";
GRANT ALL ON TABLE "public"."cronograma_dependencia" TO "authenticated";
GRANT ALL ON TABLE "public"."cronograma_dependencia" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cronograma_dependencia_id_dependencia_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cronograma_dependencia_id_dependencia_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cronograma_dependencia_id_dependencia_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cronograma_detalle_semanal" TO "anon";
GRANT ALL ON TABLE "public"."cronograma_detalle_semanal" TO "authenticated";
GRANT ALL ON TABLE "public"."cronograma_detalle_semanal" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cronograma_detalle_semanal_id_cronograma_detalle_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cronograma_detalle_semanal_id_cronograma_detalle_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cronograma_detalle_semanal_id_cronograma_detalle_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cronograma_plan_base" TO "anon";
GRANT ALL ON TABLE "public"."cronograma_plan_base" TO "authenticated";
GRANT ALL ON TABLE "public"."cronograma_plan_base" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cronograma_plan_base_id_plan_base_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cronograma_plan_base_id_plan_base_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cronograma_plan_base_id_plan_base_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cuenta_banco" TO "anon";
GRANT ALL ON TABLE "public"."cuenta_banco" TO "authenticated";
GRANT ALL ON TABLE "public"."cuenta_banco" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cuenta_banco_id_cuenta_banco_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cuenta_banco_id_cuenta_banco_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cuenta_banco_id_cuenta_banco_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cuentas_cobrar" TO "anon";
GRANT ALL ON TABLE "public"."cuentas_cobrar" TO "authenticated";
GRANT ALL ON TABLE "public"."cuentas_cobrar" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cuentas_cobrar_id_cuenta_cobrar_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cuentas_cobrar_id_cuenta_cobrar_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cuentas_cobrar_id_cuenta_cobrar_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cuentas_pagar" TO "anon";
GRANT ALL ON TABLE "public"."cuentas_pagar" TO "authenticated";
GRANT ALL ON TABLE "public"."cuentas_pagar" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cuentas_pagar_id_cuenta_pagar_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cuentas_pagar_id_cuenta_pagar_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cuentas_pagar_id_cuenta_pagar_seq" TO "service_role";



GRANT ALL ON TABLE "public"."documento_proyecto" TO "anon";
GRANT ALL ON TABLE "public"."documento_proyecto" TO "authenticated";
GRANT ALL ON TABLE "public"."documento_proyecto" TO "service_role";



GRANT ALL ON SEQUENCE "public"."documento_proyecto_id_documento_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."documento_proyecto_id_documento_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."documento_proyecto_id_documento_seq" TO "service_role";



GRANT ALL ON TABLE "public"."egreso_semanal" TO "anon";
GRANT ALL ON TABLE "public"."egreso_semanal" TO "authenticated";
GRANT ALL ON TABLE "public"."egreso_semanal" TO "service_role";



GRANT ALL ON SEQUENCE "public"."egreso_semanal_id_egreso_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."egreso_semanal_id_egreso_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."egreso_semanal_id_egreso_seq" TO "service_role";



GRANT ALL ON TABLE "public"."empleados" TO "anon";
GRANT ALL ON TABLE "public"."empleados" TO "authenticated";
GRANT ALL ON TABLE "public"."empleados" TO "service_role";



GRANT ALL ON SEQUENCE "public"."empleados_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."empleados_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."empleados_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."factura_archivo" TO "anon";
GRANT ALL ON TABLE "public"."factura_archivo" TO "authenticated";
GRANT ALL ON TABLE "public"."factura_archivo" TO "service_role";



GRANT ALL ON SEQUENCE "public"."factura_archivo_id_archivo_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."factura_archivo_id_archivo_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."factura_archivo_id_archivo_seq" TO "service_role";



GRANT ALL ON TABLE "public"."factura_detalle" TO "anon";
GRANT ALL ON TABLE "public"."factura_detalle" TO "authenticated";
GRANT ALL ON TABLE "public"."factura_detalle" TO "service_role";



GRANT ALL ON SEQUENCE "public"."factura_detalle_id_factura_detalle_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."factura_detalle_id_factura_detalle_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."factura_detalle_id_factura_detalle_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."factura_folio_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."factura_folio_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."factura_folio_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."factura_id_factura_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."factura_id_factura_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."factura_id_factura_seq" TO "service_role";



GRANT ALL ON TABLE "public"."igv_objetivo" TO "anon";
GRANT ALL ON TABLE "public"."igv_objetivo" TO "authenticated";
GRANT ALL ON TABLE "public"."igv_objetivo" TO "service_role";



GRANT ALL ON TABLE "public"."incidencia" TO "anon";
GRANT ALL ON TABLE "public"."incidencia" TO "authenticated";
GRANT ALL ON TABLE "public"."incidencia" TO "service_role";



GRANT ALL ON TABLE "public"."incidencia_evento" TO "anon";
GRANT ALL ON TABLE "public"."incidencia_evento" TO "authenticated";
GRANT ALL ON TABLE "public"."incidencia_evento" TO "service_role";



GRANT ALL ON SEQUENCE "public"."incidencia_evento_id_evento_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."incidencia_evento_id_evento_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."incidencia_evento_id_evento_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."incidencia_id_incidencia_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."incidencia_id_incidencia_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."incidencia_id_incidencia_seq" TO "service_role";



GRANT ALL ON TABLE "public"."instance_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."instance_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."instance_audit_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."instance_audit_log_id_audit_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."instance_audit_log_id_audit_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."instance_audit_log_id_audit_seq" TO "service_role";



GRANT ALL ON TABLE "public"."lookahead" TO "anon";
GRANT ALL ON TABLE "public"."lookahead" TO "authenticated";
GRANT ALL ON TABLE "public"."lookahead" TO "service_role";



GRANT ALL ON SEQUENCE "public"."lookahead_id_lookahead_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."lookahead_id_lookahead_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."lookahead_id_lookahead_seq" TO "service_role";



GRANT ALL ON TABLE "public"."metrado" TO "anon";
GRANT ALL ON TABLE "public"."metrado" TO "authenticated";
GRANT ALL ON TABLE "public"."metrado" TO "service_role";



GRANT ALL ON SEQUENCE "public"."metrado_id_metrado_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."metrado_id_metrado_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."metrado_id_metrado_seq" TO "service_role";



GRANT ALL ON TABLE "public"."partida" TO "anon";
GRANT ALL ON TABLE "public"."partida" TO "authenticated";
GRANT ALL ON TABLE "public"."partida" TO "service_role";



GRANT ALL ON TABLE "public"."mv_partida_tree" TO "anon";
GRANT ALL ON TABLE "public"."mv_partida_tree" TO "authenticated";
GRANT ALL ON TABLE "public"."mv_partida_tree" TO "service_role";



GRANT ALL ON SEQUENCE "public"."nota_credito_folio_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."nota_credito_folio_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."nota_credito_folio_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."nota_debito_folio_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."nota_debito_folio_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."nota_debito_folio_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pagos_id_pago_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pagos_id_pago_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pagos_id_pago_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."partida_id_partida_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."partida_id_partida_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."partida_id_partida_seq" TO "service_role";



GRANT ALL ON TABLE "public"."permisos" TO "anon";
GRANT ALL ON TABLE "public"."permisos" TO "authenticated";
GRANT ALL ON TABLE "public"."permisos" TO "service_role";



GRANT ALL ON SEQUENCE "public"."permisos_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."permisos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."permisos_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."plantilla_actividad" TO "anon";
GRANT ALL ON TABLE "public"."plantilla_actividad" TO "authenticated";
GRANT ALL ON TABLE "public"."plantilla_actividad" TO "service_role";



GRANT ALL ON SEQUENCE "public"."plantilla_actividad_id_plantilla_actividad_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."plantilla_actividad_id_plantilla_actividad_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."plantilla_actividad_id_plantilla_actividad_seq" TO "service_role";



GRANT ALL ON TABLE "public"."plantilla_cronograma" TO "anon";
GRANT ALL ON TABLE "public"."plantilla_cronograma" TO "authenticated";
GRANT ALL ON TABLE "public"."plantilla_cronograma" TO "service_role";



GRANT ALL ON SEQUENCE "public"."plantilla_cronograma_id_plantilla_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."plantilla_cronograma_id_plantilla_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."plantilla_cronograma_id_plantilla_seq" TO "service_role";



GRANT ALL ON TABLE "public"."plantilla_detalle" TO "anon";
GRANT ALL ON TABLE "public"."plantilla_detalle" TO "authenticated";
GRANT ALL ON TABLE "public"."plantilla_detalle" TO "service_role";



GRANT ALL ON SEQUENCE "public"."plantilla_detalle_id_plantilla_detalle_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."plantilla_detalle_id_plantilla_detalle_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."plantilla_detalle_id_plantilla_detalle_seq" TO "service_role";



GRANT ALL ON TABLE "public"."plantilla_presupuesto" TO "anon";
GRANT ALL ON TABLE "public"."plantilla_presupuesto" TO "authenticated";
GRANT ALL ON TABLE "public"."plantilla_presupuesto" TO "service_role";



GRANT ALL ON SEQUENCE "public"."plantilla_presupuesto_id_plantilla_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."plantilla_presupuesto_id_plantilla_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."plantilla_presupuesto_id_plantilla_seq" TO "service_role";



GRANT ALL ON TABLE "public"."presupuesto" TO "anon";
GRANT ALL ON TABLE "public"."presupuesto" TO "authenticated";
GRANT ALL ON TABLE "public"."presupuesto" TO "service_role";



GRANT ALL ON TABLE "public"."presupuesto_detalle" TO "anon";
GRANT ALL ON TABLE "public"."presupuesto_detalle" TO "authenticated";
GRANT ALL ON TABLE "public"."presupuesto_detalle" TO "service_role";



GRANT ALL ON SEQUENCE "public"."presupuesto_detalle_id_presupuesto_detalle_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."presupuesto_detalle_id_presupuesto_detalle_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."presupuesto_detalle_id_presupuesto_detalle_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."presupuesto_id_presupuesto_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."presupuesto_id_presupuesto_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."presupuesto_id_presupuesto_seq" TO "service_role";



GRANT ALL ON TABLE "public"."proveedor" TO "anon";
GRANT ALL ON TABLE "public"."proveedor" TO "authenticated";
GRANT ALL ON TABLE "public"."proveedor" TO "service_role";



GRANT ALL ON SEQUENCE "public"."proveedor_id_proveedor_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."proveedor_id_proveedor_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."proveedor_id_proveedor_seq" TO "service_role";



GRANT ALL ON TABLE "public"."proyecto" TO "anon";
GRANT ALL ON TABLE "public"."proyecto" TO "authenticated";
GRANT ALL ON TABLE "public"."proyecto" TO "service_role";



GRANT ALL ON SEQUENCE "public"."proyecto_id_proyecto_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."proyecto_id_proyecto_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."proyecto_id_proyecto_seq" TO "service_role";



GRANT ALL ON TABLE "public"."recurso_precio" TO "anon";
GRANT ALL ON TABLE "public"."recurso_precio" TO "authenticated";
GRANT ALL ON TABLE "public"."recurso_precio" TO "service_role";



GRANT ALL ON SEQUENCE "public"."recurso_precio_id_recurso_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."recurso_precio_id_recurso_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."recurso_precio_id_recurso_seq" TO "service_role";



GRANT ALL ON TABLE "public"."restriccion" TO "anon";
GRANT ALL ON TABLE "public"."restriccion" TO "authenticated";
GRANT ALL ON TABLE "public"."restriccion" TO "service_role";



GRANT ALL ON SEQUENCE "public"."restriccion_id_restriccion_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."restriccion_id_restriccion_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."restriccion_id_restriccion_seq" TO "service_role";



GRANT ALL ON TABLE "public"."revision_financiera" TO "anon";
GRANT ALL ON TABLE "public"."revision_financiera" TO "authenticated";
GRANT ALL ON TABLE "public"."revision_financiera" TO "service_role";



GRANT ALL ON SEQUENCE "public"."revision_financiera_id_revision_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."revision_financiera_id_revision_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."revision_financiera_id_revision_seq" TO "service_role";



GRANT ALL ON TABLE "public"."roles" TO "anon";
GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";



GRANT ALL ON SEQUENCE "public"."roles_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."roles_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."roles_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."roles_permisos" TO "anon";
GRANT ALL ON TABLE "public"."roles_permisos" TO "authenticated";
GRANT ALL ON TABLE "public"."roles_permisos" TO "service_role";



GRANT ALL ON TABLE "public"."seguimiento_proyecto" TO "anon";
GRANT ALL ON TABLE "public"."seguimiento_proyecto" TO "authenticated";
GRANT ALL ON TABLE "public"."seguimiento_proyecto" TO "service_role";



GRANT ALL ON SEQUENCE "public"."seguimiento_proyecto_id_seguimiento_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."seguimiento_proyecto_id_seguimiento_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."seguimiento_proyecto_id_seguimiento_seq" TO "service_role";



GRANT ALL ON TABLE "public"."solicitud_aprobacion" TO "anon";
GRANT ALL ON TABLE "public"."solicitud_aprobacion" TO "authenticated";
GRANT ALL ON TABLE "public"."solicitud_aprobacion" TO "service_role";



GRANT ALL ON SEQUENCE "public"."solicitud_aprobacion_id_solicitud_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."solicitud_aprobacion_id_solicitud_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."solicitud_aprobacion_id_solicitud_seq" TO "service_role";



GRANT ALL ON TABLE "public"."solicitud_notificacion" TO "anon";
GRANT ALL ON TABLE "public"."solicitud_notificacion" TO "authenticated";
GRANT ALL ON TABLE "public"."solicitud_notificacion" TO "service_role";



GRANT ALL ON SEQUENCE "public"."solicitud_notificacion_id_notificacion_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."solicitud_notificacion_id_notificacion_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."solicitud_notificacion_id_notificacion_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ticket" TO "anon";
GRANT ALL ON TABLE "public"."ticket" TO "authenticated";
GRANT ALL ON TABLE "public"."ticket" TO "service_role";



GRANT ALL ON TABLE "public"."ticket_comentario" TO "anon";
GRANT ALL ON TABLE "public"."ticket_comentario" TO "authenticated";
GRANT ALL ON TABLE "public"."ticket_comentario" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ticket_comentario_id_comentario_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ticket_comentario_id_comentario_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ticket_comentario_id_comentario_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ticket_evento" TO "anon";
GRANT ALL ON TABLE "public"."ticket_evento" TO "authenticated";
GRANT ALL ON TABLE "public"."ticket_evento" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ticket_evento_id_evento_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ticket_evento_id_evento_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ticket_evento_id_evento_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ticket_id_ticket_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ticket_id_ticket_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ticket_id_ticket_seq" TO "service_role";



GRANT ALL ON TABLE "public"."trans_detalle" TO "anon";
GRANT ALL ON TABLE "public"."trans_detalle" TO "authenticated";
GRANT ALL ON TABLE "public"."trans_detalle" TO "service_role";



GRANT ALL ON SEQUENCE "public"."trans_detalle_id_trans_detalle_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."trans_detalle_id_trans_detalle_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."trans_detalle_id_trans_detalle_seq" TO "service_role";



GRANT ALL ON TABLE "public"."transaccion_comprobante_pago" TO "anon";
GRANT ALL ON TABLE "public"."transaccion_comprobante_pago" TO "authenticated";
GRANT ALL ON TABLE "public"."transaccion_comprobante_pago" TO "service_role";



GRANT ALL ON SEQUENCE "public"."transaccion_comprobante_pago_id_comprobante_pago_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."transaccion_comprobante_pago_id_comprobante_pago_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."transaccion_comprobante_pago_id_comprobante_pago_seq" TO "service_role";



GRANT ALL ON TABLE "public"."transaccion_detalle_categoria" TO "anon";
GRANT ALL ON TABLE "public"."transaccion_detalle_categoria" TO "authenticated";
GRANT ALL ON TABLE "public"."transaccion_detalle_categoria" TO "service_role";



GRANT ALL ON SEQUENCE "public"."transaccion_detalle_categoria_id_detalle_categoria_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."transaccion_detalle_categoria_id_detalle_categoria_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."transaccion_detalle_categoria_id_detalle_categoria_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."transaccion_id_transaccion_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."transaccion_id_transaccion_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."transaccion_id_transaccion_seq" TO "service_role";



GRANT ALL ON TABLE "public"."valorizacion_partida" TO "anon";
GRANT ALL ON TABLE "public"."valorizacion_partida" TO "authenticated";
GRANT ALL ON TABLE "public"."valorizacion_partida" TO "service_role";



GRANT ALL ON SEQUENCE "public"."valorizacion_partida_id_valorizacion_partida_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."valorizacion_partida_id_valorizacion_partida_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."valorizacion_partida_id_valorizacion_partida_seq" TO "service_role";



GRANT ALL ON TABLE "public"."valorizacion_semanal" TO "anon";
GRANT ALL ON TABLE "public"."valorizacion_semanal" TO "authenticated";
GRANT ALL ON TABLE "public"."valorizacion_semanal" TO "service_role";



GRANT ALL ON SEQUENCE "public"."valorizacion_semanal_id_valorizacion_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."valorizacion_semanal_id_valorizacion_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."valorizacion_semanal_id_valorizacion_seq" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







