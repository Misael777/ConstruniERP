-- Permisos de los submódulos nuevos de Proyectos (a pedido del usuario, 2026-10-12): Consultoría, Obra,
-- Catálogo y "Reuniones, acuerdos y mejoras" (ver MODULE_REGISTRY en app/src/lib/config/modules.ts).
-- El administrador ya ve todo (is_admin). Para no dejar sin acceso a quien ya trabaja en Proyectos, cada rol que
-- tenga 'ver_proyectos' recibe también estos 4; después se pueden quitar por rol en IAM → Roles y Permisos.
-- Idempotente.

INSERT INTO permisos (nombre, descripcion) VALUES
    ('ver_proyectos_consultoria', 'Ver Proyectos → Consultoría'),
    ('ver_proyectos_obra', 'Ver Proyectos → Obra'),
    ('ver_proyectos_catalogo', 'Ver Proyectos → Catálogo'),
    ('ver_proyectos_reuniones', 'Ver Proyectos → Reuniones, acuerdos y mejoras')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT rp.rol_id, nuevo.id
FROM roles_permisos rp
JOIN permisos base ON base.id = rp.permiso_id AND base.nombre = 'ver_proyectos'
CROSS JOIN permisos nuevo
WHERE nuevo.nombre IN ('ver_proyectos_consultoria', 'ver_proyectos_obra', 'ver_proyectos_catalogo', 'ver_proyectos_reuniones')
ON CONFLICT DO NOTHING;
