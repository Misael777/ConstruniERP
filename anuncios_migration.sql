-- ============================================================
-- MIGRACIÓN: Tabla `anuncios` — comunicados corporativos en la nueva landing de Dashboard
-- A pedido explícito del usuario: el módulo Dashboard (`/dashboard`, permiso ver_dashboard) dejó de
-- ser el panel financiero (movido a Finanzas → Dashboard Finanzas, ver finanzas_dashboard_permiso_
-- migration.sql) y pasó a ser una landing temática donde los administradores publican anuncios/
-- comunicados corporativos, visibles para cualquier usuario logueado. Sin RLS real (mismo criterio
-- que el resto del ERP) — el gate de "solo admin puede publicar/editar" es de UI (isAdmin()), no de
-- base de datos.
-- Idempotente: usa CREATE TABLE IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS anuncios (
	id_anuncio         BIGSERIAL PRIMARY KEY,
	titulo             VARCHAR(200) NOT NULL,
	contenido          TEXT NOT NULL,
	-- Imagen opcional del anuncio, subida a Google Drive (mismo mecanismo que comprobantes/documentos
	-- de otros módulos, ver driveUploadClient.ts / /api/upload-document).
	imagen_url         TEXT,
	autor              VARCHAR(100),
	fecha_publicacion  DATE NOT NULL DEFAULT CURRENT_DATE,
	-- Ocultar sin borrar — "Eliminar" en la UI solo marca activo=false, no hace un DELETE real.
	activo             BOOLEAN NOT NULL DEFAULT true,
	created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
