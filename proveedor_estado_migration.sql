-- Agrega la columna proveedor.estado ('activo' | 'baja') — a pedido del usuario: al dar de baja un
-- proveedor también se debe dar de baja el centro de costo que se generó para él (ver
-- darDeBajaCentroCostoDeEntidad en centroCostos.service.ts, ya genérico por tipo). Reemplaza al
-- botón "Eliminar" (borrado real) en ProveedoresTable.svelte.
--
-- Idempotente: se puede correr más de una vez sin error.

ALTER TABLE proveedor
    ADD COLUMN IF NOT EXISTS estado VARCHAR(10) NOT NULL DEFAULT 'activo';

UPDATE proveedor SET estado = 'activo' WHERE estado IS NULL;

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'proveedor'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%estado%'
    LOOP
        EXECUTE format('ALTER TABLE proveedor DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE proveedor
    ADD CONSTRAINT proveedor_estado_check
    CHECK (estado IN ('activo', 'baja'));

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
