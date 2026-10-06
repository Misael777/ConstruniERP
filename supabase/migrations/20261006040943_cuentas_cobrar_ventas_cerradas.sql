-- Cuenta por Cobrar para cada VENTA CERRADA que no tiene una (a pedido del usuario, 2026-10-05).
--
-- Hasta ahora "Cerrar venta" no creaba la Cuenta por Cobrar (solo la creaba "Nueva venta" con Forma de
-- cobranza, desde el 2026-10-01): las ventas cerradas antes no tienen ninguna. Desde este cambio el cierre la
-- crea solo (asegurarCuentaCobrarDeVenta en cuentasCobrar.service.ts); esta migración hace lo mismo con las
-- ventas ya cerradas, con la MISMA regla:
--   * Monto = Valor venta (proyecto.precio_venta), Crédito, en soles, centro de costo = el del proyecto.
--   * Cada ingreso activo que ya entró al centro de costo del proyecto y no es cuota de ninguna cuenta pasa a ser
--     una cuota COBRADA enlazada a su transacción (Hito de cobro = su categoría, ej. "Adelanto").
--   * El saldo (Valor venta - cobrado) queda como una cuota pendiente a 30 días de la fecha de venta (o de hoy, si
--     la venta es antigua: así no nace vencida).
--
-- Se OMITE (y se avisa con NOTICE, para revisión manual) una venta cuando:
--   * ya tiene una cuenta por cobrar activa (por proyecto o por su centro de costo);
--   * su cliente tiene alguna cuenta activa sin proyecto ni centro de costo (podría ser la de esta venta);
--   * lo ya cobrado supera el Valor venta.
--
-- REQUISITO: correr ANTES 20261003000859_restaurar_centros_costo_borrados.sql — sin eso, las obras cuyo centro
-- de costo fue borrado quedarían sin centro y sin sus adelantos como cobrados.
-- Idempotente: una segunda corrida ya encuentra la cuenta creada y omite la venta.

DO $$
DECLARE
    v RECORD;
    t transaccion;
    v_centro BIGINT;
    v_cuenta BIGINT;
    v_cobrado NUMERIC;
    v_saldo NUMERIC;
    v_fecha DATE;
    v_cuotas INTEGER;
    v_creadas INTEGER := 0;
BEGIN
    FOR v IN
        SELECT p.id_proyecto, p.id_cliente, p.precio_venta, p.nombre_proyecto, p.responsable,
               COALESCE(p.fecha_inicio_plan, p.created_at::date, CURRENT_DATE) AS fecha_venta
        FROM proyecto p
        WHERE p.estado_proyecto = 'venta_cerrada' AND p.precio_venta > 0 AND p.id_cliente IS NOT NULL
        ORDER BY p.id_proyecto
    LOOP
        SELECT MIN(id_centro_costo) INTO v_centro FROM centro_costo WHERE id_proyecto = v.id_proyecto;

        IF EXISTS (
            SELECT 1 FROM cuentas_cobrar c
            WHERE c.activo AND (c.id_proyecto = v.id_proyecto OR (v_centro IS NOT NULL AND c.id_centro_costo = v_centro))
        ) THEN
            CONTINUE; -- ya tiene su cuenta por cobrar
        END IF;

        IF EXISTS (
            SELECT 1 FROM cuentas_cobrar c
            WHERE c.activo AND c.id_cliente = v.id_cliente AND c.id_proyecto IS NULL AND c.id_centro_costo IS NULL AND c.id_transaccion IS NULL
        ) THEN
            RAISE NOTICE 'Omitida venta #% (%): el cliente ya tiene una cuenta por cobrar sin proyecto; revisar a mano.', v.id_proyecto, v.nombre_proyecto;
            CONTINUE;
        END IF;

        SELECT COALESCE(SUM(fn_monto_soles_transaccion(tx)), 0) INTO v_cobrado
        FROM transaccion tx
        WHERE v_centro IS NOT NULL AND tx.id_centro_costo_destino = v_centro AND tx.tipo = 'ingreso' AND tx.estado = 'activo'
          AND NOT EXISTS (SELECT 1 FROM cobros c WHERE c.id_transaccion = tx.id_transaccion);

        IF v_cobrado - v.precio_venta > 0.01 THEN
            RAISE NOTICE 'Omitida venta #% (%): lo cobrado (%) supera el Valor venta (%).', v.id_proyecto, v.nombre_proyecto, v_cobrado, v.precio_venta;
            CONTINUE;
        END IF;

        v_saldo := ROUND(v.precio_venta - v_cobrado, 2);
        v_fecha := GREATEST(v.fecha_venta, CURRENT_DATE) + 30; -- venta antigua: a 30 días de hoy, no nace vencida

        INSERT INTO cuentas_cobrar (id_cliente, id_proyecto, id_centro_costo, monto, monto_cobrado, saldo_pendiente,
                                    forma_pago, responsable, fecha_emision, fecha_vencimiento, moneda, observaciones,
                                    estado, usuario_registro, activo)
        VALUES (v.id_cliente, v.id_proyecto, v_centro, v.precio_venta, 0, v.precio_venta,
                2, LEFT(v.responsable, 100), v.fecha_venta, CASE WHEN v_saldo > 0.005 THEN v_fecha ELSE v.fecha_venta END, 'PEN',
                LEFT('Cuenta por cobrar de la venta ' || v.nombre_proyecto || ' (creada por migración)', 200),
                'pendiente', 'migracion ventas cerradas', true)
        RETURNING id_cuenta_cobrar INTO v_cuenta;

        -- Ingresos ya recibidos -> cuotas cobradas.
        IF v_centro IS NOT NULL THEN
            FOR t IN
                SELECT * FROM transaccion tx
                WHERE tx.id_centro_costo_destino = v_centro AND tx.tipo = 'ingreso' AND tx.estado = 'activo'
                  AND NOT EXISTS (SELECT 1 FROM cobros c WHERE c.id_transaccion = tx.id_transaccion)
                ORDER BY tx.fecha, tx.id_transaccion
            LOOP
                INSERT INTO cobros (id_cuenta_cobrar, monto, fecha_cobro, estado_cobro, id_transaccion, referencia, usuario_registro)
                VALUES (v_cuenta, fn_monto_soles_transaccion(t), t.fecha, 'cobrado', t.id_transaccion, LEFT(COALESCE(t.categoria, 'Ingreso'), 100), 'migracion ventas cerradas');
            END LOOP;
        END IF;

        -- Saldo -> cuota pendiente.
        IF v_saldo > 0.005 THEN
            INSERT INTO cobros (id_cuenta_cobrar, monto, fecha_cobro, estado_cobro, referencia, usuario_registro)
            VALUES (v_cuenta, v_saldo, v_fecha, 'programado', 'Saldo de la venta', 'migracion ventas cerradas');
        END IF;

        SELECT COUNT(*) INTO v_cuotas FROM cobros WHERE id_cuenta_cobrar = v_cuenta;
        UPDATE cuentas_cobrar SET "condición_pago" = v_cuotas WHERE id_cuenta_cobrar = v_cuenta;
        PERFORM fn_recalcular_cuenta_cobrar(v_cuenta);
        v_creadas := v_creadas + 1;
    END LOOP;

    RAISE NOTICE 'Cuentas por cobrar creadas para ventas cerradas: %', v_creadas;
END $$;
