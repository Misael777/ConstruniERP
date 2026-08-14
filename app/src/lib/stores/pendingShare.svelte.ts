// =============================================
// Pending Shared File Store — Svelte 5 Runes
// Puente entre el layout raíz (detecta la imagen compartida al abrir la app) y
// finanzas/tranzacciones/+page.svelte (la consume para abrir "Nueva Transacción" con el archivo ya
// adjunto) — ver shareTarget.ts.
// =============================================

export const pendingShareState = $state<{ file: File | null }>({
	file: null
});
