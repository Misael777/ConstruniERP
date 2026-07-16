-- restriccion_origen_migration.sql
--
-- Lets a restricción act as a wait-condition tied to another activity's end
-- event, not just a standalone constraint: `id_cronograma_actividad` (ya
-- existente) sigue siendo la actividad cuyo inicio se restringe; esta nueva
-- columna es, opcionalmente, la actividad cuyo FIN satisface esa restricción
-- (se arrastra de una barra a otra en el Gantt para setearla). Si es NULL,
-- la restricción sigue siendo externa/manual como hasta ahora.
--
-- Run this once in the Supabase SQL editor.

ALTER TABLE restriccion
	ADD COLUMN IF NOT EXISTS id_actividad_origen BIGINT REFERENCES cronograma_actividad(id_cronograma_actividad) ON DELETE SET NULL;
