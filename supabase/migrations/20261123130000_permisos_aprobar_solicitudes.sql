-- Ticket #131 (23/11/2026): el permiso de aprobar solicitudes (campana "Solicitudes de aprobación") se administra desde
-- Roles y Permisos, por categoría: Finanzas, Ventas, Proyectos y Comercial. Quien tenga el permiso de una categoría ve
-- y aprueba/rechaza las solicitudes de esa categoría (no las suyas propias). El administrador sigue aprobando todas.
-- Se marca en el rol administrador solo para que la matriz lo muestre; a otros roles los asigna la clienta.
-- No modifica datos existentes. Idempotente.

INSERT INTO public.permisos (nombre, descripcion)
SELECT v.nombre, v.descripcion
FROM (VALUES
    ('aprobar_solicitudes_finanzas',  'Aprobar solicitudes de Finanzas (transacciones, cuentas por pagar/cobrar)'),
    ('aprobar_solicitudes_ventas',    'Aprobar solicitudes de Ventas (editar, eliminar o cerrar ventas, exportar ventas)'),
    ('aprobar_solicitudes_proyectos', 'Aprobar solicitudes de Proyectos'),
    ('aprobar_solicitudes_comercial', 'Aprobar solicitudes de Comercial (clientes, exportar clientes)')
) AS v(nombre, descripcion)
WHERE NOT EXISTS (SELECT 1 FROM public.permisos p WHERE p.nombre = v.nombre);

INSERT INTO public.roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM public.roles r JOIN public.permisos p ON p.nombre LIKE 'aprobar\_solicitudes\_%'
WHERE r.nombre = 'administrador'
  AND NOT EXISTS (SELECT 1 FROM public.roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);
