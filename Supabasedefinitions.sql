-- ==============================================
-- SCRIPT COMPLETO DROP & CREATE (IDEMPOTENTE)
-- ERP CASALLO & MELCHOR – Constructora y Consultora
-- Versión final con todos los módulos y reportes
-- ==============================================

BEGIN;

-- ---------------------------------------------------------------
-- 1. LIMPIEZA TOTAL
-- ---------------------------------------------------------------
DROP TABLE IF EXISTS
    presupuesto_envios,
    resultados_mensuales,
    metas,
    fraccionamientos_pago,
    pagos_abonos,
    envios,
    seguimiento_proyectos,
    gastos,
    ventas,
    obras,
    consultorias,
    empleados,
    clientes,
    proveedores,
    centros_costos,
    unidades,
    impuestos,
    tipos_documento,
    conceptos_gasto,
    tipos_gasto,
    formas_pago,
    cuentas_bancarias,
    areas,
    empresa
CASCADE;

-- ---------------------------------------------------------------
-- 2. TABLAS CATÁLOGO / MAESTRAS
-- ---------------------------------------------------------------

CREATE TABLE empresa (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    saldo_inicial DECIMAL(12,2) DEFAULT 0,
    monto_inicio DECIMAL(12,2) DEFAULT 0,
    cuenta_inicio VARCHAR(100),
    fecha_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE areas (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cuentas_bancarias (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    numero_cuenta VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE formas_pago (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tipos_gasto (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE conceptos_gasto (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    tipo_gasto_id INT NOT NULL REFERENCES tipos_gasto(id) ON DELETE CASCADE,
    UNIQUE(nombre, tipo_gasto_id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE impuestos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    tasa DECIMAL(5,2) NOT NULL CHECK (tasa >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE unidades (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tipos_documento (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(5) UNIQUE NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE centros_costos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- 3. TABLAS DE ACTORES
-- ---------------------------------------------------------------

CREATE TABLE proveedores (
    id SERIAL PRIMARY KEY,
    empresa VARCHAR(255) NOT NULL,
    nombre_contacto VARCHAR(255),
    telefono VARCHAR(20),
    correo VARCHAR(100),
    dni_ruc VARCHAR(20),
    banco VARCHAR(100),
    cta_bancaria VARCHAR(100),
    servicio_producto TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE clientes (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    telefono VARCHAR(20),
    correo VARCHAR(100),
    empresa VARCHAR(255),
    dni VARCHAR(20),
    ubicacion VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE empleados (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    fecha_ingreso DATE NOT NULL,
    salario DECIMAL(12,2) NOT NULL DEFAULT 0,
    horas DECIMAL(6,1) DEFAULT 0,
    costo_hora DECIMAL(10,2) GENERATED ALWAYS AS (
        CASE WHEN horas > 0 THEN salario / horas ELSE 0 END
    ) STORED,
    periodo VARCHAR(20) DEFAULT 'Mensual',
    area_id INT REFERENCES areas(id),
    nivel VARCHAR(100),
    tiempo_acumulado DECIMAL(8,1) DEFAULT 0,
    rendimiento DECIMAL(5,2) DEFAULT 100.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- 4. CONSULTORÍAS (incluye control de inventario)
-- ---------------------------------------------------------------
CREATE TABLE consultorias (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    codigo VARCHAR(100) UNIQUE,
    area_id INT REFERENCES areas(id),
    caract_1 VARCHAR(100),
    caract_2 VARCHAR(100),
    caract_3 VARCHAR(100),
    precio DECIMAL(12,2) DEFAULT 0,
    costo_estimado DECIMAL(12,2) DEFAULT 0,
    descripcion TEXT,
    link_proforma TEXT,
    -- Campos de inventario
    existencia_actual DECIMAL(12,2) DEFAULT 0,
    valor_min DECIMAL(12,2),
    valor_max DECIMAL(12,2),
    unidad_id INT REFERENCES unidades(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- 5. OBRAS (incluye control de inventario)
-- ---------------------------------------------------------------
CREATE TABLE obras (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    codigo VARCHAR(100) UNIQUE,
    area_id INT REFERENCES areas(id),
    caract_1 VARCHAR(100),
    caract_2 VARCHAR(100),
    caract_3 VARCHAR(100),
    precio DECIMAL(12,2) DEFAULT 0,
    costo_estimado DECIMAL(12,2) DEFAULT 0,
    descripcion TEXT,
    link_proforma TEXT,
    -- Campos de inventario
    existencia_actual DECIMAL(12,2) DEFAULT 0,
    valor_min DECIMAL(12,2),
    valor_max DECIMAL(12,2),
    unidad_id INT REFERENCES unidades(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- 6. VENTAS (contratos de consultoría u obra)
-- ---------------------------------------------------------------
CREATE TABLE ventas (
    id SERIAL PRIMARY KEY,
    concepto VARCHAR(50) DEFAULT 'Venta',
    fecha_venta DATE NOT NULL,
    vencimiento DATE,
    status VARCHAR(50) CHECK (status IN ('Pendiente', 'En Ejecución', 'Finalizado', 'Pagada', 'Vencida', 'Cancelada')),
    cliente_id INT NOT NULL REFERENCES clientes(id),
    consultoria_id INT REFERENCES consultorias(id),
    obra_id INT REFERENCES obras(id),
    exist_actual DECIMAL(12,2),
    costo_invert DECIMAL(12,2),
    cantidad DECIMAL(12,2) DEFAULT 1,
    pagado DECIMAL(12,2) DEFAULT 0,
    valor_unitario DECIMAL(12,2) NOT NULL,
    cuenta_id INT REFERENCES cuentas_bancarias(id),
    forma_pago_id INT REFERENCES formas_pago(id),
    area_id INT REFERENCES areas(id),
    tipo_documento_id INT REFERENCES tipos_documento(id),
    folio_factura VARCHAR(100),
    tasa_factura DECIMAL(5,2),
    emision DATE,
    precio_final DECIMAL(12,2) NOT NULL,
    unidad_id INT REFERENCES unidades(id),
    descuento DECIMAL(12,2) DEFAULT 0,
    ingreso DECIMAL(12,2) GENERATED ALWAYS AS (precio_final - descuento) STORED,
    costo_prod DECIMAL(12,2),
    tipo_entrega VARCHAR(100),
    costo_envio DECIMAL(12,2) DEFAULT 0,
    fecha_envio DATE,
    lugar_entrega VARCHAR(255),
    fecha_entrega DATE,
    comentarios TEXT,
    codigo VARCHAR(100),
    status_pago VARCHAR(50) CHECK (status_pago IN ('Pagada', 'Pendiente', 'Parcial')),
    monto_pendiente DECIMAL(12,2) DEFAULT 0,
    ganancia DECIMAL(12,2) GENERATED ALWAYS AS (precio_final - descuento - COALESCE(costo_prod,0) - costo_envio) STORED,
    margen DECIMAL(5,2) GENERATED ALWAYS AS (
        CASE WHEN (precio_final - descuento) > 0 
             THEN ((precio_final - descuento - COALESCE(costo_prod,0) - costo_envio) / (precio_final - descuento)) * 100 
             ELSE 0 
        END
    ) STORED,
    facturacion BOOLEAN DEFAULT FALSE,
    impuestos_id INT REFERENCES impuestos(id),
    no_venta INT,
    tipo VARCHAR(50),
    mes_fact INT CHECK (mes_fact BETWEEN 1 AND 12),
    año_fact INT,
    mes INT CHECK (mes BETWEEN 1 AND 12),
    año INT,
    registro TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_ventas_documento UNIQUE (tipo_documento_id, folio_factura),
    CONSTRAINT chk_venta_entidad CHECK (
        (consultoria_id IS NOT NULL AND obra_id IS NULL) OR
        (consultoria_id IS NULL AND obra_id IS NOT NULL)
    )
);

-- ---------------------------------------------------------------
-- 7. SEGUIMIENTO DE PROYECTOS
-- ---------------------------------------------------------------
CREATE TABLE seguimiento_proyectos (
    id SERIAL PRIMARY KEY,
    venta_id INT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    porcentaje_avance DECIMAL(5,2) CHECK (porcentaje_avance BETWEEN 0 AND 100),
    descripcion TEXT,
    responsable_id INT REFERENCES empleados(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- 8. GASTOS / CUENTAS POR PAGAR (completo)
-- ---------------------------------------------------------------
CREATE TABLE gastos (
    id SERIAL PRIMARY KEY,
    status VARCHAR(50) CHECK (status IN ('Pagada', 'Pendiente', 'Vencida', 'Parcial')),
    fecha_gasto DATE NOT NULL,
    vencimiento DATE,
    tipo_gasto_id INT NOT NULL REFERENCES tipos_gasto(id),
    concepto_gasto_id INT NOT NULL REFERENCES conceptos_gasto(id),
    proveedor_id INT NOT NULL REFERENCES proveedores(id),
    costo_unitario DECIMAL(12,2) DEFAULT 0,
    pagado DECIMAL(12,2) DEFAULT 0,
    area_id INT REFERENCES areas(id),
    proyecto_id INT REFERENCES ventas(id),
    centro_costo_id INT REFERENCES centros_costos(id),
    nombre VARCHAR(255),
    cantidad DECIMAL(12,2) DEFAULT 1,
    unidad_id INT REFERENCES unidades(id),
    forma_pago_id INT REFERENCES formas_pago(id),
    cuenta_id INT REFERENCES cuentas_bancarias(id),
    tipo_documento_id INT REFERENCES tipos_documento(id),
    folio_factura VARCHAR(100),
    tasa_factura DECIMAL(5,2),
    emision DATE,
    descripcion TEXT,
    codigo VARCHAR(100),
    status_pago VARCHAR(50) CHECK (status_pago IN ('Pagada', 'Pendiente', 'Parcial')),
    costo_final DECIMAL(12,2) GENERATED ALWAYS AS (costo_unitario * cantidad) STORED,
    egreso DECIMAL(12,2) GENERATED ALWAYS AS (pagado) STORED,
    monto_pendiente DECIMAL(12,2) GENERATED ALWAYS AS (costo_unitario * cantidad - pagado) STORED,
    gasto_abono DECIMAL(12,2) DEFAULT 0,
    facturacion BOOLEAN DEFAULT FALSE,
    impuestos_id INT REFERENCES impuestos(id),
    no_gasto INT,
    costo_final_unitario DECIMAL(12,2),
    mes_fact INT CHECK (mes_fact BETWEEN 1 AND 12),
    año_fact INT,
    mes INT CHECK (mes BETWEEN 1 AND 12),
    año INT,
    -- Módulo de pagos
    moneda VARCHAR(10) DEFAULT 'PEN',
    tipo_cambio DECIMAL(10,4),
    numero_operacion VARCHAR(100),
    igv_monto DECIMAL(12,2) DEFAULT 0,
    retencion_ir_monto DECIMAL(12,2) DEFAULT 0,
    neto_pagar DECIMAL(12,2) GENERATED ALWAYS AS (costo_unitario * cantidad - igv_monto - retencion_ir_monto) STORED,
    prioridad VARCHAR(10) CHECK (prioridad IN ('Alta', 'Media', 'Baja')),
    responsable_id INT REFERENCES empleados(id),
    adjunto_url TEXT,
    registro TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_gastos_documento UNIQUE (proveedor_id, tipo_documento_id, folio_factura)
);

-- ---------------------------------------------------------------
-- 9. PAGOS / ABONOS
-- ---------------------------------------------------------------
CREATE TABLE pagos_abonos (
    id SERIAL PRIMARY KEY,
    concepto VARCHAR(50) CHECK (concepto IN ('Abono', 'Pago Gasto')) NOT NULL,
    fecha_abono DATE NOT NULL,
    venta_id INT REFERENCES ventas(id),
    gasto_id INT REFERENCES gastos(id),
    monto DECIMAL(12,2) NOT NULL,
    cuenta_id INT REFERENCES cuentas_bancarias(id),
    forma_pago_id INT REFERENCES formas_pago(id),
    area_id INT REFERENCES areas(id),
    folio_factura VARCHAR(100),
    tasa_factura DECIMAL(5,2),
    emision DATE,
    comentarios TEXT,
    restante DECIMAL(12,2),
    numero_operacion VARCHAR(100),
    adjunto_url TEXT,
    registro TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_referencia CHECK (
        (venta_id IS NOT NULL AND gasto_id IS NULL) OR
        (venta_id IS NULL AND gasto_id IS NOT NULL)
    )
);

-- ---------------------------------------------------------------
-- 10. FRACCIONAMIENTO DE PAGOS
-- ---------------------------------------------------------------
CREATE TABLE fraccionamientos_pago (
    id SERIAL PRIMARY KEY,
    gasto_id INT NOT NULL REFERENCES gastos(id) ON DELETE CASCADE,
    numero_armada INT NOT NULL CHECK (numero_armada > 0),
    fecha_programada DATE NOT NULL,
    monto DECIMAL(12,2) NOT NULL,
    estado VARCHAR(20) DEFAULT 'Pendiente' CHECK (estado IN ('Pendiente', 'Pagada', 'Vencida')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(gasto_id, numero_armada)
);

-- ---------------------------------------------------------------
-- 11. ENVÍOS
-- ---------------------------------------------------------------
CREATE TABLE envios (
    id SERIAL PRIMARY KEY,
    venta_id INT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
    cliente_id INT REFERENCES clientes(id),
    producto_nombre VARCHAR(255),
    cantidad DECIMAL(12,2),
    fecha_venta DATE,
    costo_envio DECIMAL(12,2) DEFAULT 0,
    tipo_entrega VARCHAR(100),
    fecha_envio DATE,
    lugar_entrega VARCHAR(255),
    fecha_entrega DATE,
    estatus VARCHAR(50) CHECK (estatus IN ('Por enviar', 'En tránsito', 'Entregado', 'Error', 'Enviar hoy', 'Entregar hoy')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- 12. PLANEACIÓN Y RESULTADOS
-- ---------------------------------------------------------------
CREATE TABLE metas (
    id SERIAL PRIMARY KEY,
    mes INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
    año INT NOT NULL,
    objetivo_ingreso DECIMAL(12,2) NOT NULL DEFAULT 0,
    meta_anual DECIMAL(12,2),
    crecimiento DECIMAL(5,2),
    UNIQUE(mes, año)
);

CREATE TABLE resultados_mensuales (
    id SERIAL PRIMARY KEY,
    año INT NOT NULL,
    mes INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
    semana INT CHECK (semana BETWEEN 1 AND 5),
    codigo_contable VARCHAR(20) NOT NULL,
    concepto VARCHAR(255) NOT NULL,
    monto DECIMAL(12,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE presupuesto_envios (
    id SERIAL PRIMARY KEY,
    paqueteria VARCHAR(100),
    invertido DECIMAL(12,2) DEFAULT 0,
    gastado DECIMAL(12,2) DEFAULT 0,
    disponible DECIMAL(12,2) GENERATED ALWAYS AS (invertido - gastado) STORED,
    año INT,
    mes INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------
-- 13. ÍNDICES
-- ---------------------------------------------------------------
CREATE INDEX idx_consultorias_codigo ON consultorias(codigo);
CREATE INDEX idx_obras_codigo ON obras(codigo);
CREATE INDEX idx_ventas_fecha ON ventas(fecha_venta);
CREATE INDEX idx_ventas_cliente ON ventas(cliente_id);
CREATE INDEX idx_ventas_status ON ventas(status);
CREATE INDEX idx_ventas_consultoria ON ventas(consultoria_id);
CREATE INDEX idx_ventas_obra ON ventas(obra_id);
CREATE INDEX idx_seguimiento_venta ON seguimiento_proyectos(venta_id);
CREATE INDEX idx_seguimiento_fecha ON seguimiento_proyectos(fecha);
CREATE INDEX idx_gastos_fecha ON gastos(fecha_gasto);
CREATE INDEX idx_gastos_proveedor ON gastos(proveedor_id);
CREATE INDEX idx_gastos_proyecto ON gastos(proyecto_id);
CREATE INDEX idx_gastos_prioridad ON gastos(prioridad);
CREATE INDEX idx_pagos_fecha ON pagos_abonos(fecha_abono);
CREATE INDEX idx_pagos_gasto ON pagos_abonos(gasto_id);
CREATE INDEX idx_fraccionamientos_gasto ON fraccionamientos_pago(gasto_id);
CREATE INDEX idx_envios_estatus ON envios(estatus);
CREATE INDEX idx_resultados_periodo ON resultados_mensuales(año, mes, semana);

-- ---------------------------------------------------------------
-- 14. DATOS INICIALES
-- ---------------------------------------------------------------

INSERT INTO areas (nombre) VALUES
('GERENCIA'), ('ADMINISTRACIÓN'), ('COMERCIAL'), ('CONSULTORIA'),
('OBRA LIMA 1'), ('OBRA LIMA 2'), ('OBRA BARRANCO'), ('OBRA ASIA'),
('OBRA CHORRILLOS'), ('OBRA LA MOLINA'), ('OBRA CONDEVILLA'), ('OBRA BREÑA'),
('OBRA SAN ISIDRO'), ('SUPERVISIÓN BARRANCO')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO cuentas_bancarias (nombre, numero_cuenta) VALUES
('CTA CTE BCP', '193-23456789-0-12'),
('CTA CTE IBK', NULL),
('BCP GUILLERMO', NULL),
('BBVA GUILLERMO', NULL),
('BCP WILLY', NULL),
('BCP PIERINA', NULL),
('BCP ROMINA', NULL),
('IBK GUILLERMO', NULL),
('PROVEEDOR EXTERNO', NULL)
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO formas_pago (nombre) VALUES
('TRANSFERENCIA'), ('TRANSFERENCIA INTERNA'), ('EFECTIVO'), ('YAPE'),
('PLIN'), ('DEPÓSITO')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO tipos_gasto (nombre) VALUES
('HONORARIOS'), ('ALQUILERES'), ('SERVICIOS'), ('SUB CONTRATA'),
('COMPRAS'), ('MOVILIDAD'), ('IMPUESTOS'), ('PRESTAMO')
ON CONFLICT (nombre) DO NOTHING;

WITH tg AS (
    SELECT id, nombre FROM tipos_gasto
)
INSERT INTO conceptos_gasto (nombre, tipo_gasto_id)
SELECT nom, tg.id
FROM (VALUES
    ('OFICINA TECNICA', 'HONORARIOS'),
    ('HONORARIOS FIRMA', 'HONORARIOS'),
    ('COMISION VENTAS', 'HONORARIOS'),
    ('GESTOR(A) DE PROYECTOS', 'HONORARIOS'),
    ('OTROS HONORARIOS', 'HONORARIOS'),
    ('OTROS ALQUILER', 'ALQUILERES'),
    ('INTERNET', 'SERVICIOS'),
    ('IMPRENTA', 'SERVICIOS'),
    ('ALMACENAMIENTO', 'SERVICIOS'),
    ('MUNICIPALIDAD', 'SERVICIOS'),
    ('SUNARP', 'SERVICIOS'),
    ('OTROS SERVICIOS', 'SERVICIOS'),
    ('CALICATAS', 'SUB CONTRATA'),
    ('ENSAYOS LABORATORIO', 'SUB CONTRATA'),
    ('EQUIPO TOPOGRAFICO', 'SUB CONTRATA'),
    ('OTROS SUBCONTRATOS', 'SUB CONTRATA'),
    ('UTILES DE LIMPIEZA', 'COMPRAS'),
    ('UTILES DE OFICINA', 'COMPRAS'),
    ('ALIMENTOS', 'COMPRAS'),
    ('FESTIVIDAD', 'COMPRAS'),
    ('FERRETERÍA', 'COMPRAS'),
    ('OTRAS COMPRAS', 'COMPRAS'),
    ('VISITA TECNICA', 'MOVILIDAD'),
    ('ENVIOS Y RECOJOS', 'MOVILIDAD'),
    ('OTRAS MOVILIDADES', 'MOVILIDAD'),
    ('PEAJES', 'MOVILIDAD'),
    ('DETRACCION', 'IMPUESTOS'),
    ('OTROS IMPUESTOS', 'IMPUESTOS'),
    ('CONSULTORÍA A OBRA LIMA 1', 'PRESTAMO'),
    ('CONSULTORÍA A OBRA LIMA 2', 'PRESTAMO'),
    ('CONSULTORÍA A OBRA ASIA', 'PRESTAMO'),
    ('CONSULTORÍA A OBRA CHORRILLOS', 'PRESTAMO'),
    ('CONSULTORÍA A OBRA LA MOLINA', 'PRESTAMO'),
    ('CONSULTORÍA A SUPERVISIÓN BARRANCO', 'PRESTAMO'),
    ('CONSULTORÍA A OBRA CONDEVILLA', 'PRESTAMO'),
    ('CONSULTORÍA A OBRA BREÑA', 'PRESTAMO'),
    ('CONSULTORÍA A OBRA SAN ISIDRO', 'PRESTAMO')
) AS t(nom, tipo_nombre)
JOIN tg ON tg.nombre = t.tipo_nombre
ON CONFLICT (nombre, tipo_gasto_id) DO NOTHING;

INSERT INTO impuestos (nombre, tasa) VALUES
('IGV 18%', 18.00),
('Adicional 8%', 8.00),
('Adicional 10%', 10.00)
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO unidades (nombre) VALUES
('Kg'), ('Proyecto'), ('Hrs'), ('Unidades')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO tipos_documento (codigo, nombre) VALUES
('01', 'Factura'),
('03', 'Boleta de Venta'),
('07', 'Nota de Crédito'),
('08', 'Nota de Débito'),
('09', 'Guía de Remisión Remitente'),
('12', 'Ticket o Cinta de Máquina Registradora'),
('13', 'Documento Electrónico (Factura Electrónica)'),
('14', 'Recibo por Honorarios'),
('15', 'Recibo de Arrendamiento'),
('16', 'Comprobante de Retención'),
('17', 'Comprobante de Percepción'),
('20', 'Liquidación de Compra'),
('21', 'Otros Comprobantes de Pago')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO centros_costos (nombre) VALUES
('Estructuras'), ('Acabados'), ('Instalaciones'), ('Diseño'), ('Administración')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO empresa (id, nombre, saldo_inicial, monto_inicio, cuenta_inicio, fecha_inicio)
VALUES (1, 'CASALLO & MELCHOR', 29.20, 0, 'BCP', '2025-01-01')
ON CONFLICT (id) DO NOTHING;

INSERT INTO metas (mes, año, objetivo_ingreso) VALUES
(1,2025,40000),(2,2025,40000),(3,2025,40000),(4,2025,40000),
(5,2025,40000),(6,2025,40000),(7,2025,40000),(8,2025,40000),
(9,2025,40000),(10,2025,40000),(11,2025,40000),(12,2025,40000)
ON CONFLICT (mes, año) DO NOTHING;

-- ---------------------------------------------------------------
-- 15. COMENTARIOS
-- ---------------------------------------------------------------
COMMENT ON TABLE empresa IS 'Configuración general de la empresa';
COMMENT ON TABLE areas IS 'Áreas/departamentos';
COMMENT ON TABLE cuentas_bancarias IS 'Cuentas bancarias con número';
COMMENT ON TABLE formas_pago IS 'Métodos de pago';
COMMENT ON TABLE tipos_gasto IS 'Categorías de gasto nivel 1';
COMMENT ON TABLE conceptos_gasto IS 'Subcategorías de gasto nivel 2';
COMMENT ON TABLE impuestos IS 'Tipos de impuesto y tasas';
COMMENT ON TABLE unidades IS 'Unidades de medida';
COMMENT ON TABLE tipos_documento IS 'Comprobantes de pago (Factura, Boleta, etc.)';
COMMENT ON TABLE centros_costos IS 'Centros de costo para gastos';
COMMENT ON TABLE empleados IS 'Nómina del equipo';
COMMENT ON TABLE proveedores IS 'Proveedores';
COMMENT ON TABLE clientes IS 'Clientes';
COMMENT ON TABLE consultorias IS 'Catálogo de servicios de consultoría';
COMMENT ON TABLE obras IS 'Catálogo de proyectos de construcción';
COMMENT ON TABLE ventas IS 'Contratos de consultoría u obra';
COMMENT ON TABLE seguimiento_proyectos IS 'Avance físico de proyectos';
COMMENT ON TABLE gastos IS 'Cuentas por pagar con retenciones y pagos';
COMMENT ON TABLE pagos_abonos IS 'Abonos de clientes o pagos a proveedores';
COMMENT ON TABLE fraccionamientos_pago IS 'Plan de pagos fraccionados';
COMMENT ON TABLE envios IS 'Envíos de productos/planos';
COMMENT ON TABLE metas IS 'Metas financieras mensuales';
COMMENT ON TABLE resultados_mensuales IS 'Resultados contables por período';
COMMENT ON TABLE presupuesto_envios IS 'Presupuesto de envíos';

COMMIT;