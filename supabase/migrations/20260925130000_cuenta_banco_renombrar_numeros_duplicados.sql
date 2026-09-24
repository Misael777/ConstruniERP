-- Ticket #32: en Producción hay dos cajas de efectivo con numero_cuenta = 'EFECTIVO' (GUILLERMO, id 10, y WILLY,
-- id 16). Como las transacciones se enlazan con la cuenta por ese texto (cuente_origen/cuente_destino), las dos
-- comparten transacciones y saldo. Esta migración da a cada cuenta ACTIVA repetida (salvo la más antigua de cada
-- grupo) un número único '<numero>-<id>' — para las cajas: 'EFECTIVO-16' — recalcula sus saldos y, ya sin
-- duplicados, crea el índice único.
--
-- OJO, decisión implícita: las transacciones que ya apuntan a 'EFECTIVO' (hoy solo la #259, ingreso de 25 000)
-- quedan con la cuenta MÁS ANTIGUA (GUILLERMO). Si en realidad eran de WILLY, basta cambiar cuente_destino de esa
-- transacción a 'EFECTIVO-16' y recalcular; no hay pérdida de datos.
--
-- Idempotente: sin duplicados no hace nada. Solo cambia numero_cuenta de las cuentas repetidas.

DO $$
DECLARE
    r RECORD;
    v_nuevo TEXT;
BEGIN
    FOR r IN
        SELECT id_cuenta_banco, numero_cuenta
        FROM (
            SELECT id_cuenta_banco, numero_cuenta,
                   ROW_NUMBER() OVER (PARTITION BY numero_cuenta ORDER BY id_cuenta_banco) AS rn
            FROM cuenta_banco WHERE activo = true
        ) t
        WHERE t.rn > 1
    LOOP
        v_nuevo := left(r.numero_cuenta, 30 - length('-' || r.id_cuenta_banco::text)) || '-' || r.id_cuenta_banco::text;
        UPDATE cuenta_banco SET numero_cuenta = v_nuevo WHERE id_cuenta_banco = r.id_cuenta_banco;
        PERFORM fn_recalcular_saldo_cuenta_banco(v_nuevo);
        PERFORM fn_recalcular_saldo_cuenta_banco(r.numero_cuenta); -- la cuenta que conserva el número original
        RAISE NOTICE 'cuenta_banco #%: numero_cuenta % -> %', r.id_cuenta_banco, r.numero_cuenta, v_nuevo;
    END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cuenta_banco_numero_activa ON cuenta_banco (numero_cuenta) WHERE activo = true;

NOTIFY pgrst, 'reload schema';
