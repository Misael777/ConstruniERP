<script lang="ts">
	// Gestión de Comprobantes (Finanzas) — 4 pestañas (Factura / Boleta / Nota de Crédito / Nota de
	// Débito), TODAS con el mismo mecanismo (a pedido explícito del usuario: "cada pestaña debe mostrar
	// la relación de transacciones tipo ingreso según el tipo de documento"): se clasifican las
	// transacciones de ingreso por transaccion.tipo_documento (ver TIPO_DOCUMENTO_POR_COMPROBANTE en
	// facturacion.service.ts) — sin comprobante = azul lino y seleccionable; marcar el check abre
	// "Nueva Factura/Boleta/Nota de Crédito/Nota de Débito" con esa transacción y su cliente ya
	// precargados. Documento INTERNO (sin firma digital ni OSE). Una vez emitido, guarda su imagen/PDF en
	// Drive; el ojito de "Documentos emitidos" abre esa imagen guardada.
	import { onMount, onDestroy, untrack } from 'svelte';
	import { getCentroCostoTipoMap } from '$lib/modules/transacciones/services/transacciones.service';
	import { clientesState, suscribirClientes, opcionesClientes } from '$lib/stores/clientes.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { CLAVE_FLUJO_CIERRE_VENTA } from '$lib/modules/ventas/services/flujoCierreVenta';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin, puedeVerEliminados } from '$lib/stores/permisos.svelte';
	import { Briefcase, HardHat, Building2, Ellipsis, Plus, Pencil, Trash2, Trash, RotateCcw, Search, ChevronUp, ChevronDown, ChevronLeft, X, FileText, Eye, TrendingUp, Inbox, Percent, CheckCircle2, Receipt, FileMinus, FilePlus, Check } from '@lucide/svelte';
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
import { datosPdfDesdeFactura } from '$lib/modules/facturacion/services/facturaPdfDatos';
	import { FIELDS_CONFIG as TRANSACCION_FIELDS } from '$lib/modules/transacciones/config/transaccion.config';

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

	// Filtros (segmentado compacto) por tipo de documento — a pedido explícito del usuario: 'todos' (pantalla
	// inicial: TODAS las transacciones de ingreso) | Facturas | Boletas de venta | Notas de crédito | Notas de
	// débito.
	type TabValue = TipoComprobante | 'todos';
	const TABS: { value: TabValue; label: string; plural: string; filtro: string; icon: typeof FileText }[] = [
		{ value: 'todos', label: 'Comprobantes', plural: 'Comprobantes', filtro: 'Todas', icon: FileText },
		{ value: 'factura', label: 'Factura', plural: 'Facturas', filtro: 'Facturas', icon: FileText },
		{ value: 'boleta', label: 'Boleta', plural: 'Boletas', filtro: 'Boletas de venta', icon: Receipt },
		{ value: 'comprobante_venta', label: 'Comprobante de Venta', plural: 'Comprobantes de Venta', filtro: 'Comprobantes de venta', icon: Receipt },
		{ value: 'nota_credito', label: 'Nota de Crédito', plural: 'Notas de Crédito', filtro: 'Notas de crédito', icon: FileMinus },
		{ value: 'nota_debito', label: 'Nota de Débito', plural: 'Notas de Débito', filtro: 'Notas de débito', icon: FilePlus }
	];

	let activeTab = $state<TabValue>('todos');
	const tabActual = $derived(TABS.find((t) => t.value === activeTab)!);
	const nombreTab = $derived(tabActual.label);
	const pluralTab = $derived(tabActual.plural);

		// Tab inferior: transacciones sin emisión de comprobantes | comprobantes emitidos.
	type VistaTx = 'pendientes' | 'emitidas';
	let vistaTx = $state<VistaTx>('pendientes');

		// Desplegable POR FILA — a pedido explícito del usuario: en el tab "sin emisión de comprobantes" (columna
	// "Tipo de documento") Emitir Factura / Emitir Boleta / Emitir Comprobante de Venta, con el tipo registrado como
	// valor por defecto (Boleta de venta→Emitir Boleta; Comprobante de Venta→Emitir Comprobante de Venta; cualquier
	// otro o sin tipo→Emitir Factura). En el tab "con comprobantes
	// emitidos" (columna "Emitir nota") solo Nota de Crédito / Nota de Débito.
	const ACCIONES_EMISION: { value: TipoComprobante; label: string }[] = [
		{ value: 'factura', label: 'Emitir Factura' },
		{ value: 'boleta', label: 'Emitir Boleta' },
		{ value: 'comprobante_venta', label: 'Comprobante de venta' }
	];
	const ACCIONES_NOTA: { value: TipoComprobante; label: string }[] = [
		{ value: 'nota_credito', label: 'Nota de Crédito' },
		{ value: 'nota_debito', label: 'Nota de Débito' }
	];
	let accionFila = $state<Record<number, TipoComprobante>>({});
	function accionDeFila(t: TransaccionFacturable): TipoComprobante {
		const registrado = t.tipo_documento ? COMPROBANTE_POR_TIPO_DOCUMENTO[t.tipo_documento] : undefined;
		return accionFila[t.id_transaccion] ?? (registrado === 'boleta' || registrado === 'comprobante_venta' ? registrado : 'factura');
	}
// Tipo de comprobante con el que se abre el formulario (Nueva Factura/Boleta/Nota…).
	let tipoModal = $state<TipoComprobante>('factura');

// Etiqueta legible del tipo de documento de una transacción (mismo catálogo de Transacciones).
	const TIPO_DOC_LABEL = new Map<string, string>((TRANSACCION_FIELDS.find((f) => f.key === 'tipo_documento')?.options ?? []).map((o) => [o.value, o.label]));
	function tipoDocLabel(v: string | null): string {
		return v ? (TIPO_DOC_LABEL.get(v) ?? v) : '—';
	}

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
	let preseleccion = $state<{ idCliente: number; idTransaccion: number | null; idTransacciones?: number[] } | null>(null);
	let folioReferenciaModal = $state<string | null>(null);

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

	// Filtro "Tipo" (a pedido del usuario: los mismos de Panoramas): Consultoría/Obra/Corporativo/Otros por el
	// TIPO del centro de costo DESTINO de cada transacción (el proyecto que recibe el ingreso). Filtra las
	// transacciones sin comprobante y los documentos emitidos.
	type TipoFiltroCC = 'consultoria' | 'obra' | 'bolsa general' | 'otro';
	const TIPOS_POR_FILTRO: Record<TipoFiltroCC, string[]> = {
		consultoria: ['consultoria'],
		obra: ['proyecto', 'obra'],
		'bolsa general': ['bolsa general'],
		otro: ['otro']
	};
	let tipoFilter = $state<TipoFiltroCC | null>(null);
	let centroCostoTipoMap = $state<Record<string, string>>({});
	function idsDestinoFiltro(): number[] | undefined {
		if (!tipoFilter) return undefined;
		const tipos = TIPOS_POR_FILTRO[tipoFilter];
		return Object.entries(centroCostoTipoMap).filter(([, t]) => tipos.includes(t)).map(([id]) => Number(id));
	}
	function toggleTipoFilter(tipo: TipoFiltroCC) {
		tipoFilter = tipoFilter === tipo ? null : tipo;
		pageNum = 1;
		transaccionesPageNum = 1;
		fetchList();
		fetchSuperior();
	}

	async function fetchList() {
		loading = true;
		loadError = '';
		try {
			const result = await getFacturas(supabase, { page: pageNum, pageSize: DEFAULT_PAGE_SIZE, search, sortBy, sortDir, columnFilters, soloEliminados: verEliminados, tipoComprobante: activeTab === 'todos' ? undefined : activeTab, idsCentroDestino: idsDestinoFiltro() });
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
		try {
			kpis = await getKpisComprobante(supabase, activeTab === 'todos' ? null : activeTab);
		} catch (err) {
			console.error('[Gestión de Comprobantes] No se pudieron cargar los KPIs:', err);
		}
	}

	async function fetchSuperior() {
		cargandoSuperior = true;
		try {
			const result = await getTransaccionesFacturables(supabase, activeTab === 'todos' ? undefined : TIPO_DOCUMENTO_POR_COMPROBANTE[activeTab], { page: transaccionesPageNum, pageSize: DEFAULT_PAGE_SIZE, vista: 'pendientes', idsCentroDestino: idsDestinoFiltro() });
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
			const tipoPrecarga = COMPROBANTE_POR_TIPO_DOCUMENTO[String(datos.tipoDocumento)];
			// Viene del cierre de una venta (ver ventas/+page.svelte): al cerrar el comprobante se sigue a la Cuenta por
			// Cobrar. Si este tipo no se emite desde el ERP, se sigue de una vez.
			flujoVentaPendiente = hayFlujoCierreVenta();
			if (flujoVentaPendiente && (!tipoPrecarga || !datos.idCliente)) {
				toast.info(tipoPrecarga ? 'No se pudo precargar el cliente: emite el comprobante a mano.' : 'Este tipo de comprobante todavía no se emite desde el ERP — regístralo a mano.');
				volverAlCierreDeVenta();
				return true;
			}
			// Sin pestaña para ese tipo (Recibo por Honorarios) o sin cliente: solo se abre
			// el módulo (en su pestaña, o en "Todos"), sin "Nuevo Comprobante".
			activeTab = tipoPrecarga ?? 'todos';
			vistaTx = 'pendientes';
			await fetchTab();
			if (!tipoPrecarga || !datos.idCliente) return true;
			tipoModal = tipoPrecarga;
			modalMode = 'create';
			editingFactura = null;
			editingDetalle = [];
			preseleccion = { idCliente: datos.idCliente, idTransaccion: datos.idTransaccion, idTransacciones: Array.isArray(datos.idTransacciones) ? datos.idTransacciones : undefined };
			modalOpen = true;
			return true;
		} catch (err) {
			console.error('[Gestión de Comprobantes] No se pudo leer la precarga de la transacción:', err);
			toast.error('No se pudo precargar el comprobante — complétalo a mano.');
			return false;
		}
	}

	onMount(async () => {
		getCentroCostoTipoMap(supabase)
			.then((mapa) => (centroCostoTipoMap = mapa))
			.catch((err) => console.error('[Gestión de Comprobantes] No se pudo cargar el tipo de los centros de costo:', err));
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

		function switchVista(v: VistaTx) {
		if (v === vistaTx) return;
		vistaTx = v;
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
		tipoModal = activeTab === 'todos' ? 'factura' : activeTab;
		abrirModalCrear(null);
	}

	function abrirModalCrear(pre: { idCliente: number; idTransaccion: number | null } | null, folioReferencia: string | null = null) {
		modalMode = 'create';
		editingFactura = null;
		editingDetalle = [];
		preseleccion = pre;
		folioReferenciaModal = folioReferencia;
		modalOpen = true;
	}

		/** Elegir una fila de la tabla de transacciones (sin comprobante): abre el formulario del tipo elegido en el
	 * desplegable de esa fila (por defecto, su tipo de documento registrado), con el cliente y la transacción ya
	 * precargados. */
	function clickTransaccion(t: TransaccionFacturable) {
		if (t.idCliente == null) return;
		tipoModal = accionDeFila(t);
		abrirModalCrear({ idCliente: t.idCliente, idTransaccion: t.id_transaccion });
	}

	/** Tab "con comprobantes emitidos": Nota de Crédito/Débito sobre un comprobante EMITIDO — se abre con su cliente
	 * y, en la Nota de Crédito, el número de ese comprobante como referencia. */
	/** A pedido del usuario: en cada documento emitido se MARCA la casilla y se elige el tipo de nota en
	 * "Emitir nota" (en cualquier orden); con ambas cosas hechas se abre el formulario de esa nota. */
	let notaFila = $state<Record<number, TipoComprobante>>({});
	let marcadasNota = $state<number[]>([]);
	function intentarAbrirNota(item: Factura) {
		const tipo = notaFila[item.id_factura];
		if (!tipo || !marcadasNota.includes(item.id_factura)) return;
		marcadasNota = marcadasNota.filter((id) => id !== item.id_factura);
		const { [item.id_factura]: _, ...resto } = notaFila;
		notaFila = resto;
		emitirNotaDesdeDocumento(item, tipo);
	}
	function toggleMarcaNota(item: Factura) {
		const marcada = marcadasNota.includes(item.id_factura);
		marcadasNota = marcada ? marcadasNota.filter((id) => id !== item.id_factura) : [...marcadasNota, item.id_factura];
		if (!marcada) {
			if (notaFila[item.id_factura]) intentarAbrirNota(item);
			else toast.info(`Elige en "Emitir nota" si es Nota de Crédito o de Débito para ${item.folio}.`);
		}
	}
	function elegirNotaFila(item: Factura, tipo: TipoComprobante) {
		notaFila = { ...notaFila, [item.id_factura]: tipo };
		if (marcadasNota.includes(item.id_factura)) intentarAbrirNota(item);
		else toast.info(`Marca la casilla de ${item.folio} para generar la nota.`);
	}

	function emitirNotaDesdeDocumento(item: Factura, tipo: TipoComprobante) {
		if (item.estado !== 'emitida') return;
		tipoModal = tipo;
		abrirModalCrear({ idCliente: item.id_cliente, idTransaccion: null }, item.folio);
	}

	async function openEdit(item: Factura) {
		const full = await getFacturaConDetalle(supabase, item.id_factura);
		if (!full) return;
		modalMode = 'edit';
		editingFactura = full.factura;
		editingDetalle = full.detalle;
		preseleccion = null;
		folioReferenciaModal = null;
		modalOpen = true;
	}

	/** ¿Hay un cierre de venta esperando a que se emita su comprobante? (ver abrirDesdeTransaccionPrefill) */
	let flujoVentaPendiente = false;
	function hayFlujoCierreVenta(): boolean {
		try {
			return !!sessionStorage.getItem(CLAVE_FLUJO_CIERRE_VENTA);
		} catch {
			return false;
		}
	}
	function volverAlCierreDeVenta() {
		flujoVentaPendiente = false;
		let idCuenta: number | null = null;
		try {
			idCuenta = JSON.parse(sessionStorage.getItem(CLAVE_FLUJO_CIERRE_VENTA) ?? '{}').idCuentaCobrar ?? null;
			sessionStorage.removeItem(CLAVE_FLUJO_CIERRE_VENTA);
		} catch {
			/* sin flujo guardado */
		}
		if (idCuenta) goto(`/finanzas/cuentas-cobrar?resumenCuenta=${idCuenta}`);
	}

	function closeModal() {
		if (flujoVentaPendiente) volverAlCierreDeVenta();
		modalOpen = false;
		editingFactura = null;
		editingDetalle = [];
		preseleccion = null;
		folioReferenciaModal = null;
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
			imagenTitle = `${TABS.find((x) => x.value === factura.tipo_comprobante)?.label ?? 'Comprobante'} ${factura.folio}`;
			imagenDocs = [
				{ url: factura.imagen_url, label: 'Imagen' },
				...archivos.filter((a) => a.tipo === 'pdf').map((a) => ({ url: a.url, label: 'PDF' }))
			];
			imagenOpen = true;
			return;
		}

		previewDatos = datosPdfDesdeFactura(factura, detalle, factura.estado === 'anulada' ? 'ANULADA' : 'BORRADOR');
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

	// A pedido del usuario: la lista de clientes es la misma del Directorio de Clientes (solo activos) y se
	// actualiza sola al cambiar — ver $lib/stores/clientes.svelte.ts.
	onDestroy(suscribirClientes());
	$effect(() => {
		if (!clientesState.cargado) return;
		const opciones = opcionesClientes();
		untrack(() => (dynamicOptions = { ...dynamicOptions, id_cliente: opciones }));
	});
</script>

{#snippet tablaTx(lista: TransaccionFacturable[], cargando: boolean, vacio: string)}
	<div class="overflow-x-auto">
		<div class="min-w-[1000px]">
			<div class="grid grid-cols-[auto_0.9fr_1.3fr_1fr_minmax(10.5rem,1fr)_1.6fr_1.2fr_1fr_auto] gap-3 items-center px-4 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase">
				<span class="w-4"></span>
				<span>Fecha</span>
				<span>Cliente</span>
				<span>Categoría</span>
				<span>Tipo de documento</span>
				<span>Descripción</span>
				<span>Destino</span>
				<span class="text-right">Monto</span>
				<span class="text-center">Soportes</span>
			</div>
			{#each lista as t (t.id_transaccion)}
				{@const facturada = t.id_factura != null}
				<div
					role="button"
					tabindex="0"
					onclick={() => clickTransaccion(t)}
					onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && clickTransaccion(t)}
					class="grid grid-cols-[auto_0.9fr_1.3fr_1fr_minmax(10.5rem,1fr)_1.6fr_1.2fr_1fr_auto] gap-3 items-center px-4 py-2.5 border-b last:border-b-0 text-sm cursor-pointer"
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
					<select
						value={accionDeFila(t)}
						title={`Tipo de documento registrado: ${tipoDocLabel(t.tipo_documento)}`}
						onclick={(e) => e.stopPropagation()}
						onkeydown={(e) => e.stopPropagation()}
						onchange={(e) => (accionFila = { ...accionFila, [t.id_transaccion]: (e.target as HTMLSelectElement).value as TipoComprobante })}
						class="w-full min-w-0 rounded-md border border-slate-300 bg-white px-1.5 py-1 text-[11px] font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
					>
						{#each ACCIONES_EMISION as a (a.value)}
							<option value={a.value}>{a.label}</option>
						{/each}
					</select>
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
				<p class="px-4 py-8 text-center text-xs text-slate-400">{cargando ? 'Cargando...' : vacio}</p>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet paginacionTx(totalItems: number, pagina: number, paginas: number, irA: (n: number) => void)}
	{#if paginas > 1}
		<div class="flex items-center justify-between px-4 py-3 border-t border-slate-200">
			<p class="text-xs text-slate-400">{totalItems} transacción{totalItems === 1 ? '' : 'es'} en total</p>
			<div class="flex items-center gap-2">
				<button type="button" disabled={pagina <= 1} onclick={() => irA(pagina - 1)} class="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50">Anterior</button>
				<span class="text-sm text-slate-500">{pagina} / {paginas}</span>
				<button type="button" disabled={pagina >= paginas} onclick={() => irA(pagina + 1)} class="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50">Siguiente</button>
			</div>
		</div>
	{/if}
{/snippet}

<div class="p-4 md:p-6">
	<div class="flex items-center justify-between mb-4 flex-wrap gap-3">
		<div class="flex items-center gap-3">
			<FileText class="text-[#0f3b5e]" size={28} />
			<div>
				<h1 class="text-xl font-bold text-[#0f3b5e]">Emisión de Comprobantes</h1>
				<p class="text-sm text-slate-500">Factura a tus clientes a partir de sus pagos ya registrados, previsualiza y autoriza antes de emitir</p>
			</div>
		</div>
	</div>

	<div class="flex flex-wrap items-center justify-end mb-4 gap-2">
		{#if !verEliminados}
			<!-- Filtro "Tipo" (mismas píldoras que Panoramas de Cobro/Pago), ver toggleTipoFilter. -->
			<div class="mr-auto flex flex-wrap gap-2">
				{#each [
					{ v: 'consultoria', l: 'Consultoria', icono: Briefcase, activo: 'border-blue-300 bg-blue-50', circulo: 'bg-blue-100 text-blue-600' },
					{ v: 'obra', l: 'Obra', icono: HardHat, activo: 'border-orange-300 bg-orange-50', circulo: 'bg-orange-100 text-orange-500' },
					{ v: 'bolsa general', l: 'Corporativo', icono: Building2, activo: 'border-emerald-300 bg-emerald-50', circulo: 'bg-emerald-100 text-emerald-600' },
					{ v: 'otro', l: 'Otros', icono: Ellipsis, activo: 'border-slate-400 bg-slate-100', circulo: 'bg-slate-700 text-white' }
				] as op (op.v)}
					<button
						type="button"
						onclick={() => toggleTipoFilter(op.v as TipoFiltroCC)}
						aria-pressed={tipoFilter === op.v}
						class={`flex items-center gap-2 pl-2 pr-4 py-1.5 rounded-full border text-left transition-colors ${tipoFilter === op.v ? op.activo : 'border-slate-200 bg-white hover:bg-slate-50'}`}
					>
						<div class={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${op.circulo}`}>
							<op.icono size={14} />
						</div>
						<span class="font-semibold text-slate-700 text-sm">{op.l}</span>
					</button>
				{/each}
			</div>
		{/if}
		{#if puedeVerEliminados() && !verEliminados}
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

	<!-- KPIs: compactos (ícono a la izquierda, etiqueta y monto a la derecha) y cada uno con su color — a pedido
	     explícito del usuario, para que no ocupen tanto espacio. -->
	<div class="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
		<div class="flex items-center gap-2.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 min-w-0">
			<div class="w-7 h-7 rounded-md bg-blue-500 text-white flex items-center justify-center shrink-0"><TrendingUp size={14} /></div>
			<div class="min-w-0">
				<p class="text-[11px] font-medium text-blue-700 truncate">{activeTab === 'todos' ? 'Total Emitido' : `Total Emitido en ${nombreTab}`} (Mes Actual)</p>
				<p class="text-base font-bold text-blue-900 leading-tight">{formatCurrency(kpis.totalFacturadoMes)}</p>
			</div>
		</div>
		<div class="flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 min-w-0">
			<div class="w-7 h-7 rounded-md bg-amber-500 text-white flex items-center justify-center shrink-0"><Inbox size={14} /></div>
			<div class="min-w-0">
				<p class="text-[11px] font-medium text-amber-700 truncate">{activeTab === 'todos' ? 'Por Emitir' : `Por Emitir (${nombreTab})`}</p>
				<p class="text-base font-bold text-amber-900 leading-tight">{formatCurrency(kpis.porFacturar)}</p>
				<p class="text-[10px] text-amber-600 truncate">{kpis.porFacturarCount} transacción{kpis.porFacturarCount === 1 ? '' : 'es'} sin comprobante</p>
			</div>
		</div>
		<div class="flex items-center gap-2.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 min-w-0">
			<div class="w-7 h-7 rounded-md bg-purple-500 text-white flex items-center justify-center shrink-0"><Percent size={14} /></div>
			<div class="min-w-0">
				<p class="text-[11px] font-medium text-purple-700 truncate">Detracciones Acumuladas</p>
				<p class="text-base font-bold text-purple-900 leading-tight">{formatCurrency(kpis.detraccionesAcumuladas)}</p>
			</div>
		</div>
		<div class="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 min-w-0">
			<div class="w-7 h-7 rounded-md bg-emerald-500 text-white flex items-center justify-center shrink-0"><CheckCircle2 size={14} /></div>
			<div class="min-w-0">
				<p class="text-[11px] font-medium text-emerald-700 truncate">{activeTab === 'todos' ? 'Comprobantes Emitidos' : `${pluralTab} Emitidas`}</p>
				<p class="text-base font-bold text-emerald-900 leading-tight">{kpis.facturasEmitidas}</p>
			</div>
		</div>
	</div>

	<!-- Filtros compactos (por tipo de documento) + desplegable de acción, alineados a la derecha — a pedido
	     explícito del usuario: más chicos y fuera del centro de la página. -->
	<div class="mb-3 flex flex-wrap items-center justify-start gap-x-5 gap-y-2">
		<div class="flex items-center gap-1.5">
			<span class="text-[10px] font-bold uppercase tracking-wide text-slate-700">Filtrar</span>
			<div class="inline-flex flex-wrap overflow-hidden rounded-md border border-slate-200 bg-white">
				{#each TABS as tab, i (tab.value)}
					<button
						type="button"
						onclick={() => switchTab(tab.value)}
						class={`px-2.5 py-1 text-[11px] font-bold transition-colors ${i > 0 ? 'border-l border-slate-200' : ''} ${activeTab === tab.value ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
					>
						{tab.filtro}
					</button>
				{/each}
			</div>
		</div>
			</div>

		{#if !verEliminados}
		<!-- INFERIOR: 2 tabs — transacciones sin emisión de comprobantes | transacciones con comprobantes emitidos. -->
		<div class="mb-3 flex flex-wrap items-center gap-1 border-b border-slate-200">
			<button
				type="button"
				onclick={() => switchVista('pendientes')}
				class={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${vistaTx === 'pendientes' ? 'border-[#0f3b5e] text-[#0f3b5e]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
			>
				Transacciones sin emisión de comprobantes
				<span class="px-1.5 py-0.5 rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">{transaccionesTotal}</span>
			</button>
			<button
				type="button"
				onclick={() => switchVista('emitidas')}
				class={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${vistaTx === 'emitidas' ? 'border-[#0f3b5e] text-[#0f3b5e]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
			>
				Transacciones con comprobantes emitidos
				<span class="px-1.5 py-0.5 rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">{total}</span>
			</button>
		</div>
	{/if}

	{#if !verEliminados && vistaTx === 'pendientes'}
		<div class="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
			{@render tablaTx(transaccionesPendientes, cargandoSuperior, 'No hay transacciones de ingreso pendientes de emitir' + (activeTab === 'todos' ? '.' : ` (${tabActual.filtro}).`))}
			{@render paginacionTx(transaccionesTotal, transaccionesPageNum, transaccionesTotalPages, irAPaginaTransacciones)}
		</div>
	{:else}
	<h2 class="text-sm font-semibold text-[#0f3b5e] mb-2">{verEliminados ? `${pluralTab} eliminadas` : 'Documentos emitidos'}</h2>

	<!-- Filtros de los comprobantes emitidos: pequeños y en UNA sola línea (a pedido explícito del usuario). -->
	<div class="mb-3 flex flex-wrap items-start gap-2">
		<div class="[&>div]:mb-0 [&>div>button]:py-1.5 [&>div>button]:text-xs">
			<ColumnFilterBar fields={tableFields} bind:filters={columnFilters} dynamicOptions={dynamicOptions} onChange={handleColumnFiltersChange} />
		</div>
		<div class="relative w-60 max-w-full">
			<Search size={14} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
			<input
				type="text"
				value={searchInput}
				oninput={(e) => onSearchInput((e.target as HTMLInputElement).value)}
				placeholder="Buscar por Folio o Cliente..."
				class="w-full pl-8 pr-7 py-1.5 rounded-lg border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200"
			/>
			{#if searchInput}
				<button type="button" onclick={() => onSearchInput('')} class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Limpiar búsqueda">
					<X size={12} />
				</button>
			{/if}
		</div>
		<select
			value={sortBy}
			onchange={(e) => toggleSort((e.target as HTMLSelectElement).value, true)}
			class="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
			aria-label="Ordenar por"
		>
			{#if !tableFields.some((x) => x.sortable && x.key === sortBy)}
				<option value={sortBy}>Ordenar: Más recientes</option>
			{/if}
			{#each tableFields.filter((x) => x.sortable) as field (field.key)}
				<option value={String(field.key)}>Ordenar: {field.label}</option>
			{/each}
		</select>
		<button type="button" onclick={() => toggleSort(sortBy)} class="p-1.5 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50" title={sortDir === 'asc' ? 'Ascendente' : 'Descendente'} aria-label="Cambiar dirección de orden">
			{#if sortDir === 'asc'}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
		</button>
	</div>

	<div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
		<div class="overflow-x-auto">
			<div class="min-w-[1100px]">
				<div class="grid grid-cols-[auto_1.2fr_0.9fr_1fr_2fr_1fr_1.1fr_0.9fr_170px_104px] gap-3 items-center px-4 py-2 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
					<span class="w-4"></span>
					<span>Folio</span>
					<span>Tipo</span>
					<span>Fecha</span>
					<span>Cliente</span>
					<span>Forma de pago</span>
					<span class="text-right pr-4">Importe Total</span>
					<span>Estado</span>
					<span>Emitir nota</span>
						<span class="text-right">Acciones</span>
				</div>

				{#each items as item (item.id_factura)}
					<div class="grid grid-cols-[auto_1.2fr_0.9fr_1fr_2fr_1fr_1.1fr_0.9fr_170px_104px] gap-3 items-center px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors">
						{#if !verEliminados && item.estado === 'emitida'}
							<!-- A pedido del usuario: casilla para marcar el comprobante emitido y pasar a la Nota de
							     Crédito/Débito elegida en "Emitir nota" (igual que el tab "sin emisión"). -->
							{@const marcada = marcadasNota.includes(item.id_factura)}
							<button
								type="button"
								role="checkbox"
								aria-checked={marcada}
								onclick={() => toggleMarcaNota(item)}
								class={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-blue-300 ${marcada ? 'bg-[#5b8fd4] border-[#5b8fd4] text-white' : 'bg-white border-[#5b8fd4] hover:bg-blue-100'}`}
								title={`Marcar ${item.folio} para emitir una nota`}
								aria-label={`Marcar ${item.folio} para emitir una nota`}
							>{#if marcada}<Check size={11} />{/if}</button>
						{:else}
							<span class="w-4 h-4 shrink-0"></span>
						{/if}
						<span class="font-semibold text-slate-700 text-sm">{item.folio}</span>
						<span class="text-xs text-slate-600">{TABS.find((x) => x.value === item.tipo_comprobante)?.label ?? '—'}</span>
						<span class="text-sm text-slate-600">{formatDate(item.fecha_emision)}</span>
						<span class="text-sm text-slate-600 truncate">{item.cliente_nombre ?? item.cliente?.nombre ?? 'Sin cliente'}</span>
						<span class="text-sm text-slate-600">{getOptionLabel(formaPagoField, item.forma_pago)}</span>
						<span class="text-sm font-semibold text-slate-800 text-right pr-4">{item.moneda === 'USD' ? 'US$ ' + Number(item.monto_total).toLocaleString('es-PE', { minimumFractionDigits: 2 }) : formatCurrency(item.monto_total)}</span>
						<span>
							<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${estadoBadgeClass[item.estado] ?? 'bg-slate-100 text-slate-600'}`}>
								{getOptionLabel(estadoField, item.estado)}
							</span>
						</span>
						{#if !verEliminados && item.estado === 'emitida'}
							<select
								value={notaFila[item.id_factura] ?? ''}
								onchange={(e) => elegirNotaFila(item, (e.target as HTMLSelectElement).value as TipoComprobante)}
								class="w-full min-w-0 rounded-md border border-slate-300 bg-white px-1.5 py-1 text-[11px] font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
								aria-label={`Tipo de nota para ${item.folio}`}
							>
								<option value="" disabled>Emitir…</option>
								{#each ACCIONES_NOTA as a (a.value)}
									<option value={a.value}>{a.label}</option>
								{/each}
							</select>
						{:else}
							<span class="text-xs text-slate-300">—</span>
						{/if}
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

<FacturaModal open={modalOpen} mode={modalMode} tipoComprobante={tipoModal} factura={editingFactura} detalleInicial={editingDetalle} {preseleccion} folioReferenciaInicial={folioReferenciaModal} onClose={closeModal} onSaved={handleSaved} />

<FacturaPreviewModal open={previewOpen} datos={previewDatos} onClose={closePreview} />
<DocumentPreviewModal open={imagenOpen} documents={imagenDocs} title={imagenTitle} onClose={() => (imagenOpen = false)} />
<DocumentPreviewModal open={docsOpen} documents={docsLista} title={docsTitle} onClose={() => (docsOpen = false)} />

<ConfirmModal
	open={confirmDarDeBajaOpen}
	title="Dar de baja comprobante"
	message={facturaParaDarDeBaja ? (facturaParaDarDeBaja.estado === 'emitida' ? `¿Dar de baja ${facturaParaDarDeBaja.folio}? Quedará ANULADA y sus transacciones volverán a estar sin comprobante (azul). No se puede restaurar.` : `¿Dar de baja el borrador ${facturaParaDarDeBaja.folio}? Quedará marcado como inactivo.`) : ''}
	confirmLabel="Dar de baja"
	onConfirm={confirmarDarDeBaja}
	onClose={closeConfirmDarDeBaja}
/>

<AdminConfirmModal
	open={confirmEliminarPermanenteOpen}
	title="Eliminar comprobante permanentemente"
	message={facturaParaEliminarPermanente ? `Vas a eliminar PERMANENTEMENTE ${facturaParaEliminarPermanente.folio}, su detalle y sus imágenes guardadas. Sus transacciones (si las tenía) quedarán libres. Esta acción no se puede deshacer. Ingresa el correo y la contraseña de un administrador para continuar.` : ''}
	confirmLabel="Eliminar permanentemente"
	onConfirm={confirmarEliminarPermanente}
	onClose={closeConfirmEliminarPermanente}
/>
