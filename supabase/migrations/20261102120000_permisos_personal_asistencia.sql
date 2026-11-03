-- Módulo "Personal y Asistencia" (huelleros ZKTeco, personal de obra, horarios y control de asistencia).
-- Permisos del menú; de entrada los tienen administrador y socio (developer = admin, ver
-- 20261022150000_developer_igual_admin.sql). Las tablas están en 20261030120000_asistencia_huellero.sql.
-- Idempotente.
INSERT INTO permisos (nombre, descripcion)
SELECT v.nombre, v.descripcion
FROM (VALUES
    ('ver_rrhh', 'Ver el módulo Personal y Asistencia'),
    ('ver_rrhh_personal', 'Ver y administrar el personal (fichas de trabajadores)'),
    ('ver_rrhh_asistencia', 'Ver el control de asistencia (marcaciones, tareo)'),
    ('ver_rrhh_huelleros', 'Ver y configurar los huelleros de las obras')
) AS v(nombre, descripcion)
WHERE NOT EXISTS (SELECT 1 FROM permisos p WHERE p.nombre = v.nombre);

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.nombre IN ('ver_rrhh', 'ver_rrhh_personal', 'ver_rrhh_asistencia', 'ver_rrhh_huelleros')
WHERE r.nombre IN ('administrador', 'socio')
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);

NOTIFY pgrst, 'reload schema';
