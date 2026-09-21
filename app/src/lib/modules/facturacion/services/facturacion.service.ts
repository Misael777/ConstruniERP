/**
 * Servicio de acceso a datos para "factura" + su detalle "factura_detalle".
 * Recibe el SupabaseClient como parámetro; se invoca client-side con el cliente anon
 * ($lib/supabaseClient) para funcionar igual en web y en Tauri (Windows/Android) sin
 * servidor embebido — mismo criterio que el resto de Finanzas. La BD no tiene RLS real todavía.
 *
 * Documento INTERNO de facturación/valorización (no un comprobante electrónico SUNAT — sin serie/
 * correlativo oficial ni OSE). Al "emitir" una factura se crea/vincula una Cuenta por Cobrar real
 * (ver emitirFactura) — el seguimiento de cobro/estado (Pagado/Pendiente/Vencido) NUNCA se duplica
 * acá, siempre se lee de esa cuenta vinculada (mismo criterio que evitó el bug de "Pagado
 * incorrecto" ya corregido varias veces para Cuentas por Cobrar esta sesión).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ColumnFilters, FieldOption } from '$lib/shared/fieldConfig';
import { validatePayload, buildWritablePayload, translateSupabaseError, applyColumnFilters } from '$lib/shared/fieldConfig';
import { TABLE_NAME, PK_COLUMN, SEARCHABLE_COLUMNS, DEFAULT_PAGE_SIZE, DEFAULT_SORT_FIELD, DEFAULT_SORT_DIR, FIELDS_CONFIG } from '../config/factura.config';
import { generarCodigoProyecto } from '$lib/shared/codigoProyecto';
import { getOrCrearCentroCostoParaEntidad } from '$lib/modules/centro-costos/services/centroCostos.service';
import { createCuentaCobrar, darDeBajaCuentaCobrar } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';

export interface FacturaDetalle {
	id_factura_detalle: number;
	id_factura: number;
	id_partida: number | null;
	codigo: string | null;
	descripcion: string;
	unidad: string | null;
	cantidad: number;
	precio_unitario: number;
	subtotal: number;
	orden: number;
}

export interface Factura {
	id_factura: number;
	folio: string;
	id_proyecto: number;
	id_cliente: number;
	tipo_comprobante: 'factura' | 'boleta';
	tipo_factura: string;
	numero_valorizacion: number | null;
	fecha_emision: string;
	fecha_vencimiento: string | null;
	moneda: string;
	tipo_cambio: number | null;
	subtotal: number;
	porcentaje_amortizacion: number;
	monto_amortizacion: number;
	porcentaje_retencion_garantia: number;
	monto_retencion_garantia: number;
	monto_igv: number;
	monto_total: number;
	estado: 'borrador' | 'emitida' | 'anulada';
	comentarios: string | null;
	id_cuenta_cobrar: number | null;
	activo: boolean;
	usuario_registro: string | null;
	created_at: string;
	proyecto?: { nombre_proyecto: string } | null;
	cliente?: { nombre: string; tipo_doc: string | null; num_documento: string | null } | null;
	/** Solo viene poblado cuando la factura ya está 'emitida' (ver getFacturas) — la fuente única de
	 * verdad del estado de pago real (Pagado/Pendiente/Vencido), nunca recalculada acá. */
	cuenta_cobrar_vinculada?: { estado: string; monto_cobrado: number; saldo_pendiente: number } | null;
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
const FACTURA_SELECT = '*, proyecto:id_proyecto(nombre_proyecto), cliente:id_cliente(nombre, tipo_doc, num_documento), cuenta_cobrar_vinculada:id_cuenta_cobrar(estado, monto_cobrado, saldo_pendiente)';

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

/** "Estado" a mostrar en la lista/badges: el de la Cuenta por Cobrar vinculada (Pendiente/Pagado/
 * Vencido) una vez emitida — nunca se recalcula acá, siempre se lee tal cual esa fuente única de
 * verdad. Borrador/Anulada son propios de la factura (nunca tienen cuenta vinculada real). */
export function estadoVisibleFactura(factura: Factura): string {
	if (factura.estado === 'borrador' || factura.estado === 'anulada') return factura.estado;
	return factura.cuenta_cobrar_vinculada?.estado ?? 'pendiente';
}

export interface KpisFacturacion {
	totalFacturadoMes: number;
	porCobrarObra: number;
	retencionesAcumuladas: number;
	facturasVencidas: number;
}

export async function getKpisFacturacion(client: SupabaseClient): Promise<KpisFacturacion> {
	const inicioMes = new Date();
	inicioMes.setDate(1);
	inicioMes.setHours(0, 0, 0, 0);
	const inicioMesStr = inicioMes.toISOString().slice(0, 10);

	const [{ data: delMes }, { data: emitidas }] = await Promise.all([
		client.from(TABLE_NAME).select('monto_total').eq('activo', true).eq('estado', 'emitida').gte('fecha_emision', inicioMesStr),
		client
			.from(TABLE_NAME)
			.select('monto_retencion_garantia, id_cuenta_cobrar, proyecto:id_proyecto(tipo_venta), cuenta_cobrar_vinculada:id_cuenta_cobrar(estado, saldo_pendiente)')
			.eq('activo', true)
			.eq('estado', 'emitida')
	]);

	const totalFacturadoMes = (delMes ?? []).reduce((sum: number, r: any) => sum + Number(r.monto_total ?? 0), 0);
	const retencionesAcumuladas = (emitidas ?? []).reduce((sum: number, r: any) => sum + Number(r.monto_retencion_garantia ?? 0), 0);
	const porCobrarObra = (emitidas ?? [])
		.filter((r: any) => r.proyecto?.tipo_venta === 'obra')
		.reduce((sum: number, r: any) => sum + Number(r.cuenta_cobrar_vinculada?.saldo_pendiente ?? 0), 0);
	const facturasVencidas = (emitidas ?? []).filter((r: any) => r.cuenta_cobrar_vinculada?.estado === 'vencido').length;

	return { totalFacturadoMes, porCobrarObra, retencionesAcumuladas, facturasVencidas };
}

export interface ProyectoParaFacturar {
	id_proyecto: number;
	id_cliente: number;
	codigo: string;
	nombre_proyecto: string;
	tipo_venta: string;
	cliente: { nombre: string; tipo_doc: string | null; num_documento: string | null } | null;
}

/** Solo proyectos con venta ya cerrada — mismo criterio que getProyectoOptions en
 * cuentasCobrar.service.ts (una factura corresponde a una venta confirmada, no a una en negociación). */
export async function getProyectosParaFacturar(client: SupabaseClient): Promise<ProyectoParaFacturar[]> {
	const { data, error } = await client
		.from('proyecto')
		.select(
			'id_proyecto, id_cliente, nombre_proyecto, tipo_venta, tip_proyecto, estado_predio, tipo_edifica, tipo_obra, tipo_tramite, tipo_intervencion, tipo_edificacion_obra, mes_obra, anio_obra, nro_pisos, distrito, ubicacion, fecha_inicio_plan, created_at, cliente:id_cliente(nombre, tipo_doc, num_documento)'
		)
		.eq('estado_proyecto', 'venta_cerrada')
		.order('fecha_inicio_plan', { ascending: false });
	if (error) throw error;
	return (data ?? []).map((p: any) => ({
		id_proyecto: p.id_proyecto,
		id_cliente: p.id_cliente,
		codigo: generarCodigoProyecto(p),
		nombre_proyecto: p.nombre_proyecto,
		tipo_venta: p.tipo_venta,
		cliente: p.cliente ?? null
	}));
}

export interface PartidaFacturable {
	id_partida: number;
	codigo: string;
	descripcion: string;
	unidad: string | null;
	precio_unitario_sugerido: number;
}

/** Partidas "hoja" (sin hijos) del presupuesto vigente del proyecto — las únicas con cantidad/precio
 * real facturable, mismo criterio de árbol que PresupuestoTab.svelte. Un proyecto sin presupuesto
 * cargado (ej. Consultoría, que normalmente no usa esta tabla) devuelve [] — la línea de la factura
 * se puede escribir a mano en ese caso (ver FacturaModal.svelte). */
export async function getPartidasFacturables(client: SupabaseClient, idProyecto: number): Promise<PartidaFacturable[]> {
	const { data: pres } = await client
		.from('presupuesto')
		.select('id_presupuesto')
		.eq('id_proyecto', idProyecto)
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();
	if (!pres?.id_presupuesto) return [];

	const { data: rows, error } = await client
		.from('presupuesto_detalle')
		.select('id_partida, precio_unitario, partida:id_partida(codigo, descripcion, unidad, id_partida_padre)')
		.eq('id_presupuesto', pres.id_presupuesto);
	if (error) throw error;

	const filas = (rows ?? []).filter((r: any) => r.partida) as any[];
	// Una fila es "hoja" si ningún OTRO detalle del mismo presupuesto la tiene como padre — es decir,
	// su id_partida nunca aparece en el id_partida_padre de otra fila de este mismo presupuesto.
	const idsQueSonPadres = new Set(filas.map((r) => r.partida.id_partida_padre).filter((v: unknown) => v != null));

	return filas
		.filter((r) => !idsQueSonPadres.has(r.id_partida))
		.map((r) => ({
			id_partida: r.id_partida,
			codigo: r.partida.codigo,
			descripcion: r.partida.descripcion,
			unidad: r.partida.unidad,
			precio_unitario_sugerido: Number(r.precio_unitario ?? 0)
		}));
}

export interface TotalesFactura {
	subtotal: number;
	montoAmortizacion: number;
	montoRetencionGarantia: number;
	montoIgv: number;
	montoTotal: number;
}

const IGV_PERU = 0.18;

/** Única fórmula de totales de una factura — usada TANTO en la vista previa en vivo del modal como al
 * guardar en el service, para que nunca puedan desincronizarse. Orden (igual al mockup de referencia):
 * Subtotal -> (-) Amortización -> (-) Retención -> base para IGV -> (+) IGV -> Total a Pagar. */
export function calcularTotalesFactura(
	detalle: { cantidad: number; precio_unitario: number }[],
	porcentajeAmortizacion: number,
	porcentajeRetencionGarantia: number
): TotalesFactura {
	const subtotal = detalle.reduce((sum, d) => sum + Number(d.cantidad || 0) * Number(d.precio_unitario || 0), 0);
	const montoAmortizacion = subtotal * (Number(porcentajeAmortizacion || 0) / 100);
	const montoRetencionGarantia = subtotal * (Number(porcentajeRetencionGarantia || 0) / 100);
	const baseIgv = Math.max(subtotal - montoAmortizacion - montoRetencionGarantia, 0);
	const montoIgv = baseIgv * IGV_PERU;
	const montoTotal = baseIgv + montoIgv;
	return { subtotal, montoAmortizacion, montoRetencionGarantia, montoIgv, montoTotal };
}

type DetalleInput = { id_partida: number | null; codigo: string | null; descripcion: string; unidad: string | null; cantidad: number; precio_unitario: number };

async function reemplazarDetalle(client: SupabaseClient, idFactura: number, detalle: DetalleInput[]): Promise<void> {
	await client.from('factura_detalle').delete().eq('id_factura', idFactura);
	if (detalle.length === 0) return;
	const filas = detalle.map((d, i) => ({ id_factura: idFactura, orden: i, ...d }));
	const { error } = await client.from('factura_detalle').insert(filas);
	if (error) throw error;
}

/** Crea o actualiza una factura en estado 'borrador' (o mantiene su estado si ya era 'emitida' — no
 * debería llamarse para una emitida desde la UI, pero no lo fuerza acá). Reemplaza factura_detalle
 * completo (delete+insert) en vez de diffear fila por fila — mucho más simple y las líneas de una
 * factura no tienen historial propio que preservar. */
export async function guardarBorradorFactura(
	client: SupabaseClient,
	payload: Record<string, unknown>,
	detalle: DetalleInput[],
	usuarioRegistro: string | null,
	idFactura?: number
): Promise<ServiceResult<Factura>> {
	const errors = validatePayload(FIELDS_CONFIG, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}
	if (detalle.length === 0) {
		return { success: false, message: 'Agrega al menos una partida antes de guardar.' };
	}

	const totales = calcularTotalesFactura(detalle, Number(payload.porcentaje_amortizacion || 0), Number(payload.porcentaje_retencion_garantia || 0));
	const datos: Record<string, unknown> = {
		...buildWritablePayload(FIELDS_CONFIG, payload),
		id_proyecto: Number(payload.id_proyecto),
		id_cliente: Number(payload.id_cliente),
		subtotal: totales.subtotal,
		monto_amortizacion: totales.montoAmortizacion,
		monto_retencion_garantia: totales.montoRetencionGarantia,
		monto_igv: totales.montoIgv,
		monto_total: totales.montoTotal
	};

	if (idFactura) {
		const { data, error } = await client.from(TABLE_NAME).update(datos).eq(PK_COLUMN, idFactura).select(FACTURA_SELECT).single();
		if (error) return { success: false, message: `No se pudo actualizar la factura: ${translateSupabaseError(error, FIELDS_CONFIG)}` };
		await reemplazarDetalle(client, idFactura, detalle);
		return { success: true, message: 'Borrador actualizado', data: data as unknown as Factura };
	}

	const { data, error } = await client
		.from(TABLE_NAME)
		.insert({ ...datos, usuario_registro: usuarioRegistro })
		.select(FACTURA_SELECT)
		.single();
	if (error) return { success: false, message: `No se pudo crear la factura: ${translateSupabaseError(error, FIELDS_CONFIG)}` };
	await reemplazarDetalle(client, data.id_factura, detalle);
	return { success: true, message: 'Borrador guardado', data: data as unknown as Factura };
}

/** Segundo paso: pasa la factura a 'emitida' y, si todavía no tiene una Cuenta por Cobrar vinculada,
 * la crea — reutiliza createCuentaCobrar (cuentasCobrar.service.ts) TAL CUAL, así el seguimiento de
 * cobro/estado nunca se duplica. Necesita el Centro de Costo del proyecto — reutiliza
 * getOrCrearCentroCostoParaEntidad, mismo helper que ya usa cerrarVentaAprobada. */
export async function emitirFactura(client: SupabaseClient, idFactura: number, usuarioRegistro: string | null, usuarioNombre: string | null): Promise<ServiceResult<Factura>> {
	const { data: factura, error: fetchError } = await client.from(TABLE_NAME).select(FACTURA_SELECT).eq(PK_COLUMN, idFactura).single();
	if (fetchError || !factura) return { success: false, message: fetchError?.message || 'Factura no encontrada.' };
	const f = factura as unknown as Factura;
	if (f.estado === 'anulada') return { success: false, message: 'Esta factura está anulada.' };
	if (f.estado === 'emitida') return { success: true, message: 'La factura ya estaba emitida', data: f };

	let idCuentaCobrar = f.id_cuenta_cobrar;
	if (!idCuentaCobrar) {
		const idCentroCosto = await getOrCrearCentroCostoParaEntidad(client, 'proyecto', f.id_proyecto, f.proyecto?.nombre_proyecto ?? `Proyecto #${f.id_proyecto}`);
		if (!idCentroCosto) return { success: false, message: 'No se pudo obtener el centro de costo del proyecto.' };

		const resultCuenta = await createCuentaCobrar(
			client,
			{
				id_cliente: String(f.id_cliente),
				id_centro_costo: String(idCentroCosto),
				id_proyecto: String(f.id_proyecto),
				tipo_documento: f.tipo_comprobante === 'factura' ? '1' : '2',
				num_documento: f.folio,
				// factura.monto_total ya está denominado en factura.moneda (los precios unitarios de las
				// líneas se cargan directamente en esa moneda) — a diferencia de cuentas_cobrar.monto, que
				// SIEMPRE es el equivalente en Soles (ver disabledValue de 'monto' en cuentaCobrar.config.ts,
				// que lo recalcula solo como monto_dolares × tipo_cambio cuando moneda='USD'). Por eso acá
				// 'monto' se manda tal cual solo importa cuando moneda=PEN (con USD queda bloqueado y el
				// motor lo recalcula solo); monto_dolares es el propio monto_total, sin dividir de nuevo.
				monto: String(f.monto_total),
				moneda: f.moneda === 'USD' ? 'USD' : 'PEN',
				monto_dolares: f.moneda === 'USD' ? String(f.monto_total) : '',
				tipo_cambio: f.tipo_cambio != null ? String(f.tipo_cambio) : '',
				fecha_emision: f.fecha_emision,
				fecha_vencimiento: f.fecha_vencimiento ?? '',
				responsable: usuarioNombre ?? '',
				observaciones: `Factura ${f.folio} - ${f.tipo_factura}`
			},
			usuarioRegistro
		);
		if (!resultCuenta.success || !resultCuenta.data) {
			return { success: false, message: `No se pudo generar la Cuenta por Cobrar: ${resultCuenta.message}` };
		}
		idCuentaCobrar = resultCuenta.data.id_cuenta_cobrar;
	}

	const { data, error } = await client
		.from(TABLE_NAME)
		.update({ estado: 'emitida', id_cuenta_cobrar: idCuentaCobrar })
		.eq(PK_COLUMN, idFactura)
		.select(FACTURA_SELECT)
		.single();
	if (error) return { success: false, message: `No se pudo emitir la factura: ${translateSupabaseError(error, FIELDS_CONFIG)}` };
	return { success: true, message: 'Factura emitida correctamente', data: data as unknown as Factura };
}

export async function getFacturaConDetalle(client: SupabaseClient, idFactura: number): Promise<{ factura: Factura; detalle: FacturaDetalle[] } | null> {
	const [{ data: factura }, { data: detalle }] = await Promise.all([
		client.from(TABLE_NAME).select(FACTURA_SELECT).eq(PK_COLUMN, idFactura).maybeSingle(),
		client.from('factura_detalle').select('*').eq('id_factura', idFactura).order('orden')
	]);
	if (!factura) return null;
	return { factura: factura as unknown as Factura, detalle: (detalle ?? []) as FacturaDetalle[] };
}

/** Da de baja una factura (oculta de la lista, reversible, sin contraseña) — mismo patrón que
 * darDeBajaCuentaCobrar. Si estaba emitida y su Cuenta por Cobrar todavía no tiene cobros reales, se
 * da de baja también esa cuenta (mismo criterio de "todo o nada" de otros flujos vinculados de esta
 * sesión); si ya tiene cobros reales, la factura igual se da de baja pero la cuenta se deja intacta
 * (hay plata real de por medio, no se toca). */
export async function darDeBajaFactura(client: SupabaseClient, id: number): Promise<ServiceResult> {
	const { data: factura } = await client.from(TABLE_NAME).select('id_cuenta_cobrar').eq(PK_COLUMN, id).maybeSingle();
	const { error } = await client.from(TABLE_NAME).update({ activo: false }).eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo dar de baja la factura: ${error.message}` };

	if (factura?.id_cuenta_cobrar) {
		const { data: cuenta } = await client.from('cuentas_cobrar').select('monto_cobrado').eq('id_cuenta_cobrar', factura.id_cuenta_cobrar).maybeSingle();
		if (!cuenta || Number(cuenta.monto_cobrado ?? 0) === 0) {
			await darDeBajaCuentaCobrar(client, factura.id_cuenta_cobrar);
		}
	}
	return { success: true, message: 'Factura dada de baja correctamente' };
}

export async function restaurarFactura(client: SupabaseClient, id: number): Promise<ServiceResult> {
	const { error } = await client.from(TABLE_NAME).update({ activo: true }).eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo restaurar la factura: ${error.message}` };
	return { success: true, message: 'Factura restaurada correctamente' };
}

/** Elimina PERMANENTEMENTE una factura y su detalle (factura_detalle cae por ON DELETE CASCADE) —
 * bloqueada si su Cuenta por Cobrar vinculada ya tiene cobros reales registrados, mismo criterio de
 * guarda ya usado para las cuentas de Préstamo esta sesión (no se puede deshacer algo con plata real
 * detrás). Se llama solo desde AdminConfirmModal (contraseña de administrador), ver +page.svelte. */
export async function eliminarFacturaPermanente(client: SupabaseClient, id: number): Promise<ServiceResult> {
	const { data: factura } = await client.from(TABLE_NAME).select('id_cuenta_cobrar').eq(PK_COLUMN, id).maybeSingle();
	if (factura?.id_cuenta_cobrar) {
		const { data: cuenta } = await client.from('cuentas_cobrar').select('monto_cobrado').eq('id_cuenta_cobrar', factura.id_cuenta_cobrar).maybeSingle();
		if (cuenta && Number(cuenta.monto_cobrado ?? 0) > 0) {
			return { success: false, message: 'No se puede eliminar: la Cuenta por Cobrar vinculada ya tiene cobros reales registrados. Usa "Dar de baja" en su lugar.' };
		}
	}
	const { error } = await client.from(TABLE_NAME).delete().eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo eliminar la factura: ${error.message}` };
	if (factura?.id_cuenta_cobrar) {
		await client.from('cuentas_cobrar').delete().eq('id_cuenta_cobrar', factura.id_cuenta_cobrar);
	}
	return { success: true, message: 'Factura eliminada permanentemente' };
}

export async function getClienteOptions(client: SupabaseClient): Promise<FieldOption[]> {
	const { data, error } = await client.from('cliente').select('id_cliente, nombre').order('nombre');
	if (error) throw error;
	return (data ?? []).map((c: any) => ({ value: String(c.id_cliente), label: c.nombre }));
}
