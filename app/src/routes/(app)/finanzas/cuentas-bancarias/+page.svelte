<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin } from '$lib/stores/permisos.svelte';
	import { toast } from '$lib/stores/toast';
	import { describeError } from '$lib/shared/describeError';
	import { verifyAdminCredentials } from '$lib/shared/adminAuth';
	import { Landmark, Plus, Pencil, Trash2, Trash, RotateCcw, ChevronLeft, Search, ChevronUp, ChevronDown, X } from '@lucide/svelte';
	import { getOptionLabel } from '$lib/shared/fieldConfig';
	import { FIELDS_CONFIG, DEFAULT_SORT_FIELD, DEFAULT_SORT_DIR, DEFAULT_PAGE_SIZE } from '$lib/modules/cuentas-bancarias/config/cuentaBanco.config';
	import {
		getCuentasBanco,
		deleteCuentaBanco,
		darDeBajaCuentaBanco,
		restaurarCuentaBanco,
		type CuentaBanco
	} from '$lib/modules/cuentas-bancarias/services/cuentaBanco.service';
	import CuentaBancoModal from '$lib/modules/cuentas-bancarias/components/CuentaBancoModal.svelte';
	import ConfirmModal from '$lib/shared/components/ConfirmModal.svelte';
	import AdminConfirmModal from '$lib/shared/components/AdminConfirmModal.svelte';

	// Módulo 100% client-side (Supabase anon key) para funcionar en Tauri Windows/Android sin
	// servidor embebido — ver nota de seguridad en centro-costos/+page.svelte: la BD todavía no
	// tiene RLS real, este guard (isAdmin()) es solo de UI. Autorización de cuentas bancarias es un
	// dato sensible (números de cuenta/tarjeta), se restringe a administradores igual que Cuentas por
	// Cobrar/Pagar.

	const tableFields = FIELDS_CONFIG.filter((f) => f.showInTable);
	const estadoField = FIELDS_CONFIG.find((f) => f.key === 'estado')!;
	const tipoCuentaField = FIELDS_CONFIG.find((f) => f.key === 'tipo_cuenta')!;
	const tipoMonedaField = FIELDS_CONFIG.find((f) => f.key === 'tipo_moneda')!;
	const estadoBadgeClass: Record<string, string> = {
		activa: 'bg-blue-100 text-blue-700',
		inactiva: 'bg-slate-200 text-slate-600',
		autorizada: 'bg-emerald-100 text-emerald-700',
		no_autorizada: 'bg-red-100 text-red-700'
	};

	let items = $state<CuentaBanco[]>([]);
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
	let editingItem = $state<CuentaBanco | null>(null);

	// A pedido del usuario: las cuentas bancarias dadas de baja dejan de listarse por defecto — solo
	// un admin puede activar "Ver eliminados" (mismo patrón que el resto de los módulos, ver skill
	// dar-de-baja-pattern). La página entera ya es admin-only (ver el guard en onMount), así que el
	// toggle no necesita un chequeo isAdmin() adicional.
	let verEliminados = $state(false);
	function toggleVerEliminados() {
		verEliminados = !verEliminados;
		pageNum = 1;
		fetchList();
	}

	async function fetchList() {
		loading = true;
		try {
			const result = await getCuentasBanco(supabase, { page: pageNum, pageSize: DEFAULT_PAGE_SIZE, search, sortBy, sortDir, soloEliminados: verEliminados });
			items = result.items;
			total = result.total;
			totalPages = result.totalPages;
			loadError = '';
		} catch (err: any) {
			loadError = err.message || 'No se pudo cargar el listado de cuentas bancarias';
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		if (!isAdmin()) {
			goto('/dashboard');
			return;
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

	function openCreate() {
		modalMode = 'create';
		editingItem = null;
		modalOpen = true;
	}
	function openEdit(item: CuentaBanco) {
		modalMode = 'edit';
		editingItem = item;
		modalOpen = true;
	}
	function closeModal() {
		modalOpen = false;
		editingItem = null;
	}

	// A pedido del usuario: "Eliminar" pasa a ser un dar-de-baja reversible, sin contraseña — mismo
	// patrón que el resto de los módulos. El borrado PERMANENTE de verdad (deleteCuentaBanco) se mueve
	// a la sección "Eliminados" (solo-admin), siempre con contraseña.
	let confirmDarDeBajaOpen = $state(false);
	let cuentaParaDarDeBaja = $state<CuentaBanco | null>(null);

	function handleDelete(item: CuentaBanco) {
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
			const result = await darDeBajaCuentaBanco(supabase, cuentaParaDarDeBaja.id_cuenta_banco);
			if (result.success) toast.success(result.message ?? 'Cuenta bancaria dada de baja correctamente.');
			else toast.error(result.message ?? 'No se pudo dar de baja la cuenta bancaria.');
		} catch (err: any) {
			toast.error(`No se pudo dar de baja la cuenta bancaria. ${describeError(err)}`);
		} finally {
			closeConfirmDarDeBaja();
			await fetchList();
		}
	}

	// ── Sección "Eliminados": restaurar (sin contraseña) y borrado permanente (SIEMPRE con contraseña
	// de admin, sin excepción). ──

	let confirmRestaurarOpen = $state(false);
	let cuentaParaRestaurar = $state<CuentaBanco | null>(null);

	function handleRestaurar(item: CuentaBanco) {
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
			const result = await restaurarCuentaBanco(supabase, cuentaParaRestaurar.id_cuenta_banco);
			if (result.success) {
				toast.success(result.message ?? 'Cuenta bancaria restaurada correctamente.');
				await fetchList();
			} else {
				toast.error(result.message ?? 'No se pudo restaurar la cuenta bancaria.');
			}
		} catch (err: any) {
			toast.error(`No se pudo restaurar la cuenta bancaria. ${describeError(err)}`);
		} finally {
			closeConfirmRestaurar();
		}
	}

	let confirmEliminarPermanenteOpen = $state(false);
	let cuentaParaEliminarPermanente = $state<CuentaBanco | null>(null);
	let eliminandoPermanente = $state(false);

	function handleEliminarPermanente(item: CuentaBanco) {
		cuentaParaEliminarPermanente = item;
		confirmEliminarPermanenteOpen = true;
	}
	function closeConfirmEliminarPermanente() {
		if (eliminandoPermanente) return;
		confirmEliminarPermanenteOpen = false;
		cuentaParaEliminarPermanente = null;
	}

	/** Igual patrón que el borrado masivo de Transacciones: verifyAdminCredentials re-autentica de
	 * verdad contra Supabase Auth antes de ejecutar deleteCuentaBanco (borrado real). */
	async function confirmarEliminarPermanente(email: string, password: string) {
		if (!cuentaParaEliminarPermanente) return;
		const verificacion = await verifyAdminCredentials(email, password);
		if (!verificacion.success) throw new Error(verificacion.message);

		eliminandoPermanente = true;
		try {
			const result = await deleteCuentaBanco(supabase, cuentaParaEliminarPermanente.id_cuenta_banco);
			if (result.success) {
				toast.success(result.message ?? 'Cuenta bancaria eliminada permanentemente.');
				confirmEliminarPermanenteOpen = false;
				cuentaParaEliminarPermanente = null;
				await fetchList();
			} else {
				throw new Error(result.message || 'No se pudo eliminar la cuenta bancaria.');
			}
		} finally {
			eliminandoPermanente = false;
		}
	}

	async function handleSaved() {
		await fetchList();
	}
</script>

<div class="max-w-5xl mx-auto">
	<div class="flex items-center justify-between mb-6 flex-wrap gap-3">
		<div class="flex items-center gap-3">
			<Landmark class="text-[#0f3b5e]" size={28} />
			<div>
				<h1 class="text-xl font-bold text-[#0f3b5e]">{verEliminados ? 'Cuentas bancarias eliminadas' : 'Cuentas Bancarias'}</h1>
				<p class="text-sm text-slate-500">
					{verEliminados
						? 'Cuentas dadas de baja — restauralas o elimínalas de la base de datos permanentemente.'
						: 'Autorización de cuentas bancarias usadas en los movimientos.'}
				</p>
			</div>
		</div>
		<div class="flex items-center gap-2">
			<button type="button" onclick={toggleVerEliminados} class={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${verEliminados ? 'bg-slate-800 text-white hover:bg-slate-900' : 'border border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
				{#if verEliminados}<ChevronLeft size={16} />{:else}<Trash2 size={16} />{/if}
				{verEliminados ? 'Volver' : 'Ver eliminados'}
			</button>
			{#if !verEliminados}
				<button type="button" onclick={openCreate} class="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-medium hover:bg-[#0c2f4c]">
					<Plus size={16} /> Nueva Cuenta Bancaria
				</button>
			{/if}
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
				placeholder="Buscar por N° de cuenta, titular, banco..."
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
		{#each items as item (item.id_cuenta_banco)}
			<div class="flex items-center gap-3 p-4 border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
				<div class="w-10 h-10 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
					<Landmark size={18} />
				</div>
				<div class="flex-1 min-w-0">
					<p class="font-semibold text-slate-800 truncate">{item.nombre_banco} — {item.numero_cuenta}</p>
					<p class="text-xs text-slate-500 truncate">Titular: {item.titular_cuenta} · {getOptionLabel(tipoCuentaField, item.tipo_cuenta)} · {getOptionLabel(tipoMonedaField, item.tipo_moneda)}</p>
					{#if item.cci_cuenta}<p class="text-[11px] text-slate-400">CCI: {item.cci_cuenta}</p>{/if}
				</div>
				<div class="text-right shrink-0">
					<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${estadoBadgeClass[item.estado] ?? 'bg-slate-100 text-slate-600'}`}>
						{getOptionLabel(estadoField, item.estado)}
					</span>
					<p class="text-[11px] text-slate-400 mt-1">Autorizado: {formatDate(item.fecha_autorizacion)}</p>
				</div>
				<div class="flex items-center gap-1 shrink-0 ml-2">
					{#if verEliminados}
						<button type="button" onclick={() => handleRestaurar(item)} class="p-1.5 rounded-lg text-slate-500 hover:bg-emerald-50 hover:text-emerald-600" title="Restaurar" aria-label="Restaurar">
							<RotateCcw size={16} />
						</button>
						<button type="button" onclick={() => handleEliminarPermanente(item)} class="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600" title="Eliminar permanentemente" aria-label="Eliminar permanentemente">
							<Trash size={16} />
						</button>
					{:else}
						<button type="button" onclick={() => openEdit(item)} class="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600" title="Editar" aria-label="Editar">
							<Pencil size={16} />
						</button>
						<button type="button" onclick={() => handleDelete(item)} class="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600" title="Dar de baja" aria-label="Dar de baja">
							<Trash2 size={16} />
						</button>
					{/if}
				</div>
			</div>
		{:else}
			<p class="px-4 py-10 text-center text-slate-400">{loading ? 'Cargando...' : verEliminados ? 'No hay cuentas bancarias eliminadas.' : 'No se encontraron cuentas bancarias.'}</p>
		{/each}

		<div class="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-sm text-slate-500">
			<span>{total} resultado{total === 1 ? '' : 's'} · Página {pageNum} de {totalPages}</span>
			<div class="flex items-center gap-2">
				<button type="button" onclick={() => goToPage(pageNum - 1)} disabled={pageNum <= 1} class="px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50">Anterior</button>
				<button type="button" onclick={() => goToPage(pageNum + 1)} disabled={pageNum >= totalPages} class="px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50">Siguiente</button>
			</div>
		</div>
	</div>
</div>

<CuentaBancoModal open={modalOpen} mode={modalMode} cuenta={editingItem} onClose={closeModal} onSaved={handleSaved} />

<ConfirmModal
	open={confirmDarDeBajaOpen}
	title="Dar de baja cuenta bancaria"
	message={cuentaParaDarDeBaja ? `¿Dar de baja la cuenta bancaria "${cuentaParaDarDeBaja.numero_cuenta} — ${cuentaParaDarDeBaja.titular_cuenta}"? Quedará marcada como inactiva.` : ''}
	confirmLabel="Dar de baja"
	onConfirm={confirmarDarDeBaja}
	onClose={closeConfirmDarDeBaja}
/>

<ConfirmModal
	open={confirmRestaurarOpen}
	title="Restaurar cuenta bancaria"
	danger={false}
	message={cuentaParaRestaurar ? `¿Restaurar la cuenta bancaria "${cuentaParaRestaurar.numero_cuenta} — ${cuentaParaRestaurar.titular_cuenta}"? Volverá a aparecer en el listado.` : ''}
	confirmLabel="Restaurar"
	onConfirm={confirmarRestaurar}
	onClose={closeConfirmRestaurar}
/>

<AdminConfirmModal
	open={confirmEliminarPermanenteOpen}
	title="Eliminar cuenta bancaria permanentemente"
	message={cuentaParaEliminarPermanente ? `Vas a eliminar PERMANENTEMENTE la cuenta bancaria "${cuentaParaEliminarPermanente.numero_cuenta} — ${cuentaParaEliminarPermanente.titular_cuenta}" de la base de datos. Esta acción no se puede deshacer. Ingresa el correo y la contraseña de un administrador para continuar.` : ''}
	confirmLabel="Eliminar permanentemente"
	onConfirm={confirmarEliminarPermanente}
	onClose={closeConfirmEliminarPermanente}
/>
