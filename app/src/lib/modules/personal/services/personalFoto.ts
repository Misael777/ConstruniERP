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

/** Decodifica la imagen: primero createImageBitmap (respeta la orientación EXIF de las fotos de cámara y lee
 * archivos sin tipo que entrega la galería de Android), y si no, con un <img> como antes. */
async function decodificar(file: Blob): Promise<{ fuente: CanvasImageSource; ancho: number; alto: number; cerrar: () => void }> {
	if (typeof createImageBitmap === 'function') {
		try {
			const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
			return { fuente: bmp, ancho: bmp.width, alto: bmp.height, cerrar: () => bmp.close() };
		} catch {
			// Se intenta con <img>.
		}
	}
	const url = URL.createObjectURL(file);
	try {
		const img = await new Promise<HTMLImageElement>((resolve, reject) => {
			const i = new Image();
			i.onload = () => resolve(i);
			i.onerror = () => reject(new Error('img'));
			i.src = url;
		});
		return { fuente: img, ancho: img.naturalWidth, alto: img.naturalHeight, cerrar: () => URL.revokeObjectURL(url) };
	} catch {
		URL.revokeObjectURL(url);
		const heic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test((file as File).name ?? '');
		throw new Error(
			heic
				? 'Esta foto está en formato HEIC y el teléfono no la deja leer. Toma la foto con la cámara desde aquí o elige una JPG.'
				: 'No se pudo leer la imagen. Usa una foto JPG o PNG, o tómala con la cámara desde aquí.'
		);
	}
}

/** Reduce la imagen a JPEG de máx. 600 px por lado. Si el navegador no puede leerla, lanza un error claro. */
export async function reducirFoto(file: File): Promise<Blob> {
	const { fuente, ancho, alto, cerrar } = await decodificar(file);
	try {
		const escala = Math.min(1, LADO_MAX / Math.max(ancho, alto));
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(ancho * escala));
		canvas.height = Math.max(1, Math.round(alto * escala));
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('No se pudo procesar la imagen.');
		ctx.fillStyle = '#ffffff'; // PNG con transparencia → fondo blanco en el JPEG
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(fuente, 0, 0, canvas.width, canvas.height);
		return await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo procesar la imagen.'))), 'image/jpeg', CALIDAD)
		);
	} finally {
		cerrar();
	}
}

/** Sube la foto ya reducida y devuelve su enlace de Drive. */
export async function subirFotoPersonal(foto: Blob, documento: string): Promise<string> {
	return subirImagenReducida(foto, documento, { prefijo: 'personal-foto', tipo: 'foto_personal', carpeta: 'Personal' });
}

/**
 * 27/11/2026: la misma subida para otras imágenes (logo del proveedor, imagen del proyecto). `nombre` identifica al
 * dueño en el nombre del archivo; `tipo` y `carpeta` son el documentType y el projectName de /api/upload-document.
 */
export async function subirImagenReducida(
	foto: Blob,
	nombre: string,
	{ prefijo, tipo, carpeta }: { prefijo: string; tipo: string; carpeta: string }
): Promise<string> {
	const documento = nombre;
	const base = `${prefijo}-${(documento || 'sin-doc').replace(/[^A-Za-z0-9]/g, '').slice(0, 40)}-${Date.now()}`;
	if (isRunningInTauri()) {
		const { url } = await uploadToDriveClient(foto, `${base}.jpg`, 'documento');
		return url;
	}
	const formData = new FormData();
	formData.append('file', new File([foto], `${base}.jpg`, { type: 'image/jpeg' }));
	formData.append('type', 'documento');
	formData.append('documentType', tipo); // obligatorio para type=documento en /api/upload-document
	formData.append('documentName', (documento || 'sin-doc').replace(/[^A-Za-z0-9]/g, '').slice(0, 40));
	formData.append('projectName', carpeta);
	const response = await fetch(resolveApiUrl('/api/upload-document'), { method: 'POST', body: formData });
	const result = await parseJsonResponse(response);
	if (!response.ok || !result.success) throw new Error(result.details || result.error || 'Error al subir la foto.');
	return result.url as string;
}
