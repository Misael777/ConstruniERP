-- ==============================================
-- SCRIPT COMPLEMENTARIO: FASES, MATERIALES Y RLS
-- ERP CASALLO & MELCHOR
-- ==============================================

BEGIN;

-- ---------------------------------------------------------------
-- 1. NUEVAS TABLAS PARA SOPORTE DE UI
-- ---------------------------------------------------------------

-- Tabla para fases e hitos (Soporte para Gantt Chart)
CREATE TABLE IF NOT EXISTS fases_obra (
    id SERIAL PRIMARY KEY,
    obra_id INT NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
    nombre VARCHAR(150) NOT NULL,
    fecha_inicio DATE,
    fecha_fin DATE,
    porcentaje_avance DECIMAL(5,2) DEFAULT 0 CHECK (porcentaje_avance BETWEEN 0 AND 100),
    orden INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fases_obra ON fases_obra(obra_id);

-- Tabla para presupuestos y control de materiales clave
CREATE TABLE IF NOT EXISTS presupuesto_materiales (
    id SERIAL PRIMARY KEY,
    obra_id INT NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
    concepto_gasto_id INT REFERENCES conceptos_gasto(id),
    material_nombre VARCHAR(150) NOT NULL,
    cantidad_estimada DECIMAL(12,2) DEFAULT 0,
    cantidad_consumida DECIMAL(12,2) DEFAULT 0,
    unidad_id INT REFERENCES unidades(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_presup_mat_obra ON presupuesto_materiales(obra_id);

-- ---------------------------------------------------------------
-- 2. ROW LEVEL SECURITY (RLS) BASICO
-- Asume autenticación nativa usando auth.users de Supabase
-- ---------------------------------------------------------------

-- 2.1 Habilitar RLS en tablas principales
ALTER TABLE empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE obras ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas ENABLE ROW LEVEL SECURITY;
ALTER TABLE gastos ENABLE ROW LEVEL SECURITY;
ALTER TABLE empleados ENABLE ROW LEVEL SECURITY;

-- 2.2 Políticas base: Solo usuarios autenticados pueden operar
-- (Para un ERP real se deben crear políticas por roles, aquí
-- aplicamos el estándar inicial: autenticados leen/escriben todo)

-- EMPRESA
CREATE POLICY "Permitir todo a usuarios autenticados" ON empresa FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- OBRAS
CREATE POLICY "Permitir todo a usuarios autenticados" ON obras FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- CONSULTORIAS
CREATE POLICY "Permitir todo a usuarios autenticados" ON consultorias FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- VENTAS
CREATE POLICY "Permitir todo a usuarios autenticados" ON ventas FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- GASTOS
CREATE POLICY "Permitir todo a usuarios autenticados" ON gastos FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- EMPLEADOS
CREATE POLICY "Permitir todo a usuarios autenticados" ON empleados FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- FASES OBRA
ALTER TABLE fases_obra ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo a usuarios autenticados" ON fases_obra FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- PRESUPUESTO MATERIALES
ALTER TABLE presupuesto_materiales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Permitir todo a usuarios autenticados" ON presupuesto_materiales FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- COMENTARIOS
COMMENT ON TABLE fases_obra IS 'Fases e hitos de cada proyecto para diagrama de Gantt';
COMMENT ON TABLE presupuesto_materiales IS 'Control de consumo de materiales vs lo presupuestado por obra';

COMMIT;
