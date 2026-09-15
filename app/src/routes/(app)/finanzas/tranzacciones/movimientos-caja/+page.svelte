<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin } from '$lib/stores/permisos.svelte';
	import { ArrowLeft, Wallet, CreditCard, Search, Download, X, Banknote, Landmark, Building2, Smartphone, RotateCcw, TrendingUp, Scale, HandCoins, Eye, ChevronDown, Briefcase, HardHat, Ellipsis, DollarSign } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { formatCurrency, emptyColumnFilters, isColumnFilterActive, type FieldConfig, type FieldOption, type ColumnFilters } from '$lib/shared/fieldConfig';
	import { getCentroCostoOptions, getCentroCostoTipoMap, labelPorCodigoMedioPago } from '$lib/modules/transacciones/services/transacciones.service';
	import { FIELDS_CONFIG as TRANSACCION_FIELDS_CONFIG } from '$lib/modules/transacciones/config/transaccion.config';
	import type { Transaccion } from '$lib/modules/transacciones/services/transacciones.service';
	import { getMovimientosCaja, type FilaMovimiento, type TipoMovimiento } from '$lib/modules/transacciones/services/movimientosCaja.service';
	import { getCuentaBancoOptions } from '$lib/modules/cuentas-bancarias/services/cuentaBanco.service';
	import TransaccionModal from '$lib/modules/transacciones/components/TransaccionModal.svelte';
	import ResponsiveDataView from '$lib/shared/components/ResponsiveDataView.svelte';
	import ColumnFilterBar from '$lib/shared/components/ColumnFilterBar.svelte';

	// Panel 100% sobre `transaccion` (Supabase anon key, client-side) — a pedido explícito del usuario:
	// "Movimientos de Caja" debe ser solo sobre transacciones, sin ningún dato de cuentas_pagar/cobrar
	// (antes esta pantalla mezclaba ambas fuentes bajo una sola tabla/paneles, ver historial). Toda la
	// agregación real vive en movimientosCaja.service.ts (getMovimientosCaja) — este archivo solo la
	// muestra y la filtra. Mismo criterio del resto del ERP: la BD no tiene RLS real, isAdmin() es solo
	// un guard de UI.

	const TIPO_MOVIMIENTO_LABEL: Record<string, string> = { ingreso: 'Ingreso', egreso: 'Egreso', financiamiento: 'Financiamiento' };
	const TIPO_MOVIMIENTO_BADGE: Record<string, string> = {
		ingreso: 'bg-emerald-100 text-emerald-700',
		egreso: 'bg-red-100 text-red-700',
		financiamiento: 'bg-amber-100 text-amber-700'
	};

	// Íconos + color por Método de Pago — `transaccion.medio_pago` es un código '1'-'4' (ver
	// labelPorCodigoMedioPago), resuelto a uno de estos 4 labels.
	const MEDIO_PAGO_ICON: Record<string, typeof Banknote> = {
		Efectivo: Banknote,
		'Transferencia bancaria': Landmark,
		'Depósito bancario': Building2,
		'Yape o Plin': Smartphone
	};
	const MEDIO_PAGO_COLOR: Record<string, string> = {
		Efectivo: 'text-emerald-600',
		'Transferencia bancaria': 'text-blue-600',
		'Depósito bancario': 'text-violet-600',
		'Yape o Plin': 'text-rose-600'
	};
	// Reusa el catálogo real de `medio_pago` (código '1'-'4' -> label) para el filtro de columna "Método
	// de Pago" (ver REPORT_FIELDS más abajo) — sin duplicar el catálogo a mano.
	const MEDIO_PAGO_FIELD = TRANSACCION_FIELDS_CONFIG.find((f) => f.key === 'medio_pago');

	let ingresosTotal = $state(0);
	let ingresosCount = $state(0);
	let egresosTotal = $state(0);
	let financiamientoTotal = $state(0);
	let financiamientoCount = $state(0);
	let saldoActual = $state(0);
	/** Saldo Actual, pero solo de transacciones en Dólares (ver saldoActualDolares en
	 * movimientosCaja.service.ts) — a pedido explícito del usuario, cuadro aparte, nunca mezclado con
	 * el saldo en Soles de arriba. */
	let saldoActualDolares = $state(0);
	let loading = $state(true);
	let loadError = $state('');
	// Excluye la fila sintética de "Saldo Inicial" (esSaldoInicial=true) — no es una transacción real.
	let movimientosFilas = $state<FilaMovimiento[]>([]);

	// Botones "Consultoria"/"Obra"/"Corporativo"/"Otros" — mismo diseño/lógica que ya usan Cuentas por
	// Pagar/Cobrar (ver idsParaTipoFiltro ahí), filtran por el TIPO real del centro de costo de cada
	// movimiento (origen O destino, ver idsCentroCosto en movimientosCaja.service.ts). "Otros" es el
	// catch-all (cualquier tipo que no sea uno de los 3 conocidos).
	type TipoFiltroCC = 'proyecto' | 'consultoria' | 'bolsa general' | 'otros';
	let centroCostoTipoMap = $state<Record<string, string>>({});
	let tipoFilterCC = $state<TipoFiltroCC | null>(null);
	const TIPOS_CONOCIDOS_CC = ['proyecto', 'consultoria', 'bolsa general'];
	function idsParaTipoFiltroCC(tipo: TipoFiltroCC): number[] {
		const entries = Object.entries(centroCostoTipoMap);
		const filtradas = tipo === 'otros' ? entries.filter(([, t]) => !TIPOS_CONOCIDOS_CC.includes(t)) : entries.filter(([, t]) => t === tipo);
		return filtradas.map(([id]) => Number(id));
	}
	function toggleTipoFilterCC(tipo: TipoFiltroCC) {
		tipoFilterCC = tipoFilterCC === tipo ? null : tipo;
		fetchMovimientos();
	}

	// ── Barrita única de scroll para la columna "Centro de Costo" ──────────────────────────────────
	// A pedido explícito del usuario: antes cada fila tenía su propia barrita de scroll (se veía
	// "cargada" con 8 barritas repetidas); ahora hay UNA sola, que vive en el encabezado (ahí el ancho
	// SIEMPRE coincide exacto con el de la columna, mismo layout de tabla — no hace falta medir
	// posiciones a mano) y mueve el scroll de TODAS las filas a la vez. Las filas ya no son
	// scrolleables por su cuenta (overflow-x-hidden, sin su propia barrita) — el único control es la
	// del encabezado. ANCHO_MAX_CENTRO_COSTO es un ancho de sobra fijo (no el contenido real de cada
	// fila) para no tener que medir el ancho de scroll de cada una; alcanza para los textos más largos
	// que se ven hoy en este panel.
	const ANCHO_MAX_CENTRO_COSTO = 700;
	let masterScrollCentroCostoEl: HTMLDivElement | undefined = $state();
	let filaCentroCostoEls: HTMLDivElement[] = [];
	function registrarFilaCentroCosto(node: HTMLDivElement) {
		filaCentroCostoEls.push(node);
		node.scrollLeft = masterScrollCentroCostoEl?.scrollLeft ?? 0;
		return {
			destroy() {
				filaCentroCostoEls = filaCentroCostoEls.filter((el) => el !== node);
			}
		};
	}
	function onMasterScrollCentroCosto() {
		const left = masterScrollCentroCostoEl?.scrollLeft ?? 0;
		for (const el of filaCentroCostoEls) el.scrollLeft = left;
	}

	async function fetchMovimientos() {
		loading = true;
		try {
			const resultado = await getMovimientosCaja(supabase, {
				desde: desde || '1970-01-01',
				hasta: hasta || new Date().toISOString().slice(0, 10),
				idCentroCosto: idCentroCosto ? Number(idCentroCosto) : undefined,
				idsCentroCosto: tipoFilterCC ? idsParaTipoFiltroCC(tipoFilterCC) : undefined,
				numeroCuentaBanco: numeroCuentaBanco || undefined,
				tipo: tipoFiltro || undefined,
				soloAprobado: estadoFiltro === 'aprobado' ? true : estadoFiltro === 'pendiente' ? false : undefined,
				search: search || undefined
			});
			ingresosTotal = resultado.ingresosTotal;
			ingresosCount = resultado.ingresosCount;
			egresosTotal = resultado.egresosTotal;
			financiamientoTotal = resultado.financiamientosTotal;
			financiamientoCount = resultado.financiamientosCount;
			saldoActual = resultado.saldoActual;
			saldoActualDolares = resultado.saldoActualDolares;
			movimientosFilas = resultado.filas.filter((f) => !f.esSaldoInicial).reverse();
			loadError = '';
			pageNum = 1;
		} catch (err: any) {
			loadError = err?.message ?? 'No se pudieron cargar los movimientos de caja';
			toast.error(loadError);
		} finally {
			loading = false;
		}
	}
	const pendienteDePago = $derived(ingresosTotal - egresosTotal);

	function montoMovimiento(fila: FilaMovimiento): number {
		return fila.ingreso ?? fila.egreso ?? fila.financiamiento ?? 0;
	}
	function medioPagoDe(fila: FilaMovimiento): string | null {
		return fila.raw?.medio_pago ? labelPorCodigoMedioPago(fila.raw.medio_pago) : null;
	}
	/** Monto/Saldo Acumulado con el símbolo real de `fila.moneda` ('$' Dólares, 'S/' Soles) — a pedido
	 * explícito del usuario: la tabla usaba formatCurrency (siempre Soles) sin importar la moneda real
	 * de esa transacción. Mismo criterio que formatMontoTransaccion en tranzacciones/+page.svelte. */
	function formatMontoFila(valor: number, fila: FilaMovimiento): string {
		const texto = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valor);
		return fila.moneda === 'dolares' ? `$ ${texto}` : `S/ ${texto}`;
	}

	// ── Filtros de columna estilo Excel (ver ColumnFilterBar.svelte) ───────────────────────────────
	// A diferencia de Cuentas por Pagar/Cobrar (que aplican el ColumnFilters a un query de Supabase vía
	// applyColumnFilters), este reporte ya trae TODO el período a memoria (ver AJUSTAR en
	// movimientosCaja.service.ts) y pagina client-side — así que los filtros de columna también se
	// aplican client-side, con un FieldConfig "de mentira" (nunca se usa para un formulario, solo para
	// que ColumnFilterBar sepa qué tipo de control mostrar por columna).
	const REPORT_FIELDS: FieldConfig[] = [
		{ key: 'codigo', label: 'Código', tipo: 'text', showInTable: true },
		{ key: 'fecha', label: 'Fecha', tipo: 'date', showInTable: true },
		{
			key: 'tipo',
			label: 'Tipo',
			tipo: 'select',
			showInTable: true,
			options: Object.entries(TIPO_MOVIMIENTO_LABEL).map(([value, label]) => ({ value, label }))
		},
		{ key: 'concepto', label: 'Concepto', tipo: 'text', showInTable: true },
		{ key: 'centroCosto', label: 'Centro de Costo', tipo: 'text', showInTable: true },
		{ key: 'medioPago', label: 'Método de Pago', tipo: 'select', showInTable: true, options: MEDIO_PAGO_FIELD?.options ?? [] },
		{ key: 'monto', label: 'Monto', tipo: 'currency', showInTable: true },
		{ key: 'saldoAcumulado', label: 'Saldo Acumulado', tipo: 'currency', showInTable: true },
		{
			key: 'estado',
			label: 'Estado',
			tipo: 'select',
			showInTable: true,
			options: [
				{ value: 'aprobado', label: 'Aprobado' },
				{ value: 'pendiente', label: 'Pendiente' }
			]
		}
	];
	let columnFilters = $state<ColumnFilters>(emptyColumnFilters(REPORT_FIELDS));

	/** true si `fila` pasa TODOS los filtros de columna activos (AND, igual que el autofiltro de
	 * Excel) — evaluado campo por campo con el mismo `ColumnFilterValue` que arma ColumnFilterBar. */
	function cumpleColumnFilters(fila: FilaMovimiento): boolean {
		for (const field of REPORT_FIELDS) {
			const filtro = columnFilters[field.key];
			if (!isColumnFilterActive(filtro)) continue;
			if (filtro.kind === 'text') {
				const valor =
					field.key === 'codigo'
						? fila.codigo
						: field.key === 'concepto'
							? fila.concepto
							: `${fila.centroCostoOrigenLabel} → ${fila.centroCostoDestinoLabel}`;
				if (!valor.toLowerCase().includes(filtro.contains.trim().toLowerCase())) return false;
			} else if (filtro.kind === 'select') {
				const valor = field.key === 'tipo' ? fila.tipo : field.key === 'medioPago' ? (fila.raw?.medio_pago ?? '') : fila.aprobado ? 'aprobado' : 'pendiente';
				if (!filtro.values.includes(valor)) return false;
			} else if (filtro.kind === 'range') {
				const valor = field.key === 'monto' ? montoMovimiento(fila) : fila.saldoAcumulado;
				if (filtro.min.trim() !== '' && valor < Number(filtro.min)) return false;
				if (filtro.max.trim() !== '' && valor > Number(filtro.max)) return false;
			} else if (filtro.kind === 'daterange') {
				if (filtro.from.trim() !== '' && fila.fecha < filtro.from) return false;
				if (filtro.to.trim() !== '' && fila.fecha > filtro.to) return false;
			}
		}
		return true;
	}
	const movimientosFiltrados = $derived(movimientosFilas.filter(cumpleColumnFilters));
	function onColumnFiltersChange() {
		pageNum = 1;
	}

	let centroCostoOptions = $state<FieldOption[]>([]);
	let cuentaBancoOptions = $state<FieldOption[]>([]);
	let idCentroCosto = $state('');
	/** N° de cuenta bancaria (cuenta_banco.numero_cuenta) — filtra por Origen O Destino, ver
	 * numeroCuentaBanco en movimientosCaja.service.ts. Un solo estado alimenta DOS controles (el
	 * selector prominente del encabezado y el filtro "Cuenta Bancaria" de la barra), a pedido explícito
	 * del usuario — ambos quedan siempre sincronizados entre sí. */
	let numeroCuentaBanco = $state('');
	let tipoFiltro = $state<TipoMovimiento | ''>('');
	/** Filtra por `transaccion.aprobado` (ver soloAprobado en movimientosCaja.service.ts) — a pedido
	 * explícito del usuario, para encontrar rápido los movimientos con "documento de pago pendiente"
	 * (Estado='Pendiente' en la columna de la tabla). */
	let estadoFiltro = $state<'' | 'aprobado' | 'pendiente'>('');
	let desde = $state('');
	let hasta = $state('');
	let search = $state('');
	let searchInput = $state('');
	let debounceTimer: ReturnType<typeof setTimeout>;

	/** "Titular - N° cuenta" (ver getCuentaBancoOptions) partido en dos líneas para el selector
	 * prominente del encabezado (título en negrita + N° de cuenta en verde debajo, a pedido explícito
	 * del usuario) — mismo criterio de split que centroCostoNombre en tranzacciones/+page.svelte. */
	const cuentaBancoSeleccionada = $derived(cuentaBancoOptions.find((o) => o.value === numeroCuentaBanco) ?? null);
	function tituloCuentaBanco(opt: FieldOption): string {
		const idx = opt.label.indexOf(' - ');
		return idx === -1 ? opt.label : opt.label.slice(0, idx);
	}

	// Modal de "Ver" (ojito) — abre CUALQUIER transacción en modo de consulta (forceReadOnly, ver
	// TransaccionModal.svelte), sin exponer Editar/Guardar. dynamicOptions reutiliza las listas COMPLETAS
	// ya cargadas para los filtros de esta misma página (centroCostoOptions/cuentaBancoOptions) en vez de
	// replicar las listas especializadas (por proyecto/externos) que sí necesita el alta/edición
	// interactiva en tranzacciones/+page.svelte — de sobra para renderizar bien un formulario 100%
	// deshabilitado, que nunca ofrece elegir un valor nuevo.
	let viewModalOpen = $state(false);
	let viewingTransaccion = $state<Transaccion | null>(null);
	const viewDynamicOptions = $derived({
		id_centro_costo_origen: centroCostoOptions,
		id_centro_costo_destino: centroCostoOptions,
		id_centro_costo_origen_externo: centroCostoOptions,
		id_centro_costo_destino_externo: centroCostoOptions,
		id_centro_costo_destino_solo_centros: centroCostoOptions,
		cuenta_banco: cuentaBancoOptions
	});
	function verTransaccion(fila: FilaMovimiento) {
		if (!fila.raw) return;
		viewingTransaccion = fila.raw;
		viewModalOpen = true;
	}
	function closeViewModal() {
		viewModalOpen = false;
		viewingTransaccion = null;
	}

	onMount(async () => {
		if (!isAdmin()) {
			goto('/dashboard');
			return;
		}
		try {
			const [centros, cuentas, tipoMap] = await Promise.all([getCentroCostoOptions(supabase), getCuentaBancoOptions(supabase), getCentroCostoTipoMap(supabase)]);
			centroCostoOptions = centros;
			cuentaBancoOptions = cuentas;
			centroCostoTipoMap = tipoMap;
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar los centros de costo/cuentas bancarias');
		}
		await fetchMovimientos();
	});

	$effect(() => {
		void idCentroCosto;
		void numeroCuentaBanco;
		void tipoFiltro;
		void estadoFiltro;
		void desde;
		void hasta;
		void search;
		fetchMovimientos();
	});

	function onSearchInput(value: string) {
		searchInput = value;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => (search = value), 400);
	}

	function limpiarFiltros() {
		idCentroCosto = '';
		numeroCuentaBanco = '';
		tipoFiltro = '';
		estadoFiltro = '';
		desde = '';
		hasta = '';
		searchInput = '';
		search = '';
		tipoFilterCC = null;
		columnFilters = emptyColumnFilters(REPORT_FIELDS);
		pageNum = 1;
		// tipoFilterCC no está entre las dependencias del $effect de abajo (se dispara a mano en
		// toggleTipoFilterCC) — se refresca acá explícito para no quedarse con ese filtro aplicado sin
		// ningún botón resaltado. Puede duplicar el fetch que dispare el $effect si además cambió algún
		// otro filtro — inofensivo, es una consulta liviana.
		fetchMovimientos();
	}

	function formatDate(value: string | null | undefined) {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '—';
		return date.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
	}

	const PAGE_SIZE = 10;
	let pageNum = $state(1);
	// Filtrado client-side (columnFilters, ver más arriba) sobre movimientosFilas — la paginación y el
	// export corren sobre el resultado YA filtrado, mismo criterio que "lo que ves es lo que exportas".
	const totalPages = $derived(Math.max(1, Math.ceil(movimientosFiltrados.length / PAGE_SIZE)));
	const filasPagina = $derived(movimientosFiltrados.slice((pageNum - 1) * PAGE_SIZE, pageNum * PAGE_SIZE));

	function goToPage(p: number) {
		if (p < 1 || p > totalPages) return;
		pageNum = p;
	}

	function exportarCSV() {
		if (movimientosFiltrados.length === 0) return;
		const encabezados = ['Código', 'Fecha', 'Tipo', 'Concepto', 'Centro de Costo Origen', 'Centro de Costo Destino', 'Método de Pago', 'Monto', 'Moneda', 'Saldo Acumulado', 'Estado'];
		const filas = movimientosFiltrados.map((f) => [
			f.codigo,
			formatDate(f.fecha),
			TIPO_MOVIMIENTO_LABEL[f.tipo] ?? f.tipo,
			f.concepto,
			f.centroCostoOrigenLabel,
			f.centroCostoDestinoLabel,
			medioPagoDe(f) ?? '',
			montoMovimiento(f),
			f.moneda === 'dolares' ? 'Dólares' : 'Soles',
			f.saldoAcumulado,
			f.aprobado ? 'Aprobado' : 'Pendiente'
		]);
		const csv = [encabezados, ...filas].map((fila) => fila.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
		const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `movimientos-caja-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
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
				<p class="text-sm text-slate-500">Ingresos, egresos y financiamiento reales, sobre las transacciones registradas</p>
			</div>
		</div>

		<!-- Selector de Cuenta Bancaria prominente — a pedido explícito del usuario, además del filtro
		     "Cuenta Bancaria" de la barra de abajo (mismo estado, numeroCuentaBanco, siempre sincronizados).
		     El <select> real queda invisible (opacity-0) pero ENCIMA de toda la tarjeta (mismo truco que un
		     <input type="file"> oculto): mantiene el picker nativo/teclado/accesibilidad de un <select> de
		     verdad, mientras la tarjeta de abajo (título + N° de cuenta en verde, a dos líneas) es la que
		     se ve — un <select> normal no puede mostrar dos líneas de texto en su propio valor elegido. -->
		<div class="relative w-full sm:w-auto sm:min-w-[240px]">
			<div class="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 shadow-sm">
				<Landmark size={18} class="shrink-0 text-[#0f3b5e]" />
				<div class="min-w-0 flex-1 leading-tight">
					<p class="text-sm font-semibold text-slate-800 truncate">
						{cuentaBancoSeleccionada ? tituloCuentaBanco(cuentaBancoSeleccionada) : 'Todas las cuentas'}
					</p>
					{#if cuentaBancoSeleccionada}
						<p class="text-[11px] font-medium text-emerald-600 truncate">{cuentaBancoSeleccionada.value}</p>
					{/if}
				</div>
				<ChevronDown size={16} class="shrink-0 text-slate-400" />
			</div>
			<select bind:value={numeroCuentaBanco} aria-label="Filtrar por cuenta bancaria" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
				<option value="">Todas las cuentas</option>
				{#each cuentaBancoOptions as opt}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
		</div>
	</div>

	{#if loadError}
		<div class="mb-4 bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm">{loadError}</div>
	{/if}

	<!-- Botones "Consultoria"/"Obra"/"Corporativo"/"Otros" — mismo diseño/lógica que ya usan Cuentas por
	     Pagar/Cobrar (ver toggleTipoFilterCC más arriba), filtran por el TIPO real del centro de costo
	     de cada movimiento (origen O destino). -->
	<div class="flex flex-wrap gap-3 mb-6">
		<button
			type="button"
			onclick={() => toggleTipoFilterCC('consultoria')}
			class={`flex items-center gap-2 pl-2 pr-4 py-2 rounded-full border text-left transition-colors ${tipoFilterCC === 'consultoria' ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
		>
			<div class="w-7 h-7 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
				<Briefcase size={14} />
			</div>
			<span class="font-semibold text-slate-700 text-sm">Consultoria</span>
		</button>
		<button
			type="button"
			onclick={() => toggleTipoFilterCC('proyecto')}
			class={`flex items-center gap-2 pl-2 pr-4 py-2 rounded-full border text-left transition-colors ${tipoFilterCC === 'proyecto' ? 'border-orange-300 bg-orange-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
		>
			<div class="w-7 h-7 rounded-full bg-orange-100 text-orange-500 flex items-center justify-center shrink-0">
				<HardHat size={14} />
			</div>
			<span class="font-semibold text-slate-700 text-sm">Obra</span>
		</button>
		<button
			type="button"
			onclick={() => toggleTipoFilterCC('bolsa general')}
			class={`flex items-center gap-2 pl-2 pr-4 py-2 rounded-full border text-left transition-colors ${tipoFilterCC === 'bolsa general' ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
		>
			<div class="w-7 h-7 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
				<Building2 size={14} />
			</div>
			<span class="font-semibold text-slate-700 text-sm">Corporativo</span>
		</button>
		<button
			type="button"
			onclick={() => toggleTipoFilterCC('otros')}
			class={`flex items-center gap-2 pl-2 pr-4 py-2 rounded-full border text-left transition-colors ${tipoFilterCC === 'otros' ? 'border-slate-400 bg-slate-100' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
		>
			<div class="w-7 h-7 rounded-full bg-slate-700 text-white flex items-center justify-center shrink-0">
				<Ellipsis size={14} />
			</div>
			<span class="font-semibold text-slate-700 text-sm">Otros</span>
		</button>
	</div>

	<!-- KPIs — 100% sobre `transaccion`, sin ningún dato de cuentas_pagar/cobrar. -->
	<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-4 mb-6">
		<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
			<div class="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center shrink-0"><TrendingUp size={22} /></div>
			<div class="min-w-0">
				<p class="text-xs font-medium text-slate-500 truncate">Total Ingresos</p>
				<p class="text-2xl font-bold text-slate-800 truncate">{loading ? '…' : formatCurrency(ingresosTotal)}</p>
				<p class="text-[11px] text-slate-400 truncate">{ingresosCount} transacci{ingresosCount === 1 ? 'ón' : 'ones'}</p>
			</div>
		</div>
		<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
			<div class="w-12 h-12 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center shrink-0"><CreditCard size={22} /></div>
			<div class="min-w-0">
				<p class="text-xs font-medium text-slate-500 truncate">Pagado (Egresos)</p>
				<p class="text-2xl font-bold text-slate-800 truncate">{loading ? '…' : formatCurrency(egresosTotal)}</p>
				<p class="text-[11px] text-slate-400 truncate">Egresos de Transacciones</p>
			</div>
		</div>
		<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
			<div class={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${pendienteDePago >= 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}><Scale size={22} /></div>
			<div class="min-w-0">
				<p class="text-xs font-medium text-slate-500 truncate">Pendiente de pago</p>
				<p class={`text-2xl font-bold truncate ${pendienteDePago >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(pendienteDePago)}</p>
				<p class="text-[11px] text-slate-400 truncate">Total Ingresos − Pagado</p>
			</div>
		</div>
		<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
			<div class="w-12 h-12 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center shrink-0"><HandCoins size={22} /></div>
			<div class="min-w-0">
				<p class="text-xs font-medium text-slate-500 truncate">Total Financiamiento</p>
				<p class="text-2xl font-bold text-slate-800 truncate">{loading ? '…' : formatCurrency(financiamientoTotal)}</p>
				<p class="text-[11px] text-slate-400 truncate">{financiamientoCount} transacci{financiamientoCount === 1 ? 'ón' : 'ones'}</p>
			</div>
		</div>
		<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
			<div class={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${saldoActual >= 0 ? 'bg-blue-100 text-blue-600' : 'bg-red-100 text-red-600'}`}><Wallet size={22} /></div>
			<div class="min-w-0">
				<p class="text-xs font-medium text-slate-500 truncate">Saldo Actual</p>
				<p class={`text-2xl font-bold truncate ${saldoActual >= 0 ? 'text-slate-800' : 'text-red-700'}`}>{loading ? '…' : formatCurrency(saldoActual)}</p>
				<p class="text-[11px] text-slate-400 truncate">Al {formatDate(hasta || new Date().toISOString().slice(0, 10))}</p>
			</div>
		</div>
		<!-- Saldo Actual en Dólares — a pedido explícito del usuario, cuadro aparte del Saldo Actual en
		     Soles de arriba (nunca mezclados, ver saldoActualDolares en movimientosCaja.service.ts). -->
		<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
			<div class={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${saldoActualDolares >= 0 ? 'bg-teal-100 text-teal-600' : 'bg-red-100 text-red-600'}`}><DollarSign size={22} /></div>
			<div class="min-w-0">
				<p class="text-xs font-medium text-slate-500 truncate">Saldo Actual en Dólares</p>
				<p class={`text-2xl font-bold truncate ${saldoActualDolares >= 0 ? 'text-slate-800' : 'text-red-700'}`}>{loading ? '…' : `$ ${new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(saldoActualDolares)}`}</p>
				<p class="text-[11px] text-slate-400 truncate">Al {formatDate(hasta || new Date().toISOString().slice(0, 10))}</p>
			</div>
		</div>
	</div>

	<!-- Filtros -->
	<div class="bg-white rounded-xl border border-slate-200 p-4 mb-4">
		<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 items-end">
			<div>
				<label for="mc-cuenta-banco" class="block text-xs font-medium text-slate-500 mb-1">Cuenta Bancaria</label>
				<select id="mc-cuenta-banco" bind:value={numeroCuentaBanco} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200">
					<option value="">Todas</option>
					{#each cuentaBancoOptions as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			</div>
			<div>
				<label for="mc-tipo" class="block text-xs font-medium text-slate-500 mb-1">Tipo</label>
				<select id="mc-tipo" bind:value={tipoFiltro} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200">
					<option value="">Todos</option>
					<option value="ingreso">Ingreso</option>
					<option value="egreso">Egreso</option>
					<option value="financiamiento">Financiamiento</option>
				</select>
			</div>
			<div>
				<label for="mc-desde" class="block text-xs font-medium text-slate-500 mb-1">Fecha inicio</label>
				<input id="mc-desde" type="date" bind:value={desde} max={hasta || undefined} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200" />
			</div>
			<div>
				<label for="mc-hasta" class="block text-xs font-medium text-slate-500 mb-1">Fecha fin</label>
				<input id="mc-hasta" type="date" bind:value={hasta} min={desde || undefined} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200" />
			</div>
			<div>
				<label for="mc-centro-costo" class="block text-xs font-medium text-slate-500 mb-1">Proyecto/Servicio</label>
				<select id="mc-centro-costo" bind:value={idCentroCosto} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200">
					<option value="">Todos</option>
					{#each centroCostoOptions as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			</div>
			<div>
				<label for="mc-estado" class="block text-xs font-medium text-slate-500 mb-1">Estado</label>
				<select id="mc-estado" bind:value={estadoFiltro} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200">
					<option value="">Todos</option>
					<option value="aprobado">Aprobado</option>
					<option value="pendiente">Pendiente</option>
				</select>
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
					placeholder="Buscar por descripción o N° de documento..."
					class="w-full pl-9 pr-8 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
				/>
				{#if searchInput}
					<button type="button" onclick={() => onSearchInput('')} class="absolute right-2 top-[calc(50%+0.5rem)] -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Limpiar búsqueda">
						<X size={14} />
					</button>
				{/if}
			</div>
			<button type="button" onclick={limpiarFiltros} class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-blue-600 text-sm font-medium hover:bg-blue-50" title="Limpiar filtros">
				<RotateCcw size={15} /> Limpiar filtros
			</button>
			<button type="button" onclick={exportarCSV} class="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50">
				<Download size={16} /> Exportar
			</button>
		</div>
	</div>

	<!-- Filtros de columna estilo Excel — a pedido explícito del usuario, mismo componente/patrón que ya
	     usan Cuentas por Pagar/Cobrar (ColumnFilterBar), aplicado client-side sobre movimientosFilas (ver
	     cumpleColumnFilters/movimientosFiltrados más arriba). -->
	<ColumnFilterBar fields={REPORT_FIELDS} bind:filters={columnFilters} onChange={onColumnFiltersChange} />

	<!-- Tabla / Tarjetas -->
	<div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
		<div class="overflow-x-auto">
			<ResponsiveDataView items={filasPagina} keyField="id_transaccion" colspan={10} emptyMessage={loading ? 'Cargando...' : 'Sin movimientos que coincidan con los filtros.'}>
				{#snippet header()}
					<th class="text-left px-3 py-3.5 font-semibold text-slate-600 whitespace-nowrap">Código</th>
					<th class="text-left px-3 py-3.5 font-semibold text-slate-600 whitespace-nowrap">Fecha</th>
					<th class="text-left px-3 py-3.5 font-semibold text-slate-600 whitespace-nowrap">Tipo</th>
					<th class="text-left px-3 py-3.5 font-semibold text-slate-600">Concepto</th>
					<th class="text-left px-3 py-3.5 font-semibold text-slate-600 whitespace-nowrap align-top">
						Centro de Costo
						<!-- Barrita ÚNICA para toda la columna (ver registrarFilaCentroCosto/onMasterScrollCentroCosto
						     más arriba) — vive acá porque el ancho de un <th> siempre coincide exacto con el de su
						     columna, sin necesitar medir nada a mano. Arrastrarla mueve las 8 filas a la vez. -->
						<div
							bind:this={masterScrollCentroCostoEl}
							onscroll={onMasterScrollCentroCosto}
							class="mt-1.5 max-w-[300px] h-2 overflow-x-auto scroll-fino"
							title="Desliza para ver el Centro de Costo completo de cada fila"
						>
							<div style={`width:${ANCHO_MAX_CENTRO_COSTO}px; height:1px;`}></div>
						</div>
					</th>
					<th class="text-left px-3 py-3.5 font-semibold text-slate-600 whitespace-nowrap">Método de Pago</th>
					<th class="text-right px-3 py-3.5 font-semibold text-slate-600 whitespace-nowrap">Monto</th>
					<th class="text-right px-3 py-3.5 font-semibold text-slate-600 whitespace-nowrap">Saldo Acumulado</th>
					<th class="text-left px-3 py-3.5 font-semibold text-slate-600 whitespace-nowrap">Estado</th>
					<th class="text-right px-3 py-3.5 font-semibold text-slate-600 whitespace-nowrap">Ver</th>
				{/snippet}
				{#snippet row(fila)}
					{@const medioPago = medioPagoDe(fila)}
					<td class="px-3 py-3.5 whitespace-nowrap font-mono text-xs text-slate-500">{fila.codigo}</td>
					<td class="px-3 py-3.5 whitespace-nowrap">{formatDate(fila.fecha)}</td>
					<td class="px-3 py-3.5 whitespace-nowrap">
						<span class={`inline-block px-2.5 py-1 rounded-full text-[11px] font-medium ${TIPO_MOVIMIENTO_BADGE[fila.tipo] ?? 'bg-slate-100 text-slate-600'}`}>
							{TIPO_MOVIMIENTO_LABEL[fila.tipo] ?? fila.tipo}
						</span>
					</td>
					<td class="px-3 py-3.5 max-w-[220px] truncate">{fila.concepto}</td>
					<td class="px-3 py-3.5 text-slate-700">
						<!-- Sin barrita propia (a pedido explícito del usuario: 8 barritas repetidas, una por
						     fila, se veían "cargadas") — la única barrita vive en el encabezado de la columna y
						     mueve el scroll de todas las filas a la vez, ver registrarFilaCentroCosto. -->
						<div class="max-w-[300px] overflow-x-hidden whitespace-nowrap" use:registrarFilaCentroCosto>
							{fila.centroCostoOrigenLabel} → {fila.centroCostoDestinoLabel}
						</div>
					</td>
					<td class="px-3 py-3.5 whitespace-nowrap">
						{#if medioPago}
							{@const MedioPagoIcon = MEDIO_PAGO_ICON[medioPago] ?? Wallet}
							<span class={`inline-flex items-center gap-1.5 ${MEDIO_PAGO_COLOR[medioPago] ?? 'text-slate-500'}`}>
								<MedioPagoIcon size={14} />
								<span class="text-slate-700">{medioPago}</span>
							</span>
						{:else}
							—
						{/if}
					</td>
					<td class="px-3 py-3.5 text-right whitespace-nowrap font-semibold">
						{#if fila.tipo === 'egreso'}
							<span class="text-red-700">-{formatMontoFila(montoMovimiento(fila), fila)}</span>
						{:else if fila.tipo === 'ingreso'}
							<span class="text-emerald-700">+{formatMontoFila(montoMovimiento(fila), fila)}</span>
						{:else}
							<span class="text-amber-700">+{formatMontoFila(montoMovimiento(fila), fila)}</span>
						{/if}
					</td>
					<td class={`px-3 py-3.5 text-right whitespace-nowrap ${fila.saldoAcumulado >= 0 ? 'text-slate-700' : 'text-red-700'}`}>{formatMontoFila(fila.saldoAcumulado, fila)}</td>
					<td class="px-3 py-3.5 whitespace-nowrap">
						<span class={`inline-block px-2.5 py-1 rounded-full text-[11px] font-medium ${fila.aprobado ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>
							{fila.aprobado ? 'Aprobado' : 'Pendiente'}
						</span>
					</td>
					<td class="px-3 py-3.5 text-right whitespace-nowrap">
						{#if fila.raw}
							<button type="button" onclick={() => verTransaccion(fila)} class="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600" title="Ver transacción" aria-label="Ver transacción">
								<Eye size={16} />
							</button>
						{/if}
					</td>
				{/snippet}
				{#snippet card(fila)}
					{@const medioPago = medioPagoDe(fila)}
					<div class="flex items-start justify-between gap-3 mb-2">
						<div class="min-w-0">
							<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${TIPO_MOVIMIENTO_BADGE[fila.tipo] ?? 'bg-slate-100 text-slate-600'}`}>
								{TIPO_MOVIMIENTO_LABEL[fila.tipo] ?? fila.tipo}
							</span>
							<div class="font-semibold text-slate-800 truncate mt-1">{fila.centroCostoOrigenLabel} → {fila.centroCostoDestinoLabel}</div>
							<div class="text-[11px] text-slate-400 truncate">{fila.concepto}</div>
						</div>
						<div class="text-right shrink-0">
							{#if fila.tipo === 'egreso'}
								<div class="font-bold text-red-700">-{formatMontoFila(montoMovimiento(fila), fila)}</div>
							{:else if fila.tipo === 'ingreso'}
								<div class="font-bold text-emerald-700">+{formatMontoFila(montoMovimiento(fila), fila)}</div>
							{:else}
								<div class="font-bold text-amber-700">+{formatMontoFila(montoMovimiento(fila), fila)}</div>
							{/if}
							<div class="text-[11px] text-slate-400">{formatDate(fila.fecha)}</div>
						</div>
					</div>
					<div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mb-1">
						<span class="text-slate-400">Método de Pago</span>
						<span class="text-right text-slate-700">{medioPago ?? '—'}</span>
						<span class="text-slate-400">Saldo Acumulado</span>
						<span class={`text-right ${fila.saldoAcumulado >= 0 ? 'text-slate-700' : 'text-red-700'}`}>{formatMontoFila(fila.saldoAcumulado, fila)}</span>
						<span class="text-slate-400">Estado</span>
						<span class="text-right">
							<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${fila.aprobado ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>
								{fila.aprobado ? 'Aprobado' : 'Pendiente'}
							</span>
						</span>
					</div>
					{#if fila.raw}
						<button type="button" onclick={() => verTransaccion(fila)} class="mt-2 flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline">
							<Eye size={14} /> Ver transacción
						</button>
					{/if}
				{/snippet}
			</ResponsiveDataView>
		</div>

		<div class="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-sm text-slate-500">
			<span>
				Mostrando {movimientosFiltrados.length === 0 ? 0 : (pageNum - 1) * PAGE_SIZE + 1} a {Math.min(pageNum * PAGE_SIZE, movimientosFiltrados.length)} de {movimientosFiltrados.length} registros
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
</div>

<TransaccionModal
	open={viewModalOpen}
	mode="edit"
	transaccion={viewingTransaccion}
	dynamicOptions={viewDynamicOptions}
	forceReadOnly
	onClose={closeViewModal}
	onSaved={() => {}}
/>

<style>
	/* Barrita de scroll fina para la celda "Centro de Costo" (ver arriba) — más discreta que la barra de
	   scroll por defecto del navegador, para que no domine visualmente una celda tan angosta. */
	.scroll-fino {
		scrollbar-width: thin;
		scrollbar-color: #cbd5e1 transparent;
	}
	.scroll-fino::-webkit-scrollbar {
		height: 5px;
	}
	.scroll-fino::-webkit-scrollbar-track {
		background: transparent;
	}
	.scroll-fino::-webkit-scrollbar-thumb {
		background-color: #cbd5e1;
		border-radius: 9999px;
	}
</style>
