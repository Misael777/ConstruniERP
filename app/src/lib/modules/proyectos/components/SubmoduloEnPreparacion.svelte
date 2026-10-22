<script lang="ts">
	/**
	 * Estructura base de un submódulo de Proyectos que todavía no tiene datos ni diseño definido (Catálogo;
	 * Reuniones, acuerdos y mejoras) — a pedido del usuario: título, buscador, columnas y Exportar, listo para
	 * conectarle su tabla cuando se defina. Exportar descarga las columnas (y filas, cuando las haya) a Excel.
	 */
	import { exportarTablaXlsx } from '$lib/shared/exportarXlsx';
	import { toast } from '$lib/stores/toast';
	import { describeError } from '$lib/shared/describeError';
	import { Search, Download, Loader2, Inbox } from '@lucide/svelte';

	let {
		titulo,
		descripcion,
		columnas,
		textoBuscador = 'Buscar...',
		textoVacio
	}: { titulo: string; descripcion: string; columnas: string[]; textoBuscador?: string; textoVacio: string } = $props();

	let busqueda = $state('');
	let exportando = $state(false);

	async function exportar() {
		exportando = true;
		try {
			await exportarTablaXlsx({ nombreArchivo: titulo.replace(/[^\p{L}\p{N}]+/gu, '_'), hoja: titulo, columnas: columnas.map((c) => ({ titulo: c, ancho: 24 })), filas: [] });
		} catch (err) {
			toast.error(`No se pudo exportar. ${describeError(err)}`);
		} finally {
			exportando = false;
		}
	}
</script>

<div class="w-full">
	<div class="flex flex-wrap items-start justify-between gap-3 mb-5">
		<div>
			<h1 class="text-xl font-bold text-[#0f3b5e]">{titulo}</h1>
			<p class="text-sm text-slate-500">{descripcion}</p>
		</div>
		<button
			type="button"
			onclick={exportar}
			disabled={exportando}
			class="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
		>
			{#if exportando}<Loader2 size={16} class="animate-spin" />{:else}<Download size={16} />{/if} Exportar
		</button>
	</div>

	<div class="mb-4 relative w-full sm:w-80">
		<Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
		<input type="text" bind:value={busqueda} placeholder={textoBuscador} class="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
	</div>

	<div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
		<div class="overflow-x-auto">
			<table class="w-full min-w-[640px] text-sm">
				<thead>
					<tr class="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
						{#each columnas as c (c)}<th class="text-left px-5 py-3">{c}</th>{/each}
					</tr>
				</thead>
			</table>
		</div>
		<div class="flex flex-col items-center justify-center gap-2 py-14 text-center">
			<span class="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400"><Inbox size={22} /></span>
			<p class="text-sm font-medium text-slate-600">{textoVacio}</p>
			<p class="text-xs text-slate-400">Este submódulo está listo para conectarle sus datos.</p>
		</div>
	</div>
</div>
