-- ============================================================
-- MIGRACIÓN: app_version_usuario — qué versión de la app tiene instalada cada persona
-- A pedido explícito del usuario: poder ver, dentro de la ERP, qué versión tiene cada persona (y en
-- qué plataforma) para asegurarse de que las correcciones publicadas realmente les llegaron — ver el
-- ticket #8 (una persona quedó atascada en una versión vieja sin que nadie lo supiera).
-- La app registra su versión cada vez que un usuario abre sesión (ver registrarVersionUsuario en
-- src/lib/shared/appVersion.ts) y el Panel Developer la lista (sección "Versiones instaladas").
-- Una fila por persona Y plataforma (alguien puede usar Windows y Android a la vez).
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

CREATE TABLE IF NOT EXISTS app_version_usuario (
	id_registro      BIGSERIAL PRIMARY KEY,
	user_id          UUID NOT NULL,
	usuario          VARCHAR(200),
	plataforma       VARCHAR(20) NOT NULL,   -- 'android' | 'windows' | 'macos' | 'linux' | 'ios' | 'web'
	version          VARCHAR(20) NOT NULL,
	ultima_conexion  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	created_at       TIMESTAMPTZ DEFAULT NOW(),
	CONSTRAINT uq_app_version_usuario UNIQUE (user_id, plataforma)
);

CREATE INDEX IF NOT EXISTS idx_app_version_usuario_version ON app_version_usuario(version);

-- Cada usuario autenticado solo puede escribir SU propia fila; leer las de todos es seguro (solo hay
-- nombre, plataforma y versión) — la pantalla que las lista ya está protegida por el permiso
-- 'ver_soporte_developer' del lado de la app.
ALTER TABLE app_version_usuario ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_version_usuario_select ON app_version_usuario;
CREATE POLICY app_version_usuario_select ON app_version_usuario
	FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS app_version_usuario_insert ON app_version_usuario;
CREATE POLICY app_version_usuario_insert ON app_version_usuario
	FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS app_version_usuario_update ON app_version_usuario;
CREATE POLICY app_version_usuario_update ON app_version_usuario
	FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
