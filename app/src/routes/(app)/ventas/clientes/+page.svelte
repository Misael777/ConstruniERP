<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import ClienteModal from '$lib/components/ventas/ClienteModal.svelte';

	let { data, form } = $props();

	// Modal states
	let isModalOpen = $state(false);
	let clienteToEdit = $state<any>(null);

	// Filtros reactivos
	let filtroBusqueda = $state('');

	// Dropdown state (id of active row options menu)
	let activeMenuId = $state<number | null>(null);

	function toggleRowMenu(id: number, e: Event) {
		e.stopPropagation();
		if (activeMenuId === id) {
			activeMenuId = null;
		} else {
			activeMenuId = id;
		}
	}

	onMount(() => {
		const closeAll = () => {
			activeMenuId = null;
		};
		window.addEventListener('click', closeAll);
		return () => window.removeEventListener('click', closeAll);
	});

	// Filtrar clientes usando runas derived
	const clientesFiltrados = $derived(
		data.clientes.filter((c: any) => {
			const query = filtroBusqueda.toLowerCase().trim();
			if (!query) return true;

			return (
				(c.nombre || '').toLowerCase().includes(query) ||
				(c.empresa || '').toLowerCase().includes(query) ||
				(c.dni || '').toLowerCase().includes(query) ||
				(c.ubicacion || '').toLowerCase().includes(query)
			);
		})
	);

	// KPIs derivados dinámicamente
	const calculated = $derived.by(() => {
		const total = clientesFiltrados.length;
		const corporativos = clientesFiltrados.filter((c: any) => c.empresa).length;
		const particulares = total - corporativos;
		const conContacto = clientesFiltrados.filter((c: any) => c.telefono || c.correo).length;
		const contactabilidad = total > 0 ? Math.round((conContacto / total) * 100) : 0;

		return {
			total,
			corporativos,
			particulares,
			contactabilidad
		};
	});

	function abrirNuevo() {
		clienteToEdit = null;
		isModalOpen = true;
	}

	function prepararEdicion(cliente: any) {
		clienteToEdit = cliente;
		isModalOpen = true;
		activeMenuId = null;
	}
</script>

<svelte:head>
	<title>Clientes | Construni ERP</title>
</svelte:head>

<!-- Top Layout Header -->
<div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
	<div>
		<div class="text-xs text-slate-500 mb-2">Módulo Comercial &nbsp;>&nbsp; Ventas &nbsp;>&nbsp; Clientes</div>
		<h2 class="text-2xl font-bold text-brand-marine flex items-center gap-2">
			<i class="fas fa-user-tie text-blue-600"></i> Directorio de Clientes
		</h2>
		<p class="text-sm text-slate-500 mt-1">Administra la base de datos de tus clientes, datos de contacto, facturación y ubicaciones.</p>
	</div>
	<div class="flex gap-2">
		<button class="px-4 py-2 border border-slate-200 rounded-xl text-slate-600 bg-white hover:bg-slate-50 text-sm font-semibold active:scale-[0.98] transition-all flex items-center gap-2 cursor-pointer">
			<i class="fas fa-file-excel text-green-600"></i> Exportar Excel
		</button>
		<button onclick={abrirNuevo} class="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-semibold shadow-md shadow-blue-600/10 active:scale-[0.98] transition-all flex items-center gap-2 cursor-pointer">
			<i class="fas fa-plus-circle"></i> Nuevo cliente
		</button>
	</div>
</div>

<!-- Status Form Notification -->
{#if form?.success}
	<div class="p-4 mb-6 rounded-2xl bg-green-50 border border-green-100 text-green-800 text-sm font-medium flex items-center gap-2.5 transition-all">
		<i class="fas fa-check-circle text-green-600 text-base"></i>
		{form.message || 'Operación realizada correctamente.'}
	</div>
{/if}
{#if form && !form.success}
	<div class="p-4 mb-6 rounded-2xl bg-rose-50 border border-rose-100 text-rose-800 text-sm font-medium flex items-center gap-2.5 transition-all">
		<i class="fas fa-exclamation-triangle text-rose-600 text-base"></i>
		{form.error || 'Ocurrió un error al procesar el formulario.'}
	</div>
{/if}

<!-- Dynamic KPIs Dashboard Cards -->
<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4 relative overflow-hidden group hover:shadow-md transition duration-300">
		<div class="absolute -right-4 -bottom-4 text-blue-500/10 text-6xl group-hover:scale-110 transition duration-300">
			<i class="fas fa-users"></i>
		</div>
		<div class="w-12 h-12 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center text-xl flex-shrink-0">
			<i class="fas fa-users"></i>
		</div>
		<div>
			<div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Clientes</div>
			<div class="text-2xl font-black text-brand-marine mt-0.5">{calculated.total}</div>
			<div class="text-[10px] text-slate-500 font-semibold">Registrados en la base de datos</div>
		</div>
	</div>

	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4 relative overflow-hidden group hover:shadow-md transition duration-300">
		<div class="absolute -right-4 -bottom-4 text-emerald-500/10 text-6xl group-hover:scale-110 transition duration-300">
			<i class="fas fa-building"></i>
		</div>
		<div class="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-500 flex items-center justify-center text-xl flex-shrink-0">
			<i class="fas fa-building"></i>
		</div>
		<div>
			<div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Corporativos</div>
			<div class="text-2xl font-black text-brand-marine mt-0.5">{calculated.corporativos}</div>
			<div class="text-[10px] text-emerald-600 font-bold">Empresas o Instituciones</div>
		</div>
	</div>

	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4 relative overflow-hidden group hover:shadow-md transition duration-300">
		<div class="absolute -right-4 -bottom-4 text-purple-500/10 text-6xl group-hover:scale-110 transition duration-300">
			<i class="fas fa-user"></i>
		</div>
		<div class="w-12 h-12 rounded-xl bg-purple-50 text-purple-500 flex items-center justify-center text-xl flex-shrink-0">
			<i class="fas fa-user"></i>
		</div>
		<div>
			<div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Particulares</div>
			<div class="text-2xl font-black text-brand-marine mt-0.5">{calculated.particulares}</div>
			<div class="text-[10px] text-slate-400 font-semibold">Personas naturales</div>
		</div>
	</div>

	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4 relative overflow-hidden group hover:shadow-md transition duration-300">
		<div class="absolute -right-4 -bottom-4 text-orange-500/10 text-6xl group-hover:scale-110 transition duration-300">
			<i class="fas fa-address-book"></i>
		</div>
		<div class="w-12 h-12 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center text-xl flex-shrink-0">
			<i class="fas fa-address-book"></i>
		</div>
		<div>
			<div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Contactabilidad</div>
			<div class="text-2xl font-black text-brand-marine mt-0.5">{calculated.contactabilidad}%</div>
			<div class="text-[10px] text-slate-400 font-semibold">Con teléfono o correo</div>
		</div>
	</div>
</div>

<!-- Main Area (Filters + List) -->
<div class="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-6 mb-8">
	<!-- Filtro Búsqueda -->
	<div class="grid grid-cols-1 md:grid-cols-4 gap-4 bg-slate-50/50 p-4 rounded-2xl border border-slate-150">
		<div class="col-span-1 md:col-span-3">
			<label class="block text-xs font-bold text-slate-500 mb-1">Buscar cliente</label>
			<div class="relative">
				<span class="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 pointer-events-none">
					<i class="fas fa-search"></i>
				</span>
				<input 
					type="text" 
					bind:value={filtroBusqueda} 
					placeholder="Buscar por nombre, DNI/RUC, empresa o ubicación..." 
					class="w-full text-sm pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl focus:ring-1 focus:ring-blue-500 outline-none" 
				/>
			</div>
		</div>
		<div class="flex items-end">
			<button 
				onclick={() => filtroBusqueda = ''} 
				class="w-full text-xs py-2.5 px-3 text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100/70 border border-blue-100 rounded-xl font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5"
			>
				<i class="fas fa-sync-alt"></i> Limpiar búsqueda
			</button>
		</div>
	</div>

	<!-- Table -->
	<div class="overflow-x-auto">
		<table class="w-full text-sm text-left">
			<thead class="text-xs text-slate-500 font-bold uppercase border-b border-slate-100 bg-slate-50/50">
				<tr>
					<th class="p-3">Cliente / Razón Social</th>
					<th class="p-3">DNI / RUC</th>
					<th class="p-3">Empresa</th>
					<th class="p-3">Teléfono</th>
					<th class="p-3">Correo</th>
					<th class="p-3">Ubicación / Dirección</th>
					<th class="p-3 text-center"></th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100">
				{#each clientesFiltrados as cliente (cliente.id)}
					<tr class="hover:bg-slate-50/70 transition-colors">
						<td class="p-3 font-semibold text-slate-800">
							<div class="flex items-center gap-2">
								<div class="w-7 h-7 rounded-full bg-slate-100 text-slate-600 text-xs flex items-center justify-center font-bold">
									{(cliente.nombre || 'C').charAt(0).toUpperCase()}
								</div>
								<span>{cliente.nombre || 'Sin nombre'}</span>
							</div>
						</td>
						<td class="p-3 text-slate-600 text-xs font-mono">
							{cliente.dni || '—'}
						</td>
						<td class="p-3 text-xs text-slate-600 font-semibold">
							{#if cliente.empresa}
								<span class="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-lg border border-blue-100">
									{cliente.empresa}
								</span>
							{:else}
								<span class="text-slate-400 font-normal">Particular</span>
							{/if}
						</td>
						<td class="p-3 text-slate-600 text-xs whitespace-nowrap">
							{cliente.telefono || '—'}
						</td>
						<td class="p-3 text-slate-600 text-xs">
							{cliente.correo || '—'}
						</td>
						<td class="p-3 text-slate-500 text-xs max-w-xs truncate" title={cliente.ubicacion}>
							{cliente.ubicacion || '—'}
						</td>
						<td class="p-3 text-center relative whitespace-nowrap">
							<button 
								onclick={(e) => toggleRowMenu(cliente.id, e)} 
								class="text-slate-400 hover:text-slate-700 p-1.5 hover:bg-slate-100 rounded-lg cursor-pointer transition-all"
								title="Acciones"
							>
								<i class="fas fa-ellipsis-v"></i>
							</button>
							
							<!-- Dropdown Menu -->
							{#if activeMenuId === cliente.id}
								<div class="absolute right-3 top-10 bg-white border border-slate-100 rounded-xl shadow-lg py-1.5 min-w-[120px] z-30 flex flex-col text-left">
									<button 
										type="button" 
										onclick={() => prepararEdicion(cliente)} 
										class="px-4 py-2 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-2 cursor-pointer"
									>
										<i class="fas fa-edit text-blue-500"></i> Editar
									</button>
									<form 
										method="POST" 
										action="?/delete" 
										use:enhance={() => {
											return async ({ update }) => {
												await update();
											};
										}}
										onsubmit={(e) => {
											if (!confirm('¿Estás seguro de que deseas eliminar este cliente de la base de datos?\nEsta acción no se puede deshacer.')) {
												e.preventDefault();
											}
										}}
									>
										<input type="hidden" name="id" value={cliente.id} />
										<button 
											type="submit" 
											class="w-full px-4 py-2 hover:bg-rose-50 text-xs font-semibold text-rose-600 flex items-center gap-2 cursor-pointer"
										>
											<i class="fas fa-trash-alt text-rose-500"></i> Eliminar
										</button>
									</form>
								</div>
							{/if}
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="7" class="p-8 text-center text-slate-400 text-xs font-semibold">No se encontraron clientes que coincidan con la búsqueda.</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<!-- Modal Form Component -->
<ClienteModal 
	isOpen={isModalOpen} 
	onClose={() => isModalOpen = false} 
	clienteToEdit={clienteToEdit} 
/>
