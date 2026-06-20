<script lang="ts">
	import { Line, Bar } from 'svelte-chartjs';
	import {
		Chart as ChartJS,
		Title,
		Tooltip,
		Legend,
		LineElement,
		LinearScale,
		PointElement,
		CategoryScale,
		BarElement,
		Filler
	} from 'chart.js';

	ChartJS.register(
		Title, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale, BarElement, Filler
	);

	const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

	// 1. Ventas por mes (Line Chart with Area)
	const ventasPorMesData = {
		labels: months,
		datasets: [
			{
				label: 'Ventas',
				data: [100, 250, 450, 200, 800, 450, 300, 750, 600, 1050, 700, 950],
				fill: true,
				backgroundColor: 'rgba(59, 130, 246, 0.1)', // blue-500 with opacity
				borderColor: '#3b82f6',
				tension: 0.4,
				pointBackgroundColor: '#ffffff',
				pointBorderColor: '#3b82f6',
				pointBorderWidth: 2,
				pointRadius: 3,
				pointHoverRadius: 5
			}
		]
	};

	const lineOptions = {
		responsive: true,
		maintainAspectRatio: false,
		plugins: {
			legend: { display: false },
			tooltip: {
				callbacks: {
					label: (context: any) => `S/ ${context.raw}K`
				}
			}
		},
		scales: {
			y: {
				beginAtZero: true,
				grid: { color: '#f1f5f9', drawBorder: false },
				ticks: { callback: (value: any) => `${value}K`, font: { size: 10 }, color: '#94a3b8' }
			},
			x: {
				grid: { display: false },
				ticks: { font: { size: 10 }, color: '#94a3b8' }
			}
		}
	};

	// 2. Ventas vs Propuestas (Bar Chart Grouped)
	const ventasVsPropuestasData = {
		labels: months,
		datasets: [
			{
				label: 'Ventas',
				data: [150, 300, 400, 250, 500, 450, 300, 600, 550, 700, 500, 650],
				backgroundColor: '#3b82f6', // blue-500
				borderRadius: 2
			},
			{
				label: 'Propuestas',
				data: [300, 450, 700, 500, 800, 600, 450, 850, 750, 950, 700, 850],
				backgroundColor: '#94a3b8', // slate-400
				borderRadius: 2
			}
		]
	};

	const barOptions = {
		responsive: true,
		maintainAspectRatio: false,
		plugins: {
			legend: {
				position: 'top' as const,
				align: 'start' as const,
				labels: { boxWidth: 8, usePointStyle: true, font: { size: 11 } }
			}
		},
		scales: {
			y: {
				beginAtZero: true,
				grid: { color: '#f1f5f9', drawBorder: false },
				ticks: { callback: (value: any) => `${value}K`, font: { size: 10 }, color: '#94a3b8' }
			},
			x: {
				grid: { display: false },
				ticks: { font: { size: 10 }, color: '#94a3b8' }
			}
		}
	};

	// 3. Comisiones generadas (Line Chart with Area, Emerald)
	const comisionesData = {
		labels: months,
		datasets: [
			{
				label: 'Comisiones',
				data: [10, 25, 45, 20, 80, 45, 30, 75, 60, 105, 70, 95],
				fill: true,
				backgroundColor: 'rgba(16, 185, 129, 0.1)', // emerald-500
				borderColor: '#10b981',
				tension: 0.4,
				pointBackgroundColor: '#ffffff',
				pointBorderColor: '#10b981',
				pointBorderWidth: 2,
				pointRadius: 3,
				pointHoverRadius: 5
			}
		]
	};

	const comisionOptions = {
		...lineOptions,
		scales: {
			...lineOptions.scales,
			y: {
				beginAtZero: true,
				grid: { color: '#f1f5f9', drawBorder: false },
				ticks: { callback: (value: any) => `${value}K`, font: { size: 10 }, color: '#94a3b8' }
			}
		}
	};
</script>

<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
	<!-- Chart 1 -->
	<div class="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 h-[280px] flex flex-col">
		<h3 class="text-sm font-bold text-slate-800 mb-4">Ventas por mes</h3>
		<div class="flex-1 min-h-0 relative">
			<Line data={ventasPorMesData} options={lineOptions} />
		</div>
	</div>

	<!-- Chart 2 -->
	<div class="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 h-[280px] flex flex-col">
		<h3 class="text-sm font-bold text-slate-800 mb-2">Ventas vs Propuestas</h3>
		<div class="flex-1 min-h-0 relative">
			<Bar data={ventasVsPropuestasData} options={barOptions} />
		</div>
	</div>

	<!-- Chart 3 -->
	<div class="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 h-[280px] flex flex-col">
		<h3 class="text-sm font-bold text-slate-800 mb-4">Comisiones generadas</h3>
		<div class="flex-1 min-h-0 relative">
			<Line data={comisionesData} options={comisionOptions} />
		</div>
	</div>
</div>
