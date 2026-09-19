import { writable } from 'svelte/store';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastMessage {
	id: number;
	kind: ToastKind;
	text: string;
	/** Texto técnico largo (ej. traceback) — se muestra en un bloque con scroll y botón "Copiar", y el
	 * toast no se cierra solo hasta que el usuario lo cierre. */
	detail?: string;
}

const { subscribe, update } = writable<ToastMessage[]>([]);

let counter = 0;

function push(kind: ToastKind, text: string, durationMs = 4000, detail?: string) {
	const id = ++counter;
	update((list) => [...list, { id, kind, text, detail }]);
	if (!detail) setTimeout(() => dismiss(id), durationMs);
}

function dismiss(id: number) {
	update((list) => list.filter((t) => t.id !== id));
}

export const toasts = { subscribe };

export const toast = {
	success: (text: string) => push('success', text),
	error: (text: string, detail?: string) => push('error', text, 4000, detail),
	info: (text: string) => push('info', text),
	dismiss
};
