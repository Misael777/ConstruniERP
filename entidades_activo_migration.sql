-- ============================================================
-- MIGRACIÓN: agrega `activo` a las tablas donde `estado` YA significa otra cosa (workflow, no
-- activo/inactivo) — a pedido del usuario, todas las entidades del ERP necesitan un flag de "dado de
-- baja" independiente para poder ocultarlas de las listas y mostrarlas solo en la sección
-- "Eliminados" (solo-admin). No se puede reusar `estado` acá sin romper su significado actual:
--   - cuentas_pagar.estado / cuentas_cobrar.estado: 'pendiente' | 'vencido' | 'pagado'
--   - cuenta_banco.estado: CHECK ('activa' | 'inactiva' | 'autorizada' | 'no_autorizada')
--
-- El resto de las entidades (cliente, proyecto, proveedor, empleados, centro_costo) YA tienen una
-- columna estado/estado_proyecto libre con el valor 'baja' para esto — no necesitan migración.
--
-- DEFAULT true aplica también a las filas existentes al agregar la columna (Postgres backfillea solo,
-- no hace falta un UPDATE aparte).
--
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

ALTER TABLE cuentas_pagar ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE cuentas_cobrar ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE cuenta_banco ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true;

NOTIFY pgrst, 'reload schema';
