-- Ticket #32 (ver Documentacion/tests/README.md): dos cuentas bancarias activas con el mismo numero_cuenta
-- comparten transacciones y saldo (fn_recalcular_saldo_cuenta_banco y las transacciones enlazan por ese texto) y
-- rompen los desplegables de Cuenta origen/destino. En Producción existen dos cajas con numero_cuenta 'EFECTIVO'
-- (GUILLERMO y WILLY), así que este índice SOLO se crea si ya no hay duplicados entre las cuentas activas: primero
-- hay que renombrar una de las dos (ej. 'EFECTIVO WILLY') desde Finanzas > Cuentas Bancarias y, recién entonces,
-- volver a aplicar esta migración. Mientras tanto la app ya rechaza crear/editar duplicados (cuentaBanco.service.ts).
-- Idempotente y no modifica ninguna fila.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM cuenta_banco WHERE activo = true GROUP BY numero_cuenta HAVING COUNT(*) > 1
    ) THEN
        RAISE NOTICE 'cuenta_banco: hay numero_cuenta duplicados entre cuentas activas; no se crea el indice unico hasta corregirlos.';
    ELSE
        CREATE UNIQUE INDEX IF NOT EXISTS uq_cuenta_banco_numero_activa ON cuenta_banco (numero_cuenta) WHERE activo = true;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
