-- Ticket #98: "Ver eliminados" (registros dados de baja) era solo del administrador. Nuevo permiso
-- ver_eliminados, que se asigna por rol desde Roles y Permisos; de entrada lo tienen administrador y socio.
-- Eliminar de forma permanente sigue pidiendo la contraseña de un administrador. Idempotente.
INSERT INTO permisos (nombre, descripcion)
SELECT 'ver_eliminados', 'Ver y restaurar registros dados de baja (Ver eliminados)'
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE nombre = 'ver_eliminados');

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.nombre = 'ver_eliminados'
WHERE r.nombre IN ('administrador', 'socio')
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);

NOTIFY pgrst, 'reload schema';
