// =============================================================
// Mobile FAB Store — Svelte 5 Runes
// El botón flotante de "+" (ver MobileFab.svelte) vive en el layout raíz, NO dentro de cada página —
// el layout tiene un ancestro `overflow-hidden` (el flex container de sidebar+main) y algunos WebView
// de Android recortan `position: fixed` como si fuera `absolute` dentro de ese tipo de ancestro (mismo
// motivo por el que el botón del menú móvil vive fuera de ese div). Cada página "declara" sus acciones
// de alta al montar (y las limpia al desmontar) en vez de renderizar su propio FAB.
//
// Soporta más de una acción (ej. Transacciones: "Nueva Transacción" + "Movimientos de Caja", que antes
// vivían como dos botones de header — el segundo terminaba desbordando la pantalla en móvil) — con una
// sola acción el FAB dispara directo al tocarlo (mismo comportamiento de siempre); con dos o más, se
// despliega un mini-menú (speed dial) al tocarlo.
import type { Component } from 'svelte';
import { Plus } from '@lucide/svelte';

export interface MobileFabAction {
	label: string;
	icon: Component<{ size?: number; class?: string }>;
	onclick: () => void;
}

export const mobileFabState = $state<{ actions: MobileFabAction[] }>({ actions: [] });

/** API general — una o más acciones. Devuelve la función de limpieza para pasarle a onDestroy. */
export function setMobileFabActions(actions: MobileFabAction[]): () => void {
	mobileFabState.actions = actions;
	return () => {
		// Solo limpia si nadie más lo pisó mientras tanto (ej. navegación rápida entre dos páginas que
		// ambas lo usan) — comparar por referencia evita que el onDestroy tardío de la página vieja
		// borre el FAB que la página nueva ya dejó puesto.
		if (mobileFabState.actions === actions) {
			mobileFabState.actions = [];
		}
	};
}

/** Azúcar para el caso más común (una sola acción de alta) — evita armar el array a mano en cada
 * página. Con una sola acción el ícono nunca se ve (el FAB dispara directo, sin desplegar el mini-menú),
 * así que `Plus` como default es suficiente. Ver comercial/clientes/+page.svelte para el patrón de uso
 * completo. */
export function setMobileFab(onclick: () => void, label: string, icon: Component<{ size?: number; class?: string }> = Plus): () => void {
	return setMobileFabActions([{ label, onclick, icon }]);
}
