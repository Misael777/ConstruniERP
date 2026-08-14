-- ============================================================
-- MIGRACIÓN: agrega la columna `estado` a `proveedor` — "Dar de baja" (finanzas/proveedores/+page.svelte
-- / darDeBajaProveedor en proveedores.service.ts) intenta marcar `proveedor.estado = 'baja'`, pero esa
-- columna nunca existió en la tabla (mismo caso que ya pasó con `cliente.estado`, ver
-- cliente_estado_migration.sql) — por eso getProveedores fallaba con:
-- "column proveedor.estado does not exist" (Postgres 42703).
--
-- VARCHAR libre, sin CHECK (mismo criterio que cliente.estado/estado_proyecto) — default 'activo'
-- para que los proveedores ya existentes queden como activos sin necesitar backfill manual.
--
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

ALTER TABLE proveedor ADD COLUMN IF NOT EXISTS estado VARCHAR(10) NOT NULL DEFAULT 'activo';

NOTIFY pgrst, 'reload schema';
