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
