-- ============================================================
-- MIGRACIÓN: Nuevo tipo_cuenta 'efectivo' ("Cuenta Efectivo") en cuenta_banco
-- A pedido explícito del usuario: además de las cuentas bancarias reales (corriente/ahorros/
-- plazo_fijo/mancomunada/sueldo), Finanzas → Cuentas Bancarias debe poder registrar una caja chica/
-- fondo de EFECTIVO como "una cuenta más" — hoy eso ya se modelaba informalmente nombrando la cuenta
-- "EFECTIVO_<persona>" en numero_cuenta/titular_cuenta (ver TransaccionModal.svelte,
-- filtrarCuentasEfectivo), pero sin ningún tipo_cuenta que lo distinga de verdad. El formulario (ver
-- cuentaBanco.config.ts) ya exige que numero_cuenta o titular_cuenta contengan la palabra "efectivo"
-- cuando se elige este tipo, y bloquea nombre_banco forzado a "EFECTIVO" — esta migración solo amplía
-- el CHECK de la BD para permitir el nuevo valor.
-- Idempotente: busca dinámicamente el nombre real de la constraint (no se documentó con un nombre fijo
-- en ninguna migración anterior de esta tabla) y la reemplaza — se puede correr más de una vez sin error.
-- ============================================================

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'cuenta_banco'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%tipo_cuenta%'
    LOOP
        EXECUTE format('ALTER TABLE cuenta_banco DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE cuenta_banco
    ADD CONSTRAINT cuenta_banco_tipo_cuenta_check
    CHECK (tipo_cuenta IN ('corriente', 'ahorros', 'plazo_fijo', 'mancomunada', 'sueldo', 'efectivo'));

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
