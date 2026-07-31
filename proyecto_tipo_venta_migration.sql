-- ============================================================
-- MIGRACIÓN: proyecto.tipo_venta (Consultoría vs Obra)
--
-- Antes, la elección de pestaña "Consultoría"/"Obra" en NuevaVentaModal.svelte
-- (caracteristicasTab) era solo estado local del formulario — nunca se guardaba
-- en la BD. A pedido del usuario, las ventas de Obra siguen generando su PROPIO
-- centro de costo (comportamiento actual, sin cambios), pero las de Consultoría
-- deben compartir UN ÚNICO centro de costo entre todas — para poder decidir esa
-- rama al cerrar la venta (adelanto) o reabrir el registro más adelante, hace
-- falta persistir el tipo de venta en el propio proyecto.
--
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

ALTER TABLE proyecto
    ADD COLUMN IF NOT EXISTS tipo_venta VARCHAR(20) NOT NULL DEFAULT 'obra';

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_proyecto_tipo_venta'
    ) THEN
        ALTER TABLE proyecto
            ADD CONSTRAINT chk_proyecto_tipo_venta
            CHECK (tipo_venta IN ('obra', 'consultoria'));
    END IF;
END $$;

-- Un único centro de costo compartido de tipo 'consultoria' (id_proyecto IS NULL, a diferencia de
-- los de Obra que sí llevan id_proyecto) — este índice evita que dos llamadas casi simultáneas a
-- getOrCrearCentroCostoCompartido() creen dos filas "Consultoría General" duplicadas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_centro_costo_consultoria_compartido
    ON centro_costo (tipo)
    WHERE tipo = 'consultoria' AND id_proyecto IS NULL;

NOTIFY pgrst, 'reload schema';
