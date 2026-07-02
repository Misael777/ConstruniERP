/**
 * Servicio de acceso a datos para "cuentas_pagar" + su detalle "pagos".
 * Recibe el SupabaseClient como parámetro para invocarse siempre desde el servidor
 * con el cliente de service role ($lib/server/supabase) — mismo patrón que centro-costos.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FieldOption } from '$lib/shared/fieldConfig';
import { validatePayload, buildWritablePayload } from '$lib/shared/fieldConfig';
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

	const total = count ?? 0;
	return {
		items: (data ?? []) as CuentaPagar[],
		total,
		page,
		pageSize,
		totalPages: Math.max(1, Math.ceil(total / pageSize))
	};
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

	const insertData = {
		...buildWritablePayload(FIELDS_CONFIG, payload),
		monto_pagado: 0,
		saldo_pendiente: Number(payload.monto_comprometido),
		usuario_registro: usuarioRegistro
	};

	const { data, error } = await client.from(TABLE_NAME).insert(insertData).select('*, proveedor(razon_social)').single();
	if (error) return { success: false, message: `No se pudo crear la cuenta por pagar: ${error.message}` };

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
	if (typeof updateData.monto_comprometido === 'number') {
		const { data: current } = await client.from(TABLE_NAME).select('monto_pagado').eq(PK_COLUMN, id).single();
		const pagado = Number(current?.monto_pagado ?? 0);
		updateData.saldo_pendiente = Math.max(updateData.monto_comprometido - pagado, 0);
	}

	const { data, error } = await client
		.from(TABLE_NAME)
		.update(updateData)
		.eq(PK_COLUMN, id)
		.select('*, proveedor(razon_social)')
		.single();
	if (error) return { success: false, message: `No se pudo actualizar la cuenta por pagar: ${error.message}` };

	return { success: true, message: 'Cuenta por pagar actualizada correctamente', data: data as CuentaPagar };
}

export async function deleteCuentaPagar(client: SupabaseClient, id: number): Promise<ServiceResult> {
	// ON DELETE CASCADE en pagos.id_cuenta_pagar se encarga de borrar sus pagos asociados.
	const { error } = await client.from(TABLE_NAME).delete().eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo eliminar la cuenta por pagar: ${error.message}` };
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
	if (error) return { success: false, message: `No se pudo registrar el pago: ${error.message}` };

	await recalcularCuentaPagar(client, idCuentaPagar);
	return { success: true, message: 'Pago registrado correctamente', data: data as Pago };
}

export async function deletePago(client: SupabaseClient, idPago: number): Promise<ServiceResult> {
	const { data: pago, error: fetchError } = await client.from(PAGO_TABLE).select(PARENT_FK_COLUMN).eq(PAGO_PK, idPago).single();
	if (fetchError || !pago) return { success: false, message: 'Pago no encontrado' };

	const { error } = await client.from(PAGO_TABLE).delete().eq(PAGO_PK, idPago);
	if (error) return { success: false, message: `No se pudo eliminar el pago: ${error.message}` };

	await recalcularCuentaPagar(client, (pago as any)[PARENT_FK_COLUMN]);
	return { success: true, message: 'Pago eliminado correctamente' };
}

/**
 * Recalcula monto_pagado/saldo_pendiente sumando los pagos reales de la cuenta, y ajusta estado
 * a pendiente/pagado. Preserva "vencido" si ya estaba así marcado (marca manual, no derivada del
 * saldo). No es una transacción atómica de BD — ver misma nota en cuentasCobrar.service.ts.
 */
async function recalcularCuentaPagar(client: SupabaseClient, idCuentaPagar: number): Promise<void> {
	const { data: cuenta } = await client.from(TABLE_NAME).select('monto_comprometido, estado').eq(PK_COLUMN, idCuentaPagar).single();
	if (!cuenta) return;

	const { data: pagos } = await client.from(PAGO_TABLE).select('monto').eq(PARENT_FK_COLUMN, idCuentaPagar);
	const totalPagado = (pagos ?? []).reduce((sum: number, p: any) => sum + Number(p.monto), 0);
	const saldoPendiente = Math.max(Number(cuenta.monto_comprometido) - totalPagado, 0);

	const nuevoEstado = cuenta.estado === 'vencido' ? 'vencido' : saldoPendiente <= 0 ? 'pagado' : 'pendiente';

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
