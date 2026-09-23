<script lang="ts">
	// "Control de IGV" — pestaña de Control Financiero, a pedido explícito del usuario (imagen de
	// referencia): estima el IGV a pagar del mes cruzando Ventas (facturas emitidas, IGV real) contra
	// Compras (transacciones de egreso, crédito fiscal derivado — ver igv.service.ts) contra un
	// "Objetivo mensual" configurable, con simuladores de venta/compra y una evolución histórica.
	// Mismo patrón que el resto de Control Financiero: self-contained, fetch propio en onMount.
	// Colores tal cual la imagen: cada tarjeta lleva su propio tinte (azul = control/objetivo, lila =
	// IGV, verde = compras/estado ok) y el estado (verde/ámbar/rojo) tiñe "Estado actual".
	import { onMount } from 'svelte';
	import { Chart as ChartJS, Title, Tooltip, Legend, CategoryScale, LinearScale, BarElement, type Plugin } from 'chart.js';
	import { Bar } from 'svelte-chartjs';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { permisosState } from '$lib/stores/permisos.svelte';
	import { formatCurrency } from '$lib/shared/fieldConfig';
	import {
		getResumenIgv,
		getEvolucionIgv,
		getObjetivoIgv,
		setObjetivoIgv,
		getComprobantesDelPeriodo,
		estadoSemaforoIgv,
		type ResumenIgv,
		type PuntoEvolucionIgv,
		type ComprobanteVenta,
		type MovimientoCompra,
		type EstadoSemaforoIgv
	} from '../services/igv.service';
	import {
		Percent,
		FileText,
		Target,
		CircleCheck,
		TriangleAlert,
		ShoppingCart,
		ChartColumn,
		ClipboardList,
		ArrowUp,
		ArrowDown,
		Info,
		ChevronDown,
		ChevronUp,
		ChevronRight,
		Pencil,
		Settings,
		Calendar,
		RefreshCw,
		X
	} from '@lucide/svelte';

	ChartJS.register(Title, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

	const IGV_TASA = 0.18;
	function round2(v: number): number {
		return Math.round(v * 100) / 100;
	}
	/** "S/ 1,800" — sin decimales cuando el monto es entero (como en la imagen), con 2 si trae céntimos. */
	function sol(v: number): string {
		const n = Number.isFinite(v) ? v : 0;
		return `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
	}

	let loading = $state(true);
	let loadError = $state('');

	// ── Mes analizado (dropdown, último año) ────────────────────────────────
	function primerDiaDelMes(d: Date): Date {
		return new Date(d.getFullYear(), d.getMonth(), 1);
	}
	const MESES_OPCIONES = Array.from({ length: 12 }, (_, i) => primerDiaDelMes(new Date(new Date().getFullYear(), new Date().getMonth() - i, 1)));
	function claveMes(d: Date): string {
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
	}
	function etiquetaMes(d: Date): string {
		const s = d.toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
		return s.charAt(0).toUpperCase() + s.slice(1);
	}
	let mesSeleccionadoKey = $state(claveMes(primerDiaDelMes(new Date())));
	const mesSeleccionado = $derived(MESES_OPCIONES.find((m) => claveMes(m) === mesSeleccionadoKey) ?? primerDiaDelMes(new Date()));

	let resumen = $state<ResumenIgv | null>(null);
	let evolucion = $state<PuntoEvolucionIgv[]>([]);
	let objetivo = $state(5000);

	// ── Configurar objetivo ──────────────────────────────────────────────────
	let editandoObjetivo = $state(false);
	let objetivoInput = $state('5000');
	let guardandoObjetivo = $state(false);

	function abrirEditarObjetivo() {
		objetivoInput = String(objetivo);
		editandoObjetivo = true;
	}
	async function guardarObjetivo() {
		const valor = Number(objetivoInput);
		if (!(valor > 0)) {
			toast.error('Ingresa un objetivo válido, mayor a 0');
			return;
		}
		guardandoObjetivo = true;
		try {
			const result = await setObjetivoIgv(supabase, valor, permisosState.userName || null);
			if (result.success) {
				objetivo = valor;
				editandoObjetivo = false;
				toast.success(result.message);
				await cargarResumen();
			} else {
				toast.error(result.message);
			}
		} finally {
			guardandoObjetivo = false;
		}
	}

	function mostrarAyuda() {
		toast.info('El IGV estimado = IGV de tus ventas emitidas − crédito fiscal de tus compras del mes. El semáforo lo compara contra el objetivo mensual.');
	}

	// ── Carga de datos ───────────────────────────────────────────────────────
	async function cargarResumen() {
		const [r, ev] = await Promise.all([getResumenIgv(supabase, mesSeleccionado), getEvolucionIgv(supabase, mesSeleccionado, 6)]);
		resumen = r;
		evolucion = ev;
		// Los simuladores muestran su resultado de una vez (con el monto por defecto), como en la imagen.
		simularVenta();
		simularCompra();
	}

	async function loadAll() {
		loading = true;
		loadError = '';
		try {
			objetivo = await getObjetivoIgv(supabase);
			await cargarResumen();
		} catch (err: any) {
			loadError = err?.message ?? 'No se pudo cargar Control de IGV';
			toast.error(loadError);
		} finally {
			loading = false;
		}
	}

	onMount(loadAll);

	async function cambiarMes(nuevaKey: string) {
		mesSeleccionadoKey = nuevaKey;
		desdeInput = primerDiaISO(mesSeleccionado);
		hastaInput = ultimoDiaISO(mesSeleccionado);
		detalleCargado = false;
		loading = true;
		try {
			await cargarResumen();
			if (detalleAbierto) await aplicarFiltroDetalle();
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudo cargar el mes seleccionado');
		} finally {
			loading = false;
		}
	}

	function pctDelObjetivo(igv: number): number {
		if (objetivo <= 0) return 0;
		return Math.max(0, Math.round((igv / objetivo) * 100));
	}
	function pctTexto(v: number): string {
		return `${v > 0 ? '+' : ''}${v}%`;
	}

	const ESTADO_LABEL: Record<EstadoSemaforoIgv, string> = { ok: 'Dentro del objetivo', alerta: 'En atención', error: 'Fuera de objetivo' };
	const ESTADO_BADGE: Record<EstadoSemaforoIgv, string> = { ok: 'bg-emerald-100 text-emerald-700', alerta: 'bg-amber-100 text-amber-700', error: 'bg-red-100 text-red-700' };
	const ESTADO_BAR: Record<EstadoSemaforoIgv, string> = { ok: 'bg-emerald-500', alerta: 'bg-amber-500', error: 'bg-red-500' };
	const ESTADO_TEXT: Record<EstadoSemaforoIgv, string> = { ok: 'text-emerald-600', alerta: 'text-amber-600', error: 'text-red-600' };
	const ESTADO_CARD: Record<EstadoSemaforoIgv, string> = { ok: 'border-emerald-100 bg-emerald-50/70', alerta: 'border-amber-100 bg-amber-50/70', error: 'border-red-100 bg-red-50/70' };

	const estadoActual = $derived(resumen ? estadoSemaforoIgv(resumen.igvEstimado, objetivo) : 'ok');
	const pctActual = $derived(resumen ? pctDelObjetivo(resumen.igvEstimado) : 0);

	// ── Gráfico "Evolución del IGV por pagar" ───────────────────────────────
	const chartData = $derived({
		labels: evolucion.map((p) => p.label),
		datasets: [
			{
				label: 'IGV por pagar',
				data: evolucion.map((p) => p.igvEstimado),
				backgroundColor: evolucion.map((p) => (p.mes === claveMes(mesSeleccionado) ? '#2563eb' : '#93c5fd')),
				borderRadius: 6,
				borderSkipped: false as const,
				maxBarThickness: 44
			}
		]
	});
	// Máximo del eje Y: siempre por encima del objetivo y de la barra más alta, para que la línea punteada
	// del objetivo y las etiquetas de cada barra queden dentro del área del gráfico.
	const chartMax = $derived(Math.max(objetivo, ...evolucion.map((p) => p.igvEstimado), 1) * 1.2);

	// Plugin local (solo este gráfico, no se registra global): valor "S/ 800" encima de cada barra + la
	// línea punteada morada "Objetivo: S/ 5,000" — dibujada con la escala real del eje Y (no un overlay
	// CSS aproximado) y sin sumar chartjs-plugin-annotation como dependencia nueva.
	const decoracionGrafico: Plugin<'bar'> = {
		id: 'decoracionIgv',
		afterDatasetsDraw(chart) {
			const { ctx, chartArea, scales } = chart;
			ctx.save();
			ctx.font = '700 11px Arial, sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'bottom';
			chart.getDatasetMeta(0).data.forEach((barra, i) => {
				const valor = Number(chart.data.datasets[0].data[i] ?? 0);
				const esUltima = i === chart.data.labels!.length - 1;
				ctx.fillStyle = esUltima ? '#1d4ed8' : '#1e3a6d';
				ctx.fillText(sol(valor), barra.x, barra.y - 4);
			});
			const yObjetivo = scales.y.getPixelForValue(objetivo);
			ctx.setLineDash([6, 4]);
			ctx.strokeStyle = '#a855f7';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.moveTo(chartArea.left, yObjetivo);
			ctx.lineTo(chartArea.right, yObjetivo);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.fillStyle = '#9333ea';
			ctx.textAlign = 'right';
			ctx.fillText(`Objetivo: ${sol(objetivo)}`, chartArea.right, yObjetivo - 4);
			ctx.restore();
		}
	};

	// ── Simuladores (100% cliente, no escriben nada) ────────────────────────
	let montoVentaSim = $state('10000');
	let montoCompraSim = $state('10000');
	let resultadoVenta = $state<{ igvActual: number; igvAdicional: number; nuevoIgv: number } | null>(null);
	let resultadoCompra = $state<{ igvActual: number; creditoAdicional: number; nuevoIgv: number } | null>(null);

	function simularVenta() {
		const monto = Number(montoVentaSim);
		if (!resumen || !(monto > 0)) return;
		const igvAdicional = round2(monto * IGV_TASA);
		resultadoVenta = { igvActual: resumen.igvEstimado, igvAdicional, nuevoIgv: round2(resumen.igvEstimado + igvAdicional) };
	}
	function simularCompra() {
		const monto = Number(montoCompraSim);
		if (!resumen || !(monto > 0)) return;
		const creditoAdicional = round2(monto * IGV_TASA);
		resultadoCompra = { igvActual: resumen.igvEstimado, creditoAdicional, nuevoIgv: Math.max(0, round2(resumen.igvEstimado - creditoAdicional)) };
	}
	const estadoSimVenta = $derived(resultadoVenta ? estadoSemaforoIgv(resultadoVenta.nuevoIgv, objetivo) : null);
	const estadoSimCompra = $derived(resultadoCompra ? estadoSemaforoIgv(resultadoCompra.nuevoIgv, objetivo) : null);
	const SIM_LABEL: Record<EstadoSemaforoIgv, string> = { ok: 'Favorable', alerta: 'En atención', error: 'Fuera de objetivo' };
	const SIM_BOX: Record<EstadoSemaforoIgv, string> = {
		ok: 'bg-emerald-50 border-emerald-200 text-emerald-700',
		alerta: 'bg-amber-50 border-amber-200 text-amber-700',
		error: 'bg-red-50 border-red-200 text-red-700'
	};

	// ── Detalle de facturas (Ventas y Compras), colapsable ──────────────────
	let detalleAbierto = $state(false);
	let detalleCargado = $state(false);
	let cargandoDetalle = $state(false);
	function primerDiaISO(d: Date): string {
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
	}
	function ultimoDiaISO(d: Date): string {
		const fin = new Date(d.getFullYear(), d.getMonth() + 1, 0);
		return `${fin.getFullYear()}-${String(fin.getMonth() + 1).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`;
	}
	let desdeInput = $state(primerDiaISO(new Date()));
	let hastaInput = $state(ultimoDiaISO(new Date()));
	let ventasDetalle = $state<ComprobanteVenta[]>([]);
	let comprasDetalle = $state<MovimientoCompra[]>([]);

	async function aplicarFiltroDetalle() {
		detalleAbierto = true;
		cargandoDetalle = true;
		try {
			const r = await getComprobantesDelPeriodo(supabase, desdeInput, hastaInput);
			ventasDetalle = r.ventas;
			comprasDetalle = r.compras;
			detalleCargado = true;
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudo cargar el detalle');
		} finally {
			cargandoDetalle = false;
		}
	}

	function toggleDetalle() {
		detalleAbierto = !detalleAbierto;
		if (detalleAbierto && !detalleCargado) aplicarFiltroDetalle();
	}

	function formatFecha(iso: string): string {
		const d = new Date(`${iso}T00:00:00`);
		return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
	}
</script>

<!-- Variación vs. mes anterior (flecha + % y la leyenda chica debajo). `subeEsMalo`: para el IGV a pagar,
     que suba es malo (rojo) — para ventas/compras que suba es bueno (verde), como en la imagen. -->
{#snippet variacion(pct: number | null, subeEsMalo: boolean)}
	{#if pct !== null}
		{@const bueno = subeEsMalo ? pct <= 0 : pct >= 0}
		<div class="text-right shrink-0">
			<div class={`flex items-center justify-end gap-0.5 text-xs font-bold ${bueno ? 'text-emerald-600' : 'text-red-600'}`}>
				{#if pct >= 0}<ArrowUp size={12} />{:else}<ArrowDown size={12} />{/if}{pctTexto(pct)}
			</div>
			<div class="text-[9px] text-slate-400 leading-tight">vs. mes anterior</div>
		</div>
	{/if}
{/snippet}

<!-- ── Barra superior de la pestaña: mes analizado + Configurar objetivo ────────────────────────── -->
<div class="flex flex-wrap items-center justify-end gap-2 mb-4">
	<div class="relative">
		<Calendar size={15} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
		<select
			value={mesSeleccionadoKey}
			onchange={(e) => cambiarMes((e.target as HTMLSelectElement).value)}
			class="pl-9 pr-8 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
		>
			{#each MESES_OPCIONES as m}
				<option value={claveMes(m)}>{etiquetaMes(m)}</option>
			{/each}
		</select>
	</div>
	<button type="button" onclick={abrirEditarObjetivo} class="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-blue-200 bg-white text-blue-700 text-sm font-semibold hover:bg-blue-50">
		<Settings size={15} /> Configurar objetivo
	</button>
	<button type="button" onclick={mostrarAyuda} class="w-9 h-9 flex items-center justify-center rounded-full border border-slate-300 text-slate-500 hover:bg-slate-50" title="¿Cómo se calcula?" aria-label="¿Cómo se calcula?">
		<Info size={16} />
	</button>
</div>

{#if loadError}
	<div class="mb-4 bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm">{loadError}</div>
{/if}

{#if loading}
	<div class="flex items-center justify-center py-24 text-slate-400">
		<RefreshCw size={28} class="animate-spin" />
	</div>
{:else if resumen}
	<!-- ── 4 tarjetas superiores ────────────────────────────────────────────────────────────────── -->
	<div class="grid grid-cols-1 lg:grid-cols-[1.9fr_1fr_1fr_1fr] gap-4 mb-4">
		<!-- Control de IGV: Ventas / Compras del mes -->
		<div class="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-blue-50/50 p-4 shadow-sm min-w-0">
			<div class="flex items-center gap-3 mb-3">
				<div class="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0"><Percent size={20} /></div>
				<div>
					<h3 class="font-bold text-brand-marine text-base leading-tight">Control de IGV</h3>
					<p class="text-[11px] text-slate-500">Analiza tus ventas y compras del mes para estimar cuánto IGV pagarás.</p>
				</div>
			</div>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<div class="rounded-xl border border-blue-100 bg-blue-50 p-3 min-w-0">
					<div class="flex items-start justify-between gap-2">
						<div class="flex items-center gap-2 min-w-0">
							<div class="w-10 h-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0"><ChartColumn size={22} /></div>
							<div class="min-w-0">
								<div class="text-xs font-bold text-slate-700 leading-tight">Ventas del mes</div>
								<div class="text-[10px] text-slate-500">(Base imponible)</div>
							</div>
						</div>
						{@render variacion(resumen.variacionVentasPct, false)}
					</div>
					<div class="text-center mt-2">
						<div class="text-2xl xl:text-3xl font-black text-slate-900 tracking-tight">{sol(resumen.ventasBase)}</div>
						<div class="text-[11px] text-slate-500 mt-1">IGV generado (18%)</div>
						<div class="text-base font-black text-slate-800">{sol(resumen.igvVentas)}</div>
					</div>
				</div>

				<div class="rounded-xl border border-emerald-100 bg-emerald-50 p-3 min-w-0">
					<div class="flex items-start justify-between gap-2">
						<div class="flex items-center gap-2 min-w-0">
							<div class="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0"><ShoppingCart size={22} /></div>
							<div class="min-w-0">
								<div class="text-xs font-bold text-slate-700 leading-tight">Compras del mes</div>
								<div class="text-[10px] text-slate-500">(Base imponible)</div>
							</div>
						</div>
						{@render variacion(resumen.variacionComprasPct, false)}
					</div>
					<div class="text-center mt-2">
						<div class="text-2xl xl:text-3xl font-black text-slate-900 tracking-tight">{sol(resumen.comprasBase)}</div>
						<div class="text-[11px] text-slate-500 mt-1">Crédito fiscal (18%)</div>
						<div class="text-base font-black text-slate-800">{sol(resumen.creditoFiscalCompras)}</div>
					</div>
				</div>
			</div>
		</div>

		<!-- IGV estimado a pagar -->
		<div class="rounded-2xl border border-purple-100 bg-purple-50/70 p-4 shadow-sm flex flex-col min-w-0">
			<div class="flex items-start justify-between gap-2 mb-2">
				<div class="flex items-center gap-2 min-w-0">
					<div class="w-10 h-10 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center shrink-0"><FileText size={20} /></div>
					<div class="min-w-0">
						<h3 class="font-bold text-brand-marine text-sm leading-tight">IGV estimado a pagar</h3>
						<p class="text-[10px] text-slate-500">(Datos registrados)</p>
					</div>
				</div>
				{@render variacion(resumen.variacionIgvPct, true)}
			</div>
			<div class="text-center text-3xl xl:text-4xl font-black text-purple-700 tracking-tight my-3">{sol(resumen.igvEstimado)}</div>
			<div class="mt-auto flex items-start gap-2 text-[11px] rounded-lg border border-purple-100 bg-purple-100/60 px-3 py-2 text-slate-600">
				<Info size={14} class="shrink-0 mt-0.5 text-blue-500" />
				<span>
					{#if estadoActual === 'error'}
						Tu IGV estimado supera el máximo definido.
					{:else if estadoActual === 'alerta'}
						Tu IGV estimado está cerca del máximo definido.
					{:else}
						Tu IGV estimado está por debajo del máximo definido.
					{/if}
				</span>
			</div>
		</div>

		<!-- Objetivo mensual -->
		<div class="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 shadow-sm flex flex-col min-w-0">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-10 h-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0"><Target size={20} /></div>
				<div class="min-w-0">
					<h3 class="font-bold text-brand-marine text-sm leading-tight">Objetivo mensual</h3>
					<p class="text-[10px] text-slate-500">(IGV máximo a pagar)</p>
				</div>
			</div>
			<div class="flex items-center justify-center gap-2 my-2">
				<span class="text-3xl xl:text-4xl font-black text-slate-800 tracking-tight">{sol(objetivo)}</span>
				<button type="button" onclick={abrirEditarObjetivo} class="text-blue-600 hover:text-blue-800" title="Editar objetivo" aria-label="Editar objetivo"><Pencil size={16} /></button>
			</div>
			<div class="w-full h-2.5 rounded-full bg-white border border-blue-100 overflow-hidden">
				<div class={`h-full rounded-full ${ESTADO_BAR[estadoActual]}`} style={`width:${Math.min(100, pctActual)}%`}></div>
			</div>
			<p class="text-[11px] text-slate-500 text-right mt-1">{pctActual}% del objetivo</p>
			<div class="mt-auto text-center pt-2">
				<div class="text-[11px] text-slate-500">Margen disponible</div>
				<div class="text-2xl font-black text-slate-800">{sol(Math.max(0, objetivo - resumen.igvEstimado))}</div>
			</div>
		</div>

		<!-- Estado actual (el tinte sigue al semáforo) -->
		<div class={`rounded-2xl border p-4 shadow-sm flex flex-col min-w-0 ${ESTADO_CARD[estadoActual]}`}>
			<div class="flex items-center gap-2 mb-2">
				<div class={`w-10 h-10 rounded-full text-white flex items-center justify-center shrink-0 ${estadoActual === 'ok' ? 'bg-emerald-500' : estadoActual === 'alerta' ? 'bg-amber-500' : 'bg-red-500'}`}>
					{#if estadoActual === 'ok'}<CircleCheck size={22} />{:else}<TriangleAlert size={20} />{/if}
				</div>
				<h3 class="font-bold text-brand-marine text-sm">Estado actual</h3>
			</div>
			<div class="text-center mb-2">
				<span class={`inline-block px-3 py-1 rounded-full text-xs font-bold ${ESTADO_BADGE[estadoActual]}`}>{ESTADO_LABEL[estadoActual]}</span>
			</div>
			<div class="text-center mb-2">
				<span class={`text-3xl xl:text-4xl font-black ${ESTADO_TEXT[estadoActual]}`}>{pctActual}%</span>
				<span class="text-sm font-semibold text-slate-600"> del objetivo</span>
			</div>
			<div class="w-full h-2.5 rounded-full bg-white border border-slate-100 overflow-hidden mb-3">
				<div class={`h-full rounded-full ${ESTADO_BAR[estadoActual]}`} style={`width:${Math.min(100, pctActual)}%`}></div>
			</div>
			<p class="mt-auto text-[11px] text-slate-600">
				Tu IGV estimado ({sol(resumen.igvEstimado)})
				{estadoActual === 'error' ? 'supera' : estadoActual === 'alerta' ? 'está cerca de' : 'está por debajo de'} el máximo definido ({sol(objetivo)}).
			</p>
		</div>
	</div>

	<!-- ── Simuladores + gráfico de evolución ───────────────────────────────────────────────────── -->
	<div class="grid grid-cols-1 lg:grid-cols-[1.15fr_1.15fr_1.1fr] gap-4 mb-4">
		<!-- Simular venta -->
		<div class="rounded-2xl border border-purple-100 bg-purple-50/60 p-4 shadow-sm min-w-0">
			<div class="flex items-center gap-2 mb-1">
				<div class="w-9 h-9 rounded-full bg-purple-600 text-white flex items-center justify-center shrink-0"><ArrowUp size={18} /></div>
				<h3 class="font-bold text-purple-700 text-sm">Simular una nueva venta</h3>
			</div>
			<p class="text-[11px] text-slate-500 mb-3">Ingresa un monto de venta (sin IGV) para ver el impacto en tu IGV por pagar.</p>
			<div class="grid grid-cols-2 gap-3">
				<div class="flex flex-col gap-3 min-w-0">
					<div>
						<label for="sim-venta" class="text-[10px] font-semibold text-slate-600">Monto de la venta (sin IGV)</label>
						<div class="flex items-center mt-1 rounded-lg border border-purple-200 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-purple-200">
							<span class="px-2 text-sm text-slate-500 font-semibold">S/</span>
							<input id="sim-venta" type="number" min="0" step="0.01" bind:value={montoVentaSim} class="w-full min-w-0 py-2 pr-2 text-base font-semibold text-slate-800 focus:outline-none" />
						</div>
					</div>
					<button type="button" onclick={simularVenta} class="w-full flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700">
						Simular venta <ChevronRight size={15} />
					</button>
				</div>
				<div class="flex flex-col gap-2 min-w-0">
					<p class="font-bold text-slate-700 text-[11px]">Resultado proyectado</p>
					{#if resultadoVenta}
						<div class="text-[11px] space-y-1">
							<div class="flex justify-between gap-1 text-slate-600"><span>IGV actual por pagar</span><span class="font-bold text-slate-800">{sol(resultadoVenta.igvActual)}</span></div>
							<div class="flex justify-between gap-1 text-slate-600"><span>IGV adicional (18%)</span><span class="font-bold text-slate-800">{sol(resultadoVenta.igvAdicional)}</span></div>
							<div class="flex justify-between gap-1 font-bold text-slate-800"><span>Nuevo IGV por pagar</span><span class={resultadoVenta.nuevoIgv > resultadoVenta.igvActual ? 'text-red-600' : 'text-emerald-600'}>{sol(resultadoVenta.nuevoIgv)}</span></div>
						</div>
						{#if estadoSimVenta}
							<div class={`flex items-start gap-2 rounded-lg border px-2 py-1.5 ${SIM_BOX[estadoSimVenta]}`}>
								{#if estadoSimVenta === 'ok'}<CircleCheck size={16} class="shrink-0 mt-0.5" />{:else}<TriangleAlert size={16} class="shrink-0 mt-0.5" />{/if}
								<div class="text-[10px] leading-snug">
									<div class="font-bold text-[11px]">Resultado: {SIM_LABEL[estadoSimVenta]}</div>
									Con esta venta, tu IGV sería {pctDelObjetivo(resultadoVenta.nuevoIgv)}% del objetivo.
								</div>
							</div>
						{/if}
					{/if}
				</div>
			</div>
		</div>

		<!-- Simular compra -->
		<div class="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 shadow-sm min-w-0">
			<div class="flex items-center gap-2 mb-1">
				<div class="w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0"><ArrowDown size={18} /></div>
				<h3 class="font-bold text-emerald-700 text-sm">Simular una nueva compra</h3>
			</div>
			<p class="text-[11px] text-slate-500 mb-3">Ingresa un monto de compra (sin IGV) para ver el impacto en tu IGV por pagar.</p>
			<div class="grid grid-cols-2 gap-3">
				<div class="flex flex-col gap-3 min-w-0">
					<div>
						<label for="sim-compra" class="text-[10px] font-semibold text-slate-600">Monto de la compra (sin IGV)</label>
						<div class="flex items-center mt-1 rounded-lg border border-emerald-200 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-emerald-200">
							<span class="px-2 text-sm text-slate-500 font-semibold">S/</span>
							<input id="sim-compra" type="number" min="0" step="0.01" bind:value={montoCompraSim} class="w-full min-w-0 py-2 pr-2 text-base font-semibold text-slate-800 focus:outline-none" />
						</div>
					</div>
					<button type="button" onclick={simularCompra} class="w-full flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700">
						Simular compra <ChevronRight size={15} />
					</button>
				</div>
				<div class="flex flex-col gap-2 min-w-0">
					<p class="font-bold text-slate-700 text-[11px]">Resultado proyectado</p>
					{#if resultadoCompra}
						<div class="text-[11px] space-y-1">
							<div class="flex justify-between gap-1 text-slate-600"><span>IGV actual por pagar</span><span class="font-bold text-slate-800">{sol(resultadoCompra.igvActual)}</span></div>
							<div class="flex justify-between gap-1 text-slate-600"><span>Crédito fiscal adicional (18%)</span><span class="font-bold text-slate-800">{sol(resultadoCompra.creditoAdicional)}</span></div>
							<div class="flex justify-between gap-1 font-bold text-slate-800"><span>Nuevo IGV por pagar</span><span class={resultadoCompra.nuevoIgv > resultadoCompra.igvActual ? 'text-red-600' : 'text-emerald-600'}>{sol(resultadoCompra.nuevoIgv)}</span></div>
						</div>
						{#if estadoSimCompra}
							<div class={`flex items-start gap-2 rounded-lg border px-2 py-1.5 ${SIM_BOX[estadoSimCompra]}`}>
								{#if estadoSimCompra === 'ok'}<CircleCheck size={16} class="shrink-0 mt-0.5" />{:else}<TriangleAlert size={16} class="shrink-0 mt-0.5" />{/if}
								<div class="text-[10px] leading-snug">
									<div class="font-bold text-[11px]">Resultado: {SIM_LABEL[estadoSimCompra]}</div>
									Con esta compra, tu IGV sería {pctDelObjetivo(resultadoCompra.nuevoIgv)}% del objetivo.
								</div>
							</div>
						{/if}
					{/if}
				</div>
			</div>
		</div>

		<!-- Evolución del IGV por pagar -->
		<div class="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm flex flex-col min-w-0">
			<div class="flex items-center gap-2 mb-2">
				<ChartColumn size={18} class="text-blue-600" />
				<h3 class="font-bold text-brand-marine text-sm">Evolución del IGV por pagar (datos reales)</h3>
			</div>
			<div class="flex-1 min-h-[210px]">
				<Bar
					data={chartData}
					plugins={[decoracionGrafico]}
					options={{
						responsive: true,
						maintainAspectRatio: false,
						layout: { padding: { top: 6 } },
						plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => sol(Number(ctx.raw)) } } },
						scales: {
							x: { grid: { display: false } },
							y: { beginAtZero: true, max: chartMax, ticks: { maxTicksLimit: 5, callback: (v) => sol(Number(v)) } }
						}
					}}
				/>
			</div>
		</div>
	</div>

	<!-- ── Resumen / IGV y % / Leyenda / Información importante ────────────────────────────────── -->
	<div class="grid grid-cols-1 lg:grid-cols-[1.1fr_1.15fr_1fr_1.1fr] gap-4 mb-4">
		<div class="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm min-w-0">
			<div class="flex items-center gap-2 mb-3">
				<ClipboardList size={17} class="text-blue-600" />
				<h3 class="font-bold text-brand-marine text-sm">Resumen del mes ({etiquetaMes(mesSeleccionado)})</h3>
			</div>
			<div class="space-y-2 text-xs">
				<div class="flex justify-between gap-2 text-slate-600"><span>Ventas (base imponible)</span><span class="font-bold text-slate-800">{sol(resumen.ventasBase)}</span></div>
				<div class="flex justify-between gap-2 text-slate-600"><span>IGV de ventas (18%)</span><span class="font-bold text-slate-800">{sol(resumen.igvVentas)}</span></div>
				<div class="flex justify-between gap-2 text-slate-600"><span>Compras (base imponible)</span><span class="font-bold text-slate-800">{sol(resumen.comprasBase)}</span></div>
				<div class="flex justify-between gap-2 text-slate-600"><span>Crédito fiscal de compras (18%)</span><span class="font-bold text-slate-800">{sol(resumen.creditoFiscalCompras)}</span></div>
			</div>
		</div>

		<div class="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm grid grid-cols-2 gap-3 min-w-0">
			<div class="rounded-xl border border-purple-100 bg-purple-50 flex flex-col items-center justify-center text-center p-3">
				<span class="text-[11px] font-semibold text-slate-600 mb-1">IGV estimado a pagar</span>
				<span class="text-2xl xl:text-3xl font-black text-purple-700 tracking-tight">{sol(resumen.igvEstimado)}</span>
			</div>
			<div class={`rounded-xl border flex flex-col items-center justify-center text-center p-3 ${ESTADO_CARD[estadoActual]}`}>
				<span class="text-[11px] font-semibold text-slate-600 mb-1">% del objetivo</span>
				<span class={`text-3xl xl:text-4xl font-black ${ESTADO_TEXT[estadoActual]}`}>{pctActual}%</span>
			</div>
		</div>

		<div class="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm min-w-0">
			<h3 class="font-bold text-brand-marine text-sm mb-3">Leyenda del semáforo</h3>
			<div class="space-y-3">
				<div class="flex items-center gap-3"><span class="w-4 h-4 rounded-full bg-emerald-500 shrink-0"></span><div><div class="text-xs font-bold text-slate-700">Dentro del objetivo</div><div class="text-[11px] text-slate-500">Menos del 80% del objetivo.</div></div></div>
				<div class="flex items-center gap-3"><span class="w-4 h-4 rounded-full bg-amber-500 shrink-0"></span><div><div class="text-xs font-bold text-slate-700">En atención</div><div class="text-[11px] text-slate-500">Entre 80% y 99% del objetivo.</div></div></div>
				<div class="flex items-center gap-3"><span class="w-4 h-4 rounded-full bg-red-500 shrink-0"></span><div><div class="text-xs font-bold text-slate-700">Fuera de objetivo</div><div class="text-[11px] text-slate-500">100% o más del objetivo.</div></div></div>
			</div>
		</div>

		<div class="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm min-w-0">
			<div class="flex items-center gap-2 mb-2">
				<span class="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0"><Info size={13} /></span>
				<h3 class="font-bold text-brand-marine text-sm">Información importante</h3>
			</div>
			<ul class="space-y-1 text-[11px] text-slate-600 list-disc pl-4 marker:text-blue-500">
				<li>El semáforo aplica al IGV estimado con operaciones registradas.</li>
				<li>Los simuladores muestran un resultado proyectado.</li>
				<li>Solo se consideran comprobantes válidos con derecho a crédito fiscal.</li>
				<li>El objetivo mensual es un parámetro interno de control.</li>
				<li>Revisa la información contable antes de presentar tu declaración a SUNAT.</li>
			</ul>
		</div>
	</div>

	<!-- ── Detalle de facturas (Ventas y Compras), colapsable — el filtro de fechas va en la cabecera ── -->
	<div class="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
		<div class="flex flex-wrap items-center justify-between gap-4 p-4">
			<button type="button" onclick={toggleDetalle} class="flex items-center gap-3 text-left min-w-0" aria-expanded={detalleAbierto}>
				{#if detalleAbierto}<ChevronUp size={26} class="text-blue-700 shrink-0" />{:else}<ChevronDown size={26} class="text-blue-700 shrink-0" />{/if}
				<div class="min-w-0">
					<h3 class="font-bold text-brand-marine text-lg leading-tight">Detalle de facturas (Ventas y Compras)</h3>
					<p class="text-xs text-slate-500">Revisa los comprobantes que componen los montos mostrados en los indicadores. Puedes filtrar por rango de fechas.</p>
				</div>
			</button>
			<div class="flex flex-wrap items-center gap-3">
				<label class="flex items-center gap-2 text-sm text-slate-600 font-medium">
					Desde
					<span class="flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1.5 bg-white">
						<input type="date" bind:value={desdeInput} class="text-sm text-slate-700 focus:outline-none" />
						<Calendar size={14} class="text-slate-500" />
					</span>
				</label>
				<label class="flex items-center gap-2 text-sm text-slate-600 font-medium">
					Hasta
					<span class="flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1.5 bg-white">
						<input type="date" bind:value={hastaInput} class="text-sm text-slate-700 focus:outline-none" />
						<Calendar size={14} class="text-slate-500" />
					</span>
				</label>
				<button type="button" onclick={aplicarFiltroDetalle} disabled={cargandoDetalle} class="px-6 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
					{cargandoDetalle ? 'Cargando...' : 'Aplicar'}
				</button>
			</div>
		</div>

		{#if detalleAbierto}
			<div class="border-t border-slate-100 p-4">
				<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
					<div>
						<h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Ventas ({ventasDetalle.length})</h4>
						<div class="overflow-x-auto border border-slate-100 rounded-lg">
							<table class="w-full text-xs text-left whitespace-nowrap">
								<thead class="bg-blue-50 border-b border-blue-100 text-slate-500 font-bold uppercase tracking-wide text-[10px]">
									<tr>
										<th class="px-3 py-2">Folio</th>
										<th class="px-3 py-2">Fecha</th>
										<th class="px-3 py-2">Cliente</th>
										<th class="px-3 py-2 text-right">Base</th>
										<th class="px-3 py-2 text-right">IGV</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-slate-100">
									{#each ventasDetalle as v (v.folio)}
										<tr class="hover:bg-slate-50/70">
											<td class="px-3 py-2 font-semibold text-slate-700">{v.folio}</td>
											<td class="px-3 py-2 text-slate-600">{formatFecha(v.fecha_emision)}</td>
											<td class="px-3 py-2 text-slate-600 truncate max-w-[160px]">{v.cliente_nombre ?? '—'}</td>
											<td class="px-3 py-2 text-right text-slate-600">{formatCurrency(v.valor_venta)}</td>
											<td class="px-3 py-2 text-right font-semibold text-slate-800">{formatCurrency(v.monto_igv)}</td>
										</tr>
									{:else}
										<tr><td colspan="5" class="px-3 py-6 text-center text-slate-400">{cargandoDetalle ? 'Cargando...' : 'Sin facturas emitidas en el rango.'}</td></tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
					<div>
						<h4 class="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Compras ({comprasDetalle.length})</h4>
						<div class="overflow-x-auto border border-slate-100 rounded-lg">
							<table class="w-full text-xs text-left whitespace-nowrap">
								<thead class="bg-emerald-50 border-b border-emerald-100 text-slate-500 font-bold uppercase tracking-wide text-[10px]">
									<tr>
										<th class="px-3 py-2">Fecha</th>
										<th class="px-3 py-2">Categoría</th>
										<th class="px-3 py-2">Descripción</th>
										<th class="px-3 py-2 text-right">Base</th>
										<th class="px-3 py-2 text-right">Créd. Fiscal</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-slate-100">
									{#each comprasDetalle as c (c.id_transaccion)}
										<tr class="hover:bg-slate-50/70">
											<td class="px-3 py-2 text-slate-600">{formatFecha(c.fecha)}</td>
											<td class="px-3 py-2 text-slate-600">{c.categoria ?? '—'}</td>
											<td class="px-3 py-2 text-slate-600 truncate max-w-[160px]">{c.descripcion ?? '—'}</td>
											<td class="px-3 py-2 text-right text-slate-600">{formatCurrency(c.base_imponible)}</td>
											<td class="px-3 py-2 text-right font-semibold text-slate-800">{formatCurrency(c.credito_fiscal)}</td>
										</tr>
									{:else}
										<tr><td colspan="5" class="px-3 py-6 text-center text-slate-400">{cargandoDetalle ? 'Cargando...' : 'Sin compras registradas en el rango.'}</td></tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				</div>
			</div>
		{/if}
	</div>
{/if}

<!-- ── Modal: Configurar objetivo ──────────────────────────────────────────────────────────────── -->
{#if editandoObjetivo}
	<div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
			<div class="flex items-center justify-between mb-4">
				<h3 class="font-bold text-brand-marine text-base flex items-center gap-2"><Target size={18} class="text-blue-600" /> Configurar objetivo</h3>
				<button type="button" onclick={() => (editandoObjetivo = false)} class="text-slate-400 hover:text-slate-600" aria-label="Cerrar"><X size={18} /></button>
			</div>
			<label for="objetivo-input" class="text-xs font-semibold text-slate-500 uppercase tracking-wide">Objetivo mensual (IGV máximo a pagar)</label>
			<div class="flex items-center gap-2 mt-1 mb-4">
				<span class="text-sm text-slate-400 font-semibold">S/</span>
				<input id="objetivo-input" type="number" min="0.01" step="0.01" bind:value={objetivoInput} class="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
			</div>
			<div class="flex justify-end gap-2">
				<button type="button" onclick={() => (editandoObjetivo = false)} class="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50">Cancelar</button>
				<button type="button" onclick={guardarObjetivo} disabled={guardandoObjetivo} class="px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-semibold hover:bg-[#154a73] disabled:opacity-50">
					{guardandoObjetivo ? 'Guardando...' : 'Guardar'}
				</button>
			</div>
		</div>
	</div>
{/if}
