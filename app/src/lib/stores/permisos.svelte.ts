// =============================================
// Permissions Store — Svelte 5 Runes
// ConstruniERP ABAC System
// =============================================

import { supabase } from '$lib/supabaseClient';
import { ADMIN_ROLE } from '$lib/config/modules';

// --------------- Reactive State ---------------
export const permisosState = $state<{
  permisos: string[];
  rolNombre: string;
  userName: string;
  userInitial: string;
  loaded: boolean;
}>({
  permisos: [],
  rolNombre: '',
  userName: '',
  userInitial: '',
  loaded: false,
});

// --------------- Loaders ---------------

/**
 * Load the current user's employee info, role, and permissions from Supabase.
 * Must be called after confirming the user has a valid session.
 */
export async function loadPermisos(userId: string): Promise<void> {
  console.log('[Permisos] loadPermisos started for userId:', userId);
  try {
    // 1. Get employee + role name
    console.log('[Permisos] Fetching employee profile and role from Supabase for auth_user_id:', userId);
    const { data: empleado, error: empError } = await supabase
      .from('empleados')
      .select(`
        nombre,
        rol_id,
        roles ( nombre )
      `)
      .eq('auth_user_id', userId)
      .single();

    if (empError || !empleado) {
      console.warn('[Permisos] Warn: No se encontró empleado o hubo un error para auth_user_id:', userId, empError);
      permisosState.permisos = [];
      permisosState.rolNombre = 'sin rol';
      permisosState.userName = 'Usuario';
      permisosState.userInitial = 'U';
      permisosState.loaded = true;
      console.log('[Permisos] State fallback initialized:', JSON.stringify(permisosState));
      return;
    }

    console.log('[Permisos] Raw employee data retrieved:', JSON.stringify(empleado));

    // Extract role name (supabase join may return object or array)
    const rolesObj: any = Array.isArray(empleado.roles) ? empleado.roles[0] : empleado.roles;
    const rolNombre: string = rolesObj?.nombre ?? 'sin rol';
    const nombre: string = empleado.nombre ?? 'Usuario';

    console.log('[Permisos] Extracted user profile details:', { nombre, rolNombre, rolId: empleado.rol_id });

    permisosState.rolNombre = rolNombre;
    permisosState.userName = nombre;
    permisosState.userInitial = nombre.charAt(0).toUpperCase();

    // 2. If admin, set wildcard — no need to query permissions
    if (rolNombre === ADMIN_ROLE) {
      console.log('[Permisos] User is an administrator. Assigning wildcard permission ("*").');
      permisosState.permisos = ['*'];
      permisosState.loaded = true;
      console.log('[Permisos] permisosState updated (admin):', JSON.stringify(permisosState));
      return;
    }

    // 3. Query actual permissions for this role
    if (!empleado.rol_id) {
      console.warn('[Permisos] Warn: Empleado has no rol_id assigned.');
      permisosState.permisos = [];
      permisosState.loaded = true;
      console.log('[Permisos] permisosState updated (no rol_id):', JSON.stringify(permisosState));
      return;
    }

    console.log('[Permisos] Querying roles_permisos for rol_id:', empleado.rol_id);
    const { data: permsData, error: permsError } = await supabase
      .from('roles_permisos')
      .select(`
        permisos ( nombre )
      `)
      .eq('rol_id', empleado.rol_id);

    if (permsError) {
      console.error('[Permisos] Error querying roles_permisos:', permsError);
      permisosState.permisos = [];
      permisosState.loaded = true;
      console.log('[Permisos] permisosState updated (query error):', JSON.stringify(permisosState));
      return;
    }

    console.log('[Permisos] Raw permissions data retrieved:', JSON.stringify(permsData));

    // Extract permission names from joined result
    const permisoNames: string[] = (permsData ?? [])
      .map((row: any) => {
        const p = Array.isArray(row.permisos) ? row.permisos[0] : row.permisos;
        return p?.nombre as string | undefined;
      })
      .filter((n): n is string => !!n);

    console.log('[Permisos] Extracted permission names array:', permisoNames);

    permisosState.permisos = permisoNames;
    permisosState.loaded = true;
    console.log('[Permisos] permisosState successfully loaded:', JSON.stringify(permisosState));
  } catch (e) {
    console.error('[Permisos] Exception in loadPermisos:', e);
    permisosState.permisos = [];
    permisosState.loaded = true;
  }
}

// --------------- Helpers ---------------

// Map frontend-only sidebar check permissions to DB database permissions
const PERMISO_MAPPING: Record<string, string> = {
  'ver_dashboard': 'dashboard:read',
  'ver_proyectos': 'proyectos:read',
  'ver_compras': 'compras:read',
  'ver_almacen': 'almacen:read',
  'ver_ventas': 'ventas:read',
  'ver_finanzas': 'finanzas:read',
  'ver_rrhh': 'recursos_humanos:read',
  'ver_iam': 'iam:read',
  'ver_configuracion': 'configuracion:read'
};

/** Check if the current user has a specific permission (or is admin) */
export function hasPermiso(key: string): boolean {
  if (permisosState.permisos.includes('*')) {
    console.log(`[Permisos Check] Checking for "${key}". Admin wildcard bypass. Result: true`);
    return true; // admin bypass
  }
  
  const dbKey = PERMISO_MAPPING[key] || key;
  const result = permisosState.permisos.includes(dbKey) || permisosState.permisos.includes(key);
  
  console.log(`[Permisos Check] Checking for permission "${key}" (mapped to: "${dbKey}"). User permissions:`, JSON.stringify(permisosState.permisos), `Result: ${result}`);
  return result;
}

/** Check if current user is the administrador role */
export function isAdmin(): boolean {
  const result = permisosState.rolNombre === ADMIN_ROLE;
  console.log(`[Permisos Check] Checking if user is admin. Current role: "${permisosState.rolNombre}". Result: ${result}`);
  return result;
}
