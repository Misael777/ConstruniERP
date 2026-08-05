-- ============================================================
-- MIGRACIÓN: Campos propios de "Obra" en Características del proyecto
-- + ensancha tip_proyecto (Tipo de Proyecto de Consultoría)
--
-- Antes, la pestaña "Obra" de NuevaVentaModal.svelte (Tipo de obra, Tipo de
-- trámite, Tipo de Intervención, Tipo de edificación, Mes, Año) solo era
-- estado local del formulario — nunca se guardaba en la BD, así que Editar
-- Venta los mostraba vacíos aunque la venta original sí los tuviera cargados.
-- A pedido del usuario.
--
-- tip_proyecto (Tipo de Proyecto de Consultoría) se ensancha de VARCHAR(4) a
-- VARCHAR(10): la opción "DF + I" (Declaratoria de fábrica + Independización)
-- tiene 6 caracteres y no cabía — se habría rechazado al guardar.
--
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

ALTER TABLE proyecto
    ALTER COLUMN tip_proyecto TYPE VARCHAR(10);

ALTER TABLE proyecto
    ADD COLUMN IF NOT EXISTS tipo_obra VARCHAR(10),
    ADD COLUMN IF NOT EXISTS tipo_tramite VARCHAR(10),
    ADD COLUMN IF NOT EXISTS tipo_intervencion VARCHAR(10),
    ADD COLUMN IF NOT EXISTS tipo_edificacion_obra VARCHAR(10),
    ADD COLUMN IF NOT EXISTS mes_obra VARCHAR(2),
    ADD COLUMN IF NOT EXISTS anio_obra INTEGER;

NOTIFY pgrst, 'reload schema';
