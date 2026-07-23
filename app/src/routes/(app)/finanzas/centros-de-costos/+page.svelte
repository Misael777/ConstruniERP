<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin } from '$lib/stores/permisos.svelte';
	import { Plus, Pencil, Trash2, Ban, Search, ChevronUp, ChevronDown, X, Building2 } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import {
		FIELDS_CONFIG,
		DEFAULT_SORT_FIELD,
		DEFAULT_SORT_DIR,
		DEFAULT_PAGE_SIZE,
		DELETE_STRATEGY,
		getOptionLabel,
		formatCurrency
	} from '$lib/modules/centro-costos/config/centroCostos.config';
	import { getCentroCostos, deleteCentroCosto } from '$lib/modules/centro-costos/services/centroCostos.service';
	import CentroCostoModal from '$lib/modules/centro-costos/components/CentroCostoModal.svelte';
	import type { CentroCosto } from '$lib/modules/centro-costos/services/centroCostos.service';
	import ResponsiveDataView from '$lib/shared/components/ResponsiveDataView.svelte';

	// Módulo 100% client-side (habla directo con Supabase vía la anon key) para funcionar en
	// cualquier plataforma empaquetada con Tauri (Windows, Android) sin necesitar un servidor
	// SvelteKit embebido. AJUSTAR: hoy la seguridad depende únicamente del guard de UI de abajo
	// (isAdmin()) — la BD no tiene políticas RLS reales todavía, así que cualquiera con la anon
	// key puede leer/escribir esta tabla sin pasar por esta pantalla. Agregar RLS es tarea aparte.

	const tableFields = FIELDS_CONFIG.filter((f) => f.showInTable);
	const deleteLabel = DELETE_STRATEGY === 'soft' ? 'Anular' : 'Eliminar';
	const deleteConfirmMessage =
		DELETE_STRATEGY === 'soft'
			? '¿Anular este centro de costo? Podrás revertirlo desde la base de datos si fue un error.'
			: '¿Eliminar este centro de costo de forma permanente? Esta acción no se puede deshacer.';

	// El submódulo tiene dos vistas sobre la MISMA tabla centro_costo, separadas por si la fila
	// está vinculada a una entidad (proyecto/cliente/proveedor/empleado, ver centroCostos.service.ts):
	// "centros" = creadas a mano desde este submódulo (sin vínculo), "cuentas" = generadas solas al
	// crear esa entidad. Cambiar de tab reconsulta con un `vinculado` distinto, no filtra en memoria.
	let activeTab = $state<'centros' | 'cuentas'>('centros');

	let items = $state<CentroCosto[]>([]);
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

	let modalOpen = $state(false);
	let modalMode = $state<'create' | 'edit'>('create');
	let editingCentro = $state<CentroCosto | null>(null);

	async function fetchList() {
		loading = true;
		try {
			const result = await getCentroCostos(supabase, {
				page: pageNum,
				pageSize: DEFAULT_PAGE_SIZE,
				search,
				sortBy,
				sortDir,
				vinculado: activeTab === 'cuentas'
			});
			items = result.items;
			total = result.total;
			totalPages = result.totalPages;
			loadError = '';
		} catch (err: any) {
			loadError = err.message || 'No se pudo cargar el listado de centros de costo';
		} finally {
			loading = false;
		}
	}

	function switchTab(tab: 'centros' | 'cuentas') {
		if (activeTab === tab) return;
		activeTab = tab;
		pageNum = 1;
		fetchList();
	}

	onMount(() => {
		if (!isAdmin()) {
			goto('/dashboard');
			return;
		}
		fetchList();
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

	function cellValue(field: (typeof tableFields)[number], item: CentroCosto) {
		const raw = (item as any)[field.key];
		if (field.tipo === 'select') return getOptionLabel(field, raw);
		if (field.tipo === 'currency') return formatCurrency(raw);
		if (field.key === 'created_at') return formatDate(raw);
		return raw ?? '—';
	}

	function openCreate() {
		modalMode = 'create';
		editingCentro = null;
		modalOpen = true;
	}

	function openEdit(item: CentroCosto) {
		modalMode = 'edit';
		editingCentro = item;
		modalOpen = true;
	}

	function closeModal() {
		modalOpen = false;
		editingCentro = null;
	}

	let emptyMessage = $derived(
		loading
			? 'Cargando...'
			: activeTab === 'centros'
				? 'No se encontraron centros de costo.'
				: 'No se encontraron cuentas internas.'
	);

	async function handleDelete(item: CentroCosto) {
		if (!confirm(deleteConfirmMessage)) return;

		try {
			const result = await deleteCentroCosto(supabase, item.id_centro_costo);
			if (result.success) toast.success(result.message);
			else toast.error(result.message);
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		} finally {
			await fetchList();
		}
	}
</script>

<div class="max-w-6xl mx-auto">
	<!-- Header -->
	<div class="flex items-center justify-between mb-6">
		<div class="flex items-center gap-3">
			<Building2 class="text-[#0f3b5e]" size={28} />
			<div>
				<h1 class="text-xl font-bold text-[#0f3b5e]">Centro de Costos y Cuentas Internas</h1>
				<p class="text-sm text-slate-500">
					{activeTab === 'centros'
						? 'Centros de costo creados manualmente, sin vínculo a ninguna entidad'
						: 'Cuentas generadas automáticamente al crear un proyecto, cliente, proveedor o empleado'}
				</p>
			</div>
		</div>
		{#if activeTab === 'centros'}
			<button
				type="button"
				onclick={openCreate}
				class="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-medium hover:bg-[#0c2f4c]"
			>
				<Plus size={16} /> Nuevo Centro de Costo
			</button>
		{/if}
	</div>

	<!-- Tabs -->
	<div class="mb-4 flex gap-1 border-b border-slate-200">
		<button
			type="button"
			onclick={() => switchTab('centros')}
			class={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
				activeTab === 'centros'
					? 'border-[#0f3b5e] text-[#0f3b5e]'
					: 'border-transparent text-slate-500 hover:text-slate-700'
			}`}
		>
			Centros de Costos
		</button>
		<button
			type="button"
			onclick={() => switchTab('cuentas')}
			class={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
				activeTab === 'cuentas'
					? 'border-[#0f3b5e] text-[#0f3b5e]'
					: 'border-transparent text-slate-500 hover:text-slate-700'
			}`}
		>
			Cuentas Internas
		</button>
	</div>

	{#if loadError}
		<div class="mb-4 flex items-center justify-between bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm">
			<span>{loadError}</span>
		</div>
	{/if}

	<!-- Search -->
	<div class="mb-4 relative max-w-sm">
		<Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
		<input
			type="text"
			value={searchInput}
			oninput={(e) => onSearchInput((e.target as HTMLInputElement).value)}
			placeholder="Buscar por código o nombre..."
			class="w-full pl-9 pr-8 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
		/>
		{#if searchInput}
			<button
				type="button"
				onclick={() => onSearchInput('')}
				class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
				aria-label="Limpiar búsqueda"
			>
				<X size={14} />
			</button>
		{/if}
	</div>

	<!-- Table / Cards -->
	<div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
		<div class="overflow-x-auto">
			<ResponsiveDataView items={loading ? [] : items} keyField="id_centro_costo" colspan={tableFields.length + 1} {emptyMessage}>
				{#snippet header()}
					{#each tableFields as field}
						<th class="text-left px-4 py-3 font-semibold text-slate-600">
							<button
								type="button"
								onclick={() => toggleSort(field.key, field.sortable)}
								class={`flex items-center gap-1 ${field.sortable ? 'cursor-pointer hover:text-[#0f3b5e]' : 'cursor-default'}`}
							>
								{field.label}
								{#if field.sortable && sortBy === field.key}
									{#if sortDir === 'asc'}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
								{/if}
							</button>
						</th>
					{/each}
					<th class="text-right px-4 py-3 font-semibold text-slate-600">Acciones</th>
				{/snippet}
				{#snippet row(item)}
					{@const isLinked = !!(item.id_proyecto || item.id_cliente || item.id_proveedor || item.id_empleado)}
					{#each tableFields as field}
						<td class="px-4 py-3 text-slate-700">{cellValue(field, item)}</td>
					{/each}
					<td class="px-4 py-3">
						<div class="flex items-center justify-end gap-2">
							<button
								type="button"
								onclick={() => openEdit(item)}
								class="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600"
								title="Editar"
								aria-label="Editar"
							>
								<Pencil size={16} />
							</button>
							<button
								type="button"
								onclick={() => handleDelete(item)}
								disabled={isLinked}
								class="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-500 disabled:cursor-not-allowed"
								title={isLinked ? 'Vinculado a una entidad — elimínala a ella, no este centro de costo' : deleteLabel}
								aria-label={isLinked ? 'No se puede eliminar: vinculado a una entidad' : deleteLabel}
							>
								{#if DELETE_STRATEGY === 'soft'}
									<Ban size={16} />
								{:else}
									<Trash2 size={16} />
								{/if}
							</button>
						</div>
					</td>
				{/snippet}
				{#snippet card(item)}
					{@const isLinked = !!(item.id_proyecto || item.id_cliente || item.id_proveedor || item.id_empleado)}
					<div class="flex items-start justify-between gap-3 mb-2">
						<div class="min-w-0">
							<div class="font-semibold text-slate-800 truncate">{item.nombre}</div>
							<div class="text-xs text-slate-500 mt-0.5">{item.codigo}</div>
						</div>
						<div class="text-right shrink-0">
							<div class="font-bold text-slate-800">{formatCurrency(item.monto_actual)}</div>
							<div class="text-[11px] text-slate-400">{formatDate(item.created_at)}</div>
						</div>
					</div>
					<div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-500 mb-3">
						<span class="text-slate-400">Tipo</span>
						<span class="text-right text-slate-700">{getOptionLabel(FIELDS_CONFIG.find((f) => f.key === 'tipo')!, item.tipo)}</span>
					</div>
					<div class="flex items-center gap-2 pt-2 border-t border-slate-100">
						<button
							type="button"
							onclick={() => openEdit(item)}
							class="flex-1 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center gap-2 text-xs font-medium active:bg-blue-100"
							aria-label="Editar"
						>
							<Pencil size={14} /> Editar
						</button>
						<button
							type="button"
							onclick={() => handleDelete(item)}
							disabled={isLinked}
							class="flex-1 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center gap-2 text-xs font-medium active:bg-red-100 disabled:opacity-30 disabled:active:bg-red-50"
							aria-label={isLinked ? 'No se puede eliminar: vinculado a una entidad' : deleteLabel}
						>
							{#if DELETE_STRATEGY === 'soft'}
								<Ban size={14} />
							{:else}
								<Trash2 size={14} />
							{/if}
							{deleteLabel}
						</button>
					</div>
				{/snippet}
			</ResponsiveDataView>
		</div>

		<!-- Pagination -->
		<div class="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-sm text-slate-500">
			<span>
				{total} resultado{total === 1 ? '' : 's'} · Página {pageNum} de {totalPages}
			</span>
			<div class="flex items-center gap-2">
				<button
					type="button"
					onclick={() => goToPage(pageNum - 1)}
					disabled={pageNum <= 1}
					class="px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50"
				>
					Anterior
				</button>
				<button
					type="button"
					onclick={() => goToPage(pageNum + 1)}
					disabled={pageNum >= totalPages}
					class="px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50"
				>
					Siguiente
				</button>
			</div>
		</div>
	</div>
</div>

<CentroCostoModal open={modalOpen} mode={modalMode} centro={editingCentro} onClose={closeModal} onSaved={fetchList} />
