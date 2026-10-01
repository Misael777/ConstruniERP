-- ============================================================
-- Repositorio de comprobantes de INGRESO (Factura, Boleta, Nota de Crédito, Nota de Débito)
-- ============================================================
-- A pedido del usuario (con imagen de referencia): dentro de "Emisión de Comprobante" se suben los
-- comprobantes reales (PDF, foto o XML de SUNAT) que respaldan las transacciones de ingreso. El sistema
-- lee sus datos con OCR + regex (o del XML, exacto), quedan en estado Pendiente y un administrador los
-- marca Revisado u Observado. Es distinto de `factura` (comprobantes INTERNOS que el propio ERP genera).
--
--   comprobante_ingreso              un comprobante subido + los datos leídos/corregidos.
--   comprobante_ingreso_transaccion  a qué transacciones de ingreso respalda (uno a varios: una factura
--                                    puede cubrir varias transacciones, ej. adelanto + valorización).
-- Una Nota de Crédito/Débito apunta al comprobante que corrige (id_comprobante_referencia).
-- Baja lógica con `activo` (patrón dar-de-baja del ERP). Idempotente: se puede correr más de una vez.
-- ============================================================

CREATE TABLE IF NOT EXISTS comprobante_ingreso (
    id_comprobante            BIGSERIAL PRIMARY KEY,
    tipo                      VARCHAR(15) NOT NULL
                              CHECK (tipo IN ('factura', 'boleta', 'nota_credito', 'nota_debito')),
    serie                     VARCHAR(4),
    numero                    VARCHAR(8),
    fecha_emision             DATE,
    ruc_emisor                VARCHAR(11),
    razon_social_emisor       VARCHAR(200),
    doc_receptor              VARCHAR(15),          -- RUC o DNI del cliente
    nombre_receptor           VARCHAR(200),
    id_cliente                BIGINT REFERENCES cliente(id_cliente) ON DELETE SET NULL,
    moneda                    VARCHAR(3) NOT NULL DEFAULT 'PEN' CHECK (moneda IN ('PEN', 'USD')),
    subtotal                  NUMERIC(14, 2),
    igv                       NUMERIC(14, 2),
    total                     NUMERIC(14, 2),
    id_comprobante_referencia BIGINT REFERENCES comprobante_ingreso(id_comprobante) ON DELETE SET NULL,
    estado                    VARCHAR(12) NOT NULL DEFAULT 'pendiente'
                              CHECK (estado IN ('pendiente', 'revisado', 'observado')),
    motivo_observacion        TEXT,
    revisado_por              VARCHAR(200),
    revisado_en               TIMESTAMPTZ,
    archivo_url               TEXT NOT NULL,
    archivo_nombre            VARCHAR(255),
    archivo_tipo              VARCHAR(10) NOT NULL CHECK (archivo_tipo IN ('pdf', 'imagen', 'xml')),
    fuente_datos              VARCHAR(10) NOT NULL DEFAULT 'manual' CHECK (fuente_datos IN ('ocr', 'xml', 'manual')),
    texto_ocr                 TEXT,
    activo                    BOOLEAN NOT NULL DEFAULT true,
    usuario_registro          VARCHAR(200),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comprobante_ingreso_tipo ON comprobante_ingreso (tipo);
CREATE INDEX IF NOT EXISTS idx_comprobante_ingreso_estado ON comprobante_ingreso (estado);
CREATE INDEX IF NOT EXISTS idx_comprobante_ingreso_fecha ON comprobante_ingreso (fecha_emision);
CREATE INDEX IF NOT EXISTS idx_comprobante_ingreso_cliente ON comprobante_ingreso (id_cliente);

-- Un mismo comprobante (tipo + RUC emisor + serie + número) no puede subirse dos veces mientras esté activo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_comprobante_ingreso_documento
    ON comprobante_ingreso (tipo, ruc_emisor, serie, numero)
    WHERE activo AND serie IS NOT NULL AND numero IS NOT NULL AND ruc_emisor IS NOT NULL;

CREATE TABLE IF NOT EXISTS comprobante_ingreso_transaccion (
    id_comprobante  BIGINT NOT NULL REFERENCES comprobante_ingreso(id_comprobante) ON DELETE CASCADE,
    id_transaccion  BIGINT NOT NULL REFERENCES transaccion(id_transaccion) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id_comprobante, id_transaccion)
);

CREATE INDEX IF NOT EXISTS idx_comprobante_ingreso_transaccion_tx ON comprobante_ingreso_transaccion (id_transaccion);

-- updated_at automático
CREATE OR REPLACE FUNCTION trg_comprobante_ingreso_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comprobante_ingreso_updated_at ON comprobante_ingreso;
CREATE TRIGGER comprobante_ingreso_updated_at
    BEFORE UPDATE ON comprobante_ingreso
    FOR EACH ROW EXECUTE FUNCTION trg_comprobante_ingreso_updated_at();

-- Mismo nivel de acceso que el resto de las tablas financieras del ERP (sin RLS; el control de quién
-- revisa/observa es de la app: solo administradores). Permisos explícitos para la API de Supabase.
GRANT SELECT, INSERT, UPDATE, DELETE ON comprobante_ingreso, comprobante_ingreso_transaccion TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE comprobante_ingreso_id_comprobante_seq TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
