// =============================================
// Module Registry — Single Source of Truth
// ConstruniERP ABAC System
// =============================================

export type ModuleItem = {
  path: string;
  label: string;
  icon: string;
  permiso: string; // permission key like 'ver_iam'
  subItems?: { path: string; label: string }[];
};

export const MODULE_REGISTRY: ModuleItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: 'fas fa-home', permiso: 'ver_dashboard' },
  { 
    path: '/iam', 
    label: 'Control Accesos (IAM)', 
    icon: 'fas fa-users-cog', 
    permiso: 'ver_iam',
    subItems: [
      { path: '/iam/empleados', label: 'Empleados' },
      { path: '/iam/roles-permisos', label: 'Roles y Permisos' }
    ]
  },
  // Para agregar un nuevo módulo, simplemente añade un nuevo objeto aquí. 
  // Ejemplo: { path: '/nuevo-modulo', label: 'Nuevo Módulo', icon: 'fas fa-star', permiso: 'ver_nuevo_modulo' }
];

/**
 * Find the required permission key for a given pathname.
 * Returns null if no module matches (public route).
 */
export function getRequiredPermiso(pathname: string): string | null {
  for (const mod of MODULE_REGISTRY) {
    if (pathname.startsWith(mod.path)) return mod.permiso;
  }
  return null;
}

/** The bypass role name — sees everything regardless of permissions */
export const ADMIN_ROLE = 'administrador';
