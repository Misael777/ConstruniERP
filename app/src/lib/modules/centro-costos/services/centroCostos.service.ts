/**
 * Servicio de acceso a datos para "centro_costo".
 *
 * Recibe el SupabaseClient como parámetro en vez de importar uno fijo. Se invoca
 * client-side con el cliente anon ($lib/supabaseClient) para que el módulo funcione
 * igual en web, y en los builds de Tauri (Windows/Android) que no tienen servidor
 * SvelteKit embebido — mismo patrón que el módulo de partidas.
 *
 * AJUSTAR: la BD no tiene políticas RLS reales todavía (ver nota de seguridad en
 * +page.svelte), así que hoy la anon key puede leer/escribir esta tabla sin pasar
 * por la UI. Cuando se agregue RLS, este servicio no necesita cambios — solo la
 * política en Postgres.
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
	descripcion: string | null;
	created_at: string;
	/** Vinculación a la entidad dueña de este centro de costo — como mucho UNA de las cuatro no-nula
	 * (ver chk_centro_costo_una_entidad, centro_costo_vinculacion_migration.sql +
	 * centro_costo_empleado_migration.sql). Se completan solas vía getOrCrearCentroCostoParaEntidad
	 * (o su equivalente en supabase/functions/user-admin para empleados, que corre en Deno y no puede
	 * importar este archivo), nunca a mano desde el formulario genérico. */
	id_proyecto: number | null;
	id_cliente: number | null;
	id_proveedor: number | null;
	id_empleado: number | null;
	/** Solo para filas vinculadas a un proveedor (pestaña "Cuentas Internas"): el "Producto y Servicio"
	 * de ese proveedor (columna real `proveedor.vendedor`, ver ProveedorModal.svelte) — se trae con un
	 * embed, no es una columna propia de centro_costo. null para filas sin proveedor vinculado. */
	producto: string | null;
}

export interface EntidadVinculada {
	tipo: 'Proyecto' | 'Cliente' | 'Proveedor' | 'Empleado';
	id: number;
	nombre: string;
}

/**
 * Resuelve el nombre ACTUAL de la entidad vinculada a un centro de costo (no el `centro.nombre`
 * guardado, que podría haber quedado desactualizado si la entidad se renombró después). Usado
 * tanto por el banner de vinculación de CentroCostoModal.svelte (modo edición) como por el panel
 * de detalle de centros-de-costos/+page.svelte — antes duplicado en el modal, consolidado acá.
 * null si el centro de costo no está vinculado a ninguna entidad (creado a mano).
 */
export async function resolveEntidadVinculada(client: SupabaseClient, centro: CentroCosto): Promise<EntidadVinculada | null> {
	if (centro.id_proyecto) {
		const { data } = await client.from('proyecto').select('nombre_proyecto').eq('id_proyecto', centro.id_proyecto).maybeSingle();
		return { tipo: 'Proyecto', id: centro.id_proyecto, nombre: data?.nombre_proyecto ?? centro.nombre };
	}
	if (centro.id_cliente) {
		const { data } = await client.from('cliente').select('nombre').eq('id_cliente', centro.id_cliente).maybeSingle();
		return { tipo: 'Cliente', id: centro.id_cliente, nombre: data?.nombre ?? centro.nombre };
	}
	if (centro.id_proveedor) {
		const { data } = await client.from('proveedor').select('razon_social').eq('id_proveedor', centro.id_proveedor).maybeSingle();
		return { tipo: 'Proveedor', id: centro.id_proveedor, nombre: data?.razon_social ?? centro.nombre };
	}
	if (centro.id_empleado) {
		const { data } = await client.from('empleados').select('nombre').eq('id', centro.id_empleado).maybeSingle();
		return { tipo: 'Empleado', id: centro.id_empleado, nombre: data?.nombre ?? centro.nombre };
	}
	return null;
}

export type EntidadCentroCosto = 'proyecto' | 'cliente' | 'proveedor' | 'empleado';

const PREFIJO_CODIGO_POR_TIPO: Record<EntidadCentroCosto, string> = {
	proyecto: 'PROY',
	cliente: 'CLI',
	proveedor: 'PROV',
	empleado: 'EMP'
};

const COLUMNA_POR_TIPO: Record<EntidadCentroCosto, 'id_proyecto' | 'id_cliente' | 'id_proveedor' | 'id_empleado'> = {
	proyecto: 'id_proyecto',
	cliente: 'id_cliente',
	proveedor: 'id_proveedor',
	empleado: 'id_empleado'
};

/** Prefijos para los centros de costo creados A MANO desde "Nuevo Centro de Costo" (ver
 * FIELDS_CONFIG.tipo.formOptions en centroCostos.config.ts) — a diferencia de
 * PREFIJO_CODIGO_POR_TIPO (arriba), que es para los automáticos de proyecto/cliente/proveedor/empleado. */
const PREFIJO_CODIGO_MANUAL: Record<string, string> = {
	obra: 'OBRA',
	consultoria: 'CONS',
	'bolsa general': 'BG'
};

/** Genera el código de un centro de costo creado a mano — a pedido del usuario, el campo 'codigo'
 * ya no se escribe desde el formulario (ver showInForm:false en centroCostos.config.ts).
 * Esquema: PREFIJO-NNN, con NNN = cantidad de centros de ese `tipo` ya existentes + 1. */
async function generarCodigoCentroCostoManual(client: SupabaseClient, tipo: string): Promise<string> {
	const prefijo = PREFIJO_CODIGO_MANUAL[tipo] ?? (tipo.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 6) || 'CC');
	const { count } = await client.from(TABLE_NAME).select('id_centro_costo', { count: 'exact', head: true }).eq('tipo', tipo);
	const siguiente = (count ?? 0) + 1;
	return `${prefijo}-${String(siguiente).padStart(3, '0')}`;
}

export interface ListParams {
	page?: number;
	pageSize?: number;
	search?: string;
	sortBy?: string;
	sortDir?: 'asc' | 'desc';
	/**
	 * Separa el módulo en sus dos tabs ("Centro de Costos y Cuentas Internas"). OJO: proyecto NO
	 * cuenta como "Cuentas Internas" pese a estar vinculado — un proyecto ES un centro de costo real
	 * (ahí se sigue el presupuesto/gasto de la obra), a diferencia de cliente/proveedor/empleado que
	 * son cuentas de seguimiento (cobros, pagos, planilla), no centros de costo de obra.
	 *   - true  -> solo filas vinculadas a cliente/proveedor/empleado = "Cuentas Internas"
	 *   - false -> todo lo demás: sin vincular (creadas a mano) O vinculadas a proyecto = "Centros de Costos"
	 *   - undefined -> sin filtrar (todas)
	 */
	vinculado?: boolean;
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

	// 'producto' no es un campo de FIELDS_CONFIG (ver nota en CentroCosto.producto) — se acepta aparte
	// y se ordena vía el embed a proveedor, no como columna propia de centro_costo.
	const sortByProducto = params.sortBy === 'producto';
	const sortField = sortByProducto ? 'producto' : params.sortBy && SORTABLE_KEYS.has(params.sortBy) ? params.sortBy : DEFAULT_SORT_FIELD;
	const sortDir: 'asc' | 'desc' = params.sortDir === 'asc' || params.sortDir === 'desc' ? params.sortDir : DEFAULT_SORT_DIR;

	const from = (page - 1) * pageSize;
	const to = from + pageSize - 1;

	let query = client
		.from(TABLE_NAME)
		.select('*, proveedor(vendedor)', { count: 'exact' })
		.range(from, to);

	query = sortByProducto
		? query.order('vendedor', { foreignTable: 'proveedor', ascending: sortDir === 'asc' })
		: query.order(sortField, { ascending: sortDir === 'asc' });

	if (params.vinculado === true) {
		// "Cuentas Internas" — proyecto queda fuera a propósito, ver doc de ListParams.vinculado.
		query = query.or('id_cliente.not.is.null,id_proveedor.not.is.null,id_empleado.not.is.null');
	} else if (params.vinculado === false) {
		// "Centros de Costos" — todos los creados a mano desde "Nuevo Centro de Costo" (los 3 tipos de
		// formOptions: obra/consultoría/bolsa general — antes solo se dejaba pasar 'bolsa general' por
		// error, dejando fuera obra/consultoría pese a que el propio formulario los ofrece como opción)
		// MÁS los vinculados a un proyecto que YA es una venta cerrada (estado_proyecto='venta_cerrada',
		// a pedido del usuario: un proyecto todavía en negociación no cuenta como centro de costo activo
		// todavía). PostgREST no permite mezclar en un solo .or() una condición de columna propia (tipo)
		// con una del embed (proyecto.estado_proyecto), así que se resuelve en dos pasos: primero se
		// traen los ids de proyecto ya cerrados, luego se filtra centro_costo por esos ids O tipo manual.
		const { data: cerrados, error: errorCerrados } = await client.from('proyecto').select('id_proyecto').eq('estado_proyecto', 'venta_cerrada');
		if (errorCerrados) throw errorCerrados;
		const idsCerrados = (cerrados ?? []).map((p: any) => p.id_proyecto);
		const idProyectoFilter = idsCerrados.length > 0 ? `id_proyecto.in.(${idsCerrados.join(',')})` : 'id_proyecto.eq.-1';
		query = query.or(`tipo.eq.obra,tipo.eq.consultoria,tipo.eq.bolsa general,${idProyectoFilter}`);
	}

	const search = params.search?.trim();
	if (search) {
		const escaped = search.replace(/[%_]/g, (m) => `\\${m}`);
		const orFilter = [...SEARCHABLE_COLUMNS.map((col) => `${col}.ilike.%${escaped}%`), `proveedor.vendedor.ilike.%${escaped}%`].join(',');
		query = query.or(orFilter);
	}

	const { data, error, count } = await query;
	if (error) throw error;

	const items = ((data ?? []) as any[]).map((row) => ({ ...row, producto: row.proveedor?.vendedor ?? null }));

	const total = count ?? 0;
	return {
		items: items as CentroCosto[],
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

	const codigo = await generarCodigoCentroCostoManual(client, String(payload.tipo ?? ''));
	const { data, error } = await client
		.from(TABLE_NAME)
		.insert({ ...buildWritablePayload(payload), codigo })
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
	// Un centro de costo creado automáticamente para una entidad (proyecto/cliente/proveedor/
	// empleado) no se borra directo — su ciclo de vida lo dicta la entidad dueña (ver el FK
	// "ON DELETE CASCADE" de cada columna en las migraciones). Si se permitiera borrarlo aquí,
	// quedaría un huérfano en el otro sentido: la entidad sigue existiendo pero su próxima
	// transacción/pago dispararía un getOrCrear que le crea uno NUEVO, duplicando el concepto.
	const { data: existente, error: fetchError } = await client
		.from(TABLE_NAME)
		.select('id_proyecto, id_cliente, id_proveedor, id_empleado')
		.eq(PK_COLUMN, id)
		.maybeSingle();

	if (fetchError) {
		return { success: false, message: `No se pudo verificar el centro de costo: ${fetchError.message}` };
	}

	const entidadVinculada = existente
		? (Object.keys(COLUMNA_POR_TIPO) as EntidadCentroCosto[]).find((tipo) => existente[COLUMNA_POR_TIPO[tipo]])
		: undefined;

	if (entidadVinculada) {
		return {
			success: false,
			message: `Este centro de costo se creó automáticamente para un ${entidadVinculada} y no se puede eliminar directamente. Elimina ese ${entidadVinculada} si de verdad quieres quitarlo — su centro de costo se borra solo, en cascada.`
		};
	}

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

/**
 * Busca el centro de costo ya vinculado a esta entidad (proyecto/cliente/proveedor) y, si no existe,
 * lo crea — idempotente (protegido además por el índice único parcial de la migración, ante una
 * carrera entre dos llamadas casi simultáneas). Pensado para llamarse:
 *   1. Al crear la entidad (ClienteModal.svelte, ProveedorModal.svelte, NuevaVentaModal.svelte), y
 *   2. De forma perezosa cuando haga falta un centro de costo para generar una transacción de un
 *      pago/cobro (ver transacciones.service.ts) — cubre entidades creadas antes de esta migración,
 *      o si el paso 1 falló por lo que sea.
 * Nunca lanza: crear el centro de costo es secundario al flujo principal (guardar el cliente/
 * proveedor/proyecto, o registrar la transacción), así que un fallo aquí se loguea y devuelve null
 * en vez de tumbar esa operación principal.
 */
export async function getOrCrearCentroCostoParaEntidad(
	client: SupabaseClient,
	tipo: EntidadCentroCosto,
	idEntidad: number,
	nombre: string
): Promise<number | null> {
	const columna = COLUMNA_POR_TIPO[tipo];

	const { data: existente } = await client.from(TABLE_NAME).select('id_centro_costo').eq(columna, idEntidad).maybeSingle();
	if (existente) return existente.id_centro_costo;

	const codigo = `${PREFIJO_CODIGO_POR_TIPO[tipo]}-${idEntidad}`;
	const { data: creado, error } = await client
		.from(TABLE_NAME)
		.insert({ codigo, nombre: nombre.slice(0, 200), tipo, [columna]: idEntidad, monto_actual: 0 })
		.select('id_centro_costo')
		.single();

	if (error) {
		if (error.code === '23505') {
			// Carrera: otra llamada ya insertó el centro de costo de esta entidad justo antes — se usa ese.
			const { data: reintento } = await client.from(TABLE_NAME).select('id_centro_costo').eq(columna, idEntidad).maybeSingle();
			if (reintento) return reintento.id_centro_costo;
		}
		console.error(`[centroCostos.service] No se pudo crear el centro de costo para ${tipo} #${idEntidad}:`, error);
		return null;
	}

	return creado?.id_centro_costo ?? null;
}

/**
 * Centro de costo COMPARTIDO por TODOS los proyectos de un mismo tipo de venta — a diferencia de
 * getOrCrearCentroCostoParaEntidad (uno POR proyecto, usado para Obra), esto busca/crea UNA sola
 * fila `tipo=X AND id_proyecto IS NULL` y la reutiliza para cada venta de ese tipo (hoy solo
 * 'consultoria', a pedido explícito del usuario: todas las ventas de Consultoría comparten una
 * misma bolsa de centro de costo, en vez de una por proyecto). Idempotente vía el índice único
 * parcial `uq_centro_costo_consultoria_compartido` (ver proyecto_tipo_venta_migration.sql).
 * Nunca lanza — mismo criterio que getOrCrearCentroCostoParaEntidad.
 */
export async function getOrCrearCentroCostoCompartido(
	client: SupabaseClient,
	tipo: 'consultoria',
	nombre = 'Consultoría General'
): Promise<number | null> {
	const { data: existente } = await client.from(TABLE_NAME).select('id_centro_costo').eq('tipo', tipo).is('id_proyecto', null).maybeSingle();
	if (existente) return existente.id_centro_costo;

	const codigo = await generarCodigoCentroCostoManual(client, tipo);
	const { data: creado, error } = await client
		.from(TABLE_NAME)
		.insert({ codigo, nombre, tipo, monto_actual: 0 })
		.select('id_centro_costo')
		.single();

	if (error) {
		if (error.code === '23505') {
			// Carrera: otra llamada ya creó el centro de costo compartido justo antes — se usa ese.
			const { data: reintento } = await client.from(TABLE_NAME).select('id_centro_costo').eq('tipo', tipo).is('id_proyecto', null).maybeSingle();
			if (reintento) return reintento.id_centro_costo;
		}
		console.error(`[centroCostos.service] No se pudo crear el centro de costo compartido de ${tipo}:`, error);
		return null;
	}

	return creado?.id_centro_costo ?? null;
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
