-- ============================================================
-- MIGRACIÓN: Módulo de Tickets (Libro de Reclamaciones/Incidencias) + Releases
--
-- Ver Documentacion/PlanModuloTicketsYReleases.md para el diseño completo. Reemplaza el reporte de
-- reclamos/sugerencias/incidencias/requerimientos por WhatsApp con un módulo dentro del propio ERP
-- (el cliente no tiene acceso a GitHub ni sabe qué es), y conecta cada ticket resuelto+aprobado con
-- la versión de la app que lo incluye (tabla `app_release`, alimentada por el script de deploy —
-- ver Documentacion/MecanismoCICD.md).
--
-- Idempotente: CREATE TABLE IF NOT EXISTS, ON CONFLICT DO NOTHING, NOTIFY pgrst al final — mismo
-- patrón que control_financiero_migration.sql/solicitud_aprobacion_migration.sql.
-- ============================================================

-- ----------------------------------------------------------------------------
-- 1. Rol 'developer' + permisos nuevos (ver DER2.sql: roles(id,nombre,descripcion),
--    permisos(id,nombre,descripcion), roles_permisos(rol_id,permiso_id))
-- ----------------------------------------------------------------------------

INSERT INTO roles (nombre, descripcion) VALUES
	('developer', 'Desarrollador del ERP — panel de tickets y releases')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO permisos (nombre, descripcion) VALUES
	('ver_soporte', 'Ver módulo Soporte'),
	('ver_soporte_tickets', 'Reportar y ver mis tickets'),
	('ver_soporte_developer', 'Panel Developer — bandeja completa, aprobar/rechazar, releases')
ON CONFLICT (nombre) DO NOTHING;

-- ver_soporte/ver_soporte_tickets van a TODOS los roles existentes — cualquier usuario debe poder
-- reportar un reclamo/incidencia, no solo developer/admin.
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r, permisos p
WHERE p.nombre IN ('ver_soporte', 'ver_soporte_tickets')
ON CONFLICT DO NOTHING;

-- ver_soporte_developer solo para developer/administrador (mismo criterio que
-- backfill_permisos_administrador_migration.sql: se le da explícito a admin también, aunque
-- hasPermiso() ya lo bypasea por wildcard — así la UI de Roles y Permisos lo muestra marcado).
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r, permisos p
WHERE r.nombre IN ('developer', 'administrador') AND p.nombre = 'ver_soporte_developer'
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. app_release — una fila por versión publicada (la crea el script de deploy, no la UI)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app_release (
	id_release          BIGSERIAL PRIMARY KEY,
	version             VARCHAR(20) NOT NULL UNIQUE,
	changelog           TEXT,
	url_manifest_win    TEXT,  -- latest.json en GitHub Releases (lo que lee @tauri-apps/plugin-updater)
	url_instalador_win  TEXT,  -- .msi/.exe en GitHub Releases, informativo/debug
	url_apk_drive       TEXT,  -- link o fileId de Drive del APK debug de Android
	publicado_por       VARCHAR(200),
	created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 3. ticket
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ticket (
	id_ticket       BIGSERIAL PRIMARY KEY,
	tipo            VARCHAR(20) NOT NULL CHECK (tipo IN ('reclamo', 'sugerencia', 'incidencia', 'requerimiento')),
	modulo          VARCHAR(60),  -- path de MODULE_REGISTRY (modules.ts), ej. '/finanzas/tranzacciones'; null = "Otro/No aplica"
	titulo          VARCHAR(150) NOT NULL,
	descripcion     TEXT NOT NULL,
	prioridad       VARCHAR(10) NOT NULL DEFAULT 'media' CHECK (prioridad IN ('baja', 'media', 'alta', 'critica')),
	estado          VARCHAR(15) NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'en_progreso', 'resuelto', 'aprobado', 'rechazado', 'cerrado')),
	creado_por      VARCHAR(200),
	creado_por_id   UUID,
	resuelto_por    VARCHAR(200),
	resuelto_en     TIMESTAMPTZ,
	aprobado_por    VARCHAR(200),  -- también aplica a "rechazado_por" — un solo campo, el estado dice cuál de los dos fue
	aprobado_en     TIMESTAMPTZ,
	motivo_rechazo  TEXT,
	id_release      BIGINT REFERENCES app_release(id_release),
	created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_estado ON ticket(estado);
CREATE INDEX IF NOT EXISTS idx_ticket_creado_por_id ON ticket(creado_por_id);
CREATE INDEX IF NOT EXISTS idx_ticket_id_release ON ticket(id_release);

-- ----------------------------------------------------------------------------
-- 4. ticket_comentario — el "foro" por ticket
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ticket_comentario (
	id_comentario   BIGSERIAL PRIMARY KEY,
	id_ticket       BIGINT NOT NULL REFERENCES ticket(id_ticket) ON DELETE CASCADE,
	autor           VARCHAR(200),
	autor_id        UUID,
	mensaje         TEXT NOT NULL,
	created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_comentario_ticket ON ticket_comentario(id_ticket);

-- ----------------------------------------------------------------------------
-- 5. ticket_evento — auditoría de cambios de estado (mismo patrón que incidencia_evento en
--    control_financiero_migration.sql)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ticket_evento (
	id_evento       BIGSERIAL PRIMARY KEY,
	id_ticket       BIGINT NOT NULL REFERENCES ticket(id_ticket) ON DELETE CASCADE,
	estado_anterior VARCHAR(15),
	estado_nuevo    VARCHAR(15),
	usuario         VARCHAR(200),
	comentario      TEXT,
	created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_evento_ticket ON ticket_evento(id_ticket);

-- ----------------------------------------------------------------------------
-- 6. Realtime (mismo criterio que solicitud_aprobacion_realtime_migration.sql) — para que la
--    campanita de notificaciones pueda suscribirse a cambios en vivo, no solo hacer polling.
-- ----------------------------------------------------------------------------

ALTER TABLE ticket REPLICA IDENTITY FULL;
ALTER TABLE ticket_comentario REPLICA IDENTITY FULL;

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_publication_tables
		WHERE pubname = 'supabase_realtime' AND tablename = 'ticket'
	) THEN
		ALTER PUBLICATION supabase_realtime ADD TABLE ticket;
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM pg_publication_tables
		WHERE pubname = 'supabase_realtime' AND tablename = 'ticket_comentario'
	) THEN
		ALTER PUBLICATION supabase_realtime ADD TABLE ticket_comentario;
	END IF;
END $$;

NOTIFY pgrst, 'reload schema';
