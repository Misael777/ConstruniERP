-- ============================================================
-- BASE DE DATOS CONSTRUNI
-- Versión final integrada (Idempotente)
-- ============================================================

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
DROP TABLE IF EXISTS partida CASCADE;
DROP TABLE IF EXISTS centro_costo CASCADE;
DROP TABLE IF EXISTS proyecto CASCADE;
DROP TABLE IF EXISTS proveedor CASCADE;
DROP TABLE IF EXISTS cliente CASCADE;
DROP TABLE IF EXISTS recurso_precio CASCADE;
DROP TABLE IF EXISTS roles_permisos CASCADE;
DROP TABLE IF EXISTS permisos CASCADE;
DROP TABLE IF EXISTS empleados CASCADE;
DROP TABLE IF EXISTS area CASCADE;
DROP TABLE IF EXISTS roles CASCADE;

-- ------------------------------------------------------------
-- 1. TABLAS DE SEGURIDAD Y ACCESO (IAM)
-- ------------------------------------------------------------
CREATE TABLE area (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) UNIQUE NOT NULL,
    descripcion TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE permisos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) UNIQUE NOT NULL,
    descripcion TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);


CREATE TABLE roles_permisos (
    rol_id INT REFERENCES roles(id) ON DELETE CASCADE,
    permiso_id INT REFERENCES permisos(id) ON DELETE CASCADE,
    PRIMARY KEY (rol_id, permiso_id)
);

CREATE TABLE empleados (
    id_empleado  SERIAL PRIMARY KEY,
    nombre       TEXT NOT NULL,
    correo       TEXT UNIQUE NOT NULL,
    telefono     VARCHAR(20),
    rol_id       INT REFERENCES roles(id),
    area_id      INT REFERENCES area(id),
    auth_user_id UUID UNIQUE,
    fecha_ingreso DATE,
    salario      NUMERIC,
    horas        NUMERIC,
    periodo      TEXT,
    nivel        TEXT,
    password_creada BOOLEAN DEFAULT FALSE,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO roles (nombre, descripcion) VALUES
('administrador', 'Acceso total al sistema y gestión de usuarios'),
('asesor', 'Acceso restringido a reportes y tareas específicas')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO area (nombre) VALUES ('Gerencia'), ('Operaciones'), ('Oficina Técnica') ON CONFLICT (nombre) DO NOTHING;

-- Seed permissions for the current app modules and submodules
INSERT INTO permisos (nombre, descripcion) VALUES
  ('ver_dashboard', 'Ver Dashboard'),
  ('ver_iam', 'Ver módulo de Control de Accesos (IAM)'),
  ('ver_empleados', 'Ver módulo de Empleados'),
  ('ver_roles_permisos', 'Ver módulo de Roles y Permisos'),
  ('ver_comercial', 'Ver módulo Comercial'),
  ('ver_comercial_ventas', 'Ver módulo de Ventas'),
  ('ver_comercial_clientes', 'Ver módulo de Clientes'),
  ('ver_comercial_proveedores', 'Ver módulo de Proveedores'),
  ('ver_proyectos', 'Ver módulo de Proyectos'),
  ('ver_proyectos_dashboard', 'Ver Dashboard de Proyectos'),
  ('ver_proyectos_gestion', 'Ver Gestión de Proyectos'),
  ('ver_proyectos_partidas', 'Ver módulo de Partidas y Plantillas'),
  ('ver_finanzas', 'Ver módulo de Finanzas'),
  ('ver_finanzas_centros_costos', 'Ver Centros de Costos'),
  ('ver_finanzas_cuentas_pendientes', 'Ver Cuentas Pendientes'),
  ('ver_finanzas_transacciones', 'Ver Transacciones')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r, permisos p WHERE r.nombre = 'administrador' ON CONFLICT DO NOTHING;

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permisos ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles_permisos ENABLE ROW LEVEL SECURITY;
ALTER TABLE empleados ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
    SELECT EXISTS (
        SELECT 1 FROM empleados e JOIN roles r ON e.rol_id = r.id WHERE e.auth_user_id = auth.uid() AND r.nombre = 'administrador'
    );
$$;

CREATE POLICY "Lectura publica de roles" ON roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Lectura publica de permisos" ON permisos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Lectura publica de roles_permisos" ON roles_permisos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Lectura publica de empleados" ON empleados FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin CRUD roles" ON roles FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Admin CRUD permisos" ON permisos FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Admin CRUD roles_permisos" ON roles_permisos FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Admin CRUD empleados" ON empleados FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ------------------------------------------------------------
-- 2. FUNCIONES RPC
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crear_usuario_empleado(
  p_nombre text, p_correo text, p_telefono text, p_rol_id int, p_area_id int,
  p_fecha_ingreso date, p_salario numeric, p_horas numeric, p_periodo text, p_nivel text
) RETURNS json SECURITY DEFINER AS $$
DECLARE emp_record json; clean_email text := lower(trim(p_correo));
BEGIN
  IF NOT public.is_admin() THEN RETURN json_build_object('success', false, 'error', 'No autorizado'); END IF;
  IF EXISTS (SELECT 1 FROM public.empleados WHERE lower(correo) = clean_email) THEN RETURN json_build_object('success', false, 'error', 'El correo ya existe'); END IF;
  INSERT INTO public.empleados (nombre, correo, telefono, rol_id, area_id, fecha_ingreso, salario, horas, periodo, nivel)
  VALUES (p_nombre, clean_email, p_telefono, p_rol_id, p_area_id, p_fecha_ingreso, p_salario, p_horas, p_periodo, p_nivel)
  RETURNING json_build_object('id', id, 'nombre', nombre, 'telefono', telefono, 'correo', correo, 'rol_id', rol_id, 'auth_user_id', auth_user_id) INTO emp_record;
  RETURN json_build_object('success', true, 'empleado', emp_record);
EXCEPTION WHEN OTHERS THEN RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.actualizar_usuario_empleado(
  p_id int, p_auth_user_id uuid, p_nombre text, p_correo text, p_telefono text, p_rol_id int, p_area_id int,
  p_fecha_ingreso date, p_salario numeric, p_horas numeric, p_periodo text, p_nivel text
) RETURNS json SECURITY DEFINER AS $$
DECLARE emp_record json; clean_email text := lower(trim(p_correo));
BEGIN
  IF NOT public.is_admin() THEN RETURN json_build_object('success', false, 'error', 'No autorizado'); END IF;
  UPDATE public.empleados SET nombre = p_nombre, correo = clean_email, telefono = p_telefono, rol_id = p_rol_id, area_id = p_area_id,
  fecha_ingreso = p_fecha_ingreso, salario = p_salario, horas = p_horas, periodo = p_periodo, nivel = p_nivel WHERE id = p_id
  RETURNING json_build_object('id', id, 'nombre', nombre, 'telefono', telefono, 'correo', correo, 'rol_id', rol_id, 'auth_user_id', auth_user_id) INTO emp_record;
  RETURN json_build_object('success', true, 'empleado', emp_record);
EXCEPTION WHEN OTHERS THEN RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.eliminar_usuario_empleado(p_id int) RETURNS json SECURITY DEFINER AS $$
BEGIN
  IF NOT public.is_admin() THEN RETURN json_build_object('success', false, 'error', 'No autorizado'); END IF;
  DELETE FROM public.empleados WHERE id = p_id;
  RETURN json_build_object('success', true, 'empleado_id', p_id);
EXCEPTION WHEN OTHERS THEN RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;
-- ============================================================
-- BASE DE DATOS CONSTRUNI
-- Version final integrada con todos los modulos
-- ============================================================

-- ------------------------------------------------------------
-- 1. ENTIDADES BASE (CLIENTES, PROVEEDORES, ÃREAS)
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
-- 2. CENTRO DE COSTO (UNIFICA PROYECTOS Y ÃREAS)
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

-- VÃ­nculo obligatorio: cada proyecto es tambiÃ©n un centro de costo
INSERT INTO centro_costo (codigo, nombre, tipo, id_referencia)
SELECT CONCAT('PROY-', p.id_proyecto), p.nombre_proyecto, 'proyecto', p.id_proyecto
FROM proyecto p
ON CONFLICT DO NOTHING;  -- se puede manejar con trigger, pero para el script se asume insercion manual o trigger

-- ------------------------------------------------------------
-- 4. CATÃLOGO DE PARTIDAS (JERÃRQUICO)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS partida (
    id_partida         BIGSERIAL PRIMARY KEY,
    codigo             VARCHAR(20) NOT NULL UNIQUE, -- ej: 'O01.01.01.00  o C01.01.01.01.00'
    tipo_partida       VARCHAR(2),
    descripcion        TEXT NOT NULL,
    unidad             VARCHAR(10), -- glb, m2, m3, und, ml, mes, etc.
    cuadrilla          INTEGER,
    precio_unitario    NUMERIC(12,2),
    precio_parcial     NUMERIC(12,2),
    nivel              INTEGER NOT NULL, -- 1,2,3...
    id_partida_padre   BIGINT REFERENCES partida(id_partida),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_partida_padre ON partida(id_partida_padre);

ALTER TABLE partida ADD CONSTRAINT chk_partida_no_auto FOREIGN KEY (id_partida_padre) REFERENCES partida(id_partida) ON DELETE NO ACTION;
-- Pero necesitas un trigger para evitar ciclos. Ejemplo:
CREATE OR REPLACE FUNCTION check_partida_cycle() RETURNS TRIGGER AS $$
DECLARE
    v_parent BIGINT := NEW.id_partida_padre;
BEGIN
    IF NEW.id_partida = NEW.id_partida_padre THEN
        RAISE EXCEPTION 'Una partida no puede ser su propio padre';
    END IF;
    -- Recorrer hacia arriba para detectar ciclo
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
WITH RECURSIVE arbol AS (...)
SELECT ...;
-- ------------------------------------------------------------
-- 5. PRESUPUESTO Y DETALLE
-- ------------------------------------------------------------

CREATE TABLE presupuesto (
    id_presupuesto     BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto),
    nombre             VARCHAR(200) NOT NULL,
    fecha_creacion     DATE DEFAULT CURRENT_DATE,
    moneda             VARCHAR(3) DEFAULT 'PEN',
    tipo               VARCHAR(20) DEFAULT 'obra', -- obra, mantenimiento, etc.
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE presupuesto_detalle (
    id_presupuesto_detalle BIGSERIAL PRIMARY KEY,
    id_presupuesto     BIGINT NOT NULL REFERENCES presupuesto(id_presupuesto) ON DELETE CASCADE,
    id_partida         BIGINT NOT NULL REFERENCES partida(id_partida),
    cantidad           DECIMAL(12,4) NOT NULL,
    precio_mo          DECIMAL(12,2) DEFAULT 0,   -- mano de obra unitario
    precio_mat         DECIMAL(12,2) DEFAULT 0,   -- material unitario
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
    tipo              VARCHAR(50),   -- ej: 'vivienda', 'local', 'oficina'
    usuario_registro  VARCHAR(100),
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE plantilla_detalle (
    id_plantilla_detalle BIGSERIAL PRIMARY KEY,
    id_plantilla      BIGINT NOT NULL REFERENCES plantilla_presupuesto(id_plantilla) ON DELETE CASCADE,
    id_partida        BIGINT NOT NULL REFERENCES partida(id_partida),
    cantidad_sugerida DECIMAL(12,4),   -- cantidad típica para esta plantilla
    orden             INTEGER,          -- orden de ejecución dentro del flujo
    usuario_registro  VARCHAR(100),
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(id_plantilla, id_partida)   -- una partida no se repite en la misma plantilla
);

-- ============================================================
-- AUDITORÍA DE INSTANCIAS (SOLO DATOS DE PROYECTOS)
-- ============================================================

CREATE TABLE instance_audit_log (
    id_audit          BIGSERIAL PRIMARY KEY,
    project_id        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    table_name        TEXT NOT NULL,          -- 'presupuesto_detalle', 'metrado', etc.
    record_id         BIGINT NOT NULL,        -- ID del registro instanciado
    action            TEXT NOT NULL,          -- 'INSERT', 'UPDATE', 'DELETE'
    old_data          JSONB,                  -- snapshot completo ANTES
    new_data          JSONB,                  -- snapshot completo DESPUÉS
    changed_by        UUID,                   -- auth_user_id (NULL si es sistema)
    changed_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para búsquedas rápidas
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

    -- Obtener project_id según la tabla
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

    -- Si no se pudo determinar, no registramos
    IF v_project_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- ID del registro
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
    tipo_contrato      VARCHAR(50) DEFAULT 'a suma alzada', -- a suma alzada, unitario
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
    cuenta             VARCHAR(100), -- cuenta bancaria o referencia
    tipo               VARCHAR(50),  -- 'obra', 'subcontratista'
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 7. RESTRICCIONES (del anÃ¡lisis de restricciones)
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
-- 8. SEGUIMIENTO DE PROYECTO (general, por fechas)
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
-- 9. CRONOGRAMA DE OBRA (16 semanas u horizonte variable)
-- ------------------------------------------------------------

CREATE TABLE cronograma_actividad (
    id_cronograma_actividad BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    nombre_actividad   VARCHAR(200) NOT NULL,
    nivel              INTEGER NOT NULL, -- 1=grupo, 2=subgrupo, 3=actividad
    id_actividad_padre BIGINT REFERENCES cronograma_actividad(id_cronograma_actividad),
    semana_inicio_plan INTEGER,  -- nÃºmero de semana (1..N)
    semana_fin_plan    INTEGER,
    duracion_semanas   INTEGER GENERATED ALWAYS AS (semana_fin_plan - semana_inicio_plan + 1) STORED,
    fecha_inicio_real  DATE,
    fecha_fin_real     DATE,
    porcentaje_avance_real DECIMAL(5,2) DEFAULT 0,
    orden              INTEGER,
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Detalle semana a semana del avance (opcional)
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
-- 10. LOOKAHEAD PLANNING (planificacion diaria)
-- ------------------------------------------------------------

CREATE TABLE lookahead (
    id_lookahead       BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    id_partida         BIGINT REFERENCES partida(id_partida),
    fecha_plan         DATE NOT NULL,  -- dí­a especÃ­fico
    cantidad_plan      DECIMAL(12,4),
    recurso_asignado   VARCHAR(200),   -- ej. "ROMBO 1"
    restriccion        VARCHAR(200), 
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 11. PLANILLA DE METRADOS (cÃ¡lculos detallados)
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
    formula            TEXT,  -- expresion textual del cÃ¡lculo
    total              DECIMAL(12,4) GENERATED ALWAYS AS (cantidad * COALESCE(largo,1) * COALESCE(ancho,1) * COALESCE(alto,1)) STORED,
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 12. ACERO DETALLADO (despiece de varillas)
-- ------------------------------------------------------------

CREATE TABLE acero_detalle (
    id_acero           BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    id_partida         BIGINT REFERENCES partida(id_partida),
    elemento           VARCHAR(100),   -- Z-1, Viga, Placa, etc.
    diametro           VARCHAR(10),    -- 3/8, 1/2, 5/8, etc.
    longitud_m         DECIMAL(10,2),
    cantidad_varillas  INTEGER,
    precio_total_kg    DECIMAL(12,2),
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 13. VALORIZACIONES SEMANALES (avance financiero)
-- ------------------------------------------------------------

CREATE TABLE valorizacion_semanal (
    id_valorizacion    BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    semana_numero      INTEGER NOT NULL,
    fecha_inicio       DATE,
    fecha_fin          DATE,
    monto_total        DECIMAL(12,2) NOT NULL,
    porcentaje_acumulado DECIMAL(5,2),  -- % avance acumulado del proyecto
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Detalle de valorizacion por partida (opcional)
CREATE TABLE valorizacion_partida (
    id_valorizacion_partida BIGSERIAL PRIMARY KEY,
    id_valorizacion    BIGINT NOT NULL REFERENCES valorizacion_semanal(id_valorizacion) ON DELETE CASCADE,
    id_partida         BIGINT NOT NULL REFERENCES partida(id_partida),
    monto              DECIMAL(12,2) NOT NULL,
    porcentaje_avance  DECIMAL(5,2),  -- avance de esa partida en la semana
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 14. EGRESOS SEMANALES (flujo de caja)
-- ------------------------------------------------------------

CREATE TABLE egreso_semanal (
    id_egreso          BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    semana_numero      INTEGER NOT NULL,
    concepto           VARCHAR(100) NOT NULL,  -- 'Costo Materiales', 'Seguridad', etc.
    monto              DECIMAL(12,2) NOT NULL,
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 15. CUENTAS POR COBRAR (CLIENTE)
-- ------------------------------------------------------------

CREATE TABLE cuentas_cobrar (
    id_cuenta_cobrar   BIGSERIAL PRIMARY KEY,
    id_cliente         BIGINT NOT NULL REFERENCES cliente(id_cliente),
    id_proyecto        BIGINT REFERENCES proyecto(id_proyecto),  -- opcional
    tipo_documento     INTEGER(2),
    num_documento      VARCHAR(50),
    monto              DECIMAL(12,2) NOT NULL,
    monto_cobrado      DECIMAL(12,2) NOT NULL,
    saldo_pendiente    DECIMAL(12,2) NOT NULL,
    forma_pago         INTEGER(2),
    condición_pago     INTEGER(2),
    responsable        VARCHAR(20),
    fecha_emision      DATE NOT NULL,
    fecha_vencimiento  DATE,
    moneda             VARCHAR(3),
    observaciones      VARCHAR(200),
    estado             VARCHAR(20) DEFAULT 'pendiente', -- pendiente, pagado, vencido
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cobros (
    id_cobro           BIGSERIAL PRIMARY KEY,
    id_cuenta_cobrar   BIGINT NOT NULL REFERENCES cuentas_cobrar(id_cuenta_cobrar) ON DELETE CASCADE,
    monto              DECIMAL(12,2) NOT NULL,
    fecha_cobro        DATE NOT NULL,
    medio_cobro        INTEGER(2),
    num_operacion      VARCHAR(20),
    cuenta_banco       INTEGER(2),
    numero_opracion    VARCHAR(20),
    usuario_registro   VARCHAR(100),
    referencia         VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 16. CUENTAS POR PAGAR (PROVEEDORES, GENERADAS POR PRESUPUESTO)
-- ------------------------------------------------------------

CREATE TABLE cuentas_pagar (
    id_cuenta_pagar    BIGSERIAL PRIMARY KEY,
    id_proveedor       BIGINT NOT NULL REFERENCES proveedor(id_proveedor),
    id_presupuesto     BIGINT REFERENCES presupuesto(id_presupuesto),  -- relacion clave
    id_partida         BIGINT REFERENCES partida(id_partida),  -- opcional
    tipo_documento     INTEGER(2),
    num_documento      VARCHAR(20),
    monto_comprometido DECIMAL(12,2) NOT NULL,
    monto_pagado       DECIMAL(12,2) NOT NULL,
    saldo_pendiente    DECIMAL(12,2) NOT NULL,
    fotma_pago         INTEGER(2),
    categoria_gasto    INTEGER(2),
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
-- 17. MOVIMIENTOS / TRANSACCIONES (Centro de Costo)
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
-- ÃNDICES PARA RENDIMIENTO
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_proyecto_cliente ON proyecto(id_cliente);
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
-- COMENTARIOS (OPCIONAL)
-- ------------------------------------------------------------

COMMENT ON TABLE proyecto IS 'Proyectos de construccion, cada uno es tambien un centro de costo';
COMMENT ON TABLE partida IS 'Catalogo jerÃ¡rquico de partidas (codigo APU)';
COMMENT ON TABLE presupuesto_detalle IS 'Detalle de precios unitarios y cantidades por partida';
COMMENT ON TABLE cronograma_actividad IS 'Actividades del cronograma de obra (16+ semanas)';
COMMENT ON TABLE lookahead IS 'Planificacion diaria detallada (lookahead)';
COMMENT ON TABLE metrado IS 'Calculos de cantidades de obra (planilla de metrados)';
COMMENT ON TABLE valorizacion_semanal IS 'Valorizaciones semanales del proyecto';
COMMENT ON TABLE cuentas_pagar IS 'Obligaciones generadas por el presupuesto de obra';
COMMENT ON TABLE transaccion IS 'Movimientos economicos por centro de costo';

-- ------------------------------------------------------------


-- ============================================================
-- TRIGGERS DE AUDITORÍA (SOLO INSTANCIAS)
-- ============================================================

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

-- (Opcional) si quieres auditar cobros/pagos también
CREATE TRIGGER trg_audit_cobros
AFTER INSERT OR UPDATE OR DELETE ON cobros
FOR EACH ROW EXECUTE FUNCTION capture_instance_audit();

CREATE TRIGGER trg_audit_pagos
AFTER INSERT OR UPDATE OR DELETE ON pagos
FOR EACH ROW EXECUTE FUNCTION capture_instance_audit();


