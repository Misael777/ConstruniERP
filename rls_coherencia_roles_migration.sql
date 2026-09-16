-- ----------------------------------------------------------------------------
-- Reafirma TODAS las políticas RLS ya diseñadas en este proyecto (encontradas
-- repartidas en DER2.sql/DB_reset_withoutacces.sql/documento_proyecto_migration.sql/
-- cronograma_gantt_migration.sql) — a pedido explícito del usuario, tras un bug
-- real reportado: una Asesora (rol no-admin) no podía subir la proforma al cerrar
-- una venta porque el INSERT en `documento_proyecto` chocaba con
-- "new row violates row-level security policy" (code=42501), aunque el diseño
-- original de esa tabla es "cualquier usuario autenticado puede hacer de todo"
-- (sin distinguir rol). La política vivía en el repo pero el estado real de la
-- base de datos había quedado desalineado.
--
-- Este archivo es 100% IDEMPOTENTE (DROP POLICY IF EXISTS + CREATE POLICY, y
-- ENABLE ROW LEVEL SECURITY que no hace nada si ya estaba habilitado) — se puede
-- correr las veces que haga falta sin romper nada, y sirve como "fuente única de
-- verdad" de estas políticas en vez de tenerlas repartidas en 4 archivos que
-- pueden desalinearse entre sí.
--
-- Resto de las tablas del ERP (transaccion, cuentas_pagar, cuentas_cobrar,
-- proveedor, cliente, centro_costo, etc.): NO tienen RLS y no se tocan acá — el
-- control de acceso por rol en esas tablas es deliberadamente solo de UI
-- (isAdmin()/permisosState en el cliente), documentado así en decenas de
-- comentarios del código ("la BD todavía no tiene RLS real"). Si el usuario
-- pidiera en el futuro RLS real también ahí, es un cambio de diseño aparte —
-- este archivo solo restaura lo que YA estaba diseñado para las 6 tablas que
-- SÍ lo tienen.
-- ----------------------------------------------------------------------------

-- ============================================================================
-- 1. documento_proyecto — abierto a CUALQUIER usuario autenticado, sin
--    distinción de rol (Asesor incluido). Esta es la tabla del bug reportado.
-- ============================================================================
ALTER TABLE documento_proyecto ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_full_access_documento" ON documento_proyecto;
CREATE POLICY "authenticated_full_access_documento"
    ON documento_proyecto FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

-- Bucket de Storage donde se suben los archivos (proforma/contrato/comprobante) —
-- mismo criterio: cualquier autenticado sube/borra, lectura pública para poder
-- previsualizar/descargar sin volver a autenticar.
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-documents', 'project-documents', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "auth_upload_project_docs" ON storage.objects;
CREATE POLICY "auth_upload_project_docs"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'project-documents');

DROP POLICY IF EXISTS "public_read_project_docs" ON storage.objects;
CREATE POLICY "public_read_project_docs"
    ON storage.objects FOR SELECT TO public
    USING (bucket_id = 'project-documents');

DROP POLICY IF EXISTS "auth_delete_project_docs" ON storage.objects;
CREATE POLICY "auth_delete_project_docs"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'project-documents');

-- ============================================================================
-- 2. Cronograma/Gantt (obra) — mismo criterio "abierto a cualquier autenticado"
--    que documento_proyecto. Nadie reportó un bug acá todavía, pero sigue
--    exactamente el mismo patrón (RLS habilitado + política permisiva), así que
--    si documento_proyecto se desalineó, estas también pudieron hacerlo.
-- ============================================================================
ALTER TABLE cronograma_dependencia  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cronograma_plan_base    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cronograma_actividad    ENABLE ROW LEVEL SECURITY;
ALTER TABLE restriccion             ENABLE ROW LEVEL SECURITY;
ALTER TABLE plantilla_cronograma    ENABLE ROW LEVEL SECURITY;
ALTER TABLE plantilla_actividad     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_full_crono_dep" ON cronograma_dependencia;
CREATE POLICY "auth_full_crono_dep" ON cronograma_dependencia FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_full_crono_pb" ON cronograma_plan_base;
CREATE POLICY "auth_full_crono_pb" ON cronograma_plan_base FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_full_crono_act" ON cronograma_actividad;
CREATE POLICY "auth_full_crono_act" ON cronograma_actividad FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_full_restriccion" ON restriccion;
CREATE POLICY "auth_full_restriccion" ON restriccion FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_full_plantilla" ON plantilla_cronograma;
CREATE POLICY "auth_full_plantilla" ON plantilla_cronograma FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_full_plantilla_act" ON plantilla_actividad;
CREATE POLICY "auth_full_plantilla_act" ON plantilla_actividad FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- 3. IAM (roles/permisos/roles_permisos/empleados) — ÚNICO grupo de tablas con
--    una regla de negocio real por rol: CUALQUIER autenticado puede LEER (el
--    menú/permisos de la UI necesita leerlos para armar la pantalla de
--    cualquier usuario, Asesor incluido), pero solo un administrador
--    (is_admin(), ver función abajo) puede escribir (crear/editar/borrar
--    roles, permisos o empleados). Los pocos casos legítimos en que un
--    no-admin necesita escribir acá (ej. activar su propia contraseña, ver
--    verifyOtpAndSetPassword en login/+page.svelte) ya pasan por una Edge
--    Function con service_role, que bypassea RLS a propósito — no se toca
--    ese mecanismo.
-- ============================================================================
ALTER TABLE roles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE permisos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles_permisos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE empleados       ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
    SELECT EXISTS (
        SELECT 1 FROM empleados e JOIN roles r ON e.rol_id = r.id WHERE e.auth_user_id = auth.uid() AND r.nombre = 'administrador'
    );
$$;

DROP POLICY IF EXISTS "Lectura publica de roles" ON roles;
CREATE POLICY "Lectura publica de roles" ON roles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Lectura publica de permisos" ON permisos;
CREATE POLICY "Lectura publica de permisos" ON permisos FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Lectura publica de roles_permisos" ON roles_permisos;
CREATE POLICY "Lectura publica de roles_permisos" ON roles_permisos FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Lectura publica de empleados" ON empleados;
CREATE POLICY "Lectura publica de empleados" ON empleados FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admin CRUD roles" ON roles;
CREATE POLICY "Admin CRUD roles" ON roles FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admin CRUD permisos" ON permisos;
CREATE POLICY "Admin CRUD permisos" ON permisos FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admin CRUD roles_permisos" ON roles_permisos;
CREATE POLICY "Admin CRUD roles_permisos" ON roles_permisos FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admin CRUD empleados" ON empleados;
CREATE POLICY "Admin CRUD empleados" ON empleados FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
