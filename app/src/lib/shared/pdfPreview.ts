/**
 * Renderiza la primera página de un PDF a una imagen (data URL) usando pdf.js — puro cálculo en el
 * cliente (canvas 2D + el motor JS/WASM de pdf.js, sin depender de ningún visor de PDF del sistema
 * operativo ni del navegador), así funciona igual en navegador, Tauri Windows y Tauri Android — a
 * diferencia de un `<embed>`/`<iframe>` con el PDF crudo, que en el WebView de Android normalmente no
 * lo renderiza. El worker de pdf.js se empaqueta con la app (import `?url` de Vite) en vez de cargarse
 * desde un CDN, para que siga funcionando sin conexión.
 */
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** `maxWidth` en píxeles CSS — la miniatura se genera a esa escala, suficiente para el recuadro de
 * "Adjuntar boucher de pago" (no hace falta resolución completa de impresión). */
export async function renderPdfFirstPageToDataUrl(file: File | Blob, maxWidth = 500): Promise<string> {
	const buffer = await file.arrayBuffer();
	const loadingTask = getDocument({ data: buffer });
	try {
		const pdf = await loadingTask.promise;
		const page = await pdf.getPage(1);
		const baseViewport = page.getViewport({ scale: 1 });
		const scale = Math.max(maxWidth / baseViewport.width, 0.1);
		const viewport = page.getViewport({ scale });

		const canvas = document.createElement('canvas');
		canvas.width = Math.ceil(viewport.width);
		canvas.height = Math.ceil(viewport.height);

		await page.render({ canvas, viewport }).promise;
		return canvas.toDataURL('image/png');
	} finally {
		await loadingTask.destroy();
	}
}
