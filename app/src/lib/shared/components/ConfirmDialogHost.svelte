<script lang="ts">
	// Instancia única de ConfirmModal para el helper `confirmar()` (ver stores/confirmDialog.svelte.ts)
	// — se monta una sola vez en (app)/+layout.svelte.
	import ConfirmModal from '$lib/shared/components/ConfirmModal.svelte';
	import { confirmDialogState, cerrarConfirmacion } from '$lib/stores/confirmDialog.svelte';
</script>

<ConfirmModal
	open={confirmDialogState.open}
	title={confirmDialogState.opciones.title ?? 'Confirmar acción'}
	message={confirmDialogState.opciones.message}
	confirmLabel={confirmDialogState.opciones.confirmLabel ?? 'Confirmar'}
	cancelLabel={confirmDialogState.opciones.cancelLabel ?? 'Cancelar'}
	danger={confirmDialogState.opciones.danger ?? true}
	onConfirm={() => cerrarConfirmacion(true)}
	onClose={() => cerrarConfirmacion(false)}
/>
