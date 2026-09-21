<script lang="ts">
	// Facturación (Finanzas) — documento interno de facturación/valorización, mismo patrón de módulo
	// que el resto de Finanzas (KPIs arriba, ColumnFilterBar + búsqueda, tabla, modal). Al "Emitir" una
	// factura se genera una Cuenta por Cobrar vinculada — el "Estado" que se ve acá (Pendiente/Pagado/
	// Vencido) se LEE de esa cuenta, nunca se recalcula en este módulo (ver estadoVisibleFactura).
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin } from '$lib/stores/permisos.svelte';
	import { Plus, Pencil, Trash2, Trash, RotateCcw, Search, ChevronUp, ChevronDown, ChevronLeft, X, FileText, Eye, TrendingUp, Wallet, ShieldCheck, AlertTriangle } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { verifyAdminCredentials } from '$lib/shared/adminAuth';
	import { getOptionLabel, formatCurrency, emptyColumnFilters, type ColumnFilters, type FieldOption } from '$lib/shared/fieldConfig';
	import { FIELDS_CONFIG, DEFAULT_SORT_FIELD, DEFAULT_SORT_DIR, DEFAULT_PAGE_SIZE } from '$lib/modules/facturacion/config/factura.config';
	import {
		getFacturas,
		getKpisFacturacion,
		getFacturaConDetalle,
		getProyectosParaFacturar,
		getClienteOptions,
		darDeBajaFactura,
		restaurarFactura,
		eliminarFacturaPermanente,
		estadoVisibleFactura,
		type Factura,
		type FacturaDetalle,
		type KpisFacturacion
	} from '$lib/modules/facturacion/services/facturacion.service';
	import FacturaModal from '$lib/modules/facturacion/components/FacturaModal.svelte';
	import FacturaPreviewModal from '$lib/modules/facturacion/components/FacturaPreviewModal.svelte';
	import ColumnFilterBar from '$lib/shared/components/ColumnFilterBar.svelte';
	import ConfirmModal from '$lib/shared/components/ConfirmModal.svelte';
	import AdminConfirmModal from '$lib/shared/components/AdminConfirmModal.svelte';
	import type { DatosFacturaPdf } from '$lib/shared/facturaPdf';

	const tableFields = FIELDS_CONFIG.filter((f) => f.showInTable);
	const estadoField = FIELDS_CONFIG.find((f) => f.key === 'estado')!;
	const estadoBadgeClass: Record<string, string> = {
		borrador: 'bg-slate-100 text-slate-600',
		pendiente: 'bg-amber-100 text-amber-700',
		pagado: 'bg-emerald-100 text-emerald-700',
		vencido: 'bg-red-100 text-red-700',
		anulada: 'bg-slate-100 text-slate-400'
	};

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

	let kpis = $state<KpisFacturacion>({ totalFacturadoMes: 0, porCobrarObra: 0, retencionesAcumuladas: 0, facturasVencidas: 0 });

	let modalOpen = $state(false);
	let modalMode = $state<'create' | 'edit'>('create');
	let editingFactura = $state<Factura | null>(null);
	let editingDetalle = $state<FacturaDetalle[]>([]);

	let previewOpen = $state(false);
	let previewDatos = $state<DatosFacturaPdf | null>(null);

	let facturaParaDarDeBaja = $state<Factura | null>(null);
	let confirmDarDeBajaOpen = $state(false);
	let facturaParaEliminarPermanente = $state<Factura | null>(null);
	let confirmEliminarPermanenteOpen = $state(false);
	let eliminandoPermanente = $state(false);

	async function fetchList() {
		loading = true;
		loadError = '';
		try {
			const result = await getFacturas(supabase, { page: pageNum, pageSize: DEFAULT_PAGE_SIZE, search, sortBy, sortDir, columnFilters, soloEliminados: verEliminados });
			items = result.items;
			total = result.total;
			totalPages = result.totalPages;
		} catch (err: any) {
			loadError = err?.message ?? 'No se pudieron cargar las facturas.';
		} finally {
			loading = false;
		}
	}

	async function fetchKpis() {
		try {
			kpis = await getKpisFacturacion(supabase);
		} catch (err) {
			console.error('[Facturación] No se pudieron cargar los KPIs:', err);
		}
	}

	async function fetchDynamicOptions() {
		try {
			const [proyectos, clientes] = await Promise.all([getProyectosParaFacturar(supabase), getClienteOptions(supabase)]);
			dynamicOptions = {
				id_proyecto: proyectos.map((p) => ({ value: String(p.id_proyecto), label: p.codigo })),
				id_cliente: clientes
			};
		} catch (err) {
			console.error('[Facturación] No se pudieron cargar las opciones de filtro:', err);
		}
	}

	onMount(() => {
		fetchList();
		fetchKpis();
		fetchDynamicOptions();
	});

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
		modalMode = 'create';
		editingFactura = null;
		editingDetalle = [];
		modalOpen = true;
	}

	async function openEdit(item: Factura) {
		const full = await getFacturaConDetalle(supabase, item.id_factura);
		if (!full) return;
		modalMode = 'edit';
		editingFactura = full.factura;
		editingDetalle = full.detalle;
		modalOpen = true;
	}

	function closeModal() {
		modalOpen = false;
		editingFactura = null;
		editingDetalle = [];
	}

	async function handleSaved() {
		closeModal();
		await Promise.all([fetchList(), fetchKpis()]);
	}

	async function openPreview(item: Factura) {
		const full = await getFacturaConDetalle(supabase, item.id_factura);
		if (!full) return;
		const { factura, detalle } = full;
		previewDatos = {
			folio: factura.folio,
			tipoComprobante: factura.tipo_comprobante,
			tipoFactura: factura.tipo_factura,
			fechaEmision: factura.fecha_emision,
			fechaVencimiento: factura.fecha_vencimiento,
			proyectoNombre: factura.proyecto?.nombre_proyecto ?? 'Sin proyecto',
			proyectoCodigo: '',
			clienteNombre: factura.cliente?.nombre ?? 'Sin cliente',
			clienteDocumentoLabel: factura.cliente?.tipo_doc ?? '—',
			clienteDocumento: factura.cliente?.num_documento ?? '',
			moneda: factura.moneda,
			detalle: detalle.map((d) => ({ codigo: d.codigo, descripcion: d.descripcion, unidad: d.unidad, cantidad: Number(d.cantidad), precio_unitario: Number(d.precio_unitario), subtotal: Number(d.subtotal) })),
			subtotal: Number(factura.subtotal),
			porcentajeAmortizacion: Number(factura.porcentaje_amortizacion),
			montoAmortizacion: Number(factura.monto_amortizacion),
			porcentajeRetencionGarantia: Number(factura.porcentaje_retencion_garantia),
			montoRetencionGarantia: Number(factura.monto_retencion_garantia),
			montoIgv: Number(factura.monto_igv),
			montoTotal: Number(factura.monto_total),
			comentarios: factura.comentarios,
			estado: factura.estado
		};
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
				await Promise.all([fetchList(), fetchKpis()]);
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
				await Promise.all([fetchList(), fetchKpis()]);
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
				await Promise.all([fetchList(), fetchKpis()]);
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
</script>

<div class="p-4 md:p-6">
	<div class="flex items-center justify-between mb-6">
		<div class="flex items-center gap-3">
			<FileText class="text-[#0f3b5e]" size={28} />
			<div>
				<h1 class="text-xl font-bold text-[#0f3b5e]">{verEliminados ? 'Facturas eliminadas' : 'Gestión de Facturas'}</h1>
				<p class="text-sm text-slate-500">
					{verEliminados ? 'Facturas dadas de baja — restauralas o elimínalas de la base de datos permanentemente.' : 'Emite facturas de tus proyectos y previsualízalas antes de imprimir'}
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
				<button type="button" onclick={openCreate} class="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-medium hover:bg-[#0c2f4c]">
					<Plus size={16} /> Nueva Factura
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
				<div class="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0"><TrendingUp size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Total Facturado (Mes Actual)</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(kpis.totalFacturadoMes)}</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center shrink-0"><Wallet size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Por Cobrar (Obra)</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(kpis.porCobrarObra)}</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center shrink-0"><ShieldCheck size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Retenciones Acumuladas</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(kpis.retencionesAcumuladas)}</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-red-100 text-red-600 flex items-center justify-center shrink-0"><AlertTriangle size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Facturas Vencidas</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{kpis.facturasVencidas}</p>
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
				placeholder="Buscar por Folio..."
				class="w-full pl-9 pr-8 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
			/>
			{#if searchInput}
				<button type="button" onclick={() => onSearchInput('')} class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Limpiar búsqueda">
					<X size={14} />
				</button>
			{/if}
		</div>
		<select value={sortBy} onchange={(e) => toggleSort((e.target as HTMLSelectElement).value, true)} class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-200">
			{#each tableFields.filter((f) => f.sortable) as field}
				<option value={field.key}>Ordenar: {field.label}</option>
			{/each}
		</select>
		<button type="button" onclick={() => toggleSort(sortBy)} class="p-2 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50" title={sortDir === 'asc' ? 'Ascendente' : 'Descendente'} aria-label="Cambiar dirección de orden">
			{#if sortDir === 'asc'}<ChevronUp size={16} />{:else}<ChevronDown size={16} />{/if}
		</button>
	</div>

	<div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
		<div class="overflow-x-auto">
			<div class="min-w-[900px]">
				<div class="grid grid-cols-[1fr_1fr_1.6fr_1.4fr_1fr_1fr_0.9fr_auto] gap-3 items-center px-4 py-2 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
					<span>Folio</span>
					<span>Fecha</span>
					<span>Proyecto</span>
					<span>Cliente</span>
					<span>Tipo</span>
					<span class="text-right">Monto Total</span>
					<span>Estado</span>
					<span class="text-right">Acciones</span>
				</div>

				{#each items as item (item.id_factura)}
					{@const estadoVisible = estadoVisibleFactura(item)}
					<div class="grid grid-cols-[1fr_1fr_1.6fr_1.4fr_1fr_1fr_0.9fr_auto] gap-3 items-center px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors">
						<span class="font-semibold text-slate-700 text-sm">{item.folio}</span>
						<span class="text-sm text-slate-600">{formatDate(item.fecha_emision)}</span>
						<span class="text-sm text-slate-600 truncate">{item.proyecto?.nombre_proyecto ?? 'Sin proyecto'}</span>
						<span class="text-sm text-slate-600 truncate">{item.cliente?.nombre ?? 'Sin cliente'}</span>
						<span class="text-sm text-slate-600">{item.tipo_factura}</span>
						<span class="text-sm font-semibold text-slate-800 text-right">{formatCurrency(item.monto_total)}</span>
						<span>
							<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${estadoBadgeClass[estadoVisible] ?? 'bg-slate-100 text-slate-600'}`}>
								{getOptionLabel(estadoField, estadoVisible)}
							</span>
						</span>
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
								<button type="button" onclick={() => openPreview(item)} class="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600" title="Ver / Previsualizar" aria-label="Ver / Previsualizar">
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
					<p class="px-4 py-10 text-center text-slate-400">{loading ? 'Cargando...' : 'No se encontraron facturas.'}</p>
				{/each}
			</div>
		</div>
	</div>

	{#if totalPages > 1}
		<div class="flex items-center justify-between mt-4">
			<p class="text-xs text-slate-400">{total} factura{total === 1 ? '' : 's'} en total</p>
			<div class="flex items-center gap-2">
				<button type="button" disabled={pageNum <= 1} onclick={() => { pageNum -= 1; fetchList(); }} class="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50">Anterior</button>
				<span class="text-sm text-slate-500">{pageNum} / {totalPages}</span>
				<button type="button" disabled={pageNum >= totalPages} onclick={() => { pageNum += 1; fetchList(); }} class="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50">Siguiente</button>
			</div>
		</div>
	{/if}
</div>

<FacturaModal open={modalOpen} mode={modalMode} factura={editingFactura} detalleInicial={editingDetalle} onClose={closeModal} onSaved={handleSaved} />

<FacturaPreviewModal open={previewOpen} datos={previewDatos} onClose={closePreview} />

<ConfirmModal
	open={confirmDarDeBajaOpen}
	title="Dar de baja factura"
	message={facturaParaDarDeBaja ? `¿Dar de baja la factura ${facturaParaDarDeBaja.folio}? Quedará marcada como inactiva.` : ''}
	confirmLabel="Dar de baja"
	onConfirm={confirmarDarDeBaja}
	onClose={closeConfirmDarDeBaja}
/>

<AdminConfirmModal
	open={confirmEliminarPermanenteOpen}
	title="Eliminar factura permanentemente"
	message={facturaParaEliminarPermanente ? `Vas a eliminar PERMANENTEMENTE la factura ${facturaParaEliminarPermanente.folio}. Esta acción no se puede deshacer. Ingresa el correo y la contraseña de un administrador para continuar.` : ''}
	confirmLabel="Eliminar permanentemente"
	onConfirm={confirmarEliminarPermanente}
	onClose={closeConfirmEliminarPermanente}
/>
