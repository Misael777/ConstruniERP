-- ============================================================
-- LIMPIEZA DE DATOS: apertura_financiera
-- ============================================================
-- No es una migración de esquema (no toca columnas ni constraints) — es un borrado de DATOS, a
-- pedido explícito del usuario, para vaciar las filas de prueba acumuladas mientras se ajustaba el
-- mecanismo de "Generar Apertura" en Control Financiero (Conciliación).
--
-- Seguro de correr: nada en el ERP tiene una FK que apunte HACIA apertura_financiera — ella misma
-- referencia cuenta_banco/centro_costo (nunca al revés), así que vaciarla no rompe ninguna otra
-- tabla. TRUNCATE reinicia también el contador de id_apertura.
--
-- Esto SOLO limpia el registro de auditoría de apertura_financiera. NO toca:
--   - cuenta_banco.saldo_inicial/saldo_actual (quedan con lo que sea que hayas probado hasta ahora)
--   - ninguna transacción real
-- Si quieres arrancar 100% limpio, después de correr esto probablemente quieras volver a generar la
-- Apertura desde Conciliación con los montos correctos — eso sí va a re-escribir saldo_inicial de
-- cada cuenta bancaria (ver crearAperturaFinancieraLote en conciliacion.service.ts).
-- ============================================================

TRUNCATE TABLE apertura_financiera;
