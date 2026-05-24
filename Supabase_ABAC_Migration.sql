-- =============================================
-- ABAC Migration: Permisos de Módulos
-- ConstruniERP - Sistema de Control de Acceso
-- =============================================

-- Insert module permissions
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

-- Grant all permissions to administrador
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r, permisos p
WHERE r.nombre = 'administrador'
ON CONFLICT DO NOTHING;
