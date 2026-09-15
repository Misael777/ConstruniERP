-- ----------------------------------------------------------------------------
-- Agrega 'prestamo' al catálogo permitido de `centro_costo.tipo` — a pedido
-- explícito del usuario, para poder crear un Centro de Costo manual de tipo
-- "Préstamo" desde "Nuevo Centro de Costo".
--
-- Verificado con un insert de prueba real contra Supabase (tipo='prestamo',
-- rechazado, ninguna fila llegó a crearse) que la restricción real
-- `centro_costo_tipo_check` SÍ es un CHECK real que bloquea valores no
-- listados — no basta con agregar la opción en el formulario, hay que ampliar
-- esta restricción primero o el guardado falla con "El valor ingresado no
-- cumple una regla de la base de datos".
--
-- Mismo patrón que las migraciones anteriores de esta misma restricción
-- (centro_costo_tipo_bolsa_general_migration.sql, centro_costo_empleado_
-- migration.sql, centro_costo_tipo_subcontratista_migration.sql,
-- centro_costo_vinculacion_migration.sql): DROP + ADD con la lista completa
-- ampliada, sin tocar ninguna fila ya guardada.
-- ----------------------------------------------------------------------------

ALTER TABLE centro_costo DROP CONSTRAINT IF EXISTS centro_costo_tipo_check;

ALTER TABLE centro_costo
    ADD CONSTRAINT centro_costo_tipo_check
    CHECK (tipo IN ('obra', 'consultoria', 'area', 'otro', 'proyecto', 'cliente', 'proveedor', 'empleado', 'bolsa general', 'subcontratista', 'prestamo'));
