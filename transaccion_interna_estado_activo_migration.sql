-- ============================================================
-- MIGRACIÓN (backfill de datos, no de esquema): Transacción Interna dejó de guardarse con
-- estado='consulta' — pasa a 'activo' como cualquier transacción real.
--
-- Bug real reportado por el usuario: "las cantidades en transacción interna no cuadran, no se
-- actualizan". Causa raíz: resolveEstadoTransaccion (transacciones.service.ts) forzaba
-- estado='consulta' para TODA Transacción Interna — una etiqueta que originalmente era solo el badge
-- visual "Consulta" de la lista. El problema: más de 25 consultas de saldo distintas en todo el ERP
-- (centro de costo, cuenta_banco.saldo_actual, Dashboard Finanzas, Control Financiero, Movimientos de
-- Caja, Panoramas) filtran estrictamente estado='activo'. Como una Interna nunca era 'activo', su
-- dinero nunca se contó en ningún saldo — no era un problema de refresco de pantalla, era exclusión
-- total. Confirmado con el usuario: el badge "Consulta" sigue mostrándose igual (ahora derivado de
-- tipo_alcance='interna' en vez de leerse de estado, ver TransaccionModal.svelte/tranzacciones/
-- +page.svelte), y el comportamiento de transacciones Externas NO cambia (ya contaban para los saldos
-- de inmediato, sin depender de 'aprobado').
--
-- Esta migración corrige el HISTÓRICO: toda Transacción Interna ya registrada también estaba en
-- 'consulta', así que su dinero también ha estado invisible hasta ahora. Al correr esto, vas a ver
-- CAMBIOS VISIBLES E INMEDIATOS en los saldos de Centro de Costos y Cuentas Bancarias que tengan
-- Transacciones Internas en su historial (reflejando movimientos que nunca se habían contado).
--
-- Idempotente: el WHERE hace que correrla más de una vez sea un no-op (nada queda con
-- tipo_alcance='interna' AND estado='consulta' después de la primera corrida).
-- ============================================================

UPDATE transaccion
SET estado = 'activo'
WHERE tipo_alcance = 'interna' AND estado = 'consulta';
