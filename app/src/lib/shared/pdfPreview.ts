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

/** Dibuja TODAS las páginas de un PDF (hasta `maxPaginas`) como canvas dentro de `contenedor`, una debajo de
 * otra, al ancho `anchoCss` — para el visor propio de DocumentPreviewModal (ticket #81: dentro del visor
 * embebido de Google Drive la rueda del mouse no desplazaba el documento en la app de escritorio). Se dibuja
 * con la densidad de píxeles de la pantalla para que el texto se vea nítido. `debeSeguir` permite cortar a
 * mitad de camino si el usuario cierra el popup o cambia de documento. Devuelve el total de páginas. */
export async function renderizarPdfEnContenedor(
	file: Blob,
	contenedor: HTMLElement,
	anchoCss: number,
	debeSeguir: () => boolean = () => true,
	maxPaginas = 40
): Promise<number> {
	const buffer = await file.arrayBuffer();
	const loadingTask = getDocument({ data: buffer });
	try {
		const pdf = await loadingTask.promise;
		const densidad = Math.min(window.devicePixelRatio || 1, 2);
		for (let n = 1; n <= Math.min(pdf.numPages, maxPaginas); n++) {
			if (!debeSeguir()) break;
			const page = await pdf.getPage(n);
			const base = page.getViewport({ scale: 1 });
			const viewport = page.getViewport({ scale: (anchoCss / base.width) * densidad });
			const canvas = document.createElement('canvas');
			canvas.width = Math.ceil(viewport.width);
			canvas.height = Math.ceil(viewport.height);
			canvas.style.width = '100%';
			canvas.style.height = 'auto';
			canvas.className = 'block bg-white shadow-md';
			await page.render({ canvas, viewport }).promise;
			if (!debeSeguir()) break;
			contenedor.appendChild(canvas);
		}
		return pdf.numPages;
	} finally {
		await loadingTask.destroy();
	}
}

/** Texto DIGITAL de un PDF (la capa de texto que traen los PDF generados por un sistema, ej. una Factura
 * o Boleta emitida por SUNAT) — exacto y mucho más rápido que OCR. Reconstruye las líneas agrupando los
 * fragmentos por su altura en la página (y ordenándolos de izquierda a derecha), para que los regex que
 * buscan "RUC: ..." o "Importe Total: ..." vean el texto como se lee. Un PDF escaneado (solo imagen)
 * devuelve '' — quien llama decide si recurrir a OCR. `maxPaginas` evita leer documentos enormes. */
export async function extraerTextoPdf(file: File | Blob, maxPaginas = 5): Promise<string> {
	const buffer = await file.arrayBuffer();
	const loadingTask = getDocument({ data: buffer });
	try {
		const pdf = await loadingTask.promise;
		const paginas: string[] = [];
		for (let n = 1; n <= Math.min(pdf.numPages, maxPaginas); n++) {
			const page = await pdf.getPage(n);
			const contenido = await page.getTextContent();
			const lineas = new Map<number, { x: number; texto: string }[]>();
			for (const item of contenido.items) {
				if (!('str' in item) || !item.str.trim()) continue;
				const y = Math.round(item.transform[5] / 3) * 3; // tolerancia de ~3pt para la misma línea
				const fila = lineas.get(y) ?? [];
				fila.push({ x: item.transform[4], texto: item.str });
				lineas.set(y, fila);
			}
			const ordenadas = [...lineas.entries()]
				.sort((a, b) => b[0] - a[0]) // en PDF la y crece hacia arriba
				.map(([, fila]) => fila.sort((a, b) => a.x - b.x).map((f) => f.texto).join(' ').replace(/\s+/g, ' ').trim());
			paginas.push(ordenadas.join('\n'));
		}
		return paginas.join('\n').trim();
	} finally {
		await loadingTask.destroy();
	}
}
