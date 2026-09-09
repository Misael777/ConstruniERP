-- ============================================================
-- MIGRACIÓN: solicitud de aprobación para "Quitar aprobación" de Transacciones
--
-- A pedido explícito del usuario: editar/eliminar una transacción ya aprobada dejó de resolverse con
-- un botón instantáneo (isAdmin() + un confirm() del navegador, sin ningún reviewer real) — ahora un
-- usuario sin rango de administrador manda una solicitud (visible en la campanita de notificaciones,
-- igual que Ventas) y un administrador real la aprueba/rechaza desde su propia sesión. Al aprobarla se
-- corre exactamente desaprobarTransaccion (mismo efecto que el botón de hoy) — ver aprobaciones.service.ts.
--
-- Agrega 'transaccion' a tipo_entidad y 'quitar_aprobacion' a tipo_accion. Sin columnas nuevas:
-- descripcion_entidad (ya existe) alcanza para identificar la transacción, y no hace falta
-- payload_cambios porque esta solicitud no aplica un diff de campos, solo pide el desbloqueo.
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
    CHECK (tipo_entidad IN ('cliente', 'proyecto', 'exportacion', 'transaccion'));

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
    CHECK (tipo_accion IN ('editar', 'eliminar', 'cerrar_venta', 'exportar', 'quitar_aprobacion'));

NOTIFY pgrst, 'reload schema';
