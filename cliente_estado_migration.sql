-- ============================================================
-- MIGRACIÓN: agrega la columna `estado` a `cliente` — "Dar de baja" (ClientesTable.svelte /
-- darDeBajaCliente en aprobaciones.service.ts) intenta marcar `cliente.estado = 'baja'`, pero esa
-- columna nunca existió en la tabla (a diferencia de `proyecto.estado_proyecto`, que ya existía desde
-- antes y que darDeBajaVenta reutiliza sin problema) — por eso el botón fallaba con:
-- "Could not find the 'estado' column of 'cliente' in the schema cache".
--
-- VARCHAR libre, sin CHECK (mismo criterio que estado_proyecto) — default 'activo' para que los
-- clientes ya existentes queden como activos sin necesitar backfill manual.
--
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

ALTER TABLE cliente ADD COLUMN IF NOT EXISTS estado VARCHAR(10) NOT NULL DEFAULT 'activo';

NOTIFY pgrst, 'reload schema';
