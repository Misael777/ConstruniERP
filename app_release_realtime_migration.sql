-- ----------------------------------------------------------------------------
-- Habilita Realtime en app_release — a pedido explícito del usuario: hoy hay
-- que reiniciar la app para enterarse de una versión nueva, porque
-- ActualizacionBell.svelte solo revisaba una vez al abrir la app (onMount).
-- Mismo criterio que ticket_module_migration.sql (sección 6) — para que el
-- ícono de actualización pueda suscribirse a inserts en vivo, sin depender
-- solo del polling de respaldo.
-- ----------------------------------------------------------------------------

ALTER TABLE app_release REPLICA IDENTITY FULL;

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_publication_tables
		WHERE pubname = 'supabase_realtime' AND tablename = 'app_release'
	) THEN
		ALTER PUBLICATION supabase_realtime ADD TABLE app_release;
	END IF;
END $$;

NOTIFY pgrst, 'reload schema';
