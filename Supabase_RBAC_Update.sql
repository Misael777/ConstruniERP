-- SCRIPT DE ACTUALIZACIÓN RBAC

-- 1. Tabla de Roles
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) UNIQUE NOT NULL,
    descripcion TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabla de Permisos
CREATE TABLE IF NOT EXISTS permisos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) UNIQUE NOT NULL,
    descripcion TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabla Roles_Permisos (Muchos a Muchos)
CREATE TABLE IF NOT EXISTS roles_permisos (
    rol_id INT REFERENCES roles(id) ON DELETE CASCADE,
    permiso_id INT REFERENCES permisos(id) ON DELETE CASCADE,
    PRIMARY KEY (rol_id, permiso_id)
);

-- 4. Alterar la tabla empleados existente
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS rol_id INT REFERENCES roles(id);
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS telefono VARCHAR(20);
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE; -- Para ligar con Supabase Auth (auth.users)

-- 5. Insertar datos iniciales
INSERT INTO roles (nombre, descripcion) VALUES
('administrador', 'Acceso total al sistema y gestión de usuarios'),
('vendedor', 'Acceso al módulo de ventas y clientes'),
('asesor', 'Acceso restringido a reportes y tareas específicas')
ON CONFLICT (nombre) DO NOTHING;

-- 6. Habilitar RLS (Row Level Security)
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permisos ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles_permisos ENABLE ROW LEVEL SECURITY;
ALTER TABLE empleados ENABLE ROW LEVEL SECURITY;

-- 7. Función Auxiliar: Verificar si es Administrador
-- Compara el ID del usuario autenticado (auth.uid()) con el auth_user_id del empleado, y verifica su rol
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

-- 8. Políticas de Seguridad (RLS)
-- Todos los usuarios autenticados pueden LEER los roles y permisos
DROP POLICY IF EXISTS "Lectura publica de roles" ON roles;
CREATE POLICY "Lectura publica de roles" ON roles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Lectura publica de permisos" ON permisos;
CREATE POLICY "Lectura publica de permisos" ON permisos FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Lectura publica de roles_permisos" ON roles_permisos;
CREATE POLICY "Lectura publica de roles_permisos" ON roles_permisos FOR SELECT TO authenticated USING (true);

-- Solo los administradores pueden MODIFICAR roles, permisos, y empleados
DROP POLICY IF EXISTS "Admin CRUD roles" ON roles;
CREATE POLICY "Admin CRUD roles" ON roles FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admin CRUD permisos" ON permisos;
CREATE POLICY "Admin CRUD permisos" ON permisos FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admin CRUD roles_permisos" ON roles_permisos;
CREATE POLICY "Admin CRUD roles_permisos" ON roles_permisos FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Empleados: Todos pueden leer empleados, pero solo admin puede modificar o insertar
DROP POLICY IF EXISTS "Lectura publica de empleados" ON empleados;
CREATE POLICY "Lectura publica de empleados" ON empleados FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admin CRUD empleados" ON empleados;
CREATE POLICY "Admin CRUD empleados" ON empleados FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- FIN DEL SCRIPT
