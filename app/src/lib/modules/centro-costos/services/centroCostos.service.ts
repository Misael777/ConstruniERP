/**
 * Servicio de acceso a datos para "centro_costo".
 *
 * Recibe el SupabaseClient como parámetro (en vez de importar uno fijo)
 * para que siempre se invoque desde +page.server.ts con el cliente de
 * service role ($lib/server/supabase) — igual que el resto de endpoints
 * administrativos del ERP (ver app/src/routes/api/*).
 *
 * Toda regla de validación/formato vive en centroCostos.config.ts; este
 * archivo solo arma las queries y traduce errores de Supabase a mensajes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
	TABLE_NAME,
	PK_COLUMN,
	SEARCHABLE_COLUMNS,
	DEFAULT_PAGE_SIZE,
	DEFAULT_SORT_FIELD,
	DEFAULT_SORT_DIR,
	DELETE_STRATEGY,
	SOFT_DELETE_COLUMN,
	SOFT_DELETE_INACTIVE_VALUE,
	FIELDS_CONFIG,
	validateCentroCostoPayload
} from '../config/centroCostos.config';

export interface CentroCosto {
	id_centro_costo: number;
	codigo: string;
	nombre: string;
	tipo: string;
	monto_actual: number; // nombre real de la columna en BD (los .sql locales tienen un typo, ver centroCostos.config.ts)
	created_at: string;
}

export interface ListParams {
	page?: number;
	pageSize?: number;
	search?: string;
	sortBy?: string;
	sortDir?: 'asc' | 'desc';
}

export interface ListResult {
	items: CentroCosto[];
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

export async function getCentroCostos(client: SupabaseClient, params: ListParams = {}): Promise<ListResult> {
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
		items: (data ?? []) as CentroCosto[],
		total,
		page,
		pageSize,
		totalPages: Math.max(1, Math.ceil(total / pageSize))
	};
}

export async function createCentroCosto(
	client: SupabaseClient,
	payload: Record<string, unknown>
): Promise<ServiceResult<CentroCosto>> {
	const errors = validateCentroCostoPayload(payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}

	const { data, error } = await client
		.from(TABLE_NAME)
		.insert(buildWritablePayload(payload))
		.select('*')
		.single();

	if (error) {
		return { success: false, message: `No se pudo crear el centro de costo: ${error.message}` };
	}

	return { success: true, message: 'Centro de costo creado correctamente', data: data as CentroCosto };
}

export async function updateCentroCosto(
	client: SupabaseClient,
	id: number,
	payload: Record<string, unknown>
): Promise<ServiceResult<CentroCosto>> {
	const errors = validateCentroCostoPayload(payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}

	const { data, error } = await client
		.from(TABLE_NAME)
		.update(buildWritablePayload(payload))
		.eq(PK_COLUMN, id)
		.select('*')
		.single();

	if (error) {
		return { success: false, message: `No se pudo actualizar el centro de costo: ${error.message}` };
	}

	return { success: true, message: 'Centro de costo actualizado correctamente', data: data as CentroCosto };
}

export async function deleteCentroCosto(client: SupabaseClient, id: number): Promise<ServiceResult> {
	if (DELETE_STRATEGY === 'soft') {
		if (!SOFT_DELETE_COLUMN) {
			return {
				success: false,
				message:
					'DELETE_STRATEGY está en "soft" pero SOFT_DELETE_COLUMN no está configurado en centroCostos.config.ts'
			};
		}
		const { error } = await client
			.from(TABLE_NAME)
			.update({ [SOFT_DELETE_COLUMN]: SOFT_DELETE_INACTIVE_VALUE })
			.eq(PK_COLUMN, id);

		if (error) return { success: false, message: `No se pudo anular el centro de costo: ${error.message}` };
		return { success: true, message: 'Centro de costo anulado correctamente' };
	}

	const { error } = await client.from(TABLE_NAME).delete().eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo eliminar el centro de costo: ${error.message}` };
	return { success: true, message: 'Centro de costo eliminado correctamente' };
}

/** Construye el objeto a insertar/actualizar, limitado a las columnas editables de FIELDS_CONFIG. */
function buildWritablePayload(payload: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const field of FIELDS_CONFIG) {
		if (!field.showInForm) continue;
		let value = payload[field.key];
		if (typeof value === 'string') value = value.trim();
		if ((field.tipo === 'number' || field.tipo === 'currency') && value !== '' && value !== undefined && value !== null) {
			value = Number(value);
		}
		result[field.key] = value === '' ? null : value;
	}
	return result;
}
