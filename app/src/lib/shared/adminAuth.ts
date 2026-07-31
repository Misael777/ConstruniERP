import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';
import { ADMIN_ROLE } from '$lib/config/modules';

const supabaseUrl = env.PUBLIC_SUPABASE_URL || 'https://mock.supabase.co';
const supabaseAnonKey = env.PUBLIC_SUPABASE_ANON_KEY || 'mock-anon-key';

/**
 * Verifica correo/contraseña de un administrador antes de una acción destructiva (ej. borrado
 * masivo de transacciones). Usa un cliente Supabase aparte del singleton de la app — con
 * persistSession/autoRefreshToken apagados y un storageKey propio — para no pisar la sesión real
 * ya logueada en el navegador/Tauri: esto solo confirma identidad, no debe iniciar sesión de verdad.
 */
export async function verifyAdminCredentials(email: string, password: string): Promise<{ success: boolean; message: string }> {
	if (!email || !password) {
		return { success: false, message: 'Ingresa el correo y la contraseña del administrador.' };
	}

	const checkClient = createClient(supabaseUrl, supabaseAnonKey, {
		auth: { persistSession: false, autoRefreshToken: false, storageKey: 'construni-admin-confirm-noop' }
	});

	const { data, error } = await checkClient.auth.signInWithPassword({ email, password });
	if (error || !data.user) {
		return { success: false, message: 'Correo o contraseña incorrectos.' };
	}

	const { data: empleado, error: empError } = await checkClient
		.from('empleados')
		.select('rol_id, roles ( nombre )')
		.eq('auth_user_id', data.user.id)
		.maybeSingle();

	await checkClient.auth.signOut();

	if (empError || !empleado) {
		return { success: false, message: 'No se encontró un empleado vinculado a esa cuenta.' };
	}

	const rolesObj: any = Array.isArray((empleado as any).roles) ? (empleado as any).roles[0] : (empleado as any).roles;
	const rolNombre: string = rolesObj?.nombre ?? '';
	if (rolNombre !== ADMIN_ROLE) {
		return { success: false, message: 'Esa cuenta no tiene permisos de administrador.' };
	}

	return { success: true, message: 'Identidad de administrador verificada.' };
}
