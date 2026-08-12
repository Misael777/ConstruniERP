-- Agrega la columna centro_costo.estado ('activo' | 'baja') — a pedido del usuario: al dar de baja
-- un proyecto/venta cerrada (ver darDeBajaVenta en aprobaciones.service.ts) el centro de costo que
-- se generó para ese proyecto debe quedar marcado como inactivo también. Mismo patrón pensado para
-- extenderse más adelante a empleado/cliente/proveedor cuando esas entidades tengan su propio
-- "dar de baja" (ver darDeBajaCentroCostoDeEntidad en centroCostos.service.ts, ya genérico por tipo).
--
-- Activa además el soft-delete que centroCostos.config.ts ya tenía preparado (DELETE_STRATEGY):
-- ahora que existe una columna de estado real, "Eliminar" sobre un centro de costo creado a mano
-- (sin vínculo a ninguna entidad) pasa a anularlo (estado='baja') en vez de borrarlo de verdad. Los
-- vinculados a proyecto/cliente/proveedor/empleado siguen sin poder eliminarse/anularse a mano desde
-- ahí (ver el chequeo `entidadVinculada` en deleteCentroCosto) — su estado solo lo cambia la entidad
-- dueña.
--
-- Idempotente: se puede correr más de una vez sin error.

-- Limpieza: alguien creó a mano una columna "Estado" (con mayúscula, entre comillas) desde el editor
-- de tablas de Supabase — en Postgres eso es una columna DISTINTA de `estado` (minúscula, la que usa
-- todo el código de la app), y quedó vacía (null en todas las filas) porque nada le escribe ahí. Se
-- borra antes de crear la columna correcta para no dejar un campo fantasma sin uso.
ALTER TABLE centro_costo
    DROP COLUMN IF EXISTS "Estado";

ALTER TABLE centro_costo
    ADD COLUMN IF NOT EXISTS estado VARCHAR(10) NOT NULL DEFAULT 'activo';

-- Filas existentes (creadas antes de esta columna) quedan 'activo' — ya lo cubre el DEFAULT de
-- arriba para filas nuevas; este UPDATE solo cubre las que ya existían.
UPDATE centro_costo SET estado = 'activo' WHERE estado IS NULL;

-- Mismo patrón dinámico de las migraciones anteriores de este archivo (no asume el nombre exacto
-- del constraint, por si ya existiera uno con otro nombre de una corrida previa).
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'centro_costo'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%estado%'
    LOOP
        EXECUTE format('ALTER TABLE centro_costo DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE centro_costo
    ADD CONSTRAINT centro_costo_estado_check
    CHECK (estado IN ('activo', 'baja'));

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
