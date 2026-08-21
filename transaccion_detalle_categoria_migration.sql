-- ============================================================
-- MIGRACIÓN: Detalle de la Categoría — a pedido explícito del usuario, dentro de Nueva/Editar
-- Transacción, un botón "+ Más detalle de la categoría" (visible en cuanto se elige una Categoría)
-- despliega una tabla editable de subcategorías (Subcategoría/Descripción/Cantidad/Unidad/Precio
-- Unitario/Total), con un total autocalculado. Tabla NUEVA y separada de `trans_detalle`/Partidas
-- (que sigue existiendo tal cual, sin tocar).
-- Idempotente: usa CREATE TABLE IF NOT EXISTS
-- ============================================================

CREATE TABLE IF NOT EXISTS transaccion_detalle_categoria (
    id_detalle_categoria BIGSERIAL PRIMARY KEY,
    id_transaccion       BIGINT NOT NULL REFERENCES transaccion(id_transaccion) ON DELETE CASCADE,
    subcategoria         VARCHAR(100) NOT NULL,
    descripcion          VARCHAR(200),
    cantidad             NUMERIC NOT NULL,
    unidad               VARCHAR(20),
    precio_unitario      NUMERIC NOT NULL,
    total                NUMERIC NOT NULL,
    created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transaccion_detalle_categoria_id_transaccion
    ON transaccion_detalle_categoria (id_transaccion);

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
