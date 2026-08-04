<script lang="ts">
	let { 
		ventasCerradas = 48,
		valorTotal = 2850000,
		comisionTotal = 285000,
		ticketPromedio = 59375,
		tasaCierre = 32
	} = $props<{ 
		ventasCerradas?: number,
		valorTotal?: number,
		comisionTotal?: number,
		ticketPromedio?: number,
		tasaCierre?: number
	}>();

	function formatMoney(amount: number) {
		return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(amount);
	}
</script>

<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
	<!-- KPI 1 -->
	<div class="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm flex items-center gap-3 transition-transform hover:-translate-y-1 hover:shadow-md">
		<div class="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
			<i class="fas fa-sack-dollar text-xl"></i>
		</div>
		<div class="min-w-0">
			<h3 class="text-xs font-semibold text-slate-500 mb-0.5">Ventas cerradas</h3>
			<p class="text-lg font-bold text-slate-800 leading-tight truncate">{ventasCerradas}</p>
			<p class="text-[10px] text-slate-400 mt-1 font-medium">Este año</p>
		</div>
	</div>

	<!-- KPI 2 -->
	<div class="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm flex items-center gap-3 transition-transform hover:-translate-y-1 hover:shadow-md">
		<div class="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0 border border-emerald-100/50">
			<i class="far fa-check-circle text-xl"></i>
		</div>
		<div class="min-w-0">
			<h3 class="text-xs font-semibold text-slate-500 mb-0.5">Valor total de ventas</h3>
			<p class="text-lg font-bold text-slate-800 leading-tight truncate">{formatMoney(valorTotal)}</p>
			<p class="text-[10px] text-slate-400 mt-1 font-medium">Este año</p>
		</div>
	</div>

	<!-- KPI 3 -->
	<div class="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm flex items-center gap-3 transition-transform hover:-translate-y-1 hover:shadow-md">
		<div class="w-10 h-10 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center flex-shrink-0">
			<i class="fas fa-hand-holding-usd text-xl"></i>
		</div>
		<div class="min-w-0">
			<h3 class="text-xs font-semibold text-slate-500 mb-0.5">Comisión total</h3>
			<p class="text-lg font-bold text-slate-800 leading-tight truncate">{formatMoney(comisionTotal)}</p>
			<p class="text-[10px] text-slate-400 mt-1 font-medium">10% del valor total</p>
		</div>
	</div>

	<!-- KPI 4 -->
	<div class="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm flex items-center gap-3 transition-transform hover:-translate-y-1 hover:shadow-md">
		<div class="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center flex-shrink-0">
			<i class="fas fa-file-invoice-dollar text-xl"></i>
		</div>
		<div class="min-w-0">
			<h3 class="text-xs font-semibold text-slate-500 mb-0.5">Ticket promedio</h3>
			<p class="text-lg font-bold text-slate-800 leading-tight truncate">{formatMoney(ticketPromedio)}</p>
			<p class="text-[10px] text-slate-400 mt-1 font-medium">Por venta</p>
		</div>
	</div>

	<!-- KPI 5 -->
	<div class="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm flex items-center gap-3 transition-transform hover:-translate-y-1 hover:shadow-md">
		<div class="w-10 h-10 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center flex-shrink-0">
			<i class="fas fa-chart-line text-xl"></i>
		</div>
		<div class="min-w-0">
			<h3 class="text-xs font-semibold text-slate-500 mb-0.5">Tasa de cierre</h3>
			<p class="text-lg font-bold text-slate-800 leading-tight truncate">{tasaCierre}%</p>
			<p class="text-[10px] text-slate-400 mt-1 font-medium">De propuestas</p>
		</div>
	</div>
</div>
