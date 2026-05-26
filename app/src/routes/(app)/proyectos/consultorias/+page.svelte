<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { hasPermiso, permisosState } from '$lib/stores/permisos.svelte';

	type Area = { id: number; nombre: string };
	type Unidad = { id: number; nombre: string };
	type Consultoria = {
		id: number;
		nombre: string;
		codigo: string;
		area_id: number | null;
		caract_1: string;
		caract_2: string;
		caract_3: string;
		precio: number;
		costo_estimado: number;
		descripcion: string;
		link_proforma: string;
		existencia_actual: number;
		valor_min: number | null;
		valor_max: number | null;
		unidad_id: number | null;
		created_at: string;
		// Joined fields
		areas?: Area;
		unidades?: Unidad;
	};

	let consultorias = $state<Consultoria[]>([]);
	let areas = $state<Area[]>([]);
	let unidades = $state<Unidad[]>([]);
	
	let isLoading = $state(true);
	let isSaving = $state(false);
	let isModalOpen = $state(false);
	let activeTab = $state('general');
	let modalError = $state('');
	let statusMessage = $state({ type: '', text: '' });

	// Filter and search states
	let searchQuery = $state('');
	let filterArea = $state<string>('all');

	// Form states
	let editingId = $state<number | null>(null);
	let formNombre = $state('');
	let formCodigo = $state('');
	let formAreaId = $state<number | null>(null);
	let formUnidadId = $state<number | null>(null);
	let formPrecio = $state<number>(0);
	let formCostoEstimado = $state<number>(0);
	let formExistenciaActual = $state<number>(0);
	let formValorMin = $state<number | null>(null);
	let formValorMax = $state<number | null>(null);
	let formCaract1 = $state('');
	let formCaract2 = $state('');
	let formCaract3 = $state('');
	let formDescripcion = $state('');
	let formLinkProforma = $state('');

	// Client-side filtered list
	let filteredConsultorias = $derived.by(() => {
		return consultorias.filter(item => {
			const matchesSearch = 
				item.nombre.toLowerCase().includes(searchQuery.toLowerCase()) || 
				(item.codigo && item.codigo.toLowerCase().includes(searchQuery.toLowerCase()));
			
			const matchesArea = 
				filterArea === 'all' || 
				(item.area_id !== null && item.area_id.toString() === filterArea);
				
			return matchesSearch && matchesArea;
		});
	});

	// Dynamic KPIs
	let kpiTotalCount = $derived(consultorias.length);
	let kpiAveragePrice = $derived.by(() => {
		if (consultorias.length === 0) return 0;
		const sum = consultorias.reduce((acc, curr) => acc + Number(curr.precio || 0), 0);
		return sum / consultorias.length;
	});
	let kpiTotalStock = $derived.by(() => {
		return consultorias.reduce((acc, curr) => acc + Number(curr.existencia_actual || 0), 0);
	});
	let kpiAverageMargin = $derived.by(() => {
		const validItems = consultorias.filter(c => Number(c.precio) > 0);
		if (validItems.length === 0) return 0;
		const totalMargin = validItems.reduce((acc, curr) => {
			const price = Number(curr.precio);
			const cost = Number(curr.costo_estimado || 0);
			const profit = price - cost;
			return acc + (profit / price) * 100;
		}, 0);
		return totalMargin / validItems.length;
	});

	async function cargarCatalogos() {
		try {
			const { data: areasData } = await supabase.from('areas').select('id, nombre').order('nombre');
			areas = areasData || [];

			const { data: unidadesData } = await supabase.from('unidades').select('id, nombre').order('nombre');
			unidades = unidadesData || [];
		} catch (e) {
			console.error('[Consultorias] Error al cargar áreas/unidades:', e);
		}
	}

	async function cargarConsultorias() {
		try {
			isLoading = true;
			const { data, error } = await supabase
				.from('consultorias')
				.select(`
					*,
					areas:area_id (id, nombre),
					unidades:unidad_id (id, nombre)
				`)
				.order('created_at', { ascending: false });

			if (error) throw error;
			consultorias = (data as any) || [];
		} catch (error: any) {
			console.error('[Consultorias] Error al cargar consultorías:', error);
			showStatus('error', 'Error al consultar consultorías de la base de datos.');
		} finally {
			isLoading = false;
		}
	}

	function showStatus(type: 'success' | 'error', text: string) {
		statusMessage = { type, text };
		setTimeout(() => {
			statusMessage = { type: '', text: '' };
		}, 3500);
	}

	function resetForm() {
		editingId = null;
		activeTab = 'general';
		formNombre = '';
		formCodigo = '';
		formAreaId = null;
		formUnidadId = null;
		formPrecio = 0;
		formCostoEstimado = 0;
		formExistenciaActual = 0;
		formValorMin = null;
		formValorMax = null;
		formCaract1 = '';
		formCaract2 = '';
		formCaract3 = '';
		formDescripcion = '';
		formLinkProforma = '';
		modalError = '';
	}

	function prepararCrear() {
		resetForm();
		isModalOpen = true;
	}

	function prepararEdicion(item: Consultoria) {
		editingId = item.id;
		activeTab = 'general';
		formNombre = item.nombre;
		formCodigo = item.codigo || '';
		formAreaId = item.area_id;
		formUnidadId = item.unidad_id;
		formPrecio = item.precio || 0;
		formCostoEstimado = item.costo_estimado || 0;
		formExistenciaActual = item.existencia_actual || 0;
		formValorMin = item.valor_min;
		formValorMax = item.valor_max;
		formCaract1 = item.caract_1 || '';
		formCaract2 = item.caract_2 || '';
		formCaract3 = item.caract_3 || '';
		formDescripcion = item.descripcion || '';
		formLinkProforma = item.link_proforma || '';
		modalError = '';
		isModalOpen = true;
	}

	async function guardar() {
		modalError = '';
		if (!hasPermiso('proyectos:write')) {
			modalError = 'No tienes permiso de escritura (proyectos:write) para realizar esta operación.';
			return;
		}

		if (!formNombre.trim()) {
			modalError = 'El nombre de la consultoría es obligatorio.';
			return;
		}

		isSaving = true;
		try {
			const payload = {
				nombre: formNombre.trim(),
				codigo: formCodigo.trim() || null,
				area_id: formAreaId,
				unidad_id: formUnidadId,
				precio: formPrecio,
				costo_estimado: formCostoEstimado,
				existencia_actual: formExistenciaActual,
				valor_min: formValorMin,
				valor_max: formValorMax,
				caract_1: formCaract1.trim() || null,
				caract_2: formCaract2.trim() || null,
				caract_3: formCaract3.trim() || null,
				descripcion: formDescripcion.trim() || null,
				link_proforma: formLinkProforma.trim() || null
			};

			if (editingId) {
				const { error } = await supabase
					.from('consultorias')
					.update(payload)
					.eq('id', editingId);

				if (error) throw error;
				showStatus('success', `Consultoría "${formNombre}" actualizada correctamente.`);
			} else {
				const { error } = await supabase
					.from('consultorias')
					.insert([payload]);

				if (error) {
					if (error.code === '23505') throw new Error('Ya existe una consultoría con ese código único.');
					throw error;
				}
				showStatus('success', `Consultoría "${formNombre}" registrada con éxito.`);
			}

			isModalOpen = false;
			resetForm();
			await cargarConsultorias();
		} catch (error: any) {
			console.error('[Consultorias Error] Error al guardar:', error);
			modalError = error.message || 'Error al guardar el registro de consultoría.';
		} finally {
			isSaving = false;
		}
	}

	async function eliminar(id: number, nombre: string) {
		if (!hasPermiso('proyectos:write')) {
			alert('No tienes permiso de escritura (proyectos:write) para eliminar consultorías.');
			return;
		}

		const confirmacion = confirm(`¿Estás seguro de que deseas eliminar la consultoría "${nombre}"?\nEsta acción no se puede deshacer.`);
		if (!confirmacion) return;

		try {
			const { error } = await supabase.from('consultorias').delete().eq('id', id);
			if (error) {
				if (error.code === '23503') throw new Error('No se puede eliminar esta consultoría porque tiene ventas asociadas en el sistema.');
				throw error;
			}
			showStatus('success', `Consultoría "${nombre}" eliminada correctamente.`);
			isModalOpen = false;
			resetForm();
			await cargarConsultorias();
		} catch (error: any) {
			console.error('[Consultorias Error] Error al eliminar:', error);
			alert(error.message || 'Error al intentar eliminar la consultoría.');
		}
	}

	onMount(async () => {
		await cargarCatalogos();
		await cargarConsultorias();
	});
</script>

<svelte:head>
	<title>Catálogo de Consultorías | Construni ERP</title>
</svelte:head>

<!-- Header Principal -->
<div class="mb-6">
	<div class="text-xs text-slate-500 mb-2">Proyectos &nbsp;>&nbsp; Consultorías</div>
	<div class="flex justify-between items-center">
		<div>
			<h2 class="text-2xl font-semibold text-brand-marine">Catálogo de Servicios de Consultoría</h2>
			<p class="text-sm text-slate-500 mt-1">Administra y cotiza los servicios de consultoría profesional y técnica ofrecidos por la empresa.</p>
		</div>
		{#if hasPermiso('proyectos:write')}
			<button 
				onclick={prepararCrear}
				class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium shadow-md shadow-blue-600/10 active:scale-[0.98] transition-all flex items-center gap-2 cursor-pointer"
			>
				<i class="fas fa-plus-circle"></i> Nueva Consultoría
			</button>
		{/if}
	</div>
</div>

<!-- Status Message Banner -->
{#if statusMessage.text}
	<div class="p-3 mb-6 rounded-lg text-sm font-medium flex items-center gap-2 {statusMessage.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'} transition-all">
		<i class="fas {statusMessage.type === 'success' ? 'fa-check-circle' : 'fa-exclamation-triangle'}"></i>
		{statusMessage.text}
	</div>
{/if}

<!-- Read-Only Banner Notice -->
{#if !hasPermiso('proyectos:write')}
	<div class="p-3 mb-6 rounded-xl text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200/50 flex items-center gap-2">
		<i class="fas fa-info-circle text-amber-500"></i>
		<span><strong>Modo de solo lectura:</strong> No dispones del permiso de escritura (<code>proyectos:write</code>) para agregar, editar o eliminar consultorías.</span>
	</div>
{/if}

<!-- KPI Cards Grid -->
<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
		<div class="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-xl">
			<i class="fas fa-brain"></i>
		</div>
		<div>
			<div class="text-xs text-slate-400 font-medium">Servicios Registrados</div>
			<div class="text-xl font-bold text-brand-marine mt-0.5">{kpiTotalCount}</div>
		</div>
	</div>
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
		<div class="w-12 h-12 rounded-xl bg-green-50 text-green-600 flex items-center justify-center text-xl">
			<i class="fas fa-dollar-sign"></i>
		</div>
		<div>
			<div class="text-xs text-slate-400 font-medium">Precio Promedio</div>
			<div class="text-xl font-bold text-brand-marine mt-0.5">S/ {kpiAveragePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
		</div>
	</div>
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
		<div class="w-12 h-12 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center text-xl">
			<i class="fas fa-percentage"></i>
		</div>
		<div>
			<div class="text-xs text-slate-400 font-medium">Margen Promedio</div>
			<div class="text-xl font-bold text-brand-marine mt-0.5">{kpiAverageMargin.toFixed(1)}%</div>
		</div>
	</div>
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
		<div class="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center text-xl">
			<i class="fas fa-layer-group"></i>
		</div>
		<div>
			<div class="text-xs text-slate-400 font-medium">Existencia Acumulada</div>
			<div class="text-xl font-bold text-brand-marine mt-0.5">{kpiTotalStock}</div>
		</div>
	</div>
</div>

<!-- Filtros y Listado -->
<div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden p-6">
	<!-- Buscador y Selects de Filtros -->
	<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
		<div class="relative">
			<span class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
				<i class="fas fa-search"></i>
			</span>
			<input 
				type="text" 
				bind:value={searchQuery}
				placeholder="Buscar por nombre o código..."
				class="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
			/>
		</div>
		<div>
			<select 
				bind:value={filterArea}
				class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-slate-600"
			>
				<option value="all">Todas las Áreas</option>
				{#each areas as area}
					<option value={area.id.toString()}>{area.nombre}</option>
				{/each}
			</select>
		</div>
		<div class="flex items-center justify-end text-xs text-slate-400 font-medium">
			Mostrando {filteredConsultorias.length} de {consultorias.length} registros
		</div>
	</div>

	<!-- Tabla principal -->
	{#if isLoading}
		<div class="py-12 flex justify-center text-blue-600 text-2xl">
			<i class="fas fa-spinner fa-spin"></i>
		</div>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-sm text-left">
				<thead class="text-xs text-slate-500 bg-slate-50 font-semibold uppercase border-b border-slate-100">
					<tr>
						<th class="p-4">Código / Nombre</th>
						<th class="p-4">Área / Desc.</th>
						<th class="p-4 text-right">Precio de Venta</th>
						<th class="p-4 text-right">Costo Estimado</th>
						<th class="p-4 text-center">Inventario</th>
						<th class="p-4 text-center">Unidad</th>
						{#if hasPermiso('proyectos:write')}
							<th class="p-4 text-center">Acciones</th>
						{/if}
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each filteredConsultorias as item}
						<tr class="hover:bg-slate-50 transition-colors">
							<!-- Nombre & Codigo -->
							<td class="p-4">
								<div class="text-[10px] font-bold text-blue-600 bg-blue-50 rounded px-1.5 py-0.5 inline-block mb-1">{item.codigo || 'SIN CÓDIGO'}</div>
								<div class="font-bold text-slate-800">{item.nombre}</div>
							</td>
							<!-- Area & Descripcion -->
							<td class="p-4 max-w-[240px]">
								<div class="text-xs font-semibold text-slate-600 capitalize mb-0.5">{item.areas?.nombre || 'Sin área asignada'}</div>
								<p class="text-[10px] text-slate-400 line-clamp-2">{item.descripcion || 'Sin descripción descriptiva.'}</p>
							</td>
							<!-- Precio -->
							<td class="p-4 text-right font-bold text-brand-marine">
								S/ {item.precio?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
							</td>
							<!-- Costo Estimado -->
							<td class="p-4 text-right font-semibold text-slate-500">
								S/ {item.costo_estimado?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
							</td>
							<!-- Inventario / Stock -->
							<td class="p-4 text-center">
								<div class="font-bold text-slate-700">{item.existencia_actual}</div>
								{#if item.valor_min !== null || item.valor_max !== null}
									<div class="text-[9px] text-slate-400 mt-0.5">
										Mín: {item.valor_min ?? 'N/A'} | Máx: {item.valor_max ?? 'N/A'}
									</div>
								{/if}
							</td>
							<!-- Unidad -->
							<td class="p-4 text-center whitespace-nowrap">
								<span class="px-2 py-0.5 bg-slate-100 border border-slate-200/50 rounded-md text-[10px] font-semibold text-slate-500">
									{item.unidades?.nombre || 'Unidades'}
								</span>
							</td>
							<!-- Acciones (CRUD) -->
							{#if hasPermiso('proyectos:write')}
								<td class="p-4 text-center whitespace-nowrap">
									<div class="flex items-center justify-center gap-2">
										<button 
											onclick={() => prepararEdicion(item)}
											class="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl text-[11px] font-semibold transition-all flex items-center gap-1 cursor-pointer"
										>
											<i class="fas fa-edit"></i> Editar
										</button>
										<button 
											onclick={() => eliminar(item.id, item.nombre)}
											class="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-[11px] font-semibold transition-all flex items-center gap-1 cursor-pointer"
										>
											<i class="fas fa-trash-alt"></i> Borrar
										</button>
									</div>
								</td>
							{/if}
						</tr>
					{/each}
					{#if filteredConsultorias.length === 0}
						<tr>
							<td colspan={hasPermiso('proyectos:write') ? 7 : 6} class="p-8 text-center text-slate-500 text-xs">
								No se encontraron consultorías registradas con los filtros aplicados.
							</td>
						</tr>
					{/if}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<!-- Modal CRUD (Crear/Editar) -->
{#if isModalOpen}
	<div class="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4 transition-all duration-300">
		<div class="bg-white rounded-3xl shadow-2xl border border-slate-200/50 max-w-4xl w-full overflow-hidden flex flex-col max-h-[90vh] scale-100 transform transition-transform duration-300">
			
			<!-- Header Principal -->
			<div class="bg-gradient-to-r from-blue-700 via-blue-800 to-indigo-900 text-white px-6 py-5 flex items-center justify-between shadow-md">
				<div class="flex items-center gap-3">
					<div class="w-10 h-10 rounded-xl bg-white/10 text-white flex items-center justify-center backdrop-blur-xs shadow-inner">
						<i class="fas {editingId ? 'fa-edit' : 'fa-plus-circle'} text-lg"></i>
					</div>
					<div>
						<h3 class="font-bold text-base leading-tight">{editingId ? 'Modificar Servicio de Consultoría' : 'Registrar Nuevo Servicio de Consultoría'}</h3>
						<p class="text-[11px] text-blue-100/80 mt-0.5">Ingresa los datos técnicos y de inventario del servicio para controlar el avance y presupuesto</p>
					</div>
				</div>
				<button onclick={() => { isModalOpen = false; resetForm(); }} class="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white hover:scale-105 active:scale-95 flex items-center justify-center transition-all cursor-pointer">
					<i class="fas fa-times text-sm"></i>
				</button>
			</div>

			<!-- Tabs de Navegación del Popup -->
			<div class="flex border-b border-slate-100 px-6 bg-slate-50/50">
				<button 
					type="button" 
					class="px-5 py-3 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer {activeTab === 'general' ? 'border-blue-600 text-blue-600 bg-white/50' : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'}" 
					onclick={() => activeTab = 'general'}
				>
					<i class="fas fa-building text-[13px]"></i> Información General
				</button>
				<button 
					type="button" 
					class="px-5 py-3 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer {activeTab === 'finanzas' ? 'border-blue-600 text-blue-600 bg-white/50' : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'}" 
					onclick={() => activeTab = 'finanzas'}
				>
					<i class="fas fa-coins text-[13px]"></i> Presupuesto e Inventario
				</button>
				<button 
					type="button" 
					class="px-5 py-3 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer {activeTab === 'tecnico' ? 'border-blue-600 text-blue-600 bg-white/50' : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'}" 
					onclick={() => activeTab = 'tecnico'}
				>
					<i class="fas fa-tools text-[13px]"></i> Características Técnicas
				</button>
			</div>
			
			<!-- Contenido del Formulario -->
			<form onsubmit={(e) => { e.preventDefault(); guardar(); }} class="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/20">
				{#if modalError}
					<div class="p-3 bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl font-semibold text-center shadow-sm flex items-center justify-center gap-2 animate-pulse">
						<i class="fas fa-exclamation-circle text-sm"></i>
						{modalError}
					</div>
				{/if}

				<!-- TAB 1: INFORMACIÓN GENERAL -->
				{#if activeTab === 'general'}
					<div class="space-y-5">
						<div class="bg-blue-50/40 p-4 rounded-2xl border border-blue-100/50 flex gap-3 mb-4">
							<i class="fas fa-info-circle text-blue-600 text-base mt-0.5"></i>
							<div class="text-[11px] text-blue-800/90 leading-relaxed">
								<strong>Campos esenciales:</strong> Define el nombre descriptivo y el código único de referencia técnica de la consultoría para mantener consistencia con los contratos y facturación.
							</div>
						</div>
						<div class="grid grid-cols-1 md:grid-cols-2 gap-5">
							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Nombre de la Consultoría *</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-brain"></i>
									</span>
									<input 
										type="text" 
										bind:value={formNombre} 
										placeholder="Ej. Consultoría de Diseño Estructural Complejo" 
										required 
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-xs text-slate-800 placeholder-slate-400 font-medium shadow-xs" 
									/>
								</div>
							</div>
							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Código de Referencia</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-tag"></i>
									</span>
									<input 
										type="text" 
										bind:value={formCodigo} 
										placeholder="Ej. CNS-002" 
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-xs text-slate-800 placeholder-slate-400 font-medium shadow-xs" 
									/>
								</div>
							</div>
							<div class="md:col-span-2">
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Área de la Consultoría</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-map-marker-alt"></i>
									</span>
									<select 
										bind:value={formAreaId} 
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-xs text-slate-800 font-medium shadow-xs cursor-pointer"
									>
										<option value={null}>-- Seleccione Área --</option>
										{#each areas as area}
											<option value={area.id}>{area.nombre}</option>
										{/each}
									</select>
								</div>
							</div>
						</div>
						<div>
							<label class="block text-xs font-semibold text-slate-700 mb-1.5">Descripción de la Consultoría</label>
							<div class="relative">
								<span class="absolute top-3 left-3.5 text-slate-400">
									<i class="fas fa-align-left"></i>
								</span>
								<textarea 
									bind:value={formDescripcion} 
									placeholder="Escribe detalles del expediente técnico, consultor principal u observaciones relevantes de la consultoría..." 
									rows="4" 
									class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-xs text-slate-800 placeholder-slate-400 font-medium shadow-xs"
								></textarea>
							</div>
						</div>
					</div>
				{/if}

				<!-- TAB 2: PRESUPUESTO E INVENTARIO -->
				{#if activeTab === 'finanzas'}
					<div class="space-y-5">
						<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Precio Presupuestado (S/)</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 font-bold text-xs">
										S/
									</span>
									<input 
										type="number" 
										step="0.01"
										bind:value={formPrecio} 
										placeholder="0.00"
										class="w-full pl-9 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-xs text-slate-800 font-bold shadow-xs" 
									/>
								</div>
							</div>
							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Costo Estimado (S/)</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 font-bold text-xs">
										S/
									</span>
									<input 
										type="number" 
										step="0.01"
										bind:value={formCostoEstimado} 
										placeholder="0.00"
										class="w-full pl-9 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-xs text-slate-800 font-bold shadow-xs" 
									/>
								</div>
							</div>
							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Existencia / Avance Físico</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-boxes"></i>
									</span>
									<input 
										type="number" 
										step="0.1"
										bind:value={formExistenciaActual} 
										placeholder="0"
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-xs text-slate-800 font-semibold shadow-xs" 
									/>
								</div>
							</div>
							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Unidad de Medida</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-ruler"></i>
									</span>
									<select 
										bind:value={formUnidadId} 
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-xs text-slate-800 font-medium shadow-xs cursor-pointer"
									>
										<option value={null}>-- Seleccione Unidad --</option>
										{#each unidades as uni}
											<option value={uni.id}>{uni.nombre}</option>
										{/each}
									</select>
								</div>
							</div>
							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Valor Mínimo (Alerta stock/materiales)</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-compress-arrows-alt"></i>
									</span>
									<input 
										type="number" 
										step="0.1"
										bind:value={formValorMin} 
										placeholder="Sin mínimo"
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-xs text-slate-800 font-medium shadow-xs" 
									/>
								</div>
							</div>
							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Valor Máximo (Límite acopio)</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-expand-arrows-alt"></i>
									</span>
									<input 
										type="number" 
										step="0.1"
										bind:value={formValorMax} 
										placeholder="Sin máximo"
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-xs text-slate-800 font-medium shadow-xs" 
									/>
								</div>
							</div>
							<div class="md:col-span-3">
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Link a Carpeta / Proforma de Consultoría</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-link"></i>
									</span>
									<input 
										type="text" 
										bind:value={formLinkProforma} 
										placeholder="https://drive.google.com/..."
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-xs text-slate-850 placeholder-slate-400 font-medium shadow-xs" 
									/>
								</div>
							</div>
						</div>
					</div>
				{/if}

				<!-- TAB 3: CARACTERÍSTICAS TÉCNICAS -->
				{#if activeTab === 'tecnico'}
					<div class="space-y-5">
						<div class="grid grid-cols-1 md:grid-cols-3 gap-5">
							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Tipo de Consultoría (Caract. 1)</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-brain"></i>
									</span>
									<input 
										type="text" 
										bind:value={formCaract1} 
										placeholder="Ej. Diseño, Supervisión, Auditoría" 
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-xs text-slate-800 font-medium shadow-xs" 
									/>
								</div>
							</div>
							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Ubicación / Modalidad (Caract. 2)</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-laptop-house"></i>
									</span>
									<input 
										type="text" 
										bind:value={formCaract2} 
										placeholder="Ej. Remoto, Presencial, Híbrido" 
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-xs text-slate-800 font-medium shadow-xs" 
									/>
								</div>
							</div>
							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Plazo Estimado (Caract. 3)</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-hourglass-half"></i>
									</span>
									<input 
										type="text" 
										bind:value={formCaract3} 
										placeholder="Ej. 3 meses, 6 meses" 
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-xs text-slate-800 font-medium shadow-xs" 
									/>
								</div>
							</div>
						</div>
					</div>
				{/if}

				<!-- Footer del Formulario -->
				<div class="pt-5 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-3">
					
					<!-- CRUD Action: Eliminar (Solo al editar) -->
					<div>
						{#if editingId && hasPermiso('proyectos:write')}
							<button 
								type="button" 
								onclick={() => eliminar(editingId, formNombre)} 
								class="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition-all hover:scale-[1.02] active:scale-98 cursor-pointer flex items-center gap-1.5 shadow-sm"
							>
								<i class="fas fa-trash-alt"></i> Eliminar Registro
							</button>
						{/if}
					</div>

					<div class="flex items-center gap-3 w-full sm:w-auto justify-end">
						<button 
							type="button" 
							onclick={() => { isModalOpen = false; resetForm(); }} 
							class="px-5 py-2.5 bg-slate-150 text-slate-700 rounded-xl hover:bg-slate-200 text-xs font-bold transition-all cursor-pointer hover:scale-[1.02] active:scale-98"
						>
							Cancelar
						</button>
						<button 
							type="submit" 
							disabled={isSaving} 
							class="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 text-xs font-bold shadow-md shadow-blue-600/15 disabled:opacity-70 flex items-center gap-2 transition-all hover:scale-[1.02] active:scale-98 cursor-pointer"
						>
							{#if isSaving}
								<i class="fas fa-spinner fa-spin"></i> Guardando...
							{:else}
								<i class="fas fa-save"></i> Guardar Cambios
							{/if}
						</button>
					</div>
				</div>
			</form>
		</div>
	</div>
{/if}
