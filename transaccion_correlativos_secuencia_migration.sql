-- Reemplaza el enfoque anterior (CREATE FUNCTION + RPC, que no llegó a aparecer en el schema cache de
-- PostgREST pese a correr la migración varias veces) por algo más simple y robusto: dos tablas
-- "contador" chiquitas, donde cada INSERT nuevo devuelve automáticamente el siguiente número (SERIAL) de
-- forma atómica — mismo mecanismo de siempre (INSERT vía supabase-js con la anon key), sin necesitar
-- ninguna función/RPC nueva que dependa de que PostgREST recargue su caché de funciones.
--
-- Por qué hace falta esto y no un simple "MAX(columna guardada) + 1": el botón "Autogenerar Boucher..."
-- genera y descarga el PDF EN EL MOMENTO que se presiona, esté o no guardada todavía la transacción — si
-- el usuario cierra el modal sin guardar después de generarlo, ese número nunca llegaba a quedar en la
-- BD, así que la próxima vez MAX+1 volvía a calcular EL MISMO número ya impreso en el PDF anterior y
-- abandonado → dos recibos distintos con el mismo N°. Con estas tablas, cada INSERT consume su número de
-- forma irreversible apenas se pide — puede dejar huecos (una transacción abandonada es como una boleta
-- anulada), pero nunca repite un número.

-- Si ya habías corrido la versión anterior de esta migración (con CREATE FUNCTION), esto la limpia sin
-- error aunque nunca haya llegado a crearse.
DROP FUNCTION IF EXISTS siguiente_num_comprobante_interno();
DROP FUNCTION IF EXISTS siguiente_num_recibo_pago();
DROP SEQUENCE IF EXISTS transaccion_num_comprobante_interno_seq;
DROP SEQUENCE IF EXISTS transaccion_num_recibo_pago_seq;

CREATE TABLE IF NOT EXISTS num_comprobante_interno_log (
    id SERIAL PRIMARY KEY,
    creado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS num_recibo_pago_log (
    id SERIAL PRIMARY KEY,
    creado_en TIMESTAMPTZ DEFAULT NOW()
);

-- Arrancan después del mayor número YA GUARDADO en la tabla, para no chocar con los correlativos
-- existentes que ya se le entregaron a algún cliente/proveedor impresos en un PDF real.
SELECT setval(
    pg_get_serial_sequence('num_comprobante_interno_log', 'id'),
    COALESCE((SELECT MAX(num_comprobante_interno) FROM transaccion), 0),
    true
);
SELECT setval(
    pg_get_serial_sequence('num_recibo_pago_log', 'id'),
    COALESCE((SELECT MAX(num_recibo_pago) FROM transaccion), 0),
    true
);

-- 100% cliente, sin backend propio (ver getSiguienteNumeroComprobanteInterno/getSiguienteNumeroReciboPago
-- en transacciones.service.ts) — la app inserta en estas tablas directo con la anon key, así que no
-- pueden tener RLS bloqueando. No contienen ningún dato sensible, solo un correlativo y una marca de
-- tiempo.
ALTER TABLE num_comprobante_interno_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE num_recibo_pago_log DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
