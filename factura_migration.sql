-- ============================================================
-- MIGRACIÓN: Submódulo "Facturación" (Finanzas) — v2
-- Factura en el formato real de Construni (FACTURA ELECTRÓNICA, serie E001), armada a partir de las
-- transacciones de ingreso YA cobradas de un cliente. Documento INTERNO (no hay firma digital ni OSE;
-- la declaración SUNAT real se sigue haciendo aparte).
--
-- * Folio automático E001-00000001 (secuencia + trigger, atómico entre clientes concurrentes).
-- * transaccion.id_factura marca qué transacciones ya fueron facturadas (azul lino = sin factura).
-- * factura_archivo guarda las imágenes/PDF emitidos (URL en Google Drive).
-- * fn_emitir_factura(): asigna las transacciones a la factura y la pasa a 'emitida' en UNA sola
--   operación atómica (si alguna ya fue facturada por otra persona, no cambia nada).
-- * NO crea Cuenta por Cobrar: las transacciones ya son dinero cobrado.
--
-- Idempotente y a prueba de la v1: sirve tanto si la tabla `factura` ya existía (versión con partidas/
-- amortización) como si no. Se puede correr más de una vez sin error.
-- ============================================================

CREATE TABLE IF NOT EXISTS factura (
    id_factura BIGSERIAL PRIMARY KEY,
    folio VARCHAR(20) UNIQUE NOT NULL,
    id_cliente BIGINT NOT NULL REFERENCES cliente(id_cliente),
    fecha_emision DATE NOT NULL DEFAULT CURRENT_DATE,
    estado VARCHAR(20) NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','emitida','anulada')),
    activo BOOLEAN NOT NULL DEFAULT true,
    usuario_registro VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Columnas v2 (ADD IF NOT EXISTS: también actualiza una tabla creada por la v1)
ALTER TABLE factura ADD COLUMN IF NOT EXISTS id_proyecto BIGINT REFERENCES proyecto(id_proyecto);
ALTER TABLE factura ADD COLUMN IF NOT EXISTS cliente_nombre VARCHAR(200);
ALTER TABLE factura ADD COLUMN IF NOT EXISTS cliente_tipo_doc VARCHAR(10);
ALTER TABLE factura ADD COLUMN IF NOT EXISTS cliente_documento VARCHAR(20);
ALTER TABLE factura ADD COLUMN IF NOT EXISTS cliente_direccion TEXT;
ALTER TABLE factura ADD COLUMN IF NOT EXISTS forma_pago VARCHAR(20) NOT NULL DEFAULT 'contado';
ALTER TABLE factura ADD COLUMN IF NOT EXISTS observacion TEXT;
ALTER TABLE factura ADD COLUMN IF NOT EXISTS moneda VARCHAR(3) NOT NULL DEFAULT 'PEN';
ALTER TABLE factura ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(10,4);
ALTER TABLE factura ADD COLUMN IF NOT EXISTS sub_total_ventas NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE factura ADD COLUMN IF NOT EXISTS anticipos NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE factura ADD COLUMN IF NOT EXISTS descuentos NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE factura ADD COLUMN IF NOT EXISTS valor_venta NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE factura ADD COLUMN IF NOT EXISTS isc NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE factura ADD COLUMN IF NOT EXISTS monto_igv NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE factura ADD COLUMN IF NOT EXISTS otros_cargos NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE factura ADD COLUMN IF NOT EXISTS otros_tributos NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE factura ADD COLUMN IF NOT EXISTS redondeo NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE factura ADD COLUMN IF NOT EXISTS monto_total NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE factura ADD COLUMN IF NOT EXISTS sujeta_detraccion BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE factura ADD COLUMN IF NOT EXISTS porcentaje_detraccion NUMERIC(5,2);
ALTER TABLE factura ADD COLUMN IF NOT EXISTS monto_detraccion NUMERIC(14,2);
ALTER TABLE factura ADD COLUMN IF NOT EXISTS detraccion_bien_servicio VARCHAR(200);
ALTER TABLE factura ADD COLUMN IF NOT EXISTS detraccion_medio_pago VARCHAR(50);
ALTER TABLE factura ADD COLUMN IF NOT EXISTS detraccion_cuenta_bn VARCHAR(40);
ALTER TABLE factura ADD COLUMN IF NOT EXISTS imagen_url TEXT;
ALTER TABLE factura ADD COLUMN IF NOT EXISTS autorizado_por VARCHAR(200);
ALTER TABLE factura ADD COLUMN IF NOT EXISTS fecha_autorizacion TIMESTAMPTZ;

-- Una factura es por CLIENTE y puede abarcar transacciones de varios proyectos
ALTER TABLE factura ALTER COLUMN id_proyecto DROP NOT NULL;

-- Columnas de la v1 que ya no se usan (partidas/amortización/retención de garantía/Cuenta por Cobrar)
ALTER TABLE factura DROP COLUMN IF EXISTS porcentaje_amortizacion;
ALTER TABLE factura DROP COLUMN IF EXISTS monto_amortizacion;
ALTER TABLE factura DROP COLUMN IF EXISTS porcentaje_retencion_garantia;
ALTER TABLE factura DROP COLUMN IF EXISTS monto_retencion_garantia;
ALTER TABLE factura DROP COLUMN IF EXISTS tipo_factura;
ALTER TABLE factura DROP COLUMN IF EXISTS numero_valorizacion;
ALTER TABLE factura DROP COLUMN IF EXISTS tipo_comprobante;
ALTER TABLE factura DROP COLUMN IF EXISTS subtotal;
ALTER TABLE factura DROP COLUMN IF EXISTS comentarios;
ALTER TABLE factura DROP COLUMN IF EXISTS fecha_vencimiento;
ALTER TABLE factura DROP COLUMN IF EXISTS id_cuenta_cobrar;

-- Líneas de la factura: una por transacción facturada (trazabilidad con id_transaccion)
CREATE TABLE IF NOT EXISTS factura_detalle (
    id_factura_detalle BIGSERIAL PRIMARY KEY,
    id_factura BIGINT NOT NULL REFERENCES factura(id_factura) ON DELETE CASCADE,
    descripcion VARCHAR(300) NOT NULL,
    cantidad NUMERIC(12,4) NOT NULL DEFAULT 1,
    precio_unitario NUMERIC(14,2) NOT NULL DEFAULT 0,
    orden INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE factura_detalle ADD COLUMN IF NOT EXISTS id_transaccion BIGINT;
ALTER TABLE factura_detalle ADD COLUMN IF NOT EXISTS unidad VARCHAR(20) DEFAULT 'Servicio';
ALTER TABLE factura_detalle ADD COLUMN IF NOT EXISTS monto_total_linea NUMERIC(14,2);
ALTER TABLE factura_detalle DROP COLUMN IF EXISTS subtotal;
ALTER TABLE factura_detalle DROP COLUMN IF EXISTS id_partida;
ALTER TABLE factura_detalle DROP COLUMN IF EXISTS codigo;
ALTER TABLE factura_detalle ADD COLUMN IF NOT EXISTS subtotal NUMERIC(14,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED;

-- Imágenes / PDF emitidos (URL en Google Drive) — historial por factura
CREATE TABLE IF NOT EXISTS factura_archivo (
    id_archivo BIGSERIAL PRIMARY KEY,
    id_factura BIGINT NOT NULL REFERENCES factura(id_factura) ON DELETE CASCADE,
    tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('png','pdf')),
    url TEXT NOT NULL,
    nombre_archivo VARCHAR(255),
    usuario_registro VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "Facturada" = la transacción tiene id_factura. NULL = sin factura (se muestra en azul lino).
ALTER TABLE transaccion ADD COLUMN IF NOT EXISTS id_factura BIGINT REFERENCES factura(id_factura) ON DELETE SET NULL;

-- ============================================================
-- v3: 4 tipos de comprobante (Factura/Boleta/Nota de Crédito/Nota de Débito) — "Gestión de
-- Comprobantes". Las 4 pestañas se clasifican EXACTAMENTE igual (a pedido explícito del usuario:
-- "cada pestaña debe mostrar la relación de transacciones tipo ingreso según el tipo de documento"):
-- por transaccion.tipo_documento ('1'=Factura, '2'=Boleta, '10'=Nota de Crédito, '11'=Nota de Débito,
-- ver transaccion.config.ts) — ninguna es un caso especial, todas nacen de una transacción real.
-- ============================================================
ALTER TABLE factura ADD COLUMN IF NOT EXISTS tipo_comprobante VARCHAR(20) NOT NULL DEFAULT 'factura';
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'factura_tipo_comprobante_check') THEN
        ALTER TABLE factura ADD CONSTRAINT factura_tipo_comprobante_check
            CHECK (tipo_comprobante IN ('factura','boleta','nota_credito','nota_debito'));
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_factura_tipo_comprobante ON factura(tipo_comprobante);

-- Folio automático por tipo de comprobante: cada uno con su propia serie/secuencia (correlativo
-- independiente, como en SUNAT real). 'E001-' de Factura es la serie REAL de Construni (confirmada
-- con las imágenes de referencia); 'B001-'/'NC01-'/'ND01-' son series PROVISIONALES hasta que se
-- confirmen las reales — ajustar en fn_asignar_folio_factura si cambian.
CREATE SEQUENCE IF NOT EXISTS factura_folio_seq;
CREATE SEQUENCE IF NOT EXISTS boleta_folio_seq;
CREATE SEQUENCE IF NOT EXISTS nota_credito_folio_seq;
CREATE SEQUENCE IF NOT EXISTS nota_debito_folio_seq;

CREATE OR REPLACE FUNCTION fn_asignar_folio_factura() RETURNS trigger AS $$
BEGIN
    IF NEW.folio IS NULL OR NEW.folio = '' THEN
        NEW.folio := CASE NEW.tipo_comprobante
            WHEN 'boleta' THEN 'B001-' || LPAD(nextval('boleta_folio_seq')::text, 8, '0')
            WHEN 'nota_credito' THEN 'NC01-' || LPAD(nextval('nota_credito_folio_seq')::text, 8, '0')
            WHEN 'nota_debito' THEN 'ND01-' || LPAD(nextval('nota_debito_folio_seq')::text, 8, '0')
            ELSE 'E001-' || LPAD(nextval('factura_folio_seq')::text, 8, '0')
        END;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_asignar_folio_factura ON factura;
CREATE TRIGGER trg_asignar_folio_factura BEFORE INSERT ON factura
    FOR EACH ROW EXECUTE FUNCTION fn_asignar_folio_factura();

CREATE INDEX IF NOT EXISTS idx_factura_cliente ON factura(id_cliente);
CREATE INDEX IF NOT EXISTS idx_factura_detalle_factura ON factura_detalle(id_factura);
CREATE INDEX IF NOT EXISTS idx_factura_detalle_transaccion ON factura_detalle(id_transaccion);
CREATE INDEX IF NOT EXISTS idx_factura_archivo_factura ON factura_archivo(id_factura);
CREATE INDEX IF NOT EXISTS idx_transaccion_id_factura ON transaccion(id_factura);

-- Emisión atómica: asigna las transacciones de la factura y la pasa a 'emitida'. Si alguna transacción
-- ya fue facturada por otra persona, lanza error y NO cambia nada (la excepción revierte todo).
CREATE OR REPLACE FUNCTION fn_emitir_factura(p_id_factura BIGINT, p_imagen_url TEXT, p_usuario TEXT)
RETURNS factura AS $$
DECLARE
    v_factura factura;
    v_total INTEGER;
    v_asignadas INTEGER;
BEGIN
    SELECT * INTO v_factura FROM factura WHERE id_factura = p_id_factura FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Factura no encontrada' USING HINT = 'FACTURA_NO_ENCONTRADA';
    END IF;
    IF v_factura.estado = 'emitida' THEN
        RETURN v_factura;
    END IF;
    IF v_factura.estado <> 'borrador' THEN
        RAISE EXCEPTION 'Solo se puede emitir una factura en borrador' USING HINT = 'FACTURA_NO_EMITIBLE';
    END IF;

    SELECT COUNT(DISTINCT id_transaccion) INTO v_total
    FROM factura_detalle WHERE id_factura = p_id_factura AND id_transaccion IS NOT NULL;
    IF v_total = 0 THEN
        RAISE EXCEPTION 'La factura no tiene transacciones seleccionadas' USING HINT = 'FACTURA_SIN_TRANSACCIONES';
    END IF;

    UPDATE transaccion SET id_factura = p_id_factura
    WHERE id_factura IS NULL
      AND id_transaccion IN (SELECT id_transaccion FROM factura_detalle WHERE id_factura = p_id_factura AND id_transaccion IS NOT NULL);
    GET DIAGNOSTICS v_asignadas = ROW_COUNT;
    IF v_asignadas <> v_total THEN
        RAISE EXCEPTION 'Alguna de las transacciones ya fue facturada' USING HINT = 'TRANSACCION_YA_FACTURADA';
    END IF;

    UPDATE factura
    SET estado = 'emitida', imagen_url = p_imagen_url, autorizado_por = p_usuario,
        fecha_autorizacion = NOW(), updated_at = NOW()
    WHERE id_factura = p_id_factura
    RETURNING * INTO v_factura;
    RETURN v_factura;
END;
$$ LANGUAGE plpgsql;

-- Permiso de menú/IAM — mismo patrón que finanzas_dashboard_permiso_migration.sql
INSERT INTO permisos (nombre, descripcion) VALUES
    ('ver_finanzas_facturacion', 'Ver Facturación')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r, permisos p WHERE r.nombre = 'administrador'
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
