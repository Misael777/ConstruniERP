<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { supabase } from '$lib/supabaseClient';
	import { goto } from '$app/navigation';

	const projectId = $page.params.id;

	type Proyecto = {
		id_proyecto: number;
		nombre_proyecto: string;
		ubicacion: string;
		fecha_inicio_plan: string;
		fecha_fin_plan: string;
		estado_proyecto: string;
		costo_estima: number;
		descripcion: string;
		responsable: string;
	};

	let proyecto = $state<Proyecto | null>(null);
	let isLoading = $state(true);
	let activeTab = $state('definicion');

	onMount(async () => {
		try {
			const { data, error } = await supabase
				.from('proyecto')
				.select('*')
				.eq('id_proyecto', projectId)
				.single();

			if (error) throw error;
			proyecto = data;
		} catch (error) {
			console.error("Error cargando el proyecto:", error);
		} finally {
			isLoading = false;
		}
	});

	function goBack() {
		goto('/proyectos/gestion');
	}

</script>

<svelte:head>
	<title>{proyecto ? `${proyecto.nombre_proyecto} | Gestión` : 'Cargando Proyecto...'}</title>
</svelte:head>

{#if isLoading}
	<div class="flex justify-center text-orange-600 text-3xl py-12">
		<i class="fas fa-circle-notch fa-spin"></i>
	</div>
{:else if !proyecto}
	<div class="bg-white rounded-2xl border border-slate-100 p-12 text-center shadow-sm">
		<i class="fas fa-exclamation-triangle text-4xl text-rose-500 mb-4"></i>
		<h2 class="text-xl font-bold text-slate-800">Proyecto no encontrado</h2>
		<p class="text-slate-500 mt-2 mb-6">El proyecto que intentas buscar no existe o fue eliminado.</p>
		<button onclick={goBack} class="px-5 py-2 bg-slate-800 text-white rounded-xl text-sm font-medium hover:bg-slate-700 transition-colors">
			Volver a Gestión
		</button>
	</div>
{:else}
	<!-- Cabecera del Proyecto -->
	<div class="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
		<div class="flex items-center gap-4">
			<button onclick={goBack} class="w-10 h-10 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 flex items-center justify-center transition-colors shadow-xs" title="Volver">
				<i class="fas fa-arrow-left"></i>
			</button>
			<div>
				<div class="flex items-center gap-3 mb-1">
					<h2 class="text-2xl font-bold text-slate-800">{proyecto.nombre_proyecto}</h2>
					<span class="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase border bg-emerald-100 text-emerald-700 border-emerald-200 tracking-wider">
						{proyecto.estado_proyecto || 'ACTIVO'}
					</span>
				</div>
				<div class="flex items-center gap-4 text-xs font-medium text-slate-500">
					<span class="flex items-center gap-1.5"><i class="fas fa-map-marker-alt text-slate-400"></i> {proyecto.ubicacion || 'Sin ubicación'}</span>
					<span class="w-1 h-1 rounded-full bg-slate-300"></span>
					<span class="flex items-center gap-1.5"><i class="fas fa-hashtag text-slate-400"></i> PROY-{proyecto.id_proyecto}</span>
				</div>
			</div>
		</div>
		<div class="flex gap-2">
			<button class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 border border-slate-200">
				<i class="fas fa-print"></i> Reporte
			</button>
			<button class="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-sm font-medium shadow-md shadow-orange-600/10 transition-colors flex items-center gap-2">
				<i class="fas fa-save"></i> Guardar Cambios
			</button>
		</div>
	</div>

	<!-- Navegación de Pestañas -->
	<div class="bg-white rounded-t-2xl border-x border-t border-slate-100 px-2 pt-2 flex overflow-x-auto gap-1">
		<button 
			class={`px-5 py-3 text-sm font-bold flex items-center gap-2 rounded-t-xl transition-colors border-b-2 ${activeTab === 'definicion' ? 'text-orange-600 border-orange-600 bg-orange-50/50' : 'text-slate-500 border-transparent hover:text-slate-800 hover:bg-slate-50'}`}
			onclick={() => activeTab = 'definicion'}
		>
			<i class="fas fa-info-circle"></i> Definición
		</button>
		<button 
			class={`px-5 py-3 text-sm font-bold flex items-center gap-2 rounded-t-xl transition-colors border-b-2 ${activeTab === 'partidas' ? 'text-orange-600 border-orange-600 bg-orange-50/50' : 'text-slate-500 border-transparent hover:text-slate-800 hover:bg-slate-50'}`}
			onclick={() => activeTab = 'partidas'}
		>
			<i class="fas fa-list-ul"></i> Presupuesto / Partidas
		</button>
		<button 
			class={`px-5 py-3 text-sm font-bold flex items-center gap-2 rounded-t-xl transition-colors border-b-2 ${activeTab === 'gestion' ? 'text-orange-600 border-orange-600 bg-orange-50/50' : 'text-slate-500 border-transparent hover:text-slate-800 hover:bg-slate-50'}`}
			onclick={() => activeTab = 'gestion'}
		>
			<i class="fas fa-chart-gantt"></i> Gestión de Obra
		</button>
	</div>

	<!-- Contenido de las Pestañas -->
	<div class="bg-white rounded-b-2xl border border-slate-100 shadow-sm p-6 min-h-[400px]">
		
		{#if activeTab === 'definicion'}
			<div class="max-w-4xl animate-in fade-in duration-300">
				<h3 class="text-lg font-bold text-slate-800 mb-4 border-b border-slate-100 pb-2">Información General</h3>
				<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
					<div>
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Nombre del Proyecto</label>
						<input type="text" value={proyecto.nombre_proyecto} class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800" />
					</div>
					<div>
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Responsable (Residente)</label>
						<input type="text" value={proyecto.responsable || ''} placeholder="Ej. Ing. Juan Pérez" class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800" />
					</div>
					<div class="md:col-span-2">
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Ubicación</label>
						<input type="text" value={proyecto.ubicacion || ''} class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800" />
					</div>
					<div class="md:col-span-2">
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Descripción</label>
						<textarea rows="3" class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800 resize-none">{proyecto.descripcion || ''}</textarea>
					</div>
				</div>

				<h3 class="text-lg font-bold text-slate-800 mb-4 mt-8 border-b border-slate-100 pb-2">Planificación y Costos</h3>
				<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
					<div>
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Fecha Inicio Plan.</label>
						<input type="date" value={proyecto.fecha_inicio_plan || ''} class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800" />
					</div>
					<div>
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Fecha Fin Plan.</label>
						<input type="date" value={proyecto.fecha_fin_plan || ''} class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800" />
					</div>
					<div>
						<label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Costo Estimado (S/)</label>
						<input type="number" value={proyecto.costo_estima || ''} class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-medium text-slate-800" />
					</div>
				</div>
			</div>
		{/if}

		{#if activeTab === 'partidas'}
			<div class="animate-in fade-in duration-300">
				<div class="flex justify-between items-center mb-6">
					<div>
						<h3 class="text-lg font-bold text-slate-800">Presupuesto del Proyecto (Instancias de Partidas)</h3>
						<p class="text-sm text-slate-500 mt-1">Jala las partidas del catálogo maestro para armar el presupuesto y modifica cantidades y precios específicos para esta obra.</p>
					</div>
					<button class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium shadow-md shadow-blue-600/10 transition-colors flex items-center gap-2">
						<i class="fas fa-plus-circle"></i> Agregar del Catálogo Maestro
					</button>
				</div>

				<div class="border border-slate-200 rounded-xl overflow-hidden">
					<table class="w-full text-sm text-left">
						<thead class="text-xs text-slate-500 bg-slate-50 font-bold uppercase border-b border-slate-200">
							<tr>
								<th class="p-4">Item</th>
								<th class="p-4">Descripción de Partida</th>
								<th class="p-4 text-center">Und.</th>
								<th class="p-4 text-right">Metrado (Cant.)</th>
								<th class="p-4 text-right">Precio Unit. (S/)</th>
								<th class="p-4 text-right">Parcial (S/)</th>
								<th class="p-4 text-center">Acciones</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-slate-100">
							<!-- Placeholder Data -->
							<tr class="hover:bg-slate-50/50">
								<td class="p-4 font-mono text-slate-500">01.01.01</td>
								<td class="p-4 font-bold text-slate-700">Trazo, nivelación y replanteo</td>
								<td class="p-4 text-center">m2</td>
								<td class="p-4 text-right">
									<input type="number" value="150.50" class="w-24 px-2 py-1 text-right bg-white border border-slate-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none font-medium" />
								</td>
								<td class="p-4 text-right">
									<input type="number" value="2.50" class="w-24 px-2 py-1 text-right bg-white border border-slate-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none font-medium" />
								</td>
								<td class="p-4 text-right font-bold text-slate-700">376.25</td>
								<td class="p-4 text-center">
									<button class="w-8 h-8 rounded bg-white border border-slate-200 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 text-slate-400 transition-colors shadow-sm">
										<i class="fas fa-trash-alt text-xs"></i>
									</button>
								</td>
							</tr>
							<tr class="hover:bg-slate-50/50">
								<td class="p-4 font-mono text-slate-500">01.01.02</td>
								<td class="p-4 font-bold text-slate-700">Excavación manual de zanjas</td>
								<td class="p-4 text-center">m3</td>
								<td class="p-4 text-right">
									<input type="number" value="45.00" class="w-24 px-2 py-1 text-right bg-white border border-slate-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none font-medium" />
								</td>
								<td class="p-4 text-right">
									<input type="number" value="45.20" class="w-24 px-2 py-1 text-right bg-white border border-slate-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none font-medium" />
								</td>
								<td class="p-4 text-right font-bold text-slate-700">2,034.00</td>
								<td class="p-4 text-center">
									<button class="w-8 h-8 rounded bg-white border border-slate-200 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 text-slate-400 transition-colors shadow-sm">
										<i class="fas fa-trash-alt text-xs"></i>
									</button>
								</td>
							</tr>
						</tbody>
						<tfoot class="bg-slate-50 border-t border-slate-200">
							<tr>
								<td colspan="5" class="p-4 text-right font-bold text-slate-700">Costo Directo Total:</td>
								<td class="p-4 text-right font-bold text-blue-700 text-base">S/ 2,410.25</td>
								<td></td>
							</tr>
						</tfoot>
					</table>
				</div>
			</div>
		{/if}

		{#if activeTab === 'gestion'}
			<div class="animate-in fade-in duration-300 text-center py-16">
				<div class="w-20 h-20 bg-orange-50 rounded-full flex items-center justify-center mx-auto mb-6 border border-orange-100">
					<i class="fas fa-chart-gantt text-3xl text-orange-500"></i>
				</div>
				<h3 class="text-xl font-bold text-slate-800 mb-2">Módulo de Gestión Operativa</h3>
				<p class="text-slate-500 max-w-lg mx-auto mb-8">Aquí se conectarán las instancias de las partidas del presupuesto para armar el cronograma (Gantt), generar el Lookahead de 4 semanas y realizar el control de valorizaciones.</p>
				<div class="flex justify-center gap-4">
					<button class="px-5 py-2.5 bg-white border-2 border-slate-200 hover:border-orange-500 hover:text-orange-600 text-slate-600 rounded-xl font-bold transition-all shadow-sm">
						<i class="fas fa-calendar-alt mr-2"></i> Abrir Cronograma
					</button>
					<button class="px-5 py-2.5 bg-white border-2 border-slate-200 hover:border-orange-500 hover:text-orange-600 text-slate-600 rounded-xl font-bold transition-all shadow-sm">
						<i class="fas fa-binoculars mr-2"></i> Lookahead Planning
					</button>
				</div>
			</div>
		{/if}

	</div>
{/if}
