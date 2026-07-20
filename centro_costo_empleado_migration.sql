-- ============================================================
-- MIGRACIÓN: Vinculación de centro_costo con Empleado
-- Mismo patrón que centro_costo_vinculacion_migration.sql (proyecto/cliente/
-- proveedor) — agrega la cuarta entidad vinculable: empleado. Un centro de
-- costo sigue estando vinculado a como máximo UNA entidad (o ninguna, para
-- los "obra"/"consultoria"/"bolsa general" creados a mano).
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

ALTER TABLE centro_costo
    ADD COLUMN IF NOT EXISTS id_empleado BIGINT REFERENCES empleados(id) ON DELETE CASCADE;

-- Reemplaza el CHECK "una sola entidad" para incluir id_empleado.
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_centro_costo_una_entidad'
    ) THEN
        ALTER TABLE centro_costo DROP CONSTRAINT chk_centro_costo_una_entidad;
    END IF;
    ALTER TABLE centro_costo
        ADD CONSTRAINT chk_centro_costo_una_entidad
        CHECK (num_nonnulls(id_proyecto, id_cliente, id_proveedor, id_empleado) <= 1);
END $$;

-- Como mucho un centro de costo por empleado (evita duplicados del
-- "getOrCrear" si dos llamadas casi simultáneas intentan crearlo).
CREATE UNIQUE INDEX IF NOT EXISTS uq_centro_costo_empleado ON centro_costo(id_empleado) WHERE id_empleado IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_centro_costo_id_empleado ON centro_costo(id_empleado);

-- Amplía el CHECK de `tipo` para permitir 'empleado' (además de los valores ya
-- existentes). Busca y reemplaza CUALQUIER CHECK existente sobre `tipo` sin
-- depender de su nombre exacto, mismo motivo que la migración anterior.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'centro_costo'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%tipo%'
    LOOP
        EXECUTE format('ALTER TABLE centro_costo DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE centro_costo
    ADD CONSTRAINT centro_costo_tipo_check
    CHECK (tipo IN ('obra', 'consultoria', 'bolsa general', 'area', 'otro', 'proyecto', 'cliente', 'proveedor', 'empleado'));

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
