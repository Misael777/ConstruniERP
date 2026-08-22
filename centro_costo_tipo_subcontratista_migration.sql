-- ============================================================
-- MIGRACIÓN: tipo 'subcontratista' en centro_costo
-- A pedido explícito del usuario: un proveedor cuyo campo "Producto y Servicio" (columna
-- `proveedor.vendedor`) sea exactamente 'SUBCONTRATISTA - OBRA' debe clasificarse, en su centro de
-- costo vinculado (pestaña "Cuentas Internas"), con tipo='subcontratista' en vez de 'proveedor' — para
-- que el selector "Clase" de Nueva/Editar Transacción (ver TransaccionModal.svelte) pueda filtrar
-- Proveedores y Subcontratistas como listas separadas de verdad.
-- Amplía el CHECK de `tipo` (mismo patrón dinámico que las migraciones anteriores de esta columna: no
-- asume el nombre exacto del constraint) y hace el backfill retroactivo de los proveedores ya
-- registrados con ese valor. Idempotente: se puede correr más de una vez sin error.
-- ============================================================

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
    CHECK (tipo IN ('obra', 'consultoria', 'area', 'otro', 'proyecto', 'cliente', 'proveedor', 'empleado', 'bolsa general', 'subcontratista'));

-- Backfill: proveedores ya registrados con "Producto y Servicio" = 'SUBCONTRATISTA - OBRA'.
UPDATE centro_costo
SET tipo = 'subcontratista'
WHERE tipo = 'proveedor'
  AND id_proveedor IN (SELECT id_proveedor FROM proveedor WHERE vendedor = 'SUBCONTRATISTA - OBRA');

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
