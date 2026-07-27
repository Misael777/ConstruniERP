-- ============================================================
-- MIGRACIÓN: Vinculación real de centro_costo con Proyecto / Cliente / Proveedor
-- Reemplaza la columna "id_referencia" que NuevaVentaModal.svelte intentaba usar
-- (nunca existió en la BD real — el upsert fallaba en silencio) por tres FKs
-- explícitas, una por tipo de entidad. Un centro de costo está vinculado a
-- como máximo UNA entidad (o ninguna, para los "área"/"otro" creados a mano).
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

ALTER TABLE centro_costo
    ADD COLUMN IF NOT EXISTS id_proyecto  BIGINT REFERENCES proyecto(id_proyecto)   ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS id_cliente   BIGINT REFERENCES cliente(id_cliente)     ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS id_proveedor BIGINT REFERENCES proveedor(id_proveedor) ON DELETE CASCADE;

-- Un centro de costo vinculado a una entidad lo está a UNA sola.
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_centro_costo_una_entidad'
    ) THEN
        ALTER TABLE centro_costo
            ADD CONSTRAINT chk_centro_costo_una_entidad
            CHECK (num_nonnulls(id_proyecto, id_cliente, id_proveedor) <= 1);
    END IF;
END $$;

-- Como mucho un centro de costo por proyecto/cliente/proveedor (evita duplicados del
-- "getOrCrear" si dos pestañas/usuarios crean la entidad casi al mismo tiempo).
CREATE UNIQUE INDEX IF NOT EXISTS uq_centro_costo_proyecto  ON centro_costo(id_proyecto)  WHERE id_proyecto  IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_centro_costo_cliente   ON centro_costo(id_cliente)   WHERE id_cliente   IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_centro_costo_proveedor ON centro_costo(id_proveedor) WHERE id_proveedor IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_centro_costo_id_proyecto  ON centro_costo(id_proyecto);
CREATE INDEX IF NOT EXISTS idx_centro_costo_id_cliente   ON centro_costo(id_cliente);
CREATE INDEX IF NOT EXISTS idx_centro_costo_id_proveedor ON centro_costo(id_proveedor);

-- Amplía el CHECK de `tipo` para permitir 'proyecto' / 'cliente' / 'proveedor' (además de los
-- valores manuales existentes: obra, consultoria, area, otro). Busca y reemplaza CUALQUIER CHECK
-- existente sobre la columna `tipo` sin depender de su nombre exacto — DER2.sql y la BD real ya
-- han mostrado desviarse entre sí en esta tabla (ver notas en centroCostos.config.ts), así que no
-- se asume un nombre de constraint fijo.
-- OJO: la lista de valores de abajo incluye TAMBIÉN 'empleado' y 'bolsa general' — agregados por
-- centro_costo_empleado_migration.sql y centro_costo_tipo_bolsa_general_migration.sql
-- respectivamente. Esta migración es la MÁS VIEJA de las tres; si se corre DESPUÉS de esas dos
-- (ej. al re-ejecutar todo el set de migraciones, o simplemente fuera de orden) y su lista se
-- quedara solo con los valores originales, el ALTER TABLE... ADD CONSTRAINT de acá fallaría con
-- "check constraint is violated by some row" contra los centros de costo de tipo empleado/bolsa
-- general que ya existen — exactamente el mismo bug que tenía la migración de bolsa_general antes
-- de corregirla. Se mantiene aquí la lista COMPLETA para que las tres migraciones sigan siendo
-- seguras de correr en cualquier orden/repetidamente, tal como promete el header de este archivo.
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
    CHECK (tipo IN ('obra', 'consultoria', 'area', 'otro', 'proyecto', 'cliente', 'proveedor', 'empleado', 'bolsa general'));

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
