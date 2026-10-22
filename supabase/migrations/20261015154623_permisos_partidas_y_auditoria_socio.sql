-- Ticket #97: siendo "socio" (no administrador) no se veían todos los módulos.
--   1) "Partidas y Plantillas" (menú Proyectos) exige el permiso ver_proyectos_partidas, que NUNCA se creó en la
--      tabla permisos: solo el administrador (que no pasa por permisos) podía verlo, y la pantalla Roles y
--      Permisos no podía otorgarlo (la casilla no tenía permiso detrás). Se crea y se otorga a administrador,
--      socio y developer (los roles con acceso total); los demás roles se pueden ajustar desde Roles y Permisos.
--   2) "Auditoría" (ver_iam_auditoria) solo la tenía el administrador. Se otorga también al socio.
-- Idempotente: no duplica el permiso ni las asignaciones; si un rol no existe, simplemente no se asigna.
INSERT INTO permisos (nombre, descripcion)
SELECT 'ver_proyectos_partidas', 'Ver Partidas y Plantillas (Proyectos)'
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE nombre = 'ver_proyectos_partidas');

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.nombre = 'ver_proyectos_partidas'
WHERE r.nombre IN ('administrador', 'socio', 'developer')
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);

INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.nombre = 'ver_iam_auditoria'
WHERE r.nombre IN ('administrador', 'socio')
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);

NOTIFY pgrst, 'reload schema';
