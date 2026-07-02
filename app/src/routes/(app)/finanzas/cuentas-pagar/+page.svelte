<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { Plus, Pencil, Trash2, Search, ChevronUp, ChevronDown, ChevronsUpDown, X, Wallet, Receipt } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { resolveApiUrl } from '$lib/apiClient';
	import { getOptionLabel, formatCurrency } from '$lib/shared/fieldConfig';
	import { FIELDS_CONFIG, PK_COLUMN, DEFAULT_SORT_FIELD, DEFAULT_SORT_DIR } from '$lib/modules/cuentas-pagar/config/cuentaPagar.config';
	import { PK_COLUMN as PAGO_PK } from '$lib/modules/cuentas-pagar/config/pago.config';
	import CuentaPagarModal from '$lib/modules/cuentas-pagar/components/CuentaPagarModal.svelte';
	import PagoModal from '$lib/modules/cuentas-pagar/components/PagoModal.svelte';
	import type { CuentaPagar } from '$lib/modules/cuentas-pagar/services/cuentasPagar.service';

	let { data } = $props();

	const tableFields = FIELDS_CONFIG.filter((f) => f.showInTable);

	let modalOpen = $state(false);
	let modalMode = $state<'create' | 'edit'>('create');
	let editingCuenta = $state<CuentaPagar | null>(null);
	let pagoModalOpen = $state(false);

	let searchInput = $state(data.search ?? '');
	let debounceTimer: ReturnType<typeof setTimeout>;

	$effect(() => {
		searchInput = data.search ?? '';
	});

	function updateQuery(updates: Record<string, string | null>) {
		const params = new URLSearchParams(page.url.search);
		for (const [key, value] of Object.entries(updates)) {
			if (value === null || value === '') params.delete(key);
			else params.set(key, value);
		}
		goto(`?${params.toString()}`, { keepFocus: true, noScroll: true });
	}

	function onSearchInput(value: string) {
		searchInput = value;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => updateQuery({ q: value || null, page: '1' }), 400);
	}

	function currentSortField() {
		return data.sortBy || DEFAULT_SORT_FIELD;
	}
	function currentSortDir() {
		return data.sortDir || DEFAULT_SORT_DIR;
	}
	function toggleSort(fieldKey: string, sortable?: boolean) {
		if (!sortable) return;
		const isCurrent = currentSortField() === fieldKey;
		const nextDir = isCurrent && currentSortDir() === 'asc' ? 'desc' : 'asc';
		updateQuery({ sort: fieldKey, dir: nextDir, page: '1' });
	}
	function goToPage(p: number) {
		if (p < 1 || p > data.totalPages) return;
		updateQuery({ page: String(p) });
	}

	function formatDate(value: string | null | undefined) {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '—';
		return date.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
	}

	function cellValue(field: (typeof tableFields)[number], item: CuentaPagar) {
		if (field.key === 'id_proveedor') return (item.proveedor?.razon_social ?? '—') as string;
		const raw = (item as any)[field.key];
		if (field.tipo === 'select') return getOptionLabel(field, raw, data.dynamicOptions);
		if (field.tipo === 'currency') return formatCurrency(raw);
		if (field.tipo === 'date' || field.key === 'created_at') return formatDate(raw);
		return raw ?? '—';
	}

	const estadoBadgeClass: Record<string, string> = {
		pendiente: 'bg-amber-100 text-amber-700',
		pagado: 'bg-emerald-100 text-emerald-700',
		vencido: 'bg-red-100 text-red-700'
	};

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

	function selectRow(item: CuentaPagar) {
		updateQuery({ selected: data.selectedId === item.id_cuenta_pagar ? null : String(item.id_cuenta_pagar) });
	}

	const selectedCuenta = $derived(data.items.find((i: CuentaPagar) => i.id_cuenta_pagar === data.selectedId) ?? null);

	async function handleDelete(item: CuentaPagar) {
		if (!confirm('¿Eliminar esta cuenta por pagar y todos sus pagos registrados? Esta acción no se puede deshacer.')) return;
		try {
			const response = await fetch(resolveApiUrl('/api/cuentas-pagar/delete'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ [PK_COLUMN]: item.id_cuenta_pagar })
			});
			const result = await response.json();
			if (result.success) toast.success(result.message ?? 'Eliminado con éxito');
			else toast.error(result.message ?? 'Ocurrió un error');
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		} finally {
			await invalidateAll();
		}
	}

	async function handleDeletePago(idPago: number) {
		if (!confirm('¿Eliminar este pago? El saldo de la cuenta se recalculará.')) return;
		try {
			const response = await fetch(resolveApiUrl('/api/cuentas-pagar/pagos/delete'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ [PAGO_PK]: idPago })
			});
			const result = await response.json();
			if (result.success) toast.success(result.message ?? 'Pago eliminado');
			else toast.error(result.message ?? 'Ocurrió un error');
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		} finally {
			await invalidateAll();
		}
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
		<button type="button" onclick={openCreate} class="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-medium hover:bg-[#0c2f4c]">
			<Plus size={16} /> Nueva Cuenta
		</button>
	</div>

	{#if data.loadError}
		<div class="mb-4 bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm">{data.loadError}</div>
	{/if}

	<div class="mb-4 relative max-w-sm">
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

	<div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead class="bg-slate-50 border-b border-slate-200">
					<tr>
						{#each tableFields as field}
							<th class="text-left px-4 py-3 font-semibold text-slate-600">
								<button type="button" onclick={() => toggleSort(field.key, field.sortable)} class={`flex items-center gap-1 ${field.sortable ? 'cursor-pointer hover:text-[#0f3b5e]' : 'cursor-default'}`}>
									{field.label}
									{#if field.sortable}
										{#if currentSortField() === field.key}
											{#if currentSortDir() === 'asc'}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
										{:else}
											<ChevronsUpDown size={14} class="opacity-30" />
										{/if}
									{/if}
								</button>
							</th>
						{/each}
						<th class="text-right px-4 py-3 font-semibold text-slate-600">Acciones</th>
					</tr>
				</thead>
				<tbody>
					{#each data.items as item (item.id_cuenta_pagar)}
						<tr class={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${data.selectedId === item.id_cuenta_pagar ? 'bg-blue-50' : ''}`} onclick={() => selectRow(item)}>
							{#each tableFields as field}
								<td class="px-4 py-3 text-slate-700">
									{#if field.key === 'estado'}
										<span class={`px-2 py-0.5 rounded-full text-xs font-medium ${estadoBadgeClass[item.estado] ?? 'bg-slate-100 text-slate-600'}`}>
											{getOptionLabel(field, item.estado)}
										</span>
									{:else}
										{cellValue(field, item)}
									{/if}
								</td>
							{/each}
							<td class="px-4 py-3">
								<div class="flex items-center justify-end gap-2">
									<button type="button" onclick={(e) => { e.stopPropagation(); openEdit(item); }} class="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600" title="Editar" aria-label="Editar">
										<Pencil size={16} />
									</button>
									<button type="button" onclick={(e) => { e.stopPropagation(); handleDelete(item); }} class="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600" title="Eliminar" aria-label="Eliminar">
										<Trash2 size={16} />
									</button>
								</div>
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan={tableFields.length + 1} class="px-4 py-10 text-center text-slate-400">No se encontraron cuentas por pagar.</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-sm text-slate-500">
			<span>{data.total} resultado{data.total === 1 ? '' : 's'} · Página {data.page} de {data.totalPages}</span>
			<div class="flex items-center gap-2">
				<button type="button" onclick={() => goToPage(data.page - 1)} disabled={data.page <= 1} class="px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50">Anterior</button>
				<button type="button" onclick={() => goToPage(data.page + 1)} disabled={data.page >= data.totalPages} class="px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50">Siguiente</button>
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
				<button type="button" onclick={() => (pagoModalOpen = true)} class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600">
					<Plus size={14} /> Registrar Pago
				</button>
			</div>

			{#if data.selectedPagos.length === 0}
				<p class="text-sm text-slate-400 text-center py-6">Sin pagos registrados todavía.</p>
			{:else}
				<table class="w-full text-sm">
					<thead class="bg-slate-50 border-b border-slate-200">
						<tr>
							<th class="text-left px-3 py-2 font-semibold text-slate-600">Fecha</th>
							<th class="text-left px-3 py-2 font-semibold text-slate-600">Monto</th>
							<th class="text-left px-3 py-2 font-semibold text-slate-600">Medio</th>
							<th class="text-left px-3 py-2 font-semibold text-slate-600">N° Operación</th>
							<th class="text-right px-3 py-2 font-semibold text-slate-600">Acciones</th>
						</tr>
					</thead>
					<tbody>
						{#each data.selectedPagos as pago (pago.id_pago)}
							<tr class="border-b border-slate-100">
								<td class="px-3 py-2">{formatDate(pago.fecha_pago)}</td>
								<td class="px-3 py-2">{formatCurrency(pago.monto)}</td>
								<td class="px-3 py-2">{pago.medio_pago ?? '—'}</td>
								<td class="px-3 py-2">{pago.num_operacion ?? '—'}</td>
								<td class="px-3 py-2 text-right">
									<button type="button" onclick={() => handleDeletePago(pago.id_pago)} class="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600" title="Eliminar pago" aria-label="Eliminar pago">
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
</div>

<CuentaPagarModal open={modalOpen} mode={modalMode} cuenta={editingCuenta} dynamicOptions={data.dynamicOptions} onClose={closeModal} />
<PagoModal open={pagoModalOpen} idCuentaPagar={data.selectedId} onClose={() => (pagoModalOpen = false)} />
