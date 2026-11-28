<script lang="ts">
	/**
	 * Ticket #128 (rechazo 27/11/2026: "Falta un botón para delegar a otra persona"): botón para delegar una tarea a otro
	 * usuario del ERP, o quitar la delegación. La lista de usuarios se carga una vez (ver usuariosParaDelegar).
	 */
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { usuariosParaDelegar } from '../services/alertas.service';
	import { normalizarBusqueda } from '../tareasUi';

	let {
		responsable = null,
		delegada = false,
		compacto = false,
		onDelegar
	}: { responsable?: string | null; delegada?: boolean; compacto?: boolean; onDelegar: (persona: string | null) => void } = $props();

	let abierto = $state(false);
	let busqueda = $state('');
	let raiz: HTMLElement;

	let usuarios = $state<string[]>([]);
	let cargados = false;
	async function abrir() {
		abierto = !abierto;
		busqueda = '';
		if (abierto && !cargados) {
			cargados = true;
			usuarios = await usuariosParaDelegar(supabase);
		}
	}
	const visibles = $derived(usuarios.filter((u) => !busqueda.trim() || normalizarBusqueda(u).includes(normalizarBusqueda(busqueda.trim()))));

	onMount(() => {
		const cerrar = (ev: Event) => {
			if (abierto && raiz && !raiz.contains(ev.target as Node)) abierto = false;
		};
		window.addEventListener('pointerdown', cerrar);
		return () => window.removeEventListener('pointerdown', cerrar);
	});

	function elegir(persona: string | null) {
		abierto = false;
		onDelegar(persona);
	}
</script>

<div class="relative inline-block" bind:this={raiz}>
	<button
		type="button"
		onclick={(ev) => {
			ev.stopPropagation();
			void abrir();
		}}
		title={responsable ? `A cargo de ${responsable} · delegar a otra persona` : 'Delegar a otra persona'}
		aria-haspopup="menu"
		aria-expanded={abierto}
		class={`inline-flex items-center gap-1 rounded-full border font-semibold whitespace-nowrap border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 ${compacto ? 'px-1.5 py-0 text-[11px]' : 'px-2 py-0.5 text-xs'}`}
	>
		<i class="fas fa-user-plus text-[10px]"></i>{delegada ? 'Delegada' : 'Delegar'}
	</button>
	{#if abierto}
		<div role="menu" class="absolute right-0 top-full mt-1 z-30 w-60 rounded-xl border border-slate-200 bg-white shadow-xl p-1 text-sm text-left">
			<input
				type="text"
				bind:value={busqueda}
				placeholder="Buscar usuario…"
				class="w-full mb-1 px-2 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-violet-200"
				onclick={(ev) => ev.stopPropagation()}
			/>
			<div class="max-h-56 overflow-y-auto">
				{#each visibles as u (u)}
					<button type="button" role="menuitem" onclick={() => elegir(u)} class={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 ${u === responsable ? 'bg-violet-50 font-semibold' : ''}`}>
						<i class="far fa-user text-slate-400 text-xs"></i>
						<span class="truncate">{u}</span>
						{#if u === responsable}<i class="fas fa-check ml-auto text-violet-500 text-xs"></i>{/if}
					</button>
				{:else}
					<p class="px-2 py-1.5 text-xs text-slate-400">{usuarios.length ? 'Sin coincidencias.' : 'Cargando usuarios…'}</p>
				{/each}
			</div>
			{#if delegada}
				<div class="my-1 border-t border-slate-100"></div>
				<button type="button" role="menuitem" onclick={() => elegir(null)} class="w-full px-2 py-1.5 rounded-lg text-left text-xs text-rose-600 hover:bg-rose-50">Quitar delegación (vuelve al responsable original)</button>
			{/if}
		</div>
	{/if}
</div>
