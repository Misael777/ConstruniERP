-- ============================================================
-- FIX: capture_instance_audit — record_id always NULL
--
-- Root cause: the function read (json ->> 'id') but every audited
-- table uses id_<table_name> as its PK (e.g. id_presupuesto_detalle).
-- Result: record_id = NULL → NOT NULL violation → every INSERT/UPDATE
-- on presupuesto_detalle, cronograma_actividad, etc. crashes.
--
-- Fix:
--   1. Try id_<table_name> (naming convention used in this schema)
--   2. Fallback to 'id' (future-proof)
--   3. RETURN NULL silently if record_id is still NULL (no crash)
-- ============================================================

CREATE OR REPLACE FUNCTION capture_instance_audit()
RETURNS TRIGGER AS $$
DECLARE
    v_project_id BIGINT;
    v_table_name TEXT := TG_TABLE_NAME;
    v_old_json   JSONB;
    v_new_json   JSONB;
    v_row_json   JSONB;
    v_record_id  BIGINT;
    v_actor      UUID;
BEGIN
    BEGIN
        v_actor := auth.uid();
    EXCEPTION WHEN OTHERS THEN
        v_actor := NULL;
    END;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new_json := to_jsonb(NEW); END IF;
    IF TG_OP IN ('DELETE',  'UPDATE') THEN v_old_json := to_jsonb(OLD);  END IF;

    v_row_json := COALESCE(v_new_json, v_old_json);

    -- ── Resolve project_id ─────────────────────────────────────────────────────
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        IF jsonb_exists(v_new_json, 'id_proyecto') THEN
            v_project_id := (v_new_json ->> 'id_proyecto')::BIGINT;
        ELSIF v_table_name = 'presupuesto_detalle' THEN
            SELECT p.id_proyecto INTO v_project_id
            FROM presupuesto p WHERE p.id_presupuesto = NEW.id_presupuesto;
        ELSIF v_table_name = 'valorizacion_partida' THEN
            SELECT vs.id_proyecto INTO v_project_id
            FROM valorizacion_semanal vs WHERE vs.id_valorizacion = NEW.id_valorizacion;
        ELSIF v_table_name = 'cronograma_detalle_semanal' THEN
            SELECT ca.id_proyecto INTO v_project_id
            FROM cronograma_actividad ca WHERE ca.id_cronograma_actividad = NEW.id_cronograma_actividad;
        END IF;
    END IF;

    IF v_project_id IS NULL AND TG_OP IN ('UPDATE', 'DELETE') THEN
        IF jsonb_exists(v_old_json, 'id_proyecto') THEN
            v_project_id := (v_old_json ->> 'id_proyecto')::BIGINT;
        ELSIF v_table_name = 'presupuesto_detalle' THEN
            SELECT p.id_proyecto INTO v_project_id
            FROM presupuesto p WHERE p.id_presupuesto = OLD.id_presupuesto;
        ELSIF v_table_name = 'valorizacion_partida' THEN
            SELECT vs.id_proyecto INTO v_project_id
            FROM valorizacion_semanal vs WHERE vs.id_valorizacion = OLD.id_valorizacion;
        ELSIF v_table_name = 'cronograma_detalle_semanal' THEN
            SELECT ca.id_proyecto INTO v_project_id
            FROM cronograma_actividad ca WHERE ca.id_cronograma_actividad = OLD.id_cronograma_actividad;
        END IF;
    END IF;

    -- No project → nothing to audit
    IF v_project_id IS NULL THEN RETURN NULL; END IF;

    -- ── Resolve record_id ──────────────────────────────────────────────────────
    -- Convention: PK is id_<table_name>.  Fallback: 'id'.
    v_record_id := COALESCE(
        (v_row_json ->> ('id_' || v_table_name))::BIGINT,
        (v_row_json ->> 'id')::BIGINT
    );

    -- Still NULL (unusual PK name) → skip silently, don't crash the caller
    IF v_record_id IS NULL THEN RETURN NULL; END IF;

    -- ── Write audit row ────────────────────────────────────────────────────────
    INSERT INTO instance_audit_log (project_id, table_name, record_id, action, old_data, new_data, changed_by)
    VALUES (v_project_id, v_table_name, v_record_id, TG_OP, v_old_json, v_new_json, v_actor);

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;