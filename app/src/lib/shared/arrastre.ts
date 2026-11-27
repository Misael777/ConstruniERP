/**
 * Arrastrar y soltar con eventos de puntero (mouse y dedo). El drag & drop nativo de HTML5 no funciona con el dedo en
 * Android, por eso no se usa. Pedido 27/11/2026: ordenar "Tareas de hoy" arrastrando y mover tareas de día en el
 * calendario.
 *
 * Uso: `<button use:arrastrable={{ id, onSoltar }}>` en la "asa". Mientras se arrastra, una copia de la tarjeta
 * (el ancestro con `data-arrastre-item`) sigue al puntero; al soltar se llama `onSoltar(id, destino, x, y)` con el
 * elemento `[data-soltar]` que quedó debajo del puntero (o null). Ese destino lleva la clase `arrastre-sobre` mientras
 * el puntero está encima. Cerca del borde del contenedor con scroll, se desplaza solo.
 */
export interface OpcionesArrastre {
	id: string;
	onSoltar: (id: string, destino: HTMLElement | null, x: number, y: number) => void;
	deshabilitado?: boolean;
}

function contenedorConScroll(el: HTMLElement | null, eje: 'x' | 'y'): HTMLElement | null {
	for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
		const o = eje === 'y' ? getComputedStyle(n).overflowY : getComputedStyle(n).overflowX;
		const hay = eje === 'y' ? n.scrollHeight > n.clientHeight : n.scrollWidth > n.clientWidth;
		if ((o === 'auto' || o === 'scroll') && hay) return n;
	}
	return null;
}

export function arrastrable(node: HTMLElement, opciones: OpcionesArrastre) {
	let op = opciones;
	let fantasma: HTMLElement | null = null;
	let item: HTMLElement | null = null;
	let sobre: HTMLElement | null = null;
	let scroller: HTMLElement | null = null;
	let scrollerX: HTMLElement | null = null;
	let dx = 0;
	let dy = 0;
	let px = 0;
	let py = 0;
	let raf = 0;
	let id = -1;

	node.style.touchAction = 'none';

	function destinoEn(x: number, y: number): HTMLElement | null {
		return (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-soltar]') ?? null;
	}

	function marcar(x: number, y: number) {
		const d = destinoEn(x, y);
		if (d === sobre) return;
		sobre?.classList.remove('arrastre-sobre');
		sobre = d;
		sobre?.classList.add('arrastre-sobre');
	}

	function autoScroll() {
		const margen = 60;
		if (scroller) {
			const r = scroller.getBoundingClientRect();
			if (py < r.top + margen) scroller.scrollTop -= Math.ceil((r.top + margen - py) / 4);
			else if (py > r.bottom - margen) scroller.scrollTop += Math.ceil((py - (r.bottom - margen)) / 4);
		}
		if (scrollerX) {
			const r = scrollerX.getBoundingClientRect();
			if (px < r.left + margen) scrollerX.scrollLeft -= Math.ceil((r.left + margen - px) / 4);
			else if (px > r.right - margen) scrollerX.scrollLeft += Math.ceil((px - (r.right - margen)) / 4);
		}
		if (scroller || scrollerX) marcar(px, py);
		raf = requestAnimationFrame(autoScroll);
	}

	function abajo(ev: PointerEvent) {
		if (op.deshabilitado || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
		ev.preventDefault();
		ev.stopPropagation();
		item = node.closest<HTMLElement>('[data-arrastre-item]') ?? node;
		const r = item.getBoundingClientRect();
		dx = ev.clientX - r.left;
		dy = ev.clientY - r.top;
		px = ev.clientX;
		py = ev.clientY;
		fantasma = item.cloneNode(true) as HTMLElement;
		Object.assign(fantasma.style, {
			position: 'fixed',
			left: `${r.left}px`,
			top: `${r.top}px`,
			width: `${r.width}px`,
			margin: '0',
			zIndex: '9999',
			pointerEvents: 'none',
			opacity: '0.92',
			transform: 'rotate(1.5deg)',
			boxShadow: '0 12px 28px rgba(15,42,74,.25)'
		});
		document.body.appendChild(fantasma);
		item.style.opacity = '0.35';
		scroller = contenedorConScroll(item, 'y');
		scrollerX = contenedorConScroll(item, 'x');
		id = ev.pointerId;
		node.setPointerCapture(id);
		node.addEventListener('pointermove', mover);
		node.addEventListener('pointerup', soltar);
		node.addEventListener('pointercancel', cancelar);
		raf = requestAnimationFrame(autoScroll);
	}

	function mover(ev: PointerEvent) {
		px = ev.clientX;
		py = ev.clientY;
		if (fantasma) {
			fantasma.style.left = `${px - dx}px`;
			fantasma.style.top = `${py - dy}px`;
		}
		marcar(px, py);
	}

	function limpiar() {
		cancelAnimationFrame(raf);
		node.removeEventListener('pointermove', mover);
		node.removeEventListener('pointerup', soltar);
		node.removeEventListener('pointercancel', cancelar);
		try {
			node.releasePointerCapture(id);
		} catch {
			/* ya liberado */
		}
		fantasma?.remove();
		fantasma = null;
		if (item) item.style.opacity = '';
		item = null;
		sobre?.classList.remove('arrastre-sobre');
		sobre = null;
	}

	function soltar(ev: PointerEvent) {
		const destino = destinoEn(ev.clientX, ev.clientY);
		limpiar();
		op.onSoltar(op.id, destino, ev.clientX, ev.clientY);
	}

	function cancelar() {
		limpiar();
	}

	node.addEventListener('pointerdown', abajo);
	return {
		update(nuevas: OpcionesArrastre) {
			op = nuevas;
		},
		destroy() {
			limpiar();
			node.removeEventListener('pointerdown', abajo);
		}
	};
}
