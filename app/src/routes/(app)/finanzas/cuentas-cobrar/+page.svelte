<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin, permisosState } from '$lib/stores/permisos.svelte';
	import { Plus, Pencil, Trash2, Search, ChevronUp, ChevronDown, X, Landmark, Receipt, FileText, Lock, ShieldCheck, LayoutGrid, CreditCard, Wallet, AlertTriangle, Filter } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { getOptionLabel, formatCurrency, emptyColumnFilters, diasDeRetraso, type FieldOption, type ColumnFilters } from '$lib/shared/fieldConfig';
	import { FIELDS_CONFIG, DEFAULT_SORT_FIELD, DEFAULT_SORT_DIR, DEFAULT_PAGE_SIZE } from '$lib/modules/cuentas-cobrar/config/cuentaCobrar.config';
	import { FIELDS_CONFIG as COBRO_FIELDS_CONFIG } from '$lib/modules/cuentas-cobrar/config/cobro.config';
	import {
		getCuentasCobrar,
		deleteCuentaCobrar,
		getCobros,
		deleteCobro,
		getClienteOptions,
		getProyectoOptions,
		confirmarCobroCobrado,
		getMontoFiltrado
	} from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';
	import { getCentroCostoOptions, getCentroCostoOptionsVentasCerradas, getCentroCostoMontoVentaCerrada, getEmpleadoOptions } from '$lib/modules/transacciones/services/transacciones.service';
	import { getResumenCobros, getCobradoEnRango, type ResumenCobros } from '$lib/modules/panoramas/services/panoramas.service';
	import CuentaCobrarModal from '$lib/modules/cuentas-cobrar/components/CuentaCobrarModal.svelte';
	import CobroModal from '$lib/modules/cuentas-cobrar/components/CobroModal.svelte';
	import TransaccionModal from '$lib/modules/transacciones/components/TransaccionModal.svelte';
	import ColumnFilterBar from '$lib/shared/components/ColumnFilterBar.svelte';
	import ResponsiveDataView from '$lib/shared/components/ResponsiveDataView.svelte';
	import type { CuentaCobrar, Cobro } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';

	// Módulo 100% client-side (Supabase anon key) para funcionar en Tauri Windows/Android sin
	// servidor embebido — ver nota de seguridad en centro-costos/+page.svelte: la BD todavía no
	// tiene RLS real, este guard (isAdmin()) es solo de UI.

	const tableFields = FIELDS_CONFIG.filter((f) => f.showInTable);
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
	let transaccionDynamicOptions = $state<Record<string, FieldOption[]>>({ id_centro_costo_origen: [], id_centro_costo_destino: [] });
	let centroCostoMontoMap = $state<Record<string, number>>({});

	let selectedId = $state<number | null>(null);
	let selectedCobros = $state<Cobro[]>([]);

	let modalOpen = $state(false);
	let modalMode = $state<'create' | 'edit'>('create');
	let editingCuenta = $state<CuentaCobrar | null>(null);
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

	async function fetchList() {
		loading = true;
		try {
			const result = await getCuentasCobrar(supabase, { page: pageNum, pageSize: DEFAULT_PAGE_SIZE, search, sortBy, sortDir, columnFilters });
			items = result.items;
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
			montoFiltrado = await getMontoFiltrado(supabase, search, columnFilters);
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

	onMount(async () => {
		if (!isAdmin()) {
			goto('/dashboard');
			return;
		}
		try {
			const [clienteOptions, proyectoOptions, centroCostoOptions, centroCostoOptionsVentasCerradas, montoMap, empleadoOptions] = await Promise.all([
				getClienteOptions(supabase),
				getProyectoOptions(supabase),
				getCentroCostoOptions(supabase),
				getCentroCostoOptionsVentasCerradas(supabase),
				getCentroCostoMontoVentaCerrada(supabase),
				getEmpleadoOptions(supabase)
			]);
			// "Centro de Costo" en Nueva/Editar Cuenta por Cobrar solo ofrece las ventas cerradas (a
			// pedido del usuario) — el de la transacción de respaldo (confirmar cobro) sigue usando la
			// lista completa sin filtrar, igual que en Cuentas por Pagar.
			dynamicOptions = { id_cliente: clienteOptions, id_proyecto: proyectoOptions, id_centro_costo: centroCostoOptionsVentasCerradas, responsable: empleadoOptions };
			transaccionDynamicOptions = { id_centro_costo_origen: centroCostoOptions, id_centro_costo_destino: centroCostoOptions };
			centroCostoMontoMap = montoMap;
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar clientes/proyectos/centros de costo');
		}
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
		modalOpen = true;
	}
	function openEdit(item: CuentaCobrar) {
		modalMode = 'edit';
		editingCuenta = item;
		modalOpen = true;
	}
	function closeModal() {
		modalOpen = false;
		editingCuenta = null;
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

	async function handleDelete(item: CuentaCobrar) {
		if (!confirm('¿Eliminar esta cuenta por cobrar y todos sus cobros registrados? Si alguno tiene una transacción vinculada, también se eliminará. Esta acción no se puede deshacer.')) return;
		try {
			const result = await deleteCuentaCobrar(supabase, item.id_cuenta_cobrar, isAdmin());
			if (result.success) {
				toast.success(result.message);
				if (selectedId === item.id_cuenta_cobrar) selectedId = null;
			} else {
				toast.error(result.message);
			}
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		} finally {
			await Promise.all([fetchList(), fetchMontoFiltrado(), fetchKpis()]);
		}
	}

	async function handleDeleteCobro(idCobro: number) {
		if (!confirm('¿Eliminar este cobro? El saldo de la cuenta se recalculará.')) return;
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

	async function handleSaved() {
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
	async function confirmarTransaccionCobro(payload: Record<string, unknown>) {
		const { data: userData } = await supabase.auth.getUser();
		const result = await confirmarCobroCobrado(supabase, confirmandoCobroId as number, payload, userData?.user?.email ?? null, permisosState.userName || null);
		if (result.success) await Promise.all([fetchList(), fetchSelectedCobros(), fetchMontoFiltrado(), fetchKpis()]);
		return result;
	}
</script>

<div class="max-w-6xl mx-auto">
	<div class="flex items-center justify-between mb-6">
		<div class="flex items-center gap-3">
			<Landmark class="text-[#0f3b5e]" size={28} />
			<div>
				<h1 class="text-xl font-bold text-[#0f3b5e]">Cuentas por Cobrar</h1>
				<p class="text-sm text-slate-500">Cuentas pendientes de clientes y sus cobros registrados</p>
			</div>
		</div>
		<div class="flex items-center gap-2">
			<button type="button" onclick={() => goto('/finanzas/cuentas-cobrar/panoramas')} class="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#0f3b5e] text-[#0f3b5e] text-sm font-medium hover:bg-slate-50">
				<LayoutGrid size={16} /> Ver Panoramas de Cobro
			</button>
			<button type="button" onclick={openCreate} class="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-medium hover:bg-[#0c2f4c]">
				<Plus size={16} /> Nueva Cuenta
			</button>
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

	<ColumnFilterBar fields={tableFields} bind:filters={columnFilters} dynamicOptions={dynamicOptions} onChange={handleColumnFiltersChange} />

	<div class="mb-4 flex flex-wrap items-center gap-3">
		<div class="relative flex-1 min-w-[220px] max-w-sm">
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

		<select
			value={sortBy}
			onchange={(e) => toggleSort((e.target as HTMLSelectElement).value, true)}
			class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
		>
			{#each tableFields.filter((f) => f.sortable) as field}
				<option value={field.key}>Ordenar: {field.label}</option>
			{/each}
		</select>
		<button
			type="button"
			onclick={() => { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; pageNum = 1; fetchList(); }}
			class="p-2 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50"
			title={sortDir === 'asc' ? 'Ascendente' : 'Descendente'}
			aria-label="Cambiar dirección de orden"
		>
			{#if sortDir === 'asc'}<ChevronUp size={16} />{:else}<ChevronDown size={16} />{/if}
		</button>
	</div>

	<div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
		<!-- Desktop: filas tipo tabla -->
		<div class="hidden md:block overflow-x-auto">
			<div class="min-w-[980px]">
				<div class="grid grid-cols-[2fr_1.1fr_1fr_1.1fr_0.9fr_auto] gap-3 items-center px-4 py-2 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
					<span>Proyecto</span>
					<span>N° Documento</span>
					<span class="text-center">Montos</span>
					<div class="flex gap-2 pl-4">
						<span class="flex-1">Prioridad</span>
						<span class="flex-1">Estado</span>
					</div>
					<span class="text-right">Días de Retraso</span>
					<span class="text-right">Acciones</span>
				</div>

				{#each items as item (item.id_cuenta_cobrar)}
					{@const retraso = diasDeRetraso(item.estado, item.fecha_vencimiento)}
					<div
						class={`grid grid-cols-[2fr_1.1fr_1fr_1.1fr_0.9fr_auto] gap-3 items-center px-4 py-4 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 cursor-pointer transition-colors ${
							selectedId === item.id_cuenta_cobrar ? 'bg-blue-50 hover:bg-blue-50' : (estadoCardClass[item.estado] ?? '')
						}`}
						onclick={() => selectRow(item)}
					>
						<div class="flex items-center gap-3 min-w-0">
							<div class={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${estadoIconClass[item.estado] ?? 'bg-slate-100 text-slate-500'}`}>
								<FileText size={18} />
							</div>
							<div class="min-w-0">
								<p class="font-semibold text-slate-800 truncate">{item.proyecto?.nombre_proyecto ?? 'Sin proyecto'}</p>
								<div class="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-500 flex-wrap">
									<span class="truncate">{item.cliente?.nombre ?? 'Sin cliente'}</span>
									<span class="text-slate-300">·</span>
									<span class="shrink-0">{formatDate(item.fecha_vencimiento)}</span>
								</div>
							</div>
						</div>
						<div class="text-sm text-slate-600 truncate">{item.num_documento || '—'}</div>
						<div class="text-center leading-tight">
							<p class="font-bold text-slate-800 text-sm">{formatCurrency(item.monto)}</p>
							{#if item.moneda === 'USD'}
								<p class="text-[11px] text-slate-400">{formatUSD(item.monto_dolares)}</p>
							{/if}
						</div>
						<div class="flex items-center gap-2 pl-4">
							<div class="flex-1">
								{#if item.prioridad}
									<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${prioridadBadgeClass[item.prioridad] ?? 'bg-slate-100 text-slate-600'}`}>
										{getOptionLabel(prioridadField, item.prioridad)}
									</span>
								{/if}
							</div>
							<div class="flex-1">
								<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${estadoBadgeClass[item.estado] ?? 'bg-slate-100 text-slate-600'}`}>
									{getOptionLabel(estadoField, item.estado)}
								</span>
							</div>
						</div>
						<div class="text-right text-sm">
							{#if retraso !== null}
								<span class="font-bold text-red-600">{retraso}</span> <span class="text-slate-400 text-xs">día{retraso === 1 ? '' : 's'}</span>
							{:else}
								<span class="text-slate-300">—</span>
							{/if}
						</div>
						<div class="flex items-center gap-1 justify-end">
							<button type="button" onclick={(e) => { e.stopPropagation(); openEdit(item); }} class="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600" title="Editar" aria-label="Editar">
								<Pencil size={16} />
							</button>
							<button type="button" onclick={(e) => { e.stopPropagation(); handleDelete(item); }} class="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600" title="Eliminar" aria-label="Eliminar">
								<Trash2 size={16} />
							</button>
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
								<p class="font-semibold text-slate-800 truncate">{item.proyecto?.nombre_proyecto ?? 'Sin proyecto'}</p>
								<p class="text-[11px] text-slate-500 truncate mt-0.5">{item.cliente?.nombre ?? 'Sin cliente'} · {item.num_documento || '—'}</p>
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
					</div>
					<div class="flex items-center justify-between text-xs text-slate-500 mb-3">
						<span>Vencimiento: {formatDate(item.fecha_vencimiento)}</span>
						{#if retraso !== null}
							<span class="font-bold text-red-600">Vencido hace {retraso} día{retraso === 1 ? '' : 's'}</span>
						{/if}
					</div>
					<div class="flex items-center gap-2 pt-2 border-t border-slate-100">
						<button type="button" onclick={(e) => { e.stopPropagation(); openEdit(item); }} class="flex-1 h-10 rounded-lg border border-slate-200 text-slate-600 flex items-center justify-center gap-2 text-xs font-medium active:bg-slate-50" aria-label="Editar">
							<Pencil size={14} /> Editar
						</button>
						<button type="button" onclick={(e) => { e.stopPropagation(); handleDelete(item); }} class="flex-1 h-10 rounded-lg border border-slate-200 text-rose-600 flex items-center justify-center gap-2 text-xs font-medium active:bg-rose-50" aria-label="Eliminar">
							<Trash2 size={14} /> Eliminar
						</button>
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

	{#if selectedCuenta}
		<div class="mt-6 bg-white rounded-xl border border-slate-200 p-6">
			<div class="flex items-center justify-between mb-4">
				<div class="flex items-center gap-2">
					<Receipt class="text-amber-500" size={20} />
					<h2 class="text-lg font-semibold text-[#0f3b5e]">
						Cobros de {selectedCuenta.cliente?.nombre ?? 'la cuenta'} — {formatCurrency(selectedCuenta.monto)}
						(saldo: {formatCurrency(selectedCuenta.saldo_pendiente)})
					</h2>
				</div>
				<button type="button" onclick={handleRegistrarCobroClick} class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600">
					<Plus size={14} /> Registrar Cobro
				</button>
			</div>

			{#if cobrosAMostrar.length === 0}
				<p class="text-sm text-slate-400 text-center py-6">Sin cobros registrados todavía.</p>
			{:else}
				{#if esContadoSinCobros}
					<p class="text-xs text-slate-400 mb-2">Sin cuotas registradas todavía: se muestra el saldo pendiente como una sola cuota. Doble clic para registrar el cobro.</p>
				{:else}
					<p class="text-xs text-slate-400 mb-2">Doble clic en cualquier fila para registrar/editar la cuota más próxima.</p>
				{/if}
				<div class="overflow-x-auto">
					<ResponsiveDataView items={cobrosAMostrar} keyField="id_cobro" onRowDblClick={handleDobleClicCuota} columns={[
						{ label: 'Fecha' },
						{ label: 'Monto' },
						{ label: 'Medio' },
						{ label: 'N° Operación' },
						{ label: 'Estado' },
						{ label: 'Acciones', align: 'right' }
					]}>
						{#snippet row(cobro)}
							{@const sintetica = cobro.id_cobro === -1}
							{@const bloqueado = !sintetica && !!cobro.transaccion?.aprobado && !isAdmin()}
							<td class="px-3 py-2">{formatDate(cobro.fecha_cobro)}</td>
							<td class="px-3 py-2">{formatCurrency(cobro.monto)}</td>
							<td class="px-3 py-2">{cobro.medio_cobro ? getOptionLabel(medioCobroField, String(cobro.medio_cobro)) : '—'}</td>
							<td class="px-3 py-2">{cobro.num_operacion ?? '—'}</td>
							<td class="px-3 py-2">
								<div class="flex items-center gap-1.5">
									{#if cobro.estado_cobro === 'programado' && esCuotaVencida(cobro)}
										<span class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-700">Vencido</span>
									{:else if cobro.estado_cobro === 'programado'}
										<span class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-700">{sintetica ? 'Por registrar' : 'Programado'}</span>
									{:else if cobro.estado_cobro === 'cancelado'}
										<span class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-200 text-slate-600">Anulado</span>
									{:else}
										<span class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700">Cobrado</span>
									{/if}
									{#if cobro.transaccion?.aprobado}
										<ShieldCheck size={13} class="text-emerald-600" title={`Transacción aprobada por ${cobro.transaccion.aprobado_por ?? 'un administrador'}`} />
									{/if}
								</div>
							</td>
							<td class="px-3 py-2 text-right">
								{#if sintetica}
									<span class="text-[11px] text-slate-400">Doble clic para registrar</span>
								{:else if bloqueado}
									<span class="p-1.5 text-slate-300 inline-flex" title="Bloqueado: transacción aprobada, solo un administrador puede editar/eliminar">
										<Lock size={16} />
									</span>
								{:else}
									{#if cobro.estado_cobro === 'programado'}
										<button type="button" onclick={() => openEditCobro(cobro)} class="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600" title="Editar cuota" aria-label="Editar cuota">
											<Pencil size={16} />
										</button>
									{/if}
									<button type="button" onclick={() => handleDeleteCobro(cobro.id_cobro)} class="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600" title="Eliminar cobro" aria-label="Eliminar cobro">
										<Trash2 size={16} />
									</button>
								{/if}
							</td>
						{/snippet}
						{#snippet card(cobro)}
							{@const sintetica = cobro.id_cobro === -1}
							{@const bloqueado = !sintetica && !!cobro.transaccion?.aprobado && !isAdmin()}
							<div class="flex items-start justify-between gap-3 mb-2">
								<div class="min-w-0">
									<div class="font-semibold text-slate-800">{formatCurrency(cobro.monto)}</div>
									<div class="text-xs text-slate-400 mt-0.5">{formatDate(cobro.fecha_cobro)}</div>
								</div>
								<div class="flex items-center gap-1.5 shrink-0">
									{#if cobro.estado_cobro === 'programado' && esCuotaVencida(cobro)}
										<span class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-700">Vencido</span>
									{:else if cobro.estado_cobro === 'programado'}
										<span class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-700">{sintetica ? 'Por registrar' : 'Programado'}</span>
									{:else if cobro.estado_cobro === 'cancelado'}
										<span class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-200 text-slate-600">Anulado</span>
									{:else}
										<span class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700">Cobrado</span>
									{/if}
									{#if cobro.transaccion?.aprobado}
										<ShieldCheck size={13} class="text-emerald-600" />
									{/if}
								</div>
							</div>
							<div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-500 mb-3">
								<span class="text-slate-400">Medio</span>
								<span class="text-right text-slate-700">{cobro.medio_cobro ? getOptionLabel(medioCobroField, String(cobro.medio_cobro)) : '—'}</span>
								<span class="text-slate-400">N° Operación</span>
								<span class="text-right text-slate-700">{cobro.num_operacion ?? '—'}</span>
							</div>
							{#if sintetica}
								<p class="text-center text-[11px] text-slate-400 pt-2 border-t border-slate-100">Doble clic para registrar el cobro</p>
							{:else if bloqueado}
								<div class="flex items-center justify-center gap-2 text-slate-400 text-xs pt-2 border-t border-slate-100">
									<Lock size={14} /> Bloqueado: transacción aprobada
								</div>
							{:else}
								<div class="flex items-center gap-2 pt-2 border-t border-slate-100">
									{#if cobro.estado_cobro === 'programado'}
										<button type="button" onclick={() => openEditCobro(cobro)} class="flex-1 h-10 rounded-lg border border-slate-200 text-slate-600 flex items-center justify-center gap-2 text-xs font-medium active:bg-slate-50" aria-label="Editar cuota">
											<Pencil size={14} /> Editar
										</button>
									{/if}
									<button type="button" onclick={() => handleDeleteCobro(cobro.id_cobro)} class="flex-1 h-10 rounded-lg border border-slate-200 text-rose-600 flex items-center justify-center gap-2 text-xs font-medium active:bg-rose-50" aria-label="Eliminar cobro">
										<Trash2 size={14} /> Eliminar
									</button>
								</div>
							{/if}
						{/snippet}
					</ResponsiveDataView>
				</div>
			{/if}
		</div>
	{/if}
</div>

<CuentaCobrarModal open={modalOpen} mode={modalMode} cuenta={editingCuenta} dynamicOptions={dynamicOptions} centroCostoMontoMap={centroCostoMontoMap} onClose={closeModal} onSaved={handleSaved} />
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
