-- ============================================================
-- MIGRACIÓN: Submódulo "Facturación" (Finanzas)
-- Documento interno de facturación/valorización (NO comprobante electrónico SUNAT: no hay serie/
-- correlativo oficial, firma digital ni integración con un OSE — eso se sigue declarando aparte,
-- igual que hoy). Folio interno autogenerado (FAC-0001, FAC-0002, ...) vía secuencia + trigger,
-- atómico entre clientes concurrentes (Tauri Windows/Android + navegador) sin servidor propio.
--
-- Al "Emitir Factura" se vincula (id_cuenta_cobrar) con una Cuenta por Cobrar real — reutiliza TODO
-- el seguimiento de cobro/estado (Pagado/Pendiente/Vencido) ya existente en cuentas_cobrar, en vez
-- de duplicar esa lógica.
--
-- factura_detalle guarda snapshot de codigo/descripcion/unidad de la partida (no solo el FK) para
-- que una factura ya emitida no cambie si el catálogo de partidas se edita después.
--
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

CREATE TABLE IF NOT EXISTS factura (
    id_factura BIGSERIAL PRIMARY KEY,
    folio VARCHAR(20) UNIQUE NOT NULL,
    id_proyecto BIGINT NOT NULL REFERENCES proyecto(id_proyecto),
    id_cliente BIGINT NOT NULL REFERENCES cliente(id_cliente),
    tipo_comprobante VARCHAR(10) NOT NULL DEFAULT 'factura' CHECK (tipo_comprobante IN ('factura','boleta')),
    tipo_factura VARCHAR(30) NOT NULL, -- 'Adelanto' | 'Valorización' | 'Extraordinario' | 'Otro'
    numero_valorizacion INTEGER,
    fecha_emision DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_vencimiento DATE,
    moneda VARCHAR(3) NOT NULL DEFAULT 'PEN' CHECK (moneda IN ('PEN','USD')),
    tipo_cambio NUMERIC(10,4),
    subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
    porcentaje_amortizacion NUMERIC(5,2) NOT NULL DEFAULT 0,
    monto_amortizacion NUMERIC(14,2) NOT NULL DEFAULT 0,
    porcentaje_retencion_garantia NUMERIC(5,2) NOT NULL DEFAULT 0,
    monto_retencion_garantia NUMERIC(14,2) NOT NULL DEFAULT 0,
    monto_igv NUMERIC(14,2) NOT NULL DEFAULT 0,
    monto_total NUMERIC(14,2) NOT NULL DEFAULT 0,
    estado VARCHAR(20) NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','emitida','anulada')),
    comentarios TEXT,
    id_cuenta_cobrar BIGINT REFERENCES cuentas_cobrar(id_cuenta_cobrar) ON DELETE SET NULL,
    activo BOOLEAN NOT NULL DEFAULT true,
    usuario_registro VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS factura_detalle (
    id_factura_detalle BIGSERIAL PRIMARY KEY,
    id_factura BIGINT NOT NULL REFERENCES factura(id_factura) ON DELETE CASCADE,
    id_partida BIGINT REFERENCES partida(id_partida),
    codigo VARCHAR(20),
    descripcion VARCHAR(300) NOT NULL,
    unidad VARCHAR(10),
    cantidad NUMERIC(12,4) NOT NULL DEFAULT 1,
    precio_unitario NUMERIC(14,2) NOT NULL DEFAULT 0,
    subtotal NUMERIC(14,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED,
    orden INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS factura_folio_seq;

CREATE OR REPLACE FUNCTION fn_asignar_folio_factura() RETURNS trigger AS $$
BEGIN
    IF NEW.folio IS NULL OR NEW.folio = '' THEN
        NEW.folio := 'FAC-' || LPAD(nextval('factura_folio_seq')::text, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_asignar_folio_factura ON factura;
CREATE TRIGGER trg_asignar_folio_factura BEFORE INSERT ON factura
    FOR EACH ROW EXECUTE FUNCTION fn_asignar_folio_factura();

CREATE INDEX IF NOT EXISTS idx_factura_proyecto ON factura(id_proyecto);
CREATE INDEX IF NOT EXISTS idx_factura_cliente ON factura(id_cliente);
CREATE INDEX IF NOT EXISTS idx_factura_cuenta_cobrar ON factura(id_cuenta_cobrar);
CREATE INDEX IF NOT EXISTS idx_factura_detalle_factura ON factura_detalle(id_factura);

-- Nuevo permiso de menú/IAM — mismo patrón que finanzas_dashboard_permiso_migration.sql: el rol
-- 'administrador' recibe automáticamente cualquier permiso nuevo (no hay trigger para esto, se
-- re-asegura a mano en cada migración de permiso).
INSERT INTO permisos (nombre, descripcion) VALUES
    ('ver_finanzas_facturacion', 'Ver Facturación')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r, permisos p WHERE r.nombre = 'administrador'
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
