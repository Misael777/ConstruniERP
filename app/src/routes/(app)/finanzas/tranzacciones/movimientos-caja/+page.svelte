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
		X,
		Banknote,
		Building2,
		Smartphone
	} from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { formatCurrency, getOptionLabel, type FieldOption } from '$lib/shared/fieldConfig';
	import { FIELDS_CONFIG } from '$lib/modules/transacciones/config/transaccion.config';
	import {
		getCentroCostoOptions,
		getCentroCostoOptionsProyectos,
		getCentroCostoOptionsExternos,
		getCentroCostoOptionsExternosOrigen,
		getCentroCostoOptionsSoloCentros
	} from '$lib/modules/transacciones/services/transacciones.service';
	import { getCuentaBancoOptions } from '$lib/modules/cuentas-bancarias/services/cuentaBanco.service';
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
	// A pedido del usuario (diseño de referencia): semáforo de colores en vez del azul/gris neutro que
	// usa el badge de Estado en finanzas/tranzacciones/+page.svelte — acá vale más distinguir de un
	// vistazo lo normal (activo) de lo anulado/en consulta.
	const ESTADO_BADGE_CLASS: Record<string, string> = {
		activo: 'bg-emerald-100 text-emerald-700',
		anulado: 'bg-red-100 text-red-700',
		consulta: 'bg-amber-100 text-amber-700'
	};
	const estadoField = FIELDS_CONFIG.find((f) => f.key === 'estado')!;
	const medioPagoField = FIELDS_CONFIG.find((f) => f.key === 'medio_pago')!;
	// Ícono + color por Medio de Pago (diseño de referencia: cada método trae su propio ícono, no solo
	// texto) — códigos ver transaccion.config.ts (1=Efectivo, 2=Transferencia bancaria, 3=Depósito
	// bancario, 4=Yape o Plin).
	const MEDIO_PAGO_ICON: Record<string, typeof Banknote> = {
		'1': Banknote,
		'2': Landmark,
		'3': Building2,
		'4': Smartphone
	};
	const MEDIO_PAGO_COLOR: Record<string, string> = {
		'1': 'text-emerald-600',
		'2': 'text-blue-600',
		'3': 'text-violet-600',
		'4': 'text-rose-600'
	};

	let mes = $state(new Date().toISOString().slice(0, 7)); // 'YYYY-MM'
	let idCentroCosto = $state<string>('');
	let tipoFiltro = $state<TipoMovimiento | ''>('');
	let categoriaFiltro = $state<string>('');
	let search = $state('');
	let searchInput = $state('');
	let debounceTimer: ReturnType<typeof setTimeout>;

	let centroCostoOptions = $state<FieldOption[]>([]);
	/** Solo para Origen/Destino de Transacción en el modal (ver getCentroCostoOptionsProyectos/
	 * getCentroCostoOptionsExternos) — el filtro de esta página sigue usando centroCostoOptions completo. */
	let centroCostoProyectosOptions = $state<FieldOption[]>([]);
	let centroCostoExternosDestinoOptions = $state<FieldOption[]>([]);
	let centroCostoExternosOrigenOptions = $state<FieldOption[]>([]);
	let centroCostoSoloCentrosOptions = $state<FieldOption[]>([]);
	let cuentaBancoOptions = $state<FieldOption[]>([]);
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
	const transaccionDynamicOptions = $derived({
		id_centro_costo_origen: centroCostoProyectosOptions,
		id_centro_costo_destino: centroCostoProyectosOptions,
		id_centro_costo_origen_externo: centroCostoExternosOrigenOptions,
		id_centro_costo_destino_externo: centroCostoExternosDestinoOptions,
		id_centro_costo_destino_solo_centros: centroCostoSoloCentrosOptions,
		cuenta_banco: cuentaBancoOptions
	});

	// Previsualización rápida de los documentos (comprobante + factura, si tiene) desde la fila, sin
	// abrir el formulario completo — a pedido del usuario, un solo ícono (ojo) que deja elegir entre
	// ambos con el selector de pastillas de DocumentPreviewModal en vez de un ícono de clip aparte.
	let previewOpen = $state(false);
	let previewTitle = $state('');
	let previewDocuments = $state<{ url: string; label: string }[]>([]);
	function openDocumentosPreview(transaccion: Transaccion) {
		previewDocuments = [
			...(transaccion.comprobante_url ? [{ url: transaccion.comprobante_url, label: 'Comprobante' }] : []),
			...(transaccion.factura_url ? [{ url: transaccion.factura_url, label: 'Factura o boleta' }] : [])
		];
		previewTitle = `Documentos - ${transaccion.num_documento || 'Transacción'}`;
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
			const [completo, proyectos, externosDestino, externosOrigen, soloCentros, bancos] = await Promise.all([
				getCentroCostoOptions(supabase),
				getCentroCostoOptionsProyectos(supabase),
				getCentroCostoOptionsExternos(supabase),
				getCentroCostoOptionsExternosOrigen(supabase),
				getCentroCostoOptionsSoloCentros(supabase),
				getCuentaBancoOptions(supabase)
			]);
			centroCostoOptions = completo;
			centroCostoProyectosOptions = proyectos;
			centroCostoExternosDestinoOptions = externosDestino;
			centroCostoExternosOrigenOptions = externosOrigen;
			centroCostoSoloCentrosOptions = soloCentros;
			cuentaBancoOptions = bancos;
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

<div class="w-full max-w-none">
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
	<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
		<div class="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
			<div class="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0"><Wallet size={22} /></div>
			<div class="min-w-0">
				<p class="text-xs font-medium text-slate-500 truncate">Saldo Inicial del Mes</p>
				<p class="text-xl font-bold text-slate-800 truncate">{formatCurrency(resultado?.saldoInicial ?? 0)}</p>
				<p class="text-[11px] text-slate-400 truncate">Saldo al {formatDate(desde)}</p>
			</div>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
			<div class="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0"><TrendingUp size={22} /></div>
			<div class="min-w-0">
				<p class="text-xs font-medium text-slate-500 truncate">Ingresos del Mes</p>
				<p class="text-xl font-bold text-slate-800 truncate">{formatCurrency(resultado?.ingresosTotal ?? 0)}</p>
				<p class="text-[11px] text-slate-400 truncate">{resultado?.ingresosCount ?? 0} movimientos</p>
			</div>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
			<div class="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0"><TrendingDown size={22} /></div>
			<div class="min-w-0">
				<p class="text-xs font-medium text-slate-500 truncate">Egresos del Mes</p>
				<p class="text-xl font-bold text-slate-800 truncate">{formatCurrency(resultado?.egresosTotal ?? 0)}</p>
				<p class="text-[11px] text-slate-400 truncate">{resultado?.egresosCount ?? 0} movimientos</p>
			</div>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
			<div class="w-12 h-12 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center shrink-0"><Landmark size={22} /></div>
			<div class="min-w-0">
				<p class="text-xs font-medium text-slate-500 truncate">Financiamientos del Mes</p>
				<p class="text-xl font-bold text-slate-800 truncate">{formatCurrency(resultado?.financiamientosTotal ?? 0)}</p>
				<p class="text-[11px] text-slate-400 truncate">{resultado?.financiamientosCount ?? 0} movimientos</p>
			</div>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
			<div class="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center shrink-0"><Coins size={22} /></div>
			<div class="min-w-0">
				<p class="text-xs font-medium text-slate-500 truncate">Saldo Actual</p>
				<p class="text-xl font-bold text-slate-800 truncate">{formatCurrency(resultado?.saldoActual ?? 0)}</p>
				<p class="text-[11px] text-slate-400 truncate">Saldo al {formatDate(hasta)}</p>
			</div>
		</div>
	</div>

	<!-- Filtros -->
	<div class="bg-white rounded-xl border border-slate-200 p-4 mb-4">
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
			<div>
				<label for="mc-centro-costo" class="block text-xs font-medium text-slate-500 mb-1">Centro de Costo</label>
				<select id="mc-centro-costo" bind:value={idCentroCosto} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200">
					<option value="">Todos</option>
					{#each centroCostoOptions as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			</div>
			<div>
				<label for="mc-categoria" class="block text-xs font-medium text-slate-500 mb-1">Categoría</label>
				<select id="mc-categoria" bind:value={categoriaFiltro} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200">
					<option value="">Todas</option>
					{#each ['Consultoría', 'Ingresos por Servicios', ...CATEGORIAS_EGRESO, 'Préstamos'] as cat}
						<option value={cat}>{cat}</option>
					{/each}
				</select>
			</div>
			<div>
				<label for="mc-desde" class="block text-xs font-medium text-slate-500 mb-1">Fecha inicio</label>
				<input
					id="mc-desde"
					type="date"
					bind:value={desde}
					max={hasta}
					class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
				/>
			</div>
			<div>
				<label for="mc-hasta" class="block text-xs font-medium text-slate-500 mb-1">Fecha fin</label>
				<input
					id="mc-hasta"
					type="date"
					bind:value={hasta}
					min={desde}
					class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
				/>
			</div>
		</div>
		<div class="flex flex-wrap items-end gap-3 mt-3">
			<div class="relative flex-1 min-w-[220px]">
				<label for="mc-buscar" class="block text-xs font-medium text-slate-500 mb-1">Buscar</label>
				<Search size={16} class="absolute left-3 top-[calc(50%+0.5rem)] -translate-y-1/2 text-slate-400" />
				<input
					id="mc-buscar"
					type="text"
					value={searchInput}
					oninput={(e) => onSearchInput((e.target as HTMLInputElement).value)}
					placeholder="Buscar movimiento..."
					class="w-full pl-9 pr-8 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
				/>
				{#if searchInput}
					<button type="button" onclick={() => onSearchInput('')} class="absolute right-2 top-[calc(50%+0.5rem)] -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Limpiar búsqueda">
						<X size={14} />
					</button>
				{/if}
			</div>
			<button type="button" onclick={exportarCSV} class="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50">
				<Download size={16} /> Exportar
			</button>
		</div>
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
				colspan={14}
				emptyMessage={loading ? 'Cargando...' : 'Sin movimientos en este período.'}
				onRowClick={(fila) => { if (!fila.esSaldoInicial && fila.raw) openView(fila.raw as Transaccion); }}
			>
				{#snippet header()}
					<th class="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Fecha</th>
					<th class="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Tipo</th>
					<th class="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Código</th>
					<th class="text-left px-3 py-2 font-semibold text-slate-600">Concepto</th>
					<th class="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Cuenta Interna Origen</th>
					<th class="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Cuenta Interna Destino</th>
					<th class="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Categoría</th>
					<th class="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Estado</th>
					<th class="text-left px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">Método de Pago</th>
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
					<td class="px-3 py-2 whitespace-nowrap">
						{#if fila.raw?.estado}
							<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${ESTADO_BADGE_CLASS[fila.raw.estado] ?? 'bg-slate-100 text-slate-600'}`}>
								{getOptionLabel(estadoField, fila.raw.estado)}
							</span>
						{:else}
							—
						{/if}
					</td>
					<td class="px-3 py-2 whitespace-nowrap">
						{#if fila.raw?.medio_pago}
							{@const MedioPagoIcon = MEDIO_PAGO_ICON[fila.raw.medio_pago] ?? Wallet}
							<span class={`inline-flex items-center gap-1.5 ${MEDIO_PAGO_COLOR[fila.raw.medio_pago] ?? 'text-slate-500'}`}>
								<MedioPagoIcon size={14} />
								<span class="text-slate-700">{getOptionLabel(medioPagoField, fila.raw.medio_pago)}</span>
							</span>
						{:else}
							—
						{/if}
					</td>
					<td class="px-3 py-2 text-right whitespace-nowrap text-emerald-700">{fila.ingreso ? formatCurrency(fila.ingreso) : '—'}</td>
					<td class="px-3 py-2 text-right whitespace-nowrap text-red-700">{fila.egreso ? formatCurrency(fila.egreso) : '—'}</td>
					<td class="px-3 py-2 text-right whitespace-nowrap text-violet-700">{fila.financiamiento ? formatCurrency(fila.financiamiento) : '—'}</td>
					<td class="px-3 py-2 text-right whitespace-nowrap font-semibold text-slate-800">{formatCurrency(fila.saldoAcumulado)}</td>
					<td class="px-3 py-2 text-right whitespace-nowrap">
						{#if !fila.esSaldoInicial && fila.raw && (fila.raw as Transaccion).comprobante_url}
							<button
								type="button"
								onclick={(e) => { e.stopPropagation(); openDocumentosPreview(fila.raw as Transaccion); }}
								class="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600"
								title="Ver documentos"
								aria-label="Ver documentos"
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
						<span class="text-slate-400">Estado</span>
						<span class="text-right">
							{#if fila.raw?.estado}
								<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${ESTADO_BADGE_CLASS[fila.raw.estado] ?? 'bg-slate-100 text-slate-600'}`}>
									{getOptionLabel(estadoField, fila.raw.estado)}
								</span>
							{:else}
								<span class="text-slate-700">—</span>
							{/if}
						</span>
						<span class="text-slate-400">Método de Pago</span>
						<span class="text-right">
							{#if fila.raw?.medio_pago}
								{@const MedioPagoIcon = MEDIO_PAGO_ICON[fila.raw.medio_pago] ?? Wallet}
								<span class={`inline-flex items-center gap-1.5 justify-end ${MEDIO_PAGO_COLOR[fila.raw.medio_pago] ?? 'text-slate-500'}`}>
									<MedioPagoIcon size={13} />
									<span class="text-slate-700">{getOptionLabel(medioPagoField, fila.raw.medio_pago)}</span>
								</span>
							{:else}
								<span class="text-slate-700">—</span>
							{/if}
						</span>
						<span class="text-slate-400">Cuenta Origen</span>
						<span class="text-right text-slate-700 truncate">{fila.centroCostoOrigenLabel}</span>
						<span class="text-slate-400">Cuenta Destino</span>
						<span class="text-right text-slate-700 truncate">{fila.centroCostoDestinoLabel}</span>
						<span class="text-slate-400">Saldo Acumulado</span>
						<span class="text-right font-semibold text-slate-800">{formatCurrency(fila.saldoAcumulado)}</span>
					</div>
					{#if !fila.esSaldoInicial && fila.raw && (fila.raw as Transaccion).comprobante_url}
						<div class="pt-2 border-t border-slate-100 flex gap-2">
							<button
								type="button"
								onclick={(e) => { e.stopPropagation(); openDocumentosPreview(fila.raw as Transaccion); }}
								class="flex-1 h-10 rounded-lg border border-slate-200 text-slate-600 flex items-center justify-center gap-2 text-xs font-medium active:bg-slate-50"
							>
								<Eye size={14} /> Ver documentos
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
<DocumentPreviewModal open={previewOpen} documents={previewDocuments} title={previewTitle} onClose={() => (previewOpen = false)} />
