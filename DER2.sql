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
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    correo TEXT UNIQUE NOT NULL,
    telefono VARCHAR(20),
    rol_id INT REFERENCES roles(id),
    area_id INT REFERENCES area(id),
    auth_user_id UUID UNIQUE,
    fecha_ingreso DATE,
    salario NUMERIC,
    horas NUMERIC,
    periodo TEXT,
    nivel TEXT,
    password_creada BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO roles (nombre, descripcion) VALUES
('administrador', 'Acceso total al sistema y gestión de usuarios'),
('asesor', 'Acceso restringido a reportes y tareas específicas')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO area (nombre) VALUES ('Gerencia'), ('Operaciones'), ('Oficina Técnica') ON CONFLICT (nombre) DO NOTHING;

INSERT INTO permisos (nombre, descripcion) VALUES
  ('ver_dashboard',         'Ver Dashboard'),
  ('ver_iam',               'Ver Control de Accesos (IAM)'),
  ('ver_empleados',         'Ver módulo de Empleados'),
  ('ver_roles_permisos',    'Ver módulo de Roles y Permisos')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO area (nombre) VALUES ('Gerencia'), ('Operaciones'), ('Oficina Técnica') ON CONFLICT (nombre) DO NOTHING;

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
    updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 2. CENTRO DE COSTO (UNIFICA PROYECTOS Y ÃREAS)
-- ------------------------------------------------------------

CREATE TABLE centro_costo (
    id_centro_costo    BIGSERIAL PRIMARY KEY,
    codigo             VARCHAR(50) NOT NULL,
    nombre             VARCHAR(200) NOT NULL,
    tipo               VARCHAR(20) NOT NULL CHECK (tipo IN ('proyecto', 'proveedor', 'cliente', 'otro')),
    id_referencia      BIGINT NOT NULL, -- FK a proyecto.id_proyecto 
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 3. PROYECTO (hereda de centro_costo)
-- ------------------------------------------------------------

CREATE TABLE proyecto (
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

-- VÃ­nculo obligatorio: cada proyecto es tambiÃ©n un centro de costo
INSERT INTO centro_costo (codigo, nombre, tipo, id_referencia)
SELECT CONCAT('PROY-', p.id_proyecto), p.nombre, 'proyecto', p.id_proyecto
FROM proyecto p
ON CONFLICT DO NOTHING;  -- se puede manejar con trigger, pero para el script se asume insercion manual o trigger

-- ------------------------------------------------------------
-- 4. CATÃLOGO DE PARTIDAS (JERÃRQUICO)
-- ------------------------------------------------------------

CREATE TABLE partida (
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

CREATE TABLE presupuesto (
    id_presupuesto     BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto),
    nombre             VARCHAR(200) NOT NULL,
    fecha_creacion     DATE DEFAULT CURRENT_DATE,
    moneda             VARCHAR(3) DEFAULT 'PEN',
    tipo               VARCHAR(20) DEFAULT 'obra', -- obra, mantenimiento, etc.
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
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

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
    UNIQUE(id_cronograma_actividad, semana_numero)
);

-- ------------------------------------------------------------
-- 10. LOOKAHEAD PLANNING (planificacion diaria)
-- ------------------------------------------------------------

CREATE TABLE lookahead (
    id_lookahead       BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    id_partida         BIGINT REFERENCES partida(id_partida),
    fecha_plan         DATE NOT NULL,  -- dÃ­a especÃ­fico
    cantidad_plan      DECIMAL(12,4),
    recurso_asignado   VARCHAR(200),   -- ej. "ROMBO 1"
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
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 12. ACERO DETALLADO (despiece de varillas)
-- ------------------------------------------------------------

CREATE TABLE acero_detalle (
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

CREATE TABLE valorizacion_semanal (
    id_valorizacion    BIGSERIAL PRIMARY KEY,
    id_proyecto        BIGINT NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    semana_numero      INTEGER NOT NULL,
    fecha_inicio       DATE,
    fecha_fin          DATE,
    monto_total        DECIMAL(12,2) NOT NULL,
    porcentaje_acumulado DECIMAL(5,2),  -- % avance acumulado del proyecto
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Detalle de valorizacion por partida (opcional)
CREATE TABLE valorizacion_partida (
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

CREATE TABLE egreso_semanal (
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

CREATE TABLE cuentas_cobrar (
    id_cuenta_cobrar   BIGSERIAL PRIMARY KEY,
    id_cliente         BIGINT NOT NULL REFERENCES cliente(id_cliente),
    id_proyecto        BIGINT REFERENCES proyecto(id_proyecto),  -- opcional
    monto              DECIMAL(12,2) NOT NULL,
    fecha_emision      DATE NOT NULL,
    fecha_vencimiento  DATE,
    estado             VARCHAR(20) DEFAULT 'pendiente', -- pendiente, pagado, vencido
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cobros (
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

CREATE TABLE cuentas_pagar (
    id_cuenta_pagar    BIGSERIAL PRIMARY KEY,
    id_proveedor       BIGINT NOT NULL REFERENCES proveedor(id_proveedor),
    id_presupuesto     BIGINT REFERENCES presupuesto(id_presupuesto),  -- relacion clave
    id_partida         BIGINT REFERENCES partida(id_partida),  -- opcional
    monto_comprometido DECIMAL(12,2) NOT NULL,
    fecha_emision      DATE NOT NULL,
    fecha_vencimiento  DATE,
    estado             VARCHAR(20) DEFAULT 'pendiente',
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pagos (
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

CREATE TABLE transaccion (
    id_transaccion     BIGSERIAL PRIMARY KEY,
    id_centro_costo_origen    BIGINT NOT NULL,
    id_centro_costo_destino   BIGINT NOT NULL,
    fecha              DATE NOT NULL,
    descripcion        TEXT,
    tipo               VARCHAR(20) CHECK (tipo IN ('ingreso', 'egreso')),
    monto_total        DECIMAL(12,2) NOT NULL,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE trans_detalle (
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




