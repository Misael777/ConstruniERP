<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';

	type Partida = {
		id_partida: number;
		codigo: string;
		descripcion: string;
		unidad: string;
		cuadrilla: number;
		precio_unitario: number;
		nivel: number;
		id_partida_padre: number | null;
	};

	let partidas = $state<Partida[]>([]);
	let isLoading = $state(true);
	let searchTerm = $state('');

	onMount(async () => {
		try {
			const { data, error } = await supabase
				.from('partida')
				.select('*')
				.order('codigo');

			if (error) throw error;
			partidas = data || [];
		} catch (error) {
			console.error("Error cargando partidas:", error);
		} finally {
			isLoading = false;
		}
	});

	let filteredPartidas = $derived(
		partidas.filter(p => 
			p.descripcion.toLowerCase().includes(searchTerm.toLowerCase()) || 
			p.codigo.toLowerCase().includes(searchTerm.toLowerCase())
		)
	);

</script>

<svelte:head>
	<title>Catálogo Maestro de Partidas | Construni ERP</title>
</svelte:head>

<div class="mb-8">
	<div class="text-xs text-slate-500 mb-2">Proyectos &nbsp;>&nbsp; Partidas y Plantillas</div>
	<div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
		<div>
			<h2 class="text-2xl font-semibold text-slate-800">Catálogo Maestro de Partidas</h2>
			<p class="text-sm text-slate-500 mt-1">Administra las definiciones (clases) base para todas las partidas. Estas se podrán instanciar luego en cada proyecto.</p>
		</div>
		<div class="flex gap-3">
			<div class="relative">
				<i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
				<input type="text" bind:value={searchTerm} placeholder="Buscar por código o nombre..." class="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm w-64 shadow-sm" />
			</div>
			<button class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium shadow-md shadow-blue-600/10 active:scale-[0.98] transition-all flex items-center gap-2">
				<i class="fas fa-plus"></i> Nueva Partida
			</button>
		</div>
	</div>
</div>

<div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
	{#if isLoading}
		<div class="flex justify-center text-blue-600 text-3xl py-12">
			<i class="fas fa-circle-notch fa-spin"></i>
		</div>
	{:else}
		<table class="w-full text-sm text-left border-collapse">
			<thead class="text-xs text-slate-500 bg-slate-50 font-bold uppercase border-b border-slate-200">
				<tr>
					<th class="p-4 w-32">Código</th>
					<th class="p-4">Descripción de Partida</th>
					<th class="p-4 text-center w-24">Unidad</th>
					<th class="p-4 text-right w-32">Precio Ref. (S/)</th>
					<th class="p-4 text-center w-32">Acciones</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100">
				{#if filteredPartidas.length === 0}
					<tr>
						<td colspan="5" class="p-8 text-center text-slate-500">
							No se encontraron partidas maestras.
						</td>
					</tr>
				{:else}
					{#each filteredPartidas as partida}
						<tr class="hover:bg-slate-50 transition-colors group">
							<td class="p-4 font-mono text-slate-500 font-medium">
								<div class="flex items-center gap-2">
									{#if partida.nivel === 1}
										<div class="w-2 h-2 rounded-full bg-blue-500"></div>
									{:else if partida.nivel === 2}
										<div class="w-2 h-2 rounded-full bg-slate-300 ml-3"></div>
									{:else}
										<div class="w-1.5 h-1.5 rounded-full bg-slate-200 ml-6"></div>
									{/if}
									{partida.codigo}
								</div>
							</td>
							<td class="p-4">
								<div class={`font-bold ${partida.nivel === 1 ? 'text-blue-900 text-base' : partida.nivel === 2 ? 'text-slate-700' : 'text-slate-600'}`}>
									{partida.descripcion}
								</div>
							</td>
							<td class="p-4 text-center text-slate-500 font-medium">
								{partida.unidad || '-'}
							</td>
							<td class="p-4 text-right font-medium text-slate-700">
								{partida.precio_unitario ? partida.precio_unitario.toFixed(2) : '-'}
							</td>
							<td class="p-4 text-center">
								<div class="flex justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
									<button class="w-8 h-8 rounded bg-slate-100 hover:bg-blue-100 text-slate-500 hover:text-blue-600 flex items-center justify-center transition-colors shadow-xs" title="Editar">
										<i class="fas fa-edit text-[11px]"></i>
									</button>
									<button class="w-8 h-8 rounded bg-slate-100 hover:bg-rose-100 text-slate-500 hover:text-rose-600 flex items-center justify-center transition-colors shadow-xs" title="Eliminar">
										<i class="fas fa-trash-alt text-[11px]"></i>
									</button>
								</div>
							</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	{/if}
</div>

<div class="mt-6 bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-start gap-3">
	<i class="fas fa-lightbulb text-blue-500 mt-1"></i>
	<div>
		<h4 class="font-bold text-blue-900 mb-1">Catálogo Maestro Orientado a Objetos</h4>
		<p class="text-sm text-blue-800 leading-relaxed">
			Este catálogo funciona como las <strong>Clases</strong> de tu sistema. Lo que definas aquí servirá como base para todos tus proyectos. Cuando vayas al módulo de Gestión Operativa, podrás jalar estas definiciones para crear <strong>Instancias</strong> (partidas específicas de un proyecto), donde podrás modificar el metrado y precio de forma independiente sin afectar este catálogo original.
		</p>
	</div>
</div>
