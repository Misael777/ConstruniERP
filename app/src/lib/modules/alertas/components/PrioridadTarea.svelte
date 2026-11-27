<script lang="ts">
	/**
	 * Chip de prioridad que se puede cambiar (pedido 27/11/2026): Alta / Media / Baja o Automática (por fecha). El cambio
	 * es para todos (ver guardarPrioridadTarea). La automática dice "auto" para que se note que la puso el sistema y no
	 * una persona (la clienta preguntó por qué algunas tenían prioridad sin que nadie se la pusiera).
	 */
	import { onMount } from 'svelte';
	import type { PrioridadAlerta } from '../services/alertas.service';
	import { PRIORIDAD_TAREA } from '../tareasUi';

	let {
		prioridad,
		manual = false,
		compacto = false,
		onCambiar
	}: { prioridad: PrioridadAlerta; manual?: boolean; compacto?: boolean; onCambiar: (p: PrioridadAlerta | null) => void } = $props();

	let abierto = $state(false);
	let raiz: HTMLElement;

	onMount(() => {
		const cerrar = (ev: Event) => {
			if (abierto && raiz && !raiz.contains(ev.target as Node)) abierto = false;
		};
		window.addEventListener('pointerdown', cerrar);
		return () => window.removeEventListener('pointerdown', cerrar);
	});

	function elegir(p: PrioridadAlerta | null) {
		abierto = false;
		if (p === null ? manual : !manual || p !== prioridad) onCambiar(p);
	}
</script>

<div class="relative inline-block" bind:this={raiz}>
	<button
		type="button"
		onclick={(ev) => {
			ev.stopPropagation();
			abierto = !abierto;
		}}
		title={manual ? 'Prioridad puesta a mano · cambiar' : 'Prioridad automática (por fecha) · cambiar'}
		aria-haspopup="menu"
		aria-expanded={abierto}
		class={`inline-flex items-center gap-1 rounded-full border font-semibold whitespace-nowrap ${compacto ? 'px-1.5 py-0 text-[11px]' : 'px-2 py-0.5 text-xs'} ${PRIORIDAD_TAREA[prioridad].clase}`}
	>
		{PRIORIDAD_TAREA[prioridad].texto}
		{#if !manual}<span class="font-normal opacity-60">auto</span>{/if}
		<i class="fas fa-chevron-down text-[9px] opacity-70"></i>
	</button>
	{#if abierto}
		<div role="menu" class="absolute right-0 top-full mt-1 z-30 w-44 rounded-xl border border-slate-200 bg-white shadow-xl p-1 text-sm text-left">
			{#each ['alta', 'media', 'baja'] as const as p (p)}
				<button type="button" role="menuitem" onclick={() => elegir(p)} class={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 ${manual && p === prioridad ? 'bg-orange-50 font-semibold' : ''}`}>
					<span class={`w-2.5 h-2.5 rounded-full ${PRIORIDAD_TAREA[p].punto}`}></span>
					{PRIORIDAD_TAREA[p].texto}
					{#if manual && p === prioridad}<i class="fas fa-check ml-auto text-orange-500 text-xs"></i>{/if}
				</button>
			{/each}
			<div class="my-1 border-t border-slate-100"></div>
			<button type="button" role="menuitem" onclick={() => elegir(null)} class={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 ${!manual ? 'bg-orange-50 font-semibold' : ''}`}>
				<i class="fas fa-wand-magic-sparkles text-slate-400 text-xs w-2.5"></i>
				<span class="flex-1">Automática <span class="block text-[11px] font-normal text-slate-400">según la fecha</span></span>
				{#if !manual}<i class="fas fa-check text-orange-500 text-xs"></i>{/if}
			</button>
		</div>
	{/if}
</div>
