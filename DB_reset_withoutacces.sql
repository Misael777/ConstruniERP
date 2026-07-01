-- ============================================================
-- BASE DE DATOS CONSTRUNI
-- Reset del esquema de negocio (preserva tablas de acceso/auth)
-- ============================================================
-- NOTA: Este script NO toca las tablas de IAM/auth:
--   area, roles, permisos, roles_permisos, empleados
-- y tampoco modifica sus funciones/policies asociadas.

DROP INDEX IF EXISTS idx_proyecto_cliente CASCADE;
DROP INDEX IF EXISTS idx_presupuesto_proyecto CASCADE;
DROP INDEX IF EXISTS idx_presupuesto_detalle_partida CASCADE;
DROP INDEX IF EXISTS idx_cronograma_proyecto CASCADE;
DROP INDEX IF EXISTS idx_valorizacion_proyecto CASCADE;
DROP INDEX IF EXISTS idx_cuentas_pagar_presupuesto CASCADE;
DROP INDEX IF EXISTS idx_transaccion_centro CASCADE;
DROP INDEX IF EXISTS idx_restriccion_proyecto CASCADE;
DROP INDEX IF EXISTS idx_metrado_proyecto CASCADE;
DROP INDEX IF EXISTS idx_acero_proyecto CASCADE;
DROP INDEX IF EXISTS idx_lookahead_proyecto CASCADE;
DROP INDEX IF EXISTS idx_egreso_proyecto_semana CASCADE;
DROP INDEX IF EXISTS idx_documento_proyecto_proyecto CASCADE;
DROP INDEX IF EXISTS idx_partida_padre CASCADE;
DROP INDEX IF EXISTS idx_audit_project_table CASCADE;
DROP INDEX IF EXISTS idx_audit_record CASCADE;
DROP INDEX IF EXISTS idx_audit_changed_at CASCADE;

DROP TABLE IF EXISTS trans_detalle CASCADE;
DROP TABLE IF EXISTS transaccion CASCADE;
DROP TABLE IF EXISTS pagos CASCADE;
DROP TABLE IF EXISTS cuentas_pagar CASCADE;
DROP TABLE IF EXISTS cobros CASCADE;
DROP TABLE IF EXISTS cuentas_cobrar CASCADE;
DROP TABLE IF EXISTS egreso_semanal CASCADE;
DROP TABLE IF EXISTS valorizacion_partida CASCADE;
DROP TABLE IF EXISTS valorizacion_semanal CASCADE;
DROP TABLE IF EXISTS acero_detalle CASCADE;
DROP TABLE IF EXISTS metrado CASCADE;
DROP TABLE IF EXISTS lookahead CASCADE;
DROP TABLE IF EXISTS cronograma_detalle_semanal CASCADE;
DROP TABLE IF EXISTS cronograma_actividad CASCADE;
DROP TABLE IF EXISTS seguimiento_proyecto CASCADE;
DROP TABLE IF EXISTS restriccion CASCADE;
DROP TABLE IF EXISTS adelanto CASCADE;
DROP TABLE IF EXISTS contrato_proyecto CASCADE;
DROP TABLE IF EXISTS presupuesto_detalle CASCADE;
DROP TABLE IF EXISTS presupuesto CASCADE;
DROP TABLE IF EXISTS plantilla_detalle CASCADE;
DROP TABLE IF EXISTS plantilla_presupuesto CASCADE;
DROP TABLE IF EXISTS partida CASCADE;
DROP TABLE IF EXISTS centro_costo CASCADE;
DROP TABLE IF EXISTS documento_proyecto CASCADE;
DROP TABLE IF EXISTS proyecto CASCADE;
DROP TABLE IF EXISTS proveedor CASCADE;
DROP TABLE IF EXISTS cliente CASCADE;
DROP TABLE IF EXISTS recurso_precio CASCADE;
DROP TABLE IF EXISTS instance_audit_log CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_partida_tree;
DROP FUNCTION IF EXISTS capture_instance_audit() CASCADE;
DROP FUNCTION IF EXISTS check_partida_cycle() CASCADE;
DROP FUNCTION IF EXISTS trg_set_updated_at_documento() CASCADE;

-- ------------------------------------------------------------
-- 1. ENTIDADES BASE (CLIENTES, PROVEEDORES, ÁREAS)
-- ------------------------------------------------------------

CREATE TABLE cliente (
    id_cliente         BIGSERIAL PRIMARY KEY,
    tip_persona        VARCHAR(4),
    nombre             VARCHAR(200) NOT NULL,
    tipo_doc           VARCHAR(4),
    num_documento      VARCHAR(11),
    direccion          TEXT,
    telefono           VARCHAR(20),
    email              VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    usuario_registro   VARCHAR(100),
    updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE proveedor (
    id_proveedor       BIGSERIAL PRIMARY KEY,
    razon_social       VARCHAR(200) NOT NULL,
    ruc                VARCHAR(11),
    contacto           VARCHAR(100),
    telefono           VARCHAR(20),
    email              VARCHAR(100),
    vendedor           VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    usuario_registro   VARCHAR(100),
    updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 2. CENTRO DE COSTO (UNIFICA PROYECTOS Y ÁREAS)
-- ------------------------------------------------------------

CREATE TABLE centro_costo (
    id_centro_costo    BIGSERIAL PRIMARY KEY,
    codigo             VARCHAR(50) NOT NULL,
    nombre             VARCHAR(200) NOT NULL,
    tipo               VARCHAR(20) NOT NULL CHECK (tipo IN ('obra', 'consultoria', 'area', 'otro')),
    monto_ctual        NUMERIC(12,2),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 3. PROYECTO (hereda de centro_costo)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS proyecto (
    id_proyecto        BIGSERIAL PRIMARY KEY,
    id_cliente         BIGINT NOT NULL REFERENCES cliente(id_cliente),
    tip_proyecto       VARCHAR(4),
    nombre_proyecto    VARCHAR(200) NOT NULL,
    ubicacion          TEXT,
    fecha_inicio_plan  DATE,
    fecha_fin_plan     DATE,
    estado_predio      VARCHAR(4),
    tipo_edifica       VARCHAR(4),
    Nro_pisos          INTEGER,
    distrito           VARCHAR(4),
    provincia          VARCHAR(4),
    departamento       VARCHAR(4),
    costo_estima       FLOAT,
    precio_venta       FLOAT,
    descripcion        VARCHAR(200),
    responsable        VARCHAR(200),
    duracion_semanas   INTEGER,
    usuario_registro   VARCHAR(200),
    contrato           VARCHAR(200),
    estado_proyecto    VARCHAR(20) DEFAULT 'activo',
    id_pres_inicial    BIGINT,
    id_pres_final      BIGINT,
    area_terreno       NUMERIC(12,2),
    area_construida    NUMERIC(12,2),
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW(),
    asesor_comercial_id VARCHAR(200),
    comision_asesor DECIMAL(5,2)
);

INSERT INTO centro_costo (codigo, nombre, tipo, id_referencia)
SELECT CONCAT('PROY-', p.id_proyecto), p.nombre_proyecto, 'proyecto', p.id_proyecto
FROM proyecto p
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- 3.5. DOCUMENTOS DE PROYECTO
-- ------------------------------------------------------------

CREATE TABLE documento_proyecto (
    id_documento    BIGSERIAL       PRIMARY KEY,
    id_proyecto     BIGINT          NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    nombre          VARCHAR(200)    NOT NULL,
    tipo_documento  VARCHAR(80)     NOT NULL DEFAULT 'Otro',
    descripcion     TEXT,
    version         VARCHAR(20)     NOT NULL DEFAULT 'V1.0',
    estado          VARCHAR(30)     NOT NULL DEFAULT 'borrador'
                        CHECK (estado IN ('borrador', 'revision', 'aprobado', 'rechazado')),
    storage_path    TEXT,
    storage_url     TEXT,
    file_size       BIGINT,
    file_type       VARCHAR(100),
    creado_por      VARCHAR(100),
    responsable     VARCHAR(100),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION trg_set_updated_at_documento()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_documento_proyecto_updated_at
    BEFORE UPDATE ON documento_proyecto
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at_documento();

ALTER TABLE documento_proyecto ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_full_access_documento"
    ON documento_proyecto FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- 4. CATÁLOGO DE PARTIDAS (JERÁRQUICO)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS partida (
    id_partida         BIGSERIAL PRIMARY KEY,
    codigo             VARCHAR(20) NOT NULL UNIQUE,
    tipo_partida       VARCHAR(2),
    descripcion        TEXT NOT NULL,
    unidad             VARCHAR(10),
    cuadrilla          INTEGER,
    precio_unitario    NUMERIC(12,2),
    precio_parcial     NUMERIC(12,2),
    nivel              INTEGER NOT NULL,
    id_partida_padre   BIGINT REFERENCES partida(id_partida),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_partida_padre ON partida(id_partida_padre);

ALTER TABLE partida
ADD CONSTRAINT chk_partida_no_auto FOREIGN KEY (id_partida_padre) REFERENCES partida(id_partida) ON DELETE NO ACTION;

CREATE OR REPLACE FUNCTION check_partida_cycle() RETURNS TRIGGER AS $$
DECLARE
    v_parent BIGINT := NEW.id_partida_padre;
BEGIN
    IF NEW.id_partida = NEW.id_partida_padre THEN
        RAISE EXCEPTION 'Una partida no puede ser su propio padre';
    END IF;

    WHILE v_parent IS NOT NULL LOOP
        IF v_parent = NEW.id_partida THEN
            RAISE EXCEPTION 'Ciclo detectado en jerarquía de partidas';
        END IF;
        SELECT id_partida_padre INTO v_parent FROM partida WHERE id_partida = v_parent;
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_partida_cycle
BEFORE INSERT OR UPDATE ON partida
FOR EACH ROW EXECUTE FUNCTION check_partida_cycle();

CREATE MATERIALIZED VIEW mv_partida_tree AS
WITH RECURSIVE arbol AS (
    SELECT id_partida, id_partida_padre, codigo, descripcion, 1 AS nivel
    FROM partida
    WHERE id_partida_padre IS NULL
    UNION ALL
    SELECT p.id_partida, p.id_partida_padre, p.codigo, p.descripcion, a.nivel + 1
    FROM partida p
    JOIN arbol a ON p.id_partida_padre = a.id_partida
)
SELECT id_partida, id_partida_padre, codigo, descripcion, nivel
FROM arbol;

-- ------------------------------------------------------------
-- 5. PRESUPUESTO Y DETALLE
-- ------------------------------------------------------------

CREATE TABLE presupuesto (
    id_presupuesto     BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto),
    nombre             VARCHAR(200) NOT NULL,
    fecha_creacion     DATE DEFAULT CURRENT_DATE,
    moneda             VARCHAR(3) DEFAULT 'PEN',
    tipo               VARCHAR(20) DEFAULT 'obra',
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE presupuesto_detalle (
    id_presupuesto_detalle BIGSERIAL PRIMARY KEY,
    id_presupuesto     BIGINT NOT NULL REFERENCES presupuesto(id_presupuesto) ON DELETE CASCADE,
    id_partida         BIGINT NOT NULL REFERENCES partida(id_partida),
    cantidad           DECIMAL(12,4) NOT NULL,
    precio_mo          DECIMAL(12,2) DEFAULT 0,
    precio_mat         DECIMAL(12,2) DEFAULT 0,
    precio_unitario    DECIMAL(12,2) GENERATED ALWAYS AS (COALESCE(precio_mo,0) + COALESCE(precio_mat,0)) STORED,
    total              DECIMAL(12,2) GENERATED ALWAYS AS (cantidad * (COALESCE(precio_mo,0) + COALESCE(precio_mat,0))) STORED,
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PLANTILLAS DE PRESUPUESTO (Clases compuestas)
-- ============================================================

CREATE TABLE plantilla_presupuesto (
    id_plantilla      BIGSERIAL PRIMARY KEY,
    nombre            VARCHAR(200) NOT NULL,
    descripcion       TEXT,
    tipo              VARCHAR(50),
    usuario_registro  VARCHAR(100),
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE plantilla_detalle (
    id_plantilla_detalle BIGSERIAL PRIMARY KEY,
    id_plantilla      BIGINT NOT NULL REFERENCES plantilla_presupuesto(id_plantilla) ON DELETE CASCADE,
    id_partida        BIGINT NOT NULL REFERENCES partida(id_partida),
    cantidad_sugerida DECIMAL(12,4),
    orden             INTEGER,
    usuario_registro  VARCHAR(100),
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(id_plantilla, id_partida)
);

-- ============================================================
-- AUDITORÍA DE INSTANCIAS (SOLO DATOS DE PROYECTOS)
-- ============================================================

CREATE TABLE instance_audit_log (
    id_audit          BIGSERIAL PRIMARY KEY,
    project_id        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    table_name        TEXT NOT NULL,
    record_id         BIGINT NOT NULL,
    action            TEXT NOT NULL,
    old_data          JSONB,
    new_data          JSONB,
    changed_by        UUID,
    changed_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_project_table ON instance_audit_log(project_id, table_name, changed_at DESC);
CREATE INDEX idx_audit_record ON instance_audit_log(record_id, table_name);
CREATE INDEX idx_audit_changed_at ON instance_audit_log(changed_at DESC);

-- ============================================================
-- FUNCIÓN DE AUDITORÍA POLIMÓRFICA
-- ============================================================

CREATE OR REPLACE FUNCTION capture_instance_audit()
RETURNS TRIGGER AS $$
DECLARE
    v_project_id BIGINT;
    v_table_name TEXT := TG_TABLE_NAME;
    v_old_json   JSONB;
    v_new_json   JSONB;
    v_record_id  BIGINT;
    v_actor      UUID;
BEGIN
    v_actor := auth.uid();

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        v_new_json := to_jsonb(NEW);
    END IF;
    IF TG_OP IN ('DELETE', 'UPDATE') THEN
        v_old_json := to_jsonb(OLD);
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        IF jsonb_exists(v_new_json, 'id_proyecto') THEN
            v_project_id := (v_new_json ->> 'id_proyecto')::BIGINT;
        ELSIF v_table_name = 'presupuesto_detalle' THEN
            SELECT p.id_proyecto INTO v_project_id
            FROM presupuesto p WHERE p.id_presupuesto = NEW.id_presupuesto;
        ELSIF v_table_name = 'valorizacion_partida' THEN
            SELECT vs.id_proyecto INTO v_project_id
            FROM valorizacion_semanal vs WHERE vs.id_valorizacion = NEW.id_valorizacion;
        ELSIF v_table_name = 'cronograma_detalle_semanal' THEN
            SELECT ca.id_proyecto INTO v_project_id
            FROM cronograma_actividad ca WHERE ca.id_cronograma_actividad = NEW.id_cronograma_actividad;
        END IF;
    END IF;

    IF v_project_id IS NULL AND TG_OP IN ('UPDATE', 'DELETE') THEN
        IF jsonb_exists(v_old_json, 'id_proyecto') THEN
            v_project_id := (v_old_json ->> 'id_proyecto')::BIGINT;
        ELSIF v_table_name = 'presupuesto_detalle' THEN
            SELECT p.id_proyecto INTO v_project_id
            FROM presupuesto p WHERE p.id_presupuesto = OLD.id_presupuesto;
        ELSIF v_table_name = 'valorizacion_partida' THEN
            SELECT vs.id_proyecto INTO v_project_id
            FROM valorizacion_semanal vs WHERE vs.id_valorizacion = OLD.id_valorizacion;
        ELSIF v_table_name = 'cronograma_detalle_semanal' THEN
            SELECT ca.id_proyecto INTO v_project_id
            FROM cronograma_actividad ca WHERE ca.id_cronograma_actividad = OLD.id_cronograma_actividad;
        END IF;
    END IF;

    IF v_project_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF v_new_json IS NOT NULL THEN
        v_record_id := (v_new_json ->> 'id')::BIGINT;
    ELSE
        v_record_id := (v_old_json ->> 'id')::BIGINT;
    END IF;

    INSERT INTO instance_audit_log (project_id, table_name, record_id, action, old_data, new_data, changed_by)
    VALUES (v_project_id, v_table_name, v_record_id, TG_OP, v_old_json, v_new_json, v_actor);

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 6. CONTRATO Y ADELANTOS
-- ------------------------------------------------------------

CREATE TABLE contrato_proyecto (
    id_contrato        BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto),
    monto_total        DECIMAL(12,2) NOT NULL,
    tipo_contrato      VARCHAR(50) DEFAULT 'a suma alzada',
    fecha_inicio       DATE,
    fecha_fin          DATE,
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE adelanto (
    id_adelanto        BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto),
    fecha              DATE NOT NULL,
    monto              DECIMAL(12,2) NOT NULL,
    cuenta             VARCHAR(100),
    tipo               VARCHAR(50),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 7. RESTRICCIONES
-- ------------------------------------------------------------

CREATE TABLE restriccion (
    id_restriccion     BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    actividad_relacionada VARCHAR(200) NOT NULL,
    monto_estimado     DECIMAL(12,2),
    fecha_maxima       DATE NOT NULL,
    es_finanzas        BOOLEAN DEFAULT FALSE,
    es_of_tecnica      BOOLEAN DEFAULT FALSE,
    es_mobra           BOOLEAN DEFAULT FALSE,
    responsable        VARCHAR(200),
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 8. SEGUIMIENTO DE PROYECTO
-- ------------------------------------------------------------

CREATE TABLE seguimiento_proyecto (
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
-- 9. CRONOGRAMA DE OBRA
-- ------------------------------------------------------------

CREATE TABLE cronograma_actividad (
    id_cronograma_actividad BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    nombre_actividad   VARCHAR(200) NOT NULL,
    nivel              INTEGER NOT NULL,
    id_actividad_padre BIGINT REFERENCES cronograma_actividad(id_cronograma_actividad),
    semana_inicio_plan INTEGER,
    semana_fin_plan    INTEGER,
    duracion_semanas   INTEGER GENERATED ALWAYS AS (semana_fin_plan - semana_inicio_plan + 1) STORED,
    fecha_inicio_real  DATE,
    fecha_fin_real     DATE,
    porcentaje_avance_real DECIMAL(5,2) DEFAULT 0,
    orden              INTEGER,
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cronograma_detalle_semanal (
    id_cronograma_detalle BIGSERIAL PRIMARY KEY,
    id_cronograma_actividad BIGINT NOT NULL REFERENCES cronograma_actividad(id_cronograma_actividad) ON DELETE CASCADE,
    semana_numero      INTEGER NOT NULL,
    avance_planificado_semanal DECIMAL(5,2) DEFAULT 0,
    avance_real_semanal DECIMAL(5,2) DEFAULT 0,
    observaciones      TEXT,
    usuario_registro   VARCHAR(100),
    UNIQUE(id_cronograma_actividad, semana_numero)
);

-- ------------------------------------------------------------
-- 10. LOOKAHEAD PLANNING
-- ------------------------------------------------------------

CREATE TABLE lookahead (
    id_lookahead       BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    id_partida         BIGINT REFERENCES partida(id_partida),
    fecha_plan         DATE NOT NULL,
    cantidad_plan      DECIMAL(12,4),
    recurso_asignado   VARCHAR(200),
    restriccion        VARCHAR(200),
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 11. PLANILLA DE METRADOS
-- ------------------------------------------------------------

CREATE TABLE metrado (
    id_metrado         BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    id_partida         BIGINT REFERENCES partida(id_partida),
    descripcion        TEXT,
    unidad             VARCHAR(10),
    cantidad           DECIMAL(12,4),
    largo              DECIMAL(10,2),
    ancho              DECIMAL(10,2),
    alto               DECIMAL(10,2),
    formula            TEXT,
    total              DECIMAL(12,4) GENERATED ALWAYS AS (cantidad * COALESCE(largo,1) * COALESCE(ancho,1) * COALESCE(alto,1)) STORED,
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 12. ACERO DETALLADO
-- ------------------------------------------------------------

CREATE TABLE acero_detalle (
    id_acero           BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    id_partida         BIGINT REFERENCES partida(id_partida),
    elemento           VARCHAR(100),
    diametro           VARCHAR(10),
    longitud_m         DECIMAL(10,2),
    cantidad_varillas  INTEGER,
    precio_total_kg    DECIMAL(12,2),
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 13. VALORIZACIONES SEMANALES
-- ------------------------------------------------------------

CREATE TABLE valorizacion_semanal (
    id_valorizacion    BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    semana_numero      INTEGER NOT NULL,
    fecha_inicio       DATE,
    fecha_fin          DATE,
    monto_total        DECIMAL(12,2) NOT NULL,
    porcentaje_acumulado DECIMAL(5,2),
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE valorizacion_partida (
    id_valorizacion_partida BIGSERIAL PRIMARY KEY,
    id_valorizacion    BIGINT NOT NULL REFERENCES valorizacion_semanal(id_valorizacion) ON DELETE CASCADE,
    id_partida         BIGINT NOT NULL REFERENCES partida(id_partida),
    monto              DECIMAL(12,2) NOT NULL,
    porcentaje_avance  DECIMAL(5,2),
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 14. EGRESOS SEMANALES
-- ------------------------------------------------------------

CREATE TABLE egreso_semanal (
    id_egreso          BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    semana_numero      INTEGER NOT NULL,
    concepto           VARCHAR(100) NOT NULL,
    monto              DECIMAL(12,2) NOT NULL,
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 15. CUENTAS POR COBRAR
-- ------------------------------------------------------------

CREATE TABLE cuentas_cobrar (
    id_cuenta_cobrar   BIGSERIAL PRIMARY KEY,
    id_cliente         BIGINT NOT NULL REFERENCES cliente(id_cliente),
    id_proyecto        BIGINT REFERENCES proyecto(id_proyecto),
    tipo_documento     SMALLINT,
    num_documento      VARCHAR(50),
    monto              DECIMAL(12,2) NOT NULL,
    monto_cobrado      DECIMAL(12,2) NOT NULL,
    saldo_pendiente    DECIMAL(12,2) NOT NULL,
    forma_pago         SMALLINT,
    condición_pago     SMALLINT,
    responsable        VARCHAR(20),
    fecha_emision      DATE NOT NULL,
    fecha_vencimiento  DATE,
    moneda             VARCHAR(3),
    observaciones      VARCHAR(200),
    estado             VARCHAR(20) DEFAULT 'pendiente',
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cobros (
    id_cobro           BIGSERIAL PRIMARY KEY,
    id_cuenta_cobrar   BIGINT NOT NULL REFERENCES cuentas_cobrar(id_cuenta_cobrar) ON DELETE CASCADE,
    monto              DECIMAL(12,2) NOT NULL,
    fecha_cobro        DATE NOT NULL,
    medio_cobro        SMALLINT,
    num_operacion      VARCHAR(20),
    cuenta_banco       SMALLINT,
    numero_opracion    VARCHAR(20),
    usuario_registro   VARCHAR(100),
    referencia         VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 16. CUENTAS POR PAGAR
-- ------------------------------------------------------------

CREATE TABLE cuentas_pagar (
    id_cuenta_pagar    BIGSERIAL PRIMARY KEY,
    id_proveedor       BIGINT NOT NULL REFERENCES proveedor(id_proveedor),
    id_presupuesto     BIGINT REFERENCES presupuesto(id_presupuesto),
    id_partida         BIGINT REFERENCES partida(id_partida),
    tipo_documento     SMALLINT,
    num_documento      VARCHAR(20),
    monto_comprometido DECIMAL(12,2) NOT NULL,
    monto_pagado       DECIMAL(12,2) NOT NULL,
    saldo_pendiente    DECIMAL(12,2) NOT NULL,
    fotma_pago         SMALLINT,
    categoria_gasto    SMALLINT,
    condicion_pago     VARCHAR(100),
    responsable        VARCHAR(100),
    fecha_emision      DATE NOT NULL,
    fecha_vencimiento  DATE,
    fecha_pago_programada DATE,
    monto_imponible    DECIMAL(12,2) NOT NULL,
    monto_igv          DECIMAL(12,2) NOT NULL,
    detraccion         DECIMAL(12,2),
    monto_retencion    DECIMAL(12,2),
    estado             VARCHAR(20) DEFAULT 'pendiente',
    observacion        VARCHAR(200),
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pagos (
    id_pago            BIGSERIAL PRIMARY KEY,
    id_cuenta_pagar    BIGINT NOT NULL REFERENCES cuentas_pagar(id_cuenta_pagar) ON DELETE CASCADE,
    monto              DECIMAL(12,2) NOT NULL,
    fecha_pago         DATE NOT NULL,
    medio_pago         VARCHAR(50),
    num_operacion      VARCHAR(20),
    usuario_registro   VARCHAR(100),
    referencia         VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 17. MOVIMIENTOS / TRANSACCIONES
-- ------------------------------------------------------------

CREATE TABLE transaccion (
    id_transaccion            BIGSERIAL PRIMARY KEY,
    id_centro_costo_origen    BIGINT NOT NULL,
    id_centro_costo_destino   BIGINT NOT NULL,
    fecha              DATE NOT NULL,
    Id_nombre          VARCHAR(20),
    tipo_documento     VARCHAR(2),
    num_documento      VARCHAR(20),
    tipo_transaccion   VARCHAR(2),
    forma_pago         VARCHAR(2),
    descripcion        TEXT,
    tipo               VARCHAR(20) CHECK (tipo IN ('ingreso', 'egreso')),
    monto_total        DECIMAL(12,2) NOT NULL,
    medio_pago         VARCHAR(2),
    cuente_origen      VARCHAR(20),
    cuente_destino     VARCHAR(20),
    estado             VARCHAR(10),
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE trans_detalle (
    id_trans_detalle   BIGSERIAL PRIMARY KEY,
    id_transaccion     BIGINT NOT NULL REFERENCES transaccion(id_transaccion) ON DELETE CASCADE,
    id_partida         BIGINT REFERENCES partida(id_partida),
    cantidad           DECIMAL(12,4),
    precio_unitario    DECIMAL(12,2),
    monto_igv          DECIMAL(12,2),
    porc_detraccion    DECIMAL(5,2),
    monto_detraccion   DECIMAL(12,2),
    subtotal           DECIMAL(12,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED,
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 18. TABLAS AUXILIARES (PRECIOS DE RECURSOS)
-- ------------------------------------------------------------

CREATE TABLE recurso_precio (
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

CREATE INDEX IF NOT EXISTS idx_proyecto_cliente ON proyecto(id_cliente);
CREATE INDEX IF NOT EXISTS idx_documento_proyecto_proyecto ON documento_proyecto(id_proyecto);
CREATE INDEX IF NOT EXISTS idx_presupuesto_proyecto ON presupuesto(id_proyecto);
CREATE INDEX IF NOT EXISTS idx_presupuesto_detalle_partida ON presupuesto_detalle(id_partida);
CREATE INDEX IF NOT EXISTS idx_cronograma_proyecto ON cronograma_actividad(id_proyecto);
CREATE INDEX IF NOT EXISTS idx_valorizacion_proyecto ON valorizacion_semanal(id_proyecto);
CREATE INDEX IF NOT EXISTS idx_cuentas_pagar_presupuesto ON cuentas_pagar(id_presupuesto);
CREATE INDEX IF NOT EXISTS idx_transaccion_centro ON transaccion(id_centro_costo_origen, id_centro_costo_destino);
CREATE INDEX IF NOT EXISTS idx_restriccion_proyecto ON restriccion(id_proyecto);
CREATE INDEX IF NOT EXISTS idx_metrado_proyecto ON metrado(id_proyecto);
CREATE INDEX IF NOT EXISTS idx_acero_proyecto ON acero_detalle(id_proyecto);
CREATE INDEX IF NOT EXISTS idx_lookahead_proyecto ON lookahead(id_proyecto);
CREATE INDEX IF NOT EXISTS idx_egreso_proyecto_semana ON egreso_semanal(id_proyecto, semana_numero);

-- ------------------------------------------------------------
-- TRIGGERS DE AUDITORÍA (SOLO INSTANCIAS)
-- ------------------------------------------------------------

CREATE TRIGGER trg_audit_presupuesto_detalle
AFTER INSERT OR UPDATE OR DELETE ON presupuesto_detalle
FOR EACH ROW EXECUTE FUNCTION capture_instance_audit();

CREATE TRIGGER trg_audit_metrado
AFTER INSERT OR UPDATE OR DELETE ON metrado
FOR EACH ROW EXECUTE FUNCTION capture_instance_audit();

CREATE TRIGGER trg_audit_cronograma_actividad
AFTER INSERT OR UPDATE OR DELETE ON cronograma_actividad
FOR EACH ROW EXECUTE FUNCTION capture_instance_audit();

CREATE TRIGGER trg_audit_cronograma_detalle_semanal
AFTER INSERT OR UPDATE OR DELETE ON cronograma_detalle_semanal
FOR EACH ROW EXECUTE FUNCTION capture_instance_audit();

CREATE TRIGGER trg_audit_lookahead
AFTER INSERT OR UPDATE OR DELETE ON lookahead
FOR EACH ROW EXECUTE FUNCTION capture_instance_audit();

CREATE TRIGGER trg_audit_valorizacion_partida
AFTER INSERT OR UPDATE OR DELETE ON valorizacion_partida
FOR EACH ROW EXECUTE FUNCTION capture_instance_audit();

CREATE TRIGGER trg_audit_restriccion
AFTER INSERT OR UPDATE OR DELETE ON restriccion
FOR EACH ROW EXECUTE FUNCTION capture_instance_audit();

CREATE TRIGGER trg_audit_egreso_semanal
AFTER INSERT OR UPDATE OR DELETE ON egreso_semanal
FOR EACH ROW EXECUTE FUNCTION capture_instance_audit();

CREATE TRIGGER trg_audit_seguimiento_proyecto
AFTER INSERT OR UPDATE OR DELETE ON seguimiento_proyecto
FOR EACH ROW EXECUTE FUNCTION capture_instance_audit();

CREATE TRIGGER trg_audit_cuentas_cobrar
AFTER INSERT OR UPDATE OR DELETE ON cuentas_cobrar
FOR EACH ROW EXECUTE FUNCTION capture_instance_audit();

CREATE TRIGGER trg_audit_cuentas_pagar
AFTER INSERT OR UPDATE OR DELETE ON cuentas_pagar
FOR EACH ROW EXECUTE FUNCTION capture_instance_audit();

CREATE TRIGGER trg_audit_cobros
AFTER INSERT OR UPDATE OR DELETE ON cobros
FOR EACH ROW EXECUTE FUNCTION capture_instance_audit();

CREATE TRIGGER trg_audit_pagos
AFTER INSERT OR UPDATE OR DELETE ON pagos
FOR EACH ROW EXECUTE FUNCTION capture_instance_audit();

-- ------------------------------------------------------------
-- STORAGE: BUCKET PARA DOCUMENTOS DE PROYECTO
-- ------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('project-documents', 'project-documents', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "auth_upload_project_docs" ON storage.objects;
CREATE POLICY "auth_upload_project_docs"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'project-documents');

DROP POLICY IF EXISTS "public_read_project_docs" ON storage.objects;
CREATE POLICY "public_read_project_docs"
    ON storage.objects FOR SELECT TO public
    USING (bucket_id = 'project-documents');

DROP POLICY IF EXISTS "auth_delete_project_docs" ON storage.objects;
CREATE POLICY "auth_delete_project_docs"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'project-documents');
