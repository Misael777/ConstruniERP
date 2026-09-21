/**
 * Renderiza una plantilla HTML/CSS a una imagen PNG (data URL) usando html2canvas — a pedido explícito
 * del usuario, para poder diseñar comprobantes/recibos en PDF con el mismo HTML/CSS de siempre (bordes
 * redondeados, colores, tipografía) en vez de dibujar cada rectángulo/línea a mano con las primitivas
 * de jsPDF. El nodo se monta oculto en el DOM (fuera de pantalla, no con display:none — html2canvas no
 * captura elementos sin layout), se captura y se desmonta. 100% cliente, funciona igual en navegador,
 * Tauri Windows y Tauri Android — html2canvas solo usa Canvas2D y el DOM, sin ninguna API de plataforma.
 *
 * Usa "html2canvas-pro" (fork mantenido de html2canvas) en vez del paquete original: el contenedor
 * oculto que se captura hereda el CSS global de la app (Tailwind v4), que genera colores con la función
 * `oklch()` — el html2canvas original no la soporta y tira "Attempting to parse an unsupported color
 * function oklch" apenas intenta leer CUALQUIER color heredado, aunque la plantilla del recibo en sí
 * solo use colores hexadecimales. Confirmado reproduciendo el error real contra la app corriendo.
 * html2canvas-pro sí entiende oklch/oklab/lab/color() y es API-compatible (mismo import por defecto).
 */
import html2canvas from 'html2canvas-pro';
import jsPDF from 'jspdf';
import { arrayBufferToBase64 } from './base64';

export interface HtmlRenderResult {
	dataUrl: string;
	widthPx: number;
	heightPx: number;
}

/** `widthPx` es el ancho del contenedor tal como se mide en el DOM (CSS px) — todo el HTML/CSS de la
 * plantilla debe diseñarse pensando en ese ancho fijo. `scale` sube la resolución del PNG resultante
 * (2 = calidad "retina", nítido incluso ampliado en el PDF) sin cambiar el layout. */
export async function renderHtmlToPngDataUrl(html: string, widthPx: number, scale = 2): Promise<HtmlRenderResult> {
	const contenedor = document.createElement('div');
	contenedor.style.position = 'fixed';
	contenedor.style.left = '-10000px';
	contenedor.style.top = '0';
	contenedor.style.width = `${widthPx}px`;
	contenedor.style.zIndex = '-1';
	contenedor.innerHTML = html;
	document.body.appendChild(contenedor);

	try {
		// Espera un frame para que el navegador termine el layout antes de capturar — evita capturas con
		// texto todavía sin envolver (wrap) correctamente.
		await new Promise((resolve) => requestAnimationFrame(resolve));
		// Si la plantilla trae <img> (ej. el logo de la empresa, o una firma manuscrita), hay que esperar
		// a que terminen de decodificarse ANTES de capturar — si no, html2canvas a veces captura el hueco
		// vacío porque la imagen todavía no estaba lista para pintarse. decode() funciona incluso si la
		// imagen ya está en caché (a diferencia de esperar solo el evento 'load').
		const imagenes = Array.from(contenedor.querySelectorAll('img'));
		await Promise.all(imagenes.map((img) => img.decode().catch(() => {})));
		const canvas = await html2canvas(contenedor, {
			scale,
			backgroundColor: '#ffffff',
			useCORS: true
		});
		return {
			dataUrl: canvas.toDataURL('image/png'),
			widthPx: canvas.width / scale,
			heightPx: canvas.height / scale
		};
	} finally {
		document.body.removeChild(contenedor);
	}
}

const ANCHO_PAGINA_MM = 190; // ancho de contenido en el PDF (A4 210mm con 10mm de margen a cada lado)
const MARGEN_PAGINA_MM = 10;
const GAP_ENTRE_COPIAS_MM = 8; // 4mm antes de la línea punteada + 4mm después (ver más abajo)

/** Arma un PDF A4 con Original + Copia de un mismo comprobante/recibo, una debajo de la otra en la
 * MISMA hoja, separadas por una línea punteada — antes esta misma lógica estaba TRIPLICADA (una copia
 * casi idéntica en comprobanteTransferenciaInterna.ts/reciboPagoEfectivo.ts/reciboPagoProveedor.ts),
 * ahora centralizada acá.
 *
 * A pedido explícito del usuario: las 2 copias SIEMPRE deben caber completas en una sola hoja A4 — la
 * versión anterior calculaba la altura de cada imagen y las dibujaba una tras otra sin verificar si la
 * suma entraba en el alto de la página (297mm en A4). jsPDF NO pagina ni recorta imágenes que se salen
 * del alto de la hoja: simplemente las dibuja en la posición Y calculada, y lo que cae más allá del
 * borde de la página queda fuera del área visible/imprimible — invisible al guardar, descargar o abrir
 * el PDF, aunque la VISTA PREVIA en HTML (sin ese límite físico de página) se viera completa. Con
 * contenido más alto de lo normal (nombres largos que envuelven a 2 líneas, secciones con más texto)
 * la Copia terminaba "cortada" contra el borde inferior de la hoja. Ahora, si la suma de ambas no entra
 * en el alto disponible, se escalan las DOS juntas (ancho y alto a la vez, para no deformar el recibo)
 * hasta que sí quepan — nunca se recortan ni se pasan a una segunda hoja. */
export async function ensamblarPdfDosCopiasA4(original: HtmlRenderResult, copia: HtmlRenderResult): Promise<string> {
	const doc = new jsPDF();
	const altoPaginaMm = doc.internal.pageSize.getHeight();

	let anchoOriginalMm = ANCHO_PAGINA_MM;
	let anchoCopiaMm = ANCHO_PAGINA_MM;
	let altoOriginalMm = (original.heightPx / original.widthPx) * anchoOriginalMm;
	let altoCopiaMm = (copia.heightPx / copia.widthPx) * anchoCopiaMm;

	const altoDisponibleMm = altoPaginaMm - MARGEN_PAGINA_MM * 2 - GAP_ENTRE_COPIAS_MM;
	const altoTotalMm = altoOriginalMm + altoCopiaMm;
	if (altoTotalMm > altoDisponibleMm) {
		const factor = altoDisponibleMm / altoTotalMm;
		anchoOriginalMm *= factor;
		anchoCopiaMm *= factor;
		altoOriginalMm *= factor;
		altoCopiaMm *= factor;
	}

	// Centradas horizontalmente dentro del ancho de contenido — solo se nota si hubo que achicarlas
	// (factor < 1); si entraban tal cual, x queda igual a MARGEN_PAGINA_MM, como antes.
	const xOriginal = MARGEN_PAGINA_MM + (ANCHO_PAGINA_MM - anchoOriginalMm) / 2;
	const xCopia = MARGEN_PAGINA_MM + (ANCHO_PAGINA_MM - anchoCopiaMm) / 2;

	let y = MARGEN_PAGINA_MM;
	doc.addImage(original.dataUrl, 'PNG', xOriginal, y, anchoOriginalMm, altoOriginalMm);
	y += altoOriginalMm + GAP_ENTRE_COPIAS_MM / 2;

	doc.setDrawColor(150);
	doc.setLineDashPattern([1.5, 1.5], 0);
	doc.line(MARGEN_PAGINA_MM, y, MARGEN_PAGINA_MM + ANCHO_PAGINA_MM, y);
	doc.setLineDashPattern([], 0);
	y += GAP_ENTRE_COPIAS_MM / 2;

	doc.addImage(copia.dataUrl, 'PNG', xCopia, y, anchoCopiaMm, altoCopiaMm);

	return arrayBufferToBase64(doc.output('arraybuffer'));
}

/**
 * Arma un PDF A4 de UNA sola imagen (ej. una factura), repartida en varias páginas si es más alta de
 * lo que entra en una sola A4 — a diferencia de ensamblarPdfDosCopiasA4 (que ESCALA el contenido para
 * que quepa siempre en una hoja), acá una factura con muchas partidas debe seguir siendo legible, así
 * que se pagina en vez de encogerse. Técnica estándar de jsPDF: cada página recorta su contenido al
 * tamaño de la hoja (su MediaBox), así que dibujar la MISMA imagen completa en cada página con un
 * offset Y negativo (que sube la imagen una página completa por cada `addPage()`) hace que cada
 * página solo muestre la porción que le toca — sin tener que cortar el PNG a mano en varios canvases.
 */
export function ensamblarPdfUnaCopiaMultipagina(pagina: HtmlRenderResult): string {
	const doc = new jsPDF();
	const altoPaginaMm = doc.internal.pageSize.getHeight();
	const altoDisponibleMm = altoPaginaMm - MARGEN_PAGINA_MM * 2;

	const anchoMm = ANCHO_PAGINA_MM;
	const altoTotalMm = (pagina.heightPx / pagina.widthPx) * anchoMm;
	const xMm = MARGEN_PAGINA_MM;

	const totalPaginas = Math.max(1, Math.ceil(altoTotalMm / altoDisponibleMm));
	for (let i = 0; i < totalPaginas; i++) {
		if (i > 0) doc.addPage();
		const yMm = MARGEN_PAGINA_MM - i * altoDisponibleMm;
		doc.addImage(pagina.dataUrl, 'PNG', xMm, yMm, anchoMm, altoTotalMm);
	}

	return arrayBufferToBase64(doc.output('arraybuffer'));
}
