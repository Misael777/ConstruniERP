-- ============================================================
-- FIX v2: capture_instance_audit sigue fallando al eliminar un proyecto
--
-- v1 (fix_audit_trigger_proyecto_delete.sql, primera versión) asumía que el
-- trigger corría directo sobre `proyecto` — verificado en DER2.sql que NO es
-- así: no existe ningún trg_audit_* sobre `proyecto` mismo. El error real
-- viene de las TABLAS HIJAS (cronograma_actividad, restriccion,
-- seguimiento_proyecto, lookahead, valorizacion_partida, metrado,
-- egreso_semanal, cuentas_pagar/cobrar, cobros, pagos — todas con
-- ON DELETE CASCADE hacia proyecto Y su propio trg_audit_* AFTER DELETE): al
-- borrar el proyecto, Postgres cascada el DELETE hacia esas filas hijas ANTES
-- de que la fila de `proyecto` termine de eliminarse del todo, así que cuando
-- el trigger de auditoría de la tabla hija intenta insertar
-- (project_id = el id del proyecto que se está borrando en la MISMA
-- sentencia), esa fila de `proyecto` ya no está disponible para satisfacer el
-- FK — mismo síntoma, pero disparado por cualquiera de estas tablas hijas, no
-- por `proyecto` directamente.
--
-- Fix real (más general, cubre esto y cualquier caso futuro parecido): la
-- auditoría es "best effort" por naturaleza — un fallo al escribir el log NUNCA
-- debe poder bloquear la operación real que está observando. Se envuelve el
-- INSERT final en su propio BEGIN/EXCEPTION: si falla por lo que sea
-- (violación de FK u otra cosa), se traga el error y se sigue, en vez de
-- propagarlo hacia arriba y abortar la transacción del llamador.
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
    -- "Best effort": si esto falla (ej. el proyecto referenciado ya no existe
    -- porque estamos en medio de un DELETE en cascada que lo está borrando en
    -- la misma sentencia), se ignora el error y se continúa — un log de
    -- auditoría nunca debe poder tumbar la operación real que intenta registrar.
    BEGIN
        INSERT INTO instance_audit_log (project_id, table_name, record_id, action, old_data, new_data, changed_by)
        VALUES (v_project_id, v_table_name, v_record_id, TG_OP, v_old_json, v_new_json, v_actor);
    EXCEPTION WHEN OTHERS THEN
        NULL; -- no-op: se descarta el error de auditoría a propósito
    END;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
