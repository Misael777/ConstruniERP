-- ============================================================
-- MIGRACIÓN: campos de "Características del proyecto" (Consultoría: Tipo de
-- proyecto, Estado del predio, Tipo de edificación; Obra: Tipo de
-- Intervención, Tipo de edificación) aceptan VARIAS alternativas a la vez
-- (checkboxes en NuevaVentaModal.svelte, a pedido del usuario) — se guardan
-- como letras unidas por "+", ej. "L+O", "A+N+R", "M+I". Ensancha las 5
-- columnas para que quepa cualquier combinación:
--
-- tip_proyecto: ya era VARCHAR(10) (ver proyecto_caracteristicas_obra_migration.sql,
-- que la ensanchó para la opción fija "DF + I" de 6 caracteres). Con las 5
-- opciones actuales (L, O, DF, I, EMS) TODAS marcadas a la vez, el código
-- combinado "L+O+DF+I+EMS" mide 12 caracteres — ya no entra en VARCHAR(10).
-- Se ensancha a VARCHAR(30) con margen para futuras opciones.
--
-- estado_predio: seguía en VARCHAR(4) (nunca se había ensanchado). Con las 5
-- opciones actuales (A, N, R, DP, DT) todas marcadas, "A+N+R+DP+DT" mide 11
-- caracteres — ya no entra en VARCHAR(4). Se ensancha a VARCHAR(20).
--
-- tipo_edifica (Consultoría): también seguía en VARCHAR(4). Con las 8
-- opciones actuales (M, U, C, I, OF, E, S, MX) todas marcadas,
-- "M+U+C+I+OF+E+S+MX" mide 17 caracteres. Se ensancha a VARCHAR(30).
--
-- tipo_intervencion (Obra): era VARCHAR(10) (ver proyecto_caracteristicas_obra_migration.sql).
-- Con las 5 opciones actuales (N, A, R, DP, DT) todas marcadas,
-- "N+A+R+DP+DT" mide 11 caracteres — ya no entra en VARCHAR(10). Se
-- ensancha a VARCHAR(20).
--
-- tipo_edificacion_obra (Obra): también era VARCHAR(10). Con las 8 opciones
-- actuales (M, U, X, I, OF, E, S, MX) todas marcadas, "M+U+X+I+OF+E+S+MX"
-- mide 17 caracteres. Se ensancha a VARCHAR(30).
--
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

ALTER TABLE proyecto
    ALTER COLUMN tip_proyecto TYPE VARCHAR(30);

ALTER TABLE proyecto
    ALTER COLUMN estado_predio TYPE VARCHAR(20);

ALTER TABLE proyecto
    ALTER COLUMN tipo_edifica TYPE VARCHAR(30);

ALTER TABLE proyecto
    ALTER COLUMN tipo_intervencion TYPE VARCHAR(20);

ALTER TABLE proyecto
    ALTER COLUMN tipo_edificacion_obra TYPE VARCHAR(30);

NOTIFY pgrst, 'reload schema';
