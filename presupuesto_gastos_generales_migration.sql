-- presupuesto_gastos_generales_migration.sql
--
-- Adds the "Gastos Generales %" field used by the Presupuesto/Partidas tab
-- footer (Costo Directo + Gastos Generales = Presupuesto Total), matching
-- the classic "Presupuesto de Obra por Partidas" spreadsheet format.
--
-- Run this once in the Supabase SQL editor.

ALTER TABLE presupuesto
	ADD COLUMN IF NOT EXISTS gastos_generales_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
