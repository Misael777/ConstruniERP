/**
 * Servicio de acceso a datos para "cuentas_cobrar" + su detalle "cobros".
 * Recibe el SupabaseClient como parámetro; se invoca client-side con el cliente anon
 * ($lib/supabaseClient) para funcionar igual en web y en Tauri (Windows/Android) sin
 * servidor embebido. AJUSTAR: la BD no tiene RLS real todavía, ver nota en +page.svelte.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FieldOption } from '$lib/shared/fieldConfig';
import { validatePayload, buildWritablePayload, translateSupabaseError } from '$lib/shared/fieldConfig';
import { TABLE_NAME, PK_COLUMN, SEARCHABLE_COLUMNS, DEFAULT_PAGE_SIZE, DEFAULT_SORT_FIELD, DEFAULT_SORT_DIR, FIELDS_CONFIG } from '../config/cuentaCobrar.config';
import {
	TABLE_NAME as COBRO_TABLE,
	PK_COLUMN as COBRO_PK,
	PARENT_FK_COLUMN,
	FIELDS_CONFIG as COBRO_FIELDS
} from '../config/cobro.config';

export interface CuentaCobrar {
	id_cuenta_cobrar: number;
	id_cliente: number;
	id_proyecto: number | null;
	tipo_documento: number | null;
	num_documento: string | null;
	monto: number;
	monto_cobrado: number;
	saldo_pendiente: number;
	forma_pago: number | null;
	condición_pago: number | null;
	responsable: string | null;
	fecha_emision: string;
	fecha_vencimiento: string | null;
	moneda: string | null;
	observaciones: string | null;
	estado: string;
	usuario_registro: string | null;
	created_at: string;
	cliente?: { nombre: string } | null;
	proyecto?: { nombre_proyecto: string } | null;
}

export interface Cobro {
	id_cobro: number;
	id_cuenta_cobrar: number;
	monto: number;
	fecha_cobro: string;
	medio_cobro: number | null;
	num_operacion: string | null;
	cuenta_banco: number | null;
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

export async function getCuentasCobrar(client: SupabaseClient, params: ListParams = {}): Promise<ListResult<CuentaCobrar>> {
	const page = Math.max(1, Math.floor(params.page ?? 1));
	const pageSize = Math.max(1, Math.floor(params.pageSize ?? DEFAULT_PAGE_SIZE));
	const sortField = params.sortBy && SORTABLE_KEYS.has(params.sortBy) ? params.sortBy : DEFAULT_SORT_FIELD;
	const sortDir: 'asc' | 'desc' = params.sortDir === 'asc' || params.sortDir === 'desc' ? params.sortDir : DEFAULT_SORT_DIR;

	const from = (page - 1) * pageSize;
	const to = from + pageSize - 1;

	let query = client
		.from(TABLE_NAME)
		.select('*, cliente(nombre), proyecto(nombre_proyecto)', { count: 'exact' })
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
		items: (data ?? []) as CuentaCobrar[],
		total,
		page,
		pageSize,
		totalPages: Math.max(1, Math.ceil(total / pageSize))
	};
}

export async function createCuentaCobrar(
	client: SupabaseClient,
	payload: Record<string, unknown>,
	usuarioRegistro: string | null
): Promise<ServiceResult<CuentaCobrar>> {
	const errors = validatePayload(FIELDS_CONFIG, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}

	const insertData = { ...buildWritablePayload(FIELDS_CONFIG, payload), monto_cobrado: 0, saldo_pendiente: Number(payload.monto), usuario_registro: usuarioRegistro };

	const { data, error } = await client.from(TABLE_NAME).insert(insertData).select('*, cliente(nombre), proyecto(nombre_proyecto)').single();
	if (error) return { success: false, message: `No se pudo crear la cuenta por cobrar: ${translateSupabaseError(error, FIELDS_CONFIG)}` };

	return { success: true, message: 'Cuenta por cobrar creada correctamente', data: data as CuentaCobrar };
}

export async function updateCuentaCobrar(
	client: SupabaseClient,
	id: number,
	payload: Record<string, unknown>
): Promise<ServiceResult<CuentaCobrar>> {
	const errors = validatePayload(FIELDS_CONFIG, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}

	// monto_cobrado / saldo_pendiente no se tocan aquí (showInForm:false los excluye de buildWritablePayload);
	// si cambia "monto", el saldo se recalcula para reflejar lo ya cobrado hasta ahora.
	const updateData = buildWritablePayload(FIELDS_CONFIG, payload);
	if (typeof updateData.monto === 'number') {
		const { data: current } = await client.from(TABLE_NAME).select('monto_cobrado').eq(PK_COLUMN, id).single();
		const cobrado = Number(current?.monto_cobrado ?? 0);
		updateData.saldo_pendiente = Math.max(updateData.monto - cobrado, 0);
	}

	const { data, error } = await client
		.from(TABLE_NAME)
		.update(updateData)
		.eq(PK_COLUMN, id)
		.select('*, cliente(nombre), proyecto(nombre_proyecto)')
		.single();
	if (error) return { success: false, message: `No se pudo actualizar la cuenta por cobrar: ${translateSupabaseError(error, FIELDS_CONFIG)}` };

	return { success: true, message: 'Cuenta por cobrar actualizada correctamente', data: data as CuentaCobrar };
}

export async function deleteCuentaCobrar(client: SupabaseClient, id: number): Promise<ServiceResult> {
	// ON DELETE CASCADE en cobros.id_cuenta_cobrar se encarga de borrar sus cobros asociados.
	const { error } = await client.from(TABLE_NAME).delete().eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo eliminar la cuenta por cobrar: ${translateSupabaseError(error, FIELDS_CONFIG)}` };
	return { success: true, message: 'Cuenta por cobrar eliminada correctamente' };
}

export async function getCobros(client: SupabaseClient, idCuentaCobrar: number): Promise<Cobro[]> {
	const { data, error } = await client
		.from(COBRO_TABLE)
		.select('*')
		.eq(PARENT_FK_COLUMN, idCuentaCobrar)
		.order('fecha_cobro', { ascending: false });
	if (error) throw error;
	return (data ?? []) as Cobro[];
}

export async function createCobro(
	client: SupabaseClient,
	idCuentaCobrar: number,
	payload: Record<string, unknown>,
	usuarioRegistro: string | null
): Promise<ServiceResult<Cobro>> {
	const errors = validatePayload(COBRO_FIELDS, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}

	const insertData = {
		...buildWritablePayload(COBRO_FIELDS, payload),
		[PARENT_FK_COLUMN]: idCuentaCobrar,
		usuario_registro: usuarioRegistro
	};

	const { data, error } = await client.from(COBRO_TABLE).insert(insertData).select('*').single();
	if (error) return { success: false, message: `No se pudo registrar el cobro: ${translateSupabaseError(error, COBRO_FIELDS)}` };

	await recalcularCuentaCobrar(client, idCuentaCobrar);
	return { success: true, message: 'Cobro registrado correctamente', data: data as Cobro };
}

export async function deleteCobro(client: SupabaseClient, idCobro: number): Promise<ServiceResult> {
	const { data: cobro, error: fetchError } = await client.from(COBRO_TABLE).select(PARENT_FK_COLUMN).eq(COBRO_PK, idCobro).single();
	if (fetchError || !cobro) return { success: false, message: 'Cobro no encontrado' };

	const { error } = await client.from(COBRO_TABLE).delete().eq(COBRO_PK, idCobro);
	if (error) return { success: false, message: `No se pudo eliminar el cobro: ${translateSupabaseError(error, COBRO_FIELDS)}` };

	await recalcularCuentaCobrar(client, (cobro as any)[PARENT_FK_COLUMN]);
	return { success: true, message: 'Cobro eliminado correctamente' };
}

/**
 * Recalcula monto_cobrado/saldo_pendiente sumando los cobros reales de la cuenta, y ajusta
 * estado a pendiente/pagado según corresponda. Preserva "vencido" si ya estaba así marcado
 * (es una marca manual, no derivada del saldo). No es una transacción atómica de BD — con el
 * volumen esperado de cobros por cuenta el riesgo de condición de carrera es bajo, pero si el
 * ERP crece a alta concurrencia, esto debería moverse a una función SQL con transacción real.
 */
async function recalcularCuentaCobrar(client: SupabaseClient, idCuentaCobrar: number): Promise<void> {
	const { data: cuenta } = await client.from(TABLE_NAME).select('monto, estado').eq(PK_COLUMN, idCuentaCobrar).single();
	if (!cuenta) return;

	const { data: cobros } = await client.from(COBRO_TABLE).select('monto').eq(PARENT_FK_COLUMN, idCuentaCobrar);
	const totalCobrado = (cobros ?? []).reduce((sum: number, c: any) => sum + Number(c.monto), 0);
	const saldoPendiente = Math.max(Number(cuenta.monto) - totalCobrado, 0);

	const nuevoEstado = cuenta.estado === 'vencido' ? 'vencido' : saldoPendiente <= 0 ? 'pagado' : 'pendiente';

	await client
		.from(TABLE_NAME)
		.update({ monto_cobrado: totalCobrado, saldo_pendiente: saldoPendiente, estado: nuevoEstado })
		.eq(PK_COLUMN, idCuentaCobrar);
}

export async function getClienteOptions(client: SupabaseClient): Promise<FieldOption[]> {
	const { data, error } = await client.from('cliente').select('id_cliente, nombre').order('nombre');
	if (error) throw error;
	return (data ?? []).map((c: any) => ({ value: String(c.id_cliente), label: c.nombre }));
}

export async function getProyectoOptions(client: SupabaseClient): Promise<FieldOption[]> {
	const { data, error } = await client.from('proyecto').select('id_proyecto, nombre_proyecto').order('nombre_proyecto');
	if (error) throw error;
	return (data ?? []).map((p: any) => ({ value: String(p.id_proyecto), label: p.nombre_proyecto }));
}
