<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin } from '$lib/stores/permisos.svelte';
	import {
		ArrowLeft,
		Wallet,
		TrendingUp,
		TrendingDown,
		Landmark,
		Coins,
		Search,
		Download,
		Eye,
		Paperclip,
		X
	} from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { formatCurrency, type FieldOption } from '$lib/shared/fieldConfig';
	import { getCentroCostoOptions } from '$lib/modules/transacciones/services/transacciones.service';
	import type { Transaccion } from '$lib/modules/transacciones/services/transacciones.service';
	import {
		getMovimientosCaja,
		type MovimientosCajaResult,
		type FilaMovimiento,
		type TipoMovimiento
	} from '$lib/modules/transacciones/services/movimientosCaja.service';
	import TransaccionModal from '$lib/modules/transacciones/components/TransaccionModal.svelte';
	import ResponsiveDataView from '$lib/shared/components/ResponsiveDataView.svelte';
	import DocumentPreviewModal from '$lib/shared/components/DocumentPreviewModal.svelte';

	// Reporte 100% client-side (Supabase anon key) y de solo lectura sobre `transaccion` — no
	// crea/edita nada, "jala" los datos que ya generan Cuentas por Pagar/Cobrar y Transacciones.
	// Misma nota de seguridad que el resto del ERP: la BD no tiene RLS real, este guard (isAdmin())
	// es solo de UI.

	const CATEGORIAS_EGRESO = ['G. Operativos', 'G. Administrativos', 'Servicios', 'Materiales'];

	// Colores fijos por categoría (nunca se reasignan según el filtro activo — ver skill de dataviz):
	// Ingreso=azul, Egreso=rojo, Financiamiento=violeta, Saldo Inicial=gris neutro.
	const TIPO_COLOR: Record<string, string> = {
		ingreso: '#2a78d6',
		egreso: '#e34948',
		financiamiento: '#4a3aa7',
		saldo_inicial: '#898781'
	};
	const TIPO_BADGE_CLASS: Record<string, string> = {
		ingreso: 'bg-blue-100 text-blue-700',
		egreso: 'bg-red-100 text-red-700',
		financiamiento: 'bg-violet-100 text-violet-700',
		saldo_inicial: 'bg-slate-200 text-slate-600'
	};
	const TIPO_LABEL: Record<string, string> = {
		ingreso: 'Ingreso',
		egreso: 'Egreso',
		financiamiento: 'Financiamiento',
		saldo_inicial: 'Saldo Inicial'
	};
	// Mismo orden fijo de slots categóricos del sistema (1 azul, 2 aqua, 3 amarillo, 4 verde).
	const CATEGORIA_EGRESO_COLOR: Record<string, string> = {
		'G. Operativos': '#2a78d6',
		'G. Administrativos': '#1baf7a',
		Servicios: '#eda100',
		Materiales: '#008300'
	};

	let mes = $state(new Date().toISOString().slice(0, 7)); // 'YYYY-MM'
	let idCentroCosto = $state<string>('');
	let tipoFiltro = $state<TipoMovimiento | ''>('');
	let categoriaFiltro = $state<string>('');
	let search = $state('');
	let searchInput = $state('');
	let debounceTimer: ReturnType<typeof setTimeout>;

	let centroCostoOptions = $state<FieldOption[]>([]);
	let resultado = $state<MovimientosCajaResult | null>(null);
	let loading = $state(true);
	let loadError = $state('');
	let pageNum = $state(1);
	const PAGE_SIZE = 12;

	function primerYUltimoDia(mesStr: string): { desde: string; hasta: string } {
		const [y, m] = mesStr.split('-').map(Number);
		const primerDia = new Date(Date.UTC(y, m - 1, 1));
		const ultimoDia = new Date(Date.UTC(y, m, 0));
		const toISO = (d: Date) => d.toISOString().slice(0, 10);
		return { desde: toISO(primerDia), hasta: toISO(ultimoDia) };
	}

	// `desde`/`hasta` son el filtro de fecha real (al mismo nivel que Centro de Costo/Categoría en la
	// fila de filtros) — se pueden editar sueltos para acotar el período dentro (o más allá) del mes.
	// El selector de mes de arriba es solo un atajo: cada vez que cambia, reinicia el rango a ese mes
	// completo, pero después el usuario puede angostarlo o ampliarlo con los inputs de fecha.
	let desde = $state('');
	let hasta = $state('');
	$effect(() => {
		const b = primerYUltimoDia(mes);
		desde = b.desde;
		hasta = b.hasta;
	});

	let modalOpen = $state(false);
	let editingTransaccion = $state<Transaccion | null>(null);
	const transaccionDynamicOptions = $derived({ id_centro_costo_origen: centroCostoOptions, id_centro_costo_destino: centroCostoOptions });

	// Previsualización rápida del comprobante desde la fila, sin abrir el formulario completo.
	let previewOpen = $state(false);
	let previewUrl = $state('');
	let previewTitle = $state('');
	function openComprobantePreview(transaccion: Transaccion) {
		previewUrl = transaccion.comprobante_url ?? '';
		previewTitle = `Comprobante - ${transaccion.num_documento || 'Transacción'}`;
		previewOpen = true;
	}

	async function fetchData() {
		loading = true;
		try {
			resultado = await getMovimientosCaja(supabase, {
				desde,
				hasta,
				idCentroCosto: idCentroCosto ? Number(idCentroCosto) : null,
				tipo: tipoFiltro || null,
				categoria: categoriaFiltro || null,
				search
			});
			loadError = '';
			pageNum = 1;
		} catch (err: any) {
			loadError = err?.message ?? 'No se pudo cargar el reporte de movimientos de caja';
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		if (!isAdmin()) {
			goto('/dashboard');
			return;
		}
		try {
			centroCostoOptions = await getCentroCostoOptions(supabase);
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar los centros de costo');
		}
		await fetchData();
	});

	// Cualquier cambio de filtro/periodo vuelve a consultar — el cálculo de saldo acumulado depende
	// de traer todo el período de nuevo (ver nota AJUSTAR en movimientosCaja.service.ts).
	$effect(() => {
		void desde;
		void hasta;
		void idCentroCosto;
		void tipoFiltro;
		void categoriaFiltro;
		void search;
		fetchData();
	});

	function onSearchInput(value: string) {
		searchInput = value;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => (search = value), 400);
	}

	function formatDate(value: string) {
		const d = new Date(value);
		if (Number.isNaN(d.getTime())) return '—';
		return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
	}

	const filasFiltradas = $derived(resultado?.filas ?? []);
	const totalPages = $derived(Math.max(1, Math.ceil(filasFiltradas.length / PAGE_SIZE)));
	const filasPagina = $derived(filasFiltradas.slice((pageNum - 1) * PAGE_SIZE, pageNum * PAGE_SIZE));

	function goToPage(p: number) {
		if (p < 1 || p > totalPages) return;
		pageNum = p;
	}

	// ── Gráfico 1: Resumen por tipo de movimiento ──────────────────────────────
	const resumenTipo = $derived.by(() => {
		if (!resultado) return [];
		const items = [
			{ tipo: 'ingreso', label: 'Ingresos', monto: resultado.ingresosTotal },
			{ tipo: 'egreso', label: 'Egresos', monto: resultado.egresosTotal },
			{ tipo: 'financiamiento', label: 'Financiamientos', monto: resultado.financiamientosTotal },
			{ tipo: 'saldo_inicial', label: 'Saldo Inicial', monto: Math.abs(resultado.saldoInicial) }
		].filter((i) => i.monto > 0);
		const total = items.reduce((s, i) => s + i.monto, 0) || 1;
		return items.map((i) => ({ ...i, pct: (i.monto / total) * 100, color: TIPO_COLOR[i.tipo] }));
	});

	// ── Gráfico 2: Distribución de egresos por categoría ────────────────────────
	const distribucionEgresos = $derived.by(() => {
		if (!resultado) return [];
		const porCategoria = new Map<string, number>();
		for (const f of resultado.filas) {
			if (f.tipo === 'egreso' && f.egreso) {
				const cat = f.categoria || 'Sin categoría';
				porCategoria.set(cat, (porCategoria.get(cat) ?? 0) + f.egreso);
			}
		}
		const total = [...porCategoria.values()].reduce((s, v) => s + v, 0) || 1;
		return [...porCategoria.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([categoria, monto]) => ({
				categoria,
				monto,
				pct: (monto / total) * 100,
				color: CATEGORIA_EGRESO_COLOR[categoria] ?? '#898781'
			}));
	});

	// ── Gráfico 3: Flujo de caja del período (barras) ───────────────────────────
	const flujoCaja = $derived.by(() => {
		if (!resultado) return [];
		const valores = [
			{ label: 'Saldo Inicial', monto: resultado.saldoInicial, color: TIPO_COLOR.saldo_inicial },
			{ label: '+ Ingresos', monto: resultado.ingresosTotal, color: TIPO_COLOR.ingreso },
			{ label: '- Egresos', monto: resultado.egresosTotal, color: TIPO_COLOR.egreso },
			{ label: '+ Financiamientos', monto: resultado.financiamientosTotal, color: TIPO_COLOR.financiamiento },
			{ label: 'Saldo Final', monto: resultado.saldoActual, color: '#0f3b5e' }
		];
		const max = Math.max(...valores.map((v) => v.monto), 1);
		return valores.map((v) => ({ ...v, pct: (v.monto / max) * 100 }));
	});

	/** Genera el `stroke-dasharray`/`stroke-dashoffset` de cada segmento de una dona SVG a partir de
	 * porcentajes acumulados (radio 40, circunferencia = 2*PI*40). */
	function donutSegments(items: { pct: number }[]): { dasharray: string; dashoffset: number }[] {
		const circumference = 2 * Math.PI * 40;
		let acumulado = 0;
		return items.map((i) => {
			const length = (i.pct / 100) * circumference;
			const seg = { dasharray: `${length} ${circumference - length}`, dashoffset: -((acumulado / 100) * circumference) };
			acumulado += i.pct;
			return seg;
		});
	}
	const resumenTipoSegments = $derived(donutSegments(resumenTipo));
	const distribucionEgresosSegments = $derived(donutSegments(distribucionEgresos));

	function exportarCSV() {
		if (!resultado) return;
		const encabezados = ['Fecha', 'Tipo', 'Código', 'Concepto', 'Cuenta Interna Origen', 'Cuenta Interna Destino', 'Categoría', 'Ingresos', 'Egresos', 'Financiamientos', 'Saldo Acumulado'];
		const filas = filasFiltradas.map((f) => [
			formatDate(f.fecha),
			TIPO_LABEL[f.tipo] ?? f.tipo,
			f.codigo,
			f.concepto,
			f.centroCostoOrigenLabel,
			f.centroCostoDestinoLabel,
			f.categoria ?? '',
			f.ingreso ?? '',
			f.egreso ?? '',
			f.financiamiento ?? '',
			f.saldoAcumulado
		]);
		const csv = [encabezados, ...filas]
			.map((fila) => fila.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
			.join('\n');
		const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `movimientos-caja-${mes}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function openView(transaccion: Transaccion) {
		editingTransaccion = transaccion;
		modalOpen = true;
	}
	function closeModal() {
		modalOpen = false;
		editingTransaccion = null;
	}
	async function handleTransaccionSaved() {
		await fetchData();
	}
</script>

<div class="max-w-7xl mx-auto">
	<div class="flex items-center justify-between mb-6 flex-wrap gap-3">
		<div class="flex items-center gap-3">
			<button type="button" onclick={() => goto('/finanzas/tranzacciones')} class="p-2 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50" aria-label="Volver a Transacciones">
				<ArrowLeft size={18} />
			</button>
			<Wallet class="text-[#0f3b5e]" size={26} />
			<div>
				<h1 class="text-xl font-bold text-[#0f3b5e]">Movimientos de Caja y Financiamiento</h1>
				<p class="text-sm text-slate-500">Control detallado de ingresos, egresos y financiamientos</p>
			</div>
		</div>
		<input
			type="month"
			bind:value={mes}
			class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
		/>
	</div>

	{#if loadError}
		<div class="mb-4 bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm">{loadError}</div>
	{/if}

	<!-- KPIs -->
	<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center"><Wallet size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Saldo Inicial del Mes</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(resultado?.saldoInicial ?? 0)}</p>
			<p class="text-[11px] text-slate-400 mt-1">Saldo al {formatDate(desde)}</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center"><TrendingUp size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Ingresos del Mes</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(resultado?.ingresosTotal ?? 0)}</p>
			<p class="text-[11px] text-slate-400 mt-1">{resultado?.ingresosCount ?? 0} movimientos</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-red-100 text-red-600 flex items-center justify-center"><TrendingDown size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Egresos del Mes</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(resultado?.egresosTotal ?? 0)}</p>
			<p class="text-[11px] text-slate-400 mt-1">{resultado?.egresosCount ?? 0} movimientos</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-violet-100 text-violet-600 flex items-center justify-center"><Landmark size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Financiamientos del Mes</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(resultado?.financiamientosTotal ?? 0)}</p>
			<p class="text-[11px] text-slate-400 mt-1">{resultado?.financiamientosCount ?? 0} movimientos</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center"><Coins size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Saldo Actual</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(resultado?.saldoActual ?? 0)}</p>
			<p class="text-[11px] text-slate-400 mt-1">Saldo al {formatDate(hasta)}</p>
		</div>
	</div>

	<!-- Filtros -->
	<div class="bg-white rounded-xl border border-slate-200 p-4 mb-4 flex flex-wrap items-center gap-3">
		<select bind:value={idCentroCosto} class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200">
			<option value="">Centro de Costo: Todos</option>
			{#each centroCostoOptions as opt}
				<option value={opt.value}>{opt.label}</option>
			{/each}
		</select>
		<select bind:value={categoriaFiltro} class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200">
			<option value="">Categoría: Todas</option>
			{#each ['Consultoría', 'Ingresos por Servicios', ...CATEGORIAS_EGRESO, 'Préstamos'] as cat}
				<option value={cat}>{cat}</option>
			{/each}
		</select>
		<div class="flex items-center gap-1.5">
			<input
				type="date"
				bind:value={desde}
				max={hasta}
				class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
				aria-label="Desde"
			/>
			<span class="text-slate-400 text-sm">—</span>
			<input
				type="date"
				bind:value={hasta}
				min={desde}
				class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
				aria-label="Hasta"
			/>
		</div>
		<div class="relative flex-1 min-w-[220px]">
			<Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
			<input
				type="text"
				value={searchInput}
				oninput={(e) => onSearchInput((e.target as HTMLInputElement).value)}
				placeholder="Buscar movimiento..."
				class="w-full pl-9 pr-8 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
			/>
			{#if searchInput}
				<button type="button" onclick={() => onSearchInput('')} class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Limpiar búsqueda">
					<X size={14} />
				</button>
			{/if}
		</div>
		<button type="button" onclick={exportarCSV} class="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50">
			<Download size={16} /> Exportar
		</button>
	</div>

	<!-- Tabs (tipo de movimiento) -->
	<div class="flex items-center gap-1 mb-4 border-b border-slate-200">
		{#each [{ value: '', label: 'Todos los Movimientos' }, { value: 'ingreso', label: 'Ingresos' }, { value: 'egreso', label: 'Egresos' }, { value: 'financiamiento', label: 'Financiamientos' }] as tab}
			<button
				type="button"
				onclick={() => (tipoFiltro = tab.value as TipoMovimiento | '')}
				class={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tipoFiltro === tab.value ? 'border-[#0f3b5e] text-[#0f3b5e]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
			>
				{tab.label}
			</button>
		{/each}
	</div>

	<!-- Tabla / Tarjetas -->
	<div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
		<div class="overflow-x-auto">
			<ResponsiveDataView
				items={filasPagina}
				keyField="codigo"
				colspan={12}
				emptyMessage={loading ? 'Cargando...' : 'Sin movimientos en este período.'}
			>
				{#snippet header()}
					<th class="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Fecha</th>
					<th class="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Tipo</th>
					<th class="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Código</th>
					<th class="text-left px-3 py-2 font-semibold text-slate-600">Concepto</th>
					<th class="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Cuenta Interna Origen</th>
					<th class="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Cuenta Interna Destino</th>
					<th class="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Categoría</th>
					<th class="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Ingresos (S/)</th>
					<th class="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Egresos (S/)</th>
					<th class="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Financiamientos (S/)</th>
					<th class="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Saldo Acumulado (S/)</th>
					<th class="text-right px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Acciones</th>
				{/snippet}
				{#snippet row(fila)}
					<td class="px-3 py-2 whitespace-nowrap">{formatDate(fila.fecha)}</td>
					<td class="px-3 py-2 whitespace-nowrap">
						<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${TIPO_BADGE_CLASS[fila.tipo] ?? 'bg-slate-100 text-slate-600'}`}>
							{TIPO_LABEL[fila.tipo] ?? fila.tipo}
						</span>
					</td>
					<td class="px-3 py-2 whitespace-nowrap font-mono text-xs text-slate-500">{fila.codigo}</td>
					<td class="px-3 py-2 max-w-[220px] truncate">{fila.concepto}</td>
					<td class="px-3 py-2 whitespace-nowrap">{fila.centroCostoOrigenLabel}</td>
					<td class="px-3 py-2 whitespace-nowrap">{fila.centroCostoDestinoLabel}</td>
					<td class="px-3 py-2 whitespace-nowrap">{fila.categoria ?? '—'}</td>
					<td class="px-3 py-2 text-right whitespace-nowrap text-emerald-700">{fila.ingreso ? formatCurrency(fila.ingreso) : '—'}</td>
					<td class="px-3 py-2 text-right whitespace-nowrap text-red-700">{fila.egreso ? formatCurrency(fila.egreso) : '—'}</td>
					<td class="px-3 py-2 text-right whitespace-nowrap text-violet-700">{fila.financiamiento ? formatCurrency(fila.financiamiento) : '—'}</td>
					<td class="px-3 py-2 text-right whitespace-nowrap font-semibold text-slate-800">{formatCurrency(fila.saldoAcumulado)}</td>
					<td class="px-3 py-2 text-right whitespace-nowrap">
						{#if !fila.esSaldoInicial && fila.raw}
							{#if (fila.raw as Transaccion).comprobante_url}
								<button
									type="button"
									onclick={() => openComprobantePreview(fila.raw as Transaccion)}
									class="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600"
									title="Ver comprobante"
									aria-label="Ver comprobante"
								>
									<Paperclip size={16} />
								</button>
							{/if}
							<button
								type="button"
								onclick={() => openView(fila.raw as Transaccion)}
								class="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600"
								title="Ver / editar transacción"
								aria-label="Ver / editar transacción"
							>
								<Eye size={16} />
							</button>
						{/if}
					</td>
				{/snippet}
				{#snippet card(fila)}
					<div class="flex items-start justify-between gap-3 mb-2">
						<div class="min-w-0">
							<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${TIPO_BADGE_CLASS[fila.tipo] ?? 'bg-slate-100 text-slate-600'}`}>
								{TIPO_LABEL[fila.tipo] ?? fila.tipo}
							</span>
							<div class="font-semibold text-slate-800 truncate mt-1">{fila.concepto}</div>
						</div>
						<div class="text-right shrink-0">
							{#if fila.ingreso}<div class="font-bold text-emerald-700">+{formatCurrency(fila.ingreso)}</div>{/if}
							{#if fila.egreso}<div class="font-bold text-red-700">-{formatCurrency(fila.egreso)}</div>{/if}
							{#if fila.financiamiento}<div class="font-bold text-violet-700">{formatCurrency(fila.financiamiento)}</div>{/if}
							<div class="text-[11px] text-slate-400">{formatDate(fila.fecha)}</div>
						</div>
					</div>
					<div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mb-3">
						<span class="text-slate-400">Código</span>
						<span class="text-right font-mono text-slate-600">{fila.codigo}</span>
						<span class="text-slate-400">Categoría</span>
						<span class="text-right text-slate-700">{fila.categoria ?? '—'}</span>
						<span class="text-slate-400">Cuenta Origen</span>
						<span class="text-right text-slate-700 truncate">{fila.centroCostoOrigenLabel}</span>
						<span class="text-slate-400">Cuenta Destino</span>
						<span class="text-right text-slate-700 truncate">{fila.centroCostoDestinoLabel}</span>
						<span class="text-slate-400">Saldo Acumulado</span>
						<span class="text-right font-semibold text-slate-800">{formatCurrency(fila.saldoAcumulado)}</span>
					</div>
					{#if !fila.esSaldoInicial && fila.raw}
						<div class="pt-2 border-t border-slate-100 flex gap-2">
							{#if (fila.raw as Transaccion).comprobante_url}
								<button
									type="button"
									onclick={() => openComprobantePreview(fila.raw as Transaccion)}
									class="flex-1 h-10 rounded-lg border border-slate-200 text-slate-600 flex items-center justify-center gap-2 text-xs font-medium active:bg-slate-50"
								>
									<Paperclip size={14} /> Comprobante
								</button>
							{/if}
							<button
								type="button"
								onclick={() => openView(fila.raw as Transaccion)}
								class="flex-1 h-10 rounded-lg border border-slate-200 text-slate-600 flex items-center justify-center gap-2 text-xs font-medium active:bg-slate-50"
							>
								<Eye size={14} /> Ver / editar
							</button>
						</div>
					{/if}
				{/snippet}
			</ResponsiveDataView>
		</div>

		<div class="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-sm text-slate-500">
			<span>
				Mostrando {filasFiltradas.length === 0 ? 0 : (pageNum - 1) * PAGE_SIZE + 1} a {Math.min(pageNum * PAGE_SIZE, filasFiltradas.length)} de {filasFiltradas.length} movimientos
			</span>
			<div class="flex items-center gap-2">
				<button type="button" onclick={() => goToPage(pageNum - 1)} disabled={pageNum <= 1} class="px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50">Anterior</button>
				{#each Array(totalPages) as _, i}
					{#if i + 1 === pageNum || i === 0 || i === totalPages - 1 || Math.abs(i + 1 - pageNum) <= 1}
						<button
							type="button"
							onclick={() => goToPage(i + 1)}
							class={`w-8 h-8 rounded-lg text-xs font-medium ${pageNum === i + 1 ? 'bg-[#0f3b5e] text-white' : 'border border-slate-300 hover:bg-slate-50'}`}
						>
							{i + 1}
						</button>
					{:else if Math.abs(i + 1 - pageNum) === 2}
						<span class="text-slate-400">…</span>
					{/if}
				{/each}
				<button type="button" onclick={() => goToPage(pageNum + 1)} disabled={pageNum >= totalPages} class="px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50">Siguiente</button>
			</div>
		</div>
	</div>

	<!-- Gráficos -->
	<div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<h3 class="text-xs font-semibold text-slate-500 tracking-wide mb-4">RESUMEN POR TIPO DE MOVIMIENTO</h3>
			{#if resumenTipo.length === 0}
				<p class="text-sm text-slate-400 text-center py-8">Sin datos en este período.</p>
			{:else}
				<div class="flex items-center gap-4">
					<svg viewBox="0 0 100 100" width="110" height="110" role="img" aria-label="Resumen por tipo de movimiento">
						<circle cx="50" cy="50" r="40" fill="none" stroke="#e1e0d9" stroke-width="14" />
						{#each resumenTipo as item, i}
							<circle
								cx="50" cy="50" r="40" fill="none" stroke={item.color} stroke-width="14"
								stroke-dasharray={resumenTipoSegments[i].dasharray}
								stroke-dashoffset={resumenTipoSegments[i].dashoffset}
								transform="rotate(-90 50 50)"
							>
								<title>{item.label}: {formatCurrency(item.monto)} ({item.pct.toFixed(1)}%)</title>
							</circle>
						{/each}
					</svg>
					<ul class="flex-1 space-y-1.5 text-xs">
						{#each resumenTipo as item}
							<li class="flex items-center gap-2">
								<span class="w-2.5 h-2.5 rounded-full shrink-0" style={`background:${item.color}`}></span>
								<span class="text-slate-600 flex-1">{item.label}</span>
								<span class="font-semibold text-slate-800">{formatCurrency(item.monto)}</span>
								<span class="text-slate-400 w-10 text-right">{item.pct.toFixed(1)}%</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>

		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<h3 class="text-xs font-semibold text-slate-500 tracking-wide mb-4">DISTRIBUCIÓN DE EGRESOS</h3>
			{#if distribucionEgresos.length === 0}
				<p class="text-sm text-slate-400 text-center py-8">Sin egresos en este período.</p>
			{:else}
				<div class="flex items-center gap-4">
					<svg viewBox="0 0 100 100" width="110" height="110" role="img" aria-label="Distribución de egresos por categoría">
						<circle cx="50" cy="50" r="40" fill="none" stroke="#e1e0d9" stroke-width="14" />
						{#each distribucionEgresos as item, i}
							<circle
								cx="50" cy="50" r="40" fill="none" stroke={item.color} stroke-width="14"
								stroke-dasharray={distribucionEgresosSegments[i].dasharray}
								stroke-dashoffset={distribucionEgresosSegments[i].dashoffset}
								transform="rotate(-90 50 50)"
							>
								<title>{item.categoria}: {formatCurrency(item.monto)} ({item.pct.toFixed(1)}%)</title>
							</circle>
						{/each}
					</svg>
					<ul class="flex-1 space-y-1.5 text-xs">
						{#each distribucionEgresos as item}
							<li class="flex items-center gap-2">
								<span class="w-2.5 h-2.5 rounded-full shrink-0" style={`background:${item.color}`}></span>
								<span class="text-slate-600 flex-1">{item.categoria}</span>
								<span class="font-semibold text-slate-800">{formatCurrency(item.monto)}</span>
								<span class="text-slate-400 w-10 text-right">{item.pct.toFixed(1)}%</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>

		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<h3 class="text-xs font-semibold text-slate-500 tracking-wide mb-4">FLUJO DE CAJA DEL PERÍODO</h3>
			{#if flujoCaja.length === 0}
				<p class="text-sm text-slate-400 text-center py-8">Sin datos en este período.</p>
			{:else}
				<div class="flex items-end justify-between gap-2 h-32">
					{#each flujoCaja as barra}
						<div class="flex-1 flex flex-col items-center justify-end h-full gap-1">
							<span class="text-[10px] font-semibold text-slate-700 whitespace-nowrap">{formatCurrency(barra.monto)}</span>
							<div
								class="w-full rounded-t"
								style={`height:${Math.max(barra.pct, 3)}%; background:${barra.color}`}
								title={`${barra.label}: ${formatCurrency(barra.monto)}`}
							></div>
						</div>
					{/each}
				</div>
				<div class="flex justify-between gap-2 mt-2">
					{#each flujoCaja as barra}
						<span class="flex-1 text-center text-[10px] text-slate-500 leading-tight">{barra.label}</span>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>

<TransaccionModal
	open={modalOpen}
	mode="edit"
	transaccion={editingTransaccion}
	dynamicOptions={transaccionDynamicOptions}
	onClose={closeModal}
	onSaved={handleTransaccionSaved}
/>
<DocumentPreviewModal open={previewOpen} url={previewUrl} title={previewTitle} onClose={() => (previewOpen = false)} />
