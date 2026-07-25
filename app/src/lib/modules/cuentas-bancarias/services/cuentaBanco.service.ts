/**
 * Servicio de acceso a datos para "cuenta_banco" (autorización de cuentas bancarias).
 * Recibe el SupabaseClient como parámetro; se invoca client-side con el cliente anon
 * ($lib/supabaseClient) para funcionar igual en web y en Tauri (Windows/Android) sin
 * servidor embebido. AJUSTAR: la BD no tiene RLS real todavía, ver nota en +page.svelte.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FieldOption } from '$lib/shared/fieldConfig';
import { validatePayload, buildWritablePayload, translateSupabaseError } from '$lib/shared/fieldConfig';
import { TABLE_NAME, PK_COLUMN, SEARCHABLE_COLUMNS, DEFAULT_PAGE_SIZE, DEFAULT_SORT_FIELD, DEFAULT_SORT_DIR, FIELDS_CONFIG } from '../config/cuentaBanco.config';

export interface CuentaBanco {
	id_cuenta_banco: number;
	numero_cuenta: string;
	titular_cuenta: string;
	nombre_banco: string;
	tipo_cuenta: 'corriente' | 'ahorros' | 'plazo_fijo' | 'mancomunada' | 'sueldo';
	tipo_moneda: 'soles' | 'dolares' | 'otro';
	cci_cuenta: string | null;
	numero_tarjeta: string | null;
	estado: 'activa' | 'inactiva' | 'autorizada' | 'no_autorizada';
	usuario: string | null;
	fecha_autorizacion: string | null;
	observacion: string | null;
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

export async function getCuentasBanco(client: SupabaseClient, params: ListParams = {}): Promise<ListResult<CuentaBanco>> {
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
		items: (data ?? []) as CuentaBanco[],
		total,
		page,
		pageSize,
		totalPages: Math.max(1, Math.ceil(total / pageSize))
	};
}

export async function createCuentaBanco(
	client: SupabaseClient,
	payload: Record<string, unknown>,
	usuario: string | null
): Promise<ServiceResult<CuentaBanco>> {
	const errors = validatePayload(FIELDS_CONFIG, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}

	const insertData = { ...buildWritablePayload(FIELDS_CONFIG, payload), usuario };
	const { data, error } = await client.from(TABLE_NAME).insert(insertData).select('*').single();
	if (error) return { success: false, message: `No se pudo crear la cuenta bancaria: ${translateSupabaseError(error, FIELDS_CONFIG)}` };
	return { success: true, message: 'Cuenta bancaria creada correctamente', data: data as CuentaBanco };
}

export async function updateCuentaBanco(
	client: SupabaseClient,
	id: number,
	payload: Record<string, unknown>
): Promise<ServiceResult<CuentaBanco>> {
	const errors = validatePayload(FIELDS_CONFIG, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}

	const updateData = buildWritablePayload(FIELDS_CONFIG, payload);
	const { data, error } = await client.from(TABLE_NAME).update(updateData).eq(PK_COLUMN, id).select('*').single();
	if (error) return { success: false, message: `No se pudo actualizar la cuenta bancaria: ${translateSupabaseError(error, FIELDS_CONFIG)}` };
	return { success: true, message: 'Cuenta bancaria actualizada correctamente', data: data as CuentaBanco };
}

export async function deleteCuentaBanco(client: SupabaseClient, id: number): Promise<ServiceResult> {
	const { error } = await client.from(TABLE_NAME).delete().eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo eliminar: ${translateSupabaseError(error, FIELDS_CONFIG)}` };
	return { success: true, message: 'Cuenta bancaria eliminada correctamente' };
}

/** Para el dropdown de "Cuenta Destino" en TransaccionModal.svelte (Transacción Externa + Tipo
 * Ingreso): el valor guardado sigue siendo el número de cuenta en texto libre (mismo formato que
 * siempre tuvo `transaccion.cuente_destino`), no el id — solo se ofrece como lista en vez de
 * digitarlo a mano, para asegurar que el dinero entrante vaya a una cuenta bancaria ya registrada.
 * Se muestra como "Titular - N° de cuenta", ordenado alfabéticamente por titular. */
export async function getCuentaBancoOptions(client: SupabaseClient): Promise<FieldOption[]> {
	const { data, error } = await client
		.from(TABLE_NAME)
		.select('numero_cuenta, titular_cuenta, nombre_banco')
		.order('titular_cuenta');
	if (error) throw error;
	return (data ?? []).map((c: any) => ({ value: c.numero_cuenta, label: `${c.titular_cuenta} - ${c.numero_cuenta}` }));
}
