/**
 * Convierte una URL de descarga directa de Google Drive
 * (`https://drive.google.com/uc?export=download&id=...`, el formato que produce todo el flujo de
 * subida de este ERP — ver driveUploadClient.ts / server/config.ts) a la URL del visor embebible de
 * Drive (`.../file/d/{id}/preview`), que sirve tanto para PDFs como para imágenes dentro de un
 * <iframe>. Usado por DocumentPreviewModal.svelte. URLs que no son de Drive se devuelven tal cual.
 */
export function toDrivePreviewUrl(url: string | null | undefined): string {
	if (!url) return '';
	try {
		const u = new URL(url);
		if (u.hostname.includes('drive.google.com')) {
			const id = u.searchParams.get('id');
			if (id) return `https://drive.google.com/file/d/${id}/preview`;
			const m = u.pathname.match(/\/file\/d\/([^/]+)/);
			if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
		}
		return url;
	} catch {
		return url;
	}
}
