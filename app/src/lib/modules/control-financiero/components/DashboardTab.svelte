<script lang="ts">
	import { onMount } from 'svelte';
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
		BarElement
	} from 'chart.js';
	import { Line, Bar, Doughnut } from 'svelte-chartjs';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { permisosState } from '$lib/stores/permisos.svelte';
	import { formatCurrency } from '$lib/shared/fieldConfig';
	import NodeGraph from '$lib/components/dashboard/NodeGraph.svelte';
	import {
		getCentrosCostoOptions,
		getRendimientoPorCentroCosto,
		getGastosCorporativosGlobales,
		getFlujoDeNodos,
		getResumenGeneral,
		getSerieMensualFlujoCaja,
		getProyeccionFutura,
		TIPO_CENTRO_COSTO_OPTIONS,
		TIPO_CENTRO_COSTO_LABELS,
		type CentroCostoRendimiento,
		type FlujoDeNodos,
		type ResumenGeneralDashboard,
		type SerieMensualFlujoCaja,
		type ProyeccionFutura
	} from '$lib/modules/dashboard-finanzas/services/dashboardFinanzas.service';
	import { getSaldoTotalCentrosCosto, getSaldoTotalCuentasBancarias, getConciliacionesPendientesCount } from '../services/conciliacion.service';
	import { getIncidenciasAbiertasCount } from '../services/incidencia.service';
	import { ejecutarRevision, getUltimaRevision, type RevisionFinanciera } from '../services/controlFinanciero.service';
	import { getTrayectoriaCentrosCosto, getTrayectoriaCuentasBancarias, type TrayectoriaResultado } from '../services/trayectoria.service';
	import {
		TrendingUp,
		TrendingDown,
		Percent,
		Wallet,
		Target,
		Gauge,
		ChartPie,
		ChevronUp,
		ChevronDown,
		RefreshCw,
		Building2,
		Waypoints,
		Users,
		LineChart as LineChartIcon,
		ShieldCheck,
		ShieldAlert,
		ShieldQuestion,
		Landmark,
		ScrollText,
		AlertCircle
	} from '@lucide/svelte';

	ChartJS.register(Title, Tooltip, Legend, ArcElement, CategoryScale, LinearScale, PointElement, LineElement, BarElement);

	let loading = $state(true);
	let loadError = $state('');

	let resumen = $state<ResumenGeneralDashboard | null>(null);
	let flujoNodos = $state<FlujoDeNodos>({ nodos: [], aristas: [] });
	let serieHistorica = $state<SerieMensualFlujoCaja>({ labels: [], ingresos: [], egresos: [] });
	let proyeccion = $state<ProyeccionFutura>({ labels: [], ingresosProyectados: [], egresosProyectados: [] });

	let centrosOptions = $state<{ value: string; label: string }[]>([]);
	let filtroTipo = $state('');
	let filtroCentro = $state('');
	let items = $state<CentroCostoRendimiento[]>([]);
	let gastosCorporativos = $state(0);
	let sortBy = $state<keyof CentroCostoRendimiento>('flujoCajaNeto');
	let sortDir = $state<'asc' | 'desc'>('desc');

	// ── Salud financiera (Control Financiero) ───────────────────────────────
	let saldoCentros = $state(0);
	let saldoBancos = $state(0);
	let conciliacionesPendientes = $state(0);
	let incidenciasAbiertas = $state(0);
	let ultimaRevision = $state<RevisionFinanciera | null>(null);
	let ejecutandoRevision = $state(false);

	// ── Trayectoria de saldo en el tiempo (a pedido explícito del usuario) ──
	let trayectoriaCentros = $state<TrayectoriaResultado>({ fechas: [], series: [] });
	let trayectoriaCuentas = $state<TrayectoriaResultado>({ fechas: [], series: [] });
	const PALETA_TRAYECTORIA = ['#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#10b981', '#64748b', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];

	/** Cada serie trae solo sus propios puntos (fecha, saldo) — para graficarlas juntas hace falta
	 * "rellenar hacia adelante" (forward-fill) el último saldo conocido de cada una en TODAS las
	 * fechas del eje compartido (labels), no solo en las fechas donde ESA entidad tuvo movimiento.
	 * Antes de su primer punto (apertura o primera transacción), queda en `null` — Chart.js con
	 * `spanGaps` corta la línea ahí en vez de dibujar un 0 falso. */
	function construirDatasetsTrayectoria(resultado: TrayectoriaResultado) {
		return {
			labels: resultado.fechas,
			datasets: resultado.series.map((serie, i) => {
				const data: (number | null)[] = [];
				let idx = 0;
				let ultimo: number | null = null;
				for (const fecha of resultado.fechas) {
					while (idx < serie.puntos.length && serie.puntos[idx].fecha <= fecha) {
						ultimo = serie.puntos[idx].saldo;
						idx++;
					}
					data.push(ultimo);
				}
				return {
					label: serie.label,
					data,
					borderColor: PALETA_TRAYECTORIA[i % PALETA_TRAYECTORIA.length],
					backgroundColor: 'transparent',
					borderWidth: 1.5,
					pointRadius: 0,
					tension: 0.1,
					spanGaps: false
				};
			})
		};
	}

	const datasetsTrayectoriaCentros = $derived(construirDatasetsTrayectoria(trayectoriaCentros));
	const datasetsTrayectoriaCuentas = $derived(construirDatasetsTrayectoria(trayectoriaCuentas));

	const estadoGeneral = $derived.by((): 'ok' | 'alerta' | 'error' => {
		if (incidenciasAbiertas > 0 || (ultimaRevision?.controles_error ?? 0) > 0) return 'error';
		if (conciliacionesPendientes > 0 || (ultimaRevision?.controles_alerta ?? 0) > 0) return 'alerta';
		return 'ok';
	});

	async function cargarSaludFinanciera() {
		try {
			const [sc, sb, cp, ia, ur] = await Promise.all([
				getSaldoTotalCentrosCosto(supabase),
				getSaldoTotalCuentasBancarias(supabase),
				getConciliacionesPendientesCount(supabase),
				getIncidenciasAbiertasCount(supabase),
				getUltimaRevision(supabase)
			]);
			saldoCentros = sc;
			saldoBancos = sb;
			conciliacionesPendientes = cp;
			incidenciasAbiertas = ia;
			ultimaRevision = ur;
		} catch (err: any) {
			console.error('[DashboardTab] No se pudo cargar la salud financiera:', err);
		}
	}

	async function handleEjecutarRevision() {
		ejecutandoRevision = true;
		try {
			ultimaRevision = await ejecutarRevision(supabase, permisosState.userName || null);
			toast.success('Revisión ejecutada');
			await cargarSaludFinanciera();
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudo ejecutar la revisión');
		} finally {
			ejecutandoRevision = false;
		}
	}

	async function loadAll() {
		loading = true;
		loadError = '';
		try {
			const [resumenData, nodosData, historicaData, proyeccionData, opciones, rendimiento, gastosCorp, trayCentros, trayCuentas] = await Promise.all([
				getResumenGeneral(supabase),
				getFlujoDeNodos(supabase),
				getSerieMensualFlujoCaja(supabase, 12),
				getProyeccionFutura(supabase, 6),
				getCentrosCostoOptions(supabase),
				getRendimientoPorCentroCosto(supabase, {
					tipo: filtroTipo || undefined,
					idCentroCosto: filtroCentro ? Number(filtroCentro) : null
				}),
				getGastosCorporativosGlobales(supabase),
				getTrayectoriaCentrosCosto(supabase),
				getTrayectoriaCuentasBancarias(supabase)
			]);
			resumen = resumenData;
			flujoNodos = nodosData;
			serieHistorica = historicaData;
			proyeccion = proyeccionData;
			centrosOptions = opciones;
			items = rendimiento;
			gastosCorporativos = gastosCorp;
			trayectoriaCentros = trayCentros;
			trayectoriaCuentas = trayCuentas;
			await cargarSaludFinanciera();
		} catch (err: any) {
			loadError = err?.message ?? 'No se pudo cargar el dashboard';
			toast.error(loadError);
		} finally {
			loading = false;
		}
	}

	async function reloadRendimiento() {
		try {
			items = await getRendimientoPorCentroCosto(supabase, {
				tipo: filtroTipo || undefined,
				idCentroCosto: filtroCentro ? Number(filtroCentro) : null
			});
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudo filtrar el rendimiento por centro de costo');
		}
	}

	onMount(loadAll);

	function pct(v: number | null): string {
		return v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
	}

	function formatFecha(iso: string | undefined | null): string {
		if (!iso) return 'Nunca';
		return new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	// ── Flujo de Caja en el Tiempo: histórico (sólido) + proyección (punteado) ─────────────────────
	// El último punto histórico se repite como primer punto proyectado para que la línea punteada
	// arranque exactamente donde termina la sólida, en vez de verse cortada.
	const flujoCajaChartData = $derived.by(() => {
		const labels = [...serieHistorica.labels, ...proyeccion.labels];
		const nHist = serieHistorica.labels.length;
		const ultimoIngreso = serieHistorica.ingresos[nHist - 1] ?? 0;
		const ultimoEgreso = serieHistorica.egresos[nHist - 1] ?? 0;

		const ingresosHist = [...serieHistorica.ingresos, ultimoIngreso, ...Array(Math.max(proyeccion.labels.length - 1, 0)).fill(null)];
		const ingresosProy = [...Array(nHist).fill(null), ultimoIngreso, ...proyeccion.ingresosProyectados.slice(1)];
		const egresosHist = [...serieHistorica.egresos, ultimoEgreso, ...Array(Math.max(proyeccion.labels.length - 1, 0)).fill(null)];
		const egresosProy = [...Array(nHist).fill(null), ultimoEgreso, ...proyeccion.egresosProyectados.slice(1)];

		return {
			labels,
			datasets: [
				{ label: 'Ingresos', data: ingresosHist, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', tension: 0.35, fill: true, spanGaps: false },
				{ label: 'Ingresos (proyectado)', data: ingresosProy, borderColor: '#10b981', borderDash: [6, 4], backgroundColor: 'transparent', tension: 0.35, fill: false, spanGaps: false, pointStyle: 'circle' },
				{ label: 'Egresos', data: egresosHist, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.08)', tension: 0.35, fill: true, spanGaps: false },
				{ label: 'Egresos (proyectado)', data: egresosProy, borderColor: '#ef4444', borderDash: [6, 4], backgroundColor: 'transparent', tension: 0.35, fill: false, spanGaps: false, pointStyle: 'circle' }
			]
		};
	});

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

<!-- ── Salud Financiera ─────────────────────────────────────────────────── -->
<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm mb-8">
	<div class="flex flex-wrap items-center justify-between gap-3 mb-4">
		<div class="flex items-center gap-2">
			{#if estadoGeneral === 'ok'}
				<ShieldCheck size={20} class="text-emerald-500" />
				<h2 class="font-bold text-brand-marine text-sm">Salud Financiera: Consistente</h2>
			{:else if estadoGeneral === 'alerta'}
				<ShieldQuestion size={20} class="text-amber-500" />
				<h2 class="font-bold text-brand-marine text-sm">Salud Financiera: Con observaciones</h2>
			{:else}
				<ShieldAlert size={20} class="text-red-500" />
				<h2 class="font-bold text-brand-marine text-sm">Salud Financiera: Requiere atención</h2>
			{/if}
		</div>
		<button
			type="button"
			onclick={handleEjecutarRevision}
			disabled={ejecutandoRevision}
			class="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-semibold hover:bg-[#154a73] disabled:opacity-50"
		>
			<RefreshCw size={14} class={ejecutandoRevision ? 'animate-spin' : ''} /> Ejecutar revisión
		</button>
	</div>
	<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
		<div>
			<div class="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider"><Landmark size={11} /> Saldo Bancario</div>
			<div class="text-lg font-black text-brand-marine mt-0.5">{formatCurrency(saldoBancos)}</div>
		</div>
		<div>
			<div class="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider"><Building2 size={11} /> Saldo Centros de Costo</div>
			<div class="text-lg font-black text-brand-marine mt-0.5">{formatCurrency(saldoCentros)}</div>
		</div>
		<div>
			<div class="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider"><ScrollText size={11} /> Conciliaciones Pendientes</div>
			<div class={`text-lg font-black mt-0.5 ${conciliacionesPendientes > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{conciliacionesPendientes}</div>
		</div>
		<div>
			<div class="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider"><AlertCircle size={11} /> Incidencias Abiertas</div>
			<div class={`text-lg font-black mt-0.5 ${incidenciasAbiertas > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{incidenciasAbiertas}</div>
		</div>
		<div>
			<div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Controles OK / Alerta / Error</div>
			<div class="text-lg font-black mt-0.5">
				<span class="text-emerald-600">{ultimaRevision?.controles_ok ?? '—'}</span> /
				<span class="text-amber-600">{ultimaRevision?.controles_alerta ?? '—'}</span> /
				<span class="text-red-600">{ultimaRevision?.controles_error ?? '—'}</span>
			</div>
		</div>
		<div>
			<div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Última Revisión</div>
			<div class="text-xs font-semibold text-slate-600 mt-1.5">{formatFecha(ultimaRevision?.fecha)}</div>
		</div>
	</div>
</div>

<!-- Topbar header -->
<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
	<div>
		<h1 class="text-xl font-bold text-brand-marine flex items-center gap-2">
			<i class="fas fa-chart-line text-blue-600"></i> Flujo de dinero y proyecciones
		</h1>
		<p class="text-sm text-slate-500 mt-1">Flujo de dinero entre centros de costo, en vivo desde Supabase — histórico y proyectado.</p>
	</div>
	<div class="flex items-center gap-3">
		<button type="button" onclick={loadAll} disabled={loading} class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
			<RefreshCw size={14} class={loading ? 'animate-spin' : ''} /> Actualizar
		</button>
		<span class="text-xs bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full font-bold border border-blue-100 flex items-center gap-1.5">
			<span class="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
			Sincronizado con Supabase
		</span>
	</div>
</div>

{#if loadError}
	<div class="mb-4 bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm">{loadError}</div>
{/if}

{#if loading}
	<div class="flex items-center justify-center py-24 text-slate-400">
		<RefreshCw size={28} class="animate-spin" />
	</div>
{:else}
	<!-- ── KPIs GENERALES ───────────────────────────────────────────────────── -->
	<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
		<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
			<div class="absolute -right-4 -bottom-4 text-emerald-500/10 text-7xl"><TrendingUp size={64} /></div>
			<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Ingresos Totales</span>
			<div class="text-2xl font-black text-emerald-600 tracking-tight mt-1 mb-1">{formatCurrency(resumen?.totalIngresos ?? 0)}</div>
			<div class="text-[11px] text-slate-400 font-medium">Suma de transacciones activas tipo ingreso</div>
		</div>
		<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
			<div class="absolute -right-4 -bottom-4 text-red-500/10 text-7xl"><TrendingDown size={64} /></div>
			<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Egresos Totales</span>
			<div class="text-2xl font-black text-red-600 tracking-tight mt-1 mb-1">{formatCurrency(resumen?.totalEgresos ?? 0)}</div>
			<div class="text-[11px] text-slate-400 font-medium">Suma de transacciones activas tipo egreso</div>
		</div>
		<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
			<div class="absolute -right-4 -bottom-4 text-blue-500/10 text-7xl"><Wallet size={64} /></div>
			<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Saldo Neto</span>
			<div class={`text-2xl font-black tracking-tight mt-1 mb-1 ${(resumen?.saldoNeto ?? 0) >= 0 ? 'text-brand-marine' : 'text-red-600'}`}>{formatCurrency(resumen?.saldoNeto ?? 0)}</div>
			<div class="text-[11px] text-slate-400 font-medium">Ingresos − Egresos, histórico completo</div>
		</div>
		<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
			<div class="absolute -right-4 -bottom-4 text-purple-500/10 text-7xl"><Waypoints size={64} /></div>
			<span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Centros con Movimiento</span>
			<div class="text-2xl font-black text-purple-600 tracking-tight mt-1 mb-1">{resumen?.centrosConMovimiento ?? 0}</div>
			<div class="text-[11px] text-slate-400 font-medium flex items-center gap-1"><Users size={11} /> {resumen?.empleadosActivos ?? 0} empleados activos</div>
		</div>
	</div>

	<!-- ── GRAFO DE NODOS ───────────────────────────────────────────────────── -->
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm mb-8">
		<div class="flex items-center gap-2 mb-1">
			<Waypoints size={16} class="text-slate-400" />
			<h3 class="font-bold text-brand-marine text-sm">Flujo de Dinero entre Centros de Costo</h3>
		</div>
		<p class="text-[11px] text-slate-400 mb-4">Cada nodo es un centro de costo con movimiento; tamaño ∝ magnitud del saldo, verde = superávit, rojo = déficit. Arrastra, haz zoom y pasa el cursor para ver detalle.</p>
		<div class="h-[460px]">
			<NodeGraph nodos={flujoNodos.nodos} aristas={flujoNodos.aristas} />
		</div>
	</div>

	<!-- ── FLUJO DE CAJA EN EL TIEMPO (histórico + proyección) ─────────────── -->
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm h-96 flex flex-col mb-8">
		<div class="flex justify-between items-center mb-1">
			<div class="flex items-center gap-2">
				<LineChartIcon size={16} class="text-slate-400" />
				<h3 class="font-bold text-brand-marine text-sm">Flujo de Caja en el Tiempo</h3>
			</div>
		</div>
		<p class="text-[11px] text-slate-400 mb-3">Últimos 12 meses reales (línea sólida) + 6 meses proyectados (línea punteada) a partir de Cuentas por Pagar/Cobrar pendientes o vencidas.</p>
		<div class="flex-1 min-h-0">
			<Line data={flujoCajaChartData} options={{ responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 10, weight: 'bold' } } } }, scales: { y: { ticks: { callback: (v) => formatCurrency(Number(v)) } } } }} />
		</div>
	</div>

	<!-- ── TRAYECTORIA DE SALDO EN EL TIEMPO (por Centro de Costo / Cuenta Bancaria) ── -->
	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm h-96 flex flex-col mb-8">
		<h3 class="font-bold text-brand-marine text-sm mb-1">Trayectoria de Saldo — Centros de Costo</h3>
		<p class="text-[11px] text-slate-400 mb-3">
			Una línea por centro de costo (fondos propios): arranca en su última Apertura Financiera y avanza con cada transacción real posterior. Haz clic en la leyenda para aislar/ocultar líneas.
		</p>
		<div class="flex-1 min-h-0">
			{#if datasetsTrayectoriaCentros.datasets.length === 0}
				<p class="text-xs text-slate-300 flex items-center justify-center h-full">Sin datos todavía — registra una Apertura o alguna transacción.</p>
			{:else}
				<Line
					data={datasetsTrayectoriaCentros}
					options={{
						responsive: true,
						maintainAspectRatio: false,
						interaction: { mode: 'nearest', intersect: false },
						plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 9 } } } },
						scales: { y: { ticks: { callback: (v) => formatCurrency(Number(v)) } } }
					}}
				/>
			{/if}
		</div>
	</div>

	<div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm h-96 flex flex-col mb-8">
		<h3 class="font-bold text-brand-marine text-sm mb-1">Trayectoria de Saldo — Cuentas Bancarias</h3>
		<p class="text-[11px] text-slate-400 mb-3">Una línea por cuenta bancaria: arranca en su Saldo Inicial y avanza con cada transacción real que la use como origen o destino.</p>
		<div class="flex-1 min-h-0">
			{#if datasetsTrayectoriaCuentas.datasets.length === 0}
				<p class="text-xs text-slate-300 flex items-center justify-center h-full">Sin cuentas bancarias registradas todavía.</p>
			{:else}
				<Line
					data={datasetsTrayectoriaCuentas}
					options={{
						responsive: true,
						maintainAspectRatio: false,
						interaction: { mode: 'nearest', intersect: false },
						plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 9 } } } },
						scales: { y: { ticks: { callback: (v) => formatCurrency(Number(v)) } } }
					}}
				/>
			{/if}
		</div>
	</div>

	<!-- ── FILTROS (viabilidad por CdC) ────────────────────────────────────── -->
	<div class="flex flex-wrap items-end gap-3 mb-6 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
		<div class="flex flex-col gap-1">
			<label for="ff-tipo" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tipo de Centro de Costo</label>
			<select id="ff-tipo" bind:value={filtroTipo} onchange={reloadRendimiento} class="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 min-w-[170px]">
				<option value="">Todos</option>
				{#each TIPO_CENTRO_COSTO_OPTIONS as opt}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
		</div>
		<div class="flex flex-col gap-1">
			<label for="ff-centro" class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Centro de Costo</label>
			<select id="ff-centro" bind:value={filtroCentro} onchange={reloadRendimiento} class="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 min-w-[260px]">
				<option value="">Todos los centros de costo</option>
				{#each centrosOptions as opt}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
		</div>
		<span class="text-xs text-slate-400 ml-auto">{items.length} centro{items.length === 1 ? '' : 's'} de costo en el filtro actual</span>
	</div>

	{#if items.length === 0}
		<div class="text-center py-20 text-slate-400 bg-white rounded-2xl border border-slate-100 shadow-sm">
			<Building2 size={40} class="mx-auto mb-3 text-slate-300" />
			Sin centros de costo para este filtro.
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
							<th class="px-3 py-2.5">Centro de Costo</th>
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
										{TIPO_CENTRO_COSTO_LABELS[item.tipo] ?? item.tipo}{item.tipo === 'proyecto' && item.tip_proyecto ? ` · ${item.tip_proyecto === 'O' ? 'Obra' : 'Mantenimiento'}` : ''}
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
{/if}
