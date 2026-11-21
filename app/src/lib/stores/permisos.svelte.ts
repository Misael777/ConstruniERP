// =============================================
// Permissions Store — Svelte 5 Runes
// ConstruniERP ABAC System
// =============================================

import { supabase } from '$lib/supabaseClient';
import { ROLES_ADMIN, DEVELOPER_ROLE, SUPERUSUARIO_EMAIL, PERMISO_SOLO_SUPERUSUARIO } from '$lib/config/modules';

// --------------- Reactive State ---------------
export const permisosState = $state<{
  permisos: string[];
  rolNombre: string;
  userName: string;
  userInitial: string;
  /** DNI del empleado (ver empleados.dni, migración empleados_dni_migration.sql) — usado para
   * autocompletar "Datos de quien recibe" en el RECIBO DE PAGO (ver ReciboPagoModal.svelte). Vacío si
   * el empleado todavía no lo tiene cargado en IAM → Empleados. */
  dni: string;
  /** Correo de la sesión (para los módulos solo del superusuario, ver esSuperusuario). */
  email: string;
  /** Ticket #121: foto del trabajador vinculado a este usuario (personal.foto_url, enlace de Drive) para el círculo
   * de la cabecera y del menú. null = se muestran las iniciales. */
  fotoUrl: string | null;
  loaded: boolean;
}>({
  permisos: [],
  rolNombre: '',
  userName: '',
  userInitial: '',
  dni: '',
  email: '',
  fotoUrl: null,
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
    try {
      const { data: { session } } = await supabase.auth.getSession();
      permisosState.email = (session?.user?.email ?? '').toLowerCase();
    } catch {
      permisosState.email = '';
    }
    // 1. Get employee + role name
    console.log('[Permisos] Fetching employee profile and role from Supabase for auth_user_id:', userId);
    // OJO: `dni` NO va en este select — esta consulta es crítica (corre en cada carga de la app, para
    // TODOS los usuarios) y si la columna todavía no existe en un entorno donde no se corrió
    // empleados_dni_migration.sql, el error tira todo el query abajo (empError truthy), degradando a
    // CUALQUIER usuario a "sin rol" / permisos vacíos = bloqueado del ERP entero. Se carga aparte, en
    // una consulta best-effort separada que no puede romper esto (ver más abajo).
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
      permisosState.dni = '';
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
    permisosState.userInitial = inicialesDe(nombre);

    // Best-effort, aparte de todo lo de arriba: si la columna dni no existe todavía (o cualquier otro
    // fallo), esto NUNCA debe degradar rol/permisos — solo el campo dni se queda vacío.
    (async () => {
      try {
        const { data, error } = await supabase.from('empleados').select('dni').eq('auth_user_id', userId).maybeSingle();
        if (!error) permisosState.dni = (data as any)?.dni ?? '';
      } catch {
        // Best-effort — ver comentario arriba.
      }
    })();
    void cargarFotoUsuario(userId);

    // 2. If admin (o developer, mismos permisos), set wildcard — no need to query permissions
    if (ROLES_ADMIN.includes(rolNombre)) {
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

/** "Romina Casallo Echegaray" → "RC" (antes solo la primera letra). */
export function inicialesDe(nombre: string): string {
  return (nombre || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || 'U';
}

/** Ticket #121: foto del trabajador (RR.HH. → Personal) vinculado a este usuario. Best-effort: si falla, iniciales. */
export async function cargarFotoUsuario(userId?: string): Promise<void> {
  try {
    let uid = userId;
    if (!uid) {
      const { data: { session } } = await supabase.auth.getSession();
      uid = session?.user?.id;
    }
    if (!uid) return;
    const { data: emp } = await supabase.from('empleados').select('id').eq('auth_user_id', uid).maybeSingle();
    if (!emp?.id) return;
    const { data: per } = await supabase
      .from('personal')
      .select('foto_url')
      .eq('id_empleado', emp.id)
      .not('foto_url', 'is', null)
      .limit(1)
      .maybeSingle();
    permisosState.fotoUrl = (per as any)?.foto_url ?? null;
  } catch {
    // Sin foto: se muestran las iniciales.
  }
}

// Map frontend-only sidebar check permissions to DB database permissions
/** Check if the current user has a specific permission (or is admin) */
export function hasPermiso(key: string): boolean {
  // Módulos solo del superusuario: ni el comodín del administrador ni un rol los habilita.
  if (key === PERMISO_SOLO_SUPERUSUARIO) return esSuperusuario();
  if (permisosState.permisos.includes('*')) {
    console.log(`[Permisos Check] Checking for "${key}". Admin wildcard bypass. Result: true`);
    return true; // admin bypass
  }

  const result = permisosState.permisos.includes(key);

  console.log(`[Permisos Check] Checking for permission "${key}". User permissions:`, JSON.stringify(permisosState.permisos), `Result: ${result}`);
  return result;
}

/** Check if current user is the administrador role */
/** Ticket #98: "Ver eliminados" (registros dados de baja, para revisarlos o restaurarlos) — ya no es solo del
 * administrador: también quien tenga el permiso ver_eliminados (se asigna en Roles y Permisos). Eliminar de
 * forma permanente sigue pidiendo la contraseña de un administrador. */
/** Solo el rol developer: herramientas de desarrollo (cambiar de base Prod/Dev, vaciar Dev, Panel Developer). */
export function esDeveloper(): boolean {
  return permisosState.rolNombre === DEVELOPER_ROLE;
}

/** La cuenta superusuario (construnisys). */
export function esSuperusuario(): boolean {
  return permisosState.email === SUPERUSUARIO_EMAIL;
}

export function puedeVerEliminados(): boolean {
  return isAdmin() || hasPermiso('ver_eliminados');
}

/** Administrador o developer (mismos permisos, ver ROLES_ADMIN). */
export function isAdmin(): boolean {
  const result = ROLES_ADMIN.includes(permisosState.rolNombre);
  console.log(`[Permisos Check] Checking if user is admin. Current role: "${permisosState.rolNombre}". Result: ${result}`);
  return result;
}
