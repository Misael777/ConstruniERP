<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin } from '$lib/stores/permisos.svelte';
	import {
		ArrowLeft,
		Wallet,
		CreditCard,
		CheckCircle2,
		Clock,
		Landmark,
		Users,
		Search,
		Download,
		X,
		Banknote,
		Building2,
		Smartphone,
		Pencil,
		RotateCcw
	} from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { formatCurrency, type FieldOption } from '$lib/shared/fieldConfig';
	import {
		getResumenPagosDashboard,
		getMedioPagoPorCuenta,
		getProveedoresActivosCount,
		getProveedorOptions,
		type ResumenPagosDashboard,
		type CuentaPagar
	} from '$lib/modules/cuentas-pagar/services/cuentasPagar.service';
	import {
		getCentroCostoOptions,
		getCentroCostoOptionsSoloCentros,
		getCentroCostoTipoMap,
		getEmpleadoOptions
	} from '$lib/modules/transacciones/services/transacciones.service';
	import CuentaPagarModal from '$lib/modules/cuentas-pagar/components/CuentaPagarModal.svelte';
	import ResponsiveDataView from '$lib/shared/components/ResponsiveDataView.svelte';

	// Panel de pagos 100% client-side (Supabase anon key) sobre `cuentas_pagar` — a pedido explícito
	// del usuario, reemplaza por completo la versión anterior de esta pantalla (que reportaba sobre
	// `transaccion` vía movimientosCaja.service.ts, todavía usado por Panoramas de Pago/Cobro, no se
	// toca ese archivo). Mismo criterio del resto del ERP: la BD no tiene RLS real, isAdmin() es solo
	// un guard de UI.

	type TipoFiltroCC = 'proyecto' | 'consultoria' | 'bolsa general' | 'otros';
	const TIPO_FILTRO_LABEL: Record<TipoFiltroCC, string> = {
		consultoria: 'Consultoria',
		proyecto: 'Obra',
		'bolsa general': 'Corporativo',
		otros: 'Otros'
	};
	const TIPO_FILTRO_COLOR: Record<TipoFiltroCC, string> = {
		consultoria: '#2563eb', // blue-600
		proyecto: '#f97316', // orange-500
		'bolsa general': '#059669', // emerald-600
		otros: '#475569' // slate-600
	};
	const TIPOS_CONOCIDOS = ['proyecto', 'consultoria', 'bolsa general'];

	// "Parcial" no es un valor real de `estado` (solo pendiente/pagado/vencido) — se deriva por fila
	// según si ya tiene algo abonado, a pedido del usuario (mismo criterio que el badge de la imagen
	// de referencia).
	type EstadoFila = 'Pagado' | 'Parcial' | 'Vencido' | 'Pendiente';
	function estadoFilaLabel(item: CuentaPagar): EstadoFila {
		if (item.estado === 'pagado') return 'Pagado';
		if (Number(item.monto_pagado) > 0) return 'Parcial';
		if (item.estado === 'vencido') return 'Vencido';
		return 'Pendiente';
	}
	const ESTADO_FILA_BADGE_CLASS: Record<EstadoFila, string> = {
		Pagado: 'bg-emerald-100 text-emerald-700',
		Parcial: 'bg-amber-100 text-amber-700',
		Pendiente: 'bg-orange-100 text-orange-700',
		Vencido: 'bg-red-100 text-red-700'
	};

	// Íconos + color por Método de Pago — `pagos.medio_pago` es texto libre (a diferencia del código
	// numérico 1-4 de `transaccion.medio_pago`, ver nota en cuentasPagar.service.ts), mismo set de 4
	// opciones que ya usaba esta pantalla antes.
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

	function tipoLabelPorCentroCosto(item: CuentaPagar): string {
		const t = item.centro_costo?.tipo;
		if (t === 'consultoria') return TIPO_FILTRO_LABEL.consultoria;
		if (t === 'proyecto') return TIPO_FILTRO_LABEL.proyecto;
		if (t === 'bolsa general') return TIPO_FILTRO_LABEL['bolsa general'];
		return TIPO_FILTRO_LABEL.otros;
	}

	/** RUC (11 dígitos) vs DNI (8 dígitos) — `proveedor` no tiene columna DNI separada, se distingue por
	 * longitud, mismo criterio que la imagen de referencia. */
	function proveedorDocLabel(ruc: string | null | undefined): string {
		if (!ruc) return '';
		if (ruc.length === 8) return `DNI ${ruc}`;
		if (ruc.length === 11) return `RUC ${ruc}`;
		return ruc;
	}

	let resumen = $state<ResumenPagosDashboard>({
		filas: [],
		totalComprometido: 0,
		totalPagado: 0,
		totalSaldoPendiente: 0,
		totalRetencion: 0,
		count: 0
	});
	let proveedoresActivos = $state(0);
	let loading = $state(true);
	let loadError = $state('');
	let pageNum = $state(1);
	const PAGE_SIZE = 10;

	let centroCostoOptions = $state<FieldOption[]>([]);
	let centroCostoSoloCentrosOptions = $state<FieldOption[]>([]);
	let proveedorOptions = $state<FieldOption[]>([]);
	let empleadoOptions = $state<FieldOption[]>([]);
	/** id_centro_costo (texto) -> tipo — para el filtro "Tipo" y para el modal de edición (bloquear "ID
	 * Partida" cuando el centro elegido es 'bolsa general', ver CuentaPagarModal.svelte). */
	let centroCostoTipoMap = $state<Record<string, string>>({});
	const dynamicOptions = $derived({
		id_proveedor: proveedorOptions,
		id_centro_costo: centroCostoSoloCentrosOptions,
		responsable: empleadoOptions
	});

	let idCentroCosto = $state('');
	let tipoFiltro = $state<TipoFiltroCC | ''>('');
	let idProveedor = $state('');
	let estadoFiltro = $state('');
	let desde = $state('');
	let hasta = $state('');
	let search = $state('');
	let searchInput = $state('');
	let debounceTimer: ReturnType<typeof setTimeout>;

	function idsParaTipoFiltro(tipo: TipoFiltroCC): { ids: number[]; incluirSinCentroCosto: boolean } {
		if (tipo === 'otros') {
			const ids = Object.entries(centroCostoTipoMap)
				.filter(([, t]) => !TIPOS_CONOCIDOS.includes(t))
				.map(([id]) => Number(id));
			return { ids, incluirSinCentroCosto: true };
		}
		const ids = Object.entries(centroCostoTipoMap)
			.filter(([, t]) => t === tipo)
			.map(([id]) => Number(id));
		return { ids, incluirSinCentroCosto: false };
	}

	/** El filtro "Proyecto/Servicio" (centro de costo puntual) manda sobre "Tipo" (categoría) cuando
	 * ambos están activos — son dos formas de acotar el mismo campo (id_centro_costo), no se combinan. */
	function idsParaFiltroCentroCosto(): { ids?: number[]; incluirSinCentroCosto?: boolean } {
		if (idCentroCosto) return { ids: [Number(idCentroCosto)], incluirSinCentroCosto: false };
		if (tipoFiltro) return idsParaTipoFiltro(tipoFiltro);
		return {};
	}

	async function fetchData() {
		loading = true;
		try {
			const filtroCC = idsParaFiltroCentroCosto();
			resumen = await getResumenPagosDashboard(supabase, {
				idsCentroCosto: filtroCC.ids,
				incluirSinCentroCosto: filtroCC.incluirSinCentroCosto,
				idProveedor: idProveedor ? Number(idProveedor) : undefined,
				estado: estadoFiltro || undefined,
				desde: desde || undefined,
				hasta: hasta || undefined,
				search
			});
			loadError = '';
			pageNum = 1;
		} catch (err: any) {
			loadError = err?.message ?? 'No se pudo cargar el panel de pagos';
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
			const [completo, soloCentros, proveedores, empleados, tipoMap, activos] = await Promise.all([
				getCentroCostoOptions(supabase),
				getCentroCostoOptionsSoloCentros(supabase),
				getProveedorOptions(supabase),
				getEmpleadoOptions(supabase),
				getCentroCostoTipoMap(supabase),
				getProveedoresActivosCount(supabase)
			]);
			centroCostoOptions = completo;
			centroCostoSoloCentrosOptions = soloCentros;
			proveedorOptions = proveedores;
			empleadoOptions = empleados;
			centroCostoTipoMap = tipoMap;
			proveedoresActivos = activos;
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar proveedores/centros de costo');
		}
		await fetchData();
	});

	$effect(() => {
		void idCentroCosto;
		void tipoFiltro;
		void idProveedor;
		void estadoFiltro;
		void desde;
		void hasta;
		void search;
		fetchData();
	});

	function onSearchInput(value: string) {
		searchInput = value;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => (search = value), 400);
	}

	function limpiarFiltros() {
		idCentroCosto = '';
		tipoFiltro = '';
		idProveedor = '';
		estadoFiltro = '';
		desde = '';
		hasta = '';
		searchInput = '';
		search = '';
	}

	function formatDate(value: string | null | undefined) {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '—';
		return date.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
	}

	const totalPages = $derived(Math.max(1, Math.ceil(resumen.filas.length / PAGE_SIZE)));
	const filasPagina = $derived(resumen.filas.slice((pageNum - 1) * PAGE_SIZE, pageNum * PAGE_SIZE));

	function goToPage(p: number) {
		if (p < 1 || p > totalPages) return;
		pageNum = p;
	}

	// Método de Pago vive en `pagos` (no en `cuentas_pagar`, ver getMedioPagoPorCuenta) — se resuelve
	// solo para las filas visibles en la página actual, no para todo el dashboard.
	let medioPagoPorCuenta = $state<Record<number, string>>({});
	$effect(() => {
		const ids = filasPagina.map((f) => f.id_cuenta_pagar);
		if (ids.length === 0) {
			medioPagoPorCuenta = {};
			return;
		}
		getMedioPagoPorCuenta(supabase, ids)
			.then((m) => (medioPagoPorCuenta = m))
			.catch((err) => console.error('[MovimientosCaja] No se pudo cargar el método de pago:', err));
	});

	const pctPagado = $derived(resumen.totalComprometido > 0 ? (resumen.totalPagado / resumen.totalComprometido) * 100 : 0);
	const pctPendiente = $derived(resumen.totalComprometido > 0 ? (resumen.totalSaldoPendiente / resumen.totalComprometido) * 100 : 0);
	const pctRetencion = $derived(resumen.totalComprometido > 0 ? (resumen.totalRetencion / resumen.totalComprometido) * 100 : 0);

	let modalOpen = $state(false);
	let editingCuenta = $state<CuentaPagar | null>(null);
	function openEdit(item: CuentaPagar) {
		editingCuenta = item;
		modalOpen = true;
	}
	function closeModal() {
		modalOpen = false;
		editingCuenta = null;
	}
	async function handleSaved() {
		await fetchData();
	}

	async function exportarCSV() {
		if (resumen.filas.length === 0) return;
		const idsTodos = resumen.filas.map((f) => f.id_cuenta_pagar);
		let medioPagoTodos: Record<number, string> = {};
		try {
			medioPagoTodos = await getMedioPagoPorCuenta(supabase, idsTodos);
		} catch (err: any) {
			console.error('[MovimientosCaja] No se pudo cargar el método de pago para exportar:', err);
		}
		const encabezados = ['Fecha Pago', 'Vencimiento', 'Tipo', 'Concepto', 'Proveedor/Consultor', 'Método de Pago', 'Monto Total', 'Abono', 'Saldo', 'Estado'];
		const filas = resumen.filas.map((f) => [
			formatDate(f.fecha_pago_programada || f.fecha_vencimiento || f.fecha_emision),
			formatDate(f.fecha_vencimiento),
			tipoLabelPorCentroCosto(f),
			f.observacion || f.num_documento || '',
			f.proveedor?.razon_social ?? '',
			medioPagoTodos[f.id_cuenta_pagar] ?? '',
			f.monto_comprometido,
			f.monto_pagado,
			f.saldo_pendiente,
			estadoFilaLabel(f)
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
				<p class="text-sm text-slate-500">Panel de pagos a proveedores y consultores</p>
			</div>
		</div>
	</div>

	{#if loadError}
		<div class="mb-4 bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm">{loadError}</div>
	{/if}

	<!-- KPIs -->
	<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
		<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
			<div class="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center shrink-0"><CreditCard size={22} /></div>
			<div class="min-w-0">
				<p class="text-xs font-medium text-slate-500 truncate">Total Pagos</p>
				<p class="text-2xl font-bold text-slate-800 truncate">{formatCurrency(resumen.totalComprometido)}</p>
				<p class="text-[11px] text-slate-400 truncate">{resumen.count} registro{resumen.count === 1 ? '' : 's'}</p>
			</div>
		</div>
		<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
			<div class="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0"><CheckCircle2 size={22} /></div>
			<div class="min-w-0">
				<p class="text-xs font-medium text-slate-500 truncate">Pagado</p>
				<p class="text-2xl font-bold text-slate-800 truncate">{formatCurrency(resumen.totalPagado)}</p>
				<p class="text-[11px] text-slate-400 truncate">{pctPagado.toFixed(1)}% del total</p>
			</div>
		</div>
		<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
			<div class="w-12 h-12 rounded-2xl bg-orange-100 text-orange-600 flex items-center justify-center shrink-0"><Clock size={22} /></div>
			<div class="min-w-0">
				<p class="text-xs font-medium text-slate-500 truncate">Pendiente</p>
				<p class="text-2xl font-bold text-slate-800 truncate">{formatCurrency(resumen.totalSaldoPendiente)}</p>
				<p class="text-[11px] text-slate-400 truncate">{pctPendiente.toFixed(1)}% del total</p>
			</div>
		</div>
		<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
			<div class="w-12 h-12 rounded-2xl bg-violet-100 text-violet-600 flex items-center justify-center shrink-0"><Landmark size={22} /></div>
			<div class="min-w-0">
				<p class="text-xs font-medium text-slate-500 truncate">Retenciones (IR)</p>
				<p class="text-2xl font-bold text-slate-800 truncate">{formatCurrency(resumen.totalRetencion)}</p>
				<p class="text-[11px] text-slate-400 truncate">{pctRetencion.toFixed(1)}% del total</p>
			</div>
		</div>
		<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
			<div class="w-12 h-12 rounded-2xl bg-slate-200 text-slate-600 flex items-center justify-center shrink-0"><Users size={22} /></div>
			<div class="min-w-0">
				<p class="text-xs font-medium text-slate-500 truncate">Proveedores/Consultores</p>
				<p class="text-2xl font-bold text-slate-800 truncate">{proveedoresActivos}</p>
				<p class="text-[11px] text-slate-400 truncate">Activos</p>
			</div>
		</div>
	</div>

	<!-- Filtros -->
	<div class="bg-white rounded-xl border border-slate-200 p-4 mb-4">
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 items-end">
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
				<label for="mc-tipo" class="block text-xs font-medium text-slate-500 mb-1">Tipo</label>
				<div class="relative">
					{#if tipoFiltro}
						<span class="absolute left-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full pointer-events-none" style={`background-color:${TIPO_FILTRO_COLOR[tipoFiltro]}`}></span>
					{/if}
					<select
						id="mc-tipo"
						bind:value={tipoFiltro}
						class={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200 ${tipoFiltro ? 'pl-7' : ''}`}
					>
						<option value="">Todos</option>
						<option value="consultoria">Consultoria</option>
						<option value="proyecto">Obra</option>
						<option value="bolsa general">Corporativo</option>
						<option value="otros">Otros</option>
					</select>
				</div>
			</div>
			<div>
				<label for="mc-proveedor" class="block text-xs font-medium text-slate-500 mb-1">Proveedor/Consultor</label>
				<select id="mc-proveedor" bind:value={idProveedor} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200">
					<option value="">Todos</option>
					{#each proveedorOptions as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			</div>
			<div>
				<label for="mc-estado" class="block text-xs font-medium text-slate-500 mb-1">Estado</label>
				<select id="mc-estado" bind:value={estadoFiltro} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200">
					<option value="">Todos</option>
					<option value="pendiente">Pendiente</option>
					<option value="pagado">Pagado</option>
					<option value="vencido">Vencido</option>
				</select>
			</div>
			<div class="flex items-end gap-2">
				<div class="flex-1">
					<label for="mc-desde" class="block text-xs font-medium text-slate-500 mb-1">Fecha inicio</label>
					<input id="mc-desde" type="date" bind:value={desde} max={hasta || undefined} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200" />
				</div>
				<div class="flex-1">
					<label for="mc-hasta" class="block text-xs font-medium text-slate-500 mb-1">Fecha fin</label>
					<input id="mc-hasta" type="date" bind:value={hasta} min={desde || undefined} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200" />
				</div>
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
					placeholder="Buscar por N° documento, responsable, observación..."
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

	<!-- Tabla / Tarjetas -->
	<div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
		<div class="overflow-x-auto">
			<ResponsiveDataView items={filasPagina} keyField="id_cuenta_pagar" colspan={11} emptyMessage={loading ? 'Cargando...' : 'Sin pagos que coincidan con los filtros.'}>
				{#snippet header()}
					<th class="text-left px-3 py-3.5 font-semibold text-slate-600 whitespace-nowrap">Fecha Pago</th>
					<th class="text-left px-3 py-3.5 font-semibold text-slate-600 whitespace-nowrap">Vencimiento</th>
					<th class="text-left px-3 py-3.5 font-semibold text-slate-600 whitespace-nowrap">Tipo</th>
					<th class="text-left px-3 py-3.5 font-semibold text-slate-600">Concepto</th>
					<th class="text-left px-3 py-3.5 font-semibold text-slate-600 whitespace-nowrap">Proveedor/Consultor</th>
					<th class="text-left px-3 py-3.5 font-semibold text-slate-600 whitespace-nowrap">Método de Pago</th>
					<th class="text-right px-3 py-3.5 font-semibold text-slate-600 whitespace-nowrap">Monto Total</th>
					<th class="text-right px-3 py-3.5 font-semibold text-slate-600 whitespace-nowrap">Abono</th>
					<th class="text-right px-3 py-3.5 font-semibold text-slate-600 whitespace-nowrap">Saldo</th>
					<th class="text-left px-3 py-3.5 font-semibold text-slate-600 whitespace-nowrap">Estado</th>
					<th class="text-right px-3 py-3.5 font-semibold text-slate-600 whitespace-nowrap">Acciones</th>
				{/snippet}
				{#snippet row(item)}
					{@const est = estadoFilaLabel(item)}
					{@const medioPago = medioPagoPorCuenta[item.id_cuenta_pagar]}
					<td class="px-3 py-3.5 whitespace-nowrap">{formatDate(item.fecha_pago_programada || item.fecha_vencimiento || item.fecha_emision)}</td>
					<td class="px-3 py-3.5 whitespace-nowrap">{formatDate(item.fecha_vencimiento)}</td>
					<td class="px-3 py-3.5 whitespace-nowrap">{tipoLabelPorCentroCosto(item)}</td>
					<td class="px-3 py-3.5 max-w-[220px] truncate">{item.observacion || item.num_documento || '—'}</td>
					<td class="px-3 py-3.5 whitespace-nowrap">
						<div class="font-medium text-slate-700">{item.proveedor?.razon_social ?? 'Sin proveedor'}</div>
						{#if item.proveedor?.ruc}<div class="text-[11px] text-slate-400">{proveedorDocLabel(item.proveedor.ruc)}</div>{/if}
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
					<td class="px-3 py-3.5 text-right whitespace-nowrap font-semibold text-slate-800">{formatCurrency(item.monto_comprometido)}</td>
					<td class="px-3 py-3.5 text-right whitespace-nowrap text-emerald-700">{formatCurrency(item.monto_pagado)}</td>
					<td class="px-3 py-3.5 text-right whitespace-nowrap text-orange-700">{formatCurrency(item.saldo_pendiente)}</td>
					<td class="px-3 py-3.5 whitespace-nowrap">
						<span class={`inline-block px-2.5 py-1 rounded-full text-[11px] font-medium ${ESTADO_FILA_BADGE_CLASS[est]}`}>{est}</span>
					</td>
					<td class="px-3 py-3.5 text-right whitespace-nowrap">
						<button type="button" onclick={() => openEdit(item)} class="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600" title="Editar" aria-label="Editar">
							<Pencil size={16} />
						</button>
					</td>
				{/snippet}
				{#snippet card(item)}
					{@const est = estadoFilaLabel(item)}
					{@const medioPago = medioPagoPorCuenta[item.id_cuenta_pagar]}
					<div class="flex items-start justify-between gap-3 mb-2">
						<div class="min-w-0">
							<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${ESTADO_FILA_BADGE_CLASS[est]}`}>{est}</span>
							<div class="font-semibold text-slate-800 truncate mt-1">{item.proveedor?.razon_social ?? 'Sin proveedor'}</div>
							<div class="text-[11px] text-slate-400 truncate">{item.observacion || item.num_documento || '—'}</div>
						</div>
						<div class="text-right shrink-0">
							<div class="font-bold text-slate-800">{formatCurrency(item.monto_comprometido)}</div>
							<div class="text-[11px] text-slate-400">{formatDate(item.fecha_vencimiento)}</div>
						</div>
					</div>
					<div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mb-3">
						<span class="text-slate-400">Tipo</span>
						<span class="text-right text-slate-700">{tipoLabelPorCentroCosto(item)}</span>
						<span class="text-slate-400">Método de Pago</span>
						<span class="text-right text-slate-700">{medioPago ?? '—'}</span>
						<span class="text-slate-400">Abono</span>
						<span class="text-right text-emerald-700">{formatCurrency(item.monto_pagado)}</span>
						<span class="text-slate-400">Saldo</span>
						<span class="text-right text-orange-700">{formatCurrency(item.saldo_pendiente)}</span>
					</div>
					<div class="pt-2 border-t border-slate-100 flex gap-2">
						<button type="button" onclick={() => openEdit(item)} class="flex-1 h-10 rounded-lg border border-slate-200 text-slate-600 flex items-center justify-center gap-2 text-xs font-medium active:bg-slate-50">
							<Pencil size={14} /> Editar
						</button>
					</div>
				{/snippet}
			</ResponsiveDataView>
		</div>

		<div class="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-sm text-slate-500">
			<span>
				Mostrando {resumen.filas.length === 0 ? 0 : (pageNum - 1) * PAGE_SIZE + 1} a {Math.min(pageNum * PAGE_SIZE, resumen.filas.length)} de {resumen.filas.length} registros
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

<CuentaPagarModal open={modalOpen} mode="edit" cuenta={editingCuenta} dynamicOptions={dynamicOptions} {centroCostoTipoMap} onClose={closeModal} onSaved={handleSaved} />
