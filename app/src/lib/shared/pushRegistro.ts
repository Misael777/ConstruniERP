/**
 * Ticket #113: registra el celular para recibir notificaciones push (Firebase Cloud Messaging) aunque la app esté
 * cerrada. Solo en la app de Android: pide el permiso de notificaciones, obtiene el token de Firebase (plugin nativo
 * "push", ver app/src-tauri/plugins/tauri-plugin-push) y lo guarda con el usuario (fn_registrar_dispositivo_push).
 * Al cerrar sesión se quita, para que el celular deje de recibir los avisos de ese usuario.
 * Todo es best-effort: si algo falla (app compilada sin Firebase, base sin la migración), no pasa nada.
 */
import { supabase } from '$lib/supabaseClient';
import { isRunningInTauri } from '$lib/driveUploadClient';
import { ensureNotificacionPermission } from '$lib/modules/aprobaciones/services/notificacionNativa';

let tokenActual: string | null = null;

async function esAndroid(): Promise<boolean> {
	if (!isRunningInTauri()) return false;
	try {
		const { platform } = await import('@tauri-apps/plugin-os');
		return platform() === 'android';
	} catch {
		return false;
	}
}

async function obtenerToken(): Promise<string | null> {
	const { invoke } = await import('@tauri-apps/api/core');
	const r = await invoke<{ token: string | null }>('plugin:push|obtener_token');
	return r?.token ?? null;
}

export async function registrarDispositivoPush(): Promise<void> {
	try {
		if (!(await esAndroid())) return;
		await ensureNotificacionPermission();
		const token = await obtenerToken();
		if (!token) return;
		const { error } = await supabase.rpc('fn_registrar_dispositivo_push', { p_token: token, p_plataforma: 'android' });
		if (error) {
			if (error.code !== 'PGRST202') console.warn('[push] No se pudo registrar el celular:', error.message);
			return;
		}
		tokenActual = token;
	} catch (err) {
		console.warn('[push] Registro omitido:', err);
	}
}

/** Antes de cerrar sesión (con la sesión aún activa): este celular deja de recibir los avisos del usuario. */
export async function quitarDispositivoPush(): Promise<void> {
	if (!tokenActual) return;
	try {
		await supabase.rpc('fn_quitar_dispositivo_push', { p_token: tokenActual });
	} catch {
		/* sin conexión: se limpia solo cuando Firebase marque el token como inválido o entre otro usuario */
	}
	tokenActual = null;
}
