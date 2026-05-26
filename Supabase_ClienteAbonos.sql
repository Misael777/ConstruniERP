-- ==============================================
-- MIGRACIÓN: TABLA cliente_abonos
-- ERP CASALLO & MELCHOR – Constructora y Consultora
-- Módulo: Control de Abonos de Clientes
-- ==============================================

BEGIN;

-- ---------------------------------------------------------------
-- 1. CREAR TABLA cliente_abonos
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cliente_abonos (
    id              SERIAL PRIMARY KEY,

    -- Referencias al modelo existente
    cod_venta       INT NOT NULL REFERENCES ventas(id) ON DELETE RESTRICT,
    cod_proyecto    INT REFERENCES ventas(id),          -- puede apuntar al mismo id de venta / proyecto
    cod_cliente     INT NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,

    -- Control del abono
    num_abono       INT NOT NULL CHECK (num_abono > 0),  -- número de cuota/abono (1, 2, 3…)
    fec_vence       DATE NOT NULL,                       -- fecha de vencimiento del abono
    fec_pago        DATE,                                -- fecha real en que se realizó el pago (NULL = sin pagar)
    monto           DECIMAL(12,2) NOT NULL CHECK (monto > 0),  -- importe del abono
    con_abono       TEXT,                                -- concepto / descripción del abono

    -- Datos del pago
    num_operacion   VARCHAR(100),                        -- número de operación bancaria
    banco           VARCHAR(100),                        -- banco con que se realizó el pago
    moneda          VARCHAR(10) DEFAULT 'PEN' CHECK (moneda IN ('PEN', 'USD', 'EUR')),
    med_pago        VARCHAR(50) CHECK (med_pago IN (
                        'TRANSFERENCIA', 'TRANSFERENCIA INTERNA',
                        'EFECTIVO', 'YAPE', 'PLIN', 'DEPÓSITO', 'OTRO'
                    )),                                  -- medio / forma de pago

    -- Saldo y control financiero
    sal_actual      DECIMAL(12,2),                       -- saldo pendiente tras este abono

    -- Auditoría
    usuario         VARCHAR(100),                        -- usuario que registró el abono
    observacion     TEXT,                                -- observaciones adicionales

    -- Comprobante digital
    imagen_com      TEXT,                                -- URL del comprobante (almacenado en Supabase Storage)

    -- Estado del abono
    estado          VARCHAR(30) DEFAULT 'Pendiente'
                        CHECK (estado IN ('Pendiente', 'Pagado', 'Vencido', 'Parcial', 'Anulado')),

    -- Timestamps
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    -- Un número de abono debe ser único por venta
    CONSTRAINT uq_abono_venta UNIQUE (cod_venta, num_abono)
);

-- ---------------------------------------------------------------
-- 2. ÍNDICES
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cliabo_venta      ON cliente_abonos(cod_venta);
CREATE INDEX IF NOT EXISTS idx_cliabo_cliente    ON cliente_abonos(cod_cliente);
CREATE INDEX IF NOT EXISTS idx_cliabo_fec_vence  ON cliente_abonos(fec_vence);
CREATE INDEX IF NOT EXISTS idx_cliabo_fec_pago   ON cliente_abonos(fec_pago);
CREATE INDEX IF NOT EXISTS idx_cliabo_estado     ON cliente_abonos(estado);

-- ---------------------------------------------------------------
-- 3. TRIGGER: actualizar updated_at automáticamente
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cliabo_updated_at ON cliente_abonos;
CREATE TRIGGER trg_cliabo_updated_at
    BEFORE UPDATE ON cliente_abonos
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS) — misma política que pagos_abonos
-- ---------------------------------------------------------------
ALTER TABLE cliente_abonos ENABLE ROW LEVEL SECURITY;

-- Todos los usuarios autenticados pueden leer
DROP POLICY IF EXISTS "Lectura publica de cliente_abonos" ON cliente_abonos;
CREATE POLICY "Lectura publica de cliente_abonos"
    ON cliente_abonos FOR SELECT
    TO authenticated
    USING (true);

-- Solo administradores pueden crear, editar o borrar
DROP POLICY IF EXISTS "Admin CRUD cliente_abonos" ON cliente_abonos;
CREATE POLICY "Admin CRUD cliente_abonos"
    ON cliente_abonos FOR ALL
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

-- ---------------------------------------------------------------
-- 5. COMENTARIOS DE TABLA Y COLUMNAS
-- ---------------------------------------------------------------
COMMENT ON TABLE  cliente_abonos                IS 'Registro de abonos/cuotas que realizan los clientes por sus ventas/proyectos';
COMMENT ON COLUMN cliente_abonos.cod_venta      IS 'FK → ventas.id  — venta a la que pertenece este abono';
COMMENT ON COLUMN cliente_abonos.cod_proyecto   IS 'FK → ventas.id  — proyecto asociado (puede coincidir con cod_venta)';
COMMENT ON COLUMN cliente_abonos.cod_cliente    IS 'FK → clientes.id — cliente que realiza el abono';
COMMENT ON COLUMN cliente_abonos.num_abono      IS 'Número correlativo de cuota (1, 2, 3…) dentro de la venta';
COMMENT ON COLUMN cliente_abonos.fec_vence      IS 'Fecha límite en que debe pagarse este abono';
COMMENT ON COLUMN cliente_abonos.fec_pago       IS 'Fecha efectiva del pago; NULL indica que aún no se ha pagado';
COMMENT ON COLUMN cliente_abonos.monto          IS 'Importe del abono';
COMMENT ON COLUMN cliente_abonos.con_abono      IS 'Concepto o descripción del abono';
COMMENT ON COLUMN cliente_abonos.num_operacion  IS 'Número de operación bancaria del pago';
COMMENT ON COLUMN cliente_abonos.banco          IS 'Banco con el que se realizó el pago';
COMMENT ON COLUMN cliente_abonos.moneda         IS 'Moneda: PEN (sol), USD (dólar), EUR (euro)';
COMMENT ON COLUMN cliente_abonos.med_pago       IS 'Medio de pago utilizado';
COMMENT ON COLUMN cliente_abonos.sal_actual     IS 'Saldo pendiente total del cliente tras registrar este abono';
COMMENT ON COLUMN cliente_abonos.usuario        IS 'Usuario del sistema que registró el abono';
COMMENT ON COLUMN cliente_abonos.observacion    IS 'Notas u observaciones adicionales';
COMMENT ON COLUMN cliente_abonos.imagen_com     IS 'URL del comprobante digital almacenado en Supabase Storage';
COMMENT ON COLUMN cliente_abonos.estado         IS 'Estado del abono: Pendiente | Pagado | Vencido | Parcial | Anulado';

COMMIT;
