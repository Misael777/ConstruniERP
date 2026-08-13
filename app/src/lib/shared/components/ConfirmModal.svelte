<script lang="ts">
	// Modal genérico de confirmación (Sí/No), sin credenciales — a pedido del usuario: reemplaza al
	// `window.confirm()` nativo del navegador en flujos como "Dar de baja" (ver
	// comercial/clientes/+page.svelte), que en la app empaquetada de Tauri puede fallar por permisos
	// ACL del plugin de diálogos (ver capabilities/default.json) incluso teniéndolo bien configurado
	// (queda a merced de que el usuario haya reiniciado la app tras un cambio de capabilities). Un
	// modal propio no depende de ningún plugin nativo — funciona igual en web y en Tauri.
	// Para confirmaciones que SÍ requieren credenciales de admin, ver AdminConfirmModal.svelte.
	import { X, TriangleAlert, Loader2 } from '@lucide/svelte';

	let {
		open = false,
		title = 'Confirmar acción',
		message = '',
		confirmLabel = 'Confirmar',
		cancelLabel = 'Cancelar',
		danger = true,
		onConfirm = async () => {},
		onClose = () => {}
	}: {
		open?: boolean;
		title?: string;
		message?: string;
		confirmLabel?: string;
		cancelLabel?: string;
		/** true (default) = estilo rojo, para acciones destructivas/irreversibles-ish (dar de baja,
		 * eliminar). false = estilo azul, para confirmaciones neutras. */
		danger?: boolean;
		/** El padre hace el trabajo real (llamada a la BD) y su propio try/catch + toast.error — este
		 * modal solo bloquea los botones mientras `onConfirm` está en curso. */
		onConfirm?: () => Promise<void> | void;
		onClose?: () => void;
	} = $props();

	let submitting = $state(false);

	async function handleConfirm() {
		if (submitting) return;
		submitting = true;
		try {
			await onConfirm();
		} finally {
			submitting = false;
		}
	}

	function handleClose() {
		if (submitting) return;
		onClose();
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
			<div class="flex items-center justify-between px-6 py-4 border-b border-slate-200">
				<div class="flex items-center gap-2">
					<TriangleAlert size={20} class={danger ? 'text-red-600' : 'text-blue-600'} />
					<h2 class="text-base font-semibold text-slate-800">{title}</h2>
				</div>
				<button
					type="button"
					onclick={handleClose}
					disabled={submitting}
					class="text-slate-400 hover:text-slate-600 w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded-lg disabled:opacity-50"
					aria-label="Cerrar"
				>
					<X size={18} />
				</button>
			</div>

			<div class="p-6">
				{#if message}<p class="text-sm text-slate-600">{message}</p>{/if}

				<div class="flex justify-end gap-2 pt-5">
					<button
						type="button"
						onclick={handleClose}
						disabled={submitting}
						class="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
					>
						{cancelLabel}
					</button>
					<button
						type="button"
						onclick={handleConfirm}
						disabled={submitting}
						class={`flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-60 ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
					>
						{#if submitting}<Loader2 size={16} class="animate-spin" />{/if}
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
