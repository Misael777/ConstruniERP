-- ============================================================
-- MIGRACIÓN: distinguir "vinculada" (auth_user_id existe) de "activada" (el empleado
-- ya entró al código OTP y puso su propia contraseña) en el módulo Empleados.
-- ============================================================
-- Hoy, crear un empleado deja auth_user_id lleno de inmediato (con una contraseña temporal
-- generada por el sistema, que el empleado nunca vio) — la pantalla de Empleados mostraba
-- "Vinculada" aunque la persona nunca hubiera iniciado sesión ni completado el flujo de
-- "Configura tu acceso" (código OTP + contraseña propia) del login.
--
-- password_configurado se pone en TRUE recién cuando el empleado termina ese flujo
-- (ver verifyOtpAndSetPassword en login/+page.svelte). Se hace BACKFILL a TRUE para
-- cualquier empleado que YA tenga auth_user_id hoy, asumiendo que si ya está vinculado
-- desde antes de esta migración, ya venía usando el sistema con normalidad — si no se
-- hiciera este backfill, todos los empleados activos existentes aparecerían como
-- "pendientes de activación" de la nada.
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

ALTER TABLE empleados
    ADD COLUMN IF NOT EXISTS password_configurado BOOLEAN NOT NULL DEFAULT false;

UPDATE empleados
    SET password_configurado = true
    WHERE auth_user_id IS NOT NULL AND password_configurado = false;

NOTIFY pgrst, 'reload schema';
