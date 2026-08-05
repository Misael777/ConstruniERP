<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin } from '$lib/stores/permisos.svelte';
	import { Plus, Pencil, Trash2, Search, ChevronUp, ChevronDown, X, ArrowLeftRight, ListTree, FileText, ShieldCheck, Wallet, LayoutGrid, CalendarDays, Eye } from '@lucide/svelte';
	import DocumentPreviewModal from '$lib/shared/components/DocumentPreviewModal.svelte';
	import AdminConfirmModal from '$lib/shared/components/AdminConfirmModal.svelte';
	import { verifyAdminCredentials } from '$lib/shared/adminAuth';
	import { toast } from '$lib/stores/toast';
	import { getOptionLabel, formatCurrency, type FieldOption } from '$lib/shared/fieldConfig';
	import { FIELDS_CONFIG, DEFAULT_SORT_FIELD, DEFAULT_SORT_DIR, DEFAULT_PAGE_SIZE } from '$lib/modules/transacciones/config/transaccion.config';
	import {
		getTransacciones,
		getTransaccionesCalendario,
		actualizarFechasTransacciones,
		deleteTransaccion,
		getTransDetalles,
		deleteTransDetalle,
		getCentroCostoOptions,
		getCentroCostoOptionsProyectos,
		getCentroCostoOptionsExternos,
		getCentroCostoOptionsExternosOrigen,
		getCentroCostoOptionsSoloCentros,
		getCentroCostoProductoLookup,
		getPartidaOptions
	} from '$lib/modules/transacciones/services/transacciones.service';
	import { getCuentaBancoOptions } from '$lib/modules/cuentas-bancarias/services/cuentaBanco.service';
	import TransaccionModal from '$lib/modules/transacciones/components/TransaccionModal.svelte';
	import TransDetalleModal from '$lib/modules/transacciones/components/TransDetalleModal.svelte';
	import TransaccionCalendarView from '$lib/modules/transacciones/components/TransaccionCalendarView.svelte';
	import type { Transaccion, TransDetalle } from '$lib/modules/transacciones/services/transacciones.service';

	// Módulo 100% client-side (Supabase anon key) para funcionar en Tauri Windows/Android sin
	// servidor embebido — ver nota de seguridad en centro-costos/+page.svelte: la BD todavía no
	// tiene RLS real, este guard (isAdmin()) es solo de UI.

	const tableFields = FIELDS_CONFIG.filter((f) => f.showInTable);
	const tipoField = FIELDS_CONFIG.find((f) => f.key === 'tipo')!;
	const estadoField = FIELDS_CONFIG.find((f) => f.key === 'estado')!;
	const tipoBadgeClass: Record<string, string> = {
		ingreso: 'bg-emerald-100 text-emerald-700',
		egreso: 'bg-red-100 text-red-700'
	};
	const estadoBadgeClass: Record<string, string> = {
		activo: 'bg-blue-100 text-blue-700',
		anulado: 'bg-slate-200 text-slate-600'
	};

	let items = $state<Transaccion[]>([]);
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

	// dynamicOptions (Origen/Destino de Transacción en el formulario) solo trae centros de costo
	// vinculados a un PROYECTO (ver getCentroCostoOptionsProyectos) — pero la tabla de abajo puede
	// mostrar transacciones antiguas contra un centro de costo de proveedor/empleado, así que el
	// lookup para pintar esa columna usa la lista COMPLETA por separado, no dynamicOptions.
	let dynamicOptions = $state<Record<string, FieldOption[]>>({ id_centro_costo_origen: [], id_centro_costo_destino: [] });
	let centroCostoOptionsCompleto = $state<FieldOption[]>([]);
	let detalleDynamicOptions = $state<Record<string, FieldOption[]>>({ id_partida: [] });
	const centroCostoLookup = $derived(new Map(centroCostoOptionsCompleto.map((o) => [o.value, o.label])));

	// Producto y Servicio del proveedor vinculado al centro de costo origen/destino de cada
	// transacción (columna real proveedor.vendedor, ver getCentroCostoProductoLookup) — no toda
	// transacción tiene un proveedor de por medio (ej. cobros de cliente), por eso puede no haber dato.
	let centroCostoProductoLookup = $state<Record<string, string>>({});
	function productoProveedorLabel(item: Transaccion): string {
		return (
			centroCostoProductoLookup[String(item.id_centro_costo_destino)] ??
			centroCostoProductoLookup[String(item.id_centro_costo_origen)] ??
			'—'
		);
	}

	let selectedId = $state<number | null>(null);
	let selectedDetalles = $state<TransDetalle[]>([]);

	// Selección múltiple para borrado masivo — reemplaza el tachito de basura por fila (ver
	// handleBulkDelete/AdminConfirmModal más abajo, a pedido del usuario).
	let checkedIds = $state<Set<number>>(new Set());
	const allOnPageChecked = $derived(items.length > 0 && items.every((i) => checkedIds.has(i.id_transaccion)));
	let bulkDeleteModalOpen = $state(false);
	let bulkDeleting = $state(false);

	function toggleChecked(id: number) {
		const next = new Set(checkedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		checkedIds = next;
	}

	function toggleCheckAllOnPage() {
		const next = new Set(checkedIds);
		if (allOnPageChecked) {
			for (const i of items) next.delete(i.id_transaccion);
		} else {
			for (const i of items) next.add(i.id_transaccion);
		}
		checkedIds = next;
	}

	let modalOpen = $state(false);
	let modalMode = $state<'create' | 'edit'>('create');
	let editingTransaccion = $state<Transaccion | null>(null);
	let detalleModalOpen = $state(false);
	let editingDetalle = $state<TransDetalle | null>(null);

	// Previsualización rápida del comprobante desde la lista, sin tener que abrir el formulario de
	// edición completo — mismo componente compartido que usa Ventas para contrato/proforma.
	let previewOpen = $state(false);
	let previewUrl = $state('');
	let previewTitle = $state('');
	function openComprobantePreview(item: Transaccion) {
		previewUrl = item.comprobante_url ?? '';
		previewTitle = `Comprobante - ${item.num_documento || 'Transacción'}`;
		previewOpen = true;
	}

	// Tab "Calendario" — muestra las transacciones reales (no las cuotas pendientes de
	// Panoramas de Cobro/Pago) distribuidas por fecha, ver TransaccionCalendarView.svelte.
	let vistaActiva = $state<'tablero' | 'calendario'>('tablero');
	let calendarItems = $state<Transaccion[]>([]);
	let calendarLoading = $state(false);
	let calendarCargado = $state(false);
	/** Fuerza un remonte de <TransaccionCalendarView> (ver {#key} donde se usa) cada vez que
	 * calendarItems cambia por fuera de un arrastre real (fetch inicial, guardar/eliminar una
	 * transacción, o confirmar fechas arrastradas) — mismo motivo que en Panoramas: el estado interno
	 * de drag-and-drop puede desincronizarse si el arreglo se reemplaza de un tirón desde afuera. */
	let calendarVersion = $state(0);

	async function fetchCalendarData() {
		calendarLoading = true;
		try {
			calendarItems = await getTransaccionesCalendario(supabase);
			calendarCargado = true;
			calendarVersion++;
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar las transacciones del calendario');
		} finally {
			calendarLoading = false;
		}
	}

	function abrirVistaCalendario() {
		vistaActiva = 'calendario';
		if (!calendarCargado) fetchCalendarData();
	}

	function handleVerTransaccionCalendario(t: Transaccion) {
		openEdit(t);
	}

	/** Persiste las fechas reprogramadas por drag-and-drop en la vista Calendario y actualiza
	 * calendarItems localmente para no depender de un refetch completo. */
	async function handleGuardarFechasCalendario(cambios: { id: number; fechaNueva: string }[]) {
		const result = await actualizarFechasTransacciones(supabase, cambios.map((c) => ({ id: c.id, fecha: c.fechaNueva })));
		if (!result.success) throw new Error(result.message);
		const mapa = new Map(cambios.map((c) => [c.id, c.fechaNueva]));
		calendarItems = calendarItems.map((t) => (mapa.has(t.id_transaccion) ? { ...t, fecha: mapa.get(t.id_transaccion)! } : t));
		calendarVersion++;
		toast.success('Fechas actualizadas');
	}

	async function fetchList() {
		loading = true;
		try {
			const result = await getTransacciones(supabase, { page: pageNum, pageSize: DEFAULT_PAGE_SIZE, search, sortBy, sortDir });
			items = result.items;
			total = result.total;
			totalPages = result.totalPages;
			loadError = '';
		} catch (err: any) {
			loadError = err.message || 'No se pudo cargar el listado de transacciones';
		} finally {
			loading = false;
		}
	}

	async function fetchSelectedDetalles() {
		if (!selectedId) {
			selectedDetalles = [];
			return;
		}
		try {
			selectedDetalles = await getTransDetalles(supabase, selectedId);
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudo cargar el detalle');
		}
	}

	onMount(async () => {
		if (!isAdmin()) {
			goto('/dashboard');
			return;
		}
		try {
			const [centroCostoCompleto, centroCostoProyectos, centroCostoExternosDestino, centroCostoExternosOrigen, centroCostoSoloCentros, cuentaBancoOptions, productoLookup] = await Promise.all([
				getCentroCostoOptions(supabase),
				getCentroCostoOptionsProyectos(supabase),
				getCentroCostoOptionsExternos(supabase),
				getCentroCostoOptionsExternosOrigen(supabase),
				getCentroCostoOptionsSoloCentros(supabase),
				getCuentaBancoOptions(supabase),
				getCentroCostoProductoLookup(supabase)
			]);
			centroCostoOptionsCompleto = centroCostoCompleto;
			centroCostoProductoLookup = productoLookup;
			dynamicOptions = {
				id_centro_costo_origen: centroCostoProyectos,
				id_centro_costo_destino: centroCostoProyectos,
				id_centro_costo_origen_externo: centroCostoExternosOrigen,
				id_centro_costo_destino_externo: centroCostoExternosDestino,
				id_centro_costo_destino_solo_centros: centroCostoSoloCentros,
				cuenta_banco: cuentaBancoOptions
			};
			detalleDynamicOptions = { id_partida: await getPartidaOptions(supabase) };
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar los catálogos');
		}
		await fetchList();
	});

	function onSearchInput(value: string) {
		searchInput = value;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			search = value;
			pageNum = 1;
			fetchList();
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

	function centroCostoLabel(id: number | null): string {
		if (id === null || id === undefined) return '—';
		return centroCostoLookup.get(String(id)) ?? `#${id}`;
	}

	function openCreate() {
		modalMode = 'create';
		editingTransaccion = null;
		modalOpen = true;
	}
	function openEdit(item: Transaccion) {
		modalMode = 'edit';
		editingTransaccion = item;
		modalOpen = true;
	}
	function closeModal() {
		modalOpen = false;
		editingTransaccion = null;
	}

	async function selectRow(item: Transaccion) {
		selectedId = selectedId === item.id_transaccion ? null : item.id_transaccion;
		await fetchSelectedDetalles();
	}

	const selectedTransaccion = $derived(items.find((i) => i.id_transaccion === selectedId) ?? null);

	function openBulkDeleteModal() {
		if (checkedIds.size === 0) return;
		bulkDeleteModalOpen = true;
	}
	function closeBulkDeleteModal() {
		if (bulkDeleting) return;
		bulkDeleteModalOpen = false;
	}

	/** Verifica credenciales de administrador (ver verifyAdminCredentials) y recién ahí elimina las
	 * transacciones marcadas — deleteTransaccion ya se encarga de devolver a 'programado' cualquier
	 * cobro/pago vinculado y de recalcular su cuenta (vuelve a 'pendiente'/'no pagada' si corresponde). */
	async function handleBulkDeleteConfirm(email: string, password: string) {
		const verificacion = await verifyAdminCredentials(email, password);
		if (!verificacion.success) throw new Error(verificacion.message);

		bulkDeleting = true;
		const ids = Array.from(checkedIds);
		let okCount = 0;
		const errores: string[] = [];
		try {
			for (const id of ids) {
				try {
					const result = await deleteTransaccion(supabase, id, true);
					if (result.success) {
						okCount++;
						if (selectedId === id) selectedId = null;
					} else {
						errores.push(result.message);
					}
				} catch (err: any) {
					errores.push(err?.message ?? 'Error inesperado');
				}
			}

			if (okCount > 0) toast.success(`${okCount} transacción${okCount === 1 ? '' : 'es'} eliminada${okCount === 1 ? '' : 's'} correctamente`);
			if (errores.length > 0) toast.error(`${errores.length} no se pudieron eliminar: ${errores[0]}`);

			checkedIds = new Set();
			bulkDeleteModalOpen = false;
		} finally {
			bulkDeleting = false;
			await fetchList();
			if (calendarCargado) await fetchCalendarData();
		}
	}

	async function handleDeleteDetalle(idTransDetalle: number) {
		if (!confirm('¿Eliminar esta línea de detalle?')) return;
		try {
			const result = await deleteTransDetalle(supabase, idTransDetalle);
			if (result.success) toast.success(result.message);
			else toast.error(result.message);
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		} finally {
			await fetchSelectedDetalles();
		}
	}

	function openCreateDetalle() {
		editingDetalle = null;
		detalleModalOpen = true;
	}
	function openEditDetalle(detalle: TransDetalle) {
		editingDetalle = detalle;
		detalleModalOpen = true;
	}
	function closeDetalleModal() {
		detalleModalOpen = false;
		editingDetalle = null;
	}

	async function handleSaved() {
		await fetchList();
		if (calendarCargado) await fetchCalendarData();
	}

	async function handleDetalleSaved() {
		await fetchSelectedDetalles();
	}
</script>

<div class="max-w-6xl mx-auto">
	<div class="flex items-center justify-between mb-6">
		<div class="flex items-center gap-3">
			<ArrowLeftRight class="text-[#0f3b5e]" size={28} />
			<div>
				<h1 class="text-xl font-bold text-[#0f3b5e]">Transacciones</h1>
				<p class="text-sm text-slate-500">Movimientos económicos entre centros de costo y su detalle</p>
			</div>
		</div>
		<div class="flex items-center gap-2">
			<div class="flex rounded-lg border border-slate-200 overflow-hidden">
				<button
					type="button"
					onclick={() => (vistaActiva = 'tablero')}
					class="flex items-center gap-1.5 px-3 h-[38px] text-sm font-medium {vistaActiva === 'tablero' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}"
				>
					<LayoutGrid size={14} /> Tablero
				</button>
				<button
					type="button"
					onclick={abrirVistaCalendario}
					class="flex items-center gap-1.5 px-3 h-[38px] text-sm font-medium {vistaActiva === 'calendario' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}"
				>
					<CalendarDays size={14} /> Calendario
				</button>
			</div>
			<button type="button" onclick={() => goto('/finanzas/tranzacciones/movimientos-caja')} class="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#0f3b5e] text-[#0f3b5e] text-sm font-medium hover:bg-slate-50">
				<Wallet size={16} /> Movimientos de Caja
			</button>
			<button type="button" onclick={openCreate} class="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-medium hover:bg-[#0c2f4c]">
				<Plus size={16} /> Nueva Transacción
			</button>
		</div>
	</div>

	{#if loadError}
		<div class="mb-4 bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm">{loadError}</div>
	{/if}

	{#if vistaActiva === 'calendario'}
		{#if calendarLoading && !calendarCargado}
			<div class="bg-white rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-400">Cargando calendario…</div>
		{:else}
			{#key calendarVersion}
				<TransaccionCalendarView transacciones={calendarItems} onVer={handleVerTransaccionCalendario} onGuardarFechas={handleGuardarFechasCalendario} />
			{/key}
		{/if}
	{:else}

	<div class="mb-4 flex flex-wrap items-center gap-3">
		<div class="relative flex-1 min-w-[220px] max-w-sm">
			<Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
			<input
				type="text"
				value={searchInput}
				oninput={(e) => onSearchInput((e.target as HTMLInputElement).value)}
				placeholder="Buscar por N° documento, descripción..."
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
		<div class="flex-1"></div>
		<button
			type="button"
			onclick={openBulkDeleteModal}
			disabled={checkedIds.size === 0}
			class="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
		>
			<Trash2 size={16} /> Eliminar seleccionadas{checkedIds.size > 0 ? ` (${checkedIds.size})` : ''}
		</button>
	</div>

	<div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
		{#if items.length > 0}
			<div class="flex items-center gap-3 px-4 py-2 border-b border-slate-100 bg-slate-50 text-xs text-slate-500">
				<input
					type="checkbox"
					checked={allOnPageChecked}
					onclick={(e) => e.stopPropagation()}
					onchange={toggleCheckAllOnPage}
					class="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 shrink-0"
					aria-label="Seleccionar todas las transacciones de esta página"
				/>
				Seleccionar todo en esta página
			</div>
		{/if}
		{#each items as item (item.id_transaccion)}
			<div
				class={`flex items-center gap-3 p-4 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 cursor-pointer transition-colors ${selectedId === item.id_transaccion ? 'bg-blue-50 hover:bg-blue-50' : ''}`}
				onclick={() => selectRow(item)}
			>
				<input
					type="checkbox"
					checked={checkedIds.has(item.id_transaccion)}
					onclick={(e) => e.stopPropagation()}
					onchange={() => toggleChecked(item.id_transaccion)}
					class="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 shrink-0"
					aria-label={`Seleccionar transacción ${item.num_documento || item.id_transaccion}`}
				/>
				<div class="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-slate-100 text-slate-500 flex items-center justify-center">
					{#if item.comprobante_url}
						<img
							src={item.comprobante_url}
							alt="Comprobante"
							class="w-full h-full object-cover"
							onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; (e.currentTarget as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }}
						/>
						<FileText size={18} class="hidden" />
					{:else}
						<FileText size={18} />
					{/if}
				</div>
				<div class="flex-1 min-w-0">
					<p class="font-semibold text-slate-800 truncate flex items-center gap-1.5">
						{centroCostoLabel(item.id_centro_costo_origen)} → {centroCostoLabel(item.id_centro_costo_destino)}
						{#if item.aprobado}
							<ShieldCheck size={14} class="text-emerald-600 shrink-0" title={`Aprobado por ${item.aprobado_por ?? 'un administrador'}`} />
						{/if}
					</p>
					<p class="text-xs text-slate-500 truncate">{item.num_documento || 'Sin N° documento'}</p>
					<p class="text-[11px] text-slate-400 mt-0.5">Fecha: {formatDate(item.fecha)}</p>
					<p class="text-[11px] text-slate-400 mt-0.5 truncate">
						Producto: {productoProveedorLabel(item)}
						{#if item.tipo_transaccion}· N° Cuota: {item.tipo_transaccion}{/if}
					</p>
				</div>
				<div class="text-right shrink-0">
					<p class="font-bold text-slate-800 text-sm">{formatCurrency(item.monto_total)}</p>
					<div class="flex items-center gap-1 justify-end mt-1">
						{#if item.tipo}
							<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${tipoBadgeClass[item.tipo] ?? 'bg-slate-100 text-slate-600'}`}>
								{getOptionLabel(tipoField, item.tipo)}
							</span>
						{/if}
						{#if item.estado}
							<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${estadoBadgeClass[item.estado] ?? 'bg-slate-100 text-slate-600'}`}>
								{getOptionLabel(estadoField, item.estado)}
							</span>
						{/if}
						{#if item.aprobado}
							<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700">
								<ShieldCheck size={11} /> Aprobado
							</span>
						{/if}
					</div>
				</div>
				<div class="flex items-center gap-1 shrink-0 ml-2">
					{#if item.comprobante_url}
						<button type="button" onclick={(e) => { e.stopPropagation(); openComprobantePreview(item); }} class="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600" title="Ver comprobante" aria-label="Ver comprobante">
							<Eye size={16} />
						</button>
					{/if}
					<button type="button" onclick={(e) => { e.stopPropagation(); openEdit(item); }} class="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600" title="Editar" aria-label="Editar">
						<Pencil size={16} />
					</button>
				</div>
			</div>
		{:else}
			<p class="px-4 py-10 text-center text-slate-400">{loading ? 'Cargando...' : 'No se encontraron transacciones.'}</p>
		{/each}

		<div class="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-sm text-slate-500">
			<span>{total} resultado{total === 1 ? '' : 's'} · Página {pageNum} de {totalPages}</span>
			<div class="flex items-center gap-2">
				<button type="button" onclick={() => goToPage(pageNum - 1)} disabled={pageNum <= 1} class="px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50">Anterior</button>
				<button type="button" onclick={() => goToPage(pageNum + 1)} disabled={pageNum >= totalPages} class="px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50">Siguiente</button>
			</div>
		</div>
	</div>

	{#if selectedTransaccion}
		<div class="mt-6 bg-white rounded-xl border border-slate-200 p-6">
			<div class="flex items-center justify-between mb-4">
				<div class="flex items-center gap-2">
					<ListTree class="text-amber-500" size={20} />
					<h2 class="text-lg font-semibold text-[#0f3b5e]">
						Detalle de la Transacción #{selectedTransaccion.id_transaccion}
						{#if selectedTransaccion.num_documento}— {selectedTransaccion.num_documento}{/if}
						— {formatCurrency(selectedTransaccion.monto_total)}
					</h2>
				</div>
				<button type="button" onclick={openCreateDetalle} class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600">
					<Plus size={14} /> Agregar Detalle
				</button>
			</div>

			{#if selectedDetalles.length === 0}
				<p class="text-sm text-slate-400 text-center py-6">Sin detalle registrado todavía.</p>
			{:else}
				<table class="w-full text-sm">
					<thead class="bg-slate-50 border-b border-slate-200">
						<tr>
							<th class="text-left px-3 py-2 font-semibold text-slate-600">Partida</th>
							<th class="text-left px-3 py-2 font-semibold text-slate-600">Cantidad</th>
							<th class="text-left px-3 py-2 font-semibold text-slate-600">P. Unitario</th>
							<th class="text-left px-3 py-2 font-semibold text-slate-600">Subtotal</th>
							<th class="text-right px-3 py-2 font-semibold text-slate-600">Acciones</th>
						</tr>
					</thead>
					<tbody>
						{#each selectedDetalles as detalle (detalle.id_trans_detalle)}
							<tr class="border-b border-slate-100">
								<td class="px-3 py-2">
									{detalle.id_partida
										? (detalleDynamicOptions.id_partida ?? []).find((o) => o.value === String(detalle.id_partida))?.label ?? `#${detalle.id_partida}`
										: '—'}
								</td>
								<td class="px-3 py-2">{detalle.cantidad ?? '—'}</td>
								<td class="px-3 py-2">{formatCurrency(detalle.precio_unitario)}</td>
								<td class="px-3 py-2">{formatCurrency(detalle.subtotal)}</td>
								<td class="px-3 py-2 text-right">
									<button type="button" onclick={() => openEditDetalle(detalle)} class="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600" title="Editar detalle" aria-label="Editar detalle">
										<Pencil size={16} />
									</button>
									<button type="button" onclick={() => handleDeleteDetalle(detalle.id_trans_detalle)} class="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600" title="Eliminar detalle" aria-label="Eliminar detalle">
										<Trash2 size={16} />
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
	{/if}
	{/if}
</div>

<TransaccionModal open={modalOpen} mode={modalMode} transaccion={editingTransaccion} dynamicOptions={dynamicOptions} onClose={closeModal} onSaved={handleSaved} />
<TransDetalleModal open={detalleModalOpen} idTransaccion={selectedId} detalle={editingDetalle} dynamicOptions={detalleDynamicOptions} onClose={closeDetalleModal} onSaved={handleDetalleSaved} />
<DocumentPreviewModal open={previewOpen} url={previewUrl} title={previewTitle} onClose={() => (previewOpen = false)} />
<AdminConfirmModal
	open={bulkDeleteModalOpen}
	title="Confirmar eliminación"
	message={`Vas a eliminar ${checkedIds.size} transacción${checkedIds.size === 1 ? '' : 'es'} y todo su detalle. Si alguna está vinculada a un cobro/pago, ese cobro/pago volverá a quedar pendiente. Esta acción no se puede deshacer. Ingresa el correo y la contraseña de un administrador para continuar.`}
	confirmLabel="Eliminar"
	onConfirm={handleBulkDeleteConfirm}
	onClose={closeBulkDeleteModal}
/>
