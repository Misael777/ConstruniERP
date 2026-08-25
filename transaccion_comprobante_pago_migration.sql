-- ============================================================
-- MIGRACIÓN: Comprobantes de pago (varios por transacción)
-- A pedido explícito del usuario: reemplaza el campo único "Adjuntar factura o boleta de venta" por una
-- cuarta sección en Nueva/Editar Transacción que permite adjuntar VARIOS comprobantes, cada uno con su
-- propio Tipo de Documento, N° de Documento y Monto — para Egreso son comprobantes de pago, para
-- Ingreso son comprobantes de recepción de dinero de Construni (mismo mecanismo, distinto rótulo).
-- Tabla NUEVA y separada de `transaccion` — mismo patrón que transaccion_detalle_categoria_migration.sql
-- (una fila `transaccion` con N filas hijas). Idempotente: usa CREATE TABLE IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS transaccion_comprobante_pago (
    id_comprobante_pago BIGSERIAL PRIMARY KEY,
    id_transaccion       BIGINT NOT NULL REFERENCES transaccion(id_transaccion) ON DELETE CASCADE,
    tipo_documento        VARCHAR(30),
    num_documento         VARCHAR(30),
    monto                 NUMERIC,
    url                   TEXT NOT NULL,
    nombre_archivo        VARCHAR(255),
    created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transaccion_comprobante_pago_id_transaccion
    ON transaccion_comprobante_pago (id_transaccion);

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
