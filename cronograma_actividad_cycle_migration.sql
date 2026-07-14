-- cronograma_actividad_cycle_migration.sql
--
-- cronograma_actividad.id_actividad_padre had no cycle protection at all
-- (unlike partida.id_partida_padre, which already has check_partida_cycle()/
-- trg_check_partida_cycle — see DER2.sql / DB_reset_withoutacces.sql). This
-- mirrors that exact pattern for the schedule's own hierarchy, which the
-- Gantt rewrite now relies on more heavily (rollup, block-move).
--
-- Run this once in the Supabase SQL editor.

CREATE OR REPLACE FUNCTION check_cronograma_actividad_cycle() RETURNS TRIGGER AS $$
DECLARE
    v_parent BIGINT := NEW.id_actividad_padre;
BEGIN
    IF NEW.id_cronograma_actividad = NEW.id_actividad_padre THEN
        RAISE EXCEPTION 'Una actividad no puede ser su propio padre';
    END IF;
    WHILE v_parent IS NOT NULL LOOP
        IF v_parent = NEW.id_cronograma_actividad THEN
            RAISE EXCEPTION 'Ciclo detectado en jerarquía de cronograma_actividad';
        END IF;
        SELECT id_actividad_padre INTO v_parent FROM cronograma_actividad WHERE id_cronograma_actividad = v_parent;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_cronograma_actividad_cycle ON cronograma_actividad;

CREATE TRIGGER trg_check_cronograma_actividad_cycle
BEFORE INSERT OR UPDATE ON cronograma_actividad
FOR EACH ROW EXECUTE FUNCTION check_cronograma_actividad_cycle();
