import { supabase } from '$lib/supabaseClient';

/**
 * Verifica correo/contraseña de un administrador antes de una acción destructiva (ej. borrado
 * masivo de transacciones) SIN iniciar una sesión real — llama a fn_verificar_credenciales_admin
 * (RPC, ver verificar_admin_sin_sesion_migration.sql), que compara la contraseña directo contra
 * auth.users con pgcrypto, sin pasar por supabase.auth.signInWithPassword.
 *
 * Antes esto hacía un signInWithPassword real en un cliente Supabase aparte (con persistSession
 * apagado) para "no pisar la sesión real ya logueada" en el navegador/Tauri. Eso aísla el estado
 * LOCAL, pero si el proyecto de Supabase tiene habilitado "Single session per user" en su
 * configuración de Auth, ese signInWithPassword invalida del lado del SERVIDOR cualquier OTRA
 * sesión activa del MISMO usuario — sin importar en qué cliente se hizo el login original. Como
 * quien confirma suele ser el propio admin usando SU cuenta, esto revocaba la sesión real de la
 * app: el siguiente refresco de token fallaba, supabase-js emitía SIGNED_OUT, y el layout
 * ((app)/+layout.svelte) sacaba al usuario a /login sin llegar a ejecutar la acción que había
 * pedido confirmar. Un RPC que solo LEE auth.users no crea ni toca ninguna sesión, así que no
 * puede provocar esto sin importar esa configuración del proyecto.
 */
export async function verifyAdminCredentials(email: string, password: string): Promise<{ success: boolean; message: string }> {
	if (!email || !password) {
		return { success: false, message: 'Ingresa el correo y la contraseña del administrador.' };
	}

	const { data, error } = await supabase.rpc('fn_verificar_credenciales_admin', { p_email: email, p_password: password });
	if (error) return { success: false, message: `No se pudo verificar la identidad: ${error.message}` };

	const fila = Array.isArray(data) ? data[0] : data;
	if (!fila || !fila.es_admin) return { success: false, message: fila?.mensaje ?? 'No se pudo verificar la identidad.' };

	return { success: true, message: fila.mensaje ?? 'Identidad de administrador verificada.' };
}
