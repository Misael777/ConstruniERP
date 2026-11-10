/**
 * Foto del trabajador (personal.foto_url, migración 20261107120000). La imagen se reduce en el propio dispositivo
 * (JPEG, máx. 600 px) y se sube a Google Drive con la misma rama Tauri/web que las imágenes de Anuncios
 * (AnuncioModal.svelte): sube rápido con datos móviles y funciona igual en navegador, Windows y Android.
 */
import { isRunningInTauri, uploadToDriveClient } from '$lib/driveUploadClient';
import { resolveApiUrl, parseJsonResponse } from '$lib/apiClient';

const LADO_MAX = 600;
const CALIDAD = 0.85;
/** Archivos más grandes que esto se rechazan antes de procesarlos (fotos de cámara: 2–8 MB). */
export const FOTO_MAX_BYTES = 20 * 1024 * 1024;

/** Reduce la imagen a JPEG de máx. 600 px por lado. Si el navegador no puede leerla, lanza un error claro. */
export async function reducirFoto(file: File): Promise<Blob> {
	const url = URL.createObjectURL(file);
	try {
		const img = await new Promise<HTMLImageElement>((resolve, reject) => {
			const i = new Image();
			i.onload = () => resolve(i);
			i.onerror = () => reject(new Error('No se pudo leer la imagen. Usa una foto JPG o PNG.'));
			i.src = url;
		});
		const escala = Math.min(1, LADO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
		canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('No se pudo procesar la imagen.');
		ctx.fillStyle = '#ffffff'; // PNG con transparencia → fondo blanco en el JPEG
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
		return await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo procesar la imagen.'))), 'image/jpeg', CALIDAD)
		);
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** Sube la foto ya reducida y devuelve su enlace de Drive. */
export async function subirFotoPersonal(foto: Blob, documento: string): Promise<string> {
	const base = `personal-foto-${(documento || 'sin-doc').replace(/[^A-Za-z0-9]/g, '')}-${Date.now()}`;
	if (isRunningInTauri()) {
		const { url } = await uploadToDriveClient(foto, `${base}.jpg`, 'documento');
		return url;
	}
	const formData = new FormData();
	formData.append('file', new File([foto], `${base}.jpg`, { type: 'image/jpeg' }));
	formData.append('type', 'documento');
	formData.append('documentType', 'foto_personal'); // obligatorio para type=documento en /api/upload-document
	formData.append('documentName', (documento || 'sin-doc').replace(/[^A-Za-z0-9]/g, ''));
	formData.append('projectName', 'Personal');
	const response = await fetch(resolveApiUrl('/api/upload-document'), { method: 'POST', body: formData });
	const result = await parseJsonResponse(response);
	if (!response.ok || !result.success) throw new Error(result.details || result.error || 'Error al subir la foto.');
	return result.url as string;
}
