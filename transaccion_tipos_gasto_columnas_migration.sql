-- ============================================================
-- MIGRACIÓN: 12 columnas de Tipo de Gasto en `transaccion` — a pedido explícito del usuario, una
-- columna VARCHAR propia por concepto (reemplaza la idea de una sola columna compartida `tipo_gasto`
-- de transaccion_tipo_gasto_migration.sql — esa migración queda sin aplicar/sin usar si se corre esta).
-- Idempotente: usa ALTER TABLE … ADD COLUMN IF NOT EXISTS
-- ============================================================

ALTER TABLE transaccion
    ADD COLUMN IF NOT EXISTS honorarios       VARCHAR(50),
    ADD COLUMN IF NOT EXISTS alquiler         VARCHAR(50),
    ADD COLUMN IF NOT EXISTS servicios        VARCHAR(50),
    ADD COLUMN IF NOT EXISTS subcontrata      VARCHAR(50),
    ADD COLUMN IF NOT EXISTS compras          VARCHAR(50),
    ADD COLUMN IF NOT EXISTS movilidad        VARCHAR(50),
    ADD COLUMN IF NOT EXISTS impuestos        VARCHAR(50),
    ADD COLUMN IF NOT EXISTS material         VARCHAR(50),
    ADD COLUMN IF NOT EXISTS equipos          VARCHAR(50),
    ADD COLUMN IF NOT EXISTS gastos_generales VARCHAR(50),
    ADD COLUMN IF NOT EXISTS prestamo         VARCHAR(50),
    ADD COLUMN IF NOT EXISTS inversion        VARCHAR(50);

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
