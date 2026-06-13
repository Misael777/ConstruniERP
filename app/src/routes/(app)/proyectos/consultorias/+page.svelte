<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { hasPermiso, permisosState } from '$lib/stores/permisos.svelte';

	type Cliente = { id: number; nombre: string };
	type Proyecto = {
		id: number;
		nombre: string;
		codigo: string;
		responsable: string;
		direccion: string;
		tiem_estimado: string;
		precio: number;
		costo_estimado: number;
		descripcion: string;
		link_proforma: string;
		car_tecnica: number;
		valor_min: number | null;
		valor_max: number | null;
		num_piso: number | null;
		cod_cliente: number | null;
		ususario: string;
		est_predio: string;
		tip_proyecto: string;
		area: number;
		Cod_venta: string;
		fec_crea: string;
		// Joined field
		clientes?: Cliente;
	};

	let proyectos = $state<Proyecto[]>([]);
	let clientes = $state<Cliente[]>([]);
	
	let isLoading = $state(true);
	let isSaving = $state(false);
	let isModalOpen = $state(false);
	let activeTab = $state('general');
	let modalError = $state('');
	let statusMessage = $state({ type: '', text: '' });

	// Filter and search states
	let searchQuery = $state('');
	let filterCliente = $state<string>('all');

	// Form states (21 fields of table 'proyecto')
	let editingId = $state<number | null>(null);
	let formNombre = $state('');
	let formCodigo = $state('');
	let formResponsable = $state('');
	let formDireccion = $state('');
	let formTiemEstimado = $state('');
	let formPrecio = $state<number>(0);
	let formCostoEstimado = $state<number>(0);
	let formDescripcion = $state('');
	let formLinkProforma = $state('');
	let formCarTecnica = $state<number>(0);
	let formValorMin = $state<number | null>(null);
	let formValorMax = $state<number | null>(null);
	let formNumPiso = $state<number | null>(null);
	let formCodCliente = $state<number | null>(null);
	let formUsusario = $state('');
	let formEstPredio = $state('');
	let formTipProyecto = $state('');
	let formArea = $state<number>(0);
	let formCodVenta = $state('');
	let formFecCrea = $state('');

	// Client-side filtered list
	let filteredProyectos = $derived.by(() => {
		return proyectos.filter(item => {
			const nameMatch = item.nombre ? item.nombre.toLowerCase() : '';
			const codeMatch = item.codigo ? item.codigo.toLowerCase() : '';
			const respMatch = item.responsable ? item.responsable.toLowerCase() : '';
			const query = searchQuery.toLowerCase();

			const matchesSearch = 
				nameMatch.includes(query) || 
				codeMatch.includes(query) || 
				respMatch.includes(query);
			
			const matchesCliente = 
				filterCliente === 'all' || 
				(item.cod_cliente !== null && item.cod_cliente.toString() === filterCliente);
				
			return matchesSearch && matchesCliente;
		});
	});

	// Dynamic KPIs
	let kpiTotalCount = $derived(proyectos.length);
	let kpiAveragePrice = $derived.by(() => {
		if (proyectos.length === 0) return 0;
		const sum = proyectos.reduce((acc, curr) => acc + Number(curr.precio || 0), 0);
		return sum / proyectos.length;
	});
	let kpiTotalArea = $derived.by(() => {
		return proyectos.reduce((acc, curr) => acc + Number(curr.area || 0), 0);
	});
	let kpiAverageMargin = $derived.by(() => {
		const validItems = proyectos.filter(p => Number(p.precio) > 0);
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
			const { data: clientesData } = await supabase.from('clientes').select('id, nombre').order('nombre');
			clientes = clientesData || [];
		} catch (e) {
			console.error('[Proyectos] Error al cargar clientes:', e);
		}
	}

	async function cargarProyectos() {
		try {
			isLoading = true;
			const { data, error } = await supabase
				.from('proyecto')
				.select(`
					*,
					clientes:cod_cliente (id, nombre)
				`)
				.order('fec_crea', { ascending: false });

			if (error) throw error;
			proyectos = (data as any) || [];
		} catch (error: any) {
			console.error('[Proyectos] Error al cargar proyectos:', error);
			showStatus('error', 'Error al consultar proyectos de la base de datos.');
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
		formResponsable = '';
		formDireccion = '';
		formTiemEstimado = '';
		formPrecio = 0;
		formCostoEstimado = 0;
		formDescripcion = '';
		formLinkProforma = '';
		formCarTecnica = 0;
		formValorMin = null;
		formValorMax = null;
		formNumPiso = null;
		formCodCliente = null;
		formUsusario = '';
		formEstPredio = '';
		formTipProyecto = '';
		formArea = 0;
		formCodVenta = '';
		formFecCrea = new Date().toISOString().split('T')[0];
		modalError = '';
	}

	function prepararCrear() {
		resetForm();
		isModalOpen = true;
	}

	function prepararEdicion(item: Proyecto) {
		editingId = item.id;
		activeTab = 'general';
		formNombre = item.nombre || '';
		formCodigo = item.codigo || '';
		formResponsable = item.responsable || '';
		formDireccion = item.direccion || '';
		formTiemEstimado = item.tiem_estimado || '';
		formPrecio = item.precio || 0;
		formCostoEstimado = item.costo_estimado || 0;
		formDescripcion = item.descripcion || '';
		formLinkProforma = item.link_proforma || '';
		formCarTecnica = item.car_tecnica || 0;
		formValorMin = item.valor_min;
		formValorMax = item.valor_max;
		formNumPiso = item.num_piso;
		formCodCliente = item.cod_cliente;
		formUsusario = item.ususario || '';
		formEstPredio = item.est_predio || '';
		formTipProyecto = item.tip_proyecto || '';
		formArea = item.area || 0;
		formCodVenta = item.Cod_venta || '';
		formFecCrea = item.fec_crea ? item.fec_crea.split('T')[0] : new Date().toISOString().split('T')[0];
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
			modalError = 'El nombre del proyecto es obligatorio.';
			return;
		}

		isSaving = true;
		try {
			const payload = {
				nombre: formNombre.trim(),
				codigo: formCodigo.trim() || null,
				responsable: formResponsable.trim() || null,
				direccion: formDireccion.trim() || null,
				tiem_estimado: formTiemEstimado.trim() || null,
				precio: formPrecio,
				costo_estimado: formCostoEstimado,
				descripcion: formDescripcion.trim() || null,
				link_proforma: formLinkProforma.trim() || null,
				car_tecnica: formCarTecnica,
				valor_min: formValorMin,
				valor_max: formValorMax,
				num_piso: formNumPiso,
				cod_cliente: formCodCliente,
				ususario: formUsusario.trim() || null,
				est_predio: formEstPredio.trim() || null,
				tip_proyecto: formTipProyecto.trim() || null,
				area: formArea,
				Cod_venta: formCodVenta.trim() || null,
				fec_crea: formFecCrea || new Date().toISOString().split('T')[0]
			};

			if (editingId) {
				const { error } = await supabase
					.from('proyecto')
					.update(payload)
					.eq('id', editingId);

				if (error) throw error;
				showStatus('success', `Proyecto "${formNombre}" actualizado correctamente.`);
			} else {
				const { error } = await supabase
					.from('proyecto')
					.insert([payload]);

				if (error) {
					if (error.code === '23505') throw new Error('Ya existe un proyecto con ese código único.');
					throw error;
				}
				showStatus('success', `Proyecto "${formNombre}" registrado con éxito.`);
			}

			isModalOpen = false;
			resetForm();
			await cargarProyectos();
		} catch (error: any) {
			console.error('[Proyectos Error] Error al guardar:', error);
			modalError = error.message || 'Error al guardar el registro de proyecto.';
		} finally {
			isSaving = false;
		}
	}

	async function eliminar(id: number, nombre: string) {
		if (!hasPermiso('proyectos:write')) {
			alert('No tienes permiso de escritura (proyectos:write) para eliminar proyectos.');
			return;
		}

		const confirmacion = confirm(`¿Estás seguro de que deseas eliminar el proyecto "${nombre}"?\nEsta acción no se puede deshacer.`);
		if (!confirmacion) return;

		try {
			const { error } = await supabase.from('proyecto').delete().eq('id', id);
			if (error) {
				if (error.code === '23503') throw new Error('No se puede eliminar este proyecto porque tiene registros asociados en el sistema.');
				throw error;
			}
			showStatus('success', `Proyecto "${nombre}" eliminado correctamente.`);
			isModalOpen = false;
			resetForm();
			await cargarProyectos();
		} catch (error: any) {
			console.error('[Proyectos Error] Error al eliminar:', error);
			alert(error.message || 'Error al intentar eliminar el proyecto.');
		}
	}

	onMount(async () => {
		await cargarCatalogos();
		await cargarProyectos();
	});
</script>

<svelte:head>
	<title>Catálogo de Proyectos | Construni ERP</title>
</svelte:head>

<!-- Header Principal -->
<div class="mb-6">
	<div class="text-xs text-slate-500 mb-2">Proyectos &nbsp;>&nbsp; Consultoría</div>
	<div class="flex justify-between items-center">
		<div>
			<h2 class="text-2xl font-semibold text-brand-marine">Catálogo de Proyectos</h2>
			<p class="text-sm text-slate-500 mt-1">Administra y cotiza los proyectos profesionales, técnicos y de consultoría del sistema.</p>
		</div>
		{#if hasPermiso('proyectos:write')}
			<button 
				onclick={prepararCrear}
				class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium shadow-md shadow-indigo-600/10 active:scale-[0.98] transition-all flex items-center gap-2 cursor-pointer"
			>
				<i class="fas fa-plus-circle"></i> Nuevo Proyecto
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
		<span><strong>Modo de solo lectura:</strong> No dispones del permiso de escritura (<code>proyectos:write</code>) para agregar, editar o eliminar proyectos.</span>
	</div>
{/if}

<!-- KPI Cards Grid -->
<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
		<div class="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-xl">
			<i class="fas fa-folder-open"></i>
		</div>
		<div>
			<div class="text-xs text-slate-400 font-medium">Proyectos Registrados</div>
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
			<i class="fas fa-ruler-combined"></i>
		</div>
		<div>
			<div class="text-xs text-slate-400 font-medium">Área Total</div>
			<div class="text-xl font-bold text-brand-marine mt-0.5">{kpiTotalArea.toLocaleString()} m²</div>
		</div>
	</div>
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
		<div class="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center text-xl">
			<i class="fas fa-percent"></i>
		</div>
		<div>
			<div class="text-xs text-slate-400 font-medium">Margen Promedio</div>
			<div class="text-xl font-bold text-brand-marine mt-0.5">{kpiAverageMargin.toFixed(1)}%</div>
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
				placeholder="Buscar por nombre, código o responsable..."
				class="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
			/>
		</div>
		<div>
			<select 
				bind:value={filterCliente}
				class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-slate-600"
			>
				<option value="all">Todos los Clientes</option>
				{#each clientes as cli}
					<option value={cli.id.toString()}>{cli.nombre}</option>
				{/each}
			</select>
		</div>
		<div class="flex items-center justify-end text-xs text-slate-400 font-medium">
			Mostrando {filteredProyectos.length} de {proyectos.length} registros
		</div>
	</div>

	<!-- Tabla principal -->
	{#if isLoading}
		<div class="py-12 flex justify-center text-indigo-600 text-2xl">
			<i class="fas fa-spinner fa-spin"></i>
		</div>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-sm text-left">
				<thead class="text-xs text-slate-500 bg-slate-50 font-semibold uppercase border-b border-slate-100">
					<tr>
						<th class="p-4">Código / Nombre</th>
						<th class="p-4">Cliente / Responsable</th>
						<th class="p-4 text-right">Precio de Venta</th>
						<th class="p-4 text-right">Costo Estimado</th>
						<th class="p-4 text-center">Fec. Creación / Pisos</th>
						<th class="p-4 text-center">Área (m²)</th>
						{#if hasPermiso('proyectos:write')}
							<th class="p-4 text-center">Acciones</th>
						{/if}
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each filteredProyectos as item}
						<tr class="hover:bg-slate-50 transition-colors">
							<!-- Nombre & Codigo -->
							<td class="p-4">
								<div class="text-[10px] font-bold text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5 inline-block mb-1">{item.codigo || 'SIN CÓDIGO'}</div>
								<div class="font-bold text-slate-800">{item.nombre}</div>
							</td>
							<!-- Cliente & Responsable -->
							<td class="p-4">
								<div class="text-xs font-semibold text-slate-600">{item.clientes?.nombre || 'Sin cliente asignado'}</div>
								<div class="text-[10px] text-slate-400 mt-0.5">Resp: {item.responsable || 'No especificado'}</div>
							</td>
							<!-- Precio -->
							<td class="p-4 text-right font-bold text-brand-marine">
								S/ {item.precio?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
							</td>
							<!-- Costo Estimado -->
							<td class="p-4 text-right font-semibold text-slate-500">
								S/ {item.costo_estimado?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
							</td>
							<!-- Fec Crea & Pisos -->
							<td class="p-4 text-center">
								<div class="font-bold text-slate-700">{item.fec_crea || 'N/A'}</div>
								{#if item.num_piso !== null}
									<div class="text-[9px] text-slate-400 mt-0.5">
										Pisos: {item.num_piso}
									</div>
								{/if}
							</td>
							<!-- Area -->
							<td class="p-4 text-center whitespace-nowrap">
								<span class="px-2 py-0.5 bg-slate-100 border border-slate-200/50 rounded-md text-[10px] font-semibold text-slate-500">
									{item.area || 0} m²
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
					{#if filteredProyectos.length === 0}
						<tr>
							<td colspan={hasPermiso('proyectos:write') ? 7 : 6} class="p-8 text-center text-slate-500 text-xs">
								No se encontraron proyectos registrados con los filtros aplicados.
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
			<div class="bg-gradient-to-r from-indigo-700 via-indigo-800 to-slate-900 text-white px-6 py-5 flex items-center justify-between shadow-md">
				<div class="flex items-center gap-3">
					<div class="w-10 h-10 rounded-xl bg-white/10 text-white flex items-center justify-center backdrop-blur-xs shadow-inner">
						<i class="fas {editingId ? 'fa-edit' : 'fa-plus-circle'} text-lg"></i>
					</div>
					<div>
						<h3 class="font-bold text-base leading-tight">{editingId ? 'Modificar Proyecto' : 'Registrar Nuevo Proyecto'}</h3>
						<p class="text-[11px] text-indigo-100/80 mt-0.5">Ingresa toda la información técnica, de terreno y financiera del proyecto</p>
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
					class="px-5 py-3 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer {activeTab === 'general' ? 'border-indigo-600 text-indigo-600 bg-white/50' : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'}" 
					onclick={() => activeTab = 'general'}
				>
					<i class="fas fa-info-circle text-[13px]"></i> Información General
				</button>
				<button 
					type="button" 
					class="px-5 py-3 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer {activeTab === 'finanzas' ? 'border-indigo-600 text-indigo-600 bg-white/50' : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'}" 
					onclick={() => activeTab = 'finanzas'}
				>
					<i class="fas fa-calculator text-[13px]"></i> Finanzas y Medidas
				</button>
				<button 
					type="button" 
					class="px-5 py-3 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer {activeTab === 'terreno' ? 'border-indigo-600 text-indigo-600 bg-white/50' : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'}" 
					onclick={() => activeTab = 'terreno'}
				>
					<i class="fas fa-map-marked-alt text-[13px]"></i> Terreno y Detalles
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
						<div class="bg-indigo-50/40 p-4 rounded-2xl border border-indigo-100/50 flex gap-3 mb-4">
							<i class="fas fa-info-circle text-indigo-600 text-base mt-0.5"></i>
							<div class="text-[11px] text-indigo-800/90 leading-relaxed">
								<strong>Datos Identificativos:</strong> Configura el nombre del proyecto, código técnico, cliente asociado y responsable del expediente.
							</div>
						</div>
						
						<div class="grid grid-cols-1 md:grid-cols-2 gap-5">
							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Nombre del Proyecto *</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-project-diagram"></i>
									</span>
									<input 
										type="text" 
										bind:value={formNombre} 
										placeholder="Ej. Residencia Multifamiliar Los Cedros" 
										required 
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-xs text-slate-800 placeholder-slate-400 font-medium shadow-xs" 
									/>
								</div>
							</div>

							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Código Técnico</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-tag"></i>
									</span>
									<input 
										type="text" 
										bind:value={formCodigo} 
										placeholder="Ej. PROY-001" 
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-xs text-slate-800 placeholder-slate-400 font-medium shadow-xs" 
									/>
								</div>
							</div>

							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Responsable</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-user-tie"></i>
									</span>
									<input 
										type="text" 
										bind:value={formResponsable} 
										placeholder="Ej. Ing. Guillermo Casallo" 
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-xs text-slate-800 placeholder-slate-400 font-medium shadow-xs" 
									/>
								</div>
							</div>

							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Cliente del Proyecto</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-handshake"></i>
									</span>
									<select 
										bind:value={formCodCliente} 
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-xs text-slate-800 font-medium shadow-xs cursor-pointer"
									>
										<option value={null}>-- Seleccione Cliente --</option>
										{#each clientes as cli}
											<option value={cli.id}>{cli.nombre}</option>
										{/each}
									</select>
								</div>
							</div>

							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Usuario del Registro</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-user-edit"></i>
									</span>
									<input 
										type="text" 
										bind:value={formUsusario} 
										placeholder="Ej. Admin, Misael" 
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-xs text-slate-800 placeholder-slate-400 font-medium shadow-xs" 
									/>
								</div>
							</div>

							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Código Venta Relacionada</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-file-invoice-dollar"></i>
									</span>
									<input 
										type="text" 
										bind:value={formCodVenta} 
										placeholder="Ej. VNT-5021" 
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-xs text-slate-800 placeholder-slate-400 font-medium shadow-xs" 
									/>
								</div>
							</div>

							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Fecha Creación del Proyecto</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-calendar-day"></i>
									</span>
									<input 
										type="date" 
										bind:value={formFecCrea} 
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-xs text-slate-800 font-medium shadow-xs" 
									/>
								</div>
							</div>
						</div>

						<div>
							<label class="block text-xs font-semibold text-slate-700 mb-1.5">Descripción Amplia del Proyecto</label>
							<div class="relative">
								<span class="absolute top-3 left-3.5 text-slate-400">
									<i class="fas fa-align-left"></i>
								</span>
								<textarea 
									bind:value={formDescripcion} 
									placeholder="Detalla los pormenores del proyecto, requerimientos especiales..." 
									rows="4" 
									class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-xs text-slate-800 placeholder-slate-400 font-medium shadow-xs"
								></textarea>
							</div>
						</div>
					</div>
				{/if}

				<!-- TAB 2: FINANZAS Y MEDIDAS -->
				{#if activeTab === 'finanzas'}
					<div class="space-y-5">
						<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Precio Presupuestado (S/)</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 font-bold text-xs font-mono">
										S/
									</span>
									<input 
										type="number" 
										step="0.01"
										bind:value={formPrecio} 
										placeholder="0.00"
										class="w-full pl-9 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-xs text-slate-800 font-bold shadow-xs" 
									/>
								</div>
							</div>

							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Costo Estimado (S/)</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 font-bold text-xs font-mono">
										S/
									</span>
									<input 
										type="number" 
										step="0.01"
										bind:value={formCostoEstimado} 
										placeholder="0.00"
										class="w-full pl-9 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-xs text-slate-800 font-bold shadow-xs" 
									/>
								</div>
							</div>

							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Característica Técnica Valorada (S/)</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 font-bold text-xs font-mono">
										S/
									</span>
									<input 
										type="number" 
										step="0.01"
										bind:value={formCarTecnica} 
										placeholder="0.00"
										class="w-full pl-9 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-xs text-slate-800 font-bold shadow-xs" 
									/>
								</div>
							</div>

							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Área de Trabajo (m²)</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-ruler-combined"></i>
									</span>
									<input 
										type="number" 
										step="0.01"
										bind:value={formArea} 
										placeholder="Ej. 120.50"
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-xs text-slate-800 font-semibold shadow-xs" 
									/>
								</div>
							</div>

							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Número de Pisos</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-layer-group"></i>
									</span>
									<input 
										type="number" 
										bind:value={formNumPiso} 
										placeholder="Ej. 3"
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-xs text-slate-800 font-semibold shadow-xs" 
									/>
								</div>
							</div>

							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Valor Mínimo Admisible</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-compress-arrows-alt"></i>
									</span>
									<input 
										type="number" 
										step="0.01"
										bind:value={formValorMin} 
										placeholder="Ej. 1000.00"
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-xs text-slate-800 font-medium shadow-xs" 
									/>
								</div>
							</div>

							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Valor Máximo Admisible</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-expand-arrows-alt"></i>
									</span>
									<input 
										type="number" 
										step="0.01"
										bind:value={formValorMax} 
										placeholder="Ej. 99000.00"
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-xs text-slate-800 font-medium shadow-xs" 
									/>
								</div>
							</div>

							<div class="md:col-span-2">
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Carpeta / Proforma (Google Drive)</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-link"></i>
									</span>
									<input 
										type="text" 
										bind:value={formLinkProforma} 
										placeholder="https://drive.google.com/..."
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-xs text-slate-850 placeholder-slate-400 font-medium shadow-xs" 
									/>
								</div>
							</div>
						</div>
					</div>
				{/if}

				<!-- TAB 3: TERRENO Y DETALLES -->
				{#if activeTab === 'terreno'}
					<div class="space-y-5">
						<div class="grid grid-cols-1 md:grid-cols-2 gap-5">
							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Dirección del Proyecto / Terreno</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-map-marker-alt"></i>
									</span>
									<input 
										type="text" 
										bind:value={formDireccion} 
										placeholder="Ej. Av. Los Próceres 452" 
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-xs text-slate-800 font-medium shadow-xs" 
									/>
								</div>
							</div>

							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Tiempo Estimado (Meses/Días)</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-clock"></i>
									</span>
									<input 
										type="text" 
										bind:value={formTiemEstimado} 
										placeholder="Ej. 6 meses, 90 días" 
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-xs text-slate-800 font-medium shadow-xs" 
									/>
								</div>
							</div>

							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Tipo de Proyecto</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-drafting-compass"></i>
									</span>
									<input 
										type="text" 
										bind:value={formTipProyecto} 
										placeholder="Ej. Diseño Estructural, Vivienda Familiar" 
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-xs text-slate-800 font-medium shadow-xs" 
									/>
								</div>
							</div>

							<div>
								<label class="block text-xs font-semibold text-slate-700 mb-1.5">Estado del Predio / Terreno</label>
								<div class="relative">
									<span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
										<i class="fas fa-home"></i>
									</span>
									<input 
										type="text" 
										bind:value={formEstPredio} 
										placeholder="Ej. Saneado, En Proceso de Regularización" 
										class="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-xs text-slate-800 font-medium shadow-xs" 
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
								onclick={() => { if (editingId !== null) eliminar(editingId, formNombre); }} 
								class="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition-all hover:scale-[1.02] active:scale-98 cursor-pointer flex items-center gap-1.5 shadow-sm"
							>
								<i class="fas fa-trash-alt"></i> Eliminar Proyecto
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
							class="px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-slate-800 text-white rounded-xl hover:from-indigo-700 hover:to-slate-900 text-xs font-bold shadow-md shadow-indigo-600/15 disabled:opacity-70 flex items-center gap-2 transition-all hover:scale-[1.02] active:scale-98 cursor-pointer"
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
