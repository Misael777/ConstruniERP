-- Backfill que acompaña a 20260925000000 (H6: el saldo de una cuenta por cobrar sale de SUS PROPIOS cobros).
--
-- Antes de H6, monto_cobrado salía de TODOS los ingresos activos hacia el centro de costo de la cuenta, así
-- que en Producción los ingresos reales (adelantos y demás transacciones) nunca se registraron como filas de
-- `cobros`: las cuentas por cobrar existentes tenían 0 cobros propios aunque ya habían recibido plata. Sin este
-- backfill, aplicar H6 dejaría todas esas cuentas "sin cobrar" de un día para otro.
--
-- Regla: cada transacción de ingreso activa hacia un centro de costo que tenga EXACTAMENTE UNA cuenta por
-- cobrar activa (no de préstamo) y que todavía no esté enlazada a ningún cobro, pasa a ser un cobro 'cobrado'
-- de esa cuenta (con su monto en soles). Si un centro tiene 2+ cuentas activas la atribución sería ambigua:
-- se omite y queda para revisión manual. Después se recalculan todas las cuentas.
--
-- Idempotente: NOT EXISTS sobre id_transaccion evita duplicar si se corre otra vez. No borra ni modifica
-- filas existentes.

INSERT INTO cobros (id_cuenta_cobrar, monto, fecha_cobro, estado_cobro, id_transaccion, referencia)
SELECT cc.id_cuenta_cobrar,
       fn_monto_soles_transaccion(t),
       t.fecha,
       'cobrado',
       t.id_transaccion,
       'Reconstruido: ingreso previo al centro de costo (migración H6)'
FROM transaccion t
JOIN (
    SELECT id_centro_costo, MIN(id_cuenta_cobrar) AS id_cuenta_cobrar
    FROM cuentas_cobrar
    WHERE activo = true AND id_transaccion IS NULL AND id_centro_costo IS NOT NULL
    GROUP BY id_centro_costo
    HAVING COUNT(*) = 1
) cc ON cc.id_centro_costo = t.id_centro_costo_destino
WHERE t.tipo = 'ingreso'
  AND t.estado = 'activo'
  AND NOT EXISTS (SELECT 1 FROM cobros c WHERE c.id_transaccion = t.id_transaccion);

SELECT fn_recalcular_cuenta_cobrar(id_cuenta_cobrar) FROM cuentas_cobrar WHERE activo = true;

NOTIFY pgrst, 'reload schema';
