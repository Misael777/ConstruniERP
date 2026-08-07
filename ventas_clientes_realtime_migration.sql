-- ============================================================
-- MIGRACIÓN: habilita Supabase Realtime para proyecto (Ventas) y cliente (Clientes)
--
-- Mismo mecanismo que solicitud_aprobacion_realtime_migration.sql, aplicado ahora a las tablas de
-- Ventas y Clientes — a pedido del usuario: la tabla de cada módulo se refresca sola apenas cambia
-- algo en la base de datos (otro usuario crea/edita/cierra una venta, aprueba un cliente nuevo, etc.),
-- sin depender de que el usuario recargue la página o vuelva a hacer clic.
--
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

ALTER TABLE proyecto REPLICA IDENTITY FULL;
ALTER TABLE cliente REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'proyecto'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE proyecto;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'cliente'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE cliente;
    END IF;
END $$;
