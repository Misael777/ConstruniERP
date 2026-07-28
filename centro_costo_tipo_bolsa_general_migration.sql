-- Agrega 'bolsa general' a los valores permitidos de centro_costo.tipo (además de los ya
-- existentes: obra, consultoria, area, otro, proyecto, cliente, proveedor, empleado — ver
-- centro_costo_vinculacion_migration.sql y centro_costo_empleado_migration.sql). El dropdown de
-- "Nuevo Centro de Costo" ahora solo ofrece Obra/Consultoría/Bolsa General para elegir a mano (ver
-- centroCostos.config.ts, campo `tipo`.formOptions), pero la BD sigue aceptando los demás valores
-- para no romper filas existentes ni los tipos automáticos (proyecto/cliente/proveedor/empleado).
-- Mismo patrón dinámico que la migración anterior: no asume el nombre exacto del constraint.
-- OJO: la primera versión de este archivo omitía 'empleado' en la lista de abajo — como ya
-- existían centros de costo reales con tipo='empleado' (uno por cada empleado creado), el ALTER
-- TABLE ... ADD CONSTRAINT fallaba con "check constraint is violated by some row" al intentar
-- correrla. Corregido agregando 'empleado' a la lista.
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
