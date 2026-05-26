<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import NuevaVentaModal from '$lib/components/ventas/NuevaVentaModal.svelte';

	// Svelte-ChartJS imports
	import {
		Chart as ChartJS,
		Title,
		Tooltip,
		Legend,
		ArcElement,
		CategoryScale,
		LinearScale,
		PointElement,
		LineElement,
		BarElement,
	} from 'chart.js';
	import { Doughnut, Line, Bar } from 'svelte-chartjs';

	ChartJS.register(
		Title, Tooltip, Legend, ArcElement, CategoryScale, LinearScale, PointElement, LineElement, BarElement
	);

	let { data, form } = $props();

	// Modal states
	let isModalOpen = $state(false);
	let ventaToEdit = $state<any>(null);

	// Filtros reactivos
	let filtroBusqueda = $state('');
	let filtroTipo = $state('Todos');
	let filtroAsesor = $state('Todos');
	let filtroFechaDesde = $state('');

	// Dropdown states (id de la fila que tiene abierto el menú de opciones)
	let activeMenuId = $state<number | null>(null);

	function toggleRowMenu(id: number, e: Event) {
		e.stopPropagation();
		if (activeMenuId === id) {
			activeMenuId = null;
		} else {
			activeMenuId = id;
		}
	}

	// Cerrar menús al hacer click en cualquier parte
	onMount(() => {
		const closeAll = () => {
			activeMenuId = null;
		};
		window.addEventListener('click', closeAll);
		return () => window.removeEventListener('click', closeAll);
	});

	// Filtrar las ventas dinámicamente en el cliente usando runas derived
	const ventasFiltradas = $derived(
		data.ventas.filter((v: any) => {
			// Filtro de búsqueda por nombre de proyecto o cliente
			const matchBusqueda = 
				!filtroBusqueda.trim() || 
				(v.concepto || '').toLowerCase().includes(filtroBusqueda.toLowerCase()) || 
				(v.clientes?.nombre || '').toLowerCase().includes(filtroBusqueda.toLowerCase()) ||
				(v.codigo || '').toLowerCase().includes(filtroBusqueda.toLowerCase());

			// Filtro de tipo de proyecto
			const matchTipo = filtroTipo === 'Todos' || v.tipo_proyecto === filtroTipo;

			// Filtro de asesor (extraído de comentarios)
			const parts = (v.comentarios || '').split(' | ');
			const advisorName = parts.find((p: string) => p.startsWith('Asesor:'))?.replace('Asesor: ', '') || 'Asesor';
			const matchAsesor = filtroAsesor === 'Todos' || advisorName === filtroAsesor;

			// Filtro de fecha
			const matchFecha = !filtroFechaDesde || (v.fecha_venta && v.fecha_venta >= filtroFechaDesde);

			return matchBusqueda && matchTipo && matchAsesor && matchFecha;
		})
	);

	// KPIs derivados dinámicamente del listado filtrado
	const calculated = $derived.by(() => {
		const totalVentas = ventasFiltradas.length;
		const valorTotal = ventasFiltradas.reduce((acc: number, cur: any) => acc + (cur.precio_final || 0), 0);
		const comisionTotal = ventasFiltradas.reduce((acc: number, cur: any) => acc + (cur.comision_monto || 0), 0);
		const ticketPromedio = totalVentas > 0 ? valorTotal / totalVentas : 0;
		return {
			count: totalVentas,
			valor: valorTotal,
			comision: comisionTotal,
			ticket: ticketPromedio
		};
	});

	// Limpiar todos los filtros
	function limpiarFiltros() {
		filtroBusqueda = '';
		filtroTipo = 'Todos';
		filtroAsesor = 'Todos';
		filtroFechaDesde = '';
	}

	// Abrir modal en modo creación
	function abrirNuevo() {
		ventaToEdit = null;
		isModalOpen = true;
	}

	// Abrir modal en modo edición
	function prepararEdicion(venta: any) {
		ventaToEdit = venta;
		isModalOpen = true;
		activeMenuId = null;
	}

	// Helper para extraer asesor
	function getAsesorName(comentarios: string): string {
		const parts = (comentarios || '').split(' | ');
		return parts.find((p: string) => p.startsWith('Asesor:'))?.replace('Asesor: ', '') || 'Asesor';
	}

	// Helper para extraer observaciones
	function getObservacionesText(comentarios: string): string {
		const parts = (comentarios || '').split(' | ');
		return parts.find((p: string) => p.startsWith('Obs:'))?.replace('Obs: ', '') || 'Sin observaciones adicionales.';
	}

	// Listar asesores únicos en base a los registros cargados para el dropdown del filtro
	const asesoresUnicos = $derived(
		Array.from(new Set(data.ventas.map((v: any) => getAsesorName(v.comentarios)))).sort()
	);

	// Mapeo dinámico para Gráficos
	// 1. Tipos de proyecto distribución
	const doughnutData = $derived(() => {
		const counts: Record<string, number> = { 'Obra (O)': 0, 'Consultoría (C)': 0 };
		data.ventas.forEach((v: any) => {
			if (v.tipo_proyecto === 'O') counts['Obra (O)']++;
			else if (v.tipo_proyecto === 'C') counts['Consultoría (C)']++;
		});
		return {
			labels: Object.keys(counts),
			datasets: [{
				data: Object.values(counts),
				backgroundColor: ['#3b82f6', '#10b981'],
				borderWidth: 0,
			}]
		};
	});

	// 2. Ventas por mes (acumulativo por mes de este año)
	const lineData = $derived(() => {
		const mesesMap = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
		const montos = Array(12).fill(0);
		data.ventas.forEach((v: any) => {
			if (v.fecha_venta) {
				const mesIdx = new Date(v.fecha_venta).getMonth();
				montos[mesIdx] += (v.precio_final || 0) / 1000; // En miles de soles
			}
		});
		return {
			labels: mesesMap,
			datasets: [{
				label: 'Ventas (miles de S/)',
				data: montos,
				borderColor: '#3b82f6',
				backgroundColor: 'rgba(59, 130, 246, 0.08)',
				tension: 0.4,
				fill: true
			}]
		};
	});

	// 3. Comisiones generadas por mes
	const comisionData = $derived(() => {
		const mesesMap = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
		const montos = Array(12).fill(0);
		data.ventas.forEach((v: any) => {
			if (v.fecha_venta) {
				const mesIdx = new Date(v.fecha_venta).getMonth();
				montos[mesIdx] += (v.comision_monto || 0) / 1000; // En miles de soles
			}
		});
		return {
			labels: mesesMap,
			datasets: [{
				label: 'Comisiones (miles de S/)',
				data: montos,
				borderColor: '#10b981',
				backgroundColor: 'rgba(16, 185, 129, 0.08)',
				tension: 0.4,
				fill: true
			}]
		};
	});
</script>

<svelte:head>
	<title>Ventas Cerradas | Construni ERP</title>
</svelte:head>

<!-- Top Layout Header -->
<div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
	<div>
		<div class="text-xs text-slate-500 mb-2">Módulo Comercial &nbsp;>&nbsp; Ventas</div>
		<h2 class="text-2xl font-bold text-brand-marine flex items-center gap-2">
			<i class="fas fa-chart-line text-blue-600"></i> Registro de Ventas Cerradas
		</h2>
		<p class="text-sm text-slate-500 mt-1">Monitorea los contratos cerrados, las comisiones del equipo y el estado de los proyectos.</p>
	</div>
	<div class="flex gap-2">
		<button class="px-4 py-2 border border-slate-200 rounded-xl text-slate-600 bg-white hover:bg-slate-50 text-sm font-semibold active:scale-[0.98] transition-all flex items-center gap-2 cursor-pointer">
			<i class="fas fa-file-excel text-green-600"></i> Exportar Excel
		</button>
		<button onclick={abrirNuevo} class="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-semibold shadow-md shadow-blue-600/10 active:scale-[0.98] transition-all flex items-center gap-2 cursor-pointer">
			<i class="fas fa-plus-circle"></i> Nueva venta
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
			<i class="fas fa-sack-dollar"></i>
		</div>
		<div class="w-12 h-12 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center text-xl flex-shrink-0">
			<i class="fas fa-sack-dollar"></i>
		</div>
		<div>
			<div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Ventas cerradas</div>
			<div class="text-2xl font-black text-brand-marine mt-0.5">{calculated.count}</div>
			<div class="text-[10px] text-slate-500 font-semibold">Total contratos registrados</div>
		</div>
	</div>

	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4 relative overflow-hidden group hover:shadow-md transition duration-300">
		<div class="absolute -right-4 -bottom-4 text-emerald-500/10 text-6xl group-hover:scale-110 transition duration-300">
			<i class="fas fa-hand-holding-dollar"></i>
		</div>
		<div class="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-500 flex items-center justify-center text-xl flex-shrink-0">
			<i class="fas fa-hand-holding-dollar"></i>
		</div>
		<div>
			<div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Valor total ventas</div>
			<div class="text-2xl font-black text-brand-marine mt-0.5">S/ {calculated.valor.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</div>
			<div class="text-[10px] text-emerald-600 font-bold">Acumulado bruto</div>
		</div>
	</div>

	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4 relative overflow-hidden group hover:shadow-md transition duration-300">
		<div class="absolute -right-4 -bottom-4 text-orange-500/10 text-6xl group-hover:scale-110 transition duration-300">
			<i class="fas fa-coins"></i>
		</div>
		<div class="w-12 h-12 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center text-xl flex-shrink-0">
			<i class="fas fa-coins"></i>
		</div>
		<div>
			<div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Comisión generada</div>
			<div class="text-2xl font-black text-brand-marine mt-0.5">S/ {calculated.comision.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</div>
			<div class="text-[10px] text-slate-400 font-semibold">Comisión de asesores</div>
		</div>
	</div>

	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4 relative overflow-hidden group hover:shadow-md transition duration-300">
		<div class="absolute -right-4 -bottom-4 text-purple-500/10 text-6xl group-hover:scale-110 transition duration-300">
			<i class="fas fa-calculator"></i>
		</div>
		<div class="w-12 h-12 rounded-xl bg-purple-50 text-purple-500 flex items-center justify-center text-xl flex-shrink-0">
			<i class="fas fa-calculator"></i>
		</div>
		<div>
			<div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Ticket promedio</div>
			<div class="text-2xl font-black text-brand-marine mt-0.5">S/ {calculated.ticket.toLocaleString('es-PE', { maximumFractionDigits: 0 })}</div>
			<div class="text-[10px] text-slate-400 font-semibold">Por contrato cerrado</div>
		</div>
	</div>
</div>

<!-- Main Area (Filters + List + Summary Sidebar) -->
<div class="flex flex-col lg:flex-row gap-6 mb-8">
	<!-- Main List Area -->
	<div class="flex-1 bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-6">
		<!-- Filtros Dinámicos -->
		<div class="grid grid-cols-1 md:grid-cols-5 gap-4 bg-slate-50/50 p-4 rounded-2xl border border-slate-150">
			<div class="col-span-1">
				<label class="block text-xs font-bold text-slate-500 mb-1">Buscar proyecto / cliente</label>
				<input 
					type="text" 
					bind:value={filtroBusqueda} 
					placeholder="Ej. Edificio Olivos, María..." 
					class="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl focus:ring-1 focus:ring-blue-500 outline-none" 
				/>
			</div>
			<div>
				<label class="block text-xs font-bold text-slate-500 mb-1">Tipo de proyecto</label>
				<select bind:value={filtroTipo} class="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl cursor-pointer">
					<option value="Todos">Todos</option>
					<option value="O">Obra (O)</option>
					<option value="C">Consultoría (C)</option>
				</select>
			</div>
			<div>
				<label class="block text-xs font-bold text-slate-500 mb-1">Asesor asignado</label>
				<select bind:value={filtroAsesor} class="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl cursor-pointer">
					<option value="Todos">Todos</option>
					{#each asesoresUnicos as aser}
						<option value={aser}>{aser}</option>
					{/each}
				</select>
			</div>
			<div>
				<label class="block text-xs font-bold text-slate-500 mb-1">Desde la fecha</label>
				<input 
					type="date" 
					bind:value={filtroFechaDesde} 
					class="w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl cursor-pointer" 
				/>
			</div>
			<div class="flex items-end">
				<button 
					onclick={limpiarFiltros} 
					class="w-full text-xs py-2 px-3 text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100/70 border border-blue-100 rounded-xl font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5"
				>
					<i class="fas fa-sync-alt"></i> Limpiar filtros
				</button>
			</div>
		</div>

		<!-- Table -->
		<div class="overflow-x-auto">
			<table class="w-full text-sm text-left">
				<thead class="text-xs text-slate-500 font-bold uppercase border-b border-slate-100 bg-slate-50/50">
					<tr>
						<th class="p-3">Proyecto</th>
						<th class="p-3">Valor venta</th>
						<th class="p-3 text-center">Tipo</th>
						<th class="p-3">Fecha</th>
						<th class="p-3">Asesor</th>
						<th class="p-3">Comisión</th>
						<th class="p-3 text-center">Proforma</th>
						<th class="p-3 text-center">Contrato</th>
						<th class="p-3 text-center"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each ventasFiltradas as venta (venta.id)}
						{@const advisor = getAsesorName(venta.comentarios)}
						<tr class="hover:bg-slate-50/70 transition-colors">
							<td class="p-3 font-semibold text-brand-marine">
								<div class="font-bold text-slate-800 text-xs">{venta.concepto || 'Sin nombre'}</div>
								<div class="text-[10px] text-slate-400 font-mono mt-0.5">{venta.codigo || 'S/C'}</div>
							</td>
							<td class="p-3 font-black text-slate-900">
								S/ {(venta.precio_final || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
							</td>
							<td class="p-3 text-center">
								<span class="px-2 py-0.5 font-bold rounded-lg text-[9px] border {venta.tipo_proyecto === 'O' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-green-50 text-green-600 border-green-100'}">
									{venta.tipo_proyecto === 'O' ? 'Obra (O)' : 'Consultoría (C)'}
								</span>
							</td>
							<td class="p-3 text-slate-500 text-xs whitespace-nowrap">
								{venta.fecha_venta || 'Sin fecha'}
							</td>
							<td class="p-3 whitespace-nowrap">
								<div class="flex items-center gap-1.5">
									<div class="w-5 h-5 rounded-full bg-slate-200 text-slate-600 text-[9px] flex items-center justify-center font-black">
										{advisor.charAt(0).toUpperCase()}
									</div>
									<span class="text-slate-700 text-xs font-semibold">{advisor}</span>
								</div>
							</td>
							<td class="p-3 text-xs">
								<div class="font-bold text-slate-800">S/ {(venta.comision_monto || 0).toLocaleString()}</div>
								<div class="text-[9px] text-slate-400">({venta.comision_porcentaje || 0}%)</div>
							</td>
							<td class="p-3 text-center">
								{#if venta.url_proforma}
									<a href={venta.url_proforma} target="_blank" class="text-red-500 hover:text-red-700 transition" title="Ver proforma"><i class="fas fa-file-pdf text-base"></i></a>
								{:else}
									<span class="text-slate-300" title="Sin archivo adjunto"><i class="fas fa-file-pdf text-base"></i></span>
								{/if}
							</td>
							<td class="p-3 text-center">
								{#if venta.url_contrato}
									<a href={venta.url_contrato} target="_blank" class="text-red-500 hover:text-red-700 transition" title="Ver contrato"><i class="fas fa-file-pdf text-base"></i></a>
								{:else}
									<span class="text-slate-300" title="Sin archivo adjunto"><i class="fas fa-file-pdf text-base"></i></span>
								{/if}
							</td>
							<td class="p-3 text-center relative whitespace-nowrap">
								<button 
									onclick={(e) => toggleRowMenu(venta.id, e)} 
									class="text-slate-400 hover:text-slate-700 p-1.5 hover:bg-slate-100 rounded-lg cursor-pointer transition-all"
									title="Acciones"
								>
									<i class="fas fa-ellipsis-v"></i>
								</button>
								
								<!-- Dropdown Menu -->
								{#if activeMenuId === venta.id}
									<div class="absolute right-3 top-10 bg-white border border-slate-100 rounded-xl shadow-lg py-1.5 min-w-[120px] z-30 flex flex-col text-left">
										<button 
											type="button" 
											onclick={() => prepararEdicion(venta)} 
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
												if (!confirm('¿Estás seguro de que deseas eliminar esta venta de la base de datos?\nEsta acción no se puede deshacer.')) {
													e.preventDefault();
												}
											}}
										>
											<input type="hidden" name="id" value={venta.id} />
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
							<td colspan="9" class="p-8 text-center text-slate-400 text-xs font-semibold">No se encontraron ventas que coincidan con los filtros aplicados.</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	<!-- Sidebar Resumen y Gráficos -->
	<div class="w-full lg:w-[350px] space-y-6 flex-shrink-0">
		<div class="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-5">
			<div>
				<h3 class="font-bold text-slate-800 text-sm">Resumen comercial</h3>
				<p class="text-[11px] text-slate-400 font-semibold mt-0.5">Información general del periodo</p>
			</div>

			<div class="space-y-3.5 text-xs font-semibold">
				<div class="flex justify-between items-center">
					<span class="text-slate-500 flex items-center gap-2"><i class="fas fa-hand-holding-dollar text-green-500"></i> Valor total ventas</span>
					<span class="font-black text-slate-900">S/ {calculated.valor.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</span>
				</div>
				<div class="flex justify-between items-center pb-4 border-b border-slate-100">
					<span class="text-slate-500 flex items-center gap-2"><i class="fas fa-coins text-orange-500"></i> Comisión total</span>
					<span class="font-black text-slate-900">S/ {calculated.comision.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</span>
				</div>
			</div>

			<!-- Doughnut Chart: Distribución -->
			<div>
				<h4 class="font-bold text-slate-800 text-xs mb-3">Ventas por tipo de proyecto</h4>
				<div class="h-44 flex justify-center items-center">
					<Doughnut 
						data={doughnutData()} 
						options={{ 
							responsive: true, 
							maintainAspectRatio: false, 
							plugins: { 
								legend: { 
									position: 'bottom', 
									labels: { 
										boxWidth: 8, 
										font: { size: 9, weight: 'bold' } 
									} 
								} 
							} 
						}} 
					/>
				</div>
			</div>
		</div>

		<!-- Top Asesores -->
		<div class="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
			<div>
				<h4 class="font-bold text-slate-800 text-xs">Top asesores en ventas</h4>
				<p class="text-[10px] text-slate-400 font-bold mt-0.5">Ranking acumulativo</p>
			</div>
			
			<div class="space-y-4 text-xs font-semibold">
				<div>
					<div class="flex justify-between mb-1">
						<span class="text-slate-700">1. Andrea Martinez</span>
						<span class="font-black text-slate-900">S/ 1,050,000</span>
					</div>
					<div class="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
						<div class="h-full bg-blue-500 rounded-full" style="width: 80%"></div>
					</div>
				</div>
				<div>
					<div class="flex justify-between mb-1">
						<span class="text-slate-700">2. Juan Lopez</span>
						<span class="font-black text-slate-900">S/ 950,000</span>
					</div>
					<div class="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
						<div class="h-full bg-purple-500 rounded-full" style="width: 70%"></div>
					</div>
				</div>
				<div>
					<div class="flex justify-between mb-1">
						<span class="text-slate-700">3. Maria Condori</span>
						<span class="font-black text-slate-900">S/ 570,000</span>
					</div>
					<div class="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
						<div class="h-full bg-emerald-500 rounded-full" style="width: 45%"></div>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>

<!-- Bottom Analytical Charts -->
<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
	<div class="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm h-72 flex flex-col justify-between">
		<div>
			<h4 class="font-bold text-slate-800 text-xs">Comportamiento mensual de ventas</h4>
			<p class="text-[10px] text-slate-400 font-semibold mt-0.5">Progreso acumulado mensual de ingresos en el presente periodo anual.</p>
		</div>
		<div class="flex-1 min-h-0 mt-4">
			<Line 
				data={lineData()} 
				options={{ 
					responsive: true, 
					maintainAspectRatio: false, 
					plugins: { legend: { display: false } } 
				}} 
			/>
		</div>
	</div>
	<div class="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm h-72 flex flex-col justify-between">
		<div>
			<h4 class="font-bold text-slate-800 text-xs">Comisiones mensuales liquidadas</h4>
			<p class="text-[10px] text-slate-400 font-semibold mt-0.5">Evolución de egresos por incentivos y comisiones generadas por el equipo comercial.</p>
		</div>
		<div class="flex-1 min-h-0 mt-4">
			<Line 
				data={comisionData()} 
				options={{ 
					responsive: true, 
					maintainAspectRatio: false, 
					plugins: { legend: { display: false } } 
				}} 
			/>
		</div>
	</div>
</div>

<!-- Modal Form Component -->
<NuevaVentaModal 
	isOpen={isModalOpen} 
	onClose={() => isModalOpen = false} 
	ventaToEdit={ventaToEdit} 
	empleados={data.empleados} 
	obras={data.obras || []}
	consultorias={data.consultorias || []}
/>
