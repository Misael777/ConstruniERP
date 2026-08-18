/**
 * Servicio de acceso a datos para "transaccion" + su detalle "trans_detalle".
 * Recibe el SupabaseClient como parámetro; se invoca client-side con el cliente anon
 * ($lib/supabaseClient) para funcionar igual en web y en Tauri (Windows/Android) sin
 * servidor embebido. AJUSTAR: la BD no tiene RLS real todavía, ver nota en +page.svelte.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FieldOption } from '$lib/shared/fieldConfig';
import { validatePayload, buildWritablePayload, translateSupabaseError } from '$lib/shared/fieldConfig';
import {
	TABLE_NAME,
	PK_COLUMN,
	SEARCHABLE_COLUMNS,
	DEFAULT_PAGE_SIZE,
	DEFAULT_SORT_FIELD,
	DEFAULT_SORT_DIR,
	FIELDS_CONFIG
} from '../config/transaccion.config';
import {
	TABLE_NAME as DETALLE_TABLE,
	PK_COLUMN as DETALLE_PK,
	PARENT_FK_COLUMN,
	FIELDS_CONFIG as DETALLE_FIELDS
} from '../config/transDetalle.config';
// Import "cruzado": cuentasCobrar/cuentasPagar también importan de este archivo (createTransaccion,
// construirPayloadTransaccionPor*). Es un ciclo de módulos seguro porque ambos lados solo usan estas
// funciones DENTRO de otras funciones (nunca en el top-level), ver deleteTransaccion más abajo.
import { recalcularCuentaCobrar } from '../../cuentas-cobrar/services/cuentasCobrar.service';
import { recalcularCuentaPagar } from '../../cuentas-pagar/services/cuentasPagar.service';
import { getOrCrearCentroCostoParaEntidad } from '../../centro-costos/services/centroCostos.service';

export interface Transaccion {
	id_transaccion: number;
	id_centro_costo_origen: number;
	id_centro_costo_destino: number;
	fecha: string;
	id_nombre: string | null;
	tipo_documento: string | null;
	num_documento: string | null;
	tipo_transaccion: string | null;
	forma_pago: string | null;
	descripcion: string | null;
	tipo: string | null;
	monto_total: number;
	medio_pago: string | null;
	cuente_origen: string | null;
	cuente_destino: string | null;
	estado: string | null;
	usuario_registro: string | null;
	created_at: string;
	/** Comprobante (imagen o PDF) de respaldo, subido a Google Drive — ver TransaccionModal.svelte.
	 * Toda transacción debe tener uno; nullable solo por transacciones creadas antes de esta migración. */
	comprobante_url: string | null;
	/** Factura o boleta de venta — adjunto SEPARADO y OPCIONAL del comprobante de pago, ver
	 * transaccion_factura_migration.sql. A diferencia de comprobante_url, nunca es obligatorio. */
	factura_url: string | null;
	/** true = un administrador confirmó que el comprobante es correcto. A partir de ahí, ni esta
	 * transacción ni la cuenta por pagar/cobrar ni el cobro/pago vinculados se pueden editar/eliminar
	 * salvo por un administrador — ver updateTransaccion/deleteTransaccion y BLOQUEADO_POR_APROBACION
	 * en cuentasCobrar.service.ts/cuentasPagar.service.ts. */
	aprobado: boolean;
	aprobado_por: string | null;
	aprobado_en: string | null;
	/** 'interna' = movimiento entre dos centros de costo propios (Tipo se fuerza a 'transferencia' y
	 * queda bloqueado); 'externa' = con un tercero, el formulario funciona igual que siempre. Ver
	 * TransaccionModal.svelte y transaccion_tipo_alcance_migration.sql. */
	tipo_alcance: 'interna' | 'externa' | null;
}

export interface TransDetalle {
	id_trans_detalle: number;
	id_transaccion: number;
	id_partida: number | null;
	cantidad: number | null;
	precio_unitario: number | null;
	monto_igv: number | null;
	porc_detraccion: number | null;
	monto_detraccion: number | null;
	subtotal: number | null;
	usuario_registro: string | null;
	created_at: string;
}

export interface ListParams {
	page?: number;
	pageSize?: number;
	search?: string;
	sortBy?: string;
	sortDir?: 'asc' | 'desc';
}

export interface ListResult<T> {
	items: T[];
	total: number;
	page: number;
	pageSize: number;
	totalPages: number;
}

export interface ServiceResult<T = undefined> {
	success: boolean;
	message: string;
	data?: T;
	errors?: Record<string, string>;
}

const SORTABLE_KEYS = new Set(FIELDS_CONFIG.filter((f) => f.sortable).map((f) => f.key));

const BLOQUEADO_POR_APROBACION =
	'No se puede modificar/eliminar: el comprobante ya fue aprobado por un administrador. Solo un administrador puede hacerlo.';

/** `estado` ya no es un <select> manual en el formulario (a pedido del usuario, ver TransaccionModal.svelte)
 * — se calcula solo acá: 'consulta' mientras el Alcance sea Interna (mismo comportamiento que antes
 * forzaba el formulario), 'anulado' se preserva tal cual (solo anularTransaccion/reactivarTransaccion
 * lo cambian), y 'activo' en cualquier otro caso. */
function resolveEstadoTransaccion(tipoAlcance: string, estadoActual: string | null | undefined): string {
	if (tipoAlcance === 'interna') return 'consulta';
	if (estadoActual === 'anulado') return 'anulado';
	return 'activo';
}

export async function getTransacciones(client: SupabaseClient, params: ListParams = {}): Promise<ListResult<Transaccion>> {
	const page = Math.max(1, Math.floor(params.page ?? 1));
	const pageSize = Math.max(1, Math.floor(params.pageSize ?? DEFAULT_PAGE_SIZE));
	const sortField = params.sortBy && SORTABLE_KEYS.has(params.sortBy) ? params.sortBy : DEFAULT_SORT_FIELD;
	const sortDir: 'asc' | 'desc' = params.sortDir === 'asc' || params.sortDir === 'desc' ? params.sortDir : DEFAULT_SORT_DIR;

	const from = (page - 1) * pageSize;
	const to = from + pageSize - 1;

	let query = client
		.from(TABLE_NAME)
		.select('*', { count: 'exact' })
		.order(sortField, { ascending: sortDir === 'asc' })
		.range(from, to);

	const search = params.search?.trim();
	if (search) {
		const escaped = search.replace(/[%_]/g, (m) => `\\${m}`);
		const orFilter = SEARCHABLE_COLUMNS.map((col) => `${col}.ilike.%${escaped}%`).join(',');
		query = query.or(orFilter);
	}

	const { data, error, count } = await query;
	if (error) throw error;

	const total = count ?? 0;
	return {
		items: (data ?? []) as Transaccion[],
		total,
		page,
		pageSize,
		totalPages: Math.max(1, Math.ceil(total / pageSize))
	};
}

/** Trae TODAS las transacciones activas (sin paginar) — solo para la vista Calendario de
 * /finanzas/tranzacciones, que necesita ver el mes/semana completos de un vistazo, no una página a
 * la vez. Mismo criterio de volumen que movimientosCaja.service.ts: al tamaño actual del ERP esto es
 * instantáneo; si el histórico crece mucho, esto debería acotarse a un rango de fechas en el servidor. */
export async function getTransaccionesCalendario(client: SupabaseClient): Promise<Transaccion[]> {
	const { data, error } = await client.from(TABLE_NAME).select('*').eq('estado', 'activo').order('fecha', { ascending: true });
	if (error) throw error;
	return (data ?? []) as Transaccion[];
}

/** Reprograma la fecha de una o más transacciones (drag-and-drop en la vista Calendario de
 * /finanzas/tranzacciones) — 1 update por fila, mismo patrón que actualizarFechasVencimientoCobro/Pago
 * en panoramas.service.ts. Solo cambia `fecha`; no recalcula cobros/pagos vinculados. */
export async function actualizarFechasTransacciones(
	client: SupabaseClient,
	cambios: { id: number; fecha: string }[]
): Promise<{ success: boolean; message: string }> {
	const results = await Promise.all(cambios.map((c) => client.from(TABLE_NAME).update({ fecha: c.fecha }).eq(PK_COLUMN, c.id)));
	const failed = results.find((r) => r.error);
	if (failed?.error) return { success: false, message: `No se pudieron actualizar las fechas: ${failed.error.message}` };
	return { success: true, message: 'Fechas actualizadas' };
}

export async function createTransaccion(
	client: SupabaseClient,
	payload: Record<string, unknown>,
	usuarioRegistro: string | null,
	usuarioNombre: string | null = null
): Promise<ServiceResult<Transaccion>> {
	const errors = validatePayload(FIELDS_CONFIG, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}
	// comprobante_url no vive en FIELDS_CONFIG (lo sube TransaccionModal.svelte a Google Drive antes de
	// llamar aquí, ver uploadComprobante) — toda transacción debe tener uno, se valida server-side
	// también por si algún día se llama a esto desde otro lado que no sea ese modal.
	if (!payload.comprobante_url) {
		return { success: false, message: 'Debes adjuntar el comprobante (imagen o PDF) de esta transacción.' };
	}

	const insertData = {
		...buildWritablePayload(FIELDS_CONFIG, payload),
		usuario_registro: usuarioRegistro,
		// id_nombre no es editable (showInForm:false): siempre es el nombre de quien inició sesión.
		id_nombre: usuarioNombre ? usuarioNombre.slice(0, 20) : null,
		comprobante_url: payload.comprobante_url as string,
		// factura_url tampoco vive en FIELDS_CONFIG (mismo criterio que comprobante_url) — a diferencia
		// de ese, es opcional, así que null es un valor válido, no solo string.
		factura_url: (payload.factura_url as string | null) ?? null,
		// estado tampoco vive en FIELDS_CONFIG (showInForm:false) — ver resolveEstadoTransaccion.
		estado: resolveEstadoTransaccion(String(payload.tipo_alcance ?? ''), null)
	};

	const { data, error } = await client.from(TABLE_NAME).insert(insertData).select('*').single();
	if (error) return { success: false, message: `No se pudo crear la transacción: ${translateSupabaseError(error, FIELDS_CONFIG)}` };

	return { success: true, message: 'Transacción creada correctamente', data: data as Transaccion };
}

export async function updateTransaccion(
	client: SupabaseClient,
	id: number,
	payload: Record<string, unknown>,
	esAdmin: boolean = false
): Promise<ServiceResult<Transaccion>> {
	const errors = validatePayload(FIELDS_CONFIG, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}
	if (!payload.comprobante_url) {
		return { success: false, message: 'Debes adjuntar el comprobante (imagen o PDF) de esta transacción.' };
	}

	const { data: actual } = await client.from(TABLE_NAME).select('aprobado, estado').eq(PK_COLUMN, id).single();
	if (actual?.aprobado && !esAdmin) {
		return { success: false, message: BLOQUEADO_POR_APROBACION };
	}

	const updateData = buildWritablePayload(FIELDS_CONFIG, payload);
	updateData.comprobante_url = payload.comprobante_url as string;
	updateData.factura_url = (payload.factura_url as string | null) ?? null;
	updateData.estado = resolveEstadoTransaccion(String(payload.tipo_alcance ?? ''), actual?.estado);

	const { data, error } = await client.from(TABLE_NAME).update(updateData).eq(PK_COLUMN, id).select('*').single();
	if (error) return { success: false, message: `No se pudo actualizar la transacción: ${translateSupabaseError(error, FIELDS_CONFIG)}` };

	return { success: true, message: 'Transacción actualizada correctamente', data: data as Transaccion };
}

/**
 * Elimina la transacción. Bloqueada para no-admins si ya está aprobada. Si es el respaldo de un
 * cobro/pago ya confirmado, ese cobro/pago pierde su prueba: se revierte a 'programado' (se
 * "desconfirma") y la cuenta por cobrar/pagar se recalcula — si estaba pagada del todo, vuelve a
 * pendiente, ya que ahora le falta esa transacción (ver recalcularCuentaCobrar/recalcularCuentaPagar).
 */
export async function deleteTransaccion(client: SupabaseClient, id: number, esAdmin: boolean = false): Promise<ServiceResult> {
	const { data: actual } = await client.from(TABLE_NAME).select('aprobado').eq(PK_COLUMN, id).single();
	if (actual?.aprobado && !esAdmin) {
		return { success: false, message: BLOQUEADO_POR_APROBACION };
	}

	const { data: cobros } = await client.from('cobros').select('id_cobro, id_cuenta_cobrar').eq('id_transaccion', id);
	for (const cobro of (cobros ?? []) as any[]) {
		await client.from('cobros').update({ estado_cobro: 'programado', id_transaccion: null }).eq('id_cobro', cobro.id_cobro);
		await recalcularCuentaCobrar(client, cobro.id_cuenta_cobrar);
	}

	const { data: pagos } = await client.from('pagos').select('id_pago, id_cuenta_pagar').eq('id_transaccion', id);
	for (const pago of (pagos ?? []) as any[]) {
		await client.from('pagos').update({ estado_pago: 'programado', id_transaccion: null }).eq('id_pago', pago.id_pago);
		await recalcularCuentaPagar(client, pago.id_cuenta_pagar);
	}

	// ON DELETE CASCADE en trans_detalle.id_transaccion se encarga de borrar su detalle asociado.
	// .select(PK_COLUMN) sirve para detectar borrados que "no fallan" pero tampoco afectan ninguna fila
	// (ej. RLS bloqueando en silencio, o un id que ya no existe) — sin esto, Postgrest devuelve
	// error=null incluso si 0 filas fueron realmente eliminadas.
	const { data, error } = await client.from(TABLE_NAME).delete().eq(PK_COLUMN, id).select(PK_COLUMN);
	if (error) {
		console.error('[transacciones.service] deleteTransaccion error:', error);
		return { success: false, message: `No se pudo eliminar la transacción: ${translateSupabaseError(error, FIELDS_CONFIG)}` };
	}
	if (!data || data.length === 0) {
		console.error('[transacciones.service] deleteTransaccion: 0 filas afectadas para id', id);
		return { success: false, message: `No se pudo eliminar la transacción #${id}: no se afectó ninguna fila (verifica permisos o que aún exista).` };
	}
	return { success: true, message: 'Transacción eliminada correctamente' };
}

/** Aprueba el comprobante de una transacción — a partir de ahí queda bloqueada para no-admins (ver
 * BLOQUEADO_POR_APROBACION). Solo un administrador puede llamar a esto (UI-gated, ver TransaccionModal.svelte). */
export async function aprobarTransaccion(
	client: SupabaseClient,
	id: number,
	usuarioNombre: string | null,
	esAdmin: boolean
): Promise<ServiceResult<Transaccion>> {
	if (!esAdmin) return { success: false, message: 'Solo un administrador puede aprobar el comprobante.' };

	const { data, error } = await client
		.from(TABLE_NAME)
		.update({ aprobado: true, aprobado_por: usuarioNombre ? usuarioNombre.slice(0, 100) : null, aprobado_en: new Date().toISOString() })
		.eq(PK_COLUMN, id)
		.select('*')
		.single();
	if (error) return { success: false, message: `No se pudo aprobar el comprobante: ${translateSupabaseError(error, FIELDS_CONFIG)}` };
	return { success: true, message: 'Comprobante aprobado', data: data as Transaccion };
}

/** Quita la aprobación (por si se aprobó por error) — igual que aprobar, solo un administrador. */
export async function desaprobarTransaccion(client: SupabaseClient, id: number, esAdmin: boolean): Promise<ServiceResult<Transaccion>> {
	if (!esAdmin) return { success: false, message: 'Solo un administrador puede quitar la aprobación.' };

	const { data, error } = await client
		.from(TABLE_NAME)
		.update({ aprobado: false, aprobado_por: null, aprobado_en: null })
		.eq(PK_COLUMN, id)
		.select('*')
		.single();
	if (error) return { success: false, message: `No se pudo quitar la aprobación: ${translateSupabaseError(error, FIELDS_CONFIG)}` };
	return { success: true, message: 'Aprobación retirada', data: data as Transaccion };
}

/**
 * Anula la transacción (estado='anulado') — a diferencia de deleteTransaccion, NO borra la fila,
 * queda visible con el badge "Anulada". Si es el respaldo de un cobro/pago ya confirmado, ese
 * cobro/pago ya no debe seguir contando como probado: se revierte a 'programado' (mismo criterio que
 * deleteTransaccion) y su cuenta se recalcula. Solo un administrador puede llamar a esto (UI-gated,
 * ver TransaccionModal.svelte).
 */
export async function anularTransaccion(client: SupabaseClient, id: number, esAdmin: boolean): Promise<ServiceResult<Transaccion>> {
	if (!esAdmin) return { success: false, message: 'Solo un administrador puede anular una transacción.' };

	const { data: cobros } = await client.from('cobros').select('id_cobro, id_cuenta_cobrar').eq('id_transaccion', id);
	for (const cobro of (cobros ?? []) as any[]) {
		await client.from('cobros').update({ estado_cobro: 'programado', id_transaccion: null }).eq('id_cobro', cobro.id_cobro);
		await recalcularCuentaCobrar(client, cobro.id_cuenta_cobrar);
	}

	const { data: pagos } = await client.from('pagos').select('id_pago, id_cuenta_pagar').eq('id_transaccion', id);
	for (const pago of (pagos ?? []) as any[]) {
		await client.from('pagos').update({ estado_pago: 'programado', id_transaccion: null }).eq('id_pago', pago.id_pago);
		await recalcularCuentaPagar(client, pago.id_cuenta_pagar);
	}

	const { data, error } = await client.from(TABLE_NAME).update({ estado: 'anulado' }).eq(PK_COLUMN, id).select('*').single();
	if (error) return { success: false, message: `No se pudo anular la transacción: ${translateSupabaseError(error, FIELDS_CONFIG)}` };
	return { success: true, message: 'Transacción anulada', data: data as Transaccion };
}

/** Reactiva una transacción anulada (por si se anuló por error) — vuelve a 'activo'. No restaura
 * ningún pago/cobro que se haya revertido al anular (habría que confirmarlo de nuevo a mano). Solo un
 * administrador puede llamar a esto. */
export async function reactivarTransaccion(client: SupabaseClient, id: number, esAdmin: boolean): Promise<ServiceResult<Transaccion>> {
	if (!esAdmin) return { success: false, message: 'Solo un administrador puede reactivar una transacción anulada.' };

	const { data, error } = await client.from(TABLE_NAME).update({ estado: 'activo' }).eq(PK_COLUMN, id).select('*').single();
	if (error) return { success: false, message: `No se pudo reactivar la transacción: ${translateSupabaseError(error, FIELDS_CONFIG)}` };
	return { success: true, message: 'Transacción reactivada', data: data as Transaccion };
}

export async function getTransDetalles(client: SupabaseClient, idTransaccion: number): Promise<TransDetalle[]> {
	const { data, error } = await client
		.from(DETALLE_TABLE)
		.select('*')
		.eq(PARENT_FK_COLUMN, idTransaccion)
		.order('created_at', { ascending: false });
	if (error) throw error;
	return (data ?? []) as TransDetalle[];
}


export async function createTransDetalle(
	client: SupabaseClient,
	idTransaccion: number,
	payload: Record<string, unknown>,
	usuarioRegistro: string | null
): Promise<ServiceResult<TransDetalle>> {
	const errors = validatePayload(DETALLE_FIELDS, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}

	const insertData = {
		...buildWritablePayload(DETALLE_FIELDS, payload),
		[PARENT_FK_COLUMN]: idTransaccion,
		usuario_registro: usuarioRegistro
	};

	const { data, error } = await client.from(DETALLE_TABLE).insert(insertData).select('*').single();
	if (error) return { success: false, message: `No se pudo registrar el detalle: ${translateSupabaseError(error, DETALLE_FIELDS)}` };

	return { success: true, message: 'Detalle registrado correctamente', data: data as TransDetalle };
}

export async function updateTransDetalle(
	client: SupabaseClient,
	idTransDetalle: number,
	payload: Record<string, unknown>
): Promise<ServiceResult<TransDetalle>> {
	const errors = validatePayload(DETALLE_FIELDS, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}

	const updateData = buildWritablePayload(DETALLE_FIELDS, payload);

	const { data, error } = await client.from(DETALLE_TABLE).update(updateData).eq(DETALLE_PK, idTransDetalle).select('*').single();
	if (error) return { success: false, message: `No se pudo actualizar el detalle: ${translateSupabaseError(error, DETALLE_FIELDS)}` };

	return { success: true, message: 'Detalle actualizado correctamente', data: data as TransDetalle };
}

export async function deleteTransDetalle(client: SupabaseClient, idTransDetalle: number): Promise<ServiceResult> {
	const { error } = await client.from(DETALLE_TABLE).delete().eq(DETALLE_PK, idTransDetalle);
	if (error) return { success: false, message: `No se pudo eliminar el detalle: ${translateSupabaseError(error, DETALLE_FIELDS)}` };
	return { success: true, message: 'Detalle eliminado correctamente' };
}

export async function getCentroCostoOptions(client: SupabaseClient): Promise<FieldOption[]> {
	const { data, error } = await client.from('centro_costo').select('id_centro_costo, codigo, nombre').order('nombre');
	if (error) throw error;
	return (data ?? []).map((c: any) => ({ value: String(c.id_centro_costo), label: `${c.codigo} - ${c.nombre}` }));
}

/** Mapa id_centro_costo (como string) -> "Producto y Servicio" del proveedor vinculado a ese centro
 * de costo (columna real `proveedor.vendedor`, ver ProveedorModal.svelte y getProveedorOptions en
 * cuentasPagar.service.ts) — solo incluye los centros de costo que SÍ están vinculados a un
 * proveedor. Usado en /finanzas/tranzacciones para mostrar, en cada fila, el producto del proveedor
 * elegido como origen/destino de esa transacción (a pedido del usuario, no el nombre de la Partida). */
export async function getCentroCostoProductoLookup(client: SupabaseClient): Promise<Record<string, string>> {
	const { data, error } = await client.from('centro_costo').select('id_centro_costo, proveedor(vendedor)').not('id_proveedor', 'is', null);
	if (error) throw error;
	const lookup: Record<string, string> = {};
	for (const row of (data ?? []) as any[]) {
		const producto = Array.isArray(row.proveedor) ? row.proveedor[0]?.vendedor : row.proveedor?.vendedor;
		if (producto) lookup[String(row.id_centro_costo)] = producto;
	}
	return lookup;
}

/** Para "Destino de Transacción" en Externa + Egreso (a pedido del usuario) — misma definición
 * EXACTA de "Centro de Costos" (a diferencia de "Cuentas Internas") que ya usa el submódulo
 * homónimo (ver getCentroCostos en centroCostos.service.ts, vinculado=false): los 3 tipos creados a
 * mano (obra/consultoría/bolsa general) MÁS los vinculados a un proyecto que YA es una venta
 * cerrada. Excluye "Cuentas Internas" (cliente/proveedor/empleado), proyectos aún en negociación, y
 * — a pedido explícito del usuario — cualquier centro dado de baja (estado != 'activo', ver
 * darDeBajaCentroCostoDeEntidad en centroCostos.service.ts). */
export async function getCentroCostoOptionsSoloCentros(client: SupabaseClient): Promise<FieldOption[]> {
	const { data: cerrados, error: errorCerrados } = await client.from('proyecto').select('id_proyecto').eq('estado_proyecto', 'venta_cerrada');
	if (errorCerrados) throw errorCerrados;
	const idsCerrados = (cerrados ?? []).map((p: any) => p.id_proyecto);
	const idProyectoFilter = idsCerrados.length > 0 ? `id_proyecto.in.(${idsCerrados.join(',')})` : 'id_proyecto.eq.-1';

	const { data, error } = await client
		.from('centro_costo')
		.select('id_centro_costo, codigo, nombre')
		.eq('estado', 'activo')
		.or(`tipo.eq.obra,tipo.eq.consultoria,tipo.eq.bolsa general,${idProyectoFilter}`)
		.order('nombre');
	if (error) throw error;
	return (data ?? []).map((c: any) => ({ value: String(c.id_centro_costo), label: `${c.codigo} - ${c.nombre}` }));
}

/** Para "Centro de Costo" en Nueva/Editar Cuenta por Cobrar — a pedido del usuario, solo ofrece los
 * centros de costo vinculados a un proyecto que YA es una venta cerrada (estado_proyecto=
 * 'venta_cerrada'); excluye bolsa general/consultoría y proyectos aún en negociación. Etiqueta
 * "código - nombre del proyecto" (mismo formato que getCentroCostoOptions). */
export async function getCentroCostoOptionsVentasCerradas(client: SupabaseClient): Promise<FieldOption[]> {
	// Cada venta cerrada (Obra o Consultoría) tiene su propio centro de costo por id_proyecto (ver
	// getOrCrearCentroCostoParaEntidad/getOrCrearCentroCostoCompartido en centroCostos.service.ts). La
	// fila histórica compartida de Consultoría (tipo='consultoria', id_proyecto IS NULL, de antes de
	// que cada venta tuviera la suya propia) se incluye aparte por compatibilidad con datos ya
	// existentes que pudieran seguir apuntando a ella.
	const { data: cerrados, error: errorCerrados } = await client.from('proyecto').select('id_proyecto, tipo_venta').eq('estado_proyecto', 'venta_cerrada');
	if (errorCerrados) throw errorCerrados;
	const idsCerrados = (cerrados ?? []).map((p: any) => p.id_proyecto);
	const hayConsultoriaCerrada = (cerrados ?? []).some((p: any) => p.tipo_venta === 'consultoria');

	const filtros: string[] = [];
	if (idsCerrados.length > 0) filtros.push(`id_proyecto.in.(${idsCerrados.join(',')})`);
	if (hayConsultoriaCerrada) filtros.push('and(tipo.eq.consultoria,id_proyecto.is.null)');
	if (filtros.length === 0) return [];

	const { data, error } = await client
		.from('centro_costo')
		.select('id_centro_costo, codigo, nombre')
		.or(filtros.join(','))
		.eq('estado', 'activo')
		.order('nombre');
	if (error) throw error;
	return (data ?? []).map((c: any) => ({ value: String(c.id_centro_costo), label: `${c.codigo} - ${c.nombre}` }));
}

/** id_centro_costo (como texto) -> precio_venta de la venta cerrada vinculada — para
 * CuentaCobrarModal.svelte: autocompletar "Monto" al elegir el Centro de Costo (ver
 * getCentroCostoOptionsVentasCerradas, misma fuente de centros de costo). Cada venta cerrada (Obra o
 * Consultoría) tiene su propio centro de costo por id_proyecto. Para la fila histórica compartida de
 * Consultoría (id_proyecto IS NULL, de antes de que cada venta tuviera la suya propia), el monto
 * sugerido sigue siendo la SUMA de precio_venta de todas las consultorías cerradas — se mantiene por
 * compatibilidad con datos ya existentes. */
export async function getCentroCostoMontoVentaCerrada(client: SupabaseClient): Promise<Record<string, number>> {
	const { data: cerrados, error: errorCerrados } = await client.from('proyecto').select('id_proyecto, precio_venta, tipo_venta').eq('estado_proyecto', 'venta_cerrada');
	if (errorCerrados) throw errorCerrados;
	const consultoriaCerrados = (cerrados ?? []).filter((p: any) => p.tipo_venta === 'consultoria');

	const mapa: Record<string, number> = {};

	const idsCerrados = (cerrados ?? []).map((p: any) => p.id_proyecto);
	if (idsCerrados.length > 0) {
		const { data, error } = await client
			.from('centro_costo')
			.select('id_centro_costo, proyecto:id_proyecto(precio_venta)')
			.in('id_proyecto', idsCerrados);
		if (error) throw error;
		for (const row of (data ?? []) as any[]) {
			mapa[String(row.id_centro_costo)] = Number(row.proyecto?.precio_venta) || 0;
		}
	}

	if (consultoriaCerrados.length > 0) {
		const { data: compartido, error: errorCompartido } = await client
			.from('centro_costo')
			.select('id_centro_costo')
			.eq('tipo', 'consultoria')
			.is('id_proyecto', null)
			.maybeSingle();
		if (errorCompartido) throw errorCompartido;
		if (compartido) {
			const totalConsultoria = consultoriaCerrados.reduce((sum: number, p: any) => sum + (Number(p.precio_venta) || 0), 0);
			mapa[String(compartido.id_centro_costo)] = totalConsultoria;
		}
	}

	return mapa;
}

/** id_centro_costo (como texto) -> id_proyecto de la venta cerrada vinculada — para
 * CuentaCobrarModal.svelte: autocompletar "Proyecto" con el código de ese proyecto al elegir el
 * Centro de Costo (mismo criterio/fuente que getCentroCostoMontoVentaCerrada), a pedido explícito del
 * usuario ("el campo proyecto debe ser llenado con el código del proyecto que tiene ese centro de
 * costo"). La fila histórica compartida de Consultoría (id_proyecto IS NULL) no se incluye: no
 * corresponde a un único proyecto. */
export async function getCentroCostoProyectoMap(client: SupabaseClient): Promise<Record<string, string>> {
	const { data: cerrados, error: errorCerrados } = await client.from('proyecto').select('id_proyecto').eq('estado_proyecto', 'venta_cerrada');
	if (errorCerrados) throw errorCerrados;
	const idsCerrados = (cerrados ?? []).map((p: any) => p.id_proyecto);
	if (idsCerrados.length === 0) return {};

	const { data, error } = await client.from('centro_costo').select('id_centro_costo, id_proyecto').in('id_proyecto', idsCerrados);
	if (error) throw error;

	const mapa: Record<string, string> = {};
	for (const row of (data ?? []) as any[]) {
		mapa[String(row.id_centro_costo)] = String(row.id_proyecto);
	}
	return mapa;
}

/** id_centro_costo (como texto) -> id_cliente del proyecto de esa venta cerrada — para
 * CuentaCobrarModal.svelte: si se elige primero el Centro de Costo, autocompletar "Cliente" con el
 * de ese proyecto; si se elige primero el Cliente, filtrar la lista de Centro de Costo a solo los
 * suyos (a pedido explícito del usuario). Mismo universo de centros que
 * getCentroCostoOptionsVentasCerradas (venta cerrada + estado='activo'); la fila histórica
 * compartida de Consultoría (id_proyecto IS NULL) no se incluye: no corresponde a un único cliente. */
export async function getCentroCostoClienteMap(client: SupabaseClient): Promise<Record<string, string>> {
	const { data: cerrados, error: errorCerrados } = await client.from('proyecto').select('id_proyecto, id_cliente').eq('estado_proyecto', 'venta_cerrada');
	if (errorCerrados) throw errorCerrados;
	const idsCerrados = (cerrados ?? []).map((p: any) => p.id_proyecto);
	if (idsCerrados.length === 0) return {};
	const clientePorProyecto: Record<string, string> = {};
	for (const p of (cerrados ?? []) as any[]) {
		if (p.id_cliente != null) clientePorProyecto[String(p.id_proyecto)] = String(p.id_cliente);
	}

	const { data, error } = await client
		.from('centro_costo')
		.select('id_centro_costo, id_proyecto')
		.in('id_proyecto', idsCerrados)
		.eq('estado', 'activo');
	if (error) throw error;

	const mapa: Record<string, string> = {};
	for (const row of (data ?? []) as any[]) {
		const idCliente = clientePorProyecto[String(row.id_proyecto)];
		if (idCliente) mapa[String(row.id_centro_costo)] = idCliente;
	}
	return mapa;
}

/** id_centro_costo (como texto) -> tipo — para CuentaPagarModal.svelte: cuando el centro de costo
 * elegido es 'bolsa general', el campo "ID Partida" se bloquea (un gasto de bolsa general no se
 * carga a una partida puntual de obra). */
export async function getCentroCostoTipoMap(client: SupabaseClient): Promise<Record<string, string>> {
	const { data, error } = await client.from('centro_costo').select('id_centro_costo, tipo');
	if (error) throw error;
	const mapa: Record<string, string> = {};
	for (const row of (data ?? []) as any[]) mapa[String(row.id_centro_costo)] = row.tipo;
	return mapa;
}

/** Como getCentroCostoOptions, pero solo centros de costo vinculados a un PROYECTO (excluye los
 * vinculados a proveedor/cliente/empleado, ver centro_costo_vinculacion_migration.sql) — a pedido
 * del usuario, "Origen de Transacción"/"Destino de Transacción" en TransaccionModal.svelte solo
 * deben ofrecer proyectos, no proveedores ni empleados. */
export async function getCentroCostoOptionsProyectos(client: SupabaseClient): Promise<FieldOption[]> {
	const { data, error } = await client
		.from('centro_costo')
		.select('id_centro_costo, codigo, nombre')
		.not('id_proyecto', 'is', null)
		.order('nombre');
	if (error) throw error;
	return (data ?? []).map((c: any) => ({ value: String(c.id_centro_costo), label: `${c.codigo} - ${c.nombre}` }));
}

/** Para "Destino de Transacción" en "Transacción Externa" (TransaccionModal.svelte): TODOS los
 * centros de costo, agrupados en este orden — proveedores, clientes, empleados, proyectos — a
 * pedido del usuario. */
export async function getCentroCostoOptionsExternos(client: SupabaseClient): Promise<FieldOption[]> {
	const { data, error } = await client
		.from('centro_costo')
		.select('id_centro_costo, codigo, nombre, id_proveedor, id_cliente, id_empleado, id_proyecto')
		.order('nombre');
	if (error) throw error;

	const rows = (data ?? []) as any[];
	const toOption = (c: any): FieldOption => ({ value: String(c.id_centro_costo), label: `${c.codigo} - ${c.nombre}` });
	const proveedores = rows.filter((r) => r.id_proveedor !== null).map(toOption);
	const clientes = rows.filter((r) => r.id_cliente !== null).map(toOption);
	const empleados = rows.filter((r) => r.id_empleado !== null).map(toOption);
	const proyectos = rows.filter((r) => r.id_proyecto !== null).map(toOption);
	// Centros de costo creados a mano, sin vincular a ninguna entidad — van al final, para no
	// dejarlos fuera de "todos los centros de costo".
	const sinVincular = rows.filter((r) => r.id_proveedor === null && r.id_cliente === null && r.id_empleado === null && r.id_proyecto === null).map(toOption);
	return [...proveedores, ...clientes, ...empleados, ...proyectos, ...sinVincular];
}

/** Variante de getCentroCostoOptionsExternos SOLO para "Origen de Transacción" en Externa — a
 * diferencia de Destino, Origen también incluye centros de costo de proyecto (el origen de una
 * transacción externa puede ser un cliente que paga, o un proyecto propio), y clientes/proyectos
 * van primero: clientes, proyectos, proveedores, empleados. */
export async function getCentroCostoOptionsExternosOrigen(client: SupabaseClient): Promise<FieldOption[]> {
	const { data, error } = await client
		.from('centro_costo')
		.select('id_centro_costo, codigo, nombre, id_proveedor, id_cliente, id_empleado, id_proyecto')
		.or('id_proveedor.not.is.null,id_cliente.not.is.null,id_empleado.not.is.null,id_proyecto.not.is.null')
		.order('nombre');
	if (error) throw error;

	const rows = (data ?? []) as any[];
	const toOption = (c: any): FieldOption => ({ value: String(c.id_centro_costo), label: `${c.codigo} - ${c.nombre}` });
	const clientes = rows.filter((r) => r.id_cliente !== null).map(toOption);
	const proyectos = rows.filter((r) => r.id_proyecto !== null).map(toOption);
	const proveedores = rows.filter((r) => r.id_proveedor !== null).map(toOption);
	const empleados = rows.filter((r) => r.id_empleado !== null).map(toOption);
	return [...clientes, ...proyectos, ...proveedores, ...empleados];
}

export async function getPartidaOptions(client: SupabaseClient): Promise<FieldOption[]> {
	const { data, error } = await client.from('partida').select('id_partida, codigo, descripcion').order('codigo');
	if (error) throw error;
	return (data ?? []).map((p: any) => ({ value: String(p.id_partida), label: `${p.codigo} - ${p.descripcion}` }));
}

/** Opciones para el campo "Responsable" (texto libre, no FK) de Cuentas por Pagar/Cobrar — el
 * valor guardado es el NOMBRE del empleado elegido (value === label), no su id, para no cambiar
 * el formato de la columna existente (VARCHAR de texto libre). */
export async function getEmpleadoOptions(client: SupabaseClient): Promise<FieldOption[]> {
	const { data, error } = await client.from('empleados').select('nombre').order('nombre');
	if (error) throw error;
	return (data ?? []).map((e: any) => ({ value: e.nombre, label: e.nombre }));
}

const MEDIO_PAGO_OPTIONS = FIELDS_CONFIG.find((f) => f.key === 'medio_pago')!.options!;

/** Busca el `value` (código) de una opción a partir de su `label` exacto. Usado para traducir el
 * medio_pago en texto libre de `pagos` (ej. "Efectivo") al código VARCHAR(2) que espera `transaccion`. */
function codigoPorLabel(label: string | null | undefined): string | null {
	if (!label) return null;
	return MEDIO_PAGO_OPTIONS.find((o) => o.label === label)?.value ?? null;
}

/** Inverso de codigoPorLabel: traduce el código VARCHAR(2) de transaccion.medio_pago a su label en
 * texto libre. Usado por registrarPagoDesdeTransaccion (cuentasPagar.service.ts) al insertar el pago
 * generado desde una transacción vinculada a mano a una Cuenta por Pagar existente. */
export function labelPorCodigoMedioPago(codigo: string | null | undefined): string | null {
	if (!codigo) return null;
	return MEDIO_PAGO_OPTIONS.find((o) => o.value === codigo)?.label ?? null;
}

/**
 * Calcula la posición (1-based) de una fila entre todas las de su cuenta, ordenadas por fecha — esa
 * posición es lo que se guarda como "Número de Cuota" en la transacción autogenerada. Se calcula al
 * vuelo (ninguna de las dos tablas guarda el número de cuota como columna aparte) contando TODAS las
 * filas de la cuenta (programado/pagado/cobrado/cancelado), en el mismo orden en que se generaron.
 * Ordena por fecha Y por PK como desempate: varias cuotas suelen compartir la misma fecha (todas las
 * que quedan topadas a fecha_vencimiento), y sin un desempate estable el orden de PostgREST entre
 * filas con la misma fecha no está garantizado — se probó y da resultados distintos entre llamadas.
 */
async function calcularNumeroCuota(
	client: SupabaseClient,
	tabla: 'pagos' | 'cobros',
	columnaFk: 'id_cuenta_pagar' | 'id_cuenta_cobrar',
	columnaPk: 'id_pago' | 'id_cobro',
	columnaFecha: 'fecha_pago' | 'fecha_cobro',
	idCuenta: number,
	idFila: number
): Promise<number | null> {
	const { data } = await client
		.from(tabla)
		.select(`${columnaPk}, ${columnaFecha}`)
		.eq(columnaFk, idCuenta)
		.order(columnaFecha, { ascending: true })
		.order(columnaPk, { ascending: true });
	if (!data) return null;
	const index = (data as any[]).findIndex((row) => row[columnaPk] === idFila);
	return index === -1 ? null : index + 1;
}

/**
 * Arma (sin insertar) el payload de la transacción 'egreso' correspondiente a un pago (centro de
 * costo origen = el de la cuenta, destino = el del proveedor específico — ver
 * getOrCrearCentroCostoParaEntidad —, códigos traducidos, "Número de Cuota" = posición del pago en
 * el calendario de la cuenta, etc.). Devuelve `null` si la cuenta todavía no tiene `id_centro_costo`
 * asignado, o si no se pudo asegurar el centro de costo del proveedor. Se usa tanto al registrar un
 * pago nuevo como al pasar una cuota programada a 'pagado' (ver createPago/updatePago en
 * cuentasPagar.service.ts) para prellenar el modal de "Nueva Transacción" que el usuario debe
 * completar y confirmar — ningún pago queda 'pagado' sin que esto se confirme (ver
 * confirmarPagoPagado).
 */
export async function construirPayloadTransaccionPorPago(
	client: SupabaseClient,
	cuentaPagar: {
		id_cuenta_pagar: number;
		id_centro_costo: number | null;
		id_proveedor: number;
		proveedorNombre?: string | null;
		tipo_documento: number | null;
		num_documento: string | null;
		fotma_pago: number | null;
	},
	pago: { id_pago?: number; monto: number; fecha_pago: string; medio_pago: string | null; referencia: string | null }
): Promise<Record<string, unknown> | null> {
	if (!cuentaPagar.id_centro_costo) return null;

	const idCentroDestino = await getOrCrearCentroCostoParaEntidad(
		client,
		'proveedor',
		cuentaPagar.id_proveedor,
		cuentaPagar.proveedorNombre || `Proveedor #${cuentaPagar.id_proveedor}`
	);
	if (!idCentroDestino) return null;

	const numeroCuota = pago.id_pago
		? await calcularNumeroCuota(client, 'pagos', 'id_cuenta_pagar', 'id_pago', 'fecha_pago', cuentaPagar.id_cuenta_pagar, pago.id_pago)
		: null;

	return {
		id_centro_costo_origen: cuentaPagar.id_centro_costo,
		id_centro_costo_destino: idCentroDestino,
		fecha: pago.fecha_pago,
		tipo_documento: cuentaPagar.tipo_documento !== null ? String(cuentaPagar.tipo_documento) : null,
		num_documento: cuentaPagar.num_documento,
		forma_pago: cuentaPagar.fotma_pago !== null ? String(cuentaPagar.fotma_pago) : null,
		tipo_transaccion: numeroCuota !== null ? String(numeroCuota).slice(0, 2) : null, // "Número de Cuota"
		tipo: 'egreso',
		monto_total: pago.monto,
		medio_pago: codigoPorLabel(pago.medio_pago),
		descripcion: `Pago de cuenta por pagar #${cuentaPagar.id_cuenta_pagar}${pago.referencia ? ' - ' + pago.referencia : ''}`,
		estado: 'activo'
	};
}

/**
 * Arma (sin insertar) el payload de la transacción 'ingreso' correspondiente a un cobro (centro de
 * costo origen = el del cliente específico — ver getOrCrearCentroCostoParaEntidad —, destino = el de
 * la cuenta). Devuelve `null` si la cuenta todavía no tiene `id_centro_costo` asignado, o si no se
 * pudo asegurar el centro de costo del cliente. Se usa tanto al registrar un cobro nuevo como al
 * pasar una cuota programada a 'cobrado' (ver createCobro/updateCobro en cuentasCobrar.service.ts)
 * para prellenar el modal de "Nueva Transacción" que el usuario debe completar y confirmar — ningún
 * cobro queda 'cobrado' sin que esto se confirme (ver confirmarCobroCobrado).
 */
export async function construirPayloadTransaccionPorCobro(
	client: SupabaseClient,
	cuentaCobrar: {
		id_cuenta_cobrar: number;
		id_centro_costo: number | null;
		id_cliente: number;
		clienteNombre?: string | null;
		tipo_documento: number | null;
		num_documento: string | null;
		forma_pago: number | null;
		/** Código generado del proyecto vinculado al centro de costo (ver generarCodigoProyecto) — a
		 * pedido explícito del usuario, se agrega a la descripción de la transacción junto con el número
		 * de cuota. null/undefined si la cuenta no tiene proyecto vinculado. */
		proyectoCodigo?: string | null;
	},
	cobro: { id_cobro?: number; monto: number; fecha_cobro: string; medio_cobro: number | null; cuenta_banco: string | null; referencia: string | null }
): Promise<Record<string, unknown> | null> {
	if (!cuentaCobrar.id_centro_costo) return null;

	const idCentroOrigen = await getOrCrearCentroCostoParaEntidad(
		client,
		'cliente',
		cuentaCobrar.id_cliente,
		cuentaCobrar.clienteNombre || `Cliente #${cuentaCobrar.id_cliente}`
	);
	if (!idCentroOrigen) return null;

	const numeroCuota = cobro.id_cobro
		? await calcularNumeroCuota(client, 'cobros', 'id_cuenta_cobrar', 'id_cobro', 'fecha_cobro', cuentaCobrar.id_cuenta_cobrar, cobro.id_cobro)
		: null;

	return {
		id_centro_costo_origen: idCentroOrigen,
		id_centro_costo_destino: cuentaCobrar.id_centro_costo,
		fecha: cobro.fecha_cobro,
		tipo_documento: cuentaCobrar.tipo_documento !== null ? String(cuentaCobrar.tipo_documento) : null,
		num_documento: cuentaCobrar.num_documento,
		forma_pago: cuentaCobrar.forma_pago !== null ? String(cuentaCobrar.forma_pago) : null,
		tipo_transaccion: numeroCuota !== null ? String(numeroCuota).slice(0, 2) : null, // "Número de Cuota"
		tipo: 'ingreso',
		monto_total: cobro.monto,
		medio_pago: cobro.medio_cobro !== null ? String(cobro.medio_cobro) : null,
		cuente_destino: cobro.cuenta_banco,
		descripcion: `Cobro de cuenta por cobrar #${cuentaCobrar.id_cuenta_cobrar}${numeroCuota !== null ? ` - Cuota ${numeroCuota}` : ''}${cuentaCobrar.proyectoCodigo ? ` - ${cuentaCobrar.proyectoCodigo}` : ''}${cobro.referencia ? ' - ' + cobro.referencia : ''}`,
		estado: 'activo'
	};
}

