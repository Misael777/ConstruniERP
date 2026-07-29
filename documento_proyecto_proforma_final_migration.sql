-- ============================================================
-- Migration: marca de "proforma final" en documento_proyecto
-- Run this in Supabase SQL Editor (Project > SQL Editor)
--
-- Permite registrar varias proformas (documento_proyecto con
-- tipo_documento = 'Proforma') por venta/proyecto mientras esta
-- sigue en negociación, y marcar cuál de ellas es la elegida al
-- cerrar la venta (junto con el contrato en proyecto.contrato).
-- ============================================================

ALTER TABLE documento_proyecto
    ADD COLUMN IF NOT EXISTS es_proforma_final BOOLEAN NOT NULL DEFAULT false;

-- Como mucho una proforma final por proyecto (índice único parcial,
-- no bloquea filas con es_proforma_final = false).
CREATE UNIQUE INDEX IF NOT EXISTS documento_proyecto_proforma_final_unique
    ON documento_proyecto (id_proyecto)
    WHERE es_proforma_final = true;
