<script lang="ts">
	import { toasts, toast } from '$lib/stores/toast';
	import { CheckCircle2, XCircle, Info, X } from '@lucide/svelte';

	const styles: Record<string, string> = {
		success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
		error: 'bg-red-50 border-red-200 text-red-800',
		info: 'bg-blue-50 border-blue-200 text-blue-800'
	};

	async function copiarDetalle(texto: string, detalle: string) {
		try {
			await navigator.clipboard.writeText(`${texto}\n\n${detalle}`);
			toast.info('Detalle copiado al portapapeles.');
		} catch {
			toast.info('No se pudo copiar automáticamente — mantén presionado el texto para seleccionarlo.');
		}
	}
</script>

<!-- z-[200]: por encima de cualquier modal de la app (el más alto hoy es DocumentPreviewModal en
     z-[110]) — un toast de éxito/error disparado mientras un modal sigue abierto (ej. "Descargado
     correctamente" al bajar un documento desde su propio popup de previsualización) debe verse por
     encima del backdrop del modal, no quedar tapado detrás. -->
<div class="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 w-full max-w-sm pointer-events-none">
	{#each $toasts as t (t.id)}
		<div
			class={`pointer-events-auto flex items-start gap-2 rounded-xl border px-4 py-3 shadow-lg text-sm ${styles[t.kind]}`}
			role="alert"
		>
			<div class="mt-0.5 shrink-0">
				{#if t.kind === 'success'}
					<CheckCircle2 size={18} />
				{:else if t.kind === 'error'}
					<XCircle size={18} />
				{:else}
					<Info size={18} />
				{/if}
			</div>
			<div class="flex-1 min-w-0">
				<p class="leading-snug">{t.text}</p>
				{#if t.detail}
					<pre class="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-white/70 border border-red-200 p-2 text-[11px] leading-tight select-text">{t.detail}</pre>
					<button
						type="button"
						onclick={() => copiarDetalle(t.text, t.detail!)}
						class="mt-2 text-xs font-semibold underline underline-offset-2"
					>
						Copiar detalle
					</button>
				{/if}
			</div>
			<button
				type="button"
				onclick={() => toast.dismiss(t.id)}
				class="shrink-0 opacity-60 hover:opacity-100"
				aria-label="Cerrar notificación"
			>
				<X size={14} />
			</button>
		</div>
	{/each}
</div>
