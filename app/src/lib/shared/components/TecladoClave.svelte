<script lang="ts">
	/**
	 * Ticket #112: casillas de la clave de 4 dígitos + teclado numérico grande (maqueta de la clienta).
	 * También acepta el teclado físico (números y Retroceso) en Windows/navegador.
	 * `teclaExtra`: lo que va en la tecla de abajo a la izquierda (ej. el botón de huella); vacía si no hay.
	 */
	import type { Snippet } from 'svelte';
	import { Delete } from '@lucide/svelte';

	let {
		valor = $bindable(''),
		longitud = 4,
		deshabilitado = false,
		error = false,
		alCompletar,
		teclaExtra,
		nota
	}: {
		valor?: string;
		longitud?: number;
		deshabilitado?: boolean;
		error?: boolean;
		alCompletar?: (clave: string) => void;
		teclaExtra?: Snippet;
		/** Va entre las casillas y el teclado (ej. "Acceso guardado en este equipo"). */
		nota?: Snippet;
	} = $props();

	function pulsar(d: string) {
		if (deshabilitado || valor.length >= longitud) return;
		valor += d;
		if (valor.length === longitud) alCompletar?.(valor);
	}
	function borrar() {
		if (deshabilitado) return;
		valor = valor.slice(0, -1);
	}
	function onKeydown(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
		if (/^[0-9]$/.test(e.key)) {
			e.preventDefault();
			pulsar(e.key);
		} else if (e.key === 'Backspace') {
			e.preventDefault();
			borrar();
		}
	}
	const tecla =
		'h-[52px] sm:h-16 rounded-2xl bg-slate-100 text-[#0f2a4a] text-2xl sm:text-3xl font-bold shadow-sm active:scale-[0.97] active:bg-slate-200 transition disabled:opacity-50 flex items-center justify-center select-none';
</script>

<svelte:window onkeydown={onKeydown} />

<div class={`flex justify-center gap-3 ${error ? 'animate-[sacudir_0.35s]' : ''}`} aria-label={`Clave: ${valor.length} de ${longitud} dígitos`}>
	{#each Array.from({ length: longitud }) as _, i (i)}
		{@const lleno = i < valor.length}
		{@const actual = i === valor.length && !deshabilitado}
		<div
			class={`w-[52px] h-[52px] sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center border-2 transition ${
				error ? 'border-red-400 bg-red-50' : lleno ? 'border-slate-200 bg-slate-100' : actual ? 'border-brand-orange bg-white' : 'border-slate-200 bg-white'
			}`}
		>
			{#if lleno}<span class="w-3 h-3 rounded-full bg-[#0f2a4a]"></span>{/if}
		</div>
	{/each}
</div>

{#if nota}{@render nota()}{/if}

<div class="grid grid-cols-3 gap-2 sm:gap-2.5 mt-3">
	{#each ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as d (d)}
		<button type="button" class={tecla} disabled={deshabilitado} onclick={() => pulsar(d)}>{d}</button>
	{/each}
	{#if teclaExtra}
		{@render teclaExtra()}
	{:else}
		<div class="h-[52px] sm:h-16 rounded-2xl bg-slate-100/60"></div>
	{/if}
	<button type="button" class={tecla} disabled={deshabilitado} onclick={() => pulsar('0')}>0</button>
	<button type="button" class={tecla} disabled={deshabilitado} onclick={borrar} aria-label="Borrar">
		<Delete size={28} />
	</button>
</div>

<style>
	@keyframes -global-sacudir {
		0%,
		100% {
			transform: translateX(0);
		}
		25% {
			transform: translateX(-8px);
		}
		75% {
			transform: translateX(8px);
		}
	}
</style>
