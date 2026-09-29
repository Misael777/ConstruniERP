/**
 * Abre una URL externa (ej. un archivo de Drive) de forma que funcione en las tres plataformas:
 * - Navegador: pestaña nueva con window.open.
 * - Tauri Windows/Android: no hay pestañas — window.open / `<a target="_blank">` abre una ventana suelta
 *   del WebView (Windows) o no hace nada (Android). Se usa openUrl de @tauri-apps/plugin-opener, que la
 *   abre en el navegador del sistema (permitido por `opener:default`, ver capabilities/default.json;
 *   mismo mecanismo que ya usa BotonActualizar.svelte en Android).
 */
import { isRunningInTauri } from '$lib/driveUploadClient';

export async function abrirEnlaceExterno(url: string): Promise<void> {
	if (isRunningInTauri()) {
		const { openUrl } = await import('@tauri-apps/plugin-opener');
		await openUrl(url);
		return;
	}
	window.open(url, '_blank', 'noopener');
}

/** Para `<a href target="_blank" onclick={(e) => interceptarEnlaceExterno(e, url)}>`: en navegador deja
 * que el enlace actúe normal; en Tauri cancela la navegación y abre la URL con abrirEnlaceExterno. */
export function interceptarEnlaceExterno(e: MouseEvent, url: string | null | undefined): void {
	if (!isRunningInTauri()) return;
	e.preventDefault();
	if (!url) return;
	void abrirEnlaceExterno(url).catch((err) => console.error('[enlaceExterno] No se pudo abrir la URL:', err));
}
