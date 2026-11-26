/**
 * Ticket #141 (26/11/2026): "al pasar el cursor por un texto que se ve cortado debe aparecer el detalle completo; aplica
 * para todos los campos donde la información se ve recortada". En vez de agregar `title` campo por campo, un solo
 * escucha global: al pasar el cursor sobre un texto que de verdad no cabe (con "…", varias líneas recortadas o un
 * campo de texto más largo que su caja), se le pone como `title` su texto completo y el navegador lo muestra.
 * Un elemento que ya tiene su propio `title` no se toca (salvo que ese `title` lo haya puesto este escucha).
 */
const MARCA = 'data-tooltip-auto';
const NIVELES = 4; // el texto cortado suele ser el elemento bajo el cursor o uno de sus padres cercanos

function estaCortado(el: HTMLElement): boolean {
	if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.scrollWidth > el.clientWidth + 1;
	const cs = getComputedStyle(el);
	const conElipsis = cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
	const clamp = (cs as unknown as { webkitLineClamp?: string }).webkitLineClamp;
	const conLineas = !!clamp && clamp !== 'none' && el.scrollHeight > el.clientHeight + 1;
	return conElipsis || conLineas;
}

function textoDe(el: HTMLElement): string {
	if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
	return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
}

function alPasar(e: MouseEvent) {
	let el = e.target instanceof HTMLElement ? e.target : null;
	for (let i = 0; el && i < NIVELES; i++, el = el.parentElement) {
		// Ya tiene un title propio (puesto en el código): manda ese.
		if (el.title && !el.hasAttribute(MARCA)) return;
		if (estaCortado(el)) {
			const texto = textoDe(el).slice(0, 500);
			if (texto) {
				el.title = texto;
				el.setAttribute(MARCA, '');
			}
			return;
		}
		if (el.hasAttribute(MARCA)) {
			// Ya no está cortado (p. ej. se agrandó la ventana): se quita el title automático.
			el.removeAttribute('title');
			el.removeAttribute(MARCA);
		}
	}
}

let instalado = false;
/** Se llama una vez al montar la app (layout). */
export function instalarTooltipTextoCortado(): void {
	if (instalado || typeof document === 'undefined') return;
	instalado = true;
	document.addEventListener('mouseover', alPasar, { capture: true, passive: true });
}
