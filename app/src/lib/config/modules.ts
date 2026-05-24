// =============================================
// Module Registry — Single Source of Truth
// ConstruniERP ABAC System
// =============================================

export type ModuleItem = {
  path: string;
  label: string;
  icon: string;
  permiso: string; // permission key like 'ver_ventas'
  subItems?: { path: string; label: string }[];
};

export const MODULE_REGISTRY: ModuleItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: 'fas fa-home', permiso: 'ver_dashboard' },
  {
    path: '/proyectos',
    label: 'Proyectos',
    icon: 'fas fa-city',
    permiso: 'ver_proyectos',
    subItems: [
      { path: '/proyectos/consultorias', label: 'Consultorías' },
      { path: '/proyectos/obras', label: 'Obras' }
    ]
  },
  { path: '/compras', label: 'Compras', icon: 'fas fa-shopping-cart', permiso: 'ver_compras' },
  { path: '/almacen', label: 'Almacén', icon: 'fas fa-box', permiso: 'ver_almacen' },
  { path: '/ventas', label: 'Ventas', icon: 'fas fa-chart-line', permiso: 'ver_ventas' },
  {
    path: '/finanzas',
    label: 'Finanzas',
    icon: 'fas fa-wallet',
    permiso: 'ver_finanzas',
    subItems: [
      { path: '/finanzas/resumen', label: 'Resumen' },
      { path: '/finanzas/cuentas-por-cobrar', label: 'Cuentas por Cobrar' },
      { path: '/finanzas/cuentas-por-pagar', label: 'Cuentas por Pagar' },
      { path: '/finanzas/pagos', label: 'Pagos' },
      { path: '/finanzas/egresos', label: 'Egresos' },
      { path: '/finanzas/reportes', label: 'Reportes' },
    ]
  },
  { path: '/recursos-humanos', label: 'Recursos Humanos', icon: 'fas fa-users', permiso: 'ver_rrhh' },
  { path: '/iam', label: 'Control Accesos (IAM)', icon: 'fas fa-users-cog', permiso: 'ver_iam' },
  { path: '/configuracion', label: 'Configuración', icon: 'fas fa-cog', permiso: 'ver_configuracion' },
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
