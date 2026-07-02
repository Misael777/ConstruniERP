<script lang="ts">
	import { toasts, toast } from '$lib/stores/toast';
	import { CheckCircle2, XCircle, Info, X } from '@lucide/svelte';

	const styles: Record<string, string> = {
		success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
		error: 'bg-red-50 border-red-200 text-red-800',
		info: 'bg-blue-50 border-blue-200 text-blue-800'
	};
</script>

<div class="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-full max-w-sm pointer-events-none">
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
			<p class="flex-1 leading-snug">{t.text}</p>
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
