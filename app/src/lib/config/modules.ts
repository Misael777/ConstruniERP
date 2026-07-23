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

export const MODULE_REGISTRY: ModuleItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: 'fas fa-home', permiso: 'ver_dashboard' },
  { 
    path: '/iam', 
    label: 'Control Accesos (IAM)', 
    icon: 'fas fa-users-cog', 
    permiso: 'ver_iam',
    subItems: [
      { path: '/iam/empleados', label: 'Empleados', permiso: 'ver_empleados' },
      { path: '/iam/roles-permisos', label: 'Roles y Permisos', permiso: 'ver_roles_permisos' }
    ]
  },
  { 
    path: '/comercial', 
    label: 'Comercial', 
    icon: 'fas fa-store', 
    permiso: 'ver_comercial',
    subItems: [
      { path: '/comercial/ventas', label: 'Ventas', permiso: 'ver_comercial_ventas' },
      { path: '/comercial/clientes', label: 'Clientes', permiso: 'ver_comercial_clientes' },
      { path: '/comercial/proveedores', label: 'Proveedores', permiso: 'ver_comercial_proveedores' }
    ]
  },
  { 
    path: '/proyectos', 
    label: 'Proyectos', 
    icon: 'fas fa-hard-hat', 
    permiso: 'ver_proyectos',
    subItems: [
      { path: '/proyectos/dashboard', label: 'Dashboard', permiso: 'ver_proyectos_dashboard' },
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
      { path: '/finanzas/centros-de-costos', label: 'Centro de Costos y Cuentas Internas', permiso: 'ver_finanzas_centros_costos' },
      { path: '/finanzas/cuentas-cobrar', label: 'Cuentas por Cobrar', permiso: 'ver_finanzas_cuentas_pendientes' },
      { path: '/finanzas/cuentas-pagar', label: 'Cuentas por Pagar', permiso: 'ver_finanzas_cuentas_pendientes' },
      { path: '/finanzas/tranzacciones', label: 'Tranzacciones', permiso: 'ver_finanzas_transacciones' }
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
