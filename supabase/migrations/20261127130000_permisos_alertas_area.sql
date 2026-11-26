-- Ticket #143 (26/11/2026): en Roles y Permisos, las Alertas de tareas se asignan POR ÁREA (Recursos Humanos, Proyectos y
-- Finanzas), para ver de un vistazo quién recibe cada una. Antes dependían de permisos de otros módulos (ver el personal,
-- la gestión de proyectos, las cuentas pendientes) y en la práctica solo las veían Administrador y Socio.
-- Para que nada cambie el día del cambio, cada rol recibe la alerta del área cuyo permiso antiguo ya tenía; desde ahí la
-- clienta las da o quita en la matriz. Las alertas a cargo de cada persona ("Mis tareas") le llegan siempre.
-- Idempotente.

INSERT INTO public.permisos (nombre, descripcion)
SELECT v.nombre, v.descripcion
FROM (VALUES
    ('ver_alertas_rrhh',      'Alertas de tareas de Recursos Humanos (SCTR, examen médico, contratos, seguros)'),
    ('ver_alertas_proyectos', 'Alertas de tareas de Proyectos (entregables y reuniones por vencer)'),
    ('ver_alertas_finanzas',  'Alertas de tareas de Finanzas (cuentas por cobrar y por pagar por vencer)')
) AS v(nombre, descripcion)
WHERE NOT EXISTS (SELECT 1 FROM public.permisos p WHERE p.nombre = v.nombre);

INSERT INTO public.roles_permisos (rol_id, permiso_id)
SELECT DISTINCT rp.rol_id, nuevo.id
FROM public.roles_permisos rp
JOIN public.permisos viejo ON viejo.id = rp.permiso_id
JOIN public.permisos nuevo ON nuevo.nombre = CASE viejo.nombre
        WHEN 'ver_rrhh_personal' THEN 'ver_alertas_rrhh'
        WHEN 'ver_proyectos_gestion' THEN 'ver_alertas_proyectos'
        WHEN 'ver_finanzas_cuentas_pendientes' THEN 'ver_alertas_finanzas'
    END
WHERE NOT EXISTS (SELECT 1 FROM public.roles_permisos x WHERE x.rol_id = rp.rol_id AND x.permiso_id = nuevo.id);
