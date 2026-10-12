<script lang="ts">
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
	import { onMount, onDestroy, untrack } from 'svelte';
	import { clientesState, suscribirClientes, opcionesClientes } from '$lib/stores/clientes.svelte';
	import { setMobileFabActions } from '$lib/stores/mobileFab.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin, permisosState } from '$lib/stores/permisos.svelte';
	import { Plus, Pencil, Trash2, Trash, RotateCcw, Search, ChevronUp, ChevronDown, ChevronLeft, X, Landmark, Receipt, FileText, Lock, ShieldCheck, LayoutGrid, CreditCard, Wallet, AlertTriangle, Filter, Briefcase, HardHat, Ellipsis, Eye } from '@lucide/svelte';
	import ResumenCuentaModal, { type CampoResumen, type CuotaResumen } from '$lib/shared/components/ResumenCuentaModal.svelte';
	import { getPrestatariosDeCuentasCobrar, getPrestatarioDeCuentaCobrar } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';
	import { toast } from '$lib/stores/toast';
	import { confirmar } from '$lib/stores/confirmDialog.svelte';
	import { describeError } from '$lib/shared/describeError';
	import { verifyAdminCredentials } from '$lib/shared/adminAuth';
	import { getOptionLabel, formatCurrency, emptyColumnFilters, hasActiveColumnFilters, diasDeRetraso, type FieldOption, type ColumnFilters } from '$lib/shared/fieldConfig';
	import { FIELDS_CONFIG, DEFAULT_SORT_FIELD, DEFAULT_SORT_DIR, DEFAULT_PAGE_SIZE } from '$lib/modules/cuentas-cobrar/config/cuentaCobrar.config';
	import { FIELDS_CONFIG as COBRO_FIELDS_CONFIG } from '$lib/modules/cuentas-cobrar/config/cobro.config';
	import {
		getCuentasCobrar,
		createCuentaCobrar,
		deleteCuentaCobrar,
		darDeBajaCuentaCobrar,
		restaurarCuentaCobrar,
		getCobros,
		deleteCobro,
		getClienteOptions,
		getProyectoOptions,
		confirmarCobroCobrado,
		getMontoFiltrado
	} from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';
	import type { ServiceResult } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';
	import {
		getCentroCostoOptions,
		getCentroCostoOptionsVentasCerradas,
		getCentroCostoMontoVentaCerrada,
		getCentroCostoProyectoMap,
		getCentroCostoClienteMap,
		getCentroCostoTipoMap,
		getEmpleadoOptions,
		crearTransaccionSistema,
		deleteTransaccion
	} from '$lib/modules/transacciones/services/transacciones.service';
	import { getCuentaBancoOptions } from '$lib/modules/cuentas-bancarias/services/cuentaBanco.service';
	import { getOrCrearClientePrestamos } from '$lib/modules/clientes/services/clientes.service';
	import type { Fraccion } from '$lib/shared/components/FraccionamientoModal.svelte';
	import { getResumenCobros, getCobradoEnRango, type ResumenCobros } from '$lib/modules/panoramas/services/panoramas.service';
	import CuentaCobrarModal from '$lib/modules/cuentas-cobrar/components/CuentaCobrarModal.svelte';
	import CobroModal from '$lib/modules/cuentas-cobrar/components/CobroModal.svelte';
	import TransaccionModal from '$lib/modules/transacciones/components/TransaccionModal.svelte';
	import ColumnFilterBar from '$lib/shared/components/ColumnFilterBar.svelte';
	import ResponsiveDataView from '$lib/shared/components/ResponsiveDataView.svelte';
	import ConfirmModal from '$lib/shared/components/ConfirmModal.svelte';
	import AdminConfirmModal from '$lib/shared/components/AdminConfirmModal.svelte';
	import type { CuentaCobrar, Cobro } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';

	// Módulo 100% client-side (Supabase anon key) para funcionar en Tauri Windows/Android sin
	// servidor embebido — ver nota de seguridad en centro-costos/+page.svelte: la BD todavía no
	// tiene RLS real, este guard (isAdmin()) es solo de UI.

	const tableFields = FIELDS_CONFIG.filter((f) => f.showInTable);
	// Ticket #87: "Prioridad" no es columna (se dibuja como insignia), pero se ofrece en "Filtros" justo debajo
	// de "Estado", como pidió el cliente.
	const filterFields = (() => {
		const prioridad = FIELDS_CONFIG.find((f) => f.key === 'prioridad');
		if (!prioridad) return tableFields;
		const i = tableFields.findIndex((f) => f.key === 'estado');
		const conPrioridad = { ...prioridad, filterable: true };
		return i === -1 ? [...tableFields, conPrioridad] : [...tableFields.slice(0, i + 1), conPrioridad, ...tableFields.slice(i + 1)];
	})();
	const estadoField = FIELDS_CONFIG.find((f) => f.key === 'estado')!;
	const estadoBadgeClass: Record<string, string> = {
		pendiente: 'bg-amber-100 text-amber-700',
		pagado: 'bg-emerald-100 text-emerald-700',
		vencido: 'bg-red-100 text-red-700'
	};
	const estadoIconClass: Record<string, string> = {
		pendiente: 'bg-amber-100 text-amber-600',
		pagado: 'bg-emerald-100 text-emerald-600',
		vencido: 'bg-red-100 text-red-600'
	};
	const estadoCardClass: Record<string, string> = {
		vencido: 'bg-red-50/60'
	};

	const medioCobroField = COBRO_FIELDS_CONFIG.find((f) => f.key === 'medio_cobro')!;
	const prioridadField = FIELDS_CONFIG.find((f) => f.key === 'prioridad')!;
	const prioridadBadgeClass: Record<string, string> = {
		alto: 'bg-red-100 text-red-700',
		medio: 'bg-amber-100 text-amber-700',
		bajo: 'bg-green-100 text-green-700'
	};

	const usdFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
	function formatUSD(value: number | null | undefined): string {
		return value === null || value === undefined || Number.isNaN(Number(value)) ? '—' : usdFormatter.format(Number(value));
	}

	let items = $state<CuentaCobrar[]>([]);
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

	// Paneles resumen (KPIs) — mismo criterio que cuentas-pagar/+page.svelte: los tres primeros son
	// totales GLOBALES de toda la cartera (reutilizan getResumenCobros/getCobradoEnRango, ya probados
	// en el tablero de Panoramas de Cobro), el cuarto depende del buscador + filtros de columna (ver
	// fetchMontoFiltrado).
	let resumen = $state<ResumenCobros>({ totalPendiente: 0, vencidoTotal: 0, vencidoCount: 0, clientesConVentas: 0 });
	let cobradoDelMes = $state(0);
	let montoFiltrado = $state(0);
	let columnFilters = $state<ColumnFilters>(emptyColumnFilters(FIELDS_CONFIG));

	let dynamicOptions = $state<Record<string, FieldOption[]>>({ id_cliente: [], id_proyecto: [], id_centro_costo: [], responsable: [] });
	let transaccionDynamicOptions = $state<Record<string, FieldOption[]>>({ id_centro_costo_origen: [], id_centro_costo_destino: [], cuenta_banco: [] });
	let centroCostoMontoMap = $state<Record<string, number>>({});
	/** id_centro_costo (texto) -> id_proyecto de la venta cerrada vinculada — para autocompletar
	 * "Proyecto" con el código de ese proyecto al elegir el Centro de Costo (ver CuentaCobrarModal). */
	let centroCostoProyectoMap = $state<Record<string, string>>({});
	/** id_centro_costo (texto) -> id_cliente del proyecto vinculado — para el filtrado/autocompletado
	 * cruzado Cliente <-> Centro de Costo en CuentaCobrarModal.svelte. */
	let centroCostoClienteMap = $state<Record<string, string>>({});
	/** id_centro_costo (texto) -> tipo — para los botones "Consultoria"/"Obra"/"Corporativo"/"Otros" de
	 * abajo, mismo patrón que cuentas-pagar/+page.svelte. */
	let centroCostoTipoMap = $state<Record<string, string>>({});

	// Botones "Consultoria"/"Obra"/"Corporativo"/"Otros" (mismo diseño/lógica que ya usa Cuentas por
	// Pagar) — filtran por el TIPO real del centro de costo de cada cuenta; "Otros" es el tipo LITERAL
	// 'otro' (ver el tab "Centros de Costos", esa es la etiqueta real de OTRO-002/006/007/008, etc.),
	// MÁS las cuentas sin centro de costo asignado — bug real reportado con captura: antes era un
	// catch-all "cualquier tipo que no sea uno de los 3 conocidos", que de paso arrastraba Préstamo y
	// Cuentas Internas (cliente/proveedor/empleado/subcontratista), que NUNCA deberían aparecer bajo
	// ninguno de estos 4 botones — son una categoría aparte.
	// A pedido del usuario se quitó el botón "Corporativo" de este filtro (quedan Consultoría, Obra y Otros),
	// igual que en Cuentas por Pagar.
	type TipoFiltroCC = 'proyecto' | 'consultoria' | 'otro';
	let tipoFilter = $state<TipoFiltroCC | null>(null);

	function idsParaTipoFiltro(tipo: TipoFiltroCC): { ids: number[]; incluirSinCentroCosto: boolean } {
		const ids = Object.entries(centroCostoTipoMap)
			.filter(([, t]) => t === tipo)
			.map(([id]) => Number(id));
		return { ids, incluirSinCentroCosto: tipo === 'otro' };
	}

	function toggleTipoFilter(tipo: TipoFiltroCC) {
		tipoFilter = tipoFilter === tipo ? null : tipo;
		pageNum = 1;
		fetchList();
		fetchMontoFiltrado();
	}

	// Ticket #84: un solo botón para volver a la vista inicial — tipo (Consultoría/Obra/Otros), búsqueda,
	// filtros de columna y orden. Antes "Limpiar filtros" solo limpiaba los de columna y estaba al final
	// del panel, fuera de la pantalla.
	const hayFiltrosActivos = $derived(
		tipoFilter !== null || searchInput.trim() !== '' || hasActiveColumnFilters(columnFilters) || sortBy !== DEFAULT_SORT_FIELD || sortDir !== DEFAULT_SORT_DIR
	);
	function limpiarTodo() {
		clearTimeout(debounceTimer);
		tipoFilter = null;
		searchInput = '';
		search = '';
		columnFilters = emptyColumnFilters(filterFields);
		sortBy = DEFAULT_SORT_FIELD;
		sortDir = DEFAULT_SORT_DIR;
		pageNum = 1;
		fetchList();
		fetchMontoFiltrado();
	}

	let selectedId = $state<number | null>(null);
	let selectedCobros = $state<Cobro[]>([]);

	let modalOpen = $state(false);
	let modalMode = $state<'create' | 'edit'>('create');
	let editingCuenta = $state<CuentaCobrar | null>(null);
	// A pedido explícito del usuario: en la Cuenta por Cobrar del flujo "Préstamo Otorgado" (ver
	// clienteBloqueado más abajo), "Centro de Costo" NO debe ofrecer las ventas cerradas
	// (dynamicOptions.id_centro_costo normal) — ahí va NUESTRO centro que financia el préstamo
	// (Obra/Consultoría/Corporativo), no un proyecto vendido. Se arma cliente-side filtrando la lista
	// COMPLETA ya cargada (transaccionDynamicOptions.id_centro_costo_origen) por tipo — sin ninguna
	// consulta nueva. Si el centro ya precargado (editingCuenta.id_centro_costo, ej. tipo 'otro') no
	// calzara con esos 3 tipos, se agrega igual para no dejarlo fuera de su propia lista de opciones.
	const centroCostoOpcionesPrestamo = $derived.by(() => {
		const TIPOS = new Set(['obra', 'consultoria', 'bolsa general']);
		const todos = transaccionDynamicOptions.id_centro_costo_origen ?? [];
		const filtradas = todos.filter((o) => TIPOS.has(centroCostoTipoMap[o.value]));
		const actual = editingCuenta?.id_centro_costo != null ? String(editingCuenta.id_centro_costo) : '';
		if (actual && !filtradas.some((o) => o.value === actual)) {
			const encontrado = todos.find((o) => o.value === actual);
			if (encontrado) return [...filtradas, encontrado];
		}
		return filtradas;
	});
	/** true solo cuando el modal se abre precargado desde la transacción Egreso "Préstamo Otorgado" (ver
	 * abrirCreacionPrecargadaDesdeTransaccion) — bloquea "Cliente" en CuentaCobrarModal para que se
	 * quede fijo en el cliente genérico "PRÉSTAMOS / FINANCIERA", ver getOrCrearClientePrestamos. Mismo
	 * patrón que proveedorBloqueado en finanzas/cuentas-pagar/+page.svelte. */
	let clienteBloqueado = $state(false);
	/** Flujo "Préstamo Otorgado" (crear o editar desde una transacción Egreso de préstamo): nombre del
	 * prestatario que CuentaCobrarModal muestra en "Cliente" (rotulado "Prestatario") y los campos que vienen
	 * de la transacción y quedan bloqueados — espejo de prestamistaNombre en cuentas-pagar/+page.svelte. */
	let prestatarioNombre = $state<string | null>(null);
	let camposBloqueadosPrestamo = $state<string[]>([]);
	const CAMPOS_BLOQUEADOS_PRESTAMO = ['id_cliente', 'id_centro_costo', 'id_proyecto', 'moneda', 'monto_dolares', 'tipo_cambio', 'monto'];
	function limpiarPrestamo() {
		prestatarioNombre = null;
		camposBloqueadosPrestamo = [];
	}
	/** Datos crudos leídos del sessionStorage de la precarga (ver abrirCreacionPrecargadaDesdeTransaccion)
	 * — se conservan hasta que la cuenta se guarda para poder grabar recién ahí la transacción real del
	 * préstamo (ver crearTransaccionPorPrestamoOtorgado/handleSaved), que necesita
	 * id_centro_costo_destino (el prestatario real, no viaja en `editingCuenta` porque cuentas_cobrar no
	 * tiene esa columna). null = este alta/edición NO viene de ese flujo. */
	let prestamoPrefillDatos = $state<Record<string, unknown> | null>(null);
	// A pedido explícito del usuario: nombre del Centro de Costo Destino real (el prestatario) de la
	// transacción que originó este flujo — "Proyecto" no puede guardar ese valor (ver
	// centroCostoOpcionesPrestamo/CuentaCobrarModal.svelte, es una FK real a `proyecto`, no a
	// `centro_costo`), así que se pasa aparte para mostrarlo como texto informativo junto a ese campo
	// (además de ya quedar guardado en Observaciones, ver TransaccionModal.svelte). Búsqueda cliente-
	// side sobre la lista completa ya cargada, sin ninguna consulta nueva.
	const prestamoDestinoNombre = $derived.by(() => {
		const id = prestamoPrefillDatos?.id_centro_costo_destino != null ? String(prestamoPrefillDatos.id_centro_costo_destino) : '';
		if (!id) return '';
		const opt = (transaccionDynamicOptions.id_centro_costo_destino ?? []).find((o) => o.value === id);
		if (!opt) return '';
		const idx = opt.label.indexOf(' - ');
		return idx === -1 ? opt.label : opt.label.slice(idx + 3);
	});
	let cobroModalOpen = $state(false);
	let editingCobro = $state<Cobro | null>(null);
	/** Prellenar Monto/Fecha de Cobro al abrir "Registrar Cobro" desde la cuota sintética de una cuenta
	 * al Contado (ver cuotasAMostrar) — ver CobroModal.svelte. */
	let cobroInitialValues = $state<Record<string, string>>({});
	let transaccionModalOpen = $state(false);
	let transaccionPrefill = $state<Record<string, unknown> | null>(null);
	/** Cobro que se está confirmando como 'cobrado' vía el TransaccionModal — ver
	 * handleTransaccionSugerida/confirmarTransaccionCobro. null = TransaccionModal está en su modo
	 * normal (crear una transacción suelta), no en el flujo de confirmación obligatoria. */
	let confirmandoCobroId = $state<number | null>(null);

	// A pedido del usuario: las cuentas por cobrar dadas de baja dejan de listarse por defecto — solo
	// un admin puede activar "Ver eliminados" (mismo patrón que el resto de los módulos, ver skill
	// dar-de-baja-pattern).
	let verEliminados = $state(false);
	function toggleVerEliminados() {
		verEliminados = !verEliminados;
		fetchList();
	}

	async function fetchList() {
		loading = true;
		try {
			const filtroTipo = tipoFilter ? idsParaTipoFiltro(tipoFilter) : null;
			const result = await getCuentasCobrar(supabase, {
				page: pageNum,
				pageSize: DEFAULT_PAGE_SIZE,
				search,
				sortBy,
				sortDir,
				columnFilters,
				soloEliminados: verEliminados,
				idsCentroCosto: filtroTipo?.ids,
				incluirSinCentroCosto: filtroTipo?.incluirSinCentroCosto
			});
			items = result.items;
			prestatariosPorCuenta = await getPrestatariosDeCuentasCobrar(supabase, result.items).catch((err) => {
				console.warn('[CuentasCobrar] No se pudo resolver el nombre de los prestatarios:', err);
				return new Map<number, string>();
			});
			total = result.total;
			totalPages = result.totalPages;
			loadError = '';
		} catch (err: any) {
			loadError = err.message || 'No se pudo cargar el listado de cuentas por cobrar';
		} finally {
			loading = false;
		}
	}

	async function fetchMontoFiltrado() {
		try {
			const filtroTipo = tipoFilter ? idsParaTipoFiltro(tipoFilter) : null;
			montoFiltrado = await getMontoFiltrado(supabase, search, columnFilters, filtroTipo?.ids, filtroTipo?.incluirSinCentroCosto);
		} catch (err: any) {
			console.error('[CuentasCobrar] No se pudo calcular el total filtrado:', err);
		}
	}

	async function fetchKpis() {
		try {
			const hoy = new Date();
			const desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
			const hasta = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().slice(0, 10);
			const [resumenData, cobradoMes] = await Promise.all([getResumenCobros(supabase), getCobradoEnRango(supabase, desde, hasta)]);
			resumen = resumenData;
			cobradoDelMes = cobradoMes;
		} catch (err: any) {
			console.error('[CuentasCobrar] No se pudo calcular el resumen KPI:', err);
		}
	}

	function handleColumnFiltersChange() {
		pageNum = 1;
		fetchList();
		fetchMontoFiltrado();
	}

	async function fetchSelectedCobros() {
		if (!selectedId) {
			selectedCobros = [];
			return;
		}
		try {
			selectedCobros = await getCobros(supabase, selectedId);
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar los cobros');
		}
	}

	// Botón flotante de "+" en móvil (ver mobileFabState/MobileFab.svelte en el layout raíz).
	// Botón flotante de "+" en móvil (ver mobileFabState/MobileFab.svelte en el layout raíz) — reemplaza
	// a los dos botones "Nueva Cuenta"/"Ver Panoramas de Cobro" del header, que en pantallas angostas se
	// ocultan (ver hidden md:flex): el segundo desbordaba la pantalla al no caber en la fila.
	onDestroy(
		setMobileFabActions([
			{ label: 'Nueva Cuenta por Cobrar', icon: Plus, onclick: openCreate },
			{ label: 'Ver Panoramas de Cobro', icon: LayoutGrid, onclick: () => goto('/finanzas/cuentas-cobrar/panoramas') }
		])
	);

	onMount(async () => {
		if (!isAdmin()) {
			goto('/dashboard');
			return;
		}
		try {
			const [clienteOptions, proyectoOptions, centroCostoOptions, centroCostoOptionsVentasCerradas, montoMap, proyectoMap, clienteMap, empleadoOptions, tipoMap, cuentaBancoOptions] = await Promise.all([
				getClienteOptions(supabase),
				getProyectoOptions(supabase),
				getCentroCostoOptions(supabase),
				getCentroCostoOptionsVentasCerradas(supabase),
				getCentroCostoMontoVentaCerrada(supabase),
				getCentroCostoProyectoMap(supabase),
				getCentroCostoClienteMap(supabase),
				getEmpleadoOptions(supabase),
				getCentroCostoTipoMap(supabase),
				getCuentaBancoOptions(supabase)
			]);
			// "Centro de Costo" en Nueva/Editar Cuenta por Cobrar solo ofrece las ventas cerradas (a
			// pedido del usuario) — el de la transacción de respaldo (confirmar cobro) sigue usando la
			// lista completa sin filtrar, igual que en Cuentas por Pagar.
			dynamicOptions = { id_cliente: clienteOptions, id_proyecto: proyectoOptions, id_centro_costo: centroCostoOptionsVentasCerradas, responsable: empleadoOptions };
			// `cuenta_banco`: a pedido del usuario, "Cuenta Destino" en Confirmar Cobro / Transacción de
			// Respaldo ofrece las cuentas bancarias registradas (ver cuentaDestinoEsBancaria en
			// TransaccionModal.svelte, que ya la usaba — solo faltaba cargarla acá, igual que en
			// tranzacciones/+page.svelte y cuentas-pagar/+page.svelte).
			transaccionDynamicOptions = { id_centro_costo_origen: centroCostoOptions, id_centro_costo_destino: centroCostoOptions, cuenta_banco: cuentaBancoOptions };
			centroCostoMontoMap = montoMap;
			centroCostoProyectoMap = proyectoMap;
			centroCostoClienteMap = clienteMap;
			centroCostoTipoMap = tipoMap;
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar clientes/proyectos/centros de costo');
		}
		abrirCreacionPrecargadaDesdeTransaccion();
		abrirEdicionPrecargadaDesdeTransaccion();
		await Promise.all([fetchList(), fetchMontoFiltrado(), fetchKpis()]);
	});

	function onSearchInput(value: string) {
		searchInput = value;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			search = value;
			pageNum = 1;
			fetchList();
			fetchMontoFiltrado();
		}, 400);
	}

	function toggleSort(fieldKey: string, sortable?: boolean) {
		if (!sortable) return;
		sortDir = sortBy === fieldKey && sortDir === 'asc' ? 'desc' : 'asc';
		sortBy = fieldKey;
		pageNum = 1;
		fetchList();
	}
	function goToPage(p: number) {
		if (p < 1 || p > totalPages) return;
		pageNum = p;
		fetchList();
	}

	function formatDate(value: string | null | undefined) {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '—';
		// timeZone: 'UTC' evita el corrimiento de un día que 'new Date("YYYY-MM-DD")' produce en husos
		// horarios detrás de UTC (Perú, UTC-5) al leerse de vuelta en hora local.
		return date.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
	}

	function openCreate() {
		modalMode = 'create';
		editingCuenta = null;
		clienteBloqueado = false;
		prestamoPrefillDatos = null;
		modalOpen = true;
	}
	// A pedido explícito del usuario: si se llega acá recién después de crear una transacción Egreso de
	// tipo "Préstamo Otorgado" con Centro de Costo Origen=Corporativo (ver TransaccionModal.svelte), se
	// abre de una vez "Nueva Cuenta por Cobrar" con los datos ya conocidos precargados (Centro de
	// Costo/Monto/Fecha de Emisión) Y con "Cliente" ya fijado en el genérico "PRÉSTAMOS / FINANCIERA"
	// (ver getOrCrearClientePrestamos) — bloqueado, no editable (clienteBloqueado), porque el prestatario
	// real no necesariamente está registrado como cliente en el sistema. Mismo mecanismo cross-page que
	// abrirCreacionPrecargadaDesdeTransaccion en finanzas/cuentas-pagar/+page.svelte: TransaccionModal
	// deja los datos base en sessionStorage bajo esta misma clave justo antes de navegar acá; el id del
	// cliente genérico se resuelve/crea recién acá (async). sessionStorage y el query param se limpian
	// apenas se consumen, para no reabrirlo si el usuario solo refresca esta misma página después.
	async function abrirCreacionPrecargadaDesdeTransaccion() {
		if (page.url.searchParams.get('prefillCuentaCobrar') !== '1') return;
		const crudo = sessionStorage.getItem('cuentaCobrarPrefill');
		sessionStorage.removeItem('cuentaCobrarPrefill');
		window.history.replaceState({}, '', '/finanzas/cuentas-cobrar');
		if (!crudo) return;
		try {
			const datos = JSON.parse(crudo);
			datos.id_cliente = String(await getOrCrearClientePrestamos(supabase));
			modalMode = 'create';
			editingCuenta = datos as any;
			prestamoPrefillDatos = datos;
			clienteBloqueado = true;
			prestatarioNombre = datos.prestatario_nombre || prestamoDestinoNombre || '';
			camposBloqueadosPrestamo = CAMPOS_BLOQUEADOS_PRESTAMO;
			modalOpen = true;
		} catch (err) {
			console.error('[CuentasCobrar] No se pudo leer la precarga de la transacción:', err);
			toast.error('No se pudo precargar el cliente de préstamos — completa "Cliente" a mano.');
		}
	}
	function openEdit(item: CuentaCobrar) {
		modalMode = 'edit';
		editingCuenta = item;
		clienteBloqueado = false;
		prestamoPrefillDatos = null;
		limpiarPrestamo();
		modalOpen = true;
	}

	// A pedido explícito del usuario: al EDITAR (no crear) una transacción de Egreso con
	// Categoría="Préstamo Otorgado" y darle "Actualizar" (ver TransaccionModal.svelte), esta Cuenta por
	// Cobrar YA EXISTE (se creó junto con esa transacción, ver id_transaccion en
	// cuentasCobrar.service.ts) — no se crea una nueva, se abre esta misma en modo Editar con Valor de
	// venta/Fecha Emisión/Observaciones ya actualizados a lo que el usuario acaba de cambiar en la
	// transacción, para que los confirme con un segundo "Actualizar" acá. Mismo mecanismo cross-page
	// (sessionStorage + query param + limpieza inmediata) que abrirCreacionPrecargadaDesdeTransaccion,
	// clave distinta para no pisarse entre sí.
	async function abrirEdicionPrecargadaDesdeTransaccion() {
		if (page.url.searchParams.get('editarCuentaCobrarDesdeTransaccion') !== '1') return;
		const crudo = sessionStorage.getItem('cuentaCobrarEditarPrefill');
		sessionStorage.removeItem('cuentaCobrarEditarPrefill');
		window.history.replaceState({}, '', '/finanzas/cuentas-cobrar');
		if (!crudo) return;
		try {
			const datos = JSON.parse(crudo);
			const { data: cuenta, error } = await supabase.from('cuentas_cobrar').select('*, cliente(nombre), proyecto(nombre_proyecto)').eq('id_cuenta_cobrar', datos.id_cuenta_cobrar).single();
			if (error || !cuenta) {
				console.error('[CuentasCobrar] No se encontró la Cuenta por Cobrar vinculada a la transacción:', error);
				toast.error('No se encontró la Cuenta por Cobrar vinculada a esa transacción.');
				return;
			}
			modalMode = 'edit';
			// Los datos que vienen de la transacción (centro de costo, moneda y monto) se aplican y quedan
			// bloqueados, igual que al crear (ver datosPrestamoOtorgadoDesdeTransaccion en TransaccionModal.svelte).
			editingCuenta = {
				...(cuenta as CuentaCobrar),
				id_centro_costo: datos.id_centro_costo ?? cuenta.id_centro_costo,
				moneda: datos.moneda ?? cuenta.moneda,
				monto_dolares: datos.monto_dolares ?? cuenta.monto_dolares,
				tipo_cambio: datos.tipo_cambio ?? cuenta.tipo_cambio,
				monto: datos.monto,
				fecha_emision: datos.fecha_emision,
				observaciones: datos.observaciones ?? cuenta.observaciones
			};
			clienteBloqueado = false;
			prestamoPrefillDatos = null;
			prestatarioNombre = datos.prestatario_nombre || '';
			camposBloqueadosPrestamo = CAMPOS_BLOQUEADOS_PRESTAMO;
			modalOpen = true;
			toast.info('Revisa y confirma "Actualizar" para reflejar acá los cambios de la transacción.');
		} catch (err) {
			console.error('[CuentasCobrar] No se pudo leer la precarga de edición de la transacción:', err);
			toast.error('No se pudo precargar la Cuenta por Cobrar — actualízala a mano.');
		}
	}
	function closeModal() {
		modalOpen = false;
		editingCuenta = null;
		clienteBloqueado = false;
		prestamoPrefillDatos = null;
		limpiarPrestamo();
	}

	async function selectRow(item: CuentaCobrar) {
		selectedId = selectedId === item.id_cuenta_cobrar ? null : item.id_cuenta_cobrar;
		await fetchSelectedCobros();
	}

	const selectedCuenta = $derived(items.find((i) => i.id_cuenta_cobrar === selectedId) ?? null);

	// Contado es "una sola cuota" por definición — no genera filas reales en `cobros` (a diferencia de
	// Crédito, que las autogenera vía "Fraccionar este pago"). Mientras no exista NINGÚN cobro real
	// todavía (puede ser Contado, o Crédito sin fraccionar aún) y haya saldo pendiente real, se muestra
	// una cuota SINTÉTICA (id_cobro=-1, nunca existe en BD) — mismo criterio que cuentas-pagar/+page.svelte.
	// No se filtra por `forma_pago === 1`: esa comparación exacta fallaba en la práctica (ver el mismo
	// fix en cuentas-pagar/+page.svelte) y el criterio real es "no hay ninguna cuota que mostrar".
	const esContadoSinCobros = $derived(selectedCobros.length === 0 && Number(selectedCuenta?.saldo_pendiente ?? 0) > 0);
	const cobrosAMostrar = $derived.by((): Cobro[] => {
		const fechaSintetica = selectedCuenta?.fecha_vencimiento || selectedCuenta?.fecha_emision;
		if (esContadoSinCobros && fechaSintetica) {
			return [
				{
					id_cobro: -1,
					id_cuenta_cobrar: selectedCuenta!.id_cuenta_cobrar,
					monto: selectedCuenta!.saldo_pendiente,
					fecha_cobro: fechaSintetica,
					medio_cobro: null,
					num_operacion: null,
					cuenta_banco: null,
					usuario_registro: null,
					referencia: null,
					created_at: '',
					estado_cobro: 'programado',
					id_transaccion: null,
					transaccion: null
				}
			];
		}
		return selectedCobros;
	});

	/** La cuota 'programado' de fecha_cobro más temprana entre las que se están mostrando — la que se
	 * abre al hacer doble clic sobre cualquier fila (mismo criterio que cuentas-pagar/+page.svelte). */
	const cuotaMasProxima = $derived.by(() => {
		const programadas = cobrosAMostrar.filter((c) => c.estado_cobro === 'programado');
		if (programadas.length === 0) return null;
		return programadas.reduce((min, c) => (c.fecha_cobro < min.fecha_cobro ? c : min));
	});

	/** Una cuota (real o sintética) sin cobrar cuya fecha programada ya pasó se muestra como "Vencido"
	 * en vez de "Programado"/"Por registrar" — comparación por día calendario, no por hora. */
	function esCuotaVencida(cobro: Cobro): boolean {
		if (cobro.estado_cobro !== 'programado' || !cobro.fecha_cobro) return false;
		const hoy = new Date();
		hoy.setHours(0, 0, 0, 0);
		return new Date(cobro.fecha_cobro + 'T00:00:00') < hoy;
	}

	/** Doble clic en cualquier cuota -> siempre abre/registra la "más próxima" (no la que se clickeó),
	 * mismo criterio que cuentas-pagar/+page.svelte. Si es la sintética (Contado sin cobros aún) abre
	 * "Registrar Cobro" prellenado con su monto/fecha; si es una cuota real, abre la edición normal. */
	function handleDobleClicCuota() {
		if (!cuotaMasProxima) return;
		if (cuotaMasProxima.id_cobro === -1) {
			editingCobro = null;
			cobroInitialValues = { monto: String(cuotaMasProxima.monto), fecha_cobro: cuotaMasProxima.fecha_cobro };
			cobroModalOpen = true;
		} else {
			openEditCobro(cuotaMasProxima);
		}
	}

	/** El botón "Registrar Cobro" de la cabecera del panel de cuotas: si ya hay una cuota programada
	 * (real o sintética) pendiente, la reutiliza — mismo camino que hacer doble clic sobre ella — para
	 * pasarla a "Cobrado" en vez de insertar una fila nueva y dejar la programada intacta (eso
	 * duplicaba la cuota). Solo crea un cobro suelto de verdad cuando no hay ninguna cuota programada
	 * esperando. Mismo fix que handleRegistrarPagoClick en cuentas-pagar/+page.svelte. */
	function handleRegistrarCobroClick() {
		if (cuotaMasProxima) {
			handleDobleClicCuota();
		} else {
			openCreateCobro();
		}
	}

	// ── "Resumen de cobro" (ojito de cada fila) — a pedido del usuario, con imagen de referencia: datos de la
	// cuenta en solo lectura + cronograma de cuotas. Reusa la cuenta/cuotas seleccionadas (selectedCuenta/
	// cobrosAMostrar), así que se refresca solo cuando CobroModal guarda (ver handleCobroSaved). Tocar una
	// cuota pendiente abre "Editar Cuota Programada" (CobroModal) sobre el resumen. ──
	let resumenOpen = $state(false);
	/** Nombre del prestatario si la cuenta abierta en el resumen es un Préstamo Otorgado — ahí el resumen
	 * muestra "Prestatario" en vez de "Cliente". null = no es un préstamo. */
	let prestatarioResumen = $state<string | null>(null);

	// A pedido del usuario (espejo de Cuentas por Pagar): en la lista y en el título del panel de cuotas se
	// muestra el nombre real de la contraparte — el prestatario en un Préstamo Otorgado, en vez del cliente
	// genérico "PRÉSTAMOS / FINANCIERA" (ver getPrestatariosDeCuentasCobrar). Se resuelve por página.
	let prestatariosPorCuenta = $state<Map<number, string>>(new Map());
	/** Tramos del nombre del proyecto separados DESPUÉS de cada "_" (ej. "LNU3_", "0726_", "Miraflores_") —
	 * a pedido del usuario, un nombre largo se parte en varias líneas solo en los guiones bajos (vía <wbr>),
	 * nunca a mitad de una palabra. */
	function tramosNombre(texto: string): string[] {
		return texto.split(/(?<=_)/);
	}

	function nombreContraparte(item: CuentaCobrar): string {
		const prestatario = prestatariosPorCuenta.get(item.id_cuenta_cobrar);
		return prestatario || item.cliente?.nombre || 'Sin cliente';
	}
	function esPrestamoCuenta(item: CuentaCobrar): boolean {
		return prestatariosPorCuenta.has(item.id_cuenta_cobrar);
	}

	async function openResumen(item: CuentaCobrar) {
		selectedId = item.id_cuenta_cobrar;
		const [, prestatario] = await Promise.all([fetchSelectedCobros(), getPrestatarioDeCuentaCobrar(supabase, item).catch(() => null)]);
		prestatarioResumen = prestatario;
		resumenOpen = true;
	}

	function etiquetaCampo(key: string, value: unknown): string {
		if (value === null || value === undefined || value === '') return '';
		const field = FIELDS_CONFIG.find((f) => f.key === key);
		if (!field) return String(value);
		const label = getOptionLabel(field, value, dynamicOptions);
		// Un id sin etiqueta conocida (ej. un centro de costo fuera de la lista del formulario) no dice nada.
		return label === String(value) && key.startsWith('id_') ? '' : label;
	}

	const resumenCampos = $derived.by((): CampoResumen[] => {
		const c = selectedCuenta;
		if (!c) return [];
		const proximo = cobrosAMostrar
			.filter((q) => q.estado_cobro === 'programado')
			.sort((a, b) => (a.fecha_cobro < b.fecha_cobro ? -1 : 1))[0];
		return [
			prestatarioResumen !== null
				? { label: 'Prestatario', valor: prestatarioResumen }
				: { label: 'Cliente', valor: c.cliente?.nombre ?? '' },
			{ label: 'Centro de costo', valor: etiquetaCampo('id_centro_costo', c.id_centro_costo) },
			{ label: 'Proyecto', valor: c.proyecto?.nombre_proyecto ?? '' },
			{ label: 'N° documento', valor: c.num_documento ?? '' },
			{ label: 'Tipo de documento', valor: etiquetaCampo('tipo_documento', c.tipo_documento) },
			{ label: 'Valor de venta', valor: formatCurrency(c.monto) },
			{ label: 'Saldo pendiente', valor: formatCurrency(c.saldo_pendiente) },
			{ label: 'Próximo a cobrar', valor: proximo ? formatCurrency(proximo.monto) : '' },
			{ label: 'Forma de pago', valor: etiquetaCampo('forma_pago', c.forma_pago) },
			{ label: 'Responsable', valor: c.responsable ?? '' },
			{ label: 'Fecha de emisión', valor: formatDate(c.fecha_emision) },
			{ label: 'Fecha de vencimiento', valor: formatDate(c.fecha_vencimiento) },
			{ label: 'Moneda', valor: etiquetaCampo('moneda', c.moneda) },
			{ label: 'Prioridad', valor: etiquetaCampo('prioridad', c.prioridad) },
			{ label: 'Estado', valor: etiquetaCampo('estado', c.estado) },
			{ label: 'Observaciones', valor: c.observaciones ?? '', completo: true }
		];
	});

	// A pedido del usuario: solo se desbloquea la cuota pendiente más próxima (la de fecha más temprana —
	// cuotaMasProxima — que es la que toca pagar, incluida una ya vencida); las siguientes quedan con candado
	// hasta registrar esa. Igual en el resumen (ojito) y en la lista de cuotas del panel.
	const resumenCuotas = $derived(
		cobrosAMostrar.map((q): CuotaResumen => {
			const bloqueado = q.id_cobro !== -1 && !!q.transaccion?.aprobado && !isAdmin();
			const estado: CuotaResumen['estado'] =
				q.estado_cobro === 'cobrado' ? 'pagado' : q.estado_cobro === 'cancelado' ? 'anulado' : esCuotaVencida(q) ? 'vencido' : 'pendiente';
			return { id: q.id_cobro, monto: q.monto, fecha: q.fecha_cobro, concepto: q.referencia ?? null, estado, editable: q.estado_cobro === 'programado' && !bloqueado && q.id_cobro === cuotaMasProxima?.id_cobro };
		})
	);

	/** Estado de una cuota tocado en el resumen: la sintética (Contado sin cobros) abre "Registrar Cobro"
	 * prellenado, una real abre "Editar Cuota Programada" — mismo criterio que handleDobleClicCuota. */
	function editarCuotaDesdeResumen(idCobro: number) {
		const cobro = cobrosAMostrar.find((q) => q.id_cobro === idCobro);
		if (!cobro) return;
		if (idCobro === -1) {
			editingCobro = null;
			cobroInitialValues = { monto: String(cobro.monto), fecha_cobro: cobro.fecha_cobro };
			cobroModalOpen = true;
		} else {
			openEditCobro(cobro);
		}
	}

	// A pedido del usuario: "Eliminar" pasa a ser un dar-de-baja reversible (oculta la cuenta, no
	// toca cobros ni transacciones) — mismo patrón que el resto de los módulos. El borrado PERMANENTE
	// de verdad (deleteCuentaCobrar, que sí borra cobros y transacciones vinculadas) se mueve a la
	// sección "Eliminados" (solo-admin), siempre con contraseña.
	let confirmDarDeBajaOpen = $state(false);
	let cuentaParaDarDeBaja = $state<CuentaCobrar | null>(null);

	function handleDelete(item: CuentaCobrar) {
		cuentaParaDarDeBaja = item;
		confirmDarDeBajaOpen = true;
	}
	function closeConfirmDarDeBaja() {
		confirmDarDeBajaOpen = false;
		cuentaParaDarDeBaja = null;
	}
	async function confirmarDarDeBaja() {
		if (!cuentaParaDarDeBaja) return;
		try {
			const result = await darDeBajaCuentaCobrar(supabase, cuentaParaDarDeBaja.id_cuenta_cobrar);
			if (result.success) {
				toast.success(result.message ?? 'Cuenta por cobrar dada de baja correctamente.');
				if (selectedId === cuentaParaDarDeBaja.id_cuenta_cobrar) selectedId = null;
			} else {
				toast.error(result.message ?? 'No se pudo dar de baja la cuenta por cobrar.');
			}
		} catch (err: any) {
			toast.error(`No se pudo dar de baja la cuenta por cobrar. ${describeError(err)}`);
		} finally {
			closeConfirmDarDeBaja();
			await Promise.all([fetchList(), fetchMontoFiltrado(), fetchKpis()]);
		}
	}

	// ── Sección "Eliminados" (solo-admin): restaurar (sin contraseña) y borrado permanente (SIEMPRE
	// con contraseña de admin, sin excepción). ──

	let confirmRestaurarOpen = $state(false);
	let cuentaParaRestaurar = $state<CuentaCobrar | null>(null);

	function handleRestaurar(item: CuentaCobrar) {
		cuentaParaRestaurar = item;
		confirmRestaurarOpen = true;
	}
	function closeConfirmRestaurar() {
		confirmRestaurarOpen = false;
		cuentaParaRestaurar = null;
	}
	async function confirmarRestaurar() {
		if (!cuentaParaRestaurar) return;
		try {
			const result = await restaurarCuentaCobrar(supabase, cuentaParaRestaurar.id_cuenta_cobrar);
			if (result.success) {
				toast.success(result.message ?? 'Cuenta por cobrar restaurada correctamente.');
				await fetchList();
			} else {
				toast.error(result.message ?? 'No se pudo restaurar la cuenta por cobrar.');
			}
		} catch (err: any) {
			toast.error(`No se pudo restaurar la cuenta por cobrar. ${describeError(err)}`);
		} finally {
			closeConfirmRestaurar();
		}
	}

	let confirmEliminarPermanenteOpen = $state(false);
	let cuentaParaEliminarPermanente = $state<CuentaCobrar | null>(null);
	let eliminandoPermanente = $state(false);

	function handleEliminarPermanente(item: CuentaCobrar) {
		cuentaParaEliminarPermanente = item;
		confirmEliminarPermanenteOpen = true;
	}
	function closeConfirmEliminarPermanente() {
		if (eliminandoPermanente) return;
		confirmEliminarPermanenteOpen = false;
		cuentaParaEliminarPermanente = null;
	}

	/** Igual patrón que el borrado masivo de Transacciones: verifyAdminCredentials re-autentica de
	 * verdad contra Supabase Auth antes de ejecutar deleteCuentaCobrar (el mismo borrado real de
	 * siempre — cascada de cobros y transacciones vinculadas). */
	async function confirmarEliminarPermanente(email: string, password: string) {
		if (!cuentaParaEliminarPermanente) return;
		const verificacion = await verifyAdminCredentials(email, password);
		if (!verificacion.success) throw new Error(verificacion.message);

		eliminandoPermanente = true;
		try {
			const result = await deleteCuentaCobrar(supabase, cuentaParaEliminarPermanente.id_cuenta_cobrar, true);
			if (result.success) {
				toast.success(result.message ?? 'Cuenta por cobrar eliminada permanentemente.');
				if (selectedId === cuentaParaEliminarPermanente.id_cuenta_cobrar) selectedId = null;
				confirmEliminarPermanenteOpen = false;
				cuentaParaEliminarPermanente = null;
				await fetchList();
			} else {
				throw new Error(result.message || 'No se pudo eliminar la cuenta por cobrar.');
			}
		} finally {
			eliminandoPermanente = false;
		}
	}

	async function handleDeleteCobro(idCobro: number) {
		if (!(await confirmar({ title: 'Eliminar cobro', message: '¿Eliminar este cobro? El saldo de la cuenta se recalculará.', confirmLabel: 'Eliminar' }))) return;
		try {
			const result = await deleteCobro(supabase, idCobro, isAdmin());
			if (result.success) toast.success(result.message);
			else toast.error(result.message);
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		} finally {
			await Promise.all([fetchList(), fetchSelectedCobros(), fetchMontoFiltrado(), fetchKpis()]);
		}
	}

	function openCreateCobro() {
		editingCobro = null;
		cobroInitialValues = {};
		cobroModalOpen = true;
	}
	function openEditCobro(cobro: Cobro) {
		editingCobro = cobro;
		cobroModalOpen = true;
	}
	function closeCobroModal() {
		cobroModalOpen = false;
		editingCobro = null;
		cobroInitialValues = {};
	}

	// A pedido explícito del usuario: en el flujo "Préstamo Otorgado" (ver
	// abrirCreacionPrecargadaDesdeTransaccion), la transacción que origina esta Cuenta por Cobrar debe
	// grabarse PRIMERO, y la cuenta recién DESPUÉS — si la transacción no se puede grabar (ej. saldo
	// insuficiente en el centro de costo origen), la Cuenta por Cobrar TAMPOCO debe grabarse. Se pasa
	// como `onSubmitOverride` a CuentaCobrarModal (ver ahí), que lo usa en vez de createCuentaCobrar
	// directo — recibe los mismos `formValues` que el modal ya validó, así que arma el payload de la
	// transacción a partir de esos valores (no de la cuenta ya creada, que en este orden todavía no
	// existe) y devuelve un ServiceResult<CuentaCobrar> idéntico al que createCuentaCobrar devolvería,
	// para que el resto del modal (toast, onSaved, onClose) siga funcionando sin cambios.
	async function guardarCuentaCobrarConTransaccionPrestamo(formValues: Record<string, string>, fracciones: Fraccion[] = []): Promise<ServiceResult<CuentaCobrar>> {
		if (!prestamoPrefillDatos) {
			// Salvaguarda: este override solo debería pasarse mientras el flujo de préstamo está activo
			// (ver el prop condicional más abajo) — si por lo que sea se llama sin eso, cae al alta normal.
			const { data: userData } = await supabase.auth.getUser();
			return createCuentaCobrar(supabase, formValues, userData?.user?.email ?? null, fracciones);
		}
		const { data: userData } = await supabase.auth.getUser();
		// Datos reales del formulario de la transacción (fecha, moneda, medio de pago, cuenta bancaria, N° de
		// operación) — sin esto se grababa con la fecha de hoy, siempre en soles y sin cuenta bancaria, así que
		// el egreso no se reflejaba en el saldo de esa cuenta. Si falta (precarga vieja), se usa lo de la cuenta.
		const t = (prestamoPrefillDatos.transaccion ?? {}) as Record<string, unknown>;
		const payloadTransaccion = {
			tipo_alcance: 'externa',
			id_centro_costo_origen: formValues.id_centro_costo,
			id_centro_costo_destino: prestamoPrefillDatos.id_centro_costo_destino,
			fecha: t.fecha || formValues.fecha_emision,
			tipo: 'egreso',
			monto_total: t.monto_total || formValues.monto,
			tipo_cambio: t.tipo_cambio || null,
			monto_convertido: t.monto_convertido || null,
			medio_pago: t.medio_pago || null,
			cuente_origen: t.cuente_origen || null,
			cuente_destino: t.cuente_destino || null,
			num_operacion: t.num_operacion || null,
			// tipo_moneda es obligatorio en `transaccion` (ver transaccion.config.ts) — 'soles' porque
			// formValues.monto SIEMPRE es el equivalente en Soles, aun con la Cuenta por Cobrar en
			// Dólares (ahí se autocalcula desde monto_dolares × tipo_cambio, ver disabledValue de 'monto'
			// en cuentaCobrar.config.ts). Sin esto, crearTransaccionSistema fallaba con "Revisa los campos
			// marcados" y ni la transacción ni la Cuenta por Cobrar se guardaban.
			tipo_moneda: t.tipo_moneda || 'soles',
			categoria: 'Préstamo Otorgado',
			descripcion: t.descripcion || formValues.observaciones || 'Préstamo otorgado'
		};
		let resultTransaccion;
		try {
			resultTransaccion = await crearTransaccionSistema(supabase, payloadTransaccion, userData?.user?.email ?? null, permisosState.userName || null, crypto.randomUUID());
		} catch (err: any) {
			console.error('[CuentasCobrar] Excepción al crear la transacción del préstamo:', err);
			return { success: false, message: `No se pudo registrar la transacción del préstamo: ${err?.message ?? 'error inesperado'}. La Cuenta por Cobrar no se guardó.` };
		}
		if (!resultTransaccion.success) {
			console.error('[CuentasCobrar] crearTransaccionSistema devolvió un error:', resultTransaccion, payloadTransaccion);
			return { success: false, message: `No se pudo registrar la transacción del préstamo: ${resultTransaccion.message}. La Cuenta por Cobrar no se guardó.` };
		}

		// id_transaccion (ver cuentas_pagar_cobrar_id_transaccion_migration.sql) vincula esta cuenta con la
		// transacción recién creada — así, si el usuario más tarde EDITA esa transacción, TransaccionModal
		// puede encontrar esta misma Cuenta por Cobrar y abrirla para actualizarla también (ver
		// getCuentaCobrarPorTransaccion).
		const resultCuenta = await createCuentaCobrar(supabase, { ...formValues, id_transaccion: String(resultTransaccion.data!.id_transaccion) }, userData?.user?.email ?? null, fracciones);
		if (!resultCuenta.success) {
			// La transacción ya se creó pero la cuenta no — se revierte para no dejar un movimiento de
			// caja real sin la Cuenta por Cobrar que lo respalda (mismo criterio de "todo o nada" que
			// pidió el usuario, aplicado también en este sentido).
			try {
				await deleteTransaccion(supabase, resultTransaccion.data!.id_transaccion);
			} catch (err) {
				console.error('[CuentasCobrar] No se pudo revertir la transacción tras fallar la Cuenta por Cobrar:', err);
			}
			return { success: false, message: `La transacción se registró pero la Cuenta por Cobrar no se pudo guardar (la transacción se revirtió): ${resultCuenta.message}` };
		}
		return resultCuenta;
	}

	async function handleSaved() {
		prestamoPrefillDatos = null;
		await Promise.all([fetchList(), fetchMontoFiltrado(), fetchKpis()]);
	}

	async function handleCobroSaved() {
		await Promise.all([fetchList(), fetchSelectedCobros(), fetchMontoFiltrado(), fetchKpis()]);
	}

	function handleTransaccionSugerida(payload: Record<string, unknown>, idCobro: number) {
		transaccionPrefill = payload;
		confirmandoCobroId = idCobro;
		transaccionModalOpen = true;
	}
	function closeTransaccionModal() {
		transaccionModalOpen = false;
		transaccionPrefill = null;
		confirmandoCobroId = null;
	}

	// Se pasa como onConfirm al TransaccionModal cuando está confirmando un cobro (ver
	// confirmandoCobroId) — crea la transacción Y confirma el cobro como 'cobrado' en un solo paso
	// atómico (ver confirmarCobroCobrado en cuentasCobrar.service.ts). Si esto falla, el cobro se
	// queda como estaba (nunca "cobrado" sin transacción).
	async function confirmarTransaccionCobro(payload: Record<string, unknown>, idempotencyKey: string) {
		const { data: userData } = await supabase.auth.getUser();
		const result = await confirmarCobroCobrado(supabase, confirmandoCobroId as number, payload, userData?.user?.email ?? null, permisosState.userName || null, idempotencyKey);
		if (result.success) await Promise.all([fetchList(), fetchSelectedCobros(), fetchMontoFiltrado(), fetchKpis()]);
		return result;
	}

	// A pedido del usuario: la lista de clientes es la misma del Directorio de Clientes (solo activos) y se
	// actualiza sola al cambiar — ver $lib/stores/clientes.svelte.ts.
	onDestroy(suscribirClientes());
	$effect(() => {
		if (!clientesState.cargado) return;
		const opciones = opcionesClientes([editingCuenta?.id_cliente]);
		untrack(() => (dynamicOptions = { ...dynamicOptions, id_cliente: opciones }));
	});
</script>

<div class="w-full">
	{#if !verEliminados}
		<!-- Botones "Consultoria"/"Obra"/"Corporativo"/"Otros" — mismo diseño/lógica que ya usa Cuentas
		     por Pagar, filtran por el TIPO real del centro de costo de cada cuenta. -->
		<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
			<button
				type="button"
				onclick={() => toggleTipoFilter('consultoria')}
				class={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors ${tipoFilter === 'consultoria' ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
			>
				<div class="w-10 h-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
					<Briefcase size={18} />
				</div>
				<span class="font-semibold text-slate-700 text-sm">Consultoria</span>
				{#if tipoFilter === 'consultoria'}<span class="ml-auto shrink-0 text-slate-400" title="Quitar este filtro" aria-label="Quitar este filtro"><X size={14} /></span>{/if}
			</button>
			<button
				type="button"
				onclick={() => toggleTipoFilter('proyecto')}
				class={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors ${tipoFilter === 'proyecto' ? 'border-orange-300 bg-orange-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
			>
				<div class="w-10 h-10 rounded-lg bg-orange-100 text-orange-500 flex items-center justify-center shrink-0">
					<HardHat size={18} />
				</div>
				<span class="font-semibold text-slate-700 text-sm">Obra</span>
				{#if tipoFilter === 'proyecto'}<span class="ml-auto shrink-0 text-slate-400" title="Quitar este filtro" aria-label="Quitar este filtro"><X size={14} /></span>{/if}
			</button>
			<button
				type="button"
				onclick={() => toggleTipoFilter('otro')}
				class={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors ${tipoFilter === 'otro' ? 'border-slate-400 bg-slate-100' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
			>
				<div class="w-10 h-10 rounded-full bg-slate-600 text-white flex items-center justify-center shrink-0">
					<Ellipsis size={18} />
				</div>
				<span class="font-semibold text-slate-700 text-sm">Otros</span>
				{#if tipoFilter === 'otro'}<span class="ml-auto shrink-0 text-slate-400" title="Quitar este filtro" aria-label="Quitar este filtro"><X size={14} /></span>{/if}
			</button>
		</div>
	{/if}

	<div class="flex items-center justify-between mb-6">
		<div class="flex items-center gap-3">
			<Landmark class="text-[#0f3b5e]" size={28} />
			<div>
				<h1 class="text-xl font-bold text-[#0f3b5e]">{verEliminados ? 'Cuentas por cobrar eliminadas' : 'Cuentas por Cobrar'}</h1>
				<p class="text-sm text-slate-500">
					{verEliminados
						? 'Cuentas dadas de baja — restauralas o elimínalas de la base de datos permanentemente.'
						: 'Cuentas pendientes de clientes y sus cobros registrados'}
				</p>
			</div>
		</div>
		<div class="flex items-center gap-2">
			{#if isAdmin()}
				<button type="button" onclick={toggleVerEliminados} class={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${verEliminados ? 'bg-slate-800 text-white hover:bg-slate-900' : 'border border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
					{#if verEliminados}<ChevronLeft size={16} />{:else}<Trash2 size={16} />{/if}
					{verEliminados ? 'Volver' : 'Ver eliminados'}
				</button>
			{/if}
			{#if !verEliminados}
			<button type="button" onclick={() => goto('/finanzas/cuentas-cobrar/panoramas')} class="hidden md:flex items-center gap-2 px-4 py-2 rounded-lg border border-[#0f3b5e] text-[#0f3b5e] text-sm font-medium hover:bg-slate-50">
				<LayoutGrid size={16} /> Ver Panoramas de Cobro
			</button>
			<button type="button" onclick={openCreate} class="hidden md:flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-medium hover:bg-[#0c2f4c]">
				<Plus size={16} /> Nueva Cuenta
			</button>
			{/if}
		</div>
	</div>

	{#if loadError}
		<div class="mb-4 bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm">{loadError}</div>
	{/if}

	<!-- KPIs -->
	<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center shrink-0"><CreditCard size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Cobros pendientes totales</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(resumen.totalPendiente)}</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0"><Wallet size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Cobrado del mes</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(cobradoDelMes)}</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-red-100 text-red-600 flex items-center justify-center shrink-0"><AlertTriangle size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Cobros retrasados totales</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(resumen.vencidoTotal)}</p>
			<p class="text-[11px] text-slate-400 mt-1">{resumen.vencidoCount} documento{resumen.vencidoCount === 1 ? '' : 's'}</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0"><Filter size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Total de filtrado</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(montoFiltrado)}</p>
		</div>
	</div>

	<!-- A pedido del usuario: Filtros, búsqueda y orden en una sola línea (en pantallas angostas bajan solos). -->
	<div class="mb-4 flex flex-wrap items-center gap-2">
		<ColumnFilterBar flotante fields={filterFields} bind:filters={columnFilters} dynamicOptions={dynamicOptions} onChange={handleColumnFiltersChange} />
		<div class="relative w-full sm:w-72">
			<Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
			<input
				type="text"
				value={searchInput}
				oninput={(e) => onSearchInput((e.target as HTMLInputElement).value)}
				placeholder="Buscar por proyecto, cliente, N° documento..."
				class="w-full pl-9 pr-8 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
			/>
			{#if searchInput}
				<button type="button" onclick={() => onSearchInput('')} class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Limpiar búsqueda">
					<X size={14} />
				</button>
			{/if}
		</div>

		<div class="w-52">
		<SelectConSaldo
			value={sortBy}
			options={FIELDS_CONFIG.filter((f) => f.sortable && (f.showInTable || f.key === 'prioridad')).map((field) => ({ value: String(field.key), label: `Ordenar: ${field.label}` }))}
			onchange={(v) => (toggleSort(v, true))}
		/>
		</div>
		<button
			type="button"
			onclick={() => { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; pageNum = 1; fetchList(); }}
			class="p-2 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50"
			title={sortBy === 'prioridad' ? (sortDir === 'asc' ? 'Prioridad alta primero' : 'Prioridad baja primero') : sortDir === 'asc' ? 'Ascendente' : 'Descendente'}
			aria-label="Cambiar dirección de orden"
		>
			{#if sortDir === 'asc'}<ChevronUp size={16} />{:else}<ChevronDown size={16} />{/if}
		</button>
		{#if hayFiltrosActivos}
			<button type="button" onclick={limpiarTodo} class="flex items-center gap-1 px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-sm font-medium text-red-600 hover:bg-red-100" title="Quitar el tipo, la búsqueda, los filtros y el orden">
				<X size={14} /> Limpiar todo
			</button>
		{/if}
	</div>

	<div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
		<!-- Desktop: filas tipo tabla -->
		<div class="hidden md:block overflow-x-auto">
			<div class="min-w-[1240px]">
				<div class="grid grid-cols-[2.6fr_1.1fr_0.9fr_1fr_1.1fr_5.5rem_6.5rem_0.9fr_7rem] gap-3 items-center px-4 py-2 border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-600 uppercase tracking-wide">
					<span>Proyecto / Cliente / Prestatario</span>
					<span>N° Documento</span>
					<span>Vencimiento</span>
					<span class="text-right">Saldo pendiente</span>
					<span class="text-right">Valor Venta</span>
					<!-- Ticket #88: Prioridad y Estado compartían una sola columna (mitad cada uno) y en pantallas angostas
					     "Pendiente" se salía de su lugar y no calzaba con el título. Ahora son dos columnas de ancho fijo. -->
					<span>Prioridad</span>
					<span>Estado</span>
					<span class="text-right">Días de Retraso</span>
					<span class="text-right">Acciones</span>
				</div>

				{#each items as item (item.id_cuenta_cobrar)}
					{@const retraso = diasDeRetraso(item.estado, item.fecha_vencimiento)}
					<div
						class={`grid grid-cols-[2.6fr_1.1fr_0.9fr_1fr_1.1fr_5.5rem_6.5rem_0.9fr_7rem] gap-3 items-center px-4 py-4 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 cursor-pointer transition-colors ${
							selectedId === item.id_cuenta_cobrar ? 'bg-blue-50 hover:bg-blue-50' : (estadoCardClass[item.estado] ?? '')
						}`}
						onclick={() => selectRow(item)}
					>
						<div class="flex items-center gap-3 min-w-0">
							<div class={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${estadoIconClass[item.estado] ?? 'bg-slate-100 text-slate-500'}`}>
								<FileText size={18} />
							</div>
							<div class="min-w-0">
								<p class="text-[13px] font-semibold text-slate-800 leading-snug [overflow-wrap:break-word]" title={esPrestamoCuenta(item) ? nombreContraparte(item) : (item.proyecto?.nombre_proyecto ?? 'Sin proyecto')}>{#each tramosNombre(esPrestamoCuenta(item) ? nombreContraparte(item) : (item.proyecto?.nombre_proyecto ?? 'Sin proyecto')) as tramo}{tramo}<wbr />{/each}</p>
								<div class="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-500 flex-wrap">
									<span class="[overflow-wrap:break-word]">{esPrestamoCuenta(item) ? 'Prestatario' : nombreContraparte(item)}</span>
								</div>
							</div>
						</div>
						<div class="text-sm text-slate-600 truncate">{item.num_documento || '—'}</div>
						<div class="text-sm text-slate-600 whitespace-nowrap">{formatDate(item.fecha_vencimiento)}</div>
						<div class="text-right font-semibold text-slate-700 text-sm">{formatCurrency(item.saldo_pendiente)}</div>
						<div class="text-right leading-tight">
							<p class="font-bold text-slate-800 text-sm">{formatCurrency(item.monto)}</p>
							{#if item.moneda === 'USD'}
								<p class="text-[11px] text-slate-400">{formatUSD(item.monto_dolares)}</p>
							{/if}
						</div>
						<div class="min-w-0">
							{#if item.prioridad}
								<span class={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-[11px] font-medium ${prioridadBadgeClass[item.prioridad] ?? 'bg-slate-100 text-slate-600'}`}>
									{getOptionLabel(prioridadField, item.prioridad)}
								</span>
							{/if}
						</div>
						<div class="min-w-0">
							<span class={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-[11px] font-medium ${estadoBadgeClass[item.estado] ?? 'bg-slate-100 text-slate-600'}`}>
								{getOptionLabel(estadoField, item.estado)}
							</span>
						</div>
						<div class="text-right text-sm">
							{#if retraso !== null}
								<span class="font-bold text-red-600">{retraso}</span> <span class="text-slate-400 text-xs">día{retraso === 1 ? '' : 's'}</span>
							{:else}
								<span class="text-slate-300">—</span>
							{/if}
						</div>
						<div class="flex items-center gap-1 justify-end">
							{#if verEliminados}
								<button type="button" onclick={(e) => { e.stopPropagation(); handleRestaurar(item); }} class="p-1.5 rounded-lg text-slate-500 hover:bg-emerald-50 hover:text-emerald-600" title="Restaurar" aria-label="Restaurar">
									<RotateCcw size={16} />
								</button>
								<button type="button" onclick={(e) => { e.stopPropagation(); handleEliminarPermanente(item); }} class="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600" title="Eliminar permanentemente" aria-label="Eliminar permanentemente">
									<Trash size={16} />
								</button>
							{:else}
								<button type="button" onclick={(e) => { e.stopPropagation(); openResumen(item); }} class="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-[#0f3b5e]" title="Ver resumen" aria-label="Ver resumen">
									<Eye size={16} />
								</button>
								<button type="button" onclick={(e) => { e.stopPropagation(); openEdit(item); }} class="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600" title="Editar" aria-label="Editar">
									<Pencil size={16} />
								</button>
								<button type="button" onclick={(e) => { e.stopPropagation(); handleDelete(item); }} class="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600" title="Dar de baja" aria-label="Dar de baja">
									<Trash2 size={16} />
								</button>
							{/if}
						</div>
					</div>
				{:else}
					<p class="px-4 py-10 text-center text-slate-400">{loading ? 'Cargando...' : 'No se encontraron cuentas por cobrar.'}</p>
				{/each}
			</div>
		</div>

		<!-- Mobile: tarjetas apiladas -->
		<div class="md:hidden">
			{#each items as item (item.id_cuenta_cobrar)}
				{@const retraso = diasDeRetraso(item.estado, item.fecha_vencimiento)}
				<div
					role="button"
					tabindex="0"
					onclick={() => selectRow(item)}
					onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && selectRow(item)}
					class={`w-full text-left p-4 border-b border-slate-100 last:border-b-0 active:bg-slate-50 transition-colors cursor-pointer ${
						selectedId === item.id_cuenta_cobrar ? 'bg-blue-50' : (estadoCardClass[item.estado] ?? '')
					}`}
				>
					<div class="flex items-start justify-between gap-3 mb-2">
						<div class="flex items-center gap-3 min-w-0">
							<div class={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${estadoIconClass[item.estado] ?? 'bg-slate-100 text-slate-500'}`}>
								<FileText size={18} />
							</div>
							<div class="min-w-0">
								<p class="text-[13px] font-semibold text-slate-800 leading-snug [overflow-wrap:break-word]" title={esPrestamoCuenta(item) ? nombreContraparte(item) : (item.proyecto?.nombre_proyecto ?? 'Sin proyecto')}>{#each tramosNombre(esPrestamoCuenta(item) ? nombreContraparte(item) : (item.proyecto?.nombre_proyecto ?? 'Sin proyecto')) as tramo}{tramo}<wbr />{/each}</p>
								<p class="text-[11px] text-slate-500 truncate mt-0.5">{esPrestamoCuenta(item) ? 'Prestatario' : nombreContraparte(item)} · {item.num_documento || '—'}</p>
							</div>
						</div>
						<div class="text-right shrink-0">
							<div class="font-bold text-slate-800 text-sm">{formatCurrency(item.monto)}</div>
							{#if item.moneda === 'USD'}
								<div class="text-[11px] text-slate-400">{formatUSD(item.monto_dolares)}</div>
							{/if}
						</div>
					</div>
					<div class="flex items-center justify-between gap-2 mb-2">
						<div class="flex items-center gap-1.5 flex-wrap">
							{#if item.prioridad}
								<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${prioridadBadgeClass[item.prioridad] ?? 'bg-slate-100 text-slate-600'}`}>
									{getOptionLabel(prioridadField, item.prioridad)}
								</span>
							{/if}
							<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${estadoBadgeClass[item.estado] ?? 'bg-slate-100 text-slate-600'}`}>
								{getOptionLabel(estadoField, item.estado)}
							</span>
						</div>
						<span class="text-xs font-semibold text-slate-600">Saldo: {formatCurrency(item.saldo_pendiente)}</span>
					</div>
					<div class="flex items-center justify-between text-xs text-slate-500 mb-3">
						<span>Vencimiento: {formatDate(item.fecha_vencimiento)}</span>
						{#if retraso !== null}
							<span class="font-bold text-red-600">Vencido hace {retraso} día{retraso === 1 ? '' : 's'}</span>
						{/if}
					</div>
					<div class="flex items-center gap-2 pt-2 border-t border-slate-100">
						{#if verEliminados}
							<button type="button" onclick={(e) => { e.stopPropagation(); handleRestaurar(item); }} class="flex-1 h-10 rounded-lg border border-slate-200 text-emerald-600 flex items-center justify-center gap-2 text-xs font-medium active:bg-emerald-50" aria-label="Restaurar">
								<RotateCcw size={14} /> Restaurar
							</button>
							<button type="button" onclick={(e) => { e.stopPropagation(); handleEliminarPermanente(item); }} class="flex-1 h-10 rounded-lg border border-slate-200 text-rose-600 flex items-center justify-center gap-2 text-xs font-medium active:bg-rose-50" aria-label="Eliminar permanentemente">
								<Trash size={14} /> Eliminar
							</button>
						{:else}
							<button type="button" onclick={(e) => { e.stopPropagation(); openResumen(item); }} class="flex-1 h-10 rounded-lg border border-slate-200 text-slate-600 flex items-center justify-center gap-2 text-xs font-medium active:bg-slate-50" aria-label="Ver resumen">
								<Eye size={14} /> Resumen
							</button>
							<button type="button" onclick={(e) => { e.stopPropagation(); openEdit(item); }} class="flex-1 h-10 rounded-lg border border-slate-200 text-slate-600 flex items-center justify-center gap-2 text-xs font-medium active:bg-slate-50" aria-label="Editar">
								<Pencil size={14} /> Editar
							</button>
							<button type="button" onclick={(e) => { e.stopPropagation(); handleDelete(item); }} class="flex-1 h-10 rounded-lg border border-slate-200 text-rose-600 flex items-center justify-center gap-2 text-xs font-medium active:bg-rose-50" aria-label="Dar de baja">
								<Trash2 size={14} /> Dar de baja
							</button>
						{/if}
					</div>
				</div>
			{:else}
				<p class="px-4 py-10 text-center text-slate-400">{loading ? 'Cargando...' : 'No se encontraron cuentas por cobrar.'}</p>
			{/each}
		</div>

		<div class="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-sm text-slate-500">
			<span>{total} resultado{total === 1 ? '' : 's'} · Página {pageNum} de {totalPages}</span>
			<div class="flex items-center gap-2">
				<button type="button" onclick={() => goToPage(pageNum - 1)} disabled={pageNum <= 1} class="px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50">Anterior</button>
				<button type="button" onclick={() => goToPage(pageNum + 1)} disabled={pageNum >= totalPages} class="px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50">Siguiente</button>
			</div>
		</div>
	</div>

	<!-- A pedido del usuario: el panel "Cobros de <cliente/proveedor>" que aparecía debajo de la lista ya no
	     se muestra — las cuotas se ven y se registran desde el Resumen (ojito de cada fila, ver resumenCuotas). -->
</div>

<CuentaCobrarModal
	open={modalOpen}
	mode={modalMode}
	cuenta={editingCuenta}
	dynamicOptions={dynamicOptions}
	centroCostoMontoMap={centroCostoMontoMap}
	centroCostoProyectoMap={centroCostoProyectoMap}
	centroCostoClienteMap={centroCostoClienteMap}
	clienteBloqueado={clienteBloqueado}
	centroCostoOpcionesPrestamo={centroCostoOpcionesPrestamo}
	prestamoDestinoNombre={prestamoDestinoNombre}
	{prestatarioNombre}
	camposBloqueados={camposBloqueadosPrestamo}
	onSubmitOverride={prestamoPrefillDatos ? guardarCuentaCobrarConTransaccionPrestamo : null}
	onClose={closeModal}
	onSaved={handleSaved}
/>
<ResumenCuentaModal
	open={resumenOpen && !!selectedCuenta}
	titulo="Resumen de cobro"
	tituloCronograma="Cronograma de cobranza"
	etiquetaTotal="Valor venta"
	textoPagado="Cobrado"
	campos={resumenCampos}
	cuotas={resumenCuotas}
	etiquetaPlan="Plan de pagos"
	mostrarHito
	montoTotal={Number(selectedCuenta?.monto ?? 0)}
	onClose={() => (resumenOpen = false)}
	onEditarCuota={editarCuotaDesdeResumen}
/>
<CobroModal
	open={cobroModalOpen}
	idCuentaCobrar={selectedId}
	cobro={editingCobro}
	initialValues={cobroInitialValues}
	onClose={closeCobroModal}
	onSaved={handleCobroSaved}
	onTransaccionSugerida={handleTransaccionSugerida}
/>
<TransaccionModal
	open={transaccionModalOpen}
	mode="create"
	transaccion={transaccionPrefill as any}
	dynamicOptions={transaccionDynamicOptions}
	onClose={closeTransaccionModal}
	onSaved={closeTransaccionModal}
	onConfirm={confirmandoCobroId ? confirmarTransaccionCobro : null}
	confirmTitle={confirmandoCobroId ? 'Confirmar Cobro — Transacción de Respaldo' : null}
	confirmButtonLabel={confirmandoCobroId ? 'Confirmar Cobro' : null}
	lockedFields={confirmandoCobroId ? ['id_centro_costo_origen', 'id_centro_costo_destino'] : []}
/>

<ConfirmModal
	open={confirmDarDeBajaOpen}
	title="Dar de baja cuenta por cobrar"
	message={cuentaParaDarDeBaja ? `¿Dar de baja esta cuenta por cobrar? Quedará marcada como inactiva. Sus cobros y transacciones ya registrados no se tocan.` : ''}
	confirmLabel="Dar de baja"
	onConfirm={confirmarDarDeBaja}
	onClose={closeConfirmDarDeBaja}
/>

<ConfirmModal
	open={confirmRestaurarOpen}
	title="Restaurar cuenta por cobrar"
	danger={false}
	message={cuentaParaRestaurar ? `¿Restaurar esta cuenta por cobrar? Volverá a aparecer en el listado.` : ''}
	confirmLabel="Restaurar"
	onConfirm={confirmarRestaurar}
	onClose={closeConfirmRestaurar}
/>

<AdminConfirmModal
	open={confirmEliminarPermanenteOpen}
	title="Eliminar cuenta por cobrar permanentemente"
	message={cuentaParaEliminarPermanente ? `Vas a eliminar PERMANENTEMENTE esta cuenta por cobrar y todos sus cobros registrados. Si alguno tiene una transacción vinculada, también se eliminará. Esta acción no se puede deshacer. Ingresa el correo y la contraseña de un administrador para continuar.` : ''}
	confirmLabel="Eliminar permanentemente"
	onConfirm={confirmarEliminarPermanente}
	onClose={closeConfirmEliminarPermanente}
/>
