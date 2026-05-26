<script lang="ts">
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

	let { data } = $props();
	
	const { kpis, charts, recientes } = $derived(data);

	// Configuración del gráfico de Línea (Ingresos vs Egresos)
	const lineData = $derived({
		labels: charts.labels,
		datasets: [
			{
				label: 'Ingresos (Ventas)',
				data: charts.ventas,
				borderColor: '#10b981',
				backgroundColor: 'rgba(16, 185, 129, 0.1)',
				tension: 0.4,
				fill: true
			},
			{
				label: 'Egresos (Gastos)',
				data: charts.gastos,
				borderColor: '#ef4444',
				backgroundColor: 'rgba(239, 68, 68, 0.1)',
				tension: 0.4,
				fill: true
			}
		]
	});

	// Configuración del gráfico de Doughnut (Distribución por Tipo)
	const doughnutData = $derived({
		labels: charts.tiposProyectoLabels,
		datasets: [{
			data: charts.tiposProyectoData,
			backgroundColor: ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#64748b'],
			borderWidth: 0,
		}]
	});

	// Configuración del gráfico de Barras (Utilidad Mensual)
	const barData = $derived({
		labels: charts.labels,
		datasets: [
			{
				label: 'Ganancia / Margen',
				data: charts.ventas.map((v, i) => v - charts.gastos[i]),
				backgroundColor: '#3b82f6',
				borderRadius: 8,
			}
		]
	});
</script>

<svelte:head>
	<title>Dashboard | Construni ERP</title>
</svelte:head>

<!-- Topbar header -->
<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
	<div>
		<h1 class="text-2xl font-bold text-brand-marine flex items-center gap-2">
			<i class="fas fa-chart-line text-blue-600"></i> Panel de Control General
		</h1>
		<p class="text-sm text-slate-500 mt-1">Resumen del estado operativo, financiero y comercial de Construni.</p>
	</div>
	
	<div class="flex items-center gap-3">
		<span class="text-xs bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full font-bold border border-blue-100 flex items-center gap-1.5">
			<span class="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
			Sincronizado con Supabase
		</span>
	</div>
</div>

<!-- KPIs Grid -->
<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
	<!-- KPI 1: Facturación -->
	<a href="/ventas" class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden group hover:shadow-md transition duration-300 block">
		<div class="absolute -right-4 -bottom-4 text-blue-500/10 text-7xl transition-transform duration-300 group-hover:scale-110">
			<i class="fas fa-file-invoice-dollar"></i>
		</div>
		<div class="flex justify-between items-start mb-2">
			<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Facturación Total</span>
			<span class="px-2.5 py-1 bg-blue-50 text-blue-600 text-[10px] font-bold rounded-lg">{kpis.ventasCount} Ventas</span>
		</div>
		<div class="text-2xl font-black text-brand-marine tracking-tight mb-1">
			S/ {kpis.totalVentasValor.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
		</div>
		<div class="text-[11px] text-slate-400 font-medium">
			Valor total acumulado en contratos
		</div>
	</a>

	<!-- KPI 2: Cobros -->
	<a href="/finanzas/cuentas-por-cobrar" class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden group hover:shadow-md transition duration-300 block">
		<div class="absolute -right-4 -bottom-4 text-emerald-500/10 text-7xl transition-transform duration-300 group-hover:scale-110">
			<i class="fas fa-hand-holding-dollar"></i>
		</div>
		<div class="flex justify-between items-start mb-2">
			<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Monto Cobrado</span>
			<span class="px-2.5 py-1 bg-emerald-50 text-emerald-600 text-[10px] font-bold rounded-lg">
				{((kpis.totalVentasCobradas / (kpis.totalVentasValor || 1)) * 100).toFixed(0)}% Efectivo
			</span>
		</div>
		<div class="text-2xl font-black text-emerald-600 tracking-tight mb-1">
			S/ {kpis.totalVentasCobradas.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
		</div>
		<div class="text-[11px] text-slate-400 font-medium flex justify-between">
			<span>Pendiente: S/ {kpis.cuentasPorCobrar.toLocaleString('es-PE')}</span>
		</div>
	</a>

	<!-- KPI 3: Egresos -->
	<a href="/finanzas/cuentas-por-pagar" class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden group hover:shadow-md transition duration-300 block">
		<div class="absolute -right-4 -bottom-4 text-red-500/10 text-7xl transition-transform duration-300 group-hover:scale-110">
			<i class="fas fa-receipt"></i>
		</div>
		<div class="flex justify-between items-start mb-2">
			<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Egresos Totales</span>
			<span class="px-2.5 py-1 bg-red-50 text-red-600 text-[10px] font-bold rounded-lg">Gastos Registrados</span>
		</div>
		<div class="text-2xl font-black text-brand-marine tracking-tight mb-1">
			S/ {kpis.totalGastosValor.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
		</div>
		<div class="text-[11px] text-slate-400 font-medium flex justify-between">
			<span>Pagado: S/ {kpis.totalGastosPagados.toLocaleString('es-PE')}</span>
			<span class="text-red-500 font-bold">Por pagar: S/ {kpis.cuentasPorPagar.toLocaleString('es-PE')}</span>
		</div>
	</a>

	<!-- KPI 4: Utilidad Estimada -->
	<a href="/finanzas/reportes" class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden group hover:shadow-md transition duration-300 block">
		<div class="absolute -right-4 -bottom-4 text-orange-500/10 text-7xl transition-transform duration-300 group-hover:scale-110">
			<i class="fas fa-piggy-bank"></i>
		</div>
		<div class="flex justify-between items-start mb-2">
			<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Utilidad Neta</span>
			<span class="px-2.5 py-1 bg-orange-50 text-orange-600 text-[10px] font-bold rounded-lg">Margen Bruto</span>
		</div>
		<div class="text-2xl font-black text-orange-600 tracking-tight mb-1">
			S/ {kpis.gananciaNeta.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
		</div>
		<div class="text-[11px] text-slate-400 font-medium">
			Diferencia entre contratos facturados y costos
		</div>
	</a>
</div>

<!-- Secondary Metrics Bar -->
<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
	<a href="/iam" class="bg-slate-100 p-4 rounded-xl flex items-center justify-between border border-slate-200/50 hover:bg-slate-200/60 transition block">
		<span class="text-xs font-semibold text-slate-600">Personal Activo:</span>
		<span class="text-sm font-bold text-brand-marine">{kpis.empleadosCount} empleados</span>
	</a>
	<a href="/proyectos/obras" class="bg-slate-100 p-4 rounded-xl flex items-center justify-between border border-slate-200/50 hover:bg-slate-200/60 transition block">
		<span class="text-xs font-semibold text-slate-600">Obras en Catálogo:</span>
		<span class="text-sm font-bold text-brand-marine">{kpis.obrasCount} registradas</span>
	</a>
	<a href="/proyectos/consultorias" class="bg-slate-100 p-4 rounded-xl flex items-center justify-between border border-slate-200/50 hover:bg-slate-200/60 transition block">
		<span class="text-xs font-semibold text-slate-600">Servicios Consultoría:</span>
		<span class="text-sm font-bold text-brand-marine">{kpis.consultoriasCount} activos</span>
	</a>
	<a href="/ventas" class="bg-slate-100 p-4 rounded-xl flex items-center justify-between border border-slate-200/50 hover:bg-slate-200/60 transition block">
		<span class="text-xs font-semibold text-slate-600">Proyectos Activos:</span>
		<span class="text-sm font-bold text-blue-600">{kpis.ventasCount} en ejecución</span>
	</a>
</div>

<!-- Charts Section -->
<div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
	<!-- Flujo de Caja (Ingresos vs Egresos) -->
	<div class="lg:col-span-2 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm h-96 flex flex-col">
		<div class="flex justify-between items-center mb-4">
			<div>
				<h3 class="font-bold text-brand-marine">Flujo de Caja Mensual</h3>
				<p class="text-xs text-slate-500">Comparativa mensual de ingresos (ventas) frente a egresos (gastos).</p>
			</div>
		</div>
		<div class="flex-1 min-h-0">
			<Line data={lineData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11, weight: 'bold' } } } } }} />
		</div>
	</div>

	<!-- Distribución de Proyectos -->
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm h-96 flex flex-col">
		<div>
			<h3 class="font-bold text-brand-marine">Tipos de Proyectos</h3>
			<p class="text-xs text-slate-500 mb-4">Distribución del número de obras o consultorías por categoría.</p>
		</div>
		<div class="flex-1 min-h-0 flex justify-center items-center">
			<Doughnut data={doughnutData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } } }} />
		</div>
	</div>
</div>

<!-- Bottom Row: Tables and Shortcuts -->
<div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
	<!-- Recent Sales Table -->
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm xl:col-span-2">
		<div class="flex justify-between items-center mb-4">
			<div>
				<h3 class="font-bold text-brand-marine">Últimas Ventas y Proyectos</h3>
				<p class="text-xs text-slate-500">Últimos contratos firmados registrados en la base de datos.</p>
			</div>
			<a href="/ventas" class="text-xs text-blue-600 font-bold hover:underline">Ver todo</a>
		</div>

		<div class="overflow-x-auto">
			<table class="w-full text-xs text-left">
				<thead class="text-slate-500 font-semibold border-b border-slate-100">
					<tr>
						<th class="pb-2 px-2">Concepto</th>
						<th class="pb-2 px-2">Tipo</th>
						<th class="pb-2 px-2">Fecha</th>
						<th class="pb-2 px-2 text-right">Valor Venta</th>
						<th class="pb-2 px-2 text-center">Estado</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-50">
					{#each recientes.ventas as venta}
						<tr class="hover:bg-slate-50 transition">
							<td class="py-3 px-2 font-semibold text-brand-marine">{venta.concepto || 'Venta General'}</td>
							<td class="py-3 px-2">
								<span class="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-md font-medium text-[10px]">
									{venta.tipo_proyecto || 'N/A'}
								</span>
							</td>
							<td class="py-3 px-2 text-slate-500">{venta.fecha_venta || 'Reciente'}</td>
							<td class="py-3 px-2 text-right font-bold text-slate-800">
								S/ {(venta.precio_final || 0).toLocaleString()}
							</td>
							<td class="py-3 px-2 text-center">
								<span class="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full font-bold text-[10px]">
									Activo
								</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	<!-- Quick Actions & Access -->
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between">
		<div>
			<h3 class="font-bold text-brand-marine mb-1">Accesos Rápidos</h3>
			<p class="text-xs text-slate-500 mb-6">Atajos directos para gestionar y registrar en los módulos.</p>
			
			<div class="grid grid-cols-2 gap-3">
				<a href="/ventas" class="p-3 bg-blue-50 text-blue-700 rounded-xl hover:bg-blue-100 transition text-center flex flex-col items-center justify-center gap-2 group">
					<i class="fas fa-shopping-cart text-lg group-hover:scale-110 transition"></i>
					<span class="text-xs font-bold">Módulo Ventas</span>
				</a>
				
				<a href="/finanzas" class="p-3 bg-emerald-50 text-emerald-700 rounded-xl hover:bg-emerald-100 transition text-center flex flex-col items-center justify-center gap-2 group">
					<i class="fas fa-wallet text-lg group-hover:scale-110 transition"></i>
					<span class="text-xs font-bold">Módulo Finanzas</span>
				</a>
				
				<a href="/iam" class="p-3 bg-purple-50 text-purple-700 rounded-xl hover:bg-purple-100 transition text-center flex flex-col items-center justify-center gap-2 group">
					<i class="fas fa-users-cog text-lg group-hover:scale-110 transition"></i>
					<span class="text-xs font-bold">Control Accesos</span>
				</a>
				
				<a href="/proyectos" class="p-3 bg-orange-50 text-orange-700 rounded-xl hover:bg-orange-100 transition text-center flex flex-col items-center justify-center gap-2 group cursor-pointer">
					<i class="fas fa-city text-lg group-hover:scale-110 transition"></i>
					<span class="text-xs font-bold">Proyectos (Catálogos)</span>
				</a>
			</div>
		</div>

		<div class="mt-6 pt-4 border-t border-slate-100">
			<div class="bg-slate-50 p-3 rounded-xl flex items-center justify-between text-xs">
				<div class="flex items-center gap-2 text-slate-600">
					<i class="fas fa-info-circle text-blue-500"></i>
					<span>¿Necesitas reportes avanzados?</span>
				</div>
				<a href="/finanzas/reportes" class="text-blue-600 font-bold hover:underline">Ir a Reportes</a>
			</div>
		</div>
	</div>
</div>
