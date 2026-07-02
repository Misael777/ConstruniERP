import { writable } from 'svelte/store';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastMessage {
	id: number;
	kind: ToastKind;
	text: string;
}

const { subscribe, update } = writable<ToastMessage[]>([]);

let counter = 0;

function push(kind: ToastKind, text: string, durationMs = 4000) {
	const id = ++counter;
	update((list) => [...list, { id, kind, text }]);
	setTimeout(() => dismiss(id), durationMs);
}

function dismiss(id: number) {
	update((list) => list.filter((t) => t.id !== id));
}

export const toasts = { subscribe };

export const toast = {
	success: (text: string) => push('success', text),
	error: (text: string) => push('error', text),
	info: (text: string) => push('info', text),
	dismiss
};
