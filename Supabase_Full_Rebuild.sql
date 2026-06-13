-- ============================================================
-- Supabase_Full_Rebuild.sql
-- Script idempotente para recrear la base de datos del proyecto
-- Elimina todas las tablas de aplicación de public y las vuelve a crear
-- No reconstruye el esquema interno `auth` gestionado por Supabase.
--
-- IMPORTANTE:
-- 1) Este script usa inserciones directas en auth.users y auth.identities.
--    Eso solo funciona si el esquema interno `auth` está íntegro.
-- 2) Si tu base de datos tiene problemas con auth.mappings, no se puede reparar
--    completamente desde aquí; puede requerir restauración o nuevo proyecto.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

-- ---------------------------------------------------------------
-- DROP EXISTING OBJECTS
-- ---------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_cliabo_updated_at ON cliente_abonos;
DROP FUNCTION IF EXISTS set_updated_at() CASCADE;
DROP FUNCTION IF EXISTS is_admin() CASCADE;
DROP FUNCTION IF EXISTS public.crear_usuario_empleado(text, text, text, int, int, date, numeric, numeric, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.actualizar_usuario_empleado(int, uuid, text, text, text, int, int, date, numeric, numeric, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.eliminar_usuario_empleado(int) CASCADE;
DROP FUNCTION IF EXISTS public.configurar_contrasena_empleado(text, text, text) CASCADE;

DROP TABLE IF EXISTS
    cliente_abonos,
    presupuesto_materiales,
    fases_obra,
    roles_permisos,
    permisos,
    roles,
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
-- 1. TABLAS CATÁLOGO / MAESTRAS
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
-- 2. TABLAS DE ACTORES
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
    correo VARCHAR(255) UNIQUE,
    telefono VARCHAR(20),
    rol_id INT REFERENCES roles(id),
    auth_user_id UUID UNIQUE,
    password_creada BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM empleados e
        JOIN roles r ON e.rol_id = r.id
        WHERE e.auth_user_id = auth.uid()
          AND r.nombre = 'administrador'
    );
$$;

-- ---------------------------------------------------------------
-- 3. CONSULTORÍAS / OBRAS / VENTAS / GASTOS
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
    existencia_actual DECIMAL(12,2) DEFAULT 0,
    valor_min DECIMAL(12,2),
    valor_max DECIMAL(12,2),
    unidad_id INT REFERENCES unidades(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

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
    existencia_actual DECIMAL(12,2) DEFAULT 0,
    valor_min DECIMAL(12,2),
    valor_max DECIMAL(12,2),
    unidad_id INT REFERENCES unidades(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

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
    comision_porcentaje NUMERIC(5,2),
    comision_monto NUMERIC(10,2),
    url_proforma TEXT,
    url_contrato TEXT,
    tipo_proyecto VARCHAR(50),
    codigo_generado VARCHAR(100),
    CONSTRAINT uq_ventas_documento UNIQUE (tipo_documento_id, folio_factura),
    CONSTRAINT chk_venta_entidad CHECK (
        (consultoria_id IS NOT NULL AND obra_id IS NULL) OR
        (consultoria_id IS NULL AND obra_id IS NOT NULL)
    )
);

CREATE TABLE seguimiento_proyectos (
    id SERIAL PRIMARY KEY,
    venta_id INT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
    fecha DATE NOT NULL DEFAULT CURRENT_DATE,
    porcentaje_avance DECIMAL(5,2) CHECK (porcentaje_avance BETWEEN 0 AND 100),
    descripcion TEXT,
    responsable_id INT REFERENCES empleados(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE TABLE metas (
    id SERIAL PRIMARY KEY,
    mes INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
    año INT NOT NULL,
    objetivo_ingreso DECIMAL(12,2) NOT NULL DEFAULT 0,
    meta_anual DECIMAL(12,2),
    crecimiento DECIMAL(5,2)
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
-- 5. TABLAS COMPLEMENTARIAS
-- ---------------------------------------------------------------
CREATE TABLE fases_obra (
    id SERIAL PRIMARY KEY,
    obra_id INT NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
    nombre VARCHAR(150) NOT NULL,
    fecha_inicio DATE,
    fecha_fin DATE,
    porcentaje_avance DECIMAL(5,2) DEFAULT 0 CHECK (porcentaje_avance BETWEEN 0 AND 100),
    orden INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE presupuesto_materiales (
    id SERIAL PRIMARY KEY,
    obra_id INT NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
    concepto_gasto_id INT REFERENCES conceptos_gasto(id),
    material_nombre VARCHAR(150) NOT NULL,
    cantidad_estimada DECIMAL(12,2) DEFAULT 0,
    cantidad_consumida DECIMAL(12,2) DEFAULT 0,
    unidad_id INT REFERENCES unidades(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cliente_abonos (
    id SERIAL PRIMARY KEY,
    cod_venta INT NOT NULL REFERENCES ventas(id) ON DELETE RESTRICT,
    cod_proyecto INT REFERENCES ventas(id),
    cod_cliente INT NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
    num_abono INT NOT NULL CHECK (num_abono > 0),
    fec_vence DATE NOT NULL,
    fec_pago DATE,
    monto DECIMAL(12,2) NOT NULL CHECK (monto > 0),
    con_abono TEXT,
    num_operacion VARCHAR(100),
    banco VARCHAR(100),
    moneda VARCHAR(10) DEFAULT 'PEN' CHECK (moneda IN ('PEN', 'USD', 'EUR')),
    med_pago VARCHAR(50) CHECK (med_pago IN (
        'TRANSFERENCIA', 'TRANSFERENCIA INTERNA',
        'EFECTIVO', 'YAPE', 'PLIN', 'DEPÓSITO', 'OTRO'
    )),
    sal_actual DECIMAL(12,2),
    usuario VARCHAR(100),
    observacion TEXT,
    imagen_com TEXT,
    estado VARCHAR(30) DEFAULT 'Pendiente' CHECK (estado IN ('Pendiente', 'Pagado', 'Vencido', 'Parcial', 'Anulado')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_abono_venta UNIQUE (cod_venta, num_abono)
);

-- ---------------------------------------------------------------
-- 6. ÍNDICES
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
CREATE INDEX idx_fases_obra ON fases_obra(obra_id);
CREATE INDEX idx_presup_mat_obra ON presupuesto_materiales(obra_id);
CREATE INDEX idx_cliabo_venta ON cliente_abonos(cod_venta);
CREATE INDEX idx_cliabo_cliente ON cliente_abonos(cod_cliente);
CREATE INDEX idx_cliabo_fec_vence ON cliente_abonos(fec_vence);
CREATE INDEX idx_cliabo_fec_pago ON cliente_abonos(fec_pago);
CREATE INDEX idx_cliabo_estado ON cliente_abonos(estado);

-- ---------------------------------------------------------------
-- 7. DATOS INICIALES
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
    ('MUNICIPALIDAD', 'SERVICIOS')
) AS data(nom, tipo)
JOIN tg ON tg.nombre = data.tipo
ON CONFLICT (nombre, tipo_gasto_id) DO NOTHING;

INSERT INTO roles (nombre, descripcion) VALUES
('administrador', 'Acceso total al sistema y gestión de usuarios'),
('vendedor', 'Acceso al módulo de ventas y clientes'),
('asesor', 'Acceso restringido a reportes y tareas específicas')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO permisos (nombre, descripcion) VALUES
  ('ver_dashboard',         'Ver Dashboard'),
  ('ver_proyectos',         'Ver Proyectos'),
  ('ver_compras',           'Ver Compras'),
  ('ver_almacen',           'Ver Almacén'),
  ('ver_ventas',            'Ver Ventas'),
  ('ver_finanzas',          'Ver Finanzas'),
  ('ver_rrhh',              'Ver Recursos Humanos'),
  ('ver_iam',               'Ver Control de Accesos (IAM)'),
  ('ver_configuracion',     'Ver Configuración')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r, permisos p
WHERE r.nombre = 'administrador'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------
-- 8. RLS POLICIES
-- ---------------------------------------------------------------
ALTER TABLE empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE obras ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas ENABLE ROW LEVEL SECURITY;
ALTER TABLE gastos ENABLE ROW LEVEL SECURITY;
ALTER TABLE empleados ENABLE ROW LEVEL SECURITY;
ALTER TABLE fases_obra ENABLE ROW LEVEL SECURITY;
ALTER TABLE presupuesto_materiales ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_abonos ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permisos ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles_permisos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir todo a usuarios autenticados" ON empresa FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Permitir todo a usuarios autenticados" ON obras FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Permitir todo a usuarios autenticados" ON consultorias FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Permitir todo a usuarios autenticados" ON ventas FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Permitir todo a usuarios autenticados" ON gastos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Permitir todo a usuarios autenticados" ON empleados FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Permitir todo a usuarios autenticados" ON fases_obra FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Permitir todo a usuarios autenticados" ON presupuesto_materiales FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Lectura publica de roles" ON roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Lectura publica de permisos" ON permisos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Lectura publica de roles_permisos" ON roles_permisos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin CRUD roles" ON roles FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Admin CRUD permisos" ON permisos FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Admin CRUD roles_permisos" ON roles_permisos FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Lectura publica de empleados" ON empleados FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin CRUD empleados" ON empleados FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Lectura publica de cliente_abonos" ON cliente_abonos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin CRUD cliente_abonos" ON cliente_abonos FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ---------------------------------------------------------------
-- 9. UTILS / TRIGGERS
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cliabo_updated_at
    BEFORE UPDATE ON cliente_abonos
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------
-- 10. IAM RPC FUNCTIONS
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crear_usuario_empleado(
  p_nombre text,
  p_correo text,
  p_telefono text,
  p_rol_id int,
  p_area_id int,
  p_fecha_ingreso date,
  p_salario numeric,
  p_horas numeric,
  p_periodo text,
  p_nivel text
)
RETURNS json
SECURITY DEFINER
AS $$
DECLARE
  emp_record json;
  clean_email text := lower(trim(p_correo));
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('success', false, 'error', 'No autorizado: Se requiere rol de administrador.');
  END IF;

  IF EXISTS (SELECT 1 FROM public.empleados WHERE lower(correo) = clean_email) THEN
    RETURN json_build_object('success', false, 'error', 'El correo electrónico ya está registrado en empleados.');
  END IF;

  INSERT INTO public.empleados (
    nombre,
    correo,
    telefono,
    rol_id,
    area_id,
    fecha_ingreso,
    salario,
    horas,
    periodo,
    nivel
  ) VALUES (
    p_nombre,
    clean_email,
    p_telefono,
    p_rol_id,
    p_area_id,
    p_fecha_ingreso,
    p_salario,
    p_horas,
    p_periodo,
    p_nivel
  )
  RETURNING json_build_object(
    'id', id,
    'nombre', nombre,
    'telefono', telefono,
    'correo', correo,
    'rol_id', rol_id,
    'auth_user_id', auth_user_id
  ) INTO emp_record;

  RETURN json_build_object('success', true, 'empleado', emp_record);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.actualizar_usuario_empleado(
  p_id int,
  p_auth_user_id uuid,
  p_nombre text,
  p_correo text,
  p_telefono text,
  p_rol_id int,
  p_area_id int,
  p_fecha_ingreso date,
  p_salario numeric,
  p_horas numeric,
  p_periodo text,
  p_nivel text
)
RETURNS json
SECURITY DEFINER
AS $$
DECLARE
  emp_record json;
  clean_email text := lower(trim(p_correo));
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('success', false, 'error', 'No autorizado: Se requiere rol de administrador.');
  END IF;

  UPDATE public.empleados
  SET
    nombre = p_nombre,
    correo = clean_email,
    telefono = p_telefono,
    rol_id = p_rol_id,
    area_id = p_area_id,
    fecha_ingreso = p_fecha_ingreso,
    salario = p_salario,
    horas = p_horas,
    periodo = p_periodo,
    nivel = p_nivel
  WHERE id = p_id
  RETURNING json_build_object(
    'id', id,
    'nombre', nombre,
    'telefono', telefono,
    'correo', correo,
    'rol_id', rol_id,
    'auth_user_id', auth_user_id,
    'area_id', area_id,
    'fecha_ingreso', fecha_ingreso,
    'salario', salario,
    'horas', horas,
    'periodo', periodo,
    'nivel', nivel
  ) INTO emp_record;

  RETURN json_build_object('success', true, 'empleado', emp_record);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.eliminar_usuario_empleado(
  p_id int
)
RETURNS json
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('success', false, 'error', 'No autorizado: Se requiere rol de administrador.');
  END IF;

  DELETE FROM public.empleados WHERE id = p_id;

  RETURN json_build_object('success', true, 'empleado_id', p_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.configurar_contrasena_empleado(
  p_email text,
  p_password text,
  p_type text
)
RETURNS json
SECURITY DEFINER
AS $$
BEGIN
  RETURN json_build_object(
    'success', false,
    'error', 'Direct password configuration via SQL function is deprecated. Use /api/setup-password with the Supabase Admin API instead.'
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql;

COMMIT;
