-- ============================================================
-- MIGRACIÓN: Tipo de Gasto (Egreso, proyectos de Obra) — a pedido del usuario, cuando el proyecto del
-- Centro de Costo es de Obra y el Tipo es Egreso, "Nueva Transacción"/"Editar Transacción" ofrece 7
-- dropdowns (uno por Categoría: Honorarios/Alquileres/Servicios/Sub Contrata/Compras/Movilidad/
-- Impuestos), cada uno con su propio catálogo de sub-tipos — ver TIPOS_GASTO_OBRA en
-- TransaccionModal.svelte. Los 7 comparten esta única columna (el valor elegido en cualquiera de los
-- 7 se guarda acá).
-- Idempotente: usa ALTER TABLE … ADD COLUMN IF NOT EXISTS
-- ============================================================

ALTER TABLE transaccion
    ADD COLUMN IF NOT EXISTS tipo_gasto VARCHAR(50);

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
