-- ============================================================
-- MIGRACIÓN: exportación gateada + avisos informativos de cierre de venta
--
-- 1) Agrega 'exportar' a tipo_accion y 'exportacion' a tipo_entidad — para la nueva solicitud de
--    aprobación del botón "Exportar" del módulo de Ventas. Una exportación no apunta a una fila
--    puntual (cliente/proyecto), así que id_entidad pasa a ser NULLABLE.
-- 2) Agrega visto_por_admin — igual que visto_por_solicitante pero para el lado admin: marca si YA
--    se revisó el aviso informativo de "un asesor cerró esta venta directo" (tipo_accion='cerrar_venta'
--    con estado='aprobado' resuelto por el propio solicitante, ver aprobaciones.service.ts). No aplica
--    a las solicitudes pendientes normales (esas ya usan estado='pendiente' como su propio "no visto").
--
-- Defensivo: no asume el nombre exacto de los CHECK constraints existentes (ya hubo drift entre los
-- .sql locales y la BD real en este proyecto) — los busca por definición antes de reemplazarlos.
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'solicitud_aprobacion'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%tipo_entidad%'
    LOOP
        EXECUTE format('ALTER TABLE solicitud_aprobacion DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE solicitud_aprobacion
    ADD CONSTRAINT solicitud_aprobacion_tipo_entidad_check
    CHECK (tipo_entidad IN ('cliente', 'proyecto', 'exportacion'));

DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'solicitud_aprobacion'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%tipo_accion%'
    LOOP
        EXECUTE format('ALTER TABLE solicitud_aprobacion DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE solicitud_aprobacion
    ADD CONSTRAINT solicitud_aprobacion_tipo_accion_check
    CHECK (tipo_accion IN ('editar', 'eliminar', 'cerrar_venta', 'exportar'));

ALTER TABLE solicitud_aprobacion ALTER COLUMN id_entidad DROP NOT NULL;

ALTER TABLE solicitud_aprobacion
    ADD COLUMN IF NOT EXISTS visto_por_admin BOOLEAN NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
