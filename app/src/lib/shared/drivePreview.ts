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

/**
 * Convierte una URL de Drive al endpoint REAL de descarga binaria — a pedido explícito del usuario, que
 * reportó comprobantes descargados que se veían "en negro"/vacíos al abrirlos: `uc?export=download`
 * (el formato guardado en BD) responde 303 y redirige a `drive.usercontent.google.com/download`, pero
 * ese primer salto RECHAZA (403) cualquier request con encabezado `Origin` — exactamente lo que manda
 * `fetch(..., {mode:'cors'})` desde el navegador — así que la descarga terminaba trayendo la página HTML
 * de error, no el archivo. `usercontent.google.com/download` sí expone `Access-Control-Allow-Origin: *`
 * (verificado con curl), así que DocumentPreviewModal.svelte debe pedir esta URL directo para descargar,
 * no la de solo-vista-previa (esa, en cambio, es la correcta para el <iframe>, ver toDrivePreviewUrl).
 */
export function toDriveDirectDownloadUrl(url: string | null | undefined): string {
	if (!url) return '';
	try {
		const u = new URL(url);
		if (u.hostname.includes('drive.google.com') || u.hostname.includes('drive.usercontent.google.com')) {
			const id = u.searchParams.get('id');
			if (id) return `https://drive.usercontent.google.com/download?id=${id}&export=download`;
			const m = u.pathname.match(/\/file\/d\/([^/]+)/);
			if (m) return `https://drive.usercontent.google.com/download?id=${m[1]}&export=download`;
		}
		return url;
	} catch {
		return url;
	}
}

/**
 * Convierte una URL de Drive a una miniatura real (`.../thumbnail?id=...&sz=w400`) que sí sirve como
 * `<img src>` — a diferencia de la URL de descarga directa (`uc?export=download`), que Drive a veces
 * responde con una página HTML intermedia en vez de los bytes de la imagen, dejando el `<img>` roto.
 * Sirve tanto para imágenes como para PDFs (genera la miniatura de la primera página). URLs que no
 * son de Drive se devuelven tal cual. `ancho` = ancho máximo en px (ej. 1600 para banners de Anuncios).
 */
export function toDriveThumbnailUrl(url: string | null | undefined, ancho = 400): string {
	if (!url) return '';
	try {
		const u = new URL(url);
		if (u.hostname.includes('drive.google.com')) {
			const id = u.searchParams.get('id');
			if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=w${ancho}`;
			const m = u.pathname.match(/\/file\/d\/([^/]+)/);
			if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w${ancho}`;
		}
		return url;
	} catch {
		return url;
	}
}
