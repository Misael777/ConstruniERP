-- ============================================================
-- MIGRACIÓN: visto_por_solicitante en solicitud_aprobacion
-- El solicitante (asesor) ahora ve el estado de sus propias solicitudes en su
-- campanita. Esta columna indica si YA revisó la resolución (aprobado/rechazado)
-- de una solicitud suya — independiente de `estado`, que solo dice
-- pendiente/aprobado/rechazado. Se usa para el badge de "no leídas" del
-- solicitante, igual que `estado='pendiente'` se usa para el badge del admin.
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

ALTER TABLE solicitud_aprobacion
    ADD COLUMN IF NOT EXISTS visto_por_solicitante BOOLEAN NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
