/**
 * Notificación nativa del sistema operativo (bandeja de Windows / centro de notificaciones de
 * Android) — a pedido del usuario, además del sonido dentro de la app y el badge de la campanita,
 * las versiones empaquetadas (Tauri) deben mostrar el toast nativo del SO. Fuera de esas versiones
 * (navegador normal) esta función no hace nada — no se pidió Web Notification API para el navegador.
 *
 * OJO — dos limitaciones reales de esta implementación (notificación LOCAL disparada por la propia
 * app mientras sigue corriendo), no un bug a arreglar acá:
 *  1. En Windows, el toast usa WinRT (`tauri-winrt-notification`, vía el plugin) y requiere un AUMID
 *     asociado a la app — eso solo queda bien registrado en un build INSTALADO (el .exe del
 *     instalador NSIS/MSI, que crea el acceso directo del menú Inicio). Corriendo con
 *     `npm run tauri dev` el toast puede no aparecer nunca aunque el código esté bien — hay que
 *     probarlo con `npm run tauri build` + instalar el resultado.
 *  2. En Android, esto SOLO funciona mientras el proceso de la app sigue vivo (minimizada está bien,
 *     Android no la mata de inmediato) — con la app completamente cerrada no hay ningún proceso
 *     corriendo el polling que dispare esto. Notificaciones con la app cerrada requieren push real
 *     (Firebase Cloud Messaging) — arquitectura server-push, no cliente-poll, fuera del alcance de
 *     este archivo.
 */
import { isRunningInTauri } from '$lib/driveUploadClient';

let permisoResuelto: boolean | null = null;

/** Verifica/pide el permiso de notificaciones del SO una sola vez (cachea el resultado en memoria)
 * — se llama apenas monta la campanita, en vez de esperar al primer evento real, para que el
 * permiso ya esté resuelto (y, en Android 13+, el diálogo del sistema aparezca apenas se abre la
 * app, no en medio de un poll en segundo plano). */
export async function ensureNotificacionPermission(): Promise<boolean> {
	if (!isRunningInTauri()) return false;
	if (permisoResuelto !== null) return permisoResuelto;

	try {
		const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
		let granted = await isPermissionGranted();
		if (!granted) {
			const permission = await requestPermission();
			granted = permission === 'granted';
		}
		permisoResuelto = granted;
		if (!granted) {
			console.warn('[notificacionNativa] Permiso de notificaciones del SO no concedido — revisa la configuración de notificaciones de Windows/Android para esta app.');
		}
		return granted;
	} catch (err) {
		console.error('[notificacionNativa] Error verificando/pidiendo permiso de notificaciones:', err);
		permisoResuelto = false;
		return false;
	}
}

/** Envía una notificación nativa si (y solo si) la app corre empaquetada en Tauri (Windows/Android)
 * y el permiso ya fue concedido. Falla en silencio (con log) si no — la campanita + sonido dentro de
 * la app ya cubrieron el aviso de todos modos. */
export async function sendNotificacionNativa(titulo: string, cuerpo: string): Promise<void> {
	if (!isRunningInTauri()) return;

	try {
		const granted = await ensureNotificacionPermission();
		if (!granted) return;

		const { sendNotification } = await import('@tauri-apps/plugin-notification');
		sendNotification({ title: titulo, body: cuerpo });
		console.info('[notificacionNativa] Notificación nativa enviada:', titulo, '-', cuerpo);
	} catch (err) {
		console.error('[notificacionNativa] No se pudo enviar la notificación nativa:', err);
	}
}
