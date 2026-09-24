<script lang="ts">
	// Nueva/Editar Factura (borrador) — en el formato real de Construni. Flujo (a pedido explícito del
	// usuario): elegir CLIENTE → el sistema muestra TODAS sus transacciones de ingreso (soportes) con su
	// documentación consultable (ojito); las que NO tienen factura se pintan en azul lino y se pueden
	// seleccionar; las ya facturadas quedan en verde/deshabilitadas → Vista previa → "Autorizar y emitir"
	// (guarda la imagen en Drive y marca esas transacciones como facturadas).
	//
	// Cliente usaba <select> NATIVO a propósito (el type-ahead del navegador alcanzaba). Ticket #29:
	// ese type-ahead no existe en touch (Android vía Tauri) — tocar el <select> abre el picker nativo
	// del sistema, no hay teclado físico con el que "escribir para saltar" — así que pasa a
	// SelectConSaldo.svelte, mismo combo con buscador que el resto de listas largas de Finanzas. Los
	// campos simples de cabecera se dibujan desde FIELDS_CONFIG (mismo motor genérico que el resto de
	// Finanzas).
	import { supabase } from '$lib/supabaseClient';
	import { X, Loader2, Eye, Check, Lock } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { validatePayload, applyFieldMask, type FieldOption } from '$lib/shared/fieldConfig';
	import { FIELDS_CONFIG } from '$lib/modules/facturacion/config/factura.config';
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
	import {
		getClientesParaFacturar,
		getTransaccionesDelCliente,
		getDocumentosTransaccion,
		calcularTotalesFactura,
		valorSinIgv,
		guardarBorradorFactura,
		autorizarYEmitirFactura,
		type Factura,
		type FacturaDetalle,
		type ClienteParaFacturar,
		type TransaccionFacturable,
		type LineaFactura
	} from '$lib/modules/facturacion/services/facturacion.service';
	import { generarFacturaPdf, type DatosFacturaPdf } from '$lib/shared/facturaPdf';
	import { DETRACCION_CUENTA_BN_DEFAULT } from '$lib/shared/empresaConstantes';
	import { permisosState } from '$lib/stores/permisos.svelte';
	import FacturaPreviewModal from './FacturaPreviewModal.svelte';
	import DocumentPreviewModal from '$lib/shared/components/DocumentPreviewModal.svelte';

	let {
		open = false,
		mode = 'create',
		factura = null,
		detalleInicial = [],
		onClose,
		onSaved
	}: {
		open: boolean;
		mode: 'create' | 'edit';
		factura: Factura | null;
		detalleInicial?: FacturaDetalle[];
		onClose: () => void;
		onSaved: () => void | Promise<void>;
	} = $props();

	const formFields = FIELDS_CONFIG.filter((f) => f.showInForm);

	// Colores de estado de cada transacción en la lista (a pedido del usuario: azul lino = sin factura).
	// Bien diferenciados a propósito (el azul lino y el verde pálidos anteriores casi no se distinguían del
	// blanco ni entre sí): azul lino más intenso = sin factura; verde marcado = ya facturada.
	const COLOR_SIN_FACTURA = { bg: '#bcd3f2', border: '#5b8fd4' };
	const COLOR_FACTURADA = { bg: '#a8dfb9', border: '#3c9b5c' };

	function hoyISO(): string {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	function buildInitialValues(): Record<string, string> {
		const values: Record<string, string> = {};
		for (const field of formFields) {
			let raw: unknown = factura ? (factura as any)[field.key] : '';
			if (field.key === 'sujeta_detraccion') raw = factura ? (factura.sujeta_detraccion ? 'si' : 'no') : 'no';
			values[field.key] = raw === null || raw === undefined ? '' : String(raw);
		}
		if (!factura) {
			values.fecha_emision = hoyISO();
			values.forma_pago = 'contado';
			values.detraccion_cuenta_bn = DETRACCION_CUENTA_BN_DEFAULT;
		}
		return values;
	}

	let formValues = $state<Record<string, string>>(buildInitialValues());
	let fieldErrors = $state<Record<string, string>>({});
	let idCliente = $state('');
	let clientes = $state<ClienteParaFacturar[]>([]);
	let transacciones = $state<TransaccionFacturable[]>([]);
	let cargandoTransacciones = $state(false);
	let seleccion = $state<number[]>([]);
	let descripciones = $state<Record<number, string>>({});
	let facturaActual = $state<Factura | null>(null);
	let guardando = $state(false);

	let docsOpen = $state(false);
	let docsTitle = $state('');
	let docsLista = $state<{ url: string; label: string }[]>([]);

	let previewOpen = $state(false);
	let previewDatos = $state<DatosFacturaPdf | null>(null);
	let autorizando = $state(false);

	async function cargarTransacciones(id: string) {
		transacciones = [];
		if (!id) return;
		cargandoTransacciones = true;
		try {
			transacciones = await getTransaccionesDelCliente(supabase, Number(id));
		} catch (err) {
			console.error('[FacturaModal] No se pudieron cargar las transacciones del cliente:', err);
			toast.error('No se pudieron cargar las transacciones del cliente.');
		} finally {
			cargandoTransacciones = false;
		}
	}

	$effect(() => {
		if (!open) return;
		formValues = buildInitialValues();
		fieldErrors = {};
		facturaActual = factura;
		idCliente = factura ? String(factura.id_cliente) : '';
		seleccion = detalleInicial.map((d) => d.id_transaccion).filter((v): v is number => v != null);
		descripciones = Object.fromEntries(detalleInicial.filter((d) => d.id_transaccion != null).map((d) => [d.id_transaccion as number, d.descripcion]));
		previewOpen = false;
		previewDatos = null;
		getClientesParaFacturar(supabase)
			.then((data) => (clientes = data))
			.catch((err) => console.error('[FacturaModal] No se pudieron cargar los clientes:', err));
		if (factura) cargarTransacciones(String(factura.id_cliente));
		else transacciones = [];
	});

	const clienteSeleccionado = $derived(clientes.find((c) => String(c.id_cliente) === idCliente) ?? null);
	const transaccionesSeleccionadas = $derived(transacciones.filter((t) => seleccion.includes(t.id_transaccion)));
	const primera = $derived(transaccionesSeleccionadas[0] ?? null);
	const moneda = $derived<'PEN' | 'USD'>(primera?.tipo_moneda === 'dolares' ? 'USD' : 'PEN');
	const tipoCambio = $derived(primera?.tipo_moneda === 'dolares' ? primera.tipo_cambio : null);

	function defaultDescripcion(t: TransaccionFacturable): string {
		const base = [t.categoria, t.descripcion].filter(Boolean).join(' — ') || 'Ingreso';
		return t.num_documento ? `${base} (${t.num_documento})` : base;
	}

	const lineas = $derived<LineaFactura[]>(
		transaccionesSeleccionadas.map((t) => ({
			id_transaccion: t.id_transaccion,
			descripcion: descripciones[t.id_transaccion] ?? defaultDescripcion(t),
			unidad: 'Servicio',
			cantidad: 1,
			precio_unitario: valorSinIgv(t.monto_total),
			monto_total_linea: t.monto_total
		}))
	);

	const sujetaDetraccion = $derived(String(formValues.sujeta_detraccion ?? 'no') === 'si');
	const totales = $derived.by(() => calcularTotalesFactura(lineas.map((l) => l.monto_total_linea), sujetaDetraccion, Number(formValues.porcentaje_detraccion || 0)));

	function seleccionable(t: TransaccionFacturable): boolean {
		if (t.id_factura != null) return false;
		if (!primera) return true;
		return (t.tipo_moneda === 'dolares') === (primera.tipo_moneda === 'dolares');
	}

	function toggle(t: TransaccionFacturable) {
		if (!seleccionable(t)) return;
		seleccion = seleccion.includes(t.id_transaccion) ? seleccion.filter((id) => id !== t.id_transaccion) : [...seleccion, t.id_transaccion];
	}

	async function handleClienteChange(value: string) {
		idCliente = value;
		seleccion = [];
		descripciones = {};
		await cargarTransacciones(value);
	}

	async function abrirDocumentos(t: TransaccionFacturable) {
		docsTitle = `Soportes — ${t.categoria ?? 'Ingreso'} ${t.fecha}`;
		docsLista = await getDocumentosTransaccion(supabase, t);
		docsOpen = true;
	}

	function handleInput(key: string, rawValue: string) {
		const field = formFields.find((f) => f.key === key)!;
		formValues = { ...formValues, [key]: applyFieldMask(field, rawValue) };
		revalidate();
	}

	function revalidate() {
		fieldErrors = validatePayload(FIELDS_CONFIG, formValues);
		if (!idCliente) fieldErrors = { ...fieldErrors, id_cliente: 'Selecciona un cliente' };
	}

	function isDisabled(field: (typeof formFields)[number]): boolean {
		return field.disabledWhen?.(formValues) ?? false;
	}

	const soloLectura = $derived(mode === 'edit' && factura?.estado !== 'borrador');
	const puedeContinuar = $derived(!!idCliente && lineas.length > 0);
	const title = $derived(soloLectura ? 'Consultar Factura' : mode === 'create' ? 'Nueva Factura' : 'Editar Factura (Borrador)');

	function fmt(valor: number): string {
		return `${moneda === 'USD' ? 'US$' : 'S/'} ${Number(valor || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	function fmtTransaccion(t: TransaccionFacturable): string {
		return `${t.tipo_moneda === 'dolares' ? 'US$' : 'S/'} ${t.monto_total.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	function validarAntesDeContinuar(): boolean {
		revalidate();
		if (Object.keys(fieldErrors).length > 0) {
			toast.error('Revisa los campos marcados');
			return false;
		}
		if (lineas.length === 0) {
			toast.error('Selecciona al menos una transacción para facturar.');
			return false;
		}
		return true;
	}

	function construirDatosPdf(folio: string | null, marcaAgua: string | null): DatosFacturaPdf {
		const c = clienteSeleccionado;
		return {
			folio,
			fechaEmision: formValues.fecha_emision,
			formaPago: formValues.forma_pago === 'credito' ? 'credito' : 'contado',
			clienteNombre: c?.nombre ?? '',
			clienteDocumentoLabel: c?.tipo_doc ?? 'RUC',
			clienteDocumento: c?.num_documento ?? '',
			clienteDireccion: c?.direccion ?? '',
			moneda,
			observacion: formValues.observacion ?? '',
			lineas: lineas.map((l) => ({ cantidad: l.cantidad, unidad: l.unidad, descripcion: l.descripcion, valorUnitario: l.precio_unitario })),
			subTotalVentas: totales.subTotalVentas,
			anticipos: totales.anticipos,
			descuentos: totales.descuentos,
			valorVenta: totales.valorVenta,
			isc: totales.isc,
			igv: totales.igv,
			otrosCargos: totales.otrosCargos,
			otrosTributos: totales.otrosTributos,
			redondeo: totales.redondeo,
			importeTotal: totales.importeTotal,
			sujetaDetraccion,
			porcentajeDetraccion: Number(formValues.porcentaje_detraccion || 0),
			montoDetraccion: totales.montoDetraccion,
			detraccionBienServicio: formValues.detraccion_bien_servicio ?? '',
			detraccionMedioPago: formValues.detraccion_medio_pago ?? '',
			detraccionCuentaBn: formValues.detraccion_cuenta_bn ?? '',
			marcaAgua
		};
	}

	/** Guarda (crea o actualiza) el borrador y recuerda el id/folio real para el siguiente paso. */
	async function guardar(): Promise<Factura | null> {
		const c = clienteSeleccionado;
		if (!c) return null;
		const result = await guardarBorradorFactura(
			supabase,
			formValues,
			{ id_cliente: c.id_cliente, nombre: c.nombre, tipo_doc: c.tipo_doc, num_documento: c.num_documento, direccion: c.direccion },
			moneda,
			tipoCambio,
			lineas,
			permisosState.userName || null,
			facturaActual?.id_factura
		);
		if (!result.success || !result.data) {
			toast.error(result.message);
			if (result.errors) fieldErrors = { ...fieldErrors, ...result.errors };
			return null;
		}
		facturaActual = result.data;
		return result.data;
	}

	async function handleGuardarBorrador() {
		if (!validarAntesDeContinuar()) return;
		guardando = true;
		try {
			const saved = await guardar();
			if (saved) {
				toast.success('Borrador guardado');
				await onSaved();
				onClose();
			}
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		} finally {
			guardando = false;
		}
	}

	function handleVistaPrevia() {
		if (!validarAntesDeContinuar()) return;
		previewDatos = construirDatosPdf(facturaActual?.folio ?? null, 'VISTA PREVIA');
		previewOpen = true;
	}

	/** Autorización: guarda el borrador (asigna el folio real), regenera la imagen/PDF YA con ese folio y sin
	 * sello, la sube a Drive y emite la factura de forma atómica. Si algo falla, el borrador queda guardado
	 * y las transacciones sin tocar. */
	async function handleAutorizar() {
		if (!validarAntesDeContinuar()) return;
		autorizando = true;
		try {
			const saved = await guardar();
			if (!saved) return;
			const archivos = await generarFacturaPdf(construirDatosPdf(saved.folio, null));
			const result = await autorizarYEmitirFactura(supabase, saved, archivos.pngDataUrl, archivos.pdfBase64, permisosState.userName || null);
			if (result.success) {
				toast.success(result.message);
				previewOpen = false;
				await onSaved();
				onClose();
			} else {
				toast.error(result.message);
			}
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		} finally {
			autorizando = false;
		}
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
			<div class="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
				<h2 class="text-lg font-semibold text-[#0f3b5e]">{title}{facturaActual?.folio ? ` — ${facturaActual.folio}` : ''}</h2>
				<button onclick={onClose} class="text-slate-400 hover:text-slate-600 w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded-lg" aria-label="Cerrar">
					<X size={18} />
				</button>
			</div>

			<div class="p-6 overflow-y-auto flex-1">
				<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
					<div>
						<label for="fac-cliente" class="block text-sm font-medium text-[#0f3b5e] mb-1">Cliente (Señor/es) <span class="text-red-500">*</span></label>
						<SelectConSaldo
							id="fac-cliente"
							value={idCliente}
							options={clientes.map((c) => ({ value: String(c.id_cliente), label: c.nombre }))}
							disabled={mode === 'edit'}
							hasError={!!fieldErrors.id_cliente}
							placeholder="Selecciona un cliente"
							onchange={handleClienteChange}
						/>
						{#if fieldErrors.id_cliente}<p class="mt-1 text-xs text-red-600">{fieldErrors.id_cliente}</p>{/if}
					</div>
					<div>
						<span class="block text-sm font-medium text-[#0f3b5e] mb-1">{clienteSeleccionado?.tipo_doc ?? 'RUC'}</span>
						<input type="text" readonly value={clienteSeleccionado?.num_documento ?? ''} class="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-600 cursor-default" />
					</div>
					<div>
						<span class="block text-sm font-medium text-[#0f3b5e] mb-1">Dirección del Cliente</span>
						<input type="text" readonly value={clienteSeleccionado?.direccion ?? ''} class="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-600 cursor-default" />
					</div>
				</div>

				<div class="flex items-center justify-between mb-2 flex-wrap gap-2">
					<h3 class="text-sm font-semibold text-[#0f3b5e]">Transacciones del cliente (soportes de pago)</h3>
					<div class="flex items-center gap-3 text-[11px] text-slate-500">
						<span class="flex items-center gap-1.5"><span class="inline-block shrink-0 w-4 h-4 rounded border-2" style={`background:${COLOR_SIN_FACTURA.bg};border-color:${COLOR_SIN_FACTURA.border}`}></span>Sin factura (seleccionable)</span>
						<span class="flex items-center gap-1.5"><span class="inline-block shrink-0 w-4 h-4 rounded border-2" style={`background:${COLOR_FACTURADA.bg};border-color:${COLOR_FACTURADA.border}`}></span>Ya facturada</span>
					</div>
				</div>

				<div class="border border-slate-200 rounded-xl overflow-hidden mb-6">
					<div class="overflow-x-auto">
						<div class="min-w-[760px]">
							<div class="grid grid-cols-[auto_0.9fr_1.1fr_2fr_1.4fr_1fr_auto] gap-3 items-center px-3 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase">
								<span class="w-4"></span>
								<span>Fecha</span>
								<span>Categoría</span>
								<span>Descripción</span>
								<span>Destino</span>
								<span class="text-right">Monto</span>
								<span class="text-center">Soportes</span>
							</div>
							{#each transacciones as t (t.id_transaccion)}
								{@const facturada = t.id_factura != null}
								{@const marcada = seleccion.includes(t.id_transaccion)}
								{@const habilitada = seleccionable(t) && !soloLectura}
								<div
									role="button"
									tabindex="0"
									onclick={() => !soloLectura && toggle(t)}
									onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && !soloLectura && toggle(t)}
									class={`grid grid-cols-[auto_0.9fr_1.1fr_2fr_1.4fr_1fr_auto] gap-3 items-center px-3 py-2.5 border-b last:border-b-0 text-sm ${habilitada ? 'cursor-pointer' : 'cursor-default'} ${!facturada && !habilitada && !marcada ? 'opacity-50' : ''}`}
									style={`background:${facturada ? COLOR_FACTURADA.bg : COLOR_SIN_FACTURA.bg};border-color:${facturada ? COLOR_FACTURADA.border : COLOR_SIN_FACTURA.border};${marcada ? 'box-shadow: inset 3px 0 0 #1d4ed8;' : ''}`}
									title={!facturada && !seleccionable(t) ? 'Solo se pueden facturar juntas transacciones de la misma moneda.' : undefined}
								>
									{#if facturada}
										<!-- Ya facturada: NO se puede seleccionar (sin casilla), solo un candado. -->
										<span class="w-4 h-4 flex items-center justify-center shrink-0 text-emerald-700" title="Ya facturada"><Lock size={14} /></span>
									{:else}
										<span class="w-4 h-4 rounded border flex items-center justify-center shrink-0" style={`border-color:${marcada ? '#1d4ed8' : '#94a3b8'};background:${marcada ? '#1d4ed8' : '#fff'}`}>
											{#if marcada}<Check size={12} class="text-white" />{/if}
										</span>
									{/if}
									<span class="text-slate-700">{t.fecha}</span>
									<span class="text-slate-700 truncate">{t.categoria ?? '—'}</span>
									<span class="text-slate-600 truncate">{t.descripcion ?? '—'}</span>
									<span class="text-slate-600 truncate">
										{t.destinoLabel}
										{#if facturada}<span class="ml-1 inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-700">Facturada · {t.facturaFolio ?? ''}</span>{/if}
									</span>
									<span class="text-right font-semibold text-slate-800">{fmtTransaccion(t)}</span>
									<span class="flex justify-center">
										<button
											type="button"
											onclick={(e) => { e.stopPropagation(); abrirDocumentos(t); }}
											class="p-1.5 rounded-lg text-slate-500 hover:bg-white hover:text-blue-600"
											title="Ver documentos"
											aria-label="Ver documentos"
										>
											<Eye size={16} />
										</button>
									</span>
								</div>
							{:else}
								<p class="px-3 py-8 text-center text-xs text-slate-400">
									{cargandoTransacciones ? 'Cargando transacciones...' : idCliente ? 'Este cliente no tiene transacciones de ingreso registradas.' : 'Elige un cliente para ver sus transacciones.'}
								</p>
							{/each}
						</div>
					</div>
				</div>

				<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
					{#each formFields as field (field.key)}
						<div>
							<label for={`fac-${field.key}`} class="block text-sm font-medium text-[#0f3b5e] mb-1">
								{field.label}
								{#if field.required}<span class="text-red-500">*</span>{/if}
							</label>
							{#if field.tipo === 'select' || field.options}
								<select
									id={`fac-${field.key}`}
									value={formValues[field.key]}
									disabled={isDisabled(field) || soloLectura}
									onchange={(e) => handleInput(field.key, (e.target as HTMLSelectElement).value)}
									class={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:text-slate-400 ${fieldErrors[field.key] ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
								>
									<option value="" disabled>Selecciona una opción</option>
									{#each (field.options ?? []) as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							{:else}
								<input
									id={`fac-${field.key}`}
									type={field.tipo === 'number' ? 'number' : field.tipo === 'date' ? 'date' : 'text'}
									step={field.tipo === 'number' ? 'any' : undefined}
									value={formValues[field.key]}
									maxlength={field.maxLength}
									placeholder={field.placeholder}
									disabled={isDisabled(field) || soloLectura}
									oninput={(e) => handleInput(field.key, (e.target as HTMLInputElement).value)}
									class={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:text-slate-400 ${fieldErrors[field.key] ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
								/>
							{/if}
							{#if fieldErrors[field.key]}
								<p class="mt-1 text-xs text-red-600">{fieldErrors[field.key]}</p>
							{:else if field.helpText}
								<p class="mt-1 text-xs text-slate-400">{field.helpText}</p>
							{/if}
						</div>
					{/each}
				</div>

				<div class="flex flex-col lg:flex-row gap-4">
					<div class="flex-1 min-w-0 text-xs text-slate-400">
						{lineas.length} transacción{lineas.length === 1 ? '' : 'es'} seleccionada{lineas.length === 1 ? '' : 's'} · Moneda: {moneda === 'USD' ? 'Dólares' : 'Soles'} · Los montos de las transacciones ya incluyen IGV.
					</div>
					<div class="w-full lg:w-80 shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-4">
						<h3 class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Resumen</h3>
						<div class="flex flex-col gap-1.5 text-sm">
							<div class="flex justify-between"><span class="text-slate-500">Sub Total Ventas</span><span class="font-medium text-slate-700">{fmt(totales.subTotalVentas)}</span></div>
							<div class="flex justify-between"><span class="text-slate-500">Valor Venta</span><span class="font-medium text-slate-700">{fmt(totales.valorVenta)}</span></div>
							<div class="flex justify-between"><span class="text-slate-500">IGV (18%)</span><span class="font-medium text-slate-700">{fmt(totales.igv)}</span></div>
							<div class="flex justify-between"><span class="text-slate-500">Monto de redondeo</span><span class="font-medium text-slate-700">{fmt(totales.redondeo)}</span></div>
							<div class="flex justify-between pt-2 mt-1 border-t border-slate-200 text-base"><span class="font-semibold text-[#0f3b5e]">Importe Total</span><span class="font-bold text-[#0f3b5e]">{fmt(totales.importeTotal)}</span></div>
							{#if sujetaDetraccion}
								<div class="flex justify-between text-xs pt-1"><span class="text-slate-500">Monto de detracción</span><span class="font-medium text-slate-700">{fmt(totales.montoDetraccion)}</span></div>
							{/if}
						</div>
					</div>
				</div>
			</div>

			{#if !soloLectura}
				<div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 flex-shrink-0">
					<button type="button" onclick={onClose} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Cancelar</button>
					<button
						type="button"
						onclick={handleGuardarBorrador}
						disabled={!puedeContinuar || guardando || autorizando}
						class="px-4 py-2 text-sm bg-slate-700 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
					>
						{#if guardando}<Loader2 size={14} class="animate-spin" />{/if} Guardar Borrador
					</button>
					<button
						type="button"
						onclick={handleVistaPrevia}
						disabled={!puedeContinuar || guardando || autorizando}
						class="px-4 py-2 text-sm bg-[#0f3b5e] text-white rounded-lg hover:bg-[#0c2f4c] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
					>
						<Eye size={14} /> Vista previa
					</button>
				</div>
			{:else}
				<div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 flex-shrink-0">
					<button type="button" onclick={onClose} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Cerrar</button>
				</div>
			{/if}
		</div>
	</div>

	<FacturaPreviewModal open={previewOpen} datos={previewDatos} onClose={() => (previewOpen = false)} onAutorizar={handleAutorizar} {autorizando} />
	<DocumentPreviewModal open={docsOpen} documents={docsLista} title={docsTitle} onClose={() => (docsOpen = false)} />
{/if}
