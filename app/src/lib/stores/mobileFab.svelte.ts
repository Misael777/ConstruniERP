// =============================================================
// Mobile FAB Store — Svelte 5 Runes
// El botón flotante de "+" (ver MobileFab.svelte) vive en el layout raíz, NO dentro de cada página —
// el layout tiene un ancestro `overflow-hidden` (el flex container de sidebar+main) y algunos WebView
// de Android recortan `position: fixed` como si fuera `absolute` dentro de ese tipo de ancestro (mismo
// motivo por el que el botón del menú móvil vive fuera de ese div). Cada página "declara" su acción de
// alta principal acá al montar (y la limpia al desmontar) en vez de renderizar su propio FAB.
// =============================================================

export const mobileFabState = $state<{ action: (() => void) | null; label: string }>({
	action: null,
	label: 'Nuevo'
});

/** Azúcar para que cada página no tenga que acordarse de limpiar el store a mano al desmontar —
 * llamar en onMount y usar el valor de retorno como el callback de onDestroy (o simplemente invocarlo
 * ahí). Ver comercial/clientes/+page.svelte para el patrón de uso completo. */
export function setMobileFab(action: () => void, label: string): () => void {
	mobileFabState.action = action;
	mobileFabState.label = label;
	return () => {
		// Solo limpia si nadie más lo pisó mientras tanto (ej. navegación rápida entre dos páginas que
		// ambas lo usan) — comparar por referencia evita que el onDestroy tardío de la página vieja
		// borre el FAB que la página nueva ya dejó puesto.
		if (mobileFabState.action === action) {
			mobileFabState.action = null;
		}
	};
}
