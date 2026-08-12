-- Agrega la columna cliente.estado ('activo' | 'baja') — a pedido del usuario: al dar de baja un
-- cliente (ver darDeBajaCliente en aprobaciones.service.ts) también se debe dar de baja el centro de
-- costo que se generó para él (ver darDeBajaCentroCostoDeEntidad en centroCostos.service.ts, ya
-- genérico por tipo — este es el mismo patrón que centro_costo_estado_migration.sql/darDeBajaVenta
-- ya usan para proyecto). Reemplaza al botón "Eliminar" (borrado real) en ClientesTable.svelte.
--
-- Idempotente: se puede correr más de una vez sin error.

ALTER TABLE cliente
    ADD COLUMN IF NOT EXISTS estado VARCHAR(10) NOT NULL DEFAULT 'activo';

UPDATE cliente SET estado = 'activo' WHERE estado IS NULL;

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'cliente'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%estado%'
    LOOP
        EXECUTE format('ALTER TABLE cliente DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE cliente
    ADD CONSTRAINT cliente_estado_check
    CHECK (estado IN ('activo', 'baja'));

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
