/**
 * Servicio de acceso a datos para "cuentas_pagar" + su detalle "pagos".
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
} from '../config/cuentaPagar.config';
import {
	TABLE_NAME as PAGO_TABLE,
	PK_COLUMN as PAGO_PK,
	PARENT_FK_COLUMN,
	FIELDS_CONFIG as PAGO_FIELDS
} from '../config/pago.config';

export interface CuentaPagar {
	id_cuenta_pagar: number;
	id_proveedor: number;
	id_presupuesto: number | null;
	id_partida: number | null;
	tipo_documento: number | null;
	num_documento: string | null;
	monto_comprometido: number;
	monto_pagado: number;
	saldo_pendiente: number;
	fotma_pago: number | null;
	categoria_gasto: number | null;
	condicion_pago: string | null;
	responsable: string | null;
	fecha_emision: string;
	fecha_vencimiento: string | null;
	fecha_pago_programada: string | null;
	monto_imponible: number;
	monto_igv: number;
	detraccion: number | null;
	monto_retencion: number | null;
	estado: string;
	observacion: string | null;
	usuario_registro: string | null;
	created_at: string;
	proveedor?: { razon_social: string } | null;
}

export interface Pago {
	id_pago: number;
	id_cuenta_pagar: number;
	monto: number;
	fecha_pago: string;
	medio_pago: string | null;
	num_operacion: string | null;
	usuario_registro: string | null;
	referencia: string | null;
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

/**
 * Regla de negocio de `estado`: pagado si el saldo ya llegó a 0; vencido si hoy pasó la fecha de
 * vencimiento o la fecha de pago programada (lo que ocurra primero); si no, pendiente. Ya no es una
 * marca manual — se recalcula en cada create/update de la cuenta y en cada alta/baja de un pago.
 */
function computeEstadoCuentaPagar(saldoPendiente: number, fechaVencimiento: string | null, fechaPagoProgramada: string | null): string {
	if (saldoPendiente <= 0) return 'pagado';

	const hoy = new Date();
	hoy.setHours(0, 0, 0, 0);
	const yaVencio = (fecha: string | null) => {
		if (!fecha) return false;
		const d = new Date(fecha);
		return !Number.isNaN(d.getTime()) && d.getTime() < hoy.getTime();
	};

	if (yaVencio(fechaVencimiento) || yaVencio(fechaPagoProgramada)) return 'vencido';
	return 'pendiente';
}

export async function getCuentasPagar(client: SupabaseClient, params: ListParams = {}): Promise<ListResult<CuentaPagar>> {
	const page = Math.max(1, Math.floor(params.page ?? 1));
	const pageSize = Math.max(1, Math.floor(params.pageSize ?? DEFAULT_PAGE_SIZE));
	const sortField = params.sortBy && SORTABLE_KEYS.has(params.sortBy) ? params.sortBy : DEFAULT_SORT_FIELD;
	const sortDir: 'asc' | 'desc' = params.sortDir === 'asc' || params.sortDir === 'desc' ? params.sortDir : DEFAULT_SORT_DIR;

	const from = (page - 1) * pageSize;
	const to = from + pageSize - 1;

	let query = client
		.from(TABLE_NAME)
		.select('*, proveedor(razon_social)', { count: 'exact' })
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

	const items = await autoCorregirVencidos(client, (data ?? []) as CuentaPagar[]);

	const total = count ?? 0;
	return {
		items,
		total,
		page,
		pageSize,
		totalPages: Math.max(1, Math.ceil(total / pageSize))
	};
}

/**
 * "Vencido" depende de la fecha de hoy, no de ningún evento (crear/editar/pagar) — sin un cron en
 * el servidor (esta app es client-side puro), el único momento en que se puede detectar que una
 * cuenta acaba de vencer es cuando se vuelve a listar. Corrige en BD las filas de ESTA página cuyo
 * estado calculado ya no coincide con el guardado, y devuelve la lista ya corregida.
 * AJUSTAR: solo sana lo que se está viendo en pantalla, no la tabla completa — si se necesita un
 * barrido global real, hace falta un cron/trigger en Supabase (Edge Function programada, por ejemplo).
 */
async function autoCorregirVencidos(client: SupabaseClient, items: CuentaPagar[]): Promise<CuentaPagar[]> {
	const desincronizados = items.filter((item) => {
		if (item.estado === 'pagado') return false; // pagado no se re-evalúa por fecha
		const esperado = computeEstadoCuentaPagar(item.saldo_pendiente, item.fecha_vencimiento, item.fecha_pago_programada);
		return esperado !== item.estado;
	});
	if (desincronizados.length === 0) return items;

	await Promise.all(
		desincronizados.map((item) => {
			const esperado = computeEstadoCuentaPagar(item.saldo_pendiente, item.fecha_vencimiento, item.fecha_pago_programada);
			return client.from(TABLE_NAME).update({ estado: esperado }).eq(PK_COLUMN, item.id_cuenta_pagar);
		})
	);

	const corregidos = new Set(desincronizados.map((i) => i.id_cuenta_pagar));
	return items.map((item) =>
		corregidos.has(item.id_cuenta_pagar)
			? { ...item, estado: computeEstadoCuentaPagar(item.saldo_pendiente, item.fecha_vencimiento, item.fecha_pago_programada) }
			: item
	);
}

export async function createCuentaPagar(
	client: SupabaseClient,
	payload: Record<string, unknown>,
	usuarioRegistro: string | null
): Promise<ServiceResult<CuentaPagar>> {
	const errors = validatePayload(FIELDS_CONFIG, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}

	const saldoInicial = Number(payload.monto_comprometido);
	const insertData = {
		...buildWritablePayload(FIELDS_CONFIG, payload),
		monto_pagado: 0,
		saldo_pendiente: saldoInicial,
		estado: computeEstadoCuentaPagar(saldoInicial, (payload.fecha_vencimiento as string) || null, (payload.fecha_pago_programada as string) || null),
		usuario_registro: usuarioRegistro
	};

	const { data, error } = await client.from(TABLE_NAME).insert(insertData).select('*, proveedor(razon_social)').single();
	if (error) return { success: false, message: `No se pudo crear la cuenta por pagar: ${translateSupabaseError(error, FIELDS_CONFIG)}` };

	return { success: true, message: 'Cuenta por pagar creada correctamente', data: data as CuentaPagar };
}

export async function updateCuentaPagar(
	client: SupabaseClient,
	id: number,
	payload: Record<string, unknown>
): Promise<ServiceResult<CuentaPagar>> {
	const errors = validatePayload(FIELDS_CONFIG, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}

	const updateData = buildWritablePayload(FIELDS_CONFIG, payload);
	const { data: current } = await client.from(TABLE_NAME).select('monto_pagado, monto_comprometido').eq(PK_COLUMN, id).single();
	const pagado = Number(current?.monto_pagado ?? 0);
	const comprometido = typeof updateData.monto_comprometido === 'number' ? updateData.monto_comprometido : Number(current?.monto_comprometido ?? 0);
	const saldo = Math.max(comprometido - pagado, 0);
	updateData.saldo_pendiente = saldo;
	updateData.estado = computeEstadoCuentaPagar(saldo, (updateData.fecha_vencimiento as string) || null, (updateData.fecha_pago_programada as string) || null);

	const { data, error } = await client
		.from(TABLE_NAME)
		.update(updateData)
		.eq(PK_COLUMN, id)
		.select('*, proveedor(razon_social)')
		.single();
	if (error) return { success: false, message: `No se pudo actualizar la cuenta por pagar: ${translateSupabaseError(error, FIELDS_CONFIG)}` };

	return { success: true, message: 'Cuenta por pagar actualizada correctamente', data: data as CuentaPagar };
}

export async function deleteCuentaPagar(client: SupabaseClient, id: number): Promise<ServiceResult> {
	// ON DELETE CASCADE en pagos.id_cuenta_pagar se encarga de borrar sus pagos asociados.
	const { error } = await client.from(TABLE_NAME).delete().eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo eliminar la cuenta por pagar: ${translateSupabaseError(error, FIELDS_CONFIG)}` };
	return { success: true, message: 'Cuenta por pagar eliminada correctamente' };
}

export async function getPagos(client: SupabaseClient, idCuentaPagar: number): Promise<Pago[]> {
	const { data, error } = await client
		.from(PAGO_TABLE)
		.select('*')
		.eq(PARENT_FK_COLUMN, idCuentaPagar)
		.order('fecha_pago', { ascending: false });
	if (error) throw error;
	return (data ?? []) as Pago[];
}

export async function createPago(
	client: SupabaseClient,
	idCuentaPagar: number,
	payload: Record<string, unknown>,
	usuarioRegistro: string | null
): Promise<ServiceResult<Pago>> {
	const errors = validatePayload(PAGO_FIELDS, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}

	const insertData = {
		...buildWritablePayload(PAGO_FIELDS, payload),
		[PARENT_FK_COLUMN]: idCuentaPagar,
		usuario_registro: usuarioRegistro
	};

	const { data, error } = await client.from(PAGO_TABLE).insert(insertData).select('*').single();
	if (error) return { success: false, message: `No se pudo registrar el pago: ${translateSupabaseError(error, PAGO_FIELDS)}` };

	await recalcularCuentaPagar(client, idCuentaPagar);
	return { success: true, message: 'Pago registrado correctamente', data: data as Pago };
}

export async function deletePago(client: SupabaseClient, idPago: number): Promise<ServiceResult> {
	const { data: pago, error: fetchError } = await client.from(PAGO_TABLE).select(PARENT_FK_COLUMN).eq(PAGO_PK, idPago).single();
	if (fetchError || !pago) return { success: false, message: 'Pago no encontrado' };

	const { error } = await client.from(PAGO_TABLE).delete().eq(PAGO_PK, idPago);
	if (error) return { success: false, message: `No se pudo eliminar el pago: ${translateSupabaseError(error, PAGO_FIELDS)}` };

	await recalcularCuentaPagar(client, (pago as any)[PARENT_FK_COLUMN]);
	return { success: true, message: 'Pago eliminado correctamente' };
}

/**
 * Recalcula monto_pagado/saldo_pendiente sumando los pagos reales de la cuenta, y ajusta estado
 * con computeEstadoCuentaPagar (pagado/vencido/pendiente). No es una transacción atómica de BD —
 * ver misma nota en cuentasCobrar.service.ts.
 */
async function recalcularCuentaPagar(client: SupabaseClient, idCuentaPagar: number): Promise<void> {
	const { data: cuenta } = await client
		.from(TABLE_NAME)
		.select('monto_comprometido, fecha_vencimiento, fecha_pago_programada')
		.eq(PK_COLUMN, idCuentaPagar)
		.single();
	if (!cuenta) return;

	const { data: pagos } = await client.from(PAGO_TABLE).select('monto').eq(PARENT_FK_COLUMN, idCuentaPagar);
	const totalPagado = (pagos ?? []).reduce((sum: number, p: any) => sum + Number(p.monto), 0);
	const saldoPendiente = Math.max(Number(cuenta.monto_comprometido) - totalPagado, 0);
	const nuevoEstado = computeEstadoCuentaPagar(saldoPendiente, cuenta.fecha_vencimiento, cuenta.fecha_pago_programada);

	await client
		.from(TABLE_NAME)
		.update({ monto_pagado: totalPagado, saldo_pendiente: saldoPendiente, estado: nuevoEstado })
		.eq(PK_COLUMN, idCuentaPagar);
}

export async function getProveedorOptions(client: SupabaseClient): Promise<FieldOption[]> {
	const { data, error } = await client.from('proveedor').select('id_proveedor, razon_social').order('razon_social');
	if (error) throw error;
	return (data ?? []).map((p: any) => ({ value: String(p.id_proveedor), label: p.razon_social }));
}
