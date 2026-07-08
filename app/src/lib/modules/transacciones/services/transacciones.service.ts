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

export async function createTransaccion(
	client: SupabaseClient,
	payload: Record<string, unknown>,
	usuarioRegistro: string | null
): Promise<ServiceResult<Transaccion>> {
	const errors = validatePayload(FIELDS_CONFIG, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}

	const insertData = { ...buildWritablePayload(FIELDS_CONFIG, payload), usuario_registro: usuarioRegistro };

	const { data, error } = await client.from(TABLE_NAME).insert(insertData).select('*').single();
	if (error) return { success: false, message: `No se pudo crear la transacción: ${translateSupabaseError(error, FIELDS_CONFIG)}` };

	return { success: true, message: 'Transacción creada correctamente', data: data as Transaccion };
}

export async function updateTransaccion(
	client: SupabaseClient,
	id: number,
	payload: Record<string, unknown>
): Promise<ServiceResult<Transaccion>> {
	const errors = validatePayload(FIELDS_CONFIG, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}

	const updateData = buildWritablePayload(FIELDS_CONFIG, payload);

	const { data, error } = await client.from(TABLE_NAME).update(updateData).eq(PK_COLUMN, id).select('*').single();
	if (error) return { success: false, message: `No se pudo actualizar la transacción: ${translateSupabaseError(error, FIELDS_CONFIG)}` };

	return { success: true, message: 'Transacción actualizada correctamente', data: data as Transaccion };
}

export async function deleteTransaccion(client: SupabaseClient, id: number): Promise<ServiceResult> {
	// ON DELETE CASCADE en trans_detalle.id_transaccion se encarga de borrar su detalle asociado.
	const { error } = await client.from(TABLE_NAME).delete().eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo eliminar la transacción: ${translateSupabaseError(error, FIELDS_CONFIG)}` };
	return { success: true, message: 'Transacción eliminada correctamente' };
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

export async function getPartidaOptions(client: SupabaseClient): Promise<FieldOption[]> {
	const { data, error } = await client.from('partida').select('id_partida, codigo, descripcion').order('codigo');
	if (error) throw error;
	return (data ?? []).map((p: any) => ({ value: String(p.id_partida), label: `${p.codigo} - ${p.descripcion}` }));
}

const MEDIO_PAGO_OPTIONS = FIELDS_CONFIG.find((f) => f.key === 'medio_pago')!.options!;

/** Busca el `value` (código) de una opción a partir de su `label` exacto. Usado para traducir el
 * medio_pago en texto libre de `pagos` (ej. "Efectivo") al código VARCHAR(2) que espera `transaccion`. */
function codigoPorLabel(label: string | null | undefined): string | null {
	if (!label) return null;
	return MEDIO_PAGO_OPTIONS.find((o) => o.label === label)?.value ?? null;
}

/**
 * Devuelve el id del centro de costo "externo" fijo que representa la contraparte (proveedor o
 * cliente) en las transacciones autogeneradas por pagos/cobros — `transaccion` exige SIEMPRE un
 * centro de costo origen y uno destino, pero un proveedor/cliente no es un centro de costo real.
 * Lo crea la primera vez que hace falta (idempotente: busca por `codigo` antes de insertar).
 */
async function getOrCrearCentroExterno(client: SupabaseClient, tipo: 'proveedores' | 'clientes'): Promise<number> {
	const codigo = tipo === 'proveedores' ? 'EXT-PROV' : 'EXT-CLI';
	const nombre = tipo === 'proveedores' ? 'Externo - Proveedores' : 'Externo - Clientes';

	const { data: existente } = await client.from('centro_costo').select('id_centro_costo').eq('codigo', codigo).maybeSingle();
	if (existente) return existente.id_centro_costo;

	const { data: creado, error } = await client.from('centro_costo').insert({ codigo, nombre, tipo: 'otro' }).select('id_centro_costo').single();
	if (error || !creado) throw new Error('No se pudo crear el centro de costo externo automático');
	return creado.id_centro_costo;
}

/**
 * Genera automáticamente la transacción (tipo 'egreso') correspondiente a un pago recién registrado.
 * Solo se llama al crear un pago nuevo (createPago en cuentasPagar.service.ts) — NO cuando una cuota
 * programada pasa a 'pagado' después (así se acordó con el usuario). Si la cuenta por pagar todavía
 * no tiene `id_centro_costo` asignado (cuentas creadas antes de esta migración), se omite en silencio:
 * el pago ya se registró, la transacción es un registro contable secundario, no debe bloquear el pago.
 */
export async function registrarTransaccionPorPago(
	client: SupabaseClient,
	cuentaPagar: {
		id_cuenta_pagar: number;
		id_centro_costo: number | null;
		tipo_documento: number | null;
		num_documento: string | null;
		fotma_pago: number | null;
	},
	pago: { monto: number; fecha_pago: string; medio_pago: string | null; referencia: string | null },
	usuarioRegistro: string | null
): Promise<void> {
	if (!cuentaPagar.id_centro_costo) return;

	const idCentroDestino = await getOrCrearCentroExterno(client, 'proveedores');

	await client.from(TABLE_NAME).insert({
		id_centro_costo_origen: cuentaPagar.id_centro_costo,
		id_centro_costo_destino: idCentroDestino,
		fecha: pago.fecha_pago,
		tipo_documento: cuentaPagar.tipo_documento !== null ? String(cuentaPagar.tipo_documento) : null,
		num_documento: cuentaPagar.num_documento,
		forma_pago: cuentaPagar.fotma_pago !== null ? String(cuentaPagar.fotma_pago) : null,
		tipo: 'egreso',
		monto_total: pago.monto,
		medio_pago: codigoPorLabel(pago.medio_pago),
		descripcion: `Pago de cuenta por pagar #${cuentaPagar.id_cuenta_pagar}${pago.referencia ? ' - ' + pago.referencia : ''}`,
		estado: 'activo',
		usuario_registro: usuarioRegistro
	});
}

/**
 * Genera automáticamente la transacción (tipo 'ingreso') correspondiente a un cobro recién registrado.
 * Se llama siempre al crear un cobro (createCobro en cuentasCobrar.service.ts) — cuentas_cobrar no
 * tiene concepto de cuotas 'programado', todo cobro registrado ya es real. Igual que con los pagos, si
 * la cuenta por cobrar no tiene `id_centro_costo` asignado, se omite en silencio.
 */
export async function registrarTransaccionPorCobro(
	client: SupabaseClient,
	cuentaCobrar: {
		id_cuenta_cobrar: number;
		id_centro_costo: number | null;
		tipo_documento: number | null;
		num_documento: string | null;
		forma_pago: number | null;
	},
	cobro: { monto: number; fecha_cobro: string; medio_cobro: number | null; cuenta_banco: string | null; referencia: string | null },
	usuarioRegistro: string | null
): Promise<void> {
	if (!cuentaCobrar.id_centro_costo) return;

	const idCentroOrigen = await getOrCrearCentroExterno(client, 'clientes');

	await client.from(TABLE_NAME).insert({
		id_centro_costo_origen: idCentroOrigen,
		id_centro_costo_destino: cuentaCobrar.id_centro_costo,
		fecha: cobro.fecha_cobro,
		tipo_documento: cuentaCobrar.tipo_documento !== null ? String(cuentaCobrar.tipo_documento) : null,
		num_documento: cuentaCobrar.num_documento,
		forma_pago: cuentaCobrar.forma_pago !== null ? String(cuentaCobrar.forma_pago) : null,
		tipo: 'ingreso',
		monto_total: cobro.monto,
		medio_pago: cobro.medio_cobro !== null ? String(cobro.medio_cobro) : null,
		cuente_destino: cobro.cuenta_banco,
		descripcion: `Cobro de cuenta por cobrar #${cuentaCobrar.id_cuenta_cobrar}${cobro.referencia ? ' - ' + cobro.referencia : ''}`,
		estado: 'activo',
		usuario_registro: usuarioRegistro
	});
}
