-- Agrega la columna empleados.estado ('activo' | 'baja') — a pedido del usuario: al dar de baja un
-- empleado (acción "Dar de baja" en iam/empleados, vía la Edge Function user-admin) también se
-- bloquea su acceso (ban en Supabase Auth) y se da de baja el centro de costo que se generó para él
-- (ver darDeBajaEmpleado en supabase/functions/user-admin/index.ts). Reemplaza al botón "Eliminar"
-- (borrado real, que también eliminaba la cuenta de Auth) que existía antes.
--
-- Idempotente: se puede correr más de una vez sin error.

ALTER TABLE empleados
    ADD COLUMN IF NOT EXISTS estado VARCHAR(10) NOT NULL DEFAULT 'activo';

UPDATE empleados SET estado = 'activo' WHERE estado IS NULL;

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'empleados'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%estado%'
    LOOP
        EXECUTE format('ALTER TABLE empleados DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE empleados
    ADD CONSTRAINT empleados_estado_check
    CHECK (estado IN ('activo', 'baja'));

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
