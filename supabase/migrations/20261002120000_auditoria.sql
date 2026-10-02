-- Submódulo Control de Accesos → Auditoría (ver plan: sesiones, acciones y cierres inesperados).
--
-- Tres tablas:
--   auditoria_sesion  — una fila por inicio de sesión: latido cada 60 s, y cómo/cuándo terminó.
--   auditoria_accion  — cambios de datos (triggers) + descargas/PDFs/subidas (RPC). Retención 14 días.
--   auditoria_error   — errores de la app (JS, panic de Rust). Retención 7 días.
--
-- Escritura SOLO vía funciones SECURITY DEFINER (nunca INSERT directo): cuando la sesión de Supabase ya se
-- perdió, el cliente queda como `anon` y no puede escribir como el usuario — por eso cada sesión tiene un
-- token aleatorio (auditoria_sesion_token, sin ningún acceso desde la API) que autoriza a registrar su
-- cierre/eventos aunque ya no haya JWT. Lectura: solo quien tenga el permiso ver_iam_auditoria (o admin).
--
-- Idempotente; no modifica ni borra datos existentes.

-- ---------------------------------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auditoria_sesion (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid NOT NULL,
    usuario        text,
    plataforma     text,
    version_app    text,
    inicio         timestamptz NOT NULL DEFAULT now(),
    ultimo_latido  timestamptz NOT NULL DEFAULT now(),
    fin            timestamptz,
    motivo_fin     text CHECK (motivo_fin IN ('logout_manual', 'sesion_expirada', 'app_cerrada', 'cierre_inesperado')),
    detalle        text
);
CREATE INDEX IF NOT EXISTS auditoria_sesion_inicio_idx ON auditoria_sesion (inicio DESC);
CREATE INDEX IF NOT EXISTS auditoria_sesion_abiertas_idx ON auditoria_sesion (ultimo_latido) WHERE fin IS NULL;
CREATE INDEX IF NOT EXISTS auditoria_sesion_user_idx ON auditoria_sesion (user_id, inicio DESC);

CREATE TABLE IF NOT EXISTS auditoria_sesion_token (
    sesion_id  uuid PRIMARY KEY REFERENCES auditoria_sesion (id) ON DELETE CASCADE,
    token      uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS auditoria_accion (
    id           bigserial PRIMARY KEY,
    sesion_id    uuid REFERENCES auditoria_sesion (id) ON DELETE SET NULL,
    user_id      uuid,
    usuario      text,
    tipo         text NOT NULL CHECK (tipo IN ('insert', 'update', 'delete', 'descarga', 'pdf', 'subida')),
    tabla        text,
    modulo       text,
    id_registro  text,
    resumen      text,
    cambios      jsonb,
    creado_en    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auditoria_accion_creado_idx ON auditoria_accion (creado_en DESC);
CREATE INDEX IF NOT EXISTS auditoria_accion_sesion_idx ON auditoria_accion (sesion_id);
CREATE INDEX IF NOT EXISTS auditoria_accion_user_idx ON auditoria_accion (user_id, creado_en DESC);

CREATE TABLE IF NOT EXISTS auditoria_error (
    id          bigserial PRIMARY KEY,
    sesion_id   uuid REFERENCES auditoria_sesion (id) ON DELETE SET NULL,
    user_id     uuid,
    usuario     text,
    origen      text NOT NULL CHECK (origen IN ('js', 'rust_panic', 'cierre')),
    mensaje     text NOT NULL,
    stack       text,
    plataforma  text,
    creado_en   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auditoria_error_creado_idx ON auditoria_error (creado_en DESC);

-- ---------------------------------------------------------------------------------------------------
-- Permiso + RLS
-- ---------------------------------------------------------------------------------------------------
INSERT INTO permisos (nombre, descripcion)
VALUES ('ver_iam_auditoria', 'Control de Accesos → Auditoría: sesiones, acciones y errores de todos los usuarios')
ON CONFLICT (nombre) DO NOTHING;

-- Admin ya tiene acceso total vía is_admin(); el resto, solo si su rol tiene el permiso.
CREATE OR REPLACE FUNCTION tiene_permiso(p_permiso text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT is_admin() OR EXISTS (
        SELECT 1
        FROM empleados e
        JOIN roles_permisos rp ON rp.rol_id = e.rol_id
        JOIN permisos p ON p.id = rp.permiso_id
        WHERE e.auth_user_id = auth.uid() AND e.estado = 'activo' AND p.nombre = p_permiso
    );
$$;

ALTER TABLE auditoria_sesion ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria_sesion_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria_accion ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria_error ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auditoria_sesion_leer ON auditoria_sesion;
CREATE POLICY auditoria_sesion_leer ON auditoria_sesion FOR SELECT TO authenticated USING (tiene_permiso('ver_iam_auditoria'));
DROP POLICY IF EXISTS auditoria_accion_leer ON auditoria_accion;
CREATE POLICY auditoria_accion_leer ON auditoria_accion FOR SELECT TO authenticated USING (tiene_permiso('ver_iam_auditoria'));
DROP POLICY IF EXISTS auditoria_error_leer ON auditoria_error;
CREATE POLICY auditoria_error_leer ON auditoria_error FOR SELECT TO authenticated USING (tiene_permiso('ver_iam_auditoria'));
-- auditoria_sesion_token: sin políticas → inaccesible desde la API (solo las funciones de abajo la leen).
REVOKE ALL ON auditoria_sesion_token FROM anon, authenticated;
-- Las tablas de auditoría son de SOLO LECTURA desde la API (y solo con el permiso, ver políticas): toda
-- escritura pasa por las funciones SECURITY DEFINER de abajo.
REVOKE ALL ON auditoria_sesion, auditoria_accion, auditoria_error FROM anon, authenticated;
GRANT SELECT ON auditoria_sesion, auditoria_accion, auditoria_error TO authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Funciones de escritura (las llama la app)
-- ---------------------------------------------------------------------------------------------------
-- Valida sesión + token; devuelve la fila de la sesión o NULL.
CREATE OR REPLACE FUNCTION auditoria_validar(p_sesion uuid, p_token uuid) RETURNS auditoria_sesion
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT s.* FROM auditoria_sesion s
    JOIN auditoria_sesion_token t ON t.sesion_id = s.id
    WHERE s.id = p_sesion AND t.token = p_token;
$$;
REVOKE ALL ON FUNCTION auditoria_validar(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION auditoria_iniciar_sesion(p_plataforma text, p_version text)
RETURNS TABLE (sesion_id uuid, token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_sesion uuid;
    v_token uuid := gen_random_uuid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auditoria_iniciar_sesion requiere una sesión autenticada';
    END IF;
    INSERT INTO auditoria_sesion (user_id, usuario, plataforma, version_app)
    VALUES (v_uid, (SELECT nombre FROM empleados WHERE auth_user_id = v_uid LIMIT 1), left(p_plataforma, 30), left(p_version, 30))
    RETURNING id INTO v_sesion;
    INSERT INTO auditoria_sesion_token (sesion_id, token) VALUES (v_sesion, v_token);
    RETURN QUERY SELECT v_sesion, v_token;
END $$;

CREATE OR REPLACE FUNCTION auditoria_latido(p_sesion uuid, p_token uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auditoria_validar(p_sesion, p_token) IS NULL THEN RETURN; END IF;
    UPDATE auditoria_sesion SET ultimo_latido = now() WHERE id = p_sesion AND fin IS NULL;
END $$;

-- Cierra la sesión con el motivo y la hora reales. Si ya estaba cerrada como 'cierre_inesperado' (deducido
-- por falta de latido) y luego llega el dato real desde el diario local (ej. 'app_cerrada' con la hora
-- exacta), el dato real lo reemplaza.
CREATE OR REPLACE FUNCTION auditoria_cerrar_sesion(p_sesion uuid, p_token uuid, p_motivo text, p_momento timestamptz DEFAULT NULL, p_detalle text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_s auditoria_sesion;
    v_momento timestamptz;
BEGIN
    v_s := auditoria_validar(p_sesion, p_token);
    IF v_s IS NULL THEN RETURN; END IF;
    -- La hora viene del dispositivo: se acota entre el inicio de la sesión y ahora.
    v_momento := LEAST(GREATEST(COALESCE(p_momento, now()), v_s.inicio), now());
    UPDATE auditoria_sesion
    SET fin = v_momento, motivo_fin = p_motivo, detalle = left(p_detalle, 500),
        ultimo_latido = GREATEST(ultimo_latido, v_momento)
    WHERE id = p_sesion AND (fin IS NULL OR motivo_fin = 'cierre_inesperado');
END $$;

CREATE OR REPLACE FUNCTION auditoria_registrar_evento(p_sesion uuid, p_token uuid, p_tipo text, p_modulo text, p_resumen text, p_momento timestamptz DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_s auditoria_sesion;
BEGIN
    IF p_tipo NOT IN ('descarga', 'pdf', 'subida') THEN RETURN; END IF;
    v_s := auditoria_validar(p_sesion, p_token);
    IF v_s IS NULL THEN RETURN; END IF;
    INSERT INTO auditoria_accion (sesion_id, user_id, usuario, tipo, modulo, resumen, creado_en)
    VALUES (v_s.id, v_s.user_id, v_s.usuario, p_tipo, left(p_modulo, 60), left(p_resumen, 500),
            LEAST(GREATEST(COALESCE(p_momento, now()), v_s.inicio), now()));
END $$;

-- Errores: con sesión válida se vinculan a ella; sin sesión (ej. pantalla de login) solo si hay JWT.
CREATE OR REPLACE FUNCTION auditoria_registrar_error(p_sesion uuid, p_token uuid, p_origen text, p_mensaje text, p_stack text, p_plataforma text, p_momento timestamptz DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_s auditoria_sesion;
    v_uid uuid := auth.uid();
BEGIN
    IF p_sesion IS NOT NULL THEN v_s := auditoria_validar(p_sesion, p_token); END IF;
    IF v_s IS NULL AND v_uid IS NULL THEN RETURN; END IF;
    -- Freno anti-inundación: como máximo 30 errores por sesión/usuario por minuto.
    IF (SELECT count(*) FROM auditoria_error
        WHERE creado_en > now() - interval '1 minute'
          AND (sesion_id = v_s.id OR (v_s.id IS NULL AND user_id = v_uid))) >= 30 THEN
        RETURN;
    END IF;
    INSERT INTO auditoria_error (sesion_id, user_id, usuario, origen, mensaje, stack, plataforma, creado_en)
    VALUES (v_s.id, COALESCE(v_s.user_id, v_uid),
            COALESCE(v_s.usuario, (SELECT nombre FROM empleados WHERE auth_user_id = v_uid LIMIT 1)),
            CASE WHEN p_origen IN ('js', 'rust_panic', 'cierre') THEN p_origen ELSE 'js' END,
            left(COALESCE(p_mensaje, '(sin mensaje)'), 1000), left(p_stack, 4000), left(p_plataforma, 30),
            LEAST(COALESCE(p_momento, now()), now()));
END $$;

-- Sesiones sin cerrar y sin latido por más de 3 min = la app se cerró sin avisar (proceso terminado, corte de
-- luz, Android matando la app). Se cierran a la hora de su ÚLTIMO latido (precisión ± 60 s).
CREATE OR REPLACE FUNCTION auditoria_cerrar_huerfanas() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_n integer;
BEGIN
    UPDATE auditoria_sesion
    SET fin = ultimo_latido, motivo_fin = 'cierre_inesperado',
        detalle = 'Sin latido desde ' || to_char(ultimo_latido AT TIME ZONE 'America/Lima', 'DD/MM/YYYY HH24:MI:SS') || ' (hora Lima)'
    WHERE fin IS NULL AND ultimo_latido < now() - interval '3 minutes';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END $$;

-- Retención: acciones 14 días, errores 7 días, sesiones cerradas 14 días.
CREATE OR REPLACE FUNCTION auditoria_purgar() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    DELETE FROM auditoria_accion WHERE creado_en < now() - interval '14 days';
    DELETE FROM auditoria_error WHERE creado_en < now() - interval '7 days';
    DELETE FROM auditoria_sesion WHERE fin IS NOT NULL AND fin < now() - interval '14 days';
END $$;

-- Postgres da EXECUTE a PUBLIC por defecto: se quita y se otorga explícitamente. Las de cierre/latido/evento/
-- error también a anon (se usan cuando la sesión de Supabase ya se perdió; las protege el token de sesión).
REVOKE EXECUTE ON FUNCTION auditoria_iniciar_sesion(text, text), auditoria_cerrar_huerfanas(), auditoria_purgar(), tiene_permiso(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION auditoria_iniciar_sesion(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION auditoria_latido(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auditoria_cerrar_sesion(uuid, uuid, text, timestamptz, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auditoria_registrar_evento(uuid, uuid, text, text, text, timestamptz) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auditoria_registrar_error(uuid, uuid, text, text, text, text, timestamptz) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auditoria_cerrar_huerfanas() TO authenticated;
GRANT EXECUTE ON FUNCTION auditoria_purgar() TO authenticated;
GRANT EXECUTE ON FUNCTION tiene_permiso(text) TO authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Cambios de datos: trigger genérico en las tablas de negocio
-- ---------------------------------------------------------------------------------------------------
-- TG_ARGV[0] = columna de la clave primaria de la tabla. La sesión se toma del header x-auditoria-sesion que
-- manda la app en cada petición, y solo se acepta si pertenece al mismo usuario del JWT. Cualquier fallo acá
-- se traga (WARNING) — la auditoría nunca debe impedir la operación real.
CREATE OR REPLACE FUNCTION auditoria_registrar_cambio() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_pk text := TG_ARGV[0];
    v_old jsonb;
    v_new jsonb;
    v_cambios jsonb;
    v_uid uuid := auth.uid();
    v_sesion uuid;
    v_usuario text;
BEGIN
    BEGIN
        IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
        IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;

        IF TG_OP = 'UPDATE' THEN
            SELECT jsonb_object_agg(k, jsonb_build_object('antes', v_old -> k, 'despues', v_new -> k))
            INTO v_cambios
            FROM jsonb_object_keys(v_new) AS k
            WHERE (v_new -> k) IS DISTINCT FROM (v_old -> k)
              AND k NOT IN ('updated_at', 'api_updated_at');
            IF v_cambios IS NULL THEN RETURN NULL; END IF;
        ELSIF TG_OP = 'INSERT' THEN
            v_cambios := v_new;
        ELSE
            v_cambios := v_old;
        END IF;

        BEGIN
            v_sesion := (current_setting('request.headers', true)::json ->> 'x-auditoria-sesion')::uuid;
        EXCEPTION WHEN others THEN
            v_sesion := NULL;
        END;
        IF v_sesion IS NOT NULL THEN
            SELECT id, usuario INTO v_sesion, v_usuario FROM auditoria_sesion WHERE id = v_sesion AND user_id = v_uid;
        END IF;
        IF v_usuario IS NULL AND v_uid IS NOT NULL THEN
            SELECT nombre INTO v_usuario FROM empleados WHERE auth_user_id = v_uid LIMIT 1;
        END IF;

        INSERT INTO auditoria_accion (sesion_id, user_id, usuario, tipo, tabla, id_registro, cambios)
        VALUES (v_sesion, v_uid, COALESCE(v_usuario, CASE WHEN v_uid IS NULL THEN 'sistema' END),
                lower(TG_OP), TG_TABLE_NAME, COALESCE(v_new ->> v_pk, v_old ->> v_pk), v_cambios);
    EXCEPTION WHEN others THEN
        RAISE WARNING 'auditoria_registrar_cambio (%): %', TG_TABLE_NAME, SQLERRM;
    END;
    RETURN NULL;
END $$;

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('transaccion', 'id_transaccion'),
            ('cobros', 'id_cobro'),
            ('pagos', 'id_pago'),
            ('cuentas_cobrar', 'id_cuenta_cobrar'),
            ('cuentas_pagar', 'id_cuenta_pagar'),
            ('factura', 'id_factura'),
            ('cliente', 'id_cliente'),
            ('proveedor', 'id_proveedor'),
            ('proyecto', 'id_proyecto'),
            ('centro_costo', 'id_centro_costo'),
            ('cuenta_banco', 'id_cuenta_banco'),
            ('documento_proyecto', 'id_documento'),
            ('empleados', 'id'),
            ('roles_permisos', 'rol_id')
        ) AS t (tabla, pk)
    LOOP
        IF to_regclass('public.' || r.tabla) IS NOT NULL THEN
            EXECUTE format('DROP TRIGGER IF EXISTS auditoria_cambio ON public.%I', r.tabla);
            EXECUTE format(
                'CREATE TRIGGER auditoria_cambio AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION auditoria_registrar_cambio(%L)',
                r.tabla, r.pk
            );
        END IF;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------------
-- Limpieza nocturna con pg_cron, solo si la extensión ya está habilitada (hoy no lo está: mientras tanto,
-- la app llama auditoria_purgar() en cada inicio de sesión).
-- ---------------------------------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule('auditoria-purgar', '0 8 * * *', 'SELECT public.auditoria_purgar(); SELECT public.auditoria_cerrar_huerfanas();');
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
