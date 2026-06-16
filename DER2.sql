-- ============================================================
-- BASE DE DATOS CONSTRUNI
-- Versión final integrada con todos los módulos
-- ============================================================

-- ------------------------------------------------------------
-- 1. ENTIDADES BASE (CLIENTES, PROVEEDORES, ÁREAS)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cliente (
    id_cliente         BIGSERIAL PRIMARY KEY,
    tip_persona        VARCHAR(4),
    nombre             VARCHAR(200) NOT NULL,
    tipo_doc           VARCHAR(4),
    num_documento      VARCHAR(11),
    direccion          TEXT,
    telefono           VARCHAR(20),
    email              VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proveedor (
    id_proveedor       BIGSERIAL PRIMARY KEY,
    razon_social       VARCHAR(200) NOT NULL,
    ruc                VARCHAR(11),
    contacto           VARCHAR(100),
    telefono           VARCHAR(20),
    email              VARCHAR(100),
    vendedor           VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS area (
    id_area            VARCHAR(100) PRIMARY KEY,
    nombre             VARCHAR(100) NOT NULL,
    descripcion        TEXT,
    responsable        VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 2. CENTRO DE COSTO (UNIFICA PROYECTOS Y ÁREAS)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS centro_costo (
    id_centro_costo    BIGSERIAL PRIMARY KEY,
    codigo             VARCHAR(50) NOT NULL,
    nombre             VARCHAR(200) NOT NULL,
    tipo               VARCHAR(20) NOT NULL CHECK (tipo IN ('proyecto', 'area', 'proveedor', 'cliente', 'otro')),
    id_referencia      BIGINT NOT NULL, -- FK a proyecto.id_proyecto o area.id_area
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 3. PROYECTO (hereda de centro_costo)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS proyecto (
    id_proyecto        BIGSERIAL PRIMARY KEY,
    id_cliente         BIGINT NOT NULL REFERENCES cliente(id_cliente),
    nombre             VARCHAR(200) NOT NULL,
    ubicacion          TEXT,
    fecha_inicio_plan  DATE,
    fecha_fin_plan     DATE,
    duracion_semanas   INTEGER,
    estado             VARCHAR(20) DEFAULT 'activo',
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Vínculo obligatorio: cada proyecto es también un centro de costo
INSERT INTO centro_costo (codigo, nombre, tipo, id_referencia)
SELECT CONCAT('PROY-', p.id_proyecto), p.nombre, 'proyecto', p.id_proyecto
FROM proyecto p
ON CONFLICT DO NOTHING;  -- se puede manejar con trigger, pero para el script se asume inserción manual o trigger

-- ------------------------------------------------------------
-- 4. CATÁLOGO DE PARTIDAS (JERÁRQUICO)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS partida (
    id_partida         BIGSERIAL PRIMARY KEY,
    codigo             VARCHAR(20) NOT NULL UNIQUE, -- ej: '01.01.01.00'
    descripcion        TEXT NOT NULL,
    unidad             VARCHAR(10), -- glb, m2, m3, und, ml, mes, etc.
    nivel              INTEGER NOT NULL, -- 1,2,3...
    id_partida_padre   BIGINT REFERENCES partida(id_partida),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 5. PRESUPUESTO Y DETALLE
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS presupuesto (
    id_presupuesto     BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto),
    nombre             VARCHAR(200) NOT NULL,
    fecha_creacion     DATE DEFAULT CURRENT_DATE,
    moneda             VARCHAR(3) DEFAULT 'PEN',
    tipo               VARCHAR(20) DEFAULT 'obra', -- obra, mantenimiento, etc.
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS presupuesto_detalle (
    id_presupuesto_detalle BIGSERIAL PRIMARY KEY,
    id_presupuesto     BIGINT NOT NULL REFERENCES presupuesto(id_presupuesto) ON DELETE CASCADE,
    id_partida         BIGINT NOT NULL REFERENCES partida(id_partida),
    cantidad           DECIMAL(12,4) NOT NULL,
    precio_mo          DECIMAL(12,2) DEFAULT 0,   -- mano de obra unitario
    precio_mat         DECIMAL(12,2) DEFAULT 0,   -- material unitario
    precio_unitario    DECIMAL(12,2) GENERATED ALWAYS AS (COALESCE(precio_mo,0) + COALESCE(precio_mat,0)) STORED,
    total              DECIMAL(12,2) GENERATED ALWAYS AS (cantidad * (COALESCE(precio_mo,0) + COALESCE(precio_mat,0))) STORED,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 6. CONTRATO Y ADELANTOS
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS contrato_proyecto (
    id_contrato        BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto),
    monto_total        DECIMAL(12,2) NOT NULL,
    tipo_contrato      VARCHAR(50) DEFAULT 'a suma alzada', -- a suma alzada, unitario
    fecha_inicio       DATE,
    fecha_fin          DATE,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS adelanto (
    id_adelanto        BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto),
    fecha              DATE NOT NULL,
    monto              DECIMAL(12,2) NOT NULL,
    cuenta             VARCHAR(100), -- cuenta bancaria o referencia
    tipo               VARCHAR(50),  -- 'obra', 'subcontratista'
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 7. RESTRICCIONES (del análisis de restricciones)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS restriccion (
    id_restriccion     BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    actividad_relacionada VARCHAR(200) NOT NULL,
    monto_estimado     DECIMAL(12,2),
    fecha_maxima       DATE NOT NULL,
    es_finanzas        BOOLEAN DEFAULT FALSE,
    es_of_tecnica      BOOLEAN DEFAULT FALSE,
    es_mobra           BOOLEAN DEFAULT FALSE,
    responsable        VARCHAR(200),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 8. SEGUIMIENTO DE PROYECTO (general, por fechas)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS seguimiento_proyecto (
    id_seguimiento     BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    fecha_seguimiento  DATE NOT NULL,
    porcentaje_avance_fisico DECIMAL(5,2) DEFAULT 0,
    porcentaje_avance_financiero DECIMAL(5,2) DEFAULT 0,
    costo_real_acumulado DECIMAL(12,2) DEFAULT 0,
    ingreso_real_acumulado DECIMAL(12,2) DEFAULT 0,
    horas_trabajadas_acum DECIMAL(10,2),
    observaciones      TEXT,
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 9. CRONOGRAMA DE OBRA (16 semanas u horizonte variable)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cronograma_actividad (
    id_cronograma_actividad BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    nombre_actividad   VARCHAR(200) NOT NULL,
    nivel              INTEGER NOT NULL, -- 1=grupo, 2=subgrupo, 3=actividad
    id_actividad_padre BIGINT REFERENCES cronograma_actividad(id_cronograma_actividad),
    semana_inicio_plan INTEGER,  -- número de semana (1..N)
    semana_fin_plan    INTEGER,
    duracion_semanas   INTEGER GENERATED ALWAYS AS (semana_fin_plan - semana_inicio_plan + 1) STORED,
    fecha_inicio_real  DATE,
    fecha_fin_real     DATE,
    porcentaje_avance_real DECIMAL(5,2) DEFAULT 0,
    orden              INTEGER,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Detalle semana a semana del avance (opcional)
CREATE TABLE IF NOT EXISTS cronograma_detalle_semanal (
    id_cronograma_detalle BIGSERIAL PRIMARY KEY,
    id_cronograma_actividad BIGINT NOT NULL REFERENCES cronograma_actividad(id_cronograma_actividad) ON DELETE CASCADE,
    semana_numero      INTEGER NOT NULL,
    avance_planificado_semanal DECIMAL(5,2) DEFAULT 0,
    avance_real_semanal DECIMAL(5,2) DEFAULT 0,
    observaciones      TEXT,
    UNIQUE(id_cronograma_actividad, semana_numero)
);

-- ------------------------------------------------------------
-- 10. LOOKAHEAD PLANNING (planificación diaria)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lookahead (
    id_lookahead       BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    id_partida         BIGINT REFERENCES partida(id_partida),
    fecha_plan         DATE NOT NULL,  -- día específico
    cantidad_plan      DECIMAL(12,4),
    recurso_asignado   VARCHAR(200),   -- ej. "ROMBO 1"
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 11. PLANILLA DE METRADOS (cálculos detallados)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS metrado (
    id_metrado         BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    id_partida         BIGINT REFERENCES partida(id_partida),
    descripcion        TEXT,
    unidad             VARCHAR(10),
    cantidad           DECIMAL(12,4),
    largo              DECIMAL(10,2),
    ancho              DECIMAL(10,2),
    alto               DECIMAL(10,2),
    formula            TEXT,  -- expresión textual del cálculo
    total              DECIMAL(12,4) GENERATED ALWAYS AS (cantidad * COALESCE(largo,1) * COALESCE(ancho,1) * COALESCE(alto,1)) STORED,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 12. ACERO DETALLADO (despiece de varillas)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS acero_detalle (
    id_acero           BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    elemento           VARCHAR(100),   -- Z-1, Viga, Placa, etc.
    diametro           VARCHAR(10),    -- 3/8, 1/2, 5/8, etc.
    longitud_m         DECIMAL(10,2),
    cantidad_varillas  INTEGER,
    peso_total_kg      DECIMAL(12,2),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 13. VALORIZACIONES SEMANALES (avance financiero)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS valorizacion_semanal (
    id_valorizacion    BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    semana_numero      INTEGER NOT NULL,
    fecha_inicio       DATE,
    fecha_fin          DATE,
    monto_total        DECIMAL(12,2) NOT NULL,
    porcentaje_acumulado DECIMAL(5,2),  -- % avance acumulado del proyecto
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Detalle de valorización por partida (opcional)
CREATE TABLE IF NOT EXISTS valorizacion_partida (
    id_valorizacion_partida BIGSERIAL PRIMARY KEY,
    id_valorizacion    BIGINT NOT NULL REFERENCES valorizacion_semanal(id_valorizacion) ON DELETE CASCADE,
    id_partida         BIGINT NOT NULL REFERENCES partida(id_partida),
    monto              DECIMAL(12,2) NOT NULL,
    porcentaje_avance  DECIMAL(5,2),  -- avance de esa partida en la semana
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 14. EGRESOS SEMANALES (flujo de caja)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS egreso_semanal (
    id_egreso          BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    semana_numero      INTEGER NOT NULL,
    concepto           VARCHAR(100) NOT NULL,  -- 'Costo Materiales', 'Seguridad', etc.
    monto              DECIMAL(12,2) NOT NULL,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 15. CUENTAS POR COBRAR (CLIENTE)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cuentas_cobrar (
    id_cuenta_cobrar   BIGSERIAL PRIMARY KEY,
    id_cliente         BIGINT NOT NULL REFERENCES cliente(id_cliente),
    id_proyecto        BIGINT REFERENCES proyecto(id_proyecto),  -- opcional
    monto              DECIMAL(12,2) NOT NULL,
    fecha_emision      DATE NOT NULL,
    fecha_vencimiento  DATE,
    estado             VARCHAR(20) DEFAULT 'pendiente', -- pendiente, pagado, vencido
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cobros (
    id_cobro           BIGSERIAL PRIMARY KEY,
    id_cuenta_cobrar   BIGINT NOT NULL REFERENCES cuentas_cobrar(id_cuenta_cobrar) ON DELETE CASCADE,
    monto              DECIMAL(12,2) NOT NULL,
    fecha_cobro        DATE NOT NULL,
    medio_pago         VARCHAR(50),
    referencia         VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 16. CUENTAS POR PAGAR (PROVEEDORES, GENERADAS POR PRESUPUESTO)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cuentas_pagar (
    id_cuenta_pagar    BIGSERIAL PRIMARY KEY,
    id_proveedor       BIGINT NOT NULL REFERENCES proveedor(id_proveedor),
    id_presupuesto     BIGINT REFERENCES presupuesto(id_presupuesto),  -- relación clave
    id_partida         BIGINT REFERENCES partida(id_partida),  -- opcional
    monto_comprometido DECIMAL(12,2) NOT NULL,
    fecha_emision      DATE NOT NULL,
    fecha_vencimiento  DATE,
    estado             VARCHAR(20) DEFAULT 'pendiente',
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pagos (
    id_pago            BIGSERIAL PRIMARY KEY,
    id_cuenta_pagar    BIGINT NOT NULL REFERENCES cuentas_pagar(id_cuenta_pagar) ON DELETE CASCADE,
    monto              DECIMAL(12,2) NOT NULL,
    fecha_pago         DATE NOT NULL,
    medio_pago         VARCHAR(50),
    referencia         VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 17. MOVIMIENTOS / TRANSACCIONES (Centro de Costo)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS transaccion (
    id_transaccion     BIGSERIAL PRIMARY KEY,
    id_centro_costo_origen    BIGINT NOT NULL REFERENCES centro_costo(id_centro_costo),
    id_centro_costo_destino   BIGINT NOT NULL REFERENCES centro_costo(id_centro_costo),
    fecha              DATE NOT NULL,
    descripcion        TEXT,
    tipo               VARCHAR(20) CHECK (tipo IN ('ingreso', 'egreso')),
    monto_total        DECIMAL(12,2) NOT NULL,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trans_detalle (
    id_trans_detalle   BIGSERIAL PRIMARY KEY,
    id_transaccion     BIGINT NOT NULL REFERENCES transaccion(id_transaccion) ON DELETE CASCADE,
    id_partida         BIGINT REFERENCES partida(id_partida),
    cantidad           DECIMAL(12,4),
    precio_unitario    DECIMAL(12,2),
    subtotal           DECIMAL(12,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 18. TABLAS AUXILIARES (PRECIOS DE RECURSOS)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS recurso_precio (
    id_recurso         BIGSERIAL PRIMARY KEY,
    tipo               VARCHAR(20) NOT NULL CHECK (tipo IN ('mano_obra', 'material', 'equipo')),
    nombre             VARCHAR(100) NOT NULL,
    unidad             VARCHAR(20),
    precio_unitario    DECIMAL(12,2) NOT NULL,
    fecha_vigencia     DATE DEFAULT CURRENT_DATE,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- ÍNDICES PARA RENDIMIENTO
-- ------------------------------------------------------------

CREATE INDEX idx_proyecto_cliente ON proyecto(id_cliente);
CREATE INDEX idx_presupuesto_proyecto ON presupuesto(id_proyecto);
CREATE INDEX idx_presupuesto_detalle_partida ON presupuesto_detalle(id_partida);
CREATE INDEX idx_cronograma_proyecto ON cronograma_actividad(id_proyecto);
CREATE INDEX idx_valorizacion_proyecto ON valorizacion_semanal(id_proyecto);
CREATE INDEX idx_cuentas_pagar_presupuesto ON cuentas_pagar(id_presupuesto);
CREATE INDEX idx_transaccion_centro ON transaccion(id_centro_costo);
CREATE INDEX idx_restriccion_proyecto ON restriccion(id_proyecto);
CREATE INDEX idx_metrado_proyecto ON metrado(id_proyecto);
CREATE INDEX idx_acero_proyecto ON acero_detalle(id_proyecto);
CREATE INDEX idx_lookahead_proyecto ON lookahead(id_proyecto);
CREATE INDEX idx_egreso_proyecto_semana ON egreso_semanal(id_proyecto, semana_numero);

-- ------------------------------------------------------------
-- COMENTARIOS (OPCIONAL)
-- ------------------------------------------------------------

COMMENT ON TABLE proyecto IS 'Proyectos de construcción, cada uno es también un centro de costo';
COMMENT ON TABLE partida IS 'Catálogo jerárquico de partidas (código APU)';
COMMENT ON TABLE presupuesto_detalle IS 'Detalle de precios unitarios y cantidades por partida';
COMMENT ON TABLE cronograma_actividad IS 'Actividades del cronograma de obra (16+ semanas)';
COMMENT ON TABLE lookahead IS 'Planificación diaria detallada (lookahead)';
COMMENT ON TABLE metrado IS 'Cálculos de cantidades de obra (planilla de metrados)';
COMMENT ON TABLE valorizacion_semanal IS 'Valorizaciones semanales del proyecto';
COMMENT ON TABLE cuentas_pagar IS 'Obligaciones generadas por el presupuesto de obra';
COMMENT ON TABLE transaccion IS 'Movimientos económicos por centro de costo';

-- ------------------------------------------------------------
-- NOTA: LAS TABLAS DE SEGURIDAD (ROLES, PERSONAL, ROL_PERMISO, PERMISOS)
-- NO SE MODIFICAN - SE DEJAN INTACTAS SEGÚN EL DISEÑO ANTERIOR
-- ------------------------------------------------------------