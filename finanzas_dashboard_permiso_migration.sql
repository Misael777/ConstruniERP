-- ============================================================
-- MIGRACIÓN: Nuevo permiso 'ver_finanzas_dashboard'
-- El panel financiero (KPIs, grafo de nodos, flujo de caja con proyección, viabilidad por centro de
-- costo) que antes vivía en el módulo top-level "Dashboard" (`/dashboard`) se movió a ser un sub-ítem
-- de Finanzas ("Dashboard Finanzas", `/finanzas/dashboard`, ver MODULE_REGISTRY en modules.ts) — a
-- pedido explícito del usuario. Necesita su propio permiso, independiente de `ver_finanzas` (el
-- módulo) y de `ver_dashboard` (que ahora es la nueva landing de anuncios corporativos, contenido
-- completamente distinto).
-- Idempotente: ambos INSERT usan ON CONFLICT DO NOTHING, se puede correr más de una vez sin error.
-- ============================================================

INSERT INTO permisos (nombre, descripcion) VALUES
	('ver_finanzas_dashboard', 'Ver Dashboard Finanzas')
ON CONFLICT (nombre) DO NOTHING;

-- Igual que backfill_permisos_administrador_migration.sql: el rol 'administrador' recibe automáticamente
-- cualquier permiso nuevo (no es un trigger, hay que insertarlo a mano cada vez que se crea uno).
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r, permisos p
WHERE r.nombre = 'administrador'
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
