/**
 * Servicio de acceso a datos para "factura" + su detalle "factura_detalle" + sus archivos emitidos
 * "factura_archivo". Recibe el SupabaseClient como parámetro; se invoca client-side con el cliente anon
 * ($lib/supabaseClient) para funcionar igual en web y en Tauri (Windows/Android) sin servidor embebido.
 *
 * Factura en el formato real de Construni, armada a partir de las transacciones de ingreso YA cobradas
 * de un cliente (documento INTERNO, sin firma digital ni OSE). Una transacción sin `id_factura` está
 * "sin facturar" (azul lino en la UI); al emitir la factura (fn_emitir_factura, atómica) queda
 * "facturada". NO se crea Cuenta por Cobrar: ese dinero ya se cobró.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ColumnFilters, FieldOption } from '$lib/shared/fieldConfig';
import { validatePayload, buildWritablePayload, translateSupabaseError, applyColumnFilters } from '$lib/shared/fieldConfig';
import { TABLE_NAME, PK_COLUMN, SEARCHABLE_COLUMNS, DEFAULT_PAGE_SIZE, DEFAULT_SORT_FIELD, DEFAULT_SORT_DIR, FIELDS_CONFIG } from '../config/factura.config';
import { getCentroCostoOptions, getComprobantesPago } from '$lib/modules/transacciones/services/transacciones.service';
import { uploadProjectDocument, deleteProjectDocumentFile } from '$lib/shared/uploadProjectDocument';
import { base64ToUint8Array } from '$lib/shared/base64';

export interface FacturaDetalle {
	id_factura_detalle: number;
	id_factura: number;
	id_transaccion: number | null;
	descripcion: string;
	unidad: string | null;
	cantidad: number;
	precio_unitario: number;
	subtotal: number;
	monto_total_linea: number | null;
	orden: number;
}

export interface Factura {
	id_factura: number;
	folio: string;
	id_cliente: number;
	cliente_nombre: string | null;
	cliente_tipo_doc: string | null;
	cliente_documento: string | null;
	cliente_direccion: string | null;
	fecha_emision: string;
	forma_pago: string;
	observacion: string | null;
	moneda: string;
	tipo_cambio: number | null;
	sub_total_ventas: number;
	anticipos: number;
	descuentos: number;
	valor_venta: number;
	isc: number;
	monto_igv: number;
	otros_cargos: number;
	otros_tributos: number;
	redondeo: number;
	monto_total: number;
	sujeta_detraccion: boolean;
	porcentaje_detraccion: number | null;
	monto_detraccion: number | null;
	detraccion_bien_servicio: string | null;
	detraccion_medio_pago: string | null;
	detraccion_cuenta_bn: string | null;
	imagen_url: string | null;
	autorizado_por: string | null;
	fecha_autorizacion: string | null;
	estado: 'borrador' | 'emitida' | 'anulada';
	activo: boolean;
	usuario_registro: string | null;
	created_at: string;
	cliente?: { nombre: string } | null;
}

export interface FacturaArchivo {
	id_archivo: number;
	id_factura: number;
	tipo: 'png' | 'pdf';
	url: string;
	nombre_archivo: string | null;
	created_at: string;
}

export interface ServiceResult<T = undefined> {
	success: boolean;
	message: string;
	data?: T;
	errors?: Record<string, string>;
}

export interface ListParams {
	page?: number;
	pageSize?: number;
	search?: string;
	sortBy?: string;
	sortDir?: 'asc' | 'desc';
	columnFilters?: ColumnFilters;
	soloEliminados?: boolean;
}

export interface ListResult<T> {
	items: T[];
	total: number;
	page: number;
	pageSize: number;
	totalPages: number;
}

const SORTABLE_KEYS = new Set(FIELDS_CONFIG.filter((f) => f.sortable).map((f) => f.key));
const FACTURA_SELECT = '*, cliente:id_cliente(nombre)';

export async function getFacturas(client: SupabaseClient, params: ListParams = {}): Promise<ListResult<Factura>> {
	const page = Math.max(1, Math.floor(params.page ?? 1));
	const pageSize = Math.max(1, Math.floor(params.pageSize ?? DEFAULT_PAGE_SIZE));
	const sortField = params.sortBy && SORTABLE_KEYS.has(params.sortBy) ? params.sortBy : DEFAULT_SORT_FIELD;
	const sortDir: 'asc' | 'desc' = params.sortDir === 'asc' || params.sortDir === 'desc' ? params.sortDir : DEFAULT_SORT_DIR;

	const from = (page - 1) * pageSize;
	const to = from + pageSize - 1;

	let query = client.from(TABLE_NAME).select(FACTURA_SELECT, { count: 'exact' }).order(sortField, { ascending: sortDir === 'asc' }).range(from, to);

	const search = params.search?.trim();
	if (search) {
		const escaped = search.replace(/[%_]/g, (m) => `\\${m}`);
		const orFilter = SEARCHABLE_COLUMNS.map((col) => `${col}.ilike.%${escaped}%`).join(',');
		query = query.or(orFilter);
	}
	query = params.soloEliminados ? query.eq('activo', false) : query.eq('activo', true);
	if (params.columnFilters) query = applyColumnFilters(query, FIELDS_CONFIG, params.columnFilters);

	const { data, error, count } = await query;
	if (error) throw error;

	const total = count ?? 0;
	return {
		items: (data ?? []) as unknown as Factura[],
		total,
		page,
		pageSize,
		totalPages: Math.max(1, Math.ceil(total / pageSize))
	};
}

export async function getFacturaConDetalle(
	client: SupabaseClient,
	idFactura: number
): Promise<{ factura: Factura; detalle: FacturaDetalle[]; archivos: FacturaArchivo[] } | null> {
	const [{ data: factura }, { data: detalle }, { data: archivos }] = await Promise.all([
		client.from(TABLE_NAME).select(FACTURA_SELECT).eq(PK_COLUMN, idFactura).maybeSingle(),
		client.from('factura_detalle').select('*').eq('id_factura', idFactura).order('orden'),
		client.from('factura_archivo').select('*').eq('id_factura', idFactura).order('created_at')
	]);
	if (!factura) return null;
	return { factura: factura as unknown as Factura, detalle: (detalle ?? []) as FacturaDetalle[], archivos: (archivos ?? []) as FacturaArchivo[] };
}

// ─────────────────────────────────────────────────────────────
// Clientes y sus transacciones (soportes) facturables
// ─────────────────────────────────────────────────────────────

export interface ClienteParaFacturar {
	id_cliente: number;
	nombre: string;
	tipo_doc: string | null;
	num_documento: string | null;
	direccion: string | null;
}

export async function getClientesParaFacturar(client: SupabaseClient): Promise<ClienteParaFacturar[]> {
	const { data, error } = await client.from('cliente').select('id_cliente, nombre, tipo_doc, num_documento, direccion').order('nombre');
	if (error) throw error;
	return (data ?? []) as ClienteParaFacturar[];
}

export async function getClienteOptions(client: SupabaseClient): Promise<FieldOption[]> {
	const clientes = await getClientesParaFacturar(client);
	return clientes.map((c) => ({ value: String(c.id_cliente), label: c.nombre }));
}

export interface TransaccionFacturable {
	id_transaccion: number;
	fecha: string;
	categoria: string | null;
	descripcion: string | null;
	num_documento: string | null;
	monto_total: number;
	tipo_moneda: string; // 'soles' | 'dolares'
	tipo_cambio: number | null;
	destinoLabel: string;
	comprobante_url: string | null;
	comprobante_autogenerado_url: string | null;
	factura_url: string | null;
	/** null = SIN FACTURA (azul lino, seleccionable); no-null = ya facturada por esa factura. */
	id_factura: number | null;
	facturaFolio: string | null;
	/** Imagen guardada en Drive de la factura EMITIDA que ya facturó esta transacción (null si no hay). */
	facturaImagenUrl: string | null;
}

/** Transacciones de ingreso (externas, activas) cuyo ORIGEN es el centro de costo del cliente — es decir,
 * lo que ese cliente ya pagó. El vínculo cliente↔transacción es `id_centro_costo_origen` → `centro_costo.
 * id_cliente` (no hay FK real en `transaccion`, por eso se resuelve en dos pasos). */
export async function getTransaccionesDelCliente(client: SupabaseClient, idCliente: number): Promise<TransaccionFacturable[]> {
	const { data: centro } = await client.from('centro_costo').select('id_centro_costo').eq('id_cliente', idCliente).maybeSingle();
	if (!centro?.id_centro_costo) return [];

	const { data, error } = await client
		.from('transaccion')
		.select('id_transaccion, fecha, categoria, descripcion, num_documento, monto_total, tipo_moneda, tipo_cambio, id_centro_costo_destino, comprobante_url, comprobante_autogenerado_url, factura_url, id_factura')
		.eq('tipo', 'ingreso')
		.eq('estado', 'activo')
		.eq('tipo_alcance', 'externa')
		.eq('id_centro_costo_origen', centro.id_centro_costo)
		.order('fecha', { ascending: false });
	if (error) throw error;
	const filas = (data ?? []) as any[];
	if (filas.length === 0) return [];

	const idsFactura = [...new Set(filas.map((t) => t.id_factura).filter((v) => v != null))];
	const [centros, facturas] = await Promise.all([
		getCentroCostoOptions(client),
		idsFactura.length > 0 ? client.from(TABLE_NAME).select('id_factura, folio, imagen_url, estado').in('id_factura', idsFactura) : Promise.resolve({ data: [] as any[] })
	]);
	const labelPorCentro = new Map(centros.map((o) => [o.value, o.label]));
	const facturasPorId = new Map<number, any>(((facturas as any).data ?? []).map((f: any) => [f.id_factura, f]));

	return filas.map((t) => ({
		id_transaccion: t.id_transaccion,
		fecha: t.fecha,
		categoria: t.categoria,
		descripcion: t.descripcion,
		num_documento: t.num_documento,
		monto_total: Number(t.monto_total ?? 0),
		tipo_moneda: t.tipo_moneda ?? 'soles',
		tipo_cambio: t.tipo_cambio != null ? Number(t.tipo_cambio) : null,
		destinoLabel: labelPorCentro.get(String(t.id_centro_costo_destino)) ?? '—',
		comprobante_url: t.comprobante_url,
		comprobante_autogenerado_url: t.comprobante_autogenerado_url,
		factura_url: t.factura_url,
		id_factura: t.id_factura ?? null,
		facturaFolio: t.id_factura != null ? (facturasPorId.get(t.id_factura)?.folio ?? null) : null,
		facturaImagenUrl: t.id_factura != null && facturasPorId.get(t.id_factura)?.estado === 'emitida' ? (facturasPorId.get(t.id_factura)?.imagen_url ?? null) : null
	}));
}

/** Soportes (documentos) de una transacción para el visor — mismo armado que openComprobantePreview en
 * finanzas/tranzacciones/+page.svelte: boucher + recibo autogenerado + factura adjunta + los
 * comprobantes de pago múltiples (transaccion_comprobante_pago). */
export async function getDocumentosTransaccion(client: SupabaseClient, t: TransaccionFacturable): Promise<{ url: string; label: string }[]> {
	const docs: { url: string; label: string }[] = [];
	if (t.comprobante_url) docs.push({ url: t.comprobante_url, label: 'Boucher' });
	if (t.comprobante_autogenerado_url) docs.push({ url: t.comprobante_autogenerado_url, label: 'Comprobante ERP' });
	if (t.factura_url) docs.push({ url: t.factura_url, label: 'Factura adjunta' });
	if (t.facturaImagenUrl) docs.push({ url: t.facturaImagenUrl, label: `Factura ${t.facturaFolio ?? ''}`.trim() });
	try {
		const extra = await getComprobantesPago(client, t.id_transaccion);
		extra.forEach((c, i) => docs.push({ url: c.url, label: c.num_documento ? `Comprobante ${c.num_documento}` : `Comprobante ${i + 1}` }));
	} catch (err) {
		console.error('[facturacion.service] No se pudieron leer los comprobantes de pago:', err);
	}
	return docs;
}

/** Documento (imagen guardada en Drive) de la factura EMITIDA que facturó una transacción — para que
 * aparezca junto al resto de sus soportes en el ojito de Transacciones. null si no hay factura emitida. */
export async function getFacturaEmitidaDocumento(client: SupabaseClient, idFactura: number): Promise<{ url: string; label: string } | null> {
	const { data } = await client.from(TABLE_NAME).select('folio, imagen_url, estado').eq(PK_COLUMN, idFactura).maybeSingle();
	if (!data?.imagen_url || data.estado !== 'emitida') return null;
	return { url: data.imagen_url, label: `Factura ${data.folio}` };
}

// ─────────────────────────────────────────────────────────────
// Totales del formato
// ─────────────────────────────────────────────────────────────

const IGV_PERU = 0.18;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Valor unitario SIN IGV de una línea, a partir del monto de la transacción (que ya incluye IGV). */
export function valorSinIgv(montoConIgv: number): number {
	return round2(Number(montoConIgv || 0) / (1 + IGV_PERU));
}

export interface TotalesFactura {
	subTotalVentas: number;
	anticipos: number;
	descuentos: number;
	valorVenta: number;
	isc: number;
	igv: number;
	otrosCargos: number;
	otrosTributos: number;
	redondeo: number;
	importeTotal: number;
	montoDetraccion: number;
}

/** Única fórmula de totales de una factura — usada TANTO en la vista previa en vivo como al guardar, para
 * que nunca puedan desincronizarse. Los montos de las transacciones YA incluyen IGV: el Importe Total es
 * exactamente la suma de lo cobrado; Valor Venta = Σ valores sin IGV de cada línea; IGV = 18% de eso; y
 * "Monto de redondeo" absorbe la diferencia de centavos para que Importe Total nunca se desvíe de lo
 * realmente cobrado. Detracción (si aplica) = Importe Total × % redondeado al sol (criterio SUNAT). */
export function calcularTotalesFactura(montosConIgv: number[], sujetaDetraccion: boolean, porcentajeDetraccion: number): TotalesFactura {
	const importeTotal = round2(montosConIgv.reduce((s, m) => s + Number(m || 0), 0));
	const subTotalVentas = round2(montosConIgv.reduce((s, m) => s + valorSinIgv(m), 0));
	const valorVenta = subTotalVentas;
	const igv = round2(valorVenta * IGV_PERU);
	const redondeo = round2(importeTotal - valorVenta - igv);
	const montoDetraccion = sujetaDetraccion ? Math.round(importeTotal * (Number(porcentajeDetraccion || 0) / 100)) : 0;
	return { subTotalVentas, anticipos: 0, descuentos: 0, valorVenta, isc: 0, igv, otrosCargos: 0, otrosTributos: 0, redondeo, importeTotal, montoDetraccion };
}

// ─────────────────────────────────────────────────────────────
// Guardar borrador / autorizar y emitir
// ─────────────────────────────────────────────────────────────

export interface LineaFactura {
	id_transaccion: number;
	descripcion: string;
	unidad: string;
	cantidad: number;
	/** Valor unitario SIN IGV (ver valorSinIgv) */
	precio_unitario: number;
	/** Monto de la transacción de origen (con IGV) */
	monto_total_linea: number;
}

export interface DatosClienteFactura {
	id_cliente: number;
	nombre: string;
	tipo_doc: string | null;
	num_documento: string | null;
	direccion: string | null;
}

async function reemplazarDetalle(client: SupabaseClient, idFactura: number, lineas: LineaFactura[]): Promise<void> {
	const { error: delError } = await client.from('factura_detalle').delete().eq('id_factura', idFactura);
	if (delError) throw delError;
	const filas = lineas.map((l, i) => ({
		id_factura: idFactura,
		id_transaccion: l.id_transaccion,
		descripcion: l.descripcion,
		unidad: l.unidad,
		cantidad: l.cantidad,
		precio_unitario: l.precio_unitario,
		monto_total_linea: l.monto_total_linea,
		orden: i
	}));
	const { error } = await client.from('factura_detalle').insert(filas);
	if (error) throw error;
}

/** Crea o actualiza una factura en 'borrador'. `moneda`/`tipo_cambio` se derivan de las transacciones
 * elegidas (no se editan a mano). Una factura ya emitida no se puede modificar. */
export async function guardarBorradorFactura(
	client: SupabaseClient,
	payload: Record<string, unknown>,
	cliente: DatosClienteFactura,
	moneda: 'PEN' | 'USD',
	tipoCambio: number | null,
	lineas: LineaFactura[],
	usuarioRegistro: string | null,
	idFactura?: number
): Promise<ServiceResult<Factura>> {
	const errors = validatePayload(FIELDS_CONFIG, payload);
	if (Object.keys(errors).length > 0) return { success: false, message: 'Revisa los campos marcados', errors };
	if (lineas.length === 0) return { success: false, message: 'Selecciona al menos una transacción para facturar.' };

	if (idFactura) {
		const { data: actual } = await client.from(TABLE_NAME).select('estado').eq(PK_COLUMN, idFactura).maybeSingle();
		if (actual && actual.estado !== 'borrador') return { success: false, message: 'Solo se puede modificar una factura en borrador.' };
	}

	const sujeta = String(payload.sujeta_detraccion ?? 'no') === 'si';
	const t = calcularTotalesFactura(lineas.map((l) => l.monto_total_linea), sujeta, Number(payload.porcentaje_detraccion || 0));
	const datos: Record<string, unknown> = {
		...buildWritablePayload(FIELDS_CONFIG, payload),
		sujeta_detraccion: sujeta,
		id_cliente: cliente.id_cliente,
		cliente_nombre: cliente.nombre,
		cliente_tipo_doc: cliente.tipo_doc,
		cliente_documento: cliente.num_documento,
		cliente_direccion: cliente.direccion,
		moneda,
		tipo_cambio: tipoCambio,
		sub_total_ventas: t.subTotalVentas,
		anticipos: t.anticipos,
		descuentos: t.descuentos,
		valor_venta: t.valorVenta,
		isc: t.isc,
		monto_igv: t.igv,
		otros_cargos: t.otrosCargos,
		otros_tributos: t.otrosTributos,
		redondeo: t.redondeo,
		monto_total: t.importeTotal,
		monto_detraccion: sujeta ? t.montoDetraccion : null
	};

	try {
		if (idFactura) {
			const { data, error } = await client.from(TABLE_NAME).update({ ...datos, updated_at: new Date().toISOString() }).eq(PK_COLUMN, idFactura).select(FACTURA_SELECT).single();
			if (error) return { success: false, message: `No se pudo actualizar la factura: ${translateSupabaseError(error, FIELDS_CONFIG)}` };
			await reemplazarDetalle(client, idFactura, lineas);
			return { success: true, message: 'Borrador actualizado', data: data as unknown as Factura };
		}

		const { data, error } = await client.from(TABLE_NAME).insert({ ...datos, usuario_registro: usuarioRegistro }).select(FACTURA_SELECT).single();
		if (error) return { success: false, message: `No se pudo crear la factura: ${translateSupabaseError(error, FIELDS_CONFIG)}` };
		try {
			await reemplazarDetalle(client, data.id_factura, lineas);
		} catch (err: any) {
			await client.from(TABLE_NAME).delete().eq(PK_COLUMN, data.id_factura);
			return { success: false, message: `No se pudo guardar el detalle de la factura: ${err?.message ?? 'error inesperado'}` };
		}
		return { success: true, message: 'Borrador guardado', data: data as unknown as Factura };
	} catch (err: any) {
		return { success: false, message: `No se pudo guardar la factura: ${err?.message ?? 'error inesperado'}` };
	}
}

const MENSAJES_EMISION: Record<string, string> = {
	TRANSACCION_YA_FACTURADA: 'Alguna de las transacciones seleccionadas ya fue facturada por otra persona. Actualiza la lista y vuelve a elegir.',
	FACTURA_SIN_TRANSACCIONES: 'La factura no tiene transacciones seleccionadas.',
	FACTURA_NO_EMITIBLE: 'Solo se puede emitir una factura en borrador.',
	FACTURA_NO_ENCONTRADA: 'No se encontró la factura.'
};

function dataUrlABytes(dataUrl: string) {
	return base64ToUint8Array(dataUrl.slice(dataUrl.indexOf(',') + 1));
}

/** Autorización final: sube la imagen (PNG) y el PDF a Google Drive, y RECIÉN entonces emite la factura
 * de forma atómica (fn_emitir_factura). Si la subida falla, la factura queda en borrador y las
 * transacciones sin tocar; si el RPC falla (ej. una transacción ya facturada), se borran los archivos
 * recién subidos (mejor esfuerzo). `pngDataUrl`/`pdfBase64` deben venir ya con el folio REAL impreso. */
export async function autorizarYEmitirFactura(
	client: SupabaseClient,
	factura: Pick<Factura, 'id_factura' | 'folio'>,
	pngDataUrl: string,
	pdfBase64: string,
	usuario: string | null
): Promise<ServiceResult<Factura>> {
	let pngUrl: string;
	let pdfUrl: string;
	try {
		const png = new File([dataUrlABytes(pngDataUrl)], `Factura_${factura.folio}.png`, { type: 'image/png' });
		const pdf = new File([base64ToUint8Array(pdfBase64)], `Factura_${factura.folio}.pdf`, { type: 'application/pdf' });
		// type 'comprobante': reutiliza la carpeta de Drive de comprobantes (no exige una carpeta/env nueva).
		const [subidoPng, subidoPdf] = await Promise.all([
			uploadProjectDocument(png, { type: 'comprobante', documentName: png.name }),
			uploadProjectDocument(pdf, { type: 'comprobante', documentName: pdf.name })
		]);
		pngUrl = subidoPng.url;
		pdfUrl = subidoPdf.url;
	} catch (err: any) {
		console.error('[facturacion.service] No se pudo subir la factura a Drive:', err);
		return { success: false, message: `No se pudo guardar la imagen de la factura: ${err?.message ?? 'error inesperado'}. La factura sigue en borrador.` };
	}

	const { data, error } = await client.rpc('fn_emitir_factura', { p_id_factura: factura.id_factura, p_imagen_url: pngUrl, p_usuario: usuario });
	if (error) {
		await Promise.allSettled([deleteProjectDocumentFile(pngUrl), deleteProjectDocumentFile(pdfUrl)]);
		const hint = (error as any).hint as string | undefined;
		return { success: false, message: (hint && MENSAJES_EMISION[hint]) || `No se pudo emitir la factura: ${translateSupabaseError(error, FIELDS_CONFIG)}` };
	}

	const { error: archivoError } = await client.from('factura_archivo').insert([
		{ id_factura: factura.id_factura, tipo: 'png', url: pngUrl, nombre_archivo: `Factura_${factura.folio}.png`, usuario_registro: usuario },
		{ id_factura: factura.id_factura, tipo: 'pdf', url: pdfUrl, nombre_archivo: `Factura_${factura.folio}.pdf`, usuario_registro: usuario }
	]);
	if (archivoError) console.error('[facturacion.service] La factura se emitió pero no se registró en factura_archivo:', archivoError);

	return { success: true, message: 'Factura emitida y guardada correctamente', data: data as unknown as Factura };
}

// ─────────────────────────────────────────────────────────────
// KPIs
// ─────────────────────────────────────────────────────────────

export interface KpisFacturacion {
	totalFacturadoMes: number;
	porFacturar: number;
	porFacturarCount: number;
	detraccionesAcumuladas: number;
	facturasEmitidas: number;
}

export async function getKpisFacturacion(client: SupabaseClient): Promise<KpisFacturacion> {
	const inicioMes = new Date();
	inicioMes.setDate(1);
	inicioMes.setHours(0, 0, 0, 0);
	const inicioMesStr = inicioMes.toISOString().slice(0, 10);

	const [{ data: emitidas }, { data: centrosCliente }] = await Promise.all([
		client.from(TABLE_NAME).select('monto_total, monto_detraccion, fecha_emision').eq('activo', true).eq('estado', 'emitida'),
		client.from('centro_costo').select('id_centro_costo').not('id_cliente', 'is', null)
	]);

	const totalFacturadoMes = (emitidas ?? []).filter((f: any) => f.fecha_emision >= inicioMesStr).reduce((s: number, f: any) => s + Number(f.monto_total ?? 0), 0);
	const detraccionesAcumuladas = (emitidas ?? []).reduce((s: number, f: any) => s + Number(f.monto_detraccion ?? 0), 0);

	let porFacturar = 0;
	let porFacturarCount = 0;
	const idsCentros = (centrosCliente ?? []).map((c: any) => c.id_centro_costo);
	if (idsCentros.length > 0) {
		const { data: pendientes } = await client
			.from('transaccion')
			.select('monto_total')
			.eq('tipo', 'ingreso')
			.eq('estado', 'activo')
			.eq('tipo_alcance', 'externa')
			.is('id_factura', null)
			.in('id_centro_costo_origen', idsCentros);
		porFacturar = (pendientes ?? []).reduce((s: number, t: any) => s + Number(t.monto_total ?? 0), 0);
		porFacturarCount = (pendientes ?? []).length;
	}

	return { totalFacturadoMes, porFacturar, porFacturarCount, detraccionesAcumuladas, facturasEmitidas: (emitidas ?? []).length };
}

// ─────────────────────────────────────────────────────────────
// Dar de baja / restaurar / eliminar
// ─────────────────────────────────────────────────────────────

/** Da de baja una factura (oculta de la lista, sin contraseña). Un borrador simplemente se oculta. Una
 * EMITIDA pasa a 'anulada' y libera sus transacciones (id_factura=null → vuelven a azul lino y se pueden
 * facturar de nuevo) — no se puede restaurar (ver restaurarFactura): se emite una nueva. */
export async function darDeBajaFactura(client: SupabaseClient, id: number): Promise<ServiceResult> {
	const { data: factura } = await client.from(TABLE_NAME).select('estado').eq(PK_COLUMN, id).maybeSingle();
	if (!factura) return { success: false, message: 'Factura no encontrada.' };

	if (factura.estado === 'emitida') {
		const { error: libError } = await client.from('transaccion').update({ id_factura: null }).eq('id_factura', id);
		if (libError) return { success: false, message: `No se pudieron liberar las transacciones de la factura: ${libError.message}` };
	}
	const cambios = factura.estado === 'emitida' ? { activo: false, estado: 'anulada' } : { activo: false };
	const { error } = await client.from(TABLE_NAME).update(cambios).eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo dar de baja la factura: ${error.message}` };
	return { success: true, message: 'Factura dada de baja correctamente' };
}

export async function restaurarFactura(client: SupabaseClient, id: number): Promise<ServiceResult> {
	const { data: factura } = await client.from(TABLE_NAME).select('estado').eq(PK_COLUMN, id).maybeSingle();
	if (factura?.estado === 'anulada') {
		return { success: false, message: 'Una factura anulada no se puede restaurar (sus transacciones ya fueron liberadas). Emite una factura nueva.' };
	}
	const { error } = await client.from(TABLE_NAME).update({ activo: true }).eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo restaurar la factura: ${error.message}` };
	return { success: true, message: 'Factura restaurada correctamente' };
}

/** Elimina PERMANENTEMENTE una factura, su detalle y sus archivos (ON DELETE CASCADE) — las
 * transacciones que había facturado quedan libres (transaccion.id_factura ON DELETE SET NULL). Se llama
 * solo desde AdminConfirmModal (contraseña de administrador), ver +page.svelte. Las imágenes en Drive se
 * borran en mejor esfuerzo. */
export async function eliminarFacturaPermanente(client: SupabaseClient, id: number): Promise<ServiceResult> {
	const { data: archivos } = await client.from('factura_archivo').select('url').eq('id_factura', id);
	const { error } = await client.from(TABLE_NAME).delete().eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo eliminar la factura: ${error.message}` };
	await Promise.allSettled((archivos ?? []).map((a: any) => deleteProjectDocumentFile(a.url)));
	return { success: true, message: 'Factura eliminada permanentemente' };
}
