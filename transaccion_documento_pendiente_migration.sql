-- ----------------------------------------------------------------------------
-- Agrega "Documento pendiente" (Sí/No) a `transaccion` — a pedido explícito del
-- usuario: para Ingreso/Egreso, poder marcar que todavía falta el documento de
-- respaldo (factura/boleta) de esa transacción, con quién es responsable de
-- conseguirlo y para cuándo. Mismo criterio de texto-enum (no BOOLEAN real) que
-- ya usan tipo_moneda/tipo_alcance/estado en esta misma tabla — evita líos de
-- cast string/boolean entre el cliente (Supabase JS) y Postgres.
--
-- `responsable_documento_pendiente`/`fecha_vencimiento_documento` quedan NULL
-- salvo que documento_pendiente='si' (el formulario los oculta y no los pide
-- en ningún otro caso, ver TransaccionModal.svelte).
-- ----------------------------------------------------------------------------

ALTER TABLE transaccion
    ADD COLUMN IF NOT EXISTS documento_pendiente VARCHAR(3) NOT NULL DEFAULT 'no' CHECK (documento_pendiente IN ('si', 'no')),
    ADD COLUMN IF NOT EXISTS responsable_documento_pendiente VARCHAR(100),
    ADD COLUMN IF NOT EXISTS fecha_vencimiento_documento DATE;
