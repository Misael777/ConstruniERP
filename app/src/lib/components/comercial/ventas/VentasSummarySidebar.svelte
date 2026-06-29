<script lang="ts">
	import { Doughnut } from 'svelte-chartjs';
	import {
		Chart as ChartJS,
		Title,
		Tooltip,
		Legend,
		ArcElement,
		CategoryScale,
	} from 'chart.js';

	ChartJS.register(Title, Tooltip, Legend, ArcElement, CategoryScale);

	let {
		labels = ['Residencial', 'Comercial', 'Corporativo', 'Industrial', 'Otros'],
		tipoData = [45, 25, 15, 10, 5],
		topAsesores = [
			{ nombre: 'Andrea Martínez', ventas: 1050000, max: 1200000, color: 'bg-blue-500' },
			{ nombre: 'Juan López', ventas: 950000, max: 1200000, color: 'bg-purple-500' },
			{ nombre: 'Maria Condori', ventas: 570000, max: 1200000, color: 'bg-emerald-500' },
			{ nombre: 'Carlos Torres', ventas: 180000, max: 1200000, color: 'bg-orange-500' },
			{ nombre: 'Luis Ramirez', ventas: 100000, max: 1200000, color: 'bg-rose-500' }
		],
		valorTotal = 2850000,
		comisionTotal = 285000,
		ventasCount = 48,
		asesorCount = 5
	} = $props<{
		labels?: string[];
		tipoData?: number[];
		topAsesores?: Array<{ nombre: string; ventas: number; max: number; color: string }>;
		valorTotal?: number;
		comisionTotal?: number;
		ventasCount?: number;
		asesorCount?: number;
	}>();

	function formatMoney(amount: number) {
		return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(amount);
	}

	const chartColors = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#94a3b8'];

	function maxAsesorVentas() {
		return Math.max(...topAsesores.map((asesor: { max: number }) => asesor.max), 1);
	}

	const chartOptions = {
		responsive: true,
		maintainAspectRatio: false,
		cutout: '65%',
		plugins: {
			legend: {
				display: false
			},
			tooltip: {
				callbacks: {
					label: function(context: any) {
						return ` ${context.label}: ${context.raw}%`;
					}
				}
			}
		}
	};
</script>

<div class="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 h-full flex flex-col gap-8">
	
	<!-- Resumen -->
	<section>
		<div class="flex items-center justify-between mb-4">
			<div>
				<h3 class="text-sm font-bold text-slate-800">Resumen de ventas</h3>
				<p class="text-[10px] text-slate-400">Información general del periodo</p>
			</div>
		</div>
		
		<select class="w-full text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 mb-6">
			<option>Este año</option>
		</select>

		<div class="space-y-4">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3 text-slate-600">
					<i class="fas fa-sack-dollar text-emerald-500 w-4 text-center"></i>
					<span class="text-sm font-medium">Valor total de ventas</span>
				</div>
				<span class="text-sm font-bold text-slate-800">S/ 2,850,000.00</span>
			</div>
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3 text-slate-600">
					<i class="fas fa-hand-holding-usd text-orange-500 w-4 text-center"></i>
					<span class="text-sm font-medium">Comisión total</span>
				</div>
				<span class="text-sm font-bold text-slate-800">S/ 285,000.00</span>
			</div>
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3 text-slate-600">
					<i class="far fa-building text-blue-500 w-4 text-center"></i>
					<span class="text-sm font-medium">Proyectos vendidos</span>
				</div>
				<span class="text-sm font-bold text-slate-800">48</span>
			</div>
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3 text-slate-600">
					<i class="fas fa-user-friends text-purple-500 w-4 text-center"></i>
					<span class="text-sm font-medium">Asesores con ventas</span>
				</div>
				<span class="text-sm font-bold text-slate-800">5</span>
			</div>
		</div>
	</section>

	<div class="h-px w-full bg-slate-100"></div>

	<!-- Chart -->
	<section>
		<h3 class="text-sm font-bold text-slate-800 mb-4">Ventas por tipo de proyecto</h3>
		
		<div class="flex items-center gap-4">
			<div class="w-32 h-32 relative flex-shrink-0">
				<Doughnut data={{ labels, datasets: [{ data: tipoData, backgroundColor: chartColors, borderWidth: 2, borderColor: '#ffffff', hoverOffset: 4 }] }} options={chartOptions} />
			</div>
			
			<div class="flex-1 space-y-2">
				{#each labels as label, i}
					<div class="flex items-center justify-between text-[10px]">
						<div class="flex items-center gap-1.5">
							<div class="w-2 h-2 rounded-full" style="background-color: {chartColors[i]}"></div>
							<span class="text-slate-600">{label}</span>
						</div>
						<div class="flex items-center gap-2">
							<span class="font-medium text-slate-500">{tipoData[i]}%</span>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<div class="h-px w-full bg-slate-100"></div>

	<!-- Top Asesores -->
	<section>
		<h3 class="text-sm font-bold text-slate-800 mb-4">Top asesores por ventas</h3>
		<div class="space-y-4">
			{#each topAsesores as asesor, index}
				<div>
					<div class="flex items-center justify-between mb-1">
						<div class="flex items-center gap-2 text-xs font-semibold text-slate-700">
							<span class="w-4 text-slate-400">{index + 1}</span>
							{asesor.nombre}
						</div>
						<span class="text-xs font-bold text-slate-800">{formatMoney(asesor.ventas)}</span>
					</div>
					<div class="w-full bg-slate-100 rounded-full h-1.5 ml-6 relative overflow-hidden">
						<div class={`absolute top-0 left-0 h-full rounded-full ${asesor.color}`} style={`width: ${(asesor.ventas / maxAsesorVentas()) * 100}%`}></div>
					</div>
				</div>
			{/each}
		</div>
	</section>
</div>
