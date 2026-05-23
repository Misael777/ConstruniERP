<script lang="ts">
	import DetalleGastoPanel from '$lib/components/finanzas/DetalleGastoPanel.svelte';
	import NuevoAbonoModal from '$lib/components/finanzas/NuevoAbonoModal.svelte';
	
	import {
		Chart as ChartJS, Title, Tooltip, Legend, ArcElement, CategoryScale, LinearScale, BarElement
	} from 'chart.js';
	import { Doughnut, Bar } from 'svelte-chartjs';

	ChartJS.register(Title, Tooltip, Legend, ArcElement, CategoryScale, LinearScale, BarElement);

	let { data, form } = $props();
	
	let selectedGasto = $state<any>(null);
	let isPanelOpen = $state(false);
	let isAbonoModalOpen = $state(false);

	function openPanel(gasto: any) {
		selectedGasto = gasto;
		isPanelOpen = true;
	}

	function openAbonoModal(gasto: any) {
		selectedGasto = gasto;
		isPanelOpen = false;
		isAbonoModalOpen = true;
	}

	// Mock data for charts
	const doughnutData = {
		labels: ['Pagado', 'Parcial', 'Pendiente'],
		datasets: [{
			data: [55000, 15000, 12000],
			backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
			borderWidth: 0,
		}]
	};

	const barData = {
		labels: ['Material', 'Servicios', 'Mano de obra', 'Otros'],
		datasets: [{
			label: 'Total',
			data: [40700, 22200, 12500, 6600],
			backgroundColor: ['#3b82f6', '#8b5cf6', '#f97316', '#cbd5e1']
		}]
	};

	
	// Si la BD está vacía, usamos estos mocks de UI para el diseño
	const mockGastos = [
		{ id: 1, fecha_gasto: '05/01/2026', vencimiento: '10/01/2026', tipo: 'Material', concepto: 'Cemento', proveedor: 'Ferreteria ABC SAC', metodo: 'Transferencia', costo_final: 12000, pagado: 12000, monto_pendiente: 0, status: 'Pagada' },
		{ id: 2, fecha_gasto: '08/01/2026', vencimiento: '15/01/2026', tipo: 'Mano de obra', concepto: 'Albañiles', proveedor: 'Juan Perez', metodo: 'Efectivo', costo_final: 4500, pagado: 2000, monto_pendiente: 2500, status: 'Parcial' },
		{ id: 3, fecha_gasto: '12/01/2026', vencimiento: '20/01/2026', tipo: 'Servicios', concepto: 'Electricidad', proveedor: 'Electro Perú SAC', metodo: 'Transferencia', costo_final: 2800, pagado: 0, monto_pendiente: 2800, status: 'Pendiente' },
	];
	
	const displayGastos = data.gastos.length > 0 ? data.gastos : mockGastos;
</script>

<svelte:head>
	<title>Cuentas por Pagar | Construni ERP</title>
</svelte:head>

<div class="mb-4">
	<div class="text-xs text-slate-500 mb-2">Finanzas &nbsp;>&nbsp; Cuentas por Pagar</div>
	<div class="flex justify-between items-center">
		<div>
			<h2 class="text-2xl font-semibold text-brand-marine">Resumen de Cuentas por Pagar</h2>
			<p class="text-sm text-slate-500 mt-1">Gestiona y controla todos los pagos a proveedores, subcontratistas y trabajadores.</p>
		</div>
		<div class="flex gap-3">
			<button class="px-4 py-2 border border-slate-300 rounded-xl text-slate-600 bg-white hover:bg-slate-50 text-sm font-medium"><i class="fas fa-download"></i> Exportar</button>
			<button class="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm font-medium shadow-md"><i class="fas fa-plus"></i> Nuevo gasto</button>
		</div>
	</div>
</div>

{#if form?.success}
	<div class="bg-green-100 text-green-800 p-3 rounded-lg mb-4 text-sm font-medium flex items-center gap-2">
		<i class="fas fa-check-circle"></i> Abono registrado y saldos actualizados correctamente.
	</div>
{/if}

<!-- KPIs -->
<div class="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
	<div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
		<div class="w-12 h-12 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center text-xl"><i class="fas fa-wallet"></i></div>
		<div>
			<div class="text-xs text-slate-500">Total Egresos</div>
			<div class="text-xl font-bold text-brand-marine">S/ 82,000.00</div>
			<div class="text-[10px] text-slate-400">15 registros</div>
		</div>
	</div>
	<div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
		<div class="w-12 h-12 rounded-xl bg-green-50 text-green-500 flex items-center justify-center text-xl"><i class="fas fa-check-circle"></i></div>
		<div>
			<div class="text-xs text-slate-500">Pagado</div>
			<div class="text-xl font-bold text-brand-marine">S/ 55,000.00</div>
			<div class="text-[10px] text-slate-400">67% del total</div>
		</div>
	</div>
	<div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
		<div class="w-12 h-12 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center text-xl"><i class="fas fa-clock"></i></div>
		<div>
			<div class="text-xs text-slate-500">Pendiente</div>
			<div class="text-xl font-bold text-brand-marine">S/ 27,000.00</div>
			<div class="text-[10px] text-slate-400">33% del total</div>
		</div>
	</div>
	<div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
		<div class="w-12 h-12 rounded-xl bg-purple-50 text-purple-500 flex items-center justify-center text-xl"><i class="fas fa-file-invoice"></i></div>
		<div>
			<div class="text-xs text-slate-500">Impuestos</div>
			<div class="text-xl font-bold text-brand-marine">S/ 8,500.00</div>
			<div class="text-[10px] text-slate-400">10.37% del total</div>
		</div>
	</div>
	<div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
		<div class="w-12 h-12 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center text-xl"><i class="fas fa-users"></i></div>
		<div>
			<div class="text-xs text-slate-500">Proveedores Activos</div>
			<div class="text-xl font-bold text-brand-marine">14</div>
			<div class="text-[10px] text-slate-400">Este mes</div>
		</div>
	</div>
</div>

<!-- Main Section -->
<div class="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm mb-6">
	<!-- Filtros -->
	<div class="grid grid-cols-1 md:grid-cols-6 gap-3 mb-6">
		<div class="col-span-1">
			<label class="block text-xs text-slate-500 mb-1">Proyecto</label>
			<select class="w-full text-sm p-2 border rounded-lg bg-slate-50 outline-none"><option>Todos los proyectos</option></select>
		</div>
		<div class="col-span-1">
			<label class="block text-xs text-slate-500 mb-1">Tipo</label>
			<select class="w-full text-sm p-2 border rounded-lg bg-slate-50 outline-none"><option>Todos</option></select>
		</div>
		<div class="col-span-1">
			<label class="block text-xs text-slate-500 mb-1">Proveedor</label>
			<select class="w-full text-sm p-2 border rounded-lg bg-slate-50 outline-none"><option>Todos los proveedores</option></select>
		</div>
		<div class="col-span-1">
			<label class="block text-xs text-slate-500 mb-1">Estado</label>
			<select class="w-full text-sm p-2 border rounded-lg bg-slate-50 outline-none"><option>Todos</option></select>
		</div>
		<div class="col-span-1">
			<label class="block text-xs text-slate-500 mb-1">Fecha inicio</label>
			<input type="date" class="w-full text-sm p-2 border rounded-lg bg-slate-50 outline-none">
		</div>
		<div class="col-span-1">
			<label class="block text-xs text-slate-500 mb-1">Fecha fin</label>
			<input type="date" class="w-full text-sm p-2 border rounded-lg bg-slate-50 outline-none">
		</div>
	</div>

	<!-- Tabla -->
	<div class="overflow-x-auto mb-4">
		<table class="w-full text-sm text-left">
			<thead class="text-xs text-white bg-brand-marine font-medium">
				<tr>
					<th class="p-3 rounded-tl-lg">Fecha Gasto</th>
					<th class="p-3">Vencimiento</th>
					<th class="p-3">Tipo</th>
					<th class="p-3">Concepto</th>
					<th class="p-3">Proveedor / Trabajador</th>
					<th class="p-3">Método Pago</th>
					<th class="p-3">Costo Final</th>
					<th class="p-3">Abono</th>
					<th class="p-3">Saldo</th>
					<th class="p-3">Estado</th>
					<th class="p-3 rounded-tr-lg">Acciones</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100">
				{#each displayGastos as gasto}
					<tr class="hover:bg-slate-50 cursor-pointer transition-colors" onclick={() => openPanel(gasto)}>
						<td class="p-3">{gasto.fecha_gasto}</td>
						<td class="p-3 text-slate-500">{gasto.vencimiento || '-'}</td>
						<td class="p-3">
							<span class="px-2 py-1 rounded text-[10px] font-semibold {gasto.tipo === 'Material' ? 'bg-blue-100 text-blue-700' : gasto.tipo === 'Servicios' ? 'bg-purple-100 text-purple-700' : 'bg-orange-100 text-orange-700'}">
								{gasto.tipo || 'N/A'}
							</span>
						</td>
						<td class="p-3 font-medium">{gasto.concepto}</td>
						<td class="p-3">
							<div class="font-medium">{gasto.proveedor}</div>
							<div class="text-[10px] text-slate-400">RUC 20123456789</div>
						</td>
						<td class="p-3 text-blue-600 flex items-center gap-1"><i class="fas fa-university"></i> {gasto.metodo || 'Transf'}</td>
						<td class="p-3 font-medium">S/ {gasto.costo_final?.toLocaleString()}</td>
						<td class="p-3 text-slate-500">S/ {gasto.pagado?.toLocaleString()}</td>
						<td class="p-3 font-medium text-brand-marine">S/ {gasto.monto_pendiente?.toLocaleString()}</td>
						<td class="p-3">
							<span class="px-2 py-1 rounded text-[10px] font-semibold {gasto.status === 'Pagada' ? 'bg-green-100 text-green-700' : gasto.status === 'Pendiente' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}">
								{gasto.status}
							</span>
						</td>
						<td class="p-3 text-slate-400 hover:text-brand-marine text-center" onclick={(e) => { e.stopPropagation(); openPanel(gasto); }}>
							<i class="fas fa-ellipsis-v"></i>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<!-- Bottom Charts -->
<div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm h-64">
		<h4 class="font-semibold text-sm mb-4">Resumen por Estado</h4>
		<div class="h-40 flex justify-center">
			<Doughnut data={doughnutData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } } }} />
		</div>
	</div>
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm h-64">
		<h4 class="font-semibold text-sm mb-4">Resumen por Tipo</h4>
		<div class="h-40">
			<!-- Note: bar options indexAxis: 'y' to make it horizontal -->
			<Bar data={barData} options={{ indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} />
		</div>
	</div>
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-center">
		<h4 class="font-semibold text-sm text-slate-500 mb-1">Total general</h4>
		<div class="text-3xl font-bold text-brand-marine mb-4">S/ 82,000.00</div>
		<div class="text-xs text-slate-400 mb-6">Total de egresos</div>
		
		<div class="font-semibold text-xl mb-1">15</div>
		<div class="text-xs text-slate-400 mb-6">Total de registros</div>
		
		<div class="font-semibold text-xl mb-1">S/ 5,466.67</div>
		<div class="text-xs text-slate-400">Promedio por egreso</div>
	</div>
</div>

<!-- Overlay Components -->
<DetalleGastoPanel isOpen={isPanelOpen} gasto={selectedGasto} onClose={() => isPanelOpen = false} onAbono={openAbonoModal} />
<NuevoAbonoModal isOpen={isAbonoModalOpen} gasto={selectedGasto} onClose={() => isAbonoModalOpen = false} />
