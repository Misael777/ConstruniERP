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
	SOFT_DELETE_ACTIVE_VALUE,
	SOFT_DELETE_INACTIVE_VALUE,
	FIELDS_CONFIG,
	validateCentroCostoPayload
} from '../config/centroCostos.config';
import { generarCodigoProyecto, type ProyectoCodigoFields } from '$lib/shared/codigoProyecto';

export interface CentroCosto {
	id_centro_costo: number;
	codigo: string;
	nombre: string;
	tipo: string;
	monto_actual: number; // nombre real de la columna en BD (los .sql locales tienen un typo, ver centroCostos.config.ts)
	descripcion: string | null;
	created_at: string;
	/** 'activo' | 'baja' — ver centro_costo_estado_migration.sql y darDeBajaCentroCostoDeEntidad
	 * más abajo. Nunca se edita a mano (showInForm:false en centroCostos.config.ts). */
	estado: string;
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
	/** Datos del proyecto vinculado (solo si id_proyecto no es null), traídos con un embed — a pedido
	 * del usuario, "Centro de Costos y Cuentas Internas" (pestaña Centros de Costos) los usa para
	 * mostrar el código real del proyecto (ver generarCodigoProyecto en codigoProyecto.ts) y su tipo de
	 * obra en vez del genérico "Proyecto (automático)". null para filas sin proyecto vinculado. */
	proyecto: ProyectoCodigoFields | null;
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
		// El "nombre" de un proyecto es su CÓDIGO (ver codigoProyecto.ts) — se RECALCULA acá en vez de
		// confiar en `nombre_proyecto` tal cual esté guardado, para que este banner muestre lo mismo que
		// la columna "Código de proyecto" del listado de Centros de Costos, incluso en ventas cerradas
		// antes de que nombre_proyecto empezara a guardar el código (ver historial de este archivo).
		const { data } = await client
			.from('proyecto')
			.select('tipo_venta, tip_proyecto, estado_predio, tipo_edifica, tipo_obra, tipo_tramite, tipo_intervencion, tipo_edificacion_obra, mes_obra, anio_obra, nro_pisos, distrito, ubicacion, fecha_inicio_plan, created_at, nombre_proyecto, cliente:id_cliente(nombre)')
			.eq('id_proyecto', centro.id_proyecto)
			.maybeSingle();
		const nombre = data ? generarCodigoProyecto(data as unknown as ProyectoCodigoFields) : centro.nombre;
		return { tipo: 'Proyecto', id: centro.id_proyecto, nombre: nombre || data?.nombre_proyecto || centro.nombre };
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

export interface ProyectoVinculadoConsultoria {
	id_proyecto: number;
	codigo: string;
}

/**
 * Lista de proyectos (su código, ver codigoProyecto.ts) vinculados al centro de costo COMPARTIDO de
 * Consultoría — a diferencia de Obra (un centro por proyecto, resuelto arriba por
 * resolveEntidadVinculada), Consultoría comparte UN único centro entre TODAS sus ventas cerradas (ver
 * getOrCrearCentroCostoCompartido), así que "la entidad vinculada" no es una sola: es una lista — a
 * pedido del usuario, se muestra como un dropdown en CentroCostoDetalleModal.svelte en vez del banner
 * de una sola entidad que usa resolveEntidadVinculada para el resto de los tipos.
 */
export async function getProyectosCentroCostoConsultoria(client: SupabaseClient): Promise<ProyectoVinculadoConsultoria[]> {
	const { data, error } = await client
		.from('proyecto')
		.select('id_proyecto, tip_proyecto, estado_predio, tipo_edifica, distrito, fecha_inicio_plan, created_at, tipo_venta, cliente:id_cliente(nombre)')
		.eq('estado_proyecto', 'venta_cerrada')
		.eq('tipo_venta', 'consultoria')
		.order('fecha_inicio_plan', { ascending: false });

	if (error) {
		console.error('[centroCostos.service] No se pudo cargar los proyectos de Consultoría vinculados:', error);
		return [];
	}

	return (data ?? []).map((p: any) => ({
		id_proyecto: p.id_proyecto,
		codigo: generarCodigoProyecto(p as ProyectoCodigoFields)
	}));
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
	/** Solo aplica junto con vinculado:false (tab "Centros de Costos") — a pedido del usuario, los
	 * centros manuales dados de baja dejan de listarse por defecto; true los trae a ellos en vez de
	 * los activos, para la sección "Eliminados" (solo-admin). Sin efecto en vinculado:true/undefined. */
	soloEliminados?: boolean;
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

	// El embed de "proyecto" trae solo los campos que generarCodigoProyecto (codigoProyecto.ts) necesita
	// para recalcular su código real, más tipo_venta/tipo_obra para la columna "Tipo" — null para filas
	// sin id_proyecto (centros manuales, o vinculadas a cliente/proveedor/empleado).
	let query = client
		.from(TABLE_NAME)
		.select(
			'*, proveedor(vendedor), proyecto:id_proyecto(tipo_venta, tip_proyecto, estado_predio, tipo_edifica, tipo_obra, tipo_tramite, tipo_intervencion, tipo_edificacion_obra, mes_obra, anio_obra, nro_pisos, distrito, ubicacion, fecha_inicio_plan, created_at, cliente:id_cliente(nombre))',
			{ count: 'exact' }
		)
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
		query = params.soloEliminados ? query.eq('estado', 'baja') : query.neq('estado', 'baja');
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
		.insert({ ...buildWritablePayload(payload), codigo, estado: 'activo' })
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

/** Restaura un centro de costo MANUAL (sin vínculo a ninguna entidad) dado de baja vía
 * deleteCentroCosto (que hoy en 'soft' equivale a un "dar de baja") — se usa desde la sección
 * "Eliminados" del propio submódulo, sin contraseña. Los vinculados a una entidad se restauran junto
 * con ella (ver restaurarCentroCostoDeEntidad), no desde acá. */
export async function restaurarCentroCosto(client: SupabaseClient, id: number): Promise<ServiceResult> {
	if (!SOFT_DELETE_COLUMN) return { success: false, message: 'SOFT_DELETE_COLUMN no está configurado.' };
	const { error } = await client.from(TABLE_NAME).update({ [SOFT_DELETE_COLUMN]: SOFT_DELETE_ACTIVE_VALUE }).eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo restaurar el centro de costo: ${error.message}` };
	return { success: true, message: 'Centro de costo restaurado correctamente' };
}

/** Borra PERMANENTEMENTE un centro de costo manual — a diferencia de deleteCentroCosto (que en
 * DELETE_STRATEGY='soft' solo anula), esto siempre hace un DELETE real, sin importar la estrategia
 * configurada. Se usa SIEMPRE detrás de un AdminConfirmModal (contraseña), desde "Eliminados". Reusa
 * el mismo guard de deleteCentroCosto: nunca borra uno vinculado a una entidad (esos se van en
 * cascada junto con su dueño). */
export async function eliminarCentroCostoPermanente(client: SupabaseClient, id: number): Promise<ServiceResult> {
	const { data: existente, error: fetchError } = await client
		.from(TABLE_NAME)
		.select('id_proyecto, id_cliente, id_proveedor, id_empleado')
		.eq(PK_COLUMN, id)
		.maybeSingle();
	if (fetchError) return { success: false, message: `No se pudo verificar el centro de costo: ${fetchError.message}` };

	const entidadVinculada = existente
		? (Object.keys(COLUMNA_POR_TIPO) as EntidadCentroCosto[]).find((tipo) => existente[COLUMNA_POR_TIPO[tipo]])
		: undefined;
	if (entidadVinculada) {
		return {
			success: false,
			message: `Este centro de costo se creó automáticamente para un ${entidadVinculada} y no se puede eliminar directamente.`
		};
	}

	const { error } = await client.from(TABLE_NAME).delete().eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo eliminar el centro de costo: ${error.message}` };
	return { success: true, message: 'Centro de costo eliminado permanentemente' };
}

/** Valor exacto de `proveedor.vendedor` ("Producto y Servicio" en el formulario) que clasifica a ese
 * proveedor como Subcontratista — a pedido explícito del usuario. */
const VENDEDOR_SUBCONTRATISTA = 'SUBCONTRATISTA - OBRA';

/**
 * Mantiene sincronizado `centro_costo.tipo` ('proveedor' | 'subcontratista') con el campo `vendedor`
 * del proveedor — a pedido explícito del usuario: un proveedor cuyo "Producto y Servicio" sea
 * exactamente 'SUBCONTRATISTA - OBRA' debe clasificarse como Subcontratista (ver OPCIONES_CLASE_DESTINO
 * en TransaccionModal.svelte). Se llama al crear Y al editar un proveedor (ProveedorModal.svelte), para
 * que también reaccione si el campo cambia después de creado. Nunca lanza: es secundario al guardado
 * del proveedor, igual que getOrCrearCentroCostoParaEntidad.
 */
export async function sincronizarTipoCentroCostoProveedor(client: SupabaseClient, idProveedor: number, vendedor: string | null): Promise<void> {
	const tipo = vendedor === VENDEDOR_SUBCONTRATISTA ? 'subcontratista' : 'proveedor';
	const { error } = await client.from(TABLE_NAME).update({ tipo }).eq('id_proveedor', idProveedor);
	if (error) console.error('[centroCostos.service] No se pudo sincronizar el tipo del centro de costo del proveedor:', error);
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
	// A pedido explícito del usuario: `nombre` guarda el ID de la entidad relacionada (no un nombre
	// descriptivo) — el parámetro `nombre` recibido ya no se usa para esta columna, se deja sin tocar
	// la firma para no romper a los llamadores existentes (NuevaVentaModal.svelte, ClienteModal.svelte,
	// ProveedorModal.svelte, transacciones.service.ts, user-admin/index.ts).
	const { data: creado, error } = await client
		.from(TABLE_NAME)
		.insert({ codigo, nombre: String(idEntidad), tipo, [columna]: idEntidad, monto_actual: 0, estado: 'activo' })
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
 * Marca como 'baja' el centro de costo vinculado a una entidad (hoy solo se llama para proyecto, ver
 * darDeBajaVenta en aprobaciones.service.ts) — genérico por `tipo` para poder reusarse el día que
 * cliente/proveedor/empleado tengan su propio "dar de baja". Si la entidad no tiene un centro de
 * costo propio (ej. una venta de Consultoría, que comparte uno solo entre varias ventas — ver
 * getOrCrearCentroCostoCompartido — y por lo tanto no tiene `id_proyecto` propio), el UPDATE
 * simplemente no afecta ninguna fila; no es un error.
 */
export async function darDeBajaCentroCostoDeEntidad(
	client: SupabaseClient,
	tipo: EntidadCentroCosto,
	idEntidad: number
): Promise<ServiceResult> {
	const columna = COLUMNA_POR_TIPO[tipo];
	const { error } = await client.from(TABLE_NAME).update({ estado: 'baja' }).eq(columna, idEntidad);
	if (error) return { success: false, message: `No se pudo dar de baja el centro de costo: ${error.message}` };
	return { success: true, message: 'Centro de costo dado de baja correctamente' };
}

/** Contraparte de darDeBajaCentroCostoDeEntidad — usada al RESTAURAR una entidad (cliente/proyecto/
 * proveedor/empleado) desde la sección "Eliminados" de su módulo, para que su centro de costo vuelva
 * a quedar activo junto con ella. Secundario: si falla, se loguea pero no revierte la restauración de
 * la entidad, mismo criterio que darDeBajaCentroCostoDeEntidad. */
export async function restaurarCentroCostoDeEntidad(
	client: SupabaseClient,
	tipo: EntidadCentroCosto,
	idEntidad: number
): Promise<ServiceResult> {
	const columna = COLUMNA_POR_TIPO[tipo];
	const { error } = await client.from(TABLE_NAME).update({ estado: 'activo' }).eq(columna, idEntidad);
	if (error) return { success: false, message: `No se pudo restaurar el centro de costo: ${error.message}` };
	return { success: true, message: 'Centro de costo restaurado correctamente' };
}

/**
 * `codigo` COMPARTIDO por todos los centros de costo de un mismo tipo de venta (hoy solo
 * 'consultoria') — reutiliza el de la fila más antigua de ese `tipo` que ya exista (típicamente la
 * histórica "Consultoría General", `id_proyecto IS NULL`, de antes de que cada venta tuviera su
 * propia fila) o genera uno nuevo si todavía no existe ninguna.
 */
async function getCodigoCentroCostoCompartido(client: SupabaseClient, tipo: string): Promise<string> {
	const { data } = await client
		.from(TABLE_NAME)
		.select('codigo')
		.eq('tipo', tipo)
		.order('id_centro_costo', { ascending: true })
		.limit(1)
		.maybeSingle();
	if (data?.codigo) return data.codigo;
	return generarCodigoCentroCostoManual(client, tipo);
}

/**
 * Centro de costo de un proyecto de Consultoría — mismo criterio que getOrCrearCentroCostoParaEntidad
 * (Obra: una fila POR proyecto, idempotente vía `uq_centro_costo_proyecto`), pero con el `codigo`
 * FIJO y compartido de Consultoría (ver getCodigoCentroCostoCompartido) en vez de uno propio por
 * proyecto — a pedido explícito del usuario: todas las ventas de Consultoría deben quedar
 * registradas bajo el MISMO código de centro de costo, distinguibles entre sí solo por `nombre` (el
 * código autogenerado de cada venta, ver generarCodigoProyecto) y por su propio id_proyecto.
 * Ya NO comparten una única fila entre todas (comportamiento anterior, ver historial de este
 * archivo) — cada venta de Consultoría cerrada tiene su propia fila, igual que Obra.
 * Nunca lanza — mismo criterio que getOrCrearCentroCostoParaEntidad.
 */
export async function getOrCrearCentroCostoCompartido(
	client: SupabaseClient,
	tipo: 'consultoria',
	idProyecto: number,
	nombreProyecto: string
): Promise<number | null> {
	const { data: existente } = await client.from(TABLE_NAME).select('id_centro_costo').eq('id_proyecto', idProyecto).maybeSingle();
	if (existente) return existente.id_centro_costo;

	const codigo = await getCodigoCentroCostoCompartido(client, tipo);
	const { data: creado, error } = await client
		.from(TABLE_NAME)
		.insert({ codigo, nombre: nombreProyecto, tipo, id_proyecto: idProyecto, monto_actual: 0, estado: 'activo' })
		.select('id_centro_costo')
		.single();

	if (error) {
		if (error.code === '23505') {
			// Carrera: otra llamada ya insertó el centro de costo de este proyecto justo antes — se usa ese.
			const { data: reintento } = await client.from(TABLE_NAME).select('id_centro_costo').eq('id_proyecto', idProyecto).maybeSingle();
			if (reintento) return reintento.id_centro_costo;
		}
		console.error(`[centroCostos.service] No se pudo crear el centro de costo de ${tipo} para el proyecto #${idProyecto}:`, error);
		return null;
	}

	return creado?.id_centro_costo ?? null;
}

/**
 * Saldo real (ingresos - egresos) de cada centro de costo en `ids`, calculado a partir de
 * `transaccion`: toda transacción activa que tiene a un centro como DESTINO suma a su saldo, toda la
 * que lo tiene como ORIGEN resta — sin importar su `tipo` (ingreso/egreso/financiamiento/
 * transferencia), que es solo una etiqueta de categorización; lo que determina el sentido del
 * movimiento es el par origen->destino, igual que en cualquier libro contable.
 *
 * A pedido del usuario: "Centro de Costos y Cuentas Internas" (pestaña Centros de Costos) muestra
 * esto en la columna "Monto Actual" en vez de la columna `centro_costo.monto_actual` — esa nunca se
 * mantiene al día (se inserta en 0 para los centros automáticos, ver getOrCrearCentroCostoParaEntidad/
 * getOrCrearCentroCostoCompartido arriba, y ninguna transacción la actualiza después), así que no
 * sirve para mostrar el saldo real de un proyecto. Nunca lanza — mismo criterio que el resto de este
 * archivo: un fallo acá es secundario, se loguea y devuelve 0 para todos.
 */
export async function getSaldosPorCentroCosto(client: SupabaseClient, ids: number[]): Promise<Record<number, number>> {
	const saldos: Record<number, number> = {};
	for (const id of ids) saldos[id] = 0;
	if (ids.length === 0) return saldos;

	const { data, error } = await client
		.from('transaccion')
		.select('id_centro_costo_origen, id_centro_costo_destino, monto_total')
		.eq('estado', 'activo')
		.or(`id_centro_costo_origen.in.(${ids.join(',')}),id_centro_costo_destino.in.(${ids.join(',')})`);

	if (error) {
		console.error('[centroCostos.service] No se pudo calcular el saldo de los centros de costo:', error);
		return saldos;
	}

	const idsSet = new Set(ids);
	for (const row of (data ?? []) as any[]) {
		const monto = Number(row.monto_total) || 0;
		if (idsSet.has(row.id_centro_costo_destino)) saldos[row.id_centro_costo_destino] += monto;
		if (idsSet.has(row.id_centro_costo_origen)) saldos[row.id_centro_costo_origen] -= monto;
	}

	return saldos;
}

/**
 * Saldo PENDIENTE DE COBRO de cada centro de costo de PROYECTO en `ids` — a pedido del usuario: "los
 * montos de adelanto deben ser restados del monto total" de la venta. Distinto de
 * getSaldosPorCentroCosto (esa es la ficha de caja de CUALQUIER centro: ingresos-egresos de todas sus
 * transacciones); esta es específica de venta y solo tiene sentido para centros vinculados a un
 * proyecto (Obra: uno por proyecto) o el compartido de Consultoría (todas sus ventas cerradas). Para
 * cualquier otro centro (bolsa general, cliente, proveedor, empleado, o un centro manual sin ventas
 * cerradas) el resultado es 0 — el llamador debe usar getSaldosPorCentroCosto para esos casos.
 *
 * Fórmula: `monto total de la(s) venta(s) CERRADAS vinculadas al centro` menos `total ya cobrado por
 * adelanto` (transacciones 'ingreso' con destino este centro cuya descripción empieza con "Adelanto
 * inicial", ver cerrarVentaAprobada/crearVentaYSubirDocumentos). Obra: la venta de ese único proyecto.
 * Consultoría: TODAS las ventas de consultoría cerradas (comparten un solo centro, ver
 * getOrCrearCentroCostoCompartido) y TODOS sus adelantos combinados.
 */
export async function getSaldosVentaPorCentroCosto(client: SupabaseClient, ids: number[]): Promise<Record<number, number>> {
	const saldos: Record<number, number> = {};
	for (const id of ids) saldos[id] = 0;
	if (ids.length === 0) return saldos;

	try {
		const { data: centros, error: errorCentros } = await client
			.from(TABLE_NAME)
			.select('id_centro_costo, tipo, id_proyecto')
			.in('id_centro_costo', ids);
		if (errorCentros) throw errorCentros;

		const { data: ventas, error: errorVentas } = await client
			.from('proyecto')
			.select('id_proyecto, precio_venta, tipo_venta')
			.eq('estado_proyecto', 'venta_cerrada');
		if (errorVentas) throw errorVentas;

		const { data: adelantos, error: errorAdelantos } = await client
			.from('transaccion')
			.select('id_centro_costo_destino, monto_total')
			.in('id_centro_costo_destino', ids)
			.eq('tipo', 'ingreso')
			.eq('estado', 'activo')
			.ilike('descripcion', 'Adelanto inicial%');
		if (errorAdelantos) throw errorAdelantos;

		const adelantoPorCentro: Record<number, number> = {};
		for (const t of (adelantos ?? []) as any[]) {
			adelantoPorCentro[t.id_centro_costo_destino] = (adelantoPorCentro[t.id_centro_costo_destino] ?? 0) + (Number(t.monto_total) || 0);
		}

		// Suma de TODAS las ventas de consultoría cerradas — solo para la fila histórica compartida
		// (id_proyecto IS NULL, de antes de que cada venta de Consultoría tuviera su propia fila, ver
		// getOrCrearCentroCostoCompartido). Las filas nuevas, una por proyecto, usan montoPorProyecto
		// como cualquier centro de Obra.
		const montoConsultoria = (ventas ?? [])
			.filter((v: any) => v.tipo_venta === 'consultoria')
			.reduce((sum: number, v: any) => sum + (Number(v.precio_venta) || 0), 0);
		const montoPorProyecto: Record<number, number> = {};
		for (const v of (ventas ?? []) as any[]) {
			montoPorProyecto[v.id_proyecto] = Number(v.precio_venta) || 0;
		}

		for (const centro of (centros ?? []) as any[]) {
			const montoTotal = centro.id_proyecto != null
				? montoPorProyecto[centro.id_proyecto] ?? 0
				: centro.tipo === 'consultoria'
					? montoConsultoria
					: 0;
			saldos[centro.id_centro_costo] = montoTotal - (adelantoPorCentro[centro.id_centro_costo] ?? 0);
		}
	} catch (err) {
		console.error('[centroCostos.service] No se pudo calcular el saldo de venta de los centros de costo:', err);
	}

	return saldos;
}

/**
 * Monto recibido por cada centro de costo de PROYECTO en `ids` — a pedido del usuario: "Monto Actual"
 * debe mostrar "la suma de los montos de todas las transacciones con tipo ingreso a ese centro de
 * costo". El adelanto YA es una transacción tipo='ingreso' con destino ese centro (ver
 * cerrarVentaAprobada), así que no hace falta sumarlo aparte: queda incluido en la suma. A diferencia
 * de getSaldosVentaPorCentroCosto (que resta el adelanto al total de la venta para dar el saldo
 * PENDIENTE) o getSaldosPorCentroCosto (ingresos-egresos de CUALQUIER tipo, con signo). Aplica igual
 * para Obra (un centro por proyecto) y el compartido de Consultoría (recibe de todas sus ventas).
 * Nunca lanza — mismo criterio que el resto de este archivo.
 */
export async function getMontoRecibidoPorCentroCosto(client: SupabaseClient, ids: number[]): Promise<Record<number, number>> {
	const montos: Record<number, number> = {};
	for (const id of ids) montos[id] = 0;
	if (ids.length === 0) return montos;

	const { data, error } = await client
		.from('transaccion')
		.select('id_centro_costo_destino, monto_total')
		.in('id_centro_costo_destino', ids)
		.eq('tipo', 'ingreso')
		.eq('estado', 'activo');

	if (error) {
		console.error('[centroCostos.service] No se pudo calcular el monto recibido de los centros de costo:', error);
		return montos;
	}

	for (const row of (data ?? []) as any[]) {
		montos[row.id_centro_costo_destino] = (montos[row.id_centro_costo_destino] ?? 0) + (Number(row.monto_total) || 0);
	}

	return montos;
}

/** true si el centro está vinculado a una venta (Obra: id_proyecto propio; Consultoría: id_proyecto
 * propio desde que cada venta cerrada tiene su propia fila, o el histórico compartido) — para esos,
 * "Monto Actual" muestra el monto recibido (ver getMontoRecibidoPorCentroCosto) en vez de la ficha de
 * caja genérica (ingresos-egresos, ver getSaldosPorCentroCosto). Compartido entre el listado
 * (centros-de-costos/+page.svelte) y el popup de detalle (CentroCostoDetalleModal.svelte) para que
 * ambos muestren exactamente el mismo número. */
export function esCentroDeVenta(centro: Pick<CentroCosto, 'tipo' | 'id_proyecto'>): boolean {
	return centro.tipo === 'consultoria' || (centro.tipo === 'proyecto' && centro.id_proyecto != null);
}

/**
 * Monto total (precio_venta) de la venta vinculada a un centro de costo — para el campo "Monto
 * Total" del popup de detalle (CentroCostoDetalleModal.svelte). Si el centro tiene id_proyecto propio
 * (Obra, o Consultoría desde que cada venta cerrada tiene su propia fila), es el precio_venta de ESE
 * proyecto. Para el centro histórico compartido de Consultoría (id_proyecto NULL, de antes de esa
 * migración), es la SUMA de precio_venta de TODAS las ventas de consultoría cerradas — mismo criterio
 * que getSaldosVentaPorCentroCosto. null si el centro no está vinculado a ninguna venta (centro
 * manual, cliente, proveedor, empleado). Nunca lanza — mismo criterio que el resto de este archivo.
 */
export async function getMontoTotalProyecto(client: SupabaseClient, centro: Pick<CentroCosto, 'tipo' | 'id_proyecto'>): Promise<number | null> {
	try {
		if (centro.id_proyecto != null) {
			const { data, error } = await client.from('proyecto').select('precio_venta').eq('id_proyecto', centro.id_proyecto).maybeSingle();
			if (error) throw error;
			return data ? Number(data.precio_venta) || 0 : null;
		}
		if (centro.tipo === 'consultoria') {
			const { data, error } = await client.from('proyecto').select('precio_venta').eq('estado_proyecto', 'venta_cerrada').eq('tipo_venta', 'consultoria');
			if (error) throw error;
			return (data ?? []).reduce((sum: number, p: any) => sum + (Number(p.precio_venta) || 0), 0);
		}
		return null;
	} catch (err) {
		console.error('[centroCostos.service] No se pudo calcular el monto total del proyecto:', err);
		return null;
	}
}

/**
 * Recalcula y PERSISTE en `monto_actual` el saldo de venta (ver getSaldosVentaPorCentroCosto) de un
 * único centro de costo — a pedido del usuario: "actualizar saldo en el momento de cerrar la venta".
 * Se recalcula DESDE CERO (no incrementa sobre el valor anterior) para que sea idempotente: cerrar la
 * misma venta más de una vez, o que este paso se reintente tras un fallo parcial, siempre da el mismo
 * resultado correcto. Debe llamarse DESPUÉS de que el UPDATE de `proyecto` (precio_venta,
 * estado_proyecto='venta_cerrada') ya se haya confirmado, para que el monto total que lee incluya la
 * venta que se está cerrando. Nunca lanza — actualizar el saldo es secundario al cierre en sí.
 */
export async function actualizarSaldoCentroCostoProyecto(client: SupabaseClient, idCentro: number): Promise<void> {
	const saldos = await getSaldosVentaPorCentroCosto(client, [idCentro]);
	const { error } = await client.from(TABLE_NAME).update({ monto_actual: saldos[idCentro] ?? 0 }).eq('id_centro_costo', idCentro);
	if (error) {
		console.error(`[centroCostos.service] No se pudo actualizar el saldo del centro de costo #${idCentro}:`, error);
	}
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
