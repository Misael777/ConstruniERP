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
//
// A pedido explícito del usuario (el FAB de Transacciones aparecía en TODOS los módulos, no solo en su
// propia página): además del cleanup por onDestroy de abajo (que ya protege contra pisar el FAB de la
// página nueva), se guarda la RUTA en la que se registraron las acciones — el layout (ver
// (app)/+layout.svelte) solo renderiza el FAB si esa ruta coincide con `page.url.pathname` ACTUAL. Esto
// hace que un remanente nunca se pueda ver, sin importar el orden exacto en que SvelteKit monte/desmonte
// los componentes de página al navegar — la verificación es contra la ruta real de ahora, no contra un
// estado que dependa de esa coreografía de lifecycle.
import type { Component } from 'svelte';
import { Plus } from '@lucide/svelte';
import { page } from '$app/state';

export interface MobileFabAction {
	label: string;
	icon: Component<{ size?: number; class?: string }>;
	onclick: () => void;
}

export const mobileFabState = $state<{ actions: MobileFabAction[]; path: string | null }>({ actions: [], path: null });

/** API general — una o más acciones. Devuelve la función de limpieza para pasarle a onDestroy. */
export function setMobileFabActions(actions: MobileFabAction[]): () => void {
	const path = page.url.pathname;
	mobileFabState.actions = actions;
	mobileFabState.path = path;
	return () => {
		// Solo limpia si nadie más lo pisó mientras tanto (ej. navegación rápida entre dos páginas que
		// ambas lo usan) — comparar por referencia evita que el onDestroy tardío de la página vieja
		// borre el FAB que la página nueva ya dejó puesto. El guard de ruta en el layout es la protección
		// principal; esto es higiene adicional para no dejar referencias colgando innecesariamente.
		if (mobileFabState.actions === actions) {
			mobileFabState.actions = [];
			mobileFabState.path = null;
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
