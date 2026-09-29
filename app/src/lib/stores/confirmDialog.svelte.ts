// =============================================================
// Confirm Dialog Store — Svelte 5 Runes
// Reemplazo de `window.confirm()` que devuelve una promesa: `if (!(await confirmar({...}))) return;`.
// `confirm()` nativo no es confiable en la app empaquetada de Tauri (pasa por el plugin de diálogos y
// puede fallar por permisos ACL, ver capabilities/default.json) — esto usa ConfirmModal.svelte, un
// modal propio que funciona igual en navegador, Tauri Windows y Tauri Android. El modal vive UNA sola
// vez en el layout raíz (ver ConfirmDialogHost.svelte en (app)/+layout.svelte), así cada llamador no
// necesita declarar su propio estado open/onConfirm/onClose. Para confirmaciones que piden contraseña
// de administrador, seguir usando AdminConfirmModal.svelte.
// =============================================================

export interface ConfirmarOpciones {
	message: string;
	title?: string;
	confirmLabel?: string;
	cancelLabel?: string;
	/** true (default) = estilo rojo para acciones destructivas; false = estilo azul neutro. */
	danger?: boolean;
}

export const confirmDialogState = $state<{
	open: boolean;
	opciones: ConfirmarOpciones;
	resolve: ((aceptado: boolean) => void) | null;
}>({ open: false, opciones: { message: '' }, resolve: null });

/** Abre el modal de confirmación y resuelve true si el usuario confirma, false si cancela/cierra. Si ya
 * había otro abierto (no debería pasar), ese se resuelve como cancelado. */
export function confirmar(opciones: ConfirmarOpciones): Promise<boolean> {
	confirmDialogState.resolve?.(false);
	return new Promise<boolean>((resolve) => {
		confirmDialogState.opciones = opciones;
		confirmDialogState.resolve = resolve;
		confirmDialogState.open = true;
	});
}

/** Cierra el modal resolviendo la promesa pendiente — lo llama ConfirmDialogHost.svelte. */
export function cerrarConfirmacion(aceptado: boolean): void {
	const resolve = confirmDialogState.resolve;
	confirmDialogState.open = false;
	confirmDialogState.resolve = null;
	resolve?.(aceptado);
}
