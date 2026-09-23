<script lang="ts">
	// Gestión de Comprobantes (Finanzas) — 4 pestañas (Factura / Boleta / Nota de Crédito / Nota de
	// Débito), TODAS con el mismo mecanismo (a pedido explícito del usuario: "cada pestaña debe mostrar
	// la relación de transacciones tipo ingreso según el tipo de documento"): se clasifican las
	// transacciones de ingreso por transaccion.tipo_documento (ver TIPO_DOCUMENTO_POR_COMPROBANTE en
	// facturacion.service.ts) — sin comprobante = azul lino y seleccionable; marcar el check abre
	// "Nueva Factura/Boleta/Nota de Crédito/Nota de Débito" con esa transacción y su cliente ya
	// precargados. Documento INTERNO (sin firma digital ni OSE). Una vez emitido, guarda su imagen/PDF en
	// Drive; el ojito de "Documentos emitidos" abre esa imagen guardada.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin } from '$lib/stores/permisos.svelte';
	import { Plus, Pencil, Trash2, Trash, RotateCcw, Search, ChevronUp, ChevronDown, ChevronLeft, X, FileText, Eye, TrendingUp, Inbox, Percent, CheckCircle2, Receipt, FileMinus, FilePlus, Check } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { verifyAdminCredentials } from '$lib/shared/adminAuth';
	import { getOptionLabel, formatCurrency, emptyColumnFilters, type ColumnFilters, type FieldOption } from '$lib/shared/fieldConfig';
	import { FIELDS_CONFIG, DEFAULT_SORT_FIELD, DEFAULT_SORT_DIR, DEFAULT_PAGE_SIZE } from '$lib/modules/facturacion/config/factura.config';
	import {
		getFacturas,
		getKpisComprobante,
		getFacturaConDetalle,
		getClienteOptions,
		getTransaccionesFacturables,
		getDocumentosTransaccion,
		darDeBajaFactura,
		restaurarFactura,
		eliminarFacturaPermanente,
		TIPO_DOCUMENTO_POR_COMPROBANTE,
		COMPROBANTE_POR_TIPO_DOCUMENTO,
		type Factura,
		type FacturaDetalle,
		type KpisFacturacion,
		type TransaccionFacturable,
		type TipoComprobante
	} from '$lib/modules/facturacion/services/facturacion.service';
	import FacturaModal from '$lib/modules/facturacion/components/FacturaModal.svelte';
	import FacturaPreviewModal from '$lib/modules/facturacion/components/FacturaPreviewModal.svelte';
	import ColumnFilterBar from '$lib/shared/components/ColumnFilterBar.svelte';
	import ConfirmModal from '$lib/shared/components/ConfirmModal.svelte';
	import AdminConfirmModal from '$lib/shared/components/AdminConfirmModal.svelte';
	import DocumentPreviewModal from '$lib/shared/components/DocumentPreviewModal.svelte';
	import type { DatosFacturaPdf } from '$lib/shared/facturaPdf';

	const tableFields = FIELDS_CONFIG.filter((f) => f.showInTable);
	const estadoField = FIELDS_CONFIG.find((f) => f.key === 'estado')!;
	const formaPagoField = FIELDS_CONFIG.find((f) => f.key === 'forma_pago')!;
	const estadoBadgeClass: Record<string, string> = {
		borrador: 'bg-slate-100 text-slate-600',
		emitida: 'bg-emerald-100 text-emerald-700',
		anulada: 'bg-slate-100 text-slate-400'
	};
	// Mismos colores usados dentro de FacturaModal — consistencia visual entre el picker de esta página y
	// la tabla de transacciones dentro del modal.
	const COLOR_SIN_FACTURA = { bg: '#bcd3f2', border: '#5b8fd4' };
	const COLOR_FACTURADA = { bg: '#a8dfb9', border: '#3c9b5c' };

	// 'sin_tipo' = transacciones de ingreso sin tipo de documento (a pedido explícito del usuario, última
	// pestaña): no tiene comprobantes emitidos propios; al marcar una se elige "Emitir como" qué comprobante.
	type TabValue = TipoComprobante | 'sin_tipo';
	const TABS: { value: TabValue; label: string; plural: string; icon: typeof FileText }[] = [
		{ value: 'factura', label: 'Factura', plural: 'Facturas', icon: FileText },
		{ value: 'boleta', label: 'Boleta', plural: 'Boletas', icon: Receipt },
		{ value: 'nota_credito', label: 'Nota de Crédito', plural: 'Notas de Crédito', icon: FileMinus },
		{ value: 'nota_debito', label: 'Nota de Débito', plural: 'Notas de Débito', icon: FilePlus },
		{ value: 'sin_tipo', label: 'Sin tipo de documento', plural: 'Sin tipo de documento', icon: Inbox }
	];

	let activeTab = $state<TabValue>('factura');
	const esSinTipo = $derived(activeTab === 'sin_tipo');
	let emitirComo = $state<TipoComprobante>('factura');
	const comprobanteModal = $derived<TipoComprobante>(activeTab === 'sin_tipo' ? emitirComo : activeTab);
	const tabActual = $derived(TABS.find((t) => t.value === activeTab)!);
	const nombreTab = $derived(tabActual.label);
	const pluralTab = $derived(tabActual.plural);

	// ── Documentos emitidos (sección inferior, todas las pestañas) ──────────────────────────────
	let items = $state<Factura[]>([]);
	let total = $state(0);
	let pageNum = $state(1);
	let totalPages = $state(1);
	let loading = $state(true);
	let loadError = $state('');

	let search = $state('');
	let searchInput = $state('');
	let sortBy = $state(DEFAULT_SORT_FIELD);
	let sortDir = $state<'asc' | 'desc'>(DEFAULT_SORT_DIR);
	let debounceTimer: ReturnType<typeof setTimeout>;
	let columnFilters = $state<ColumnFilters>(emptyColumnFilters(tableFields));
	let verEliminados = $state(false);
	let dynamicOptions = $state<Record<string, FieldOption[]>>({});

	// ── KPIs (mismas 4 tarjetas para las 4 pestañas) ────────────────────────────────────────────
	let kpis = $state<KpisFacturacion>({ totalFacturadoMes: 0, porFacturar: 0, porFacturarCount: 0, detraccionesAcumuladas: 0, facturasEmitidas: 0 });

	// ── Sección superior: transacciones de ingreso clasificadas por el tipo_documento de la pestaña ──
	// (paginada server-side, mismo patrón que "Documentos emitidos" abajo — a pedido explícito del
	// usuario: con muchas transacciones esta lista no debe traerlas todas de una vez).
	let transaccionesPendientes = $state<TransaccionFacturable[]>([]);
	let transaccionesTotal = $state(0);
	let transaccionesPageNum = $state(1);
	let transaccionesTotalPages = $state(1);
	let cargandoSuperior = $state(false);

	let docsOpen = $state(false);
	let docsTitle = $state('');
	let docsLista = $state<{ url: string; label: string }[]>([]);

	// ── Modal Nueva/Editar (mismo para las 4 pestañas, ver prop tipoComprobante) ────────────────
	let modalOpen = $state(false);
	let modalMode = $state<'create' | 'edit'>('create');
	let editingFactura = $state<Factura | null>(null);
	let editingDetalle = $state<FacturaDetalle[]>([]);
	let preseleccion = $state<{ idCliente: number; idTransaccion: number } | null>(null);

	let previewOpen = $state(false);
	let previewDatos = $state<DatosFacturaPdf | null>(null);
	let imagenOpen = $state(false);
	let imagenTitle = $state('');
	let imagenDocs = $state<{ url: string; label: string }[]>([]);

	let facturaParaDarDeBaja = $state<Factura | null>(null);
	let confirmDarDeBajaOpen = $state(false);
	let facturaParaEliminarPermanente = $state<Factura | null>(null);
	let confirmEliminarPermanenteOpen = $state(false);
	let eliminandoPermanente = $state(false);

	async function fetchList() {
		if (activeTab === 'sin_tipo') {
			items = [];
			total = 0;
			totalPages = 1;
			loading = false;
			return;
		}
		loading = true;
		loadError = '';
		try {
			const result = await getFacturas(supabase, { page: pageNum, pageSize: DEFAULT_PAGE_SIZE, search, sortBy, sortDir, columnFilters, soloEliminados: verEliminados, tipoComprobante: activeTab });
			items = result.items;
			total = result.total;
			totalPages = result.totalPages;
		} catch (err: any) {
			const mensaje: string = err?.message ?? '';
			loadError = /schema cache|does not exist|Could not find/i.test(mensaje)
				? 'Falta actualizar las tablas de Facturación en la base de datos: vuelve a ejecutar factura_migration.sql en el SQL Editor de Supabase y recarga esta página.'
				: mensaje || 'No se pudieron cargar los documentos.';
		} finally {
			loading = false;
		}
	}

	async function fetchKpis() {
		if (activeTab === 'sin_tipo') return;
		try {
			kpis = await getKpisComprobante(supabase, activeTab);
		} catch (err) {
			console.error('[Gestión de Comprobantes] No se pudieron cargar los KPIs:', err);
		}
	}

	async function fetchSuperior() {
		cargandoSuperior = true;
		try {
			const result = await getTransaccionesFacturables(supabase, activeTab === 'sin_tipo' ? null : TIPO_DOCUMENTO_POR_COMPROBANTE[activeTab], { page: transaccionesPageNum, pageSize: DEFAULT_PAGE_SIZE });
			transaccionesPendientes = result.items;
			transaccionesTotal = result.total;
			transaccionesTotalPages = result.totalPages;
		} catch (err) {
			console.error('[Gestión de Comprobantes] No se pudieron cargar las transacciones:', err);
		} finally {
			cargandoSuperior = false;
		}
	}

	async function fetchDynamicOptions() {
		try {
			dynamicOptions = { id_cliente: await getClienteOptions(supabase) };
		} catch (err) {
			console.error('[Gestión de Comprobantes] No se pudieron cargar las opciones de filtro:', err);
		}
	}

	async function fetchTab() {
		await Promise.all([fetchList(), fetchKpis(), fetchSuperior()]);
	}

	/** Viene de "Generar comprobante ERP = Sí" en Nueva/Editar Transacción (ver
	 * redirigirANuevoComprobanteErp en TransaccionModal.svelte) — cambia a la pestaña que corresponda al
	 * tipo_documento de esa transacción y abre "Nuevo Comprobante" directo, ya con el cliente y esa
	 * transacción precargados (mismo mecanismo que marcar el check de una fila azul a mano). */
	async function abrirDesdeTransaccionPrefill(): Promise<boolean> {
		if (page.url.searchParams.get('nuevoComprobanteDesdeTransaccion') !== '1') return false;
		const crudo = sessionStorage.getItem('comprobantePrefillDesdeTransaccion');
		sessionStorage.removeItem('comprobantePrefillDesdeTransaccion');
		window.history.replaceState({}, '', '/finanzas/facturacion');
		if (!crudo) return false;
		try {
			const datos = JSON.parse(crudo);
			activeTab = COMPROBANTE_POR_TIPO_DOCUMENTO[String(datos.tipoDocumento)] ?? 'factura';
			await fetchTab();
			modalMode = 'create';
			editingFactura = null;
			editingDetalle = [];
			preseleccion = { idCliente: datos.idCliente, idTransaccion: datos.idTransaccion };
			modalOpen = true;
			return true;
		} catch (err) {
			console.error('[Gestión de Comprobantes] No se pudo leer la precarga de la transacción:', err);
			toast.error('No se pudo precargar el comprobante — complétalo a mano.');
			return false;
		}
	}

	onMount(async () => {
		const manejado = await abrirDesdeTransaccionPrefill();
		if (!manejado) await fetchTab();
		fetchDynamicOptions();
	});

	function switchTab(tab: TabValue) {
		if (tab === activeTab) return;
		activeTab = tab;
		pageNum = 1;
		transaccionesPageNum = 1;
		search = '';
		searchInput = '';
		columnFilters = emptyColumnFilters(tableFields);
		verEliminados = false;
		fetchTab();
	}

	function irAPaginaTransacciones(nueva: number) {
		transaccionesPageNum = nueva;
		fetchSuperior();
	}

	function onSearchInput(value: string) {
		searchInput = value;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			search = value;
			pageNum = 1;
			fetchList();
		}, 300);
	}

	function toggleSort(field: string, fromSelect = false) {
		if (!fromSelect && sortBy === field) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortBy = field;
		}
		pageNum = 1;
		fetchList();
	}

	function handleColumnFiltersChange() {
		pageNum = 1;
		fetchList();
	}

	function toggleVerEliminados() {
		verEliminados = !verEliminados;
		pageNum = 1;
		fetchList();
	}

	function openCreate() {
		modalMode = 'create';
		editingFactura = null;
		editingDetalle = [];
		preseleccion = null;
		modalOpen = true;
	}

	/** Marcar el check de una transacción SIN comprobante en la tabla superior — abre el modal directo,
	 * con el cliente y esa transacción ya precargados (a pedido explícito del usuario). */
	function openDesdeTransaccion(t: TransaccionFacturable) {
		if (t.id_factura != null || t.idCliente == null) return;
		modalMode = 'create';
		editingFactura = null;
		editingDetalle = [];
		preseleccion = { idCliente: t.idCliente, idTransaccion: t.id_transaccion };
		modalOpen = true;
	}

	async function openEdit(item: Factura) {
		const full = await getFacturaConDetalle(supabase, item.id_factura);
		if (!full) return;
		modalMode = 'edit';
		editingFactura = full.factura;
		editingDetalle = full.detalle;
		preseleccion = null;
		modalOpen = true;
	}

	function closeModal() {
		modalOpen = false;
		editingFactura = null;
		editingDetalle = [];
		preseleccion = null;
	}

	async function handleSaved() {
		await fetchTab();
	}

	async function abrirSoportesTransaccion(t: TransaccionFacturable) {
		docsTitle = `Soportes — ${t.categoria ?? 'Ingreso'} ${t.fecha}`;
		docsLista = await getDocumentosTransaccion(supabase, t);
		docsOpen = true;
	}

	/** Emitido con imagen guardada → se abre ESA imagen (lo que realmente se autorizó). Borrador/anulado
	 * (sin imagen) → se regenera la vista previa desde los datos guardados, con sello de agua. */
	async function openPreview(item: Factura) {
		const full = await getFacturaConDetalle(supabase, item.id_factura);
		if (!full) return;
		const { factura, detalle, archivos } = full;

		if (factura.estado === 'emitida' && factura.imagen_url) {
			imagenTitle = `${nombreTab} ${factura.folio}`;
			imagenDocs = [
				{ url: factura.imagen_url, label: 'Imagen' },
				...archivos.filter((a) => a.tipo === 'pdf').map((a) => ({ url: a.url, label: 'PDF' }))
			];
			imagenOpen = true;
			return;
		}

		previewDatos = {
			tipoDocumento: factura.tipo_comprobante,
			folio: factura.folio,
			fechaEmision: factura.fecha_emision,
			formaPago: factura.forma_pago === 'credito' ? 'credito' : 'contado',
			clienteNombre: factura.cliente_nombre ?? factura.cliente?.nombre ?? '',
			clienteDocumentoLabel: factura.cliente_tipo_doc ?? 'RUC',
			clienteDocumento: factura.cliente_documento ?? '',
			clienteDireccion: factura.cliente_direccion ?? '',
			moneda: factura.moneda === 'USD' ? 'USD' : 'PEN',
			observacion: factura.observacion ?? '',
			lineas: detalle.map((d) => ({ cantidad: Number(d.cantidad), unidad: d.unidad ?? 'Servicio', descripcion: d.descripcion, valorUnitario: Number(d.precio_unitario) })),
			subTotalVentas: Number(factura.sub_total_ventas),
			anticipos: Number(factura.anticipos),
			descuentos: Number(factura.descuentos),
			valorVenta: Number(factura.valor_venta),
			isc: Number(factura.isc),
			igv: Number(factura.monto_igv),
			otrosCargos: Number(factura.otros_cargos),
			otrosTributos: Number(factura.otros_tributos),
			redondeo: Number(factura.redondeo),
			importeTotal: Number(factura.monto_total),
			sujetaDetraccion: factura.sujeta_detraccion,
			porcentajeDetraccion: Number(factura.porcentaje_detraccion ?? 0),
			montoDetraccion: Number(factura.monto_detraccion ?? 0),
			detraccionBienServicio: factura.detraccion_bien_servicio ?? '',
			detraccionMedioPago: factura.detraccion_medio_pago ?? '',
			detraccionCuentaBn: factura.detraccion_cuenta_bn ?? '',
			marcaAgua: factura.estado === 'anulada' ? 'ANULADA' : 'BORRADOR'
		};
		previewOpen = true;
	}

	function closePreview() {
		previewOpen = false;
		previewDatos = null;
	}

	function handleDarDeBaja(item: Factura) {
		facturaParaDarDeBaja = item;
		confirmDarDeBajaOpen = true;
	}
	function closeConfirmDarDeBaja() {
		confirmDarDeBajaOpen = false;
		facturaParaDarDeBaja = null;
	}
	async function confirmarDarDeBaja() {
		if (!facturaParaDarDeBaja) return;
		try {
			const result = await darDeBajaFactura(supabase, facturaParaDarDeBaja.id_factura);
			if (result.success) {
				toast.success(result.message);
				closeConfirmDarDeBaja();
				await fetchTab();
			} else {
				toast.error(result.message);
			}
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		}
	}

	async function handleRestaurar(item: Factura) {
		try {
			const result = await restaurarFactura(supabase, item.id_factura);
			if (result.success) {
				toast.success(result.message);
				await fetchTab();
			} else {
				toast.error(result.message);
			}
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		}
	}

	function handleEliminarPermanente(item: Factura) {
		facturaParaEliminarPermanente = item;
		confirmEliminarPermanenteOpen = true;
	}
	function closeConfirmEliminarPermanente() {
		if (eliminandoPermanente) return;
		confirmEliminarPermanenteOpen = false;
		facturaParaEliminarPermanente = null;
	}
	async function confirmarEliminarPermanente(email: string, password: string) {
		if (!facturaParaEliminarPermanente) return;
		const verificacion = await verifyAdminCredentials(email, password);
		if (!verificacion.success) throw new Error(verificacion.message);

		eliminandoPermanente = true;
		try {
			const result = await eliminarFacturaPermanente(supabase, facturaParaEliminarPermanente.id_factura);
			if (result.success) {
				toast.success(result.message);
				confirmEliminarPermanenteOpen = false;
				facturaParaEliminarPermanente = null;
				await fetchTab();
			} else {
				throw new Error(result.message);
			}
		} finally {
			eliminandoPermanente = false;
		}
	}

	function formatDate(value: string | null | undefined): string {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '—';
		return date.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
	}

	function fmtTransaccion(t: TransaccionFacturable): string {
		return `${t.tipo_moneda === 'dolares' ? 'US$' : 'S/'} ${t.monto_total.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}
</script>

<div class="p-4 md:p-6">
	<div class="flex items-center justify-between mb-4 flex-wrap gap-3">
		<div class="flex items-center gap-3">
			<FileText class="text-[#0f3b5e]" size={28} />
			<div>
				<h1 class="text-xl font-bold text-[#0f3b5e]">Gestión de Comprobantes</h1>
				<p class="text-sm text-slate-500">Emite Facturas, Boletas y Notas de Crédito/Débito a partir de tus transacciones ya registradas</p>
			</div>
		</div>
	</div>

	<div class="flex items-center justify-end mb-4 gap-2">
		{#if isAdmin() && !verEliminados && !esSinTipo}
			<button type="button" onclick={toggleVerEliminados} class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-slate-300 text-slate-600 hover:bg-slate-50">
				<Trash2 size={16} /> Ver eliminados
			</button>
		{:else if verEliminados}
			<button type="button" onclick={toggleVerEliminados} class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-slate-800 text-white hover:bg-slate-900">
				<ChevronLeft size={16} /> Volver
			</button>
		{/if}
		{#if !verEliminados}
			<button type="button" onclick={openCreate} class="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-medium hover:bg-[#0c2f4c]">
				<Plus size={16} /> Nuevo Comprobante
			</button>
		{/if}
	</div>

	{#if loadError}
		<div class="mb-4 bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm">{loadError}</div>
	{/if}

	<!-- KPIs (la pestaña "Sin tipo de documento" no tiene comprobantes emitidos propios, no lleva KPIs) -->
	{#if !esSinTipo}
	<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0"><TrendingUp size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Total Emitido en {nombreTab} (Mes Actual)</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(kpis.totalFacturadoMes)}</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4" style="background:#eef4fb;border-color:#b7cce6">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-white text-blue-700 flex items-center justify-center shrink-0"><Inbox size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Por Emitir ({nombreTab})</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(kpis.porFacturar)}</p>
			<p class="text-[11px] text-slate-400 mt-1">{kpis.porFacturarCount} transacción{kpis.porFacturarCount === 1 ? '' : 'es'} sin comprobante</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center shrink-0"><Percent size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Detracciones Acumuladas</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(kpis.detraccionesAcumuladas)}</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0"><CheckCircle2 size={16} /></div>
				<span class="text-xs font-medium text-slate-500">{pluralTab} Emitidas</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{kpis.facturasEmitidas}</p>
		</div>
	</div>
	{/if}

	<!-- Pestañas (estilo tabs, mismo look que Control Financiero) — a pedido explícito del usuario, van
	     justo arriba de "Transacciones (…)" en vez de debajo del título de la página. -->
	<div class="mb-4 flex gap-1 border-b border-slate-200 flex-wrap">
		{#each TABS as tab (tab.value)}
			<button
				type="button"
				onclick={() => switchTab(tab.value)}
				class={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === tab.value ? 'border-[#0f3b5e] text-[#0f3b5e]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
			>
				<tab.icon size={16} /> {tab.label}
			</button>
		{/each}
	</div>

	{#if !verEliminados}
		<!-- Sección superior: transacciones de ingreso clasificadas por el tipo de documento de esta pestaña -->
		<div class="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
			<div class="px-4 py-3 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
				<h2 class="text-sm font-semibold text-[#0f3b5e]">Transacciones ({nombreTab})</h2>
				<div class="flex items-center gap-3 text-[11px] text-slate-500">
					{#if esSinTipo}
						<label class="flex items-center gap-1.5 text-slate-600 font-medium">
							Emitir como
							<select bind:value={emitirComo} class="rounded-lg border border-slate-300 px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
								{#each TABS.filter((t) => t.value !== 'sin_tipo') as t}
									<option value={t.value}>{t.label}</option>
								{/each}
							</select>
						</label>
					{/if}
					<span class="flex items-center gap-1.5"><span class="inline-block shrink-0 w-4 h-4 rounded border-2" style={`background:${COLOR_SIN_FACTURA.bg};border-color:${COLOR_SIN_FACTURA.border}`}></span>Sin comprobante (seleccionable)</span>
				</div>
			</div>

			<div class="overflow-x-auto">
				<div class="min-w-[900px]">
					<div class="grid grid-cols-[auto_0.9fr_1.3fr_1.1fr_1.8fr_1.2fr_1fr_auto] gap-3 items-center px-4 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase">
						<span class="w-4"></span>
						<span>Fecha</span>
						<span>Cliente</span>
						<span>Categoría</span>
						<span>Descripción</span>
						<span>Destino</span>
						<span class="text-right">Monto</span>
						<span class="text-center">Soportes</span>
					</div>
					{#each transaccionesPendientes as t (t.id_transaccion)}
						{@const facturada = t.id_factura != null}
						<div
							role="button"
							tabindex="0"
							onclick={() => openDesdeTransaccion(t)}
							onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && openDesdeTransaccion(t)}
							class={`grid grid-cols-[auto_0.9fr_1.3fr_1.1fr_1.8fr_1.2fr_1fr_auto] gap-3 items-center px-4 py-2.5 border-b last:border-b-0 text-sm ${facturada ? 'cursor-default' : 'cursor-pointer'}`}
							style={`background:${facturada ? COLOR_FACTURADA.bg : COLOR_SIN_FACTURA.bg};border-color:${facturada ? COLOR_FACTURADA.border : COLOR_SIN_FACTURA.border}`}
						>
							{#if facturada}
								<span class="w-4 h-4 flex items-center justify-center shrink-0 text-emerald-700" title="Ya emitida"><Check size={14} /></span>
							{:else}
								<span class="w-4 h-4 rounded border-2 border-[#5b8fd4] bg-white shrink-0"></span>
							{/if}
							<span class="text-slate-700">{t.fecha}</span>
							<span class="text-slate-700 truncate">{t.clienteNombre ?? '—'}</span>
							<span class="text-slate-700 truncate">{t.categoria ?? '—'}</span>
							<span class="text-slate-600 truncate">{t.descripcion ?? '—'}</span>
							<span class="text-slate-600 truncate">
								{t.destinoLabel}
								{#if facturada}<span class="ml-1 inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-700">{t.facturaFolio ?? ''}</span>{/if}
							</span>
							<span class="text-right font-semibold text-slate-800">{fmtTransaccion(t)}</span>
							<span class="flex justify-center">
								<button type="button" onclick={(e) => { e.stopPropagation(); abrirSoportesTransaccion(t); }} class="p-1.5 rounded-lg text-slate-500 hover:bg-white hover:text-blue-600" title="Ver documentos" aria-label="Ver documentos">
									<Eye size={16} />
								</button>
							</span>
						</div>
					{:else}
						<p class="px-4 py-8 text-center text-xs text-slate-400">{cargandoSuperior ? 'Cargando...' : (esSinTipo ? 'No hay transacciones de ingreso sin tipo de documento pendientes de emitir.' : `No hay transacciones de tipo ${nombreTab} pendientes de emitir.`)}</p>
					{/each}
				</div>
			</div>

			{#if transaccionesTotalPages > 1}
				<div class="flex items-center justify-between px-4 py-3 border-t border-slate-200">
					<p class="text-xs text-slate-400">{transaccionesTotal} transacción{transaccionesTotal === 1 ? '' : 'es'} en total</p>
					<div class="flex items-center gap-2">
						<button type="button" disabled={transaccionesPageNum <= 1} onclick={() => irAPaginaTransacciones(transaccionesPageNum - 1)} class="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50">Anterior</button>
						<span class="text-sm text-slate-500">{transaccionesPageNum} / {transaccionesTotalPages}</span>
						<button type="button" disabled={transaccionesPageNum >= transaccionesTotalPages} onclick={() => irAPaginaTransacciones(transaccionesPageNum + 1)} class="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50">Siguiente</button>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	{#if !esSinTipo}
	<h2 class="text-sm font-semibold text-[#0f3b5e] mb-2">{verEliminados ? `${pluralTab} eliminadas` : 'Documentos emitidos'}</h2>

	<ColumnFilterBar fields={tableFields} bind:filters={columnFilters} dynamicOptions={dynamicOptions} onChange={handleColumnFiltersChange} />

	<div class="mb-4 flex flex-wrap items-center gap-3">
		<div class="relative flex-1 min-w-[220px] max-w-sm">
			<Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
			<input
				type="text"
				value={searchInput}
				oninput={(e) => onSearchInput((e.target as HTMLInputElement).value)}
				placeholder="Buscar por Folio o Cliente..."
				class="w-full pl-9 pr-8 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
			/>
			{#if searchInput}
				<button type="button" onclick={() => onSearchInput('')} class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Limpiar búsqueda">
					<X size={14} />
				</button>
			{/if}
		</div>
		<select value={sortBy} onchange={(e) => toggleSort((e.target as HTMLSelectElement).value, true)} class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200">
			{#each tableFields.filter((f) => f.sortable) as field}
				<option value={field.key}>Ordenar: {field.label}</option>
			{/each}
		</select>
		<button type="button" onclick={() => toggleSort(sortBy)} class="p-2 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50" title={sortDir === 'asc' ? 'Ascendente' : 'Descendente'} aria-label="Cambiar dirección de orden">
			{#if sortDir === 'asc'}<ChevronUp size={16} />{:else}<ChevronDown size={16} />{/if}
		</button>
	</div>

	<div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
		<div class="overflow-x-auto">
			<div class="min-w-[860px]">
				<div class="grid grid-cols-[1.2fr_1fr_2fr_1fr_1.1fr_0.9fr_104px] gap-3 items-center px-4 py-2 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
					<span>Folio</span>
					<span>Fecha</span>
					<span>Cliente</span>
					<span>Forma de pago</span>
					<span class="text-right pr-4">Importe Total</span>
					<span>Estado</span>
					<span class="text-right">Acciones</span>
				</div>

				{#each items as item (item.id_factura)}
					<div class="grid grid-cols-[1.2fr_1fr_2fr_1fr_1.1fr_0.9fr_104px] gap-3 items-center px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors">
						<span class="font-semibold text-slate-700 text-sm">{item.folio}</span>
						<span class="text-sm text-slate-600">{formatDate(item.fecha_emision)}</span>
						<span class="text-sm text-slate-600 truncate">{item.cliente_nombre ?? item.cliente?.nombre ?? 'Sin cliente'}</span>
						<span class="text-sm text-slate-600">{getOptionLabel(formaPagoField, item.forma_pago)}</span>
						<span class="text-sm font-semibold text-slate-800 text-right pr-4">{item.moneda === 'USD' ? 'US$ ' + Number(item.monto_total).toLocaleString('es-PE', { minimumFractionDigits: 2 }) : formatCurrency(item.monto_total)}</span>
						<span>
							<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${estadoBadgeClass[item.estado] ?? 'bg-slate-100 text-slate-600'}`}>
								{getOptionLabel(estadoField, item.estado)}
							</span>
						</span>
						<div class="flex items-center gap-1 justify-end">
							{#if verEliminados}
								<button type="button" onclick={() => handleRestaurar(item)} class="p-1.5 rounded-lg text-slate-500 hover:bg-emerald-50 hover:text-emerald-600" title="Restaurar" aria-label="Restaurar">
									<RotateCcw size={16} />
								</button>
								{#if isAdmin()}
									<button type="button" onclick={() => handleEliminarPermanente(item)} class="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600" title="Eliminar permanentemente" aria-label="Eliminar permanentemente">
										<Trash size={16} />
									</button>
								{/if}
							{:else}
								<button type="button" onclick={() => openPreview(item)} class="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600" title="Ver" aria-label="Ver">
									<Eye size={16} />
								</button>
								{#if item.estado === 'borrador'}
									<button type="button" onclick={() => openEdit(item)} class="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600" title="Editar" aria-label="Editar">
										<Pencil size={16} />
									</button>
								{/if}
								<button type="button" onclick={() => handleDarDeBaja(item)} class="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600" title="Dar de baja" aria-label="Dar de baja">
									<Trash2 size={16} />
								</button>
							{/if}
						</div>
					</div>
				{:else}
					<p class="px-4 py-10 text-center text-slate-400">{loading ? 'Cargando...' : `No se encontraron ${pluralTab.toLowerCase()}.`}</p>
				{/each}
			</div>
		</div>
	</div>

	{#if totalPages > 1}
		<div class="flex items-center justify-between mt-4">
			<p class="text-xs text-slate-400">{total} documento{total === 1 ? '' : 's'} en total</p>
			<div class="flex items-center gap-2">
				<button type="button" disabled={pageNum <= 1} onclick={() => { pageNum -= 1; fetchList(); }} class="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50">Anterior</button>
				<span class="text-sm text-slate-500">{pageNum} / {totalPages}</span>
				<button type="button" disabled={pageNum >= totalPages} onclick={() => { pageNum += 1; fetchList(); }} class="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50">Siguiente</button>
			</div>
		</div>
	{/if}
	{/if}
</div>

<FacturaModal open={modalOpen} mode={modalMode} tipoComprobante={comprobanteModal} factura={editingFactura} detalleInicial={editingDetalle} {preseleccion} onClose={closeModal} onSaved={handleSaved} />

<FacturaPreviewModal open={previewOpen} datos={previewDatos} onClose={closePreview} />
<DocumentPreviewModal open={imagenOpen} documents={imagenDocs} title={imagenTitle} onClose={() => (imagenOpen = false)} />
<DocumentPreviewModal open={docsOpen} documents={docsLista} title={docsTitle} onClose={() => (docsOpen = false)} />

<ConfirmModal
	open={confirmDarDeBajaOpen}
	title={`Dar de baja ${nombreTab.toLowerCase()}`}
	message={facturaParaDarDeBaja ? (facturaParaDarDeBaja.estado === 'emitida' ? `¿Dar de baja ${facturaParaDarDeBaja.folio}? Quedará ANULADA y sus transacciones volverán a estar sin comprobante (azul). No se puede restaurar.` : `¿Dar de baja el borrador ${facturaParaDarDeBaja.folio}? Quedará marcado como inactivo.`) : ''}
	confirmLabel="Dar de baja"
	onConfirm={confirmarDarDeBaja}
	onClose={closeConfirmDarDeBaja}
/>

<AdminConfirmModal
	open={confirmEliminarPermanenteOpen}
	title={`Eliminar ${nombreTab.toLowerCase()} permanentemente`}
	message={facturaParaEliminarPermanente ? `Vas a eliminar PERMANENTEMENTE ${facturaParaEliminarPermanente.folio}, su detalle y sus imágenes guardadas. Sus transacciones (si las tenía) quedarán libres. Esta acción no se puede deshacer. Ingresa el correo y la contraseña de un administrador para continuar.` : ''}
	confirmLabel="Eliminar permanentemente"
	onConfirm={confirmarEliminarPermanente}
	onClose={closeConfirmEliminarPermanente}
/>
