// =============================================
// Module Registry — Single Source of Truth
// ConstruniERP ABAC System
// =============================================

export type ModuleItem = {
  path: string;
  label: string;
  icon: string;
  permiso: string; // permission key like 'ver_iam'
  subItems?: { path: string; label: string; permiso?: string }[];
};

/** Cuenta superusuario: la única que ve los módulos marcados con PERMISO_SOLO_SUPERUSUARIO (ni otros
 * administradores ni el developer). */
export const SUPERUSUARIO_EMAIL = 'construnisys@gmail.com';
/** Permiso especial: no se asigna en Roles y Permisos ni lo cubre el comodín '*' del administrador. */
export const PERMISO_SOLO_SUPERUSUARIO = 'solo_superusuario';

export const MODULE_REGISTRY: ModuleItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: 'fas fa-home', permiso: 'ver_dashboard' },
  { 
    path: '/iam', 
    label: 'Control Accesos (IAM)', 
    icon: 'fas fa-users-cog', 
    permiso: 'ver_iam',
    subItems: [
      { path: '/iam/empleados', label: 'Empleados', permiso: 'ver_empleados' },
      { path: '/iam/roles-permisos', label: 'Roles y Permisos', permiso: 'ver_roles_permisos' },
      { path: '/iam/auditoria', label: 'Auditoría', permiso: 'ver_iam_auditoria' }
    ]
  },
  { 
    path: '/comercial', 
    label: 'Comercial', 
    icon: 'fas fa-store', 
    permiso: 'ver_comercial',
    subItems: [
      { path: '/comercial/clientes', label: 'Clientes', permiso: 'ver_comercial_clientes' },
      { path: '/comercial/ventas', label: 'Ventas', permiso: 'ver_comercial_ventas' }
    ]
  },
  { 
    path: '/proyectos', 
    label: 'Proyectos', 
    icon: 'fas fa-hard-hat', 
    permiso: 'ver_proyectos',
    subItems: [
      { path: '/proyectos/dashboard', label: 'Dashboard', permiso: 'ver_proyectos_dashboard' },
      // A pedido del usuario (con imagen): submódulos nuevos — se suman a Gestión y Partidas y Plantillas.
      { path: '/proyectos/consultoria', label: 'Consultoría', permiso: 'ver_proyectos_consultoria' },
      { path: '/proyectos/obra', label: 'Obra', permiso: 'ver_proyectos_obra' },
      { path: '/proyectos/catalogo', label: 'Catálogo', permiso: 'ver_proyectos_catalogo' },
      { path: '/proyectos/reuniones', label: 'Reuniones, acuerdos y mejoras', permiso: 'ver_proyectos_reuniones' },
      // "Presupuesto" ya no es un enlace propio del menú — a pedido explícito del usuario, ahora vive
      // como pestaña DENTRO de Gestión (ver proyectos/gestion/+page.svelte, PresupuestoModule.svelte).
      { path: '/proyectos/gestion', label: 'Gestión', permiso: 'ver_proyectos_gestion' },
      { path: '/proyectos/partidas', label: 'Partidas y Plantillas', permiso: 'ver_proyectos_partidas' }
    ]
  },
  { 
    path: '/finanzas', 
    label: 'Finanzas', 
    icon: 'fas fa-chart-line', 
    permiso: 'ver_finanzas',
    subItems: [
      // Pedido del usuario (14/11/2026): Control Financiero solo lo ve el superusuario (ver SUPERUSUARIO_EMAIL).
      { path: '/finanzas/control-financiero', label: 'Control Financiero', permiso: PERMISO_SOLO_SUPERUSUARIO },
      { path: '/finanzas/centros-de-costos', label: 'Centro de Costos y Cuentas Internas', permiso: 'ver_finanzas_centros_costos' },
      { path: '/finanzas/cuentas-cobrar', label: 'Cuentas por Cobrar', permiso: 'ver_finanzas_cuentas_pendientes' },
      { path: '/finanzas/cuentas-pagar', label: 'Cuentas por Pagar', permiso: 'ver_finanzas_cuentas_pendientes' },
      { path: '/finanzas/facturacion', label: 'Emisión de Comprobante', permiso: 'ver_finanzas_facturacion' },
      { path: '/finanzas/tranzacciones', label: 'Transacciones', permiso: 'ver_finanzas_transacciones' },
      { path: '/finanzas/cuentas-bancarias', label: 'Cuentas Bancarias', permiso: 'ver_finanzas_cuentas_bancarias' },
      { path: '/finanzas/proveedores', label: 'Proveedores', permiso: 'ver_comercial_proveedores' }
    ]
  },
  {
    // Personal de obra, horarios y control de asistencia con huelleros ZKTeco (receptor ADMS en
    // servicios/huellero-adms). El control de asistencia (tareo) se suma aquí.
    path: '/rrhh',
    label: 'Personal y Asistencia',
    icon: 'fas fa-id-badge',
    permiso: 'ver_rrhh',
    subItems: [
      { path: '/rrhh/personal', label: 'Personal', permiso: 'ver_rrhh_personal' },
      { path: '/rrhh/asistencia', label: 'Asistencia', permiso: 'ver_rrhh_asistencia' },
      { path: '/rrhh/horarios', label: 'Horarios', permiso: 'ver_rrhh_horarios' },
      { path: '/rrhh/huelleros', label: 'Huelleros', permiso: 'ver_rrhh_huelleros' }
    ]
  },
  {
    path: '/soporte',
    label: 'Soporte',
    icon: 'fas fa-life-ring',
    permiso: 'ver_soporte',
    subItems: [
      // 'ver_soporte_tickets' se otorga a TODOS los roles en ticket_module_migration.sql — cualquier
      // usuario debe poder reportar un reclamo/incidencia/sugerencia/requerimiento, no solo
      // developer/admin.
      { path: '/soporte/tickets', label: 'Mis Tickets', permiso: 'ver_soporte_tickets' },
      // Bandeja completa (todos los tickets, aprobar/rechazar, releases) — solo developer/admin.
      { path: '/soporte/developer', label: 'Panel Developer', permiso: 'ver_soporte_developer' }
    ]
  }
];

/**
 * Find the required permission key for a given pathname.
 * Returns null if no module matches (public route).
 */
export function getRequiredPermiso(pathname: string): string | null {
  for (const mod of MODULE_REGISTRY) {
    if (pathname.startsWith(mod.path)) {
      if (mod.subItems) {
        for (const sub of mod.subItems) {
          if (pathname.startsWith(sub.path) && sub.permiso) {
            return sub.permiso;
          }
        }
      }
      return mod.permiso;
    }
  }
  return null;
}

/**
 * Finds the first path the user actually has permission to see, walking MODULE_REGISTRY in
 * order. Used to redirect somewhere useful after login (or after a denied-route redirect)
 * instead of hardcoding '/dashboard' — a user without ver_dashboard would otherwise get bounced
 * back to the very page that just denied them, stuck on the loading spinner forever (that page's
 * own onMount never re-fires, since goto() to the SAME path is a no-op in SvelteKit).
 * Takes `hasPermisoFn` as a parameter (not imported directly) to avoid a circular import with
 * $lib/stores/permisos.svelte, which itself imports ADMIN_ROLE from this file.
 * Returns null if the user has no access to anything — caller must show a "no access" screen,
 * NOT redirect again (that would just recreate the same stuck-loop bug from another angle).
 */
export function getFirstAccessiblePath(hasPermisoFn: (key: string) => boolean): string | null {
  for (const mod of MODULE_REGISTRY) {
    if (mod.subItems) {
      for (const sub of mod.subItems) {
        if (hasPermisoFn(sub.permiso ?? mod.permiso)) return sub.path;
      }
    } else if (hasPermisoFn(mod.permiso)) {
      return mod.path;
    }
  }
  return null;
}

/** The bypass role name — sees everything regardless of permissions */
export const ADMIN_ROLE = 'administrador';
/** Rol del desarrollador del ERP. A pedido del usuario (22/10/2026) tiene automáticamente los mismos permisos
 * que el administrador (en la base: is_admin(), ver 20261022150000_developer_igual_admin.sql) y además lo
 * exclusivo de desarrollo (cambiar entre Prod y Dev, vaciar Dev). */
export const DEVELOPER_ROLE = 'developer';
/** Roles con todos los permisos. */
export const ROLES_ADMIN = [ADMIN_ROLE, DEVELOPER_ROLE];
