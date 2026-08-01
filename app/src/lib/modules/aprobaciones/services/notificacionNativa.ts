/**
 * Notificación nativa del sistema operativo (bandeja de Windows / centro de notificaciones de
 * Android) — a pedido del usuario, además del sonido dentro de la app y el badge de la campanita,
 * las versiones empaquetadas (Tauri) deben mostrar el toast nativo del SO. Fuera de esas versiones
 * (navegador normal) esta función no hace nada — no se pidió Web Notification API para el navegador.
 */
import { isRunningInTauri } from '$lib/driveUploadClient';

/** Envía una notificación nativa si (y solo si) la app corre empaquetada en Tauri (Windows/Android).
 * Pide permiso la primera vez que hace falta; si el usuario lo niega, falla en silencio (la
 * campanita + sonido dentro de la app ya cubrieron el aviso). */
export async function sendNotificacionNativa(titulo: string, cuerpo: string): Promise<void> {
	if (!isRunningInTauri()) return;

	try {
		const { isPermissionGranted, requestPermission, sendNotification } = await import(
			'@tauri-apps/plugin-notification'
		);

		let granted = await isPermissionGranted();
		if (!granted) {
			const permission = await requestPermission();
			granted = permission === 'granted';
		}
		if (!granted) return;

		sendNotification({ title: titulo, body: cuerpo });
	} catch (err) {
		console.warn('[notificacionNativa] No se pudo enviar la notificación nativa:', err);
	}
}
