-- ============================================================================
-- PRUEBAS MANUALES DE CONCURRENCIA — RPC de integridad financiera
-- ============================================================================
-- Este archivo NO es una migración — no lo corras contra producción tal cual, es un
-- guion de verificación para un proyecto Supabase de prueba/staging (o una copia
-- restaurada de la BD). Cubre los 5 escenarios que pidió el usuario para el módulo
-- financiero, tras aplicar financial_integrity_rpc_migration.sql.
--
-- Cómo correrlo: abre DOS pestañas del SQL Editor de Supabase (o dos sesiones psql)
-- contra el MISMO proyecto de prueba — llamalas Sesión A y Sesión B. Cada escenario
-- da los pasos intercalados: ejecuta el paso 1 en A, el paso 2 en B (antes de que A
-- haga commit), etc. — esa es la condición de carrera real. Todos los ids de abajo
-- (999001, etc.) son de ejemplo: reemplázalos por filas reales de tu proyecto de
-- prueba, o inserta filas de prueba primero (ver "Fixtures" al final de cada bloque).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- ESCENARIO 1 — Egresos concurrentes sobregirando la misma cuenta bancaria
-- ----------------------------------------------------------------------------
-- Fixture: una cuenta con saldo_inicial = 1000 y sin movimientos.
--   INSERT INTO cuenta_banco (numero_cuenta, titular_cuenta, nombre_banco, tipo_cuenta,
--     tipo_moneda, estado, activo, saldo_inicial, saldo_actual)
--   VALUES ('TEST-CTA-1', 'Cuenta de prueba', 'BCP', 'corriente', 'soles', 'activa', true, 1000, 1000);
--
-- Dos Egresos de 700 cada uno saliendo de esa misma cuenta, casi simultáneos. Sin el
-- lock, ambos pasarían el chequeo de saldo (1000 disponible >= 700) y el saldo final
-- quedaría en -400. Con fn_crear_transaccion, el segundo debe esperar a que el
-- primero termine, ver el saldo YA actualizado (300) y fallar con SALDO_INSUFICIENTE.
--
-- Sesión A:
BEGIN;
SELECT fn_crear_transaccion('{
  "tipo": "egreso", "tipo_alcance": "externa", "monto_total": 700, "fecha": "2026-01-01",
  "cuente_origen": "TEST-CTA-1", "comprobante_url": "https://example.com/x.pdf",
  "descripcion": "Prueba concurrencia A"
}'::jsonb);
-- NO hagas COMMIT todavía — cambia a la Sesión B mientras esta transacción sigue abierta.

-- Sesión B (mientras A sigue sin commit):
BEGIN;
SELECT fn_crear_transaccion('{
  "tipo": "egreso", "tipo_alcance": "externa", "monto_total": 700, "fecha": "2026-01-01",
  "cuente_origen": "TEST-CTA-1", "comprobante_url": "https://example.com/y.pdf",
  "descripcion": "Prueba concurrencia B"
}'::jsonb);
-- B debe quedar BLOQUEADA (esperando el lock de la fila cuenta_banco) — no dispara error todavía.

-- Vuelve a Sesión A y confirma:
COMMIT;
-- Apenas A confirma, B se desbloquea y su SELECT debe fallar con:
--   ERROR: Saldo insuficiente en la cuenta bancaria TEST-CTA-1: disponible 300, se requieren 700
-- Sesión B: si el SELECT ya devolvió el error, solo hace falta:
ROLLBACK;
--
-- Resultado esperado: SELECT saldo_actual FROM cuenta_banco WHERE numero_cuenta = 'TEST-CTA-1';
-- debe dar exactamente 300 (nunca negativo, nunca -400).


-- ----------------------------------------------------------------------------
-- ESCENARIO 2 — Confirmaciones de pago concurrentes perdiendo una actualización
-- ----------------------------------------------------------------------------
-- Fixture: una cuenta por pagar con monto_comprometido = 1000, y dos pagos
-- 'programado' de 500 y 300 (id_pago 999001 y 999002) ya insertados contra ella
-- (id_cuenta_pagar 999001, con id_centro_costo apuntando a un centro real de prueba).
--
-- Sesión A — confirma el pago de 500:
BEGIN;
SELECT fn_confirmar_pago(
  999001,
  '{"tipo": "egreso", "tipo_alcance": "externa", "monto_total": 500, "fecha": "2026-01-01",
    "id_centro_costo_origen": <id_real>, "comprobante_url": "https://example.com/a.pdf"}'::jsonb,
  999001
);
-- NO hagas COMMIT todavía.

-- Sesión B — confirma el pago de 300 (mientras A sigue sin commit):
BEGIN;
SELECT fn_confirmar_pago(
  999001,
  '{"tipo": "egreso", "tipo_alcance": "externa", "monto_total": 300, "fecha": "2026-01-01",
    "id_centro_costo_origen": <id_real>, "comprobante_url": "https://example.com/b.pdf"}'::jsonb,
  999002
);
-- B debe quedar BLOQUEADA esperando el lock de la fila cuentas_pagar (fn_confirmar_pago la toma
-- primero, antes de crear la transacción) — no del lock de cuenta_banco de este caso.

-- Sesión A:
COMMIT;
-- B se desbloquea, su SELECT corre y hace su propio recálculo VIENDO ya el pago de A confirmado.
-- Sesión B:
COMMIT;
--
-- Resultado esperado: SELECT monto_pagado, saldo_pendiente FROM cuentas_pagar WHERE id_cuenta_pagar
-- = 999001; debe dar monto_pagado = 800, saldo_pendiente = 200 — NUNCA 500 (el "lost update" que
-- confirmó la auditoría original, donde el commit que terminaba último pisaba con un cálculo viejo).


-- ----------------------------------------------------------------------------
-- ESCENARIO 3 — Doble-envío / idempotencia (doble-click o retry de red)
-- ----------------------------------------------------------------------------
-- Simula dos llamadas con la MISMA idempotency_key — no hace falta abrir dos sesiones,
-- basta con llamar dos veces seguidas la misma key en la misma sesión:
SELECT (fn_crear_transaccion('{
  "tipo": "ingreso", "tipo_alcance": "externa", "monto_total": 250, "fecha": "2026-01-01",
  "id_centro_costo_destino": <id_real>, "comprobante_url": "https://example.com/z.pdf"
}'::jsonb, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')).id_transaccion AS primer_intento;

SELECT (fn_crear_transaccion('{
  "tipo": "ingreso", "tipo_alcance": "externa", "monto_total": 250, "fecha": "2026-01-01",
  "id_centro_costo_destino": <id_real>, "comprobante_url": "https://example.com/z.pdf"
}'::jsonb, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')).id_transaccion AS segundo_intento;
--
-- Resultado esperado: primer_intento y segundo_intento devuelven EXACTAMENTE el mismo
-- id_transaccion — SELECT COUNT(*) FROM transaccion WHERE idempotency_key =
-- 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'; debe dar 1, no 2.
--
-- Variante de carrera real (para el caso "el índice único arbitra"): repite el mismo
-- par de llamadas pero como Escenario 1 (Sesión A sin commit, Sesión B en paralelo con
-- la MISMA key) — la que pierde la carrera de INSERT debe caer al bloque EXCEPTION
-- WHEN unique_violation y devolver igual la fila que sí se insertó, sin propagar error.


-- ----------------------------------------------------------------------------
-- ESCENARIO 4 — Transferencia concurrente entre dos cuentas propias
-- ----------------------------------------------------------------------------
-- Fixture: dos cuentas con saldo 1000 cada una (TEST-CTA-1, TEST-CTA-2).
-- Dos Transferencias en direcciones OPUESTAS entre las mismas dos cuentas, disparadas
-- casi simultáneas — esto es exactamente el caso que el orden ascendente de id
-- (ver fn_crear_transaccion) previene de deadlockear.
--
-- Sesión A — de TEST-CTA-1 a TEST-CTA-2:
BEGIN;
SELECT fn_crear_transaccion('{
  "tipo": "transferencia", "tipo_alcance": "interna", "monto_total": 200, "fecha": "2026-01-01",
  "cuente_origen": "TEST-CTA-1", "cuente_destino": "TEST-CTA-2"
}'::jsonb);

-- Sesión B — de TEST-CTA-2 a TEST-CTA-1 (mientras A sigue sin commit):
BEGIN;
SELECT fn_crear_transaccion('{
  "tipo": "transferencia", "tipo_alcance": "interna", "monto_total": 150, "fecha": "2026-01-01",
  "cuente_origen": "TEST-CTA-2", "cuente_destino": "TEST-CTA-1"
}'::jsonb);
-- B debe quedar BLOQUEADA esperando (no debe haber ERROR de deadlock aquí — si aparece
-- "deadlock detected", el orden de locking tiene un bug).

-- Sesión A:
COMMIT;
-- B se desbloquea y confirma:
-- Sesión B:
COMMIT;
--
-- Resultado esperado: TEST-CTA-1 = 1000 - 200 + 150 = 950; TEST-CTA-2 = 1000 + 200 - 150 = 1050.
-- Ninguna sesión debe haber recibido "deadlock detected" ni haber quedado colgada.


-- ----------------------------------------------------------------------------
-- ESCENARIO 5 — Anular una transacción mientras se confirma un pago sobre la misma cuenta
-- ----------------------------------------------------------------------------
-- Fixture: cuenta por pagar 999002 (monto_comprometido=1000), con un pago YA
-- 'pagado' (id_pago 999003, monto 400, vinculado a id_transaccion 999010) y otro
-- pago 'programado' (id_pago 999004, monto 300).
--
-- Sesión A — anula la transacción del pago ya confirmado (999010):
BEGIN;
SELECT fn_anular_transaccion(999010);
-- NO hagas COMMIT todavía.

-- Sesión B — confirma el segundo pago (300) sobre la MISMA cuenta (mientras A sigue sin commit):
BEGIN;
SELECT fn_confirmar_pago(
  999002,
  '{"tipo": "egreso", "tipo_alcance": "externa", "monto_total": 300, "fecha": "2026-01-01",
    "id_centro_costo_origen": <id_real>, "comprobante_url": "https://example.com/c.pdf"}'::jsonb,
  999004
);
-- B debe quedar BLOQUEADA esperando el lock de cuentas_pagar que A ya tomó (fn_anular_transaccion
-- bloquea la fila de cuentas_pagar vinculada a través del pago que revierte).

-- Sesión A:
COMMIT;
-- B se desbloquea, ve la cuenta YA con el pago de 400 revertido a 'programado', y confirma su
-- propio pago de 300 sobre ese estado correcto.
-- Sesión B:
COMMIT;
--
-- Resultado esperado: SELECT monto_pagado, saldo_pendiente FROM cuentas_pagar WHERE
-- id_cuenta_pagar = 999002; debe dar monto_pagado = 300 (solo el pago de B, ya que el de A
-- se revirtió), saldo_pendiente = 700 — nunca un estado a medio camino ni un pago fantasma.


-- ----------------------------------------------------------------------------
-- Limpieza — borra las filas de prueba cuando termines (reemplaza los ids/números de
-- cuenta usados arriba por los reales de tu corrida).
-- ----------------------------------------------------------------------------
-- DELETE FROM pagos WHERE id_cuenta_pagar IN (999001, 999002);
-- DELETE FROM cuentas_pagar WHERE id_cuenta_pagar IN (999001, 999002);
-- DELETE FROM transaccion WHERE cuente_origen IN ('TEST-CTA-1', 'TEST-CTA-2') OR cuente_destino IN ('TEST-CTA-1', 'TEST-CTA-2');
-- DELETE FROM cuenta_banco WHERE numero_cuenta IN ('TEST-CTA-1', 'TEST-CTA-2');
