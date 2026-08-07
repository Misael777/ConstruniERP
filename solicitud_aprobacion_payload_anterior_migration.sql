-- ============================================================
-- MIGRACIÓN: guarda el valor ANTERIOR de cada campo junto al propuesto (payload_cambios) en una
-- solicitud de tipo 'editar' — a pedido del usuario: la campanita debe resaltar/pintar cuáles campos
-- realmente cambian, no solo listar el registro afectado. payload_cambios ya traía SIEMPRE el
-- formulario completo (no solo lo modificado), así que sin un snapshot del valor previo no había forma
-- de saber cuáles de esos campos son un cambio real vs. cuáles quedaron igual.
--
-- Nullable y sin backfill: las solicitudes 'editar' ya resueltas/pendientes antes de este cambio
-- simplemente no tendrán payload_anterior (la campanita cae de vuelta a mostrar el campo sin resaltar,
-- ver NotificacionesBell.svelte).
--
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

ALTER TABLE solicitud_aprobacion
    ADD COLUMN IF NOT EXISTS payload_anterior JSONB;

NOTIFY pgrst, 'reload schema';
