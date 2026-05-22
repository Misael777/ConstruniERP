<script lang="ts">
	import Topbar from '$lib/components/layout/Topbar.svelte';
	import NuevaVentaModal from '$lib/components/ventas/NuevaVentaModal.svelte';
	import { enhance } from '$app/forms';

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
	
	// Estado del Modal
	let isModalOpen = $state(false);

	// Datos ficticios (mock) basados en las imágenes para Gráficos
	const doughnutData = {
		labels: ['Residencial', 'Comercial', 'Corporativo', 'Industrial', 'Otros'],
		datasets: [{
			data: [45, 25, 15, 10, 5],
			backgroundColor: ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#64748b'],
			borderWidth: 0,
		}]
	};

	const lineData = {
		labels: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
		datasets: [{
			label: 'Ventas por mes',
			data: [200, 300, 250, 450, 600, 500, 400, 550, 700, 600, 500, 650],
			borderColor: '#3b82f6',
			backgroundColor: 'rgba(59, 130, 246, 0.1)',
			tension: 0.4,
			fill: true
		}]
	};

	const barData = {
		labels: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
		datasets: [
			{
				label: 'Ventas',
				data: [150, 250, 200, 400, 500, 450, 350, 500, 600, 550, 450, 550],
				backgroundColor: '#3b82f6'
			},
			{
				label: 'Propuestas',
				data: [300, 400, 350, 600, 700, 650, 500, 700, 800, 750, 600, 800],
				backgroundColor: '#cbd5e1'
			}
		]
	};

	const comisionData = {
		labels: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
		datasets: [{
			label: 'Comisiones generadas',
			data: [20, 30, 25, 45, 60, 50, 40, 55, 70, 60, 50, 65],
			borderColor: '#10b981',
			backgroundColor: 'rgba(16, 185, 129, 0.1)',
			tension: 0.4,
			fill: true
		}]
	};
</script>

<svelte:head>
	<title>Ventas Cerradas | Construni ERP</title>
</svelte:head>

<div class="flex justify-between items-center mb-6">
	<div>
		<h2 class="text-2xl font-semibold text-brand-marine flex items-center gap-2">
			<button class="text-slate-400 hover:text-brand-marine"><i class="fas fa-arrow-left"></i></button>
			Venta cerrada
		</h2>
		<p class="text-sm text-slate-500 mt-1">Consulta y administra todas tus ventas cerradas.</p>
	</div>
	<div class="flex gap-3">
		<button class="px-4 py-2 border border-slate-300 rounded-xl text-slate-600 bg-white hover:bg-slate-50 text-sm font-medium transition flex items-center gap-2">
			<i class="fas fa-download"></i> Exportar
		</button>
		<button onclick={() => isModalOpen = true} class="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-medium shadow-md transition flex items-center gap-2">
			<i class="fas fa-plus"></i> Nueva venta
		</button>
	</div>
</div>

{#if form?.success}
	<div class="bg-green-100 text-green-800 p-4 rounded-xl mb-6 flex items-center gap-2">
		<i class="fas fa-check-circle"></i> Venta registrada correctamente.
	</div>
{/if}

<!-- KPIs -->
<div class="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
	<div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
		<div class="w-12 h-12 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center text-xl">
			<i class="fas fa-sack-dollar"></i>
		</div>
		<div>
			<div class="text-xs text-slate-500">Ventas cerradas</div>
			<div class="text-xl font-bold text-brand-marine">48</div>
			<div class="text-[10px] text-slate-400">Este año</div>
		</div>
	</div>
	<div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
		<div class="w-12 h-12 rounded-xl bg-green-50 text-green-500 flex items-center justify-center text-xl">
			<i class="fas fa-check-circle"></i>
		</div>
		<div>
			<div class="text-xs text-slate-500">Valor total de ventas</div>
			<div class="text-xl font-bold text-brand-marine">S/ 2,850,000.00</div>
			<div class="text-[10px] text-slate-400">Este año</div>
		</div>
	</div>
	<div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
		<div class="w-12 h-12 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center text-xl">
			<i class="fas fa-coins"></i>
		</div>
		<div>
			<div class="text-xs text-slate-500">Comisión total</div>
			<div class="text-xl font-bold text-brand-marine">S/ 285,000.00</div>
			<div class="text-[10px] text-slate-400">10% del valor total</div>
		</div>
	</div>
	<div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
		<div class="w-12 h-12 rounded-xl bg-purple-50 text-purple-500 flex items-center justify-center text-xl">
			<i class="fas fa-file-invoice-dollar"></i>
		</div>
		<div>
			<div class="text-xs text-slate-500">Ticket promedio</div>
			<div class="text-xl font-bold text-brand-marine">S/ 59,375.00</div>
			<div class="text-[10px] text-slate-400">Por venta</div>
		</div>
	</div>
	<div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
		<div class="w-12 h-12 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center text-xl">
			<i class="fas fa-chart-line"></i>
		</div>
		<div>
			<div class="text-xs text-slate-500">Tasa de cierre</div>
			<div class="text-xl font-bold text-brand-marine">32%</div>
			<div class="text-[10px] text-slate-400">De propuestas</div>
		</div>
	</div>
</div>

<div class="flex flex-col lg:flex-row gap-6 mb-6">
	<!-- Main Table Area -->
	<div class="flex-1 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
		<!-- Filtros -->
		<div class="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
			<div>
				<label class="block text-xs text-slate-500 mb-1">Proyecto</label>
				<select class="w-full text-sm p-2 border rounded-lg bg-slate-50 text-slate-600"><option>Todos los proyectos</option></select>
			</div>
			<div>
				<label class="block text-xs text-slate-500 mb-1">Tipo proyecto</label>
				<select class="w-full text-sm p-2 border rounded-lg bg-slate-50 text-slate-600"><option>Todos</option></select>
			</div>
			<div>
				<label class="block text-xs text-slate-500 mb-1">Asesor</label>
				<select class="w-full text-sm p-2 border rounded-lg bg-slate-50 text-slate-600"><option>Todos</option></select>
			</div>
			<div>
				<label class="block text-xs text-slate-500 mb-1">Fecha desde</label>
				<input type="date" class="w-full text-sm p-2 border rounded-lg bg-slate-50 text-slate-600">
			</div>
			<div class="flex items-end">
				<button class="w-full text-sm p-2 text-blue-600 font-medium hover:bg-blue-50 rounded-lg transition"><i class="fas fa-sync-alt"></i> Limpiar filtros</button>
			</div>
		</div>

		<!-- Table -->
		<div class="overflow-x-auto">
			<table class="w-full text-sm text-left">
				<thead class="text-xs text-slate-500 font-semibold border-b border-slate-200">
					<tr>
						<th class="pb-3 px-2">Proyecto</th>
						<th class="pb-3 px-2">Valor venta</th>
						<th class="pb-3 px-2">Tipo proyecto</th>
						<th class="pb-3 px-2">Fecha</th>
						<th class="pb-3 px-2">Asesor</th>
						<th class="pb-3 px-2">Comisión</th>
						<th class="pb-3 px-2 text-center">Proforma</th>
						<th class="pb-3 px-2 text-center">Contrato</th>
						<th class="pb-3 px-2"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					<!-- Datos reales mapeados (si existen) o datos quemados de UI -->
					{#each data.ventas as venta}
						<tr class="hover:bg-slate-50">
							<td class="py-4 px-2 font-medium text-brand-marine">{venta.concepto || 'Sin nombre'}</td>
							<td class="py-4 px-2 font-semibold">S/ {venta.precio_final?.toLocaleString() || '0.00'}</td>
							<td class="py-4 px-2"><span class="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-md">{venta.tipo_proyecto || 'N/A'}</span></td>
							<td class="py-4 px-2 text-slate-500">{venta.fecha_venta}</td>
							<td class="py-4 px-2 flex items-center gap-2">
								<div class="w-6 h-6 rounded-full bg-slate-200 text-[10px] flex items-center justify-center font-bold">AS</div>
								<span class="text-slate-600 truncate max-w-[100px]">{venta.comentarios?.split('|')[0] || 'Asesor'}</span>
							</td>
							<td class="py-4 px-2">
								<div class="font-semibold">S/ {venta.comision_monto?.toLocaleString() || '0.00'}</div>
								<div class="text-[10px] text-slate-400">({venta.comision_porcentaje || 0}%)</div>
							</td>
							<td class="py-4 px-2 text-center text-red-500"><i class="fas fa-file-pdf text-lg cursor-pointer"></i></td>
							<td class="py-4 px-2 text-center text-red-500"><i class="fas fa-file-pdf text-lg cursor-pointer"></i></td>
							<td class="py-4 px-2 text-slate-400 cursor-pointer text-center hover:text-brand-marine"><i class="fas fa-ellipsis-v"></i></td>
						</tr>
					{/each}
					<!-- Fila de ejemplo 1 -->
					<tr class="hover:bg-slate-50">
						<td class="py-4 px-2 font-medium text-brand-marine">Edificio Residencial Los Olivos</td>
						<td class="py-4 px-2 font-semibold">S/ 350,000.00</td>
						<td class="py-4 px-2"><span class="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-md">Residencial</span></td>
						<td class="py-4 px-2 text-slate-500">05/01/2026</td>
						<td class="py-4 px-2 flex items-center gap-2">
							<div class="w-6 h-6 rounded-full bg-brand-marine text-white text-[10px] flex items-center justify-center font-bold">AM</div>
							<span class="text-slate-600">Andrea M.</span>
						</td>
						<td class="py-4 px-2">
							<div class="font-semibold">S/ 35,000.00</div>
							<div class="text-[10px] text-slate-400">(10%)</div>
						</td>
						<td class="py-4 px-2 text-center text-red-500"><i class="fas fa-file-pdf text-lg cursor-pointer"></i></td>
						<td class="py-4 px-2 text-center text-red-500"><i class="fas fa-file-pdf text-lg cursor-pointer"></i></td>
						<td class="py-4 px-2 text-slate-400 cursor-pointer text-center hover:text-brand-marine"><i class="fas fa-ellipsis-v"></i></td>
					</tr>
				</tbody>
			</table>
		</div>
	</div>

	<!-- Sidebar Resumen -->
	<div class="w-full lg:w-[350px] bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
		<h3 class="font-bold text-brand-marine mb-1">Resumen de ventas</h3>
		<p class="text-xs text-slate-500 mb-6">Información general del periodo</p>

		<div class="flex justify-between text-sm mb-4">
			<span class="text-slate-500 flex items-center gap-2"><i class="fas fa-sack-dollar text-green-500"></i> Valor total ventas</span>
			<span class="font-bold">S/ 2,850,000.00</span>
		</div>
		<div class="flex justify-between text-sm mb-4 border-b border-slate-100 pb-4">
			<span class="text-slate-500 flex items-center gap-2"><i class="fas fa-coins text-orange-500"></i> Comisión total</span>
			<span class="font-bold">S/ 285,000.00</span>
		</div>

		<h4 class="font-semibold text-sm mb-4">Ventas por tipo de proyecto</h4>
		<div class="h-40 mb-6 flex justify-center">
			<Doughnut data={doughnutData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } } }} />
		</div>

		<h4 class="font-semibold text-sm mb-4">Top asesores por ventas</h4>
		<div class="space-y-4 text-xs">
			<div>
				<div class="flex justify-between mb-1"><span>1. Andrea Martinez</span><span class="font-bold">S/ 1,050,000</span></div>
				<div class="h-1.5 w-full bg-slate-100 rounded-full"><div class="h-full bg-blue-500 rounded-full" style="width: 80%"></div></div>
			</div>
			<div>
				<div class="flex justify-between mb-1"><span>2. Juan Lopez</span><span class="font-bold">S/ 950,000</span></div>
				<div class="h-1.5 w-full bg-slate-100 rounded-full"><div class="h-full bg-purple-500 rounded-full" style="width: 70%"></div></div>
			</div>
			<div>
				<div class="flex justify-between mb-1"><span>3. Maria Condori</span><span class="font-bold">S/ 570,000</span></div>
				<div class="h-1.5 w-full bg-slate-100 rounded-full"><div class="h-full bg-green-500 rounded-full" style="width: 45%"></div></div>
			</div>
		</div>
	</div>
</div>

<!-- Bottom Charts -->
<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm h-64">
		<h4 class="font-semibold text-sm mb-2">Ventas por mes</h4>
		<Line data={lineData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} />
	</div>
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm h-64">
		<h4 class="font-semibold text-sm mb-2">Ventas vs Propuestas</h4>
		<Bar data={barData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } } } }} />
	</div>
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm h-64">
		<h4 class="font-semibold text-sm mb-2">Comisiones generadas</h4>
		<Line data={comisionData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} />
	</div>
</div>

<!-- Modal -->
<NuevaVentaModal isOpen={isModalOpen} onClose={() => isModalOpen = false} />
