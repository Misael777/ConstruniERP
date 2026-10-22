<script lang="ts">
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { setMobileFabActions } from '$lib/stores/mobileFab.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin, permisosState, puedeVerEliminados, hasPermiso } from '$lib/stores/permisos.svelte';
	import { Plus, Pencil, Trash2, Trash, RotateCcw, Search, ChevronUp, ChevronDown, ChevronLeft, X, Wallet, Receipt, FileText, LayoutGrid, Lock, ShieldCheck, CreditCard, AlertTriangle, Filter, Briefcase, HardHat, Ellipsis, Eye } from '@lucide/svelte';
	import ResumenCuentaModal, { type CampoResumen, type CuotaResumen } from '$lib/shared/components/ResumenCuentaModal.svelte';
	import { toast } from '$lib/stores/toast';
	import { confirmar } from '$lib/stores/confirmDialog.svelte';
	import { describeError } from '$lib/shared/describeError';
	import { verifyAdminCredentials } from '$lib/shared/adminAuth';
	import { getOptionLabel, formatCurrency, emptyColumnFilters, hasActiveColumnFilters, diasDeRetraso, type FieldOption, type ColumnFilters } from '$lib/shared/fieldConfig';
	import { FIELDS_CONFIG, DEFAULT_SORT_FIELD, DEFAULT_SORT_DIR, DEFAULT_PAGE_SIZE } from '$lib/modules/cuentas-pagar/config/cuentaPagar.config';
	import {
		getCuentasPagar,
		createCuentaPagar,
		deleteCuentaPagar,
		darDeBajaCuentaPagar,
		restaurarCuentaPagar,
		getPagos,
		deletePago,
		getProveedorOptions,
		confirmarPagoPagado,
		getMontoFiltrado,
		getPrestamistaDeCuentaPagar,
		getPrestamistasDeCuentasPagar
	} from '$lib/modules/cuentas-pagar/services/cuentasPagar.service';
	import type { ServiceResult } from '$lib/modules/cuentas-pagar/services/cuentasPagar.service';
	import {
		getCentroCostoOptions,
		getCentroCostoOptionsSoloCentros,
		getCentroCostoOptionsExternos,
		getCentroCostoOptionsExternosOrigen,
		getCentroCostoTipoMap,
		getEmpleadoOptions,
		crearTransaccionSistema,
		deleteTransaccion
	} from '$lib/modules/transacciones/services/transacciones.service';
	import { getCuentaBancoOptions } from '$lib/modules/cuentas-bancarias/services/cuentaBanco.service';
	import { getOrCrearProveedorPrestamos } from '$lib/modules/proveedores/services/proveedores.service';
	import type { Fraccion } from '$lib/shared/components/FraccionamientoModal.svelte';
	import { getResumenPagos, getPagadoEnRango, type ResumenPagos } from '$lib/modules/panoramas/services/panoramas.service';
	import { generarCodigoProyecto } from '$lib/shared/codigoProyecto';
	import CuentaPagarModal from '$lib/modules/cuentas-pagar/components/CuentaPagarModal.svelte';
	import PagoModal from '$lib/modules/cuentas-pagar/components/PagoModal.svelte';
	import TransaccionModal from '$lib/modules/transacciones/components/TransaccionModal.svelte';
	import ColumnFilterBar from '$lib/shared/components/ColumnFilterBar.svelte';
	import ResponsiveDataView from '$lib/shared/components/ResponsiveDataView.svelte';
	import ConfirmModal from '$lib/shared/components/ConfirmModal.svelte';
	import AdminConfirmModal from '$lib/shared/components/AdminConfirmModal.svelte';
	import type { CuentaPagar, Pago } from '$lib/modules/cuentas-pagar/services/cuentasPagar.service';

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

	// A pedido del usuario: mismo formato que Cuentas por Cobrar — Prioridad ya existía como columna en
	// la BD (cuentas_pagar_prioridad_migration.sql) y en el formulario, solo faltaba pintarla en esta
	// tabla. OJO: los valores acá son 'alto'/'media'/'bajo' (con "media", no "medio" como en Cobrar).
	const prioridadField = FIELDS_CONFIG.find((f) => f.key === 'prioridad')!;
	const prioridadBadgeClass: Record<string, string> = {
		alto: 'bg-red-100 text-red-700',
		media: 'bg-amber-100 text-amber-700',
		bajo: 'bg-green-100 text-green-700'
	};

	/** Columna "Centro de Costo" — mismo criterio que resolveEntidadVinculada en centroCostos.service.ts:
	 * si está vinculado a un proyecto, `centro_costo.nombre` guarda el id_proyecto crudo (ilegible), así
	 * que se recalcula el código real vía generarCodigoProyecto en vez de mostrarlo tal cual. */
	function centroCostoLabel(item: CuentaPagar): string {
		const cc = item.centro_costo;
		if (!cc) return 'Sin centro de costo';
		return cc.proyecto ? generarCodigoProyecto(cc.proyecto) : cc.nombre;
	}

	let items = $state<CuentaPagar[]>([]);
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

	// Paneles resumen (KPIs). Los tres primeros son totales GLOBALES (toda la cartera, no dependen de
	// lo que esté filtrado en la tabla) — mismos agregados que ya usa el tablero de Panoramas de Pago
	// (getResumenPagos/getPagadoEnRango), reutilizados tal cual para no duplicar esa lógica. El cuarto
	// ("Total de Filtrado") sí depende del buscador + filtros de columna: se recalcula cada vez que
	// cambian (ver fetchMontoFiltrado), sumando el mismo campo que ya se ve en la tabla.
	let resumen = $state<ResumenPagos>({ totalPendiente: 0, vencidoTotal: 0, vencidoCount: 0, proveedoresConCompras: 0 });
	let pagadoDelMes = $state(0);
	let montoFiltrado = $state(0);
	let columnFilters = $state<ColumnFilters>(emptyColumnFilters(FIELDS_CONFIG));

	let dynamicOptions = $state<Record<string, FieldOption[]>>({ id_proveedor: [], id_centro_costo: [], responsable: [] });
	let transaccionDynamicOptions = $state<Record<string, FieldOption[]>>({ id_centro_costo_origen: [], id_centro_costo_destino: [] });
	/** id_centro_costo (texto) -> tipo — para bloquear "ID Partida" en el modal cuando el centro de
	 * costo elegido es 'bolsa general', ver CuentaPagarModal.svelte. */
	let centroCostoTipoMap = $state<Record<string, string>>({});

	let selectedId = $state<number | null>(null);
	let selectedPagos = $state<Pago[]>([]);

	let modalOpen = $state(false);
	let modalMode = $state<'create' | 'edit'>('create');
	let editingCuenta = $state<CuentaPagar | null>(null);
	/** true solo cuando el modal se abre precargado desde la transacción Ingreso "Préstamo" (ver
	 * abrirCreacionPrecargadaDesdeTransaccion) — bloquea "Proveedor" en CuentaPagarModal para que se
	 * quede fijo en el proveedor genérico "PRÉSTAMOS / FINANCIERA", ver getOrCrearProveedorPrestamos. */
	let proveedorBloqueado = $state(false);
	/** Datos crudos leídos del sessionStorage de la precarga (ver abrirCreacionPrecargadaDesdeTransaccion)
	 * — se conservan hasta que la cuenta se guarda para poder grabar recién ahí la transacción real del
	 * préstamo (ver crearTransaccionPorPrestamoRecibido/handleSaved), que necesita id_centro_costo_origen
	 * (el prestamista real, no viaja en `editingCuenta` porque cuentas_pagar no tiene esa columna). null =
	 * este alta/edición NO viene de ese flujo. */
	let prestamoPrefillDatos = $state<Record<string, unknown> | null>(null);
	/** Flujo "Préstamo Recibido" (crear o editar desde una transacción Ingreso con Categoría Préstamo): nombre
	 * del prestamista que CuentaPagarModal muestra en "Proveedor" (rotulado "Prestamista"), y los campos que
	 * vienen de la transacción y quedan bloqueados. null / [] fuera de ese flujo. */
	let prestamistaNombre = $state<string | null>(null);
	let camposBloqueadosPrestamo = $state<string[]>([]);
	const CAMPOS_BLOQUEADOS_PRESTAMO = ['id_proveedor', 'id_centro_costo', 'moneda', 'monto_dolares', 'tipo_cambio', 'monto_comprometido'];
	function limpiarPrestamo() {
		prestamistaNombre = null;
		camposBloqueadosPrestamo = [];
	}
	let pagoModalOpen = $state(false);
	let editingPago = $state<Pago | null>(null);
	/** Prellenar Monto/Fecha de Pago al abrir "Registrar Pago" desde la cuota sintética de una cuenta
	 * al Contado (ver cuotasAMostrar) — ver PagoModal.svelte. */
	let pagoInitialValues = $state<Record<string, string>>({});
	let transaccionModalOpen = $state(false);
	let transaccionPrefill = $state<Record<string, unknown> | null>(null);
	/** Pago que se está confirmando como 'pagado' vía el TransaccionModal — ver
	 * handleTransaccionSugerida/confirmarTransaccionPago. null = TransaccionModal está en su modo
	 * normal (crear una transacción suelta), no en el flujo de confirmación obligatoria. */
	let confirmandoPagoId = $state<number | null>(null);

	// A pedido del usuario: las cuentas por pagar dadas de baja dejan de listarse por defecto — solo
	// un admin puede activar "Ver eliminados" (mismo patrón que el resto de los módulos, ver skill
	// dar-de-baja-pattern).
	let verEliminados = $state(false);
	function toggleVerEliminados() {
		verEliminados = !verEliminados;
		fetchList();
	}

	// Botones "Consultoria"/"Obra"/"Corporativo"/"Otros" (a pedido del usuario, mismo diseño que ya
	// existe en Cuentas por Cobrar) — filtran por el TIPO real del centro de costo de cada cuenta
	// (independiente de qué centros ofrezca el formulario para elegir, ver getCentroCostoOptionsSoloCentros
	// más abajo); "Otros" es el tipo LITERAL 'otro' (ver el tab "Centros de Costos", esa es la etiqueta
	// real de OTRO-002/006/007/008, etc.), MÁS las cuentas sin centro de costo asignado — bug real
	// reportado con captura: antes era un catch-all "cualquier tipo que no sea uno de los 3 conocidos",
	// que de paso arrastraba Préstamo y Cuentas Internas (cliente/proveedor/empleado/subcontratista),
	// que NUNCA deberían aparecer bajo ninguno de estos 4 botones — son una categoría aparte.
	// A pedido del usuario se quitó el botón "Corporativo" de este filtro (quedan Consultoría, Obra y Otros).
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

	async function fetchList() {
		loading = true;
		try {
			const filtroTipo = tipoFilter ? idsParaTipoFiltro(tipoFilter) : null;
			const result = await getCuentasPagar(supabase, {
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
			prestamistasPorCuenta = await getPrestamistasDeCuentasPagar(supabase, result.items).catch((err) => {
				console.warn('[CuentasPagar] No se pudo resolver el nombre de los prestamistas:', err);
				return new Map<number, string>();
			});
			total = result.total;
			totalPages = result.totalPages;
			loadError = '';
		} catch (err: any) {
			loadError = err.message || 'No se pudo cargar el listado de cuentas por pagar';
		} finally {
			loading = false;
		}
	}

	async function fetchMontoFiltrado() {
		try {
			const filtroTipo = tipoFilter ? idsParaTipoFiltro(tipoFilter) : null;
			montoFiltrado = await getMontoFiltrado(supabase, search, columnFilters, filtroTipo?.ids, filtroTipo?.incluirSinCentroCosto);
		} catch (err: any) {
			console.error('[CuentasPagar] No se pudo calcular el total filtrado:', err);
		}
	}

	async function fetchKpis() {
		try {
			const hoy = new Date();
			const desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
			const hasta = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().slice(0, 10);
			const [resumenData, pagadoMes] = await Promise.all([getResumenPagos(supabase), getPagadoEnRango(supabase, desde, hasta)]);
			resumen = resumenData;
			pagadoDelMes = pagadoMes;
		} catch (err: any) {
			console.error('[CuentasPagar] No se pudo calcular el resumen KPI:', err);
		}
	}

	function handleColumnFiltersChange() {
		pageNum = 1;
		fetchList();
		fetchMontoFiltrado();
	}

	async function fetchSelectedPagos() {
		if (!selectedId) {
			selectedPagos = [];
			return;
		}
		try {
			selectedPagos = await getPagos(supabase, selectedId);
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar los pagos');
		}
	}

	// Botón flotante de "+" en móvil (ver mobileFabState/MobileFab.svelte en el layout raíz).
	// Botón flotante de "+" en móvil (ver mobileFabState/MobileFab.svelte en el layout raíz) — reemplaza
	// a los dos botones "Nueva Cuenta"/"Ver Panoramas de Pago" del header, que en pantallas angostas se
	// ocultan (ver hidden md:flex): el segundo desbordaba la pantalla al no caber en la fila.
	onDestroy(
		setMobileFabActions([
			{ label: 'Nueva Cuenta por Pagar', icon: Plus, onclick: openCreate },
			{ label: 'Ver Panoramas de Pago', icon: LayoutGrid, onclick: () => goto('/finanzas/cuentas-pagar/panoramas') }
		])
	);

	onMount(async () => {
		// Ticket #100: respeta el permiso del rol (Roles y Permisos), igual que el menú y el guard de rutas — no solo Administrador.
		if (!hasPermiso('ver_finanzas_cuentas_pendientes')) {
			goto('/dashboard');
			return;
		}
		try {
			const [centroCostoOptions, centroCostoOptionsSoloCentros, centroCostoOptionsExternos, centroCostoOptionsExternosOrigen, cuentaBancoOptions, tipoMap] = await Promise.all([
				getCentroCostoOptions(supabase),
				getCentroCostoOptionsSoloCentros(supabase),
				getCentroCostoOptionsExternos(supabase),
				getCentroCostoOptionsExternosOrigen(supabase),
				getCuentaBancoOptions(supabase),
				getCentroCostoTipoMap(supabase)
			]);
			dynamicOptions = {
				id_proveedor: await getProveedorOptions(supabase),
				// A pedido explícito del usuario: el campo "Centro de Costo" de Cuentas por Pagar ofrece
				// exactamente el mismo conjunto que la pestaña "Centro de Costos" del submódulo homónimo
				// (ver getCentroCostoOptionsSoloCentros) — ya NO getCentroCostoOptionsPagos (removida).
				id_centro_costo: centroCostoOptionsSoloCentros,
				responsable: await getEmpleadoOptions(supabase)
			};
			// El pago de una cuenta por pagar siempre confirma como Transacción Externa (ver
			// alcanceForzadoExterna en TransaccionModal.svelte) — hacen falta también las variantes
			// "_externo" (mismas que usa la página de Transacciones) y las cuentas bancarias, o el
			// selector de Origen/Destino de Transacción y de Cuenta Origen queda sin opciones.
			transaccionDynamicOptions = {
				id_centro_costo_origen: centroCostoOptions,
				id_centro_costo_destino: centroCostoOptions,
				id_centro_costo_origen_externo: centroCostoOptionsExternosOrigen,
				id_centro_costo_destino_externo: centroCostoOptionsExternos,
				cuenta_banco: cuentaBancoOptions
			};
			centroCostoTipoMap = tipoMap;
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar proveedores/centros de costo');
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
		proveedorBloqueado = false;
		prestamoPrefillDatos = null;
		limpiarPrestamo();
		modalOpen = true;
	}
	// A pedido explícito del usuario: si se llega acá recién después de crear una transacción Ingreso de
	// tipo "Préstamo" con Proyecto=Corporativo (ver TransaccionModal.svelte), se abre de una vez "Nueva
	// Cuenta por Pagar" con los datos ya conocidos precargados (Centro de Costo/Monto/Fecha de Emisión) Y
	// con "Proveedor" ya fijado en el genérico "PRÉSTAMOS / FINANCIERA" (ver getOrCrearProveedorPrestamos)
	// — bloqueado, no editable (proveedorBloqueado), porque un préstamo no tiene un proveedor real
	// vinculado en el sistema. No hay forma de pasar props directo entre páginas (es una navegación real,
	// no un modal anidado) — TransaccionModal.svelte deja los datos base en sessionStorage bajo esta
	// misma clave justo antes de navegar acá; el id del proveedor genérico se resuelve/crea recién acá
	// (async). CuentaPagarModal arma sus valores iniciales leyendo `cuenta` sin importar el modo (ver
	// buildInitialValues ahí), así que pasar un objeto parcial en modo 'create' sí lo precarga — de ahí
	// el `as any` (el prop está tipado CuentaPagar | null). sessionStorage y el query param se limpian
	// apenas se consumen, para no reabrirlo si el usuario solo refresca esta misma página después.
	async function abrirCreacionPrecargadaDesdeTransaccion() {
		if (page.url.searchParams.get('prefillCuentaPagar') !== '1') return;
		const crudo = sessionStorage.getItem('cuentaPagarPrefill');
		sessionStorage.removeItem('cuentaPagarPrefill');
		window.history.replaceState({}, '', '/finanzas/cuentas-pagar');
		if (!crudo) return;
		try {
			const datos = JSON.parse(crudo);
			datos.id_proveedor = String(await getOrCrearProveedorPrestamos(supabase));
			modalMode = 'create';
			editingCuenta = datos as any;
			prestamoPrefillDatos = datos;
			proveedorBloqueado = true;
			prestamistaNombre = datos.prestamista_nombre || null;
			camposBloqueadosPrestamo = CAMPOS_BLOQUEADOS_PRESTAMO;
			modalOpen = true;
		} catch (err) {
			console.error('[CuentasPagar] No se pudo leer la precarga de la transacción:', err);
			toast.error('No se pudo precargar el proveedor de préstamos — completa "Proveedor" a mano.');
		}
	}
	function openEdit(item: CuentaPagar) {
		modalMode = 'edit';
		editingCuenta = item;
		proveedorBloqueado = false;
		prestamoPrefillDatos = null;
		limpiarPrestamo();
		modalOpen = true;
	}

	// A pedido explícito del usuario: al EDITAR (no crear) una transacción de Ingreso con
	// Categoría="Préstamo" y darle "Actualizar" (ver TransaccionModal.svelte), esta Cuenta por Pagar YA
	// EXISTE (se creó junto con esa transacción, ver id_transaccion en cuentasPagar.service.ts) — no se
	// crea una nueva, se abre esta misma en modo Editar con Monto Comprometido/Fecha Emisión/Observación
	// ya actualizados a lo que el usuario acaba de cambiar en la transacción, para que los confirme con
	// un segundo "Actualizar" acá. Mismo mecanismo cross-page (sessionStorage + query param + limpieza
	// inmediata) que abrirCreacionPrecargadaDesdeTransaccion, clave distinta para no pisarse entre sí.
	async function abrirEdicionPrecargadaDesdeTransaccion() {
		if (page.url.searchParams.get('editarCuentaPagarDesdeTransaccion') !== '1') return;
		const crudo = sessionStorage.getItem('cuentaPagarEditarPrefill');
		sessionStorage.removeItem('cuentaPagarEditarPrefill');
		window.history.replaceState({}, '', '/finanzas/cuentas-pagar');
		if (!crudo) return;
		try {
			const datos = JSON.parse(crudo);
			const { data: cuenta, error } = await supabase.from('cuentas_pagar').select('*, proveedor(razon_social)').eq('id_cuenta_pagar', datos.id_cuenta_pagar).single();
			if (error || !cuenta) {
				console.error('[CuentasPagar] No se encontró la Cuenta por Pagar vinculada a la transacción:', error);
				toast.error('No se encontró la Cuenta por Pagar vinculada a esa transacción.');
				return;
			}
			modalMode = 'edit';
			// Los datos que vienen de la transacción (centro de costo, moneda y monto) se aplican y quedan
			// bloqueados, igual que al crear (ver datosPrestamoDesdeTransaccion en TransaccionModal.svelte).
			editingCuenta = {
				...(cuenta as CuentaPagar),
				id_centro_costo: datos.id_centro_costo ?? cuenta.id_centro_costo,
				moneda: datos.moneda ?? cuenta.moneda,
				monto_dolares: datos.monto_dolares ?? cuenta.monto_dolares,
				tipo_cambio: datos.tipo_cambio ?? cuenta.tipo_cambio,
				monto_comprometido: datos.monto_comprometido,
				fecha_emision: datos.fecha_emision,
				observacion: datos.observacion ?? cuenta.observacion
			};
			proveedorBloqueado = true;
			prestamoPrefillDatos = null;
			prestamistaNombre = datos.prestamista_nombre || null;
			camposBloqueadosPrestamo = CAMPOS_BLOQUEADOS_PRESTAMO;
			modalOpen = true;
			toast.info('Revisa y confirma "Actualizar" para reflejar acá los cambios de la transacción.');
		} catch (err) {
			console.error('[CuentasPagar] No se pudo leer la precarga de edición de la transacción:', err);
			toast.error('No se pudo precargar la Cuenta por Pagar — actualízala a mano.');
		}
	}
	function closeModal() {
		modalOpen = false;
		editingCuenta = null;
		proveedorBloqueado = false;
		prestamoPrefillDatos = null;
		limpiarPrestamo();
	}

	async function selectRow(item: CuentaPagar) {
		selectedId = selectedId === item.id_cuenta_pagar ? null : item.id_cuenta_pagar;
		await fetchSelectedPagos();
	}

	const selectedCuenta = $derived(items.find((i) => i.id_cuenta_pagar === selectedId) ?? null);

	// Contado es "una sola cuota" por definición — no genera filas reales en `pagos` (a diferencia de
	// Crédito, que las autogenera vía "Fraccionar este pago"). Mientras no exista NINGÚN pago real
	// todavía (ni siquiera uno programado — puede ser Contado, o Crédito sin fraccionar aún) y haya
	// saldo pendiente real, se muestra una cuota SINTÉTICA (id_pago=-1, nunca existe en BD) usando el
	// saldo pendiente y una fecha — así el usuario ve "su cuota" en vez de un simple "sin pagos", y
	// puede hacer doble clic para registrarla. No se filtra por `fotma_pago === 1`: esa comparación
	// exacta fallaba en la práctica (cuentas Contado reales que igual mostraban "Sin pagos registrados
	// todavía" pese a tener saldo pendiente) y de todas formas el criterio real es "no hay ninguna
	// cuota que mostrar", sin importar la Forma de Pago exacta guardada.
	const esContadoSinPagos = $derived(selectedPagos.length === 0 && Number(selectedCuenta?.saldo_pendiente ?? 0) > 0);
	const cuotasAMostrar = $derived.by((): Pago[] => {
		// fecha_emision como último respaldo (a diferencia de fecha_pago_programada/fecha_vencimiento,
		// que son opcionales) — sin esto, una cuenta Contado sin ninguna de esas dos fechas cargadas se
		// quedaba sin cuota sintética que mostrar y el panel decía "Sin pagos registrados todavía" en
		// vez de presentar la info de la cuenta, aunque sí tuviera saldo pendiente real.
		const fechaSintetica = selectedCuenta?.fecha_pago_programada || selectedCuenta?.fecha_vencimiento || selectedCuenta?.fecha_emision;
		if (esContadoSinPagos && fechaSintetica) {
			return [
				{
					id_pago: -1,
					id_cuenta_pagar: selectedCuenta!.id_cuenta_pagar,
					monto: selectedCuenta!.saldo_pendiente,
					fecha_pago: fechaSintetica,
					medio_pago: null,
					num_operacion: null,
					usuario_registro: null,
					referencia: null,
					created_at: '',
					estado_pago: 'programado',
					id_transaccion: null,
					transaccion: null
				}
			];
		}
		return selectedPagos;
	});

	/** La cuota 'programado' de fecha_pago más temprana entre las que se están mostrando — la que se
	 * abre al hacer doble clic sobre cualquier fila (no solo esa fila puntual, para que sea fácil de
	 * encontrar sin tener que apuntarle exacto). */
	const cuotaMasProxima = $derived.by(() => {
		const programadas = cuotasAMostrar.filter((c) => c.estado_pago === 'programado');
		if (programadas.length === 0) return null;
		return programadas.reduce((min, c) => (c.fecha_pago < min.fecha_pago ? c : min));
	});

	/** Una cuota (real o sintética) sin pagar cuya fecha programada ya pasó se muestra como "Vencido"
	 * en vez de "Programado"/"Por registrar" — comparación por día calendario, no por hora. */
	function esCuotaVencida(pago: Pago): boolean {
		if (pago.estado_pago !== 'programado' || !pago.fecha_pago) return false;
		const hoy = new Date();
		hoy.setHours(0, 0, 0, 0);
		return new Date(pago.fecha_pago + 'T00:00:00') < hoy;
	}

	/** Doble clic en cualquier cuota -> siempre abre/registra la "más próxima" (no la que se clickeó),
	 * a pedido del usuario. Si es la sintética (Contado sin pagos aún) abre "Registrar Pago" prellenado
	 * con su monto/fecha; si es una cuota real, abre la edición normal (ahí se puede pasar a Pagado).
	 */
	function handleDobleClicCuota() {
		if (!cuotaMasProxima) return;
		if (cuotaMasProxima.id_pago === -1) {
			editingPago = null;
			pagoInitialValues = { monto: String(cuotaMasProxima.monto), fecha_pago: cuotaMasProxima.fecha_pago };
			pagoModalOpen = true;
		} else {
			openEditPago(cuotaMasProxima);
		}
	}

	// A pedido del usuario: "Eliminar" pasa a ser un dar-de-baja reversible (oculta la cuenta, no
	// toca pagos ni transacciones) — mismo patrón que el resto de los módulos. El borrado PERMANENTE
	// de verdad (deleteCuentaPagar, que sí borra pagos y transacciones vinculadas) se mueve a la
	// sección "Eliminados" (solo-admin), siempre con contraseña.
	let confirmDarDeBajaOpen = $state(false);
	let cuentaParaDarDeBaja = $state<CuentaPagar | null>(null);

	function handleDelete(item: CuentaPagar) {
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
			const result = await darDeBajaCuentaPagar(supabase, cuentaParaDarDeBaja.id_cuenta_pagar);
			if (result.success) {
				toast.success(result.message ?? 'Cuenta por pagar dada de baja correctamente.');
				if (selectedId === cuentaParaDarDeBaja.id_cuenta_pagar) selectedId = null;
			} else {
				toast.error(result.message ?? 'No se pudo dar de baja la cuenta por pagar.');
			}
		} catch (err: any) {
			toast.error(`No se pudo dar de baja la cuenta por pagar. ${describeError(err)}`);
		} finally {
			closeConfirmDarDeBaja();
			await Promise.all([fetchList(), fetchMontoFiltrado(), fetchKpis()]);
		}
	}

	// ── Sección "Eliminados" (solo-admin): restaurar (sin contraseña) y borrado permanente (SIEMPRE
	// con contraseña de admin, sin excepción). ──

	let confirmRestaurarOpen = $state(false);
	let cuentaParaRestaurar = $state<CuentaPagar | null>(null);

	function handleRestaurar(item: CuentaPagar) {
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
			const result = await restaurarCuentaPagar(supabase, cuentaParaRestaurar.id_cuenta_pagar);
			if (result.success) {
				toast.success(result.message ?? 'Cuenta por pagar restaurada correctamente.');
				await fetchList();
			} else {
				toast.error(result.message ?? 'No se pudo restaurar la cuenta por pagar.');
			}
		} catch (err: any) {
			toast.error(`No se pudo restaurar la cuenta por pagar. ${describeError(err)}`);
		} finally {
			closeConfirmRestaurar();
		}
	}

	let confirmEliminarPermanenteOpen = $state(false);
	let cuentaParaEliminarPermanente = $state<CuentaPagar | null>(null);
	let eliminandoPermanente = $state(false);

	function handleEliminarPermanente(item: CuentaPagar) {
		cuentaParaEliminarPermanente = item;
		confirmEliminarPermanenteOpen = true;
	}
	function closeConfirmEliminarPermanente() {
		if (eliminandoPermanente) return;
		confirmEliminarPermanenteOpen = false;
		cuentaParaEliminarPermanente = null;
	}

	/** Igual patrón que el borrado masivo de Transacciones: verifyAdminCredentials re-autentica de
	 * verdad contra Supabase Auth antes de ejecutar deleteCuentaPagar (el mismo borrado real de
	 * siempre — cascada de pagos y transacciones vinculadas). */
	async function confirmarEliminarPermanente(email: string, password: string) {
		if (!cuentaParaEliminarPermanente) return;
		const verificacion = await verifyAdminCredentials(email, password);
		if (!verificacion.success) throw new Error(verificacion.message);

		eliminandoPermanente = true;
		try {
			const result = await deleteCuentaPagar(supabase, cuentaParaEliminarPermanente.id_cuenta_pagar, true);
			if (result.success) {
				toast.success(result.message ?? 'Cuenta por pagar eliminada permanentemente.');
				if (selectedId === cuentaParaEliminarPermanente.id_cuenta_pagar) selectedId = null;
				confirmEliminarPermanenteOpen = false;
				cuentaParaEliminarPermanente = null;
				await fetchList();
			} else {
				throw new Error(result.message || 'No se pudo eliminar la cuenta por pagar.');
			}
		} finally {
			eliminandoPermanente = false;
		}
	}

	async function handleDeletePago(idPago: number) {
		if (!(await confirmar({ title: 'Eliminar pago', message: '¿Eliminar este pago? El saldo de la cuenta se recalculará.', confirmLabel: 'Eliminar' }))) return;
		try {
			const result = await deletePago(supabase, idPago, isAdmin());
			if (result.success) toast.success(result.message);
			else toast.error(result.message);
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		} finally {
			await Promise.all([fetchList(), fetchSelectedPagos(), fetchMontoFiltrado(), fetchKpis()]);
		}
	}

	function openCreatePago() {
		editingPago = null;
		pagoInitialValues = {};
		pagoModalOpen = true;
	}

	/** El botón "Registrar Pago" de la cabecera del panel de cuotas: si ya hay una cuota programada
	 * (real o sintética) pendiente, la reutiliza — mismo camino que hacer doble clic sobre ella
	 * (handleDobleClicCuota) — para pasarla a "Pagado" en vez de insertar una fila nueva y dejar la
	 * programada intacta (eso duplicaba la cuota: quedaban dos filas para lo mismo). Solo crea un pago
	 * suelto de verdad cuando no hay ninguna cuota programada esperando (todas ya están pagadas/
	 * canceladas, o la cuenta no tiene fraccionamiento configurado). */
	function handleRegistrarPagoClick() {
		if (cuotaMasProxima) {
			handleDobleClicCuota();
		} else {
			openCreatePago();
		}
	}

	// ── "Resumen de pago" (ojito de cada fila) — espejo del "Resumen de cobro" de Cuentas por Cobrar (a
	// pedido del usuario, con imagen de referencia): datos de la cuenta en solo lectura + cronograma de
	// cuotas. Reusa la cuenta/cuotas seleccionadas (selectedCuenta/cuotasAMostrar), así que se refresca
	// solo cuando PagoModal guarda (ver handlePagoSaved). Tocar una cuota pendiente abre "Editar Cuota
	// Programada" (PagoModal) sobre el resumen. ──
	let resumenOpen = $state(false);

	// A pedido del usuario: en la lista (y en el título del panel de cuotas) se muestra el nombre real de la
	// contraparte — el prestamista en una Cuenta por Pagar de Préstamo Recibido, en vez del proveedor
	// genérico "PRÉSTAMOS / FINANCIERA" (ver getPrestamistasDeCuentasPagar). Se resuelve por página.
	let prestamistasPorCuenta = $state<Map<number, string>>(new Map());
	/** Tramos de un nombre separados DESPUÉS de cada "_" (ej. "OBRA_", "LAC_", "Cercado_") — para partirlo en
	 * varias líneas solo en los guiones bajos (vía <wbr>), nunca a mitad de una palabra. */
	function tramosNombre(texto: string): string[] {
		return texto.split(/(?<=_)/);
	}

	function nombreContraparte(item: CuentaPagar): string {
		const prestamista = prestamistasPorCuenta.get(item.id_cuenta_pagar);
		return prestamista || item.proveedor?.razon_social || 'Sin proveedor';
	}
	function esPrestamoCuenta(item: CuentaPagar): boolean {
		return prestamistasPorCuenta.has(item.id_cuenta_pagar);
	}
	/** Nombre del prestamista si la cuenta es un Préstamo Recibido (ver getPrestamistaDeCuentaPagar) — ahí
	 * el resumen muestra "Prestamista" en vez de "Proveedor" (que es el genérico de préstamos). null = no es
	 * un préstamo. */
	let prestamistaResumen = $state<string | null>(null);

	async function openResumen(item: CuentaPagar) {
		selectedId = item.id_cuenta_pagar;
		const [, prestamista] = await Promise.all([fetchSelectedPagos(), getPrestamistaDeCuentaPagar(supabase, item).catch(() => null)]);
		prestamistaResumen = prestamista;
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
		const proximo = cuotasAMostrar
			.filter((q) => q.estado_pago === 'programado')
			.sort((a, b) => (a.fecha_pago < b.fecha_pago ? -1 : 1))[0];
		return [
			prestamistaResumen !== null
				? { label: 'Prestamista', valor: prestamistaResumen }
				: { label: 'Proveedor', valor: c.proveedor?.razon_social ?? '' },
			{ label: 'Centro de costo', valor: etiquetaCampo('id_centro_costo', c.id_centro_costo) },
			{ label: 'N° documento', valor: c.num_documento ?? '' },
			{ label: 'Tipo de documento', valor: etiquetaCampo('tipo_documento', c.tipo_documento) },
			{ label: 'Monto comprometido', valor: formatCurrency(c.monto_comprometido) },
			{ label: 'Saldo pendiente', valor: formatCurrency(c.saldo_pendiente) },
			{ label: 'Próximo a pagar', valor: proximo ? formatCurrency(proximo.monto) : '' },
			{ label: 'Forma de pago', valor: etiquetaCampo('fotma_pago', c.fotma_pago) },
			{ label: 'Responsable', valor: c.responsable ?? '' },
			{ label: 'Fecha de emisión', valor: formatDate(c.fecha_emision) },
			{ label: 'Fecha de vencimiento', valor: formatDate(c.fecha_vencimiento) },
			{ label: 'Moneda', valor: etiquetaCampo('moneda', c.moneda) },
			{ label: 'Prioridad', valor: etiquetaCampo('prioridad', c.prioridad) },
			{ label: 'Estado', valor: etiquetaCampo('estado', c.estado) },
			{ label: 'Observación', valor: c.observacion ?? '', completo: true }
		];
	});

	// A pedido del usuario: solo se desbloquea la cuota pendiente más próxima (la de fecha más temprana —
	// cuotaMasProxima — que es la que toca pagar, incluida una ya vencida); las siguientes quedan con candado
	// hasta registrar esa. Igual en el resumen (ojito) y en la lista de cuotas del panel.
	const resumenCuotas = $derived(
		cuotasAMostrar.map((q): CuotaResumen => {
			const bloqueado = q.id_pago !== -1 && !!q.transaccion?.aprobado && !isAdmin();
			const estado: CuotaResumen['estado'] =
				q.estado_pago === 'pagado' ? 'pagado' : q.estado_pago === 'cancelado' ? 'anulado' : esCuotaVencida(q) ? 'vencido' : 'pendiente';
			return { id: q.id_pago, monto: q.monto, fecha: q.fecha_pago, estado, editable: q.estado_pago === 'programado' && !bloqueado && q.id_pago === cuotaMasProxima?.id_pago };
		})
	);

	/** Estado de una cuota tocado en el resumen: la sintética (Contado sin pagos) abre "Registrar Pago"
	 * prellenado, una real abre "Editar Cuota Programada" — mismo criterio que handleDobleClicCuota. */
	function editarCuotaDesdeResumen(idPago: number) {
		const pago = cuotasAMostrar.find((q) => q.id_pago === idPago);
		if (!pago) return;
		if (idPago === -1) {
			editingPago = null;
			pagoInitialValues = { monto: String(pago.monto), fecha_pago: pago.fecha_pago };
			pagoModalOpen = true;
		} else {
			openEditPago(pago);
		}
	}
	function openEditPago(pago: Pago) {
		editingPago = pago;
		pagoModalOpen = true;
	}
	function closePagoModal() {
		pagoModalOpen = false;
		editingPago = null;
		pagoInitialValues = {};
	}

	// A pedido explícito del usuario (mismo criterio "todo o nada" ya aplicado en
	// finanzas/cuentas-cobrar/+page.svelte, ver guardarCuentaCobrarConTransaccionPrestamo): en el flujo
	// "Préstamo Recibido" (ver abrirCreacionPrecargadaDesdeTransaccion), la transacción que originó
	// esta Cuenta por Pagar debe grabarse PRIMERO, y la cuenta recién DESPUÉS — si la transacción no se
	// puede grabar, la Cuenta por Pagar TAMPOCO debe grabarse. Se pasa como `onSubmitOverride` a
	// CuentaPagarModal (ver ahí), que lo usa en vez de createCuentaPagar directo — recibe los mismos
	// `formValues` que el modal ya validó, así que arma el payload de la transacción a partir de esos
	// valores (no de la cuenta ya creada, que en este orden todavía no existe).
	async function guardarCuentaPagarConTransaccionPrestamo(formValues: Record<string, string>, fracciones: Fraccion[] = []): Promise<ServiceResult<CuentaPagar>> {
		if (!prestamoPrefillDatos) {
			// Salvaguarda: este override solo debería pasarse mientras el flujo de préstamo está activo
			// (ver el prop condicional más abajo) — si por lo que sea se llama sin eso, cae al alta normal.
			const { data: userData } = await supabase.auth.getUser();
			return createCuentaPagar(supabase, formValues, userData?.user?.email ?? null, fracciones);
		}
		// Un préstamo recibido es un evento único — este flujo no soporta "Frecuencia de Pago" periódica
		// (generaría varias Cuentas por Pagar para UNA sola transacción de ingreso, sin sentido acá). El
		// campo no está bloqueado en el formulario, así que se valida acá antes de tocar nada.
		if (['mensual', 'quincenal', 'semanal'].includes(String(formValues.frecuencia_pago ?? ''))) {
			return { success: false, message: 'Un préstamo recibido no puede tener Frecuencia de Pago periódica — usa "Sin periodicidad".' };
		}
		const { data: userData } = await supabase.auth.getUser();
		// Datos reales del formulario de la transacción (fecha, moneda, medio de pago, cuenta bancaria, N° de
		// operación) — sin esto la transacción se grababa con la fecha de hoy, siempre en soles y sin cuenta
		// bancaria, así que el ingreso no se reflejaba en el saldo de esa cuenta. Si falta (precarga vieja),
		// se usa lo de la cuenta como antes.
		const t = (prestamoPrefillDatos.transaccion ?? {}) as Record<string, unknown>;
		const payloadTransaccion = {
			tipo_alcance: 'externa',
			id_centro_costo_origen: prestamoPrefillDatos.id_centro_costo_origen,
			id_centro_costo_destino: formValues.id_centro_costo,
			fecha: t.fecha || formValues.fecha_emision,
			tipo: 'ingreso',
			monto_total: t.monto_total || formValues.monto_comprometido,
			tipo_cambio: t.tipo_cambio || null,
			monto_convertido: t.monto_convertido || null,
			medio_pago: t.medio_pago || null,
			cuente_origen: t.cuente_origen || null,
			cuente_destino: t.cuente_destino || null,
			num_operacion: t.num_operacion || null,
			// tipo_moneda es obligatorio en `transaccion` (ver transaccion.config.ts) — mismo motivo que
			// en el flujo espejo de Cuentas por Cobrar (ver guardarCuentaCobrarConTransaccionPrestamo):
			// sin esto, crearTransaccionSistema fallaba con "Revisa los campos marcados" y no se guardaba
			// ni la transacción ni la Cuenta por Pagar.
			tipo_moneda: t.tipo_moneda || 'soles',
			categoria: 'Préstamo',
			descripcion: t.descripcion || formValues.observacion || 'Préstamo recibido'
		};
		let resultTransaccion;
		try {
			resultTransaccion = await crearTransaccionSistema(supabase, payloadTransaccion, userData?.user?.email ?? null, permisosState.userName || null, crypto.randomUUID());
		} catch (err: any) {
			console.error('[CuentasPagar] Excepción al crear la transacción del préstamo:', err);
			return { success: false, message: `No se pudo registrar la transacción del préstamo: ${err?.message ?? 'error inesperado'}. La Cuenta por Pagar no se guardó.` };
		}
		if (!resultTransaccion.success) {
			console.error('[CuentasPagar] crearTransaccionSistema devolvió un error:', resultTransaccion, payloadTransaccion);
			return { success: false, message: `No se pudo registrar la transacción del préstamo: ${resultTransaccion.message}. La Cuenta por Pagar no se guardó.` };
		}

		// id_transaccion (ver cuentas_pagar_cobrar_id_transaccion_migration.sql) vincula esta cuenta con la
		// transacción recién creada — así, si el usuario más tarde EDITA esa transacción, TransaccionModal
		// puede encontrar esta misma Cuenta por Pagar y abrirla para actualizarla también (ver
		// getCuentaPagarPorTransaccion).
		const resultCuenta = await createCuentaPagar(supabase, { ...formValues, id_transaccion: String(resultTransaccion.data!.id_transaccion) }, userData?.user?.email ?? null, fracciones);
		if (!resultCuenta.success) {
			// La transacción ya se creó pero la cuenta no — se revierte para no dejar un movimiento de
			// caja real sin la Cuenta por Pagar que lo respalda.
			try {
				await deleteTransaccion(supabase, resultTransaccion.data!.id_transaccion);
			} catch (err) {
				console.error('[CuentasPagar] No se pudo revertir la transacción tras fallar la Cuenta por Pagar:', err);
			}
			return { success: false, message: `La transacción se registró pero la Cuenta por Pagar no se pudo guardar (la transacción se revirtió): ${resultCuenta.message}` };
		}
		return resultCuenta;
	}

	async function handleSaved() {
		prestamoPrefillDatos = null;
		await Promise.all([fetchList(), fetchMontoFiltrado(), fetchKpis()]);
	}

	async function handlePagoSaved() {
		await Promise.all([fetchList(), fetchSelectedPagos(), fetchMontoFiltrado(), fetchKpis()]);
	}

	function handleTransaccionSugerida(payload: Record<string, unknown>, idPago: number) {
		transaccionPrefill = payload;
		confirmandoPagoId = idPago;
		transaccionModalOpen = true;
	}
	function closeTransaccionModal() {
		transaccionModalOpen = false;
		transaccionPrefill = null;
		confirmandoPagoId = null;
	}

	// Campos que llegan ya resueltos con datos reales del pago (ver construirPayloadTransaccionPorPago
	// en transacciones.service.ts) — esos quedan bloqueados en el TransaccionModal de confirmar pago;
	// solo lo que no vino en el payload (cuentas bancarias, alcance, etc.) queda disponible para llenar.
	// A pedido del usuario: Forma de Pago y Medio de Pago SIEMPRE quedan editables al confirmar un pago
	// (son datos de CÓMO se paga esta cuota, no de la cuenta — ej. la cuota de un préstamo).
	const CAMPOS_EDITABLES_CONFIRMAR_PAGO = new Set(['forma_pago', 'medio_pago']);
	const lockedFieldsConfirmarPago = $derived.by(() => {
		if (!confirmandoPagoId || !transaccionPrefill) return [];
		return Object.keys(transaccionPrefill).filter((key) => {
			const value = transaccionPrefill![key];
			return value !== null && value !== undefined && value !== '' && !CAMPOS_EDITABLES_CONFIRMAR_PAGO.has(key);
		});
	});

	// Se pasa como onConfirm al TransaccionModal cuando está confirmando un pago (ver
	// confirmandoPagoId) — crea la transacción Y confirma el pago como 'pagado' en un solo paso
	// atómico (ver confirmarPagoPagado en cuentasPagar.service.ts). Si esto falla, el pago se queda
	// como estaba (nunca "pagado" sin transacción).
	async function confirmarTransaccionPago(payload: Record<string, unknown>, idempotencyKey: string) {
		const { data: userData } = await supabase.auth.getUser();
		const result = await confirmarPagoPagado(supabase, confirmandoPagoId as number, payload, userData?.user?.email ?? null, permisosState.userName || null, idempotencyKey);
		if (result.success) await Promise.all([fetchList(), fetchSelectedPagos(), fetchMontoFiltrado(), fetchKpis()]);
		return result;
	}
</script>

<div class="w-full">
	{#if !verEliminados}
		<!-- A pedido explícito del usuario, con imagen de referencia: filtros compactos en forma de
		     píldora (una sola fila, ícono circular chico) en vez de las tarjetas grandes cuadradas de
		     antes — misma lógica de toggleTipoFilter/tipoFilter, solo cambia la presentación. -->
		<div class="flex flex-wrap gap-3 mb-6">
			<button
				type="button"
				onclick={() => toggleTipoFilter('consultoria')}
				class={`flex items-center gap-2 pl-2 pr-4 py-2 rounded-full border text-left transition-colors ${tipoFilter === 'consultoria' ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
			>
				<div class="w-7 h-7 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
					<Briefcase size={14} />
				</div>
				<span class="font-semibold text-slate-700 text-sm">Consultoria</span>
				{#if tipoFilter === 'consultoria'}<span class="ml-auto shrink-0 text-slate-400" title="Quitar este filtro" aria-label="Quitar este filtro"><X size={14} /></span>{/if}
			</button>
			<button
				type="button"
				onclick={() => toggleTipoFilter('proyecto')}
				class={`flex items-center gap-2 pl-2 pr-4 py-2 rounded-full border text-left transition-colors ${tipoFilter === 'proyecto' ? 'border-orange-300 bg-orange-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
			>
				<div class="w-7 h-7 rounded-full bg-orange-100 text-orange-500 flex items-center justify-center shrink-0">
					<HardHat size={14} />
				</div>
				<span class="font-semibold text-slate-700 text-sm">Obra</span>
				{#if tipoFilter === 'proyecto'}<span class="ml-auto shrink-0 text-slate-400" title="Quitar este filtro" aria-label="Quitar este filtro"><X size={14} /></span>{/if}
			</button>
			<button
				type="button"
				onclick={() => toggleTipoFilter('otro')}
				class={`flex items-center gap-2 pl-2 pr-4 py-2 rounded-full border text-left transition-colors ${tipoFilter === 'otro' ? 'border-slate-400 bg-slate-100' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
			>
				<div class="w-7 h-7 rounded-full bg-slate-700 text-white flex items-center justify-center shrink-0">
					<Ellipsis size={14} />
				</div>
				<span class="font-semibold text-slate-700 text-sm">Otros</span>
				{#if tipoFilter === 'otro'}<span class="ml-auto shrink-0 text-slate-400" title="Quitar este filtro" aria-label="Quitar este filtro"><X size={14} /></span>{/if}
			</button>
		</div>
	{/if}

	<div class="flex items-center justify-between mb-6">
		<div class="flex items-center gap-3">
			<Wallet class="text-[#0f3b5e]" size={28} />
			<div>
				<h1 class="text-xl font-bold text-[#0f3b5e]">{verEliminados ? 'Cuentas por pagar eliminadas' : 'Cuentas por Pagar'}</h1>
				<p class="text-sm text-slate-500">
					{verEliminados
						? 'Cuentas dadas de baja — restauralas o elimínalas de la base de datos permanentemente.'
						: 'Cuentas pendientes con proveedores y sus pagos registrados'}
				</p>
			</div>
		</div>
		<div class="flex items-center gap-2">
			{#if puedeVerEliminados()}
				<button type="button" onclick={toggleVerEliminados} class={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${verEliminados ? 'bg-slate-800 text-white hover:bg-slate-900' : 'border border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
					{#if verEliminados}<ChevronLeft size={16} />{:else}<Trash2 size={16} />{/if}
					{verEliminados ? 'Volver' : 'Ver eliminados'}
				</button>
			{/if}
			{#if !verEliminados}
				<button type="button" onclick={() => goto('/finanzas/cuentas-pagar/panoramas')} class="hidden md:flex items-center gap-2 px-4 py-2 rounded-lg border border-[#0f3b5e] text-[#0f3b5e] text-sm font-medium hover:bg-slate-50">
					<LayoutGrid size={16} /> Ver Panoramas de Pago
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
				<span class="text-xs font-medium text-slate-500">Pagos pendientes totales</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(resumen.totalPendiente)}</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0"><Wallet size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Pagado del mes</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(pagadoDelMes)}</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-red-100 text-red-600 flex items-center justify-center shrink-0"><AlertTriangle size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Pagos retrasados totales</span>
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
				placeholder="Buscar por N° documento, responsable..."
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
			options={[...FIELDS_CONFIG.filter((f) => f.sortable && (f.showInTable || f.key === 'prioridad')).map((field) => ({ value: String(field.key), label: `Ordenar: ${field.label}` }))]}
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
			<div class="min-w-[1360px]">
				<div class="grid grid-cols-[2.2fr_1.6fr_0.9fr_0.9fr_0.9fr_0.9fr_5.5rem_6.5rem_0.8fr_7rem] gap-3 items-center px-4 py-2 border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-600 uppercase tracking-wide">
					<span>Proveedor / Cliente / Prestamista</span>
					<span>Centro de Costo</span>
					<span>N° Documento</span>
					<span>Vencimiento</span>
					<span class="text-right">Saldo actual</span>
					<span class="text-right">Valor Venta</span>
					<!-- Ticket #88: Prioridad y Estado compartían una sola columna (mitad cada uno) y en pantallas angostas
					     "Pendiente" se salía de su lugar y no calzaba con el título. Ahora son dos columnas de ancho fijo. -->
					<span>Prioridad</span>
					<span>Estado</span>
					<span class="text-right">Días de Retraso</span>
					<span class="text-right">Acciones</span>
				</div>

				{#each items as item (item.id_cuenta_pagar)}
					{@const retraso = diasDeRetraso(item.estado, item.fecha_vencimiento, item.fecha_pago_programada)}
					<div
						class={`grid grid-cols-[2.2fr_1.6fr_0.9fr_0.9fr_0.9fr_0.9fr_5.5rem_6.5rem_0.8fr_7rem] gap-3 items-center px-4 py-4 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 cursor-pointer transition-colors ${
							selectedId === item.id_cuenta_pagar ? 'bg-blue-100 hover:bg-blue-100' : (estadoCardClass[item.estado] ?? '')
						}`}
						onclick={() => selectRow(item)}
					>
						<div class="flex items-center gap-3 min-w-0">
							<div class={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${estadoIconClass[item.estado] ?? 'bg-slate-100 text-slate-500'}`}>
								<FileText size={18} />
							</div>
							<div class="min-w-0">
								<p class="text-[13px] font-semibold text-slate-800 leading-snug [overflow-wrap:break-word]" title={nombreContraparte(item)}>{#each tramosNombre(nombreContraparte(item)) as tramo}{tramo}<wbr />{/each}</p>
								<p class="text-[11px] text-slate-400 mt-0.5 [overflow-wrap:break-word]">
									{#if esPrestamoCuenta(item)}Prestamista{:else}{item.proveedor?.vendedor ?? ''}{/if}
								</p>
							</div>
						</div>
						<div class="text-[13px] text-slate-600 leading-snug [overflow-wrap:break-word]" title={centroCostoLabel(item)}>{#each tramosNombre(centroCostoLabel(item)) as tramo}{tramo}<wbr />{/each}</div>
						<div class="text-sm text-slate-600 truncate">{item.num_documento || '—'}</div>
						<div class="text-sm text-slate-600 whitespace-nowrap">{formatDate(item.fecha_pago_programada || item.fecha_vencimiento)}</div>
						<div class="text-right font-semibold text-slate-700 text-sm">{formatCurrency(item.saldo_pendiente)}</div>
						<div class="text-right font-bold text-slate-800 text-sm">{formatCurrency(item.monto_comprometido)}</div>
						<div class="min-w-0">
							{#if item.prioridad && item.estado !== 'pagado'}
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
					<p class="px-4 py-10 text-center text-slate-400">{loading ? 'Cargando...' : 'No se encontraron cuentas por pagar.'}</p>
				{/each}
			</div>
		</div>

		<!-- Mobile: tarjetas apiladas -->
		<div class="md:hidden">
			{#each items as item (item.id_cuenta_pagar)}
				{@const retraso = diasDeRetraso(item.estado, item.fecha_vencimiento, item.fecha_pago_programada)}
				<div
					role="button"
					tabindex="0"
					onclick={() => selectRow(item)}
					onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && selectRow(item)}
					class={`w-full text-left p-4 border-b border-slate-100 last:border-b-0 active:bg-slate-50 transition-colors cursor-pointer ${
						selectedId === item.id_cuenta_pagar ? 'bg-blue-100' : (estadoCardClass[item.estado] ?? '')
					}`}
				>
					<div class="flex items-start justify-between gap-3 mb-2">
						<div class="flex items-center gap-3 min-w-0">
							<div class={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${estadoIconClass[item.estado] ?? 'bg-slate-100 text-slate-500'}`}>
								<FileText size={18} />
							</div>
							<div class="min-w-0">
								<p class="text-[13px] font-semibold text-slate-800 leading-snug [overflow-wrap:break-word]" title={nombreContraparte(item)}>{#each tramosNombre(nombreContraparte(item)) as tramo}{tramo}<wbr />{/each}</p>
								<p class="text-[11px] text-slate-400 mt-0.5 truncate">{#if esPrestamoCuenta(item)}Prestamista · {/if}{centroCostoLabel(item)} · {item.num_documento || '—'}</p>
							</div>
						</div>
						<div class="text-right shrink-0">
							<div class="font-bold text-slate-800 text-sm">{formatCurrency(item.monto_comprometido)}</div>
							<div class="text-[11px] text-slate-400">Saldo: {formatCurrency(item.saldo_pendiente)}</div>
						</div>
					</div>
					<div class="flex items-center justify-between gap-2 mb-2">
						<div class="flex items-center gap-1.5 flex-wrap">
							{#if item.prioridad && item.estado !== 'pagado'}
								<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${prioridadBadgeClass[item.prioridad] ?? 'bg-slate-100 text-slate-600'}`}>
									{getOptionLabel(prioridadField, item.prioridad)}
								</span>
							{/if}
							<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${estadoBadgeClass[item.estado] ?? 'bg-slate-100 text-slate-600'}`}>
								{getOptionLabel(estadoField, item.estado)}
							</span>
						</div>
					</div>
					<div class="flex items-center justify-between text-xs text-slate-500 mb-3">
						<span class="truncate">
							Vencimiento: {formatDate(item.fecha_pago_programada || item.fecha_vencimiento)}
							{#if item.proveedor?.vendedor}· {item.proveedor.vendedor}{/if}
						</span>
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
				<p class="px-4 py-10 text-center text-slate-400">{loading ? 'Cargando...' : 'No se encontraron cuentas por pagar.'}</p>
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

	<!-- A pedido del usuario: el panel "Pagos de <cliente/proveedor>" que aparecía debajo de la lista ya no
	     se muestra — las cuotas se ven y se registran desde el Resumen (ojito de cada fila, ver resumenCuotas). -->
</div>

<CuentaPagarModal
	open={modalOpen}
	mode={modalMode}
	cuenta={editingCuenta}
	dynamicOptions={dynamicOptions}
	{centroCostoTipoMap}
	{proveedorBloqueado}
	{prestamistaNombre}
	camposBloqueados={camposBloqueadosPrestamo}
	onSubmitOverride={prestamoPrefillDatos ? guardarCuentaPagarConTransaccionPrestamo : null}
	onClose={closeModal}
	onSaved={handleSaved}
/>
<ResumenCuentaModal
	open={resumenOpen && !!selectedCuenta}
	titulo="Resumen de pago"
	tituloCronograma="Cronograma de pagos"
	etiquetaTotal="Monto total"
	textoPagado="Pagado"
	campos={resumenCampos}
	cuotas={resumenCuotas}
	montoTotal={Number(selectedCuenta?.monto_comprometido ?? 0)}
	onClose={() => (resumenOpen = false)}
	onEditarCuota={editarCuotaDesdeResumen}
/>
<PagoModal
	open={pagoModalOpen}
	idCuentaPagar={selectedId}
	pago={editingPago}
	initialValues={pagoInitialValues}
	onClose={closePagoModal}
	onSaved={handlePagoSaved}
	onTransaccionSugerida={handleTransaccionSugerida}
/>
<TransaccionModal
	open={transaccionModalOpen}
	mode="create"
	transaccion={transaccionPrefill as any}
	dynamicOptions={transaccionDynamicOptions}
	onClose={closeTransaccionModal}
	onSaved={closeTransaccionModal}
	onConfirm={confirmandoPagoId ? confirmarTransaccionPago : null}
	confirmTitle={confirmandoPagoId ? 'Confirmar Pago — Transacción de Respaldo' : null}
	confirmButtonLabel={confirmandoPagoId ? 'Confirmar Pago' : null}
	lockedFields={lockedFieldsConfirmarPago}
/>

<ConfirmModal
	open={confirmDarDeBajaOpen}
	title="Dar de baja cuenta por pagar"
	message={cuentaParaDarDeBaja ? `¿Dar de baja esta cuenta por pagar (${cuentaParaDarDeBaja.proveedor?.razon_social ?? 'proveedor #' + cuentaParaDarDeBaja.id_proveedor})? Quedará marcada como inactiva. Sus pagos y transacciones ya registrados no se tocan.` : ''}
	confirmLabel="Dar de baja"
	onConfirm={confirmarDarDeBaja}
	onClose={closeConfirmDarDeBaja}
/>

<ConfirmModal
	open={confirmRestaurarOpen}
	title="Restaurar cuenta por pagar"
	danger={false}
	message={cuentaParaRestaurar ? `¿Restaurar esta cuenta por pagar? Volverá a aparecer en el listado.` : ''}
	confirmLabel="Restaurar"
	onConfirm={confirmarRestaurar}
	onClose={closeConfirmRestaurar}
/>

<AdminConfirmModal
	open={confirmEliminarPermanenteOpen}
	title="Eliminar cuenta por pagar permanentemente"
	message={cuentaParaEliminarPermanente ? `Vas a eliminar PERMANENTEMENTE esta cuenta por pagar y todos sus pagos registrados. Si alguno tiene una transacción vinculada, también se eliminará. Esta acción no se puede deshacer. Ingresa el correo y la contraseña de un administrador para continuar.` : ''}
	confirmLabel="Eliminar permanentemente"
	onConfirm={confirmarEliminarPermanente}
	onClose={closeConfirmEliminarPermanente}
/>
