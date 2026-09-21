<script lang="ts">
	// Facturación (Finanzas) — factura en el formato real de Construni, armada a partir de las
	// transacciones de ingreso ya cobradas de un cliente (documento INTERNO, sin firma digital ni OSE).
	// Mismo patrón de módulo que el resto de Finanzas (KPIs arriba, ColumnFilterBar + búsqueda, tabla,
	// modal). Una factura EMITIDA guarda su imagen/PDF en Drive; el ojito abre esa imagen guardada.
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin } from '$lib/stores/permisos.svelte';
	import { Plus, Pencil, Trash2, Trash, RotateCcw, Search, ChevronUp, ChevronDown, ChevronLeft, X, FileText, Eye, TrendingUp, Inbox, Percent, CheckCircle2 } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { verifyAdminCredentials } from '$lib/shared/adminAuth';
	import { getOptionLabel, formatCurrency, emptyColumnFilters, type ColumnFilters, type FieldOption } from '$lib/shared/fieldConfig';
	import { FIELDS_CONFIG, DEFAULT_SORT_FIELD, DEFAULT_SORT_DIR, DEFAULT_PAGE_SIZE } from '$lib/modules/facturacion/config/factura.config';
	import {
		getFacturas,
		getKpisFacturacion,
		getFacturaConDetalle,
		getClienteOptions,
		darDeBajaFactura,
		restaurarFactura,
		eliminarFacturaPermanente,
		type Factura,
		type FacturaDetalle,
		type KpisFacturacion
	} from '$lib/modules/facturacion/services/facturacion.service';
	import FacturaModal from '$lib/modules/facturacion/components/FacturaModal.svelte';
	import FacturaPreviewModal from '$lib/modules/facturacion/components/FacturaPreviewModal.svelte';
	import ColumnFilterBar from '$lib/shared/components/ColumnFilterBar.svelte';
	import ConfirmModal from '$lib/shared/components/ConfirmModal.svelte';
	import AdminConfirmModal from '$lib/shared/components/AdminConfirmModal.svelte';
	import DocumentPreviewModal from '$lib/shared/components/DocumentPreviewModal.svelte';
	import type { DatosFacturaPdf } from '$lib/shared/facturaPdf';

	const tableFields = FIELDS_CONFIG.filter((f) => f.showInTable);
	const estadoField = FIELDS_CONFIG.find((f) => f.key === 'estado')!;
	const formaPagoField = FIELDS_CONFIG.find((f) => f.key === 'forma_pago')!;
	const estadoBadgeClass: Record<string, string> = {
		borrador: 'bg-slate-100 text-slate-600',
		emitida: 'bg-emerald-100 text-emerald-700',
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

	let kpis = $state<KpisFacturacion>({ totalFacturadoMes: 0, porFacturar: 0, porFacturarCount: 0, detraccionesAcumuladas: 0, facturasEmitidas: 0 });

	let modalOpen = $state(false);
	let modalMode = $state<'create' | 'edit'>('create');
	let editingFactura = $state<Factura | null>(null);
	let editingDetalle = $state<FacturaDetalle[]>([]);

	let previewOpen = $state(false);
	let previewDatos = $state<DatosFacturaPdf | null>(null);
	let imagenOpen = $state(false);
	let imagenTitle = $state('');
	let imagenDocs = $state<{ url: string; label: string }[]>([]);

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
			const mensaje: string = err?.message ?? '';
			loadError = /schema cache|does not exist|Could not find/i.test(mensaje)
				? 'Falta crear las tablas de Facturación en la base de datos: ejecuta el archivo factura_migration.sql en el SQL Editor de Supabase y recarga esta página.'
				: mensaje || 'No se pudieron cargar las facturas.';
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
			dynamicOptions = { id_cliente: await getClienteOptions(supabase) };
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
		await Promise.all([fetchList(), fetchKpis()]);
	}

	/** Emitida con imagen guardada → se abre ESA imagen (lo que realmente se autorizó). Borrador/anulada (sin
	 * imagen) → se regenera la vista previa desde los datos guardados, con sello de agua. */
	async function openPreview(item: Factura) {
		const full = await getFacturaConDetalle(supabase, item.id_factura);
		if (!full) return;
		const { factura, detalle, archivos } = full;

		if (factura.estado === 'emitida' && factura.imagen_url) {
			imagenTitle = `Factura ${factura.folio}`;
			imagenDocs = [
				{ url: factura.imagen_url, label: 'Imagen' },
				...archivos.filter((a) => a.tipo === 'pdf').map((a) => ({ url: a.url, label: 'PDF' }))
			];
			imagenOpen = true;
			return;
		}

		previewDatos = {
			folio: factura.folio,
			fechaEmision: factura.fecha_emision,
			formaPago: factura.forma_pago === 'credito' ? 'credito' : 'contado',
			clienteNombre: factura.cliente_nombre ?? factura.cliente?.nombre ?? '',
			clienteDocumentoLabel: factura.cliente_tipo_doc ?? 'RUC',
			clienteDocumento: factura.cliente_documento ?? '',
			clienteDireccion: factura.cliente_direccion ?? '',
			moneda: factura.moneda === 'USD' ? 'USD' : 'PEN',
			observacion: factura.observacion ?? '',
			lineas: detalle.map((d) => ({ cantidad: Number(d.cantidad), unidad: d.unidad ?? 'Servicio', descripcion: d.descripcion, valorUnitario: Number(d.precio_unitario) })),
			subTotalVentas: Number(factura.sub_total_ventas),
			anticipos: Number(factura.anticipos),
			descuentos: Number(factura.descuentos),
			valorVenta: Number(factura.valor_venta),
			isc: Number(factura.isc),
			igv: Number(factura.monto_igv),
			otrosCargos: Number(factura.otros_cargos),
			otrosTributos: Number(factura.otros_tributos),
			redondeo: Number(factura.redondeo),
			importeTotal: Number(factura.monto_total),
			sujetaDetraccion: factura.sujeta_detraccion,
			porcentajeDetraccion: Number(factura.porcentaje_detraccion ?? 0),
			montoDetraccion: Number(factura.monto_detraccion ?? 0),
			detraccionBienServicio: factura.detraccion_bien_servicio ?? '',
			detraccionMedioPago: factura.detraccion_medio_pago ?? '',
			detraccionCuentaBn: factura.detraccion_cuenta_bn ?? '',
			marcaAgua: factura.estado === 'anulada' ? 'ANULADA' : 'BORRADOR'
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
					{verEliminados ? 'Facturas dadas de baja — restauralas o elimínalas de la base de datos permanentemente.' : 'Factura a tus clientes a partir de sus pagos ya registrados, previsualiza y autoriza antes de emitir'}
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
		<div class="bg-white rounded-xl border border-slate-200 p-4" style="background:#eef4fb;border-color:#b7cce6">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-white text-blue-700 flex items-center justify-center shrink-0"><Inbox size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Por Facturar</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(kpis.porFacturar)}</p>
			<p class="text-[11px] text-slate-400 mt-1">{kpis.porFacturarCount} transacción{kpis.porFacturarCount === 1 ? '' : 'es'} sin factura</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center shrink-0"><Percent size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Detracciones Acumuladas</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(kpis.detraccionesAcumuladas)}</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0"><CheckCircle2 size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Facturas Emitidas</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{kpis.facturasEmitidas}</p>
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
				placeholder="Buscar por Folio o Cliente..."
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
			<div class="min-w-[860px]">
				<div class="grid grid-cols-[1.2fr_1fr_2fr_1fr_1.1fr_0.9fr_104px] gap-3 items-center px-4 py-2 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
					<span>Folio</span>
					<span>Fecha</span>
					<span>Cliente</span>
					<span>Forma de pago</span>
					<span class="text-right pr-4">Importe Total</span>
					<span>Estado</span>
					<span class="text-right">Acciones</span>
				</div>

				{#each items as item (item.id_factura)}
					<div class="grid grid-cols-[1.2fr_1fr_2fr_1fr_1.1fr_0.9fr_104px] gap-3 items-center px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors">
						<span class="font-semibold text-slate-700 text-sm">{item.folio}</span>
						<span class="text-sm text-slate-600">{formatDate(item.fecha_emision)}</span>
						<span class="text-sm text-slate-600 truncate">{item.cliente_nombre ?? item.cliente?.nombre ?? 'Sin cliente'}</span>
						<span class="text-sm text-slate-600">{getOptionLabel(formaPagoField, item.forma_pago)}</span>
						<span class="text-sm font-semibold text-slate-800 text-right pr-4">{item.moneda === 'USD' ? 'US$ ' + Number(item.monto_total).toLocaleString('es-PE', { minimumFractionDigits: 2 }) : formatCurrency(item.monto_total)}</span>
						<span>
							<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${estadoBadgeClass[item.estado] ?? 'bg-slate-100 text-slate-600'}`}>
								{getOptionLabel(estadoField, item.estado)}
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
								<button type="button" onclick={() => openPreview(item)} class="p-1.5 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600" title="Ver factura" aria-label="Ver factura">
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
<DocumentPreviewModal open={imagenOpen} documents={imagenDocs} title={imagenTitle} onClose={() => (imagenOpen = false)} />

<ConfirmModal
	open={confirmDarDeBajaOpen}
	title="Dar de baja factura"
	message={facturaParaDarDeBaja ? (facturaParaDarDeBaja.estado === 'emitida' ? `¿Dar de baja la factura ${facturaParaDarDeBaja.folio}? Quedará ANULADA y sus transacciones volverán a estar sin factura (azul). No se puede restaurar.` : `¿Dar de baja la borrador ${facturaParaDarDeBaja.folio}? Quedará marcada como inactiva.`) : ''}
	confirmLabel="Dar de baja"
	onConfirm={confirmarDarDeBaja}
	onClose={closeConfirmDarDeBaja}
/>

<AdminConfirmModal
	open={confirmEliminarPermanenteOpen}
	title="Eliminar factura permanentemente"
	message={facturaParaEliminarPermanente ? `Vas a eliminar PERMANENTEMENTE la factura ${facturaParaEliminarPermanente.folio}, su detalle y sus imágenes guardadas. Sus transacciones (si las tenía facturadas) quedarán libres. Esta acción no se puede deshacer. Ingresa el correo y la contraseña de un administrador para continuar.` : ''}
	confirmLabel="Eliminar permanentemente"
	onConfirm={confirmarEliminarPermanente}
	onClose={closeConfirmEliminarPermanente}
/>
