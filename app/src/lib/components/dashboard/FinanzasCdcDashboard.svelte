<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { formatCurrency } from '$lib/shared/fieldConfig';
	import { toast } from '$lib/stores/toast';
	import {
		getCentrosCostoProyectoOptions,
		getRendimientoPorCentroCosto,
		getGastosCorporativosGlobales,
		TIPO_PROYECTO_OPTIONS,
		type CentroCostoRendimiento
	} from '$lib/modules/dashboard-finanzas/services/dashboardFinanzas.service';
	import {
		Chart as ChartJS,
		Title,
		Tooltip,
		Legend,
		ArcElement,
		CategoryScale,
		LinearScale,
		BarElement
	} from 'chart.js';
	import { Bar, Doughnut } from 'svelte-chartjs';
	import { TrendingUp, TrendingDown, Percent, Wallet, Target, Gauge, ChartPie, ChevronUp, ChevronDown, RefreshCw, Building2 } from '@lucide/svelte';

	ChartJS.register(Title, Tooltip, Legend, ArcElement, CategoryScale, LinearScale, BarElement);

	let loading = $state(true);
	let loadError = $state('');
	let centrosOptions = $state<{ value: string; label: string }[]>([]);
	let filtroTipo = $state('');
	let filtroCentro = $state('');
	let items = $state<CentroCostoRendimiento[]>([]);
	let gastosCorporativos = $state(0);
	let sortBy = $state<keyof CentroCostoRendimiento>('flujoCajaNeto');
	let sortDir = $state<'asc' | 'desc'>('desc');

	async function loadOptions() {
		try {
			centrosOptions = await getCentrosCostoProyectoOptions(supabase);
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar los centros de costo');
		}
	}

	async function loadData() {
		loading = true;
		loadError = '';
		try {
			const [rendimiento, gastosCorp] = await Promise.all([
				getRendimientoPorCentroCosto(supabase, {
					tipoProyecto: filtroTipo || undefined,
					idCentroCosto: filtroCentro ? Number(filtroCentro) : null
				}),
				getGastosCorporativosGlobales(supabase)
			]);
			items = rendimiento;
			gastosCorporativos = gastosCorp;
		} catch (err: any) {
			loadError = err?.message ?? 'No se pudo cargar el rendimiento por centro de costo';
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		await loadOptions();
		await loadData();
	});

	function pct(v: number | null): string {
		return v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
	}

	// ── Totales agregados sobre el set filtrado ─────────────────────────────
	const totales = $derived.by(() => {
		const ingresos = items.reduce((s, i) => s + i.ingresos, 0);
		const egresos = items.reduce((s, i) => s + i.egresos, 0);
		const presupuesto = items.reduce((s, i) => s + i.presupuesto, 0);
		const flujoCajaNeto = ingresos - egresos;
		const autosuficiencia = egresos > 0 ? (ingresos / egresos) * 100 : null;
		const desviacion = egresos - presupuesto;
		const desviacionPct = presupuesto > 0 ? (desviacion / presupuesto) * 100 : null;
		const burnRate = items.reduce((s, i) => s + i.burnRate, 0);
		const burnRatePct = presupuesto > 0 ? (burnRate / presupuesto) * 100 : null;
		const roc = presupuesto > 0 ? (flujoCajaNeto / presupuesto) * 100 : null;
		const margenPositivo = items.filter((i) => i.flujoCajaNeto > 0).reduce((s, i) => s + i.flujoCajaNeto, 0);
		const coberturaCorporativa = gastosCorporativos > 0 ? (margenPositivo / gastosCorporativos) * 100 : null;
		return { ingresos, egresos, presupuesto, flujoCajaNeto, autosuficiencia, desviacion, desviacionPct, burnRate, burnRatePct, roc, margenPositivo, coberturaCorporativa };
	});

	const concentracionGlobal = $derived.by(() => {
		const map = new Map<string, number>();
		for (const item of items) {
			for (const c of item.concentracion) {
				map.set(c.categoria, (map.get(c.categoria) ?? 0) + c.monto);
			}
		}
		const total = [...map.values()].reduce((s, v) => s + v, 0);
		return [...map.entries()]
			.map(([categoria, monto]) => ({ categoria, monto, pct: total > 0 ? (monto / total) * 100 : 0 }))
			.sort((a, b) => b.monto - a.monto);
	});

	function toggleSort(field: keyof CentroCostoRendimiento) {
		if (sortBy === field) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortBy = field;
			sortDir = 'desc';
		}
	}

	const itemsOrdenados = $derived.by(() => {
		const factor = sortDir === 'asc' ? 1 : -1;
		return [...items].sort((a, b) => {
			const av = a[sortBy] as any;
			const bv = b[sortBy] as any;
			if (av === null && bv === null) return 0;
			if (av === null) return 1;
			if (bv === null) return -1;
			return av > bv ? factor : av < bv ? -factor : 0;
		});
	});

	// Top 10 por magnitud de flujo de caja neto — para no saturar el gráfico de barras.
	const topFlujo = $derived([...items].sort((a, b) => Math.abs(b.flujoCajaNeto) - Math.abs(a.flujoCajaNeto)).slice(0, 10));
	const flujoChartData = $derived({
		labels: topFlujo.map((i) => i.codigo),
		datasets: [
			{
				label: 'Flujo de Caja Neto',
				data: topFlujo.map((i) => i.flujoCajaNeto),
				backgroundColor: topFlujo.map((i) => (i.flujoCajaNeto >= 0 ? '#10b981' : '#ef4444')),
				borderRadius: 6
			}
		]
	});
	const concentracionChartData = $derived({
		labels: concentracionGlobal.map((c) => c.categoria),
		datasets: [
			{
				data: concentracionGlobal.map((c) => c.monto),
				backgroundColor: ['#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#10b981', '#64748b', '#ec4899', '#14b8a6', '#f97316', '#6366f1'],
				borderWidth: 0
			}
		]
	});

	const COL_LABELS: Record<string, string> = {
		flujoCajaNeto: 'Flujo Neto',
		autosuficiencia: 'Autosuficiencia',
		presupuesto: 'Presupuesto',
		desviacionPct: 'Desviación',
		burnRatePct: 'Burn Rate',
		roc: 'ROC'
	};
</script>

<!-- ── FILTROS ──────────────────────────────────────────────────────────── -->
<div class="flex flex-wrap items-end gap-3 mb-6 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
	<div class="flex flex-col gap-1">
		<label for="ff-tipo" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tipo de Proyecto</label>
		<select
			id="ff-tipo"
			bind:value={filtroTipo}
			onchange={loadData}
			class="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 min-w-[160px]"
		>
			<option value="">Todos</option>
			{#each TIPO_PROYECTO_OPTIONS as opt}
				<option value={opt.value}>{opt.label}</option>
			{/each}
		</select>
	</div>
	<div class="flex flex-col gap-1">
		<label for="ff-centro" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Código de Proyecto (Centro de Costo)</label>
		<select
			id="ff-centro"
			bind:value={filtroCentro}
			onchange={loadData}
			class="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 min-w-[260px]"
		>
			<option value="">Todos los proyectos</option>
			{#each centrosOptions as opt}
				<option value={opt.value}>{opt.label}</option>
			{/each}
		</select>
	</div>
	<button
		type="button"
		onclick={loadData}
		disabled={loading}
		class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
	>
		<RefreshCw size={14} class={loading ? 'animate-spin' : ''} /> Actualizar
	</button>
	<span class="text-xs text-slate-400 ml-auto">{items.length} centro{items.length === 1 ? '' : 's'} de costo en el filtro actual</span>
</div>

{#if loadError}
	<div class="mb-4 bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm">{loadError}</div>
{/if}

{#if loading}
	<div class="flex items-center justify-center py-20 text-slate-400">
		<RefreshCw size={24} class="animate-spin" />
	</div>
{:else if items.length === 0}
	<div class="text-center py-20 text-slate-400">
		<Building2 size={40} class="mx-auto mb-3 text-slate-300" />
		Sin centros de costo de proyecto para este filtro.
	</div>
{:else}
	<!-- ── KPIs DE VIABILIDAD ─────────────────────────────────────────────── -->
	<h2 class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Viabilidad por Centro de Costo</h2>
	<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
		<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
			<div class="absolute -right-4 -bottom-4 text-blue-500/10 text-7xl"><Wallet size={64} /></div>
			<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Flujo de Caja Neto</span>
			<div class={`text-2xl font-black tracking-tight mt-1 mb-1 ${totales.flujoCajaNeto >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
				{formatCurrency(totales.flujoCajaNeto)}
			</div>
			<div class="text-[11px] text-slate-400">Ingresos {formatCurrency(totales.ingresos)} − Egresos {formatCurrency(totales.egresos)}</div>
		</div>
		<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
			<div class="absolute -right-4 -bottom-4 text-purple-500/10 text-7xl"><Percent size={64} /></div>
			<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Autosuficiencia Financiera</span>
			<div class="text-2xl font-black tracking-tight mt-1 mb-1 text-purple-600">{pct(totales.autosuficiencia)}</div>
			<div class="text-[11px] text-slate-400">% de gastos cubiertos con ingresos propios</div>
		</div>
		<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
			<div class="absolute -right-4 -bottom-4 text-orange-500/10 text-7xl"><Target size={64} /></div>
			<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Margen de Contribución</span>
			<div class="text-2xl font-black tracking-tight mt-1 mb-1 text-orange-600">{formatCurrency(totales.margenPositivo)}</div>
			<div class="text-[11px] text-slate-400">
				{totales.coberturaCorporativa === null ? 'Sin gastos corporativos registrados' : `Cubre ${pct(totales.coberturaCorporativa)} de los gastos fijos corporativos (${formatCurrency(gastosCorporativos)})`}
			</div>
		</div>
	</div>

	<!-- ── KPIs DE CONTROL PRESUPUESTARIO ─────────────────────────────────── -->
	<h2 class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Control Presupuestario</h2>
	<div class="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6">
		<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
			<div class="absolute -right-4 -bottom-4 text-red-500/10 text-7xl">
				{#if totales.desviacion > 0}<TrendingUp size={64} />{:else}<TrendingDown size={64} />{/if}
			</div>
			<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Desviación de Flujo de Caja</span>
			<div class={`text-2xl font-black tracking-tight mt-1 mb-1 ${totales.desviacion > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
				{formatCurrency(totales.desviacion)} <span class="text-sm font-bold">({pct(totales.desviacionPct)})</span>
			</div>
			<div class="text-[11px] text-slate-400">Egresos reales {formatCurrency(totales.egresos)} vs. Presupuesto {formatCurrency(totales.presupuesto)}</div>
		</div>
		<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
			<div class="absolute -right-4 -bottom-4 text-amber-500/10 text-7xl"><Gauge size={64} /></div>
			<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tasa de Consumo (Burn Rate)</span>
			<div class="text-2xl font-black tracking-tight mt-1 mb-1 text-amber-600">{formatCurrency(totales.burnRate)}<span class="text-sm font-bold text-slate-400"> /mes</span></div>
			<div class="text-[11px] text-slate-400">{totales.burnRatePct === null ? 'Sin presupuesto asignado' : `${pct(totales.burnRatePct)} del presupuesto total, por mes`}</div>
		</div>
	</div>

	<!-- ── KPIs DE EFICIENCIA OPERATIVA ────────────────────────────────────── -->
	<h2 class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Eficiencia Operativa de Transacciones</h2>
	<div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
		<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
			<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Retorno de Efectivo (ROC)</span>
			<div class={`text-2xl font-black tracking-tight mt-1 mb-3 ${(totales.roc ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{pct(totales.roc)}</div>
			<p class="text-[11px] text-slate-400">Flujo de Caja Neto ÷ Presupuesto asignado. Mide cuánto efectivo genera cada sol invertido en el centro de costo.</p>
		</div>
		<div class="lg:col-span-2 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm h-72 flex flex-col">
			<div class="flex items-center gap-2 mb-2">
				<ChartPie size={16} class="text-slate-400" />
				<h3 class="font-bold text-brand-marine text-sm">Concentración de Salidas de Caja</h3>
			</div>
			<p class="text-[11px] text-slate-400 mb-2">Categoría de gasto (PCGE) con mayor peso en los egresos del filtro actual.</p>
			<div class="flex-1 min-h-0 flex justify-center items-center">
				{#if concentracionGlobal.length === 0}
					<p class="text-xs text-slate-300">Sin egresos categorizados todavía.</p>
				{:else}
					<Doughnut data={concentracionChartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } } }} />
				{/if}
			</div>
		</div>
	</div>

	<!-- ── GRÁFICO: FLUJO DE CAJA NETO POR CdC ─────────────────────────────── -->
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm h-80 flex flex-col mb-8">
		<h3 class="font-bold text-brand-marine text-sm mb-1">Flujo de Caja Neto por Centro de Costo</h3>
		<p class="text-[11px] text-slate-400 mb-3">Top {topFlujo.length} centros de costo por magnitud (positivo = superávit, negativo = déficit).</p>
		<div class="flex-1 min-h-0">
			<Bar data={flujoChartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} />
		</div>
	</div>

	<!-- ── TABLA COMPARATIVA POR CENTRO DE COSTO ───────────────────────────── -->
	<div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
		<div class="p-4 border-b border-slate-100">
			<h3 class="font-bold text-brand-marine text-sm">Rendimiento por Centro de Costo</h3>
			<p class="text-[11px] text-slate-400">Haz clic en una columna para ordenar.</p>
		</div>
		<div class="overflow-x-auto">
			<table class="w-full text-xs text-left whitespace-nowrap">
				<thead class="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wide text-[10px]">
					<tr>
						<th class="px-3 py-2.5">Proyecto</th>
						<th class="px-3 py-2.5">Tipo</th>
						{#each Object.entries(COL_LABELS) as [key, label]}
							<th class="px-3 py-2.5 text-right cursor-pointer select-none hover:text-slate-700" onclick={() => toggleSort(key as keyof CentroCostoRendimiento)}>
								<span class="inline-flex items-center gap-1">
									{label}
									{#if sortBy === key}
										{#if sortDir === 'asc'}<ChevronUp size={11} />{:else}<ChevronDown size={11} />{/if}
									{/if}
								</span>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each itemsOrdenados as item (item.id_centro_costo)}
						<tr class="hover:bg-slate-50/70">
							<td class="px-3 py-2">
								<div class="font-semibold text-slate-700">{item.codigo}</div>
								<div class="text-slate-400 text-[10px] truncate max-w-[180px]">{item.nombre_proyecto ?? item.nombre}</div>
							</td>
							<td class="px-3 py-2">
								<span class="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-medium">
									{item.tip_proyecto === 'O' ? 'Obra' : item.tip_proyecto === 'M' ? 'Mantenimiento' : '—'}
								</span>
							</td>
							<td class={`px-3 py-2 text-right font-bold ${item.flujoCajaNeto >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(item.flujoCajaNeto)}</td>
							<td class="px-3 py-2 text-right text-slate-600">{pct(item.autosuficiencia)}</td>
							<td class="px-3 py-2 text-right text-slate-600">{formatCurrency(item.presupuesto)}</td>
							<td class={`px-3 py-2 text-right font-medium ${item.desviacion > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{pct(item.desviacionPct)}</td>
							<td class="px-3 py-2 text-right text-slate-600">{pct(item.burnRatePct)}</td>
							<td class={`px-3 py-2 text-right font-medium ${(item.roc ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{pct(item.roc)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}
