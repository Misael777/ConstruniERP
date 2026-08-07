-- ============================================================
-- MIGRACIÓN: habilita Supabase Realtime para solicitud_aprobacion
--
-- Reemplaza el polling agresivo (cada 1-5s) por notificaciones empujadas por el propio Postgres vía
-- websocket — apenas se inserta/actualiza una fila (nueva solicitud, aprobación, rechazo), TODOS los
-- clientes conectados (NotificacionesBell.svelte) se enteran al instante, sin tener que preguntar
-- "¿hay algo nuevo?" cada tanto. El polling queda como respaldo cada 60s por si el websocket se cae
-- (red inestable, el dispositivo estuvo dormido, etc.) — no es el mecanismo principal.
--
-- REPLICA IDENTITY FULL: sin esto, los eventos de UPDATE que manda Realtime solo incluyen las
-- columnas que cambiaron (no la fila completa) — como la app necesita comparar el `estado` completo
-- de la fila para la detección de flanco, hace falta la fila completa en cada evento.
--
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

ALTER TABLE solicitud_aprobacion REPLICA IDENTITY FULL;

-- ALTER PUBLICATION ... ADD TABLE falla si la tabla ya está agregada — se envuelve en un chequeo para
-- poder correr esta migración más de una vez sin error, mismo criterio defensivo que el resto de las
-- migraciones de este proyecto.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'solicitud_aprobacion'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE solicitud_aprobacion;
    END IF;
END $$;
