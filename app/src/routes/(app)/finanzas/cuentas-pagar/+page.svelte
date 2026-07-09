<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin, permisosState } from '$lib/stores/permisos.svelte';
	import { Plus, Pencil, Trash2, Search, ChevronUp, ChevronDown, X, Wallet, Receipt, FileText, LayoutGrid, Lock, ShieldCheck } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { getOptionLabel, formatCurrency, type FieldOption } from '$lib/shared/fieldConfig';
	import { FIELDS_CONFIG, DEFAULT_SORT_FIELD, DEFAULT_SORT_DIR, DEFAULT_PAGE_SIZE } from '$lib/modules/cuentas-pagar/config/cuentaPagar.config';
	import {
		getCuentasPagar,
		deleteCuentaPagar,
		getPagos,
		deletePago,
		getProveedorOptions,
		confirmarPagoPagado
	} from '$lib/modules/cuentas-pagar/services/cuentasPagar.service';
	import { getCentroCostoOptions } from '$lib/modules/transacciones/services/transacciones.service';
	import CuentaPagarModal from '$lib/modules/cuentas-pagar/components/CuentaPagarModal.svelte';
	import PagoModal from '$lib/modules/cuentas-pagar/components/PagoModal.svelte';
	import TransaccionModal from '$lib/modules/transacciones/components/TransaccionModal.svelte';
	import type { CuentaPagar, Pago } from '$lib/modules/cuentas-pagar/services/cuentasPagar.service';

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

	let dynamicOptions = $state<Record<string, FieldOption[]>>({ id_proveedor: [], id_centro_costo: [] });
	let transaccionDynamicOptions = $state<Record<string, FieldOption[]>>({ id_centro_costo_origen: [], id_centro_costo_destino: [] });

	let selectedId = $state<number | null>(null);
	let selectedPagos = $state<Pago[]>([]);

	let modalOpen = $state(false);
	let modalMode = $state<'create' | 'edit'>('create');
	let editingCuenta = $state<CuentaPagar | null>(null);
	let pagoModalOpen = $state(false);
	let editingPago = $state<Pago | null>(null);
	let transaccionModalOpen = $state(false);
	let transaccionPrefill = $state<Record<string, unknown> | null>(null);
	/** Pago que se está confirmando como 'pagado' vía el TransaccionModal — ver
	 * handleTransaccionSugerida/confirmarTransaccionPago. null = TransaccionModal está en su modo
	 * normal (crear una transacción suelta), no en el flujo de confirmación obligatoria. */
	let confirmandoPagoId = $state<number | null>(null);

	async function fetchList() {
		loading = true;
		try {
			const result = await getCuentasPagar(supabase, { page: pageNum, pageSize: DEFAULT_PAGE_SIZE, search, sortBy, sortDir });
			items = result.items;
			total = result.total;
			totalPages = result.totalPages;
			loadError = '';
		} catch (err: any) {
			loadError = err.message || 'No se pudo cargar el listado de cuentas por pagar';
		} finally {
			loading = false;
		}
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

	onMount(async () => {
		if (!isAdmin()) {
			goto('/dashboard');
			return;
		}
		try {
			const centroCostoOptions = await getCentroCostoOptions(supabase);
			dynamicOptions = {
				id_proveedor: await getProveedorOptions(supabase),
				id_centro_costo: centroCostoOptions
			};
			transaccionDynamicOptions = { id_centro_costo_origen: centroCostoOptions, id_centro_costo_destino: centroCostoOptions };
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar proveedores/centros de costo');
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
		return date.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
	}

	function openCreate() {
		modalMode = 'create';
		editingCuenta = null;
		modalOpen = true;
	}
	function openEdit(item: CuentaPagar) {
		modalMode = 'edit';
		editingCuenta = item;
		modalOpen = true;
	}
	function closeModal() {
		modalOpen = false;
		editingCuenta = null;
	}

	async function selectRow(item: CuentaPagar) {
		selectedId = selectedId === item.id_cuenta_pagar ? null : item.id_cuenta_pagar;
		await fetchSelectedPagos();
	}

	const selectedCuenta = $derived(items.find((i) => i.id_cuenta_pagar === selectedId) ?? null);

	async function handleDelete(item: CuentaPagar) {
		if (!confirm('¿Eliminar esta cuenta por pagar y todos sus pagos registrados? Si alguno tiene una transacción vinculada, también se eliminará. Esta acción no se puede deshacer.')) return;
		try {
			const result = await deleteCuentaPagar(supabase, item.id_cuenta_pagar, isAdmin());
			if (result.success) {
				toast.success(result.message);
				if (selectedId === item.id_cuenta_pagar) selectedId = null;
			} else {
				toast.error(result.message);
			}
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		} finally {
			await fetchList();
		}
	}

	async function handleDeletePago(idPago: number) {
		if (!confirm('¿Eliminar este pago? El saldo de la cuenta se recalculará.')) return;
		try {
			const result = await deletePago(supabase, idPago, isAdmin());
			if (result.success) toast.success(result.message);
			else toast.error(result.message);
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		} finally {
			await Promise.all([fetchList(), fetchSelectedPagos()]);
		}
	}

	function openCreatePago() {
		editingPago = null;
		pagoModalOpen = true;
	}
	function openEditPago(pago: Pago) {
		editingPago = pago;
		pagoModalOpen = true;
	}
	function closePagoModal() {
		pagoModalOpen = false;
		editingPago = null;
	}

	async function handleSaved() {
		await fetchList();
	}

	async function handlePagoSaved() {
		await Promise.all([fetchList(), fetchSelectedPagos()]);
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

	// Se pasa como onConfirm al TransaccionModal cuando está confirmando un pago (ver
	// confirmandoPagoId) — crea la transacción Y confirma el pago como 'pagado' en un solo paso
	// atómico (ver confirmarPagoPagado en cuentasPagar.service.ts). Si esto falla, el pago se queda
	// como estaba (nunca "pagado" sin transacción).
	async function confirmarTransaccionPago(payload: Record<string, unknown>) {
		const { data: userData } = await supabase.auth.getUser();
		const result = await confirmarPagoPagado(supabase, confirmandoPagoId as number, payload, userData?.user?.email ?? null, permisosState.userName || null);
		if (result.success) await Promise.all([fetchList(), fetchSelectedPagos()]);
		return result;
	}
</script>

<div class="max-w-6xl mx-auto">
	<div class="flex items-center justify-between mb-6">
		<div class="flex items-center gap-3">
			<Wallet class="text-[#0f3b5e]" size={28} />
			<div>
				<h1 class="text-xl font-bold text-[#0f3b5e]">Cuentas por Pagar</h1>
				<p class="text-sm text-slate-500">Cuentas pendientes con proveedores y sus pagos registrados</p>
			</div>
		</div>
		<div class="flex items-center gap-2">
			<button type="button" onclick={() => goto('/finanzas/cuentas-pagar/panoramas')} class="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#0f3b5e] text-[#0f3b5e] text-sm font-medium hover:bg-slate-50">
				<LayoutGrid size={16} /> Ver Panoramas de Pago
			</button>
			<button type="button" onclick={openCreate} class="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-medium hover:bg-[#0c2f4c]">
				<Plus size={16} /> Nueva Cuenta
			</button>
		</div>
	</div>

	{#if loadError}
		<div class="mb-4 bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm">{loadError}</div>
	{/if}

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
		{#each items as item (item.id_cuenta_pagar)}
			<div
				class={`flex items-center gap-3 p-4 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 cursor-pointer transition-colors ${
					selectedId === item.id_cuenta_pagar ? 'bg-blue-50 hover:bg-blue-50' : (estadoCardClass[item.estado] ?? '')
				}`}
				onclick={() => selectRow(item)}
			>
				<div class={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${estadoIconClass[item.estado] ?? 'bg-slate-100 text-slate-500'}`}>
					<FileText size={18} />
				</div>
				<div class="flex-1 min-w-0">
					<p class="font-semibold text-slate-800 truncate">{item.proveedor?.razon_social ?? 'Sin proveedor'}</p>
					<p class="text-xs text-slate-500 truncate">{item.num_documento || 'Sin N° documento'}</p>
					<p class="text-[11px] text-slate-400 mt-0.5">Vencimiento: {formatDate(item.fecha_vencimiento)}</p>
				</div>
				<div class="text-right shrink-0">
					<p class="font-bold text-slate-800 text-sm">{formatCurrency(item.monto_comprometido)}</p>
					<span class={`inline-block mt-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${estadoBadgeClass[item.estado] ?? 'bg-slate-100 text-slate-600'}`}>
						{getOptionLabel(estadoField, item.estado)}
					</span>
				</div>
				<div class="flex items-center gap-1 shrink-0 ml-2">
					<button type="button" onclick={(e) => { e.stopPropagation(); openEdit(item); }} class="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600" title="Editar" aria-label="Editar">
						<Pencil size={16} />
					</button>
					<button type="button" onclick={(e) => { e.stopPropagation(); handleDelete(item); }} class="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600" title="Eliminar" aria-label="Eliminar">
						<Trash2 size={16} />
					</button>
				</div>
			</div>
		{:else}
			<p class="px-4 py-10 text-center text-slate-400">{loading ? 'Cargando...' : 'No se encontraron cuentas por pagar.'}</p>
		{/each}

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
						Pagos a {selectedCuenta.proveedor?.razon_social ?? 'la cuenta'} — {formatCurrency(selectedCuenta.monto_comprometido)}
						(saldo: {formatCurrency(selectedCuenta.saldo_pendiente)})
					</h2>
				</div>
				<button type="button" onclick={openCreatePago} class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600">
					<Plus size={14} /> Registrar Pago
				</button>
			</div>

			{#if selectedPagos.length === 0}
				<p class="text-sm text-slate-400 text-center py-6">Sin pagos registrados todavía.</p>
			{:else}
				<table class="w-full text-sm">
					<thead class="bg-slate-50 border-b border-slate-200">
						<tr>
							<th class="text-left px-3 py-2 font-semibold text-slate-600">Fecha</th>
							<th class="text-left px-3 py-2 font-semibold text-slate-600">Monto</th>
							<th class="text-left px-3 py-2 font-semibold text-slate-600">Medio</th>
							<th class="text-left px-3 py-2 font-semibold text-slate-600">N° Operación</th>
							<th class="text-left px-3 py-2 font-semibold text-slate-600">Estado</th>
							<th class="text-right px-3 py-2 font-semibold text-slate-600">Acciones</th>
						</tr>
					</thead>
					<tbody>
						{#each selectedPagos as pago (pago.id_pago)}
							{@const bloqueado = !!pago.transaccion?.aprobado && !isAdmin()}
							<tr
								class={`border-b border-slate-100 ${pago.estado_pago === 'programado' && !bloqueado ? 'cursor-pointer hover:bg-slate-50' : ''}`}
								ondblclick={() => pago.estado_pago === 'programado' && !bloqueado && openEditPago(pago)}
								title={pago.estado_pago === 'programado' && !bloqueado ? 'Doble clic para editar/cancelar esta cuota' : undefined}
							>
								<td class="px-3 py-2">{formatDate(pago.fecha_pago)}</td>
								<td class="px-3 py-2">{formatCurrency(pago.monto)}</td>
								<td class="px-3 py-2">{pago.medio_pago ?? '—'}</td>
								<td class="px-3 py-2">{pago.num_operacion ?? '—'}</td>
								<td class="px-3 py-2">
									<div class="flex items-center gap-1.5">
										{#if pago.estado_pago === 'programado'}
											<span class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-700">Programado</span>
										{:else if pago.estado_pago === 'cancelado'}
											<span class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-200 text-slate-600">Anulado</span>
										{:else}
											<span class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700">Pagado</span>
										{/if}
										{#if pago.transaccion?.aprobado}
											<ShieldCheck size={13} class="text-emerald-600" title={`Transacción aprobada por ${pago.transaccion.aprobado_por ?? 'un administrador'}`} />
										{/if}
									</div>
								</td>
								<td class="px-3 py-2 text-right">
									{#if bloqueado}
										<span class="p-1.5 text-slate-300 inline-flex" title="Bloqueado: transacción aprobada, solo un administrador puede editar/eliminar">
											<Lock size={16} />
										</span>
									{:else}
										{#if pago.estado_pago === 'programado'}
											<button type="button" onclick={() => openEditPago(pago)} class="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600" title="Editar cuota" aria-label="Editar cuota">
												<Pencil size={16} />
											</button>
										{/if}
										<button type="button" onclick={() => handleDeletePago(pago.id_pago)} class="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600" title="Eliminar pago" aria-label="Eliminar pago">
											<Trash2 size={16} />
										</button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
	{/if}
</div>

<CuentaPagarModal open={modalOpen} mode={modalMode} cuenta={editingCuenta} dynamicOptions={dynamicOptions} onClose={closeModal} onSaved={handleSaved} />
<PagoModal
	open={pagoModalOpen}
	idCuentaPagar={selectedId}
	pago={editingPago}
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
/>
