/**
 * Verificación de sesión server-side vía la cookie que sincroniza $lib/authCookie.ts.
 * Ver ese archivo para el porqué de este puente (el proyecto no usa @supabase/ssr).
 */

import type { Cookies } from '@sveltejs/kit';
import { supabase } from './supabase';
import { ADMIN_ROLE } from '$lib/config/modules';

const ACCESS_TOKEN_COOKIE = 'sb-access-token';

export interface ServerAuth {
	userId: string;
	email: string | null;
	rolNombre: string | null;
}

/** Lee la cookie de sesión, valida el token contra Supabase Auth y resuelve el rol del empleado. */
export async function getServerAuth(cookies: Cookies): Promise<ServerAuth | null> {
	const token = cookies.get(ACCESS_TOKEN_COOKIE);
	if (!token) return null;

	const { data: userData, error: userError } = await supabase.auth.getUser(token);
	if (userError || !userData?.user) return null;

	const { data: empleado } = await supabase
		.from('empleados')
		.select('roles ( nombre )')
		.eq('auth_user_id', userData.user.id)
		.single();

	const rolesObj: any = Array.isArray(empleado?.roles) ? empleado?.roles[0] : empleado?.roles;

	return {
		userId: userData.user.id,
		email: userData.user.email ?? null,
		rolNombre: rolesObj?.nombre ?? null
	};
}

/** Atajo: ¿la petición actual viene de un usuario con rol administrador? */
export async function isAdminRequest(cookies: Cookies): Promise<boolean> {
	const auth = await getServerAuth(cookies);
	return auth?.rolNombre === ADMIN_ROLE;
}
