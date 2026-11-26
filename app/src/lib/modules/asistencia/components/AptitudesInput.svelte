<script lang="ts">
	/**
	 * Aptitudes como etiquetas (ticket #118, 26/11/2026): "Tarrajeo", "Asentado de ladrillos"... Se escribe y se pulsa
	 * Enter (o coma) para agregar; sugiere las ya usadas en otros trabajadores y requerimientos. Se usa en la ficha de
	 * Personal (lo que sabe el trabajador) y en los requerimientos de personal del tareo (lo que se pide).
	 */
	let {
		value = $bindable<string[]>([]),
		sugerencias = [],
		id = 'aptitudes',
		placeholder = 'Escribe una aptitud y pulsa Enter',
		disabled = false
	}: { value?: string[]; sugerencias?: string[]; id?: string; placeholder?: string; disabled?: boolean } = $props();

	import InputConLista from '$lib/shared/components/InputConLista.svelte';

	let texto = $state('');
	const clave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
	const disponibles = $derived(sugerencias.filter((s) => !value.some((v) => clave(v) === clave(s))));

	function agregar(t = texto) {
		const limpio = t.replace(/,/g, ' ').trim().slice(0, 60);
		texto = '';
		if (!limpio || value.some((v) => clave(v) === clave(limpio))) return;
		// Si coincide con una sugerencia (sin tildes/mayúsculas), se usa la forma ya registrada.
		value = [...value, sugerencias.find((s) => clave(s) === clave(limpio)) ?? limpio];
	}
	function quitar(i: number) {
		value = value.filter((_, j) => j !== i);
	}
	function teclas(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			agregar();
		} else if (e.key === 'Backspace' && !texto && value.length) {
			quitar(value.length - 1);
		}
	}
</script>

<div class={`flex flex-wrap items-center gap-1.5 px-2 py-1.5 border border-slate-200 rounded-lg bg-white min-h-[38px] ${disabled ? 'opacity-60' : ''}`}>
	{#each value as a, i (a)}
		<span class="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-xs text-blue-700">
			{a}
			{#if !disabled}<button type="button" onclick={() => quitar(i)} class="text-blue-400 hover:text-rose-600" aria-label={`Quitar ${a}`}>×</button>{/if}
		</span>
	{/each}
	{#if !disabled}
		<span class="flex-1 min-w-[10rem]">
			<InputConLista
				{id}
				bind:value={texto}
				opciones={disponibles}
				onelegir={(v) => agregar(v)}
				onkeydown={teclas}
				onblur={() => texto.trim() && agregar()}
				maxlength={60}
				{placeholder}
				class="w-full px-1 py-0.5 text-sm outline-none bg-transparent"
			/>
		</span>
	{/if}
</div>
