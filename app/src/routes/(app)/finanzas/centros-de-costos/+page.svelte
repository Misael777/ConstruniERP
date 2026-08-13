<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin } from '$lib/stores/permisos.svelte';
	import { Plus, Search, ChevronUp, ChevronDown, ChevronLeft, X, Building2, Trash2, RotateCcw, Trash } from '@lucide/svelte';
	import {
		FIELDS_CONFIG,
		DEFAULT_SORT_FIELD,
		DEFAULT_SORT_DIR,
		DEFAULT_PAGE_SIZE,
		getOptionLabel,
		formatCurrency
	} from '$lib/modules/centro-costos/config/centroCostos.config';
	import {
		getCentroCostos,
		getSaldosPorCentroCosto,
		getMontoRecibidoPorCentroCosto,
		esCentroDeVenta,
		deleteCentroCosto,
		restaurarCentroCosto,
		eliminarCentroCostoPermanente
	} from '$lib/modules/centro-costos/services/centroCostos.service';
	import { generarCodigoProyecto } from '$lib/shared/codigoProyecto';
	import { toast } from '$lib/stores/toast';
	import { describeError } from '$lib/shared/describeError';
	import { verifyAdminCredentials } from '$lib/shared/adminAuth';
	import CentroCostoModal from '$lib/modules/centro-costos/components/CentroCostoModal.svelte';
	import CentroCostoDetalleModal from '$lib/modules/centro-costos/components/CentroCostoDetalleModal.svelte';
	import type { CentroCosto } from '$lib/modules/centro-costos/services/centroCostos.service';
	import ResponsiveDataView from '$lib/shared/components/ResponsiveDataView.svelte';
	import ConfirmModal from '$lib/shared/components/ConfirmModal.svelte';
	import AdminConfirmModal from '$lib/shared/components/AdminConfirmModal.svelte';

	// Módulo 100% client-side (habla directo con Supabase vía la anon key) para funcionar en
	// cualquier plataforma empaquetada con Tauri (Windows, Android) sin necesitar un servidor
	// SvelteKit embebido. AJUSTAR: hoy la seguridad depende únicamente del guard de UI de abajo
	// (isAdmin()) — la BD no tiene políticas RLS reales todavía, así que cualquiera con la anon
	// key puede leer/escribir esta tabla sin pasar por esta pantalla. Agregar RLS es tarea aparte.
	//
	// Editar y eliminar están deshabilitados a propósito (a pedido del usuario): muchos otros módulos
	// referencian un centro_costo por id sin FK real en la BD (ver nota en centroCostos.service.ts),
	// así que editar/eliminar uno desde acá podía descuadrar esos otros módulos en silencio. Solo
	// queda la creación (Nuevo Centro de Costo). ResponsiveDataView ya cubre tabla (desktop) y
	// tarjetas (móvil/Tauri) con los mismos snippets, así que este cambio aplica igual en todas las
	// plataformas sin necesitar código aparte.

	const tableFields = FIELDS_CONFIG.filter((f) => f.showInTable);

	// El submódulo tiene dos vistas sobre la MISMA tabla centro_costo, separadas por si la fila
	// está vinculada a una entidad (proyecto/cliente/proveedor/empleado, ver centroCostos.service.ts):
	// "centros" = creadas a mano desde este submódulo (sin vínculo), "cuentas" = generadas solas al
	// crear esa entidad. Cambiar de tab reconsulta con un `vinculado` distinto, no filtra en memoria.
	let activeTab = $state<'centros' | 'cuentas'>('centros');

	let items = $state<CentroCosto[]>([]);
	// Saldo real (ingresos - egresos, ver getSaldosPorCentroCosto) de cada centro de costo de la
	// página actual — a pedido del usuario, reemplaza a `monto_actual` (que nunca se actualiza) en la
	// columna "Monto Actual" de la pestaña Centros de Costos. Se recalcula junto con `items` en
	// fetchList, solo para esa pestaña (no se pidió para Cuentas Internas). Usado para centros SIN
	// venta vinculada (bolsa general, manuales) — para los que sí la tienen, ver saldosVenta abajo.
	let saldos = $state<Record<number, number>>({});
	// Monto recibido (adelanto + cualquier otra transacción con destino ese centro, ver
	// getMontoRecibidoPorCentroCosto) — a pedido del usuario, esto es lo que se muestra en "Monto
	// Actual" para los centros vinculados a un proyecto (Obra) o el compartido de Consultoría, en vez
	// de la ficha de caja genérica (saldos).
	let saldosVenta = $state<Record<number, number>>({});
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

	// A pedido del usuario: los centros de costo manuales dados de baja dejan de listarse por
	// defecto en la pestaña "Centros de Costos" — este toggle (solo tiene sentido ahí, la página
	// entera ya es admin-only vía el guard de onMount de abajo) los muestra para restaurarlos o
	// borrarlos permanentemente. No aplica a "Cuentas Internas" (esas se dan de baja junto con su
	// entidad dueña, desde el módulo de esa entidad).
	let verEliminados = $state(false);

	/** Un centro de costo "manual puro" (sin vínculo a proyecto/cliente/proveedor/empleado) es el
	 * único tipo con acciones propias acá — los vinculados a un proyecto cerrado (que también aparecen
	 * en esta pestaña) se dan de baja en cascada desde Ventas, nunca a mano. */
	function esManualSinVincular(item: CentroCosto): boolean {
		return !item.id_proyecto && !item.id_cliente && !item.id_proveedor && !item.id_empleado;
	}

	let detalleOpen = $state(false);
	let detalleCentro = $state<CentroCosto | null>(null);

	function openDetalle(item: CentroCosto) {
		detalleCentro = item;
		detalleOpen = true;
	}

	function closeDetalle() {
		detalleOpen = false;
		detalleCentro = null;
	}

	async function fetchList() {
		loading = true;
		try {
			const result = await getCentroCostos(supabase, {
				page: pageNum,
				pageSize: DEFAULT_PAGE_SIZE,
				search,
				sortBy,
				sortDir,
				vinculado: activeTab === 'cuentas',
				soloEliminados: activeTab === 'centros' && verEliminados
			});
			items = result.items;
			total = result.total;
			totalPages = result.totalPages;
			loadError = '';
			saldos = activeTab === 'centros'
				? await getSaldosPorCentroCosto(supabase, items.map((i) => i.id_centro_costo))
				: {};
			saldosVenta = activeTab === 'centros'
				? await getMontoRecibidoPorCentroCosto(supabase, items.map((i) => i.id_centro_costo))
				: {};
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
		verEliminados = false; // "Eliminados" solo tiene sentido en "Centros de Costos"
		// 'producto' solo tiene sentido en Cuentas Internas — al salir de esa pestaña se vuelve al
		// orden por defecto para no dejar un ordenamiento que ya no aplica.
		if (sortBy === 'producto') {
			sortBy = DEFAULT_SORT_FIELD;
			sortDir = DEFAULT_SORT_DIR;
		}
		fetchList();
	}

	function toggleVerEliminados() {
		verEliminados = !verEliminados;
		pageNum = 1;
		fetchList();
	}

	// ── Dar de baja / restaurar / eliminar permanente (solo para centros manuales sin vincular,
	// ver esManualSinVincular) — mismo patrón que Clientes/Proveedores, ver skill dar-de-baja-pattern.
	let confirmDarDeBajaOpen = $state(false);
	let centroParaDarDeBaja = $state<{ id: number; nombre: string } | null>(null);

	function handleDarDeBaja(item: CentroCosto, event: MouseEvent) {
		event.stopPropagation();
		centroParaDarDeBaja = { id: item.id_centro_costo, nombre: item.nombre };
		confirmDarDeBajaOpen = true;
	}
	function closeConfirmDarDeBaja() {
		confirmDarDeBajaOpen = false;
		centroParaDarDeBaja = null;
	}
	async function confirmarDarDeBaja() {
		if (!centroParaDarDeBaja) return;
		try {
			const result = await deleteCentroCosto(supabase, centroParaDarDeBaja.id);
			if (result.success) {
				toast.success(`Centro de costo "${centroParaDarDeBaja.nombre}" dado de baja correctamente.`);
				await fetchList();
			} else {
				toast.error(`No se pudo dar de baja el centro de costo. ${result.message ?? ''}`);
			}
		} catch (err) {
			toast.error(`No se pudo dar de baja el centro de costo. ${describeError(err)}`);
		} finally {
			closeConfirmDarDeBaja();
		}
	}

	let confirmRestaurarOpen = $state(false);
	let centroParaRestaurar = $state<{ id: number; nombre: string } | null>(null);

	function handleRestaurar(item: CentroCosto, event: MouseEvent) {
		event.stopPropagation();
		centroParaRestaurar = { id: item.id_centro_costo, nombre: item.nombre };
		confirmRestaurarOpen = true;
	}
	function closeConfirmRestaurar() {
		confirmRestaurarOpen = false;
		centroParaRestaurar = null;
	}
	async function confirmarRestaurar() {
		if (!centroParaRestaurar) return;
		try {
			const result = await restaurarCentroCosto(supabase, centroParaRestaurar.id);
			if (result.success) {
				toast.success(`Centro de costo "${centroParaRestaurar.nombre}" restaurado correctamente.`);
				await fetchList();
			} else {
				toast.error(`No se pudo restaurar el centro de costo. ${result.message ?? ''}`);
			}
		} catch (err) {
			toast.error(`No se pudo restaurar el centro de costo. ${describeError(err)}`);
		} finally {
			closeConfirmRestaurar();
		}
	}

	let confirmEliminarPermanenteOpen = $state(false);
	let centroParaEliminarPermanente = $state<{ id: number; nombre: string } | null>(null);
	let eliminandoPermanente = $state(false);

	function handleEliminarPermanente(item: CentroCosto, event: MouseEvent) {
		event.stopPropagation();
		centroParaEliminarPermanente = { id: item.id_centro_costo, nombre: item.nombre };
		confirmEliminarPermanenteOpen = true;
	}
	function closeConfirmEliminarPermanente() {
		if (eliminandoPermanente) return;
		confirmEliminarPermanenteOpen = false;
		centroParaEliminarPermanente = null;
	}
	async function confirmarEliminarPermanente(email: string, password: string) {
		if (!centroParaEliminarPermanente) return;
		const verificacion = await verifyAdminCredentials(email, password);
		if (!verificacion.success) throw new Error(verificacion.message);

		eliminandoPermanente = true;
		try {
			const result = await eliminarCentroCostoPermanente(supabase, centroParaEliminarPermanente.id);
			if (result.success) {
				toast.success(`Centro de costo "${centroParaEliminarPermanente.nombre}" eliminado permanentemente.`);
				confirmEliminarPermanenteOpen = false;
				centroParaEliminarPermanente = null;
				await fetchList();
			} else {
				throw new Error(result.message || 'No se pudo eliminar el centro de costo.');
			}
		} finally {
			eliminandoPermanente = false;
		}
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

	/** Botones dedicados "Razón Social (A-Z)" / "Producto (A-Z)" en la pestaña Cuentas Internas —
	 * 'producto' no es un campo de tableFields (ver nota en CentroCosto.producto), así que no puede
	 * activarse haciendo clic en un encabezado de columna como el resto; siempre ordena ascendente,
	 * un segundo clic vuelve al orden por defecto. */
	function sortAlfabetico(fieldKey: 'nombre' | 'producto') {
		if (sortBy === fieldKey && sortDir === 'asc') {
			sortBy = DEFAULT_SORT_FIELD;
			sortDir = DEFAULT_SORT_DIR;
		} else {
			sortBy = fieldKey;
			sortDir = 'asc';
		}
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

	// Mismas 2 opciones que el <select> de "Tipo de Obra" en NuevaVentaModal.svelte (tipoObra) — sin
	// config compartida porque son solo 2 valores fijos del CHECK de la BD (tipo_obra en `proyecto`).
	function tipoObraLabel(code: string | null | undefined): string {
		if (code === 'OBRA') return 'Ejecución de Obra';
		if (code === 'SUP') return 'Supervisión';
		return getOptionLabel(FIELDS_CONFIG.find((f) => f.key === 'tipo')!, 'proyecto');
	}

	/** A pedido del usuario, en la pestaña Centros de Costos: "Nombre" muestra el nombre del CLIENTE del
	 * proyecto vinculado (en vez de `centro.nombre`, que para estos centros guarda el código del
	 * proyecto — ver codigoProyecto.ts — ya visible aparte en la columna "Código de proyecto"; sin
	 * esto, "Nombre" y "Código de proyecto" mostraban lo mismo dos veces). Aplica a cualquier centro con
	 * proyecto propio — Obra (tipo='proyecto') y, desde que cada venta de Consultoría cerrada tiene su
	 * propia fila (ver getOrCrearCentroCostoCompartido en centroCostos.service.ts), también
	 * tipo='consultoria' con id_proyecto. Solo el centro histórico compartido de Consultoría
	 * (id_proyecto NULL, sin un único cliente) conserva su `nombre` ("Consultoría General"). Usado
	 * tanto por la tabla (cellValue) como por la tarjeta móvil. */
	function nombreDisplay(item: CentroCosto): string {
		if (activeTab === 'centros' && item.proyecto) {
			return item.proyecto.clienteNombre || item.proyecto.cliente?.nombre || item.nombre;
		}
		return item.nombre;
	}

	function cellValue(field: (typeof tableFields)[number], item: CentroCosto) {
		if (field.key === 'nombre') return nombreDisplay(item);
		// "Tipo" muestra el tipo de OBRA del proyecto vinculado (en vez del genérico "Proyecto
		// (automático)") cuando ese proyecto es de Obra, y "Monto Actual" muestra el monto recibido
		// (adelanto + cualquier otra transacción con destino ese centro, ver getMontoRecibidoPorCentroCosto)
		// para centros de proyecto/consultoría, o la ficha de caja genérica (ingresos-egresos) para el
		// resto — en ambos casos reemplaza a la columna `monto_actual` cruda, que nunca se mantiene al
		// día por sí sola.
		if (activeTab === 'centros' && field.key === 'tipo' && item.proyecto?.tipo_venta === 'obra') {
			return tipoObraLabel(item.proyecto.tipo_obra);
		}
		if (activeTab === 'centros' && field.key === 'monto_actual') {
			const saldo = esCentroDeVenta(item) ? saldosVenta[item.id_centro_costo] : saldos[item.id_centro_costo];
			return formatCurrency(saldo ?? item.monto_actual);
		}

		const raw = (item as any)[field.key];
		if (field.tipo === 'select') return getOptionLabel(field, raw);
		if (field.tipo === 'currency') return formatCurrency(raw);
		if (field.key === 'created_at') return formatDate(raw);
		return raw ?? '—';
	}

	/** La columna "Código de proyecto" muestra el nombre/código de la ENTIDAD VINCULADA (mismo criterio
	 * que resolveEntidadVinculada en centroCostos.service.ts: para un centro de proyecto, ese nombre es
	 * su código real, ver generarCodigoProyecto en codigoProyecto.ts) — ya NO el valor crudo guardado en
	 * `centro_costo.nombre`, que desde que ese campo pasó a guardar el id_proyecto (a pedido del
	 * usuario, ver getOrCrearCentroCostoParaEntidad) dejó de ser legible acá. Se recalcula a partir del
	 * embed `item.proyecto` ya traído por getCentroCostos, sin queries extra por fila. Sin proyecto
	 * vinculado (centro manual, o el compartido de Consultoría) no hay una única entidad — ver
	 * nombreDisplay más arriba para la columna "Nombre", que sigue mostrando el cliente. */
	function codigoProyectoDisplay(item: CentroCosto): string {
		return item.proyecto ? generarCodigoProyecto(item.proyecto) : '—';
	}

	function openCreate() {
		modalOpen = true;
	}

	function closeModal() {
		modalOpen = false;
	}

	let emptyMessage = $derived(
		loading
			? 'Cargando...'
			: activeTab === 'centros'
				? 'No se encontraron centros de costo.'
				: 'No se encontraron cuentas internas.'
	);
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
			<div class="flex items-center gap-2">
				<button
					type="button"
					onclick={toggleVerEliminados}
					class={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${verEliminados ? 'bg-slate-800 text-white hover:bg-slate-900' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'}`}
				>
					{#if verEliminados}<ChevronLeft size={16} />{:else}<Trash2 size={16} />{/if}
					{verEliminados ? 'Volver' : 'Ver eliminados'}
				</button>
				{#if !verEliminados}
					<button
						type="button"
						onclick={openCreate}
						class="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-medium hover:bg-[#0c2f4c]"
					>
						<Plus size={16} /> Nuevo Centro de Costo
					</button>
				{/if}
			</div>
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
	<div class="mb-4 flex flex-wrap items-center gap-3">
		<div class="relative max-w-sm flex-1 min-w-[220px]">
			<Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
			<input
				type="text"
				value={searchInput}
				oninput={(e) => onSearchInput((e.target as HTMLInputElement).value)}
				placeholder={activeTab === 'cuentas' ? 'Buscar por código, nombre o producto...' : 'Buscar por código o nombre...'}
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
		{#if activeTab === 'cuentas'}
			<div class="flex items-center gap-2">
				<button
					type="button"
					onclick={() => sortAlfabetico('nombre')}
					class={`px-3 py-2 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors ${sortBy === 'nombre' && sortDir === 'asc' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}
				>
					Razón Social (A-Z)
				</button>
				<button
					type="button"
					onclick={() => sortAlfabetico('producto')}
					class={`px-3 py-2 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors ${sortBy === 'producto' && sortDir === 'asc' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}
				>
					Producto (A-Z)
				</button>
			</div>
		{/if}
	</div>

	<!-- Table / Cards -->
	<div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
		<div class="overflow-x-auto">
			<ResponsiveDataView items={loading ? [] : items} keyField="id_centro_costo" colspan={tableFields.length + (activeTab === 'centros' ? 2 : 1)} {emptyMessage} onRowClick={openDetalle}>
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
						{#if field.key === 'nombre' && activeTab === 'centros'}
							<th class="text-left px-4 py-3 font-semibold text-slate-600">Código de proyecto</th>
						{/if}
					{/each}
					{#if activeTab === 'cuentas'}
						<th class="text-left px-4 py-3 font-semibold text-slate-600">
							<button
								type="button"
								onclick={() => sortAlfabetico('producto')}
								class="flex items-center gap-1 cursor-pointer hover:text-[#0f3b5e]"
							>
								Producto
								{#if sortBy === 'producto'}
									{#if sortDir === 'asc'}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
								{/if}
							</button>
						</th>
					{/if}
					{#if activeTab === 'centros'}
						<th class="text-center px-4 py-3 font-semibold text-slate-600">Acciones</th>
					{/if}
				{/snippet}
				{#snippet row(item)}
					{#each tableFields as field}
						<td class="px-4 py-3 text-slate-700">{cellValue(field, item)}</td>
						{#if field.key === 'nombre' && activeTab === 'centros'}
							<td class="px-4 py-3 text-slate-700">{codigoProyectoDisplay(item)}</td>
						{/if}
					{/each}
					{#if activeTab === 'cuentas'}
						<td class="px-4 py-3 text-slate-700">
							{#if item.producto}
								<span class="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">{item.producto}</span>
							{:else}
								<span class="text-xs text-slate-400 italic">—</span>
							{/if}
						</td>
					{/if}
					{#if activeTab === 'centros'}
						<td class="px-4 py-3 text-center">
							{#if esManualSinVincular(item)}
								<div class="flex items-center justify-center gap-2">
									{#if verEliminados}
										<button onclick={(e) => handleRestaurar(item, e)} class="w-8 h-8 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 flex items-center justify-center transition-colors" title="Restaurar">
											<RotateCcw size={14} />
										</button>
										<button onclick={(e) => handleEliminarPermanente(item, e)} class="w-8 h-8 rounded bg-rose-50 text-rose-600 hover:bg-rose-100 flex items-center justify-center transition-colors" title="Eliminar permanentemente">
											<Trash size={14} />
										</button>
									{:else}
										<button onclick={(e) => handleDarDeBaja(item, e)} class="w-8 h-8 rounded bg-rose-50 text-rose-600 hover:bg-rose-100 flex items-center justify-center transition-colors" title="Dar de baja">
											<Trash2 size={14} />
										</button>
									{/if}
								</div>
							{:else}
								<span class="text-xs text-slate-400 italic">—</span>
							{/if}
						</td>
					{/if}
				{/snippet}
				{#snippet card(item)}
					<div class="flex items-start justify-between gap-3 mb-2">
						<div class="min-w-0">
							<div class="font-semibold text-slate-800 truncate">{nombreDisplay(item)}</div>
							<div class="text-xs text-slate-500 mt-0.5">{item.codigo}</div>
						</div>
						<div class="text-right shrink-0">
							<div class="font-bold text-slate-800">{cellValue(FIELDS_CONFIG.find((f) => f.key === 'monto_actual')!, item)}</div>
							<div class="text-[11px] text-slate-400">{formatDate(item.created_at)}</div>
						</div>
					</div>
					<div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-500">
						<span class="text-slate-400">Tipo</span>
						<span class="text-right text-slate-700">{cellValue(FIELDS_CONFIG.find((f) => f.key === 'tipo')!, item)}</span>
						{#if activeTab === 'centros' && item.proyecto}
							<span class="text-slate-400">Código proy.</span>
							<span class="text-right text-slate-700">{codigoProyectoDisplay(item)}</span>
						{/if}
						{#if activeTab === 'cuentas' && item.producto}
							<span class="text-slate-400">Producto</span>
							<span class="text-right text-slate-700">{item.producto}</span>
						{/if}
					</div>
					{#if activeTab === 'centros' && esManualSinVincular(item)}
						<div class="flex items-center gap-2 pt-2 mt-2 border-t border-slate-100">
							{#if verEliminados}
								<button onclick={(e) => handleRestaurar(item, e)} class="flex-1 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center gap-2 text-xs font-medium active:bg-emerald-100" aria-label="Restaurar">
									<RotateCcw size={14} /> Restaurar
								</button>
								<button onclick={(e) => handleEliminarPermanente(item, e)} class="flex-1 h-9 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center gap-2 text-xs font-medium active:bg-rose-100" aria-label="Eliminar permanentemente">
									<Trash size={14} /> Eliminar
								</button>
							{:else}
								<button onclick={(e) => handleDarDeBaja(item, e)} class="flex-1 h-9 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center gap-2 text-xs font-medium active:bg-rose-100" aria-label="Dar de baja">
									<Trash2 size={14} /> Dar de baja
								</button>
							{/if}
						</div>
					{/if}
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

<CentroCostoModal open={modalOpen} mode="create" centro={null} onClose={closeModal} onSaved={fetchList} />
<CentroCostoDetalleModal open={detalleOpen} centro={detalleCentro} onClose={closeDetalle} />

<ConfirmModal
	open={confirmDarDeBajaOpen}
	title="Dar de baja centro de costo"
	message={centroParaDarDeBaja ? `¿Dar de baja el centro de costo "${centroParaDarDeBaja.nombre}"? Quedará marcado como inactivo.` : ''}
	confirmLabel="Dar de baja"
	onConfirm={confirmarDarDeBaja}
	onClose={closeConfirmDarDeBaja}
/>

<ConfirmModal
	open={confirmRestaurarOpen}
	title="Restaurar centro de costo"
	danger={false}
	message={centroParaRestaurar ? `¿Restaurar el centro de costo "${centroParaRestaurar.nombre}"? Volverá a aparecer en el listado.` : ''}
	confirmLabel="Restaurar"
	onConfirm={confirmarRestaurar}
	onClose={closeConfirmRestaurar}
/>

<AdminConfirmModal
	open={confirmEliminarPermanenteOpen}
	title="Eliminar centro de costo permanentemente"
	message={centroParaEliminarPermanente ? `Vas a eliminar PERMANENTEMENTE el centro de costo "${centroParaEliminarPermanente.nombre}" de la base de datos. Esta acción no se puede deshacer. Ingresa el correo y la contraseña de un administrador para continuar.` : ''}
	confirmLabel="Eliminar permanentemente"
	onConfirm={confirmarEliminarPermanente}
	onClose={closeConfirmEliminarPermanente}
/>
