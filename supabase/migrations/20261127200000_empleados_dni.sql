-- Columna DNI de empleados (IAM). La función user-admin (crear/editar empleado) y la app ya la usan, pero el script
-- empleados_dni_migration.sql de la raíz nunca se corrió: editar un empleado fallaba con "Could not find the 'dni'
-- column of 'empleados' in the schema cache" (la clienta no podía cambiarse de cargo, 27/11/2026).
-- Columna nueva y nula: no modifica datos existentes. Idempotente.

ALTER TABLE public.empleados ADD COLUMN IF NOT EXISTS dni varchar(15);

NOTIFY pgrst, 'reload schema';
