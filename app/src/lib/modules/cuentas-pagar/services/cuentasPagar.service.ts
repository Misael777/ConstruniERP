/**
 * Servicio de acceso a datos para "cuentas_pagar" + su detalle "pagos".
 * Recibe el SupabaseClient como parámetro; se invoca client-side con el cliente anon
 * ($lib/supabaseClient) para funcionar igual en web y en Tauri (Windows/Android) sin
 * servidor embebido. AJUSTAR: la BD no tiene RLS real todavía, ver nota en +page.svelte.
 */

import { recalcularSaldoCuentaBanco } from '$lib/modules/cuentas-bancarias/services/cuentaBanco.service';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FieldOption, ColumnFilters } from '$lib/shared/fieldConfig';
import { validatePayload, buildWritablePayload, translateSupabaseError, translateRpcError, formatCurrency, applyColumnFilters, isColumnFilterActive } from '$lib/shared/fieldConfig';
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
import { construirPayloadTransaccionPorPago, construirInsertDataTransaccion, labelPorCodigoMedioPago, CENTRO_COSTO_EMBEDS_NOMBRE, centroCostoNombreVisible } from '../../transacciones/services/transacciones.service';
import { NOMBRE_PROVEEDOR_PRESTAMOS } from '../../proveedores/services/proveedores.service';
import type { Transaccion } from '../../transacciones/services/transacciones.service';
import type { ProyectoCodigoFields } from '$lib/shared/codigoProyecto';

export interface CuentaPagar {
	id_cuenta_pagar: number;
	id_proveedor: number;
	id_centro_costo: number | null;
	id_presupuesto: number | null;
	id_partida: number | null;
	tipo_documento: number | null;
	num_documento: string | null;
	monto_comprometido: number;
	/** 'PEN' | 'USD' — con USD, monto_comprometido (en soles) = monto_dolares x tipo_cambio. */
	moneda: string;
	monto_dolares: number | null;
	tipo_cambio: number | null;
	monto_pagado: number;
	saldo_pendiente: number;
	fotma_pago: number | null;
	/** 'sin_periodicidad' | 'mensual' | 'quincenal' | 'semanal' — ver cuentas_pagar_frecuencia_pago_migration.sql. */
	frecuencia_pago: string;
	/** Solo aplica si frecuencia_pago != 'sin_periodicidad' — ver cuentas_pagar_fin_periodo_pago_migration.sql. */
	fin_periodo_pago: string | null;
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
	prioridad: string | null;
	usuario_registro: string | null;
	created_at: string;
	/** No-nulo solo en las cuentas que generó solo el cron recurrente (ver
	 * generar_cuentas_pagar_recurrentes en cuentas_pagar_recurrencia_mensual_migration.sql +
	 * cuentas_pagar_recurrencia_todas_frecuencias_migration.sql — corre para mensual/quincenal/semanal,
	 * se detiene solo cuando la siguiente generación pasaría de fin_periodo_pago) — apunta a la cuenta
	 * anterior de la que salió. null = creada a mano, o primera de una cadena recurrente. */
	id_cuenta_pagar_padre: number | null;
	/** Transacción de "Préstamo" (Ingreso) que originó esta cuenta — ver
	 * cuentas_pagar_cobrar_id_transaccion_migration.sql. Solo no-null para préstamos creados desde esa
	 * migración en adelante (ver guardarCuentaPagarConTransaccionPrestamo en
	 * finanzas/cuentas-pagar/+page.svelte); null para cualquier cuenta creada antes, o que no viene de
	 * ese flujo. Permite que TransaccionModal.svelte encuentre esta cuenta al editar esa transacción. */
	id_transaccion: number | null;
	/** `vendedor` = "Producto y Servicio" del proveedor (mismo campo que ya usa getProveedorOptions más
	 * abajo) — solo viene poblado en las consultas que lo piden explícitamente en el embed. `ruc` (8
	 * dígitos ≈ DNI, 11 ≈ RUC — no hay columna DNI separada) solo viene poblado en getResumenPagosDashboard. */
	proveedor?: { razon_social: string; ruc?: string | null; vendedor?: string | null } | null;
	/** Centro de costo vinculado (embed) — para la columna "Centro de Costo" del listado (ver
	 * centroCostoLabel en +page.svelte, mismo criterio que resolveEntidadVinculada en
	 * centroCostos.service.ts: si está vinculado a un proyecto, `nombre` guarda el id_proyecto crudo —
	 * ilegible — así que hay que recalcular el código real vía generarCodigoProyecto(proyecto) en vez de
	 * confiar en `nombre` tal cual). Solo viene poblado en las consultas que lo piden explícitamente en
	 * el embed. null si la cuenta no tiene centro de costo asignado. */
	centro_costo?: { codigo: string; nombre: string; tipo: string; id_proyecto: number | null; proyecto: ProyectoCodigoFields | null } | null;
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
	/** 'pagado' = registrado a mano en "Registrar Pago" (default en BD); 'programado' = cuota futura
	 * autogenerada desde "Número de Cuotas"; 'cancelado' = una 'programado' que el usuario canceló
	 * editando su Estado (ver PagoModal.svelte) — ninguna de las dos últimas cuenta para el saldo. */
	estado_pago: 'programado' | 'pagado' | 'cancelado';
	/** Transacción de respaldo (tipo 'egreso') que prueba este pago — ver createPago y
	 * confirmarPagoPagado. Un pago con estado_pago='pagado' SIEMPRE debe tener esto no-nulo. */
	id_transaccion: number | null;
	/** Solo viene poblado desde getPagos (join embebido) — usado en la UI para deshabilitar
	 * editar/eliminar cuando la transacción vinculada ya fue aprobada por un administrador. */
	transaccion?: { aprobado: boolean; aprobado_por: string | null } | null;
}

export interface ListParams {
	page?: number;
	pageSize?: number;
	search?: string;
	sortBy?: string;
	sortDir?: 'asc' | 'desc';
	/** Filtros por columna estilo Excel (ver fieldConfig.ts) — se combinan con AND entre columnas
	 * distintas y con el `search` de arriba (independientes: search es la caja libre, columnFilters
	 * son los filtros por columna). */
	columnFilters?: ColumnFilters;
	/** A pedido del usuario: las cuentas dadas de baja (columna `activo`, ver
	 * entidades_activo_migration.sql — independiente de `estado`, que ya es workflow
	 * pendiente/vencido/pagado) dejan de listarse por defecto. true trae solo las dadas de baja, para
	 * la sección "Eliminados" (solo-admin). */
	soloEliminados?: boolean;
	/** Filtro de los botones "Consultoria"/"Obra"/"Corporativo"/"Otros" del listado, resuelto client-side
	 * (ver centroCostoTipoMap en +page.svelte) a partir del tipo real del centro de costo elegido.
	 * undefined = sin filtrar. */
	idsCentroCosto?: number[];
	/** Solo junto a idsCentroCosto (boton "Otros"): ademas de esos ids, incluye las cuentas sin centro
	 * de costo asignado (id_centro_costo NULL). */
	incluirSinCentroCosto?: boolean;
}

function aplicarFiltroCentroCosto<T extends { in: (col: string, vals: any[]) => T; is: (col: string, val: null) => T; or: (f: string) => T }>(
	query: T,
	idsCentroCosto: number[] | undefined,
	incluirSinCentroCosto: boolean | undefined
): T {
	if (idsCentroCosto === undefined) return query;
	if (incluirSinCentroCosto) {
		return idsCentroCosto.length > 0 ? query.or(`id_centro_costo.in.(${idsCentroCosto.join(',')}),id_centro_costo.is.null`) : query.is('id_centro_costo', null);
	}
	return query.in('id_centro_costo', idsCentroCosto.length > 0 ? idsCentroCosto : [-1]);
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
	/** Payload sugerido (sin insertar) para prellenar el modal de "Nueva Transacción", cuando una
	 * cuota programada recién pasa a 'pagado' — ver updatePago y transacciones.service.ts. */
	transaccionSugerida?: Record<string, unknown>;
}

const SORTABLE_KEYS = new Set(FIELDS_CONFIG.filter((f) => f.sortable).map((f) => f.key));

const BLOQUEADO_POR_APROBACION =
	'No se puede modificar/eliminar: tiene un comprobante ya aprobado por un administrador. Solo un administrador puede hacerlo.';

/** true si ALGUNO de los pagos de la cuenta tiene una transacción con aprobado=true. */
async function cuentaTieneTransaccionAprobada(client: SupabaseClient, idCuentaPagar: number): Promise<boolean> {
	const { data } = await client
		.from(PAGO_TABLE)
		.select('transaccion:id_transaccion(aprobado)')
		.eq(PARENT_FK_COLUMN, idCuentaPagar);
	return (data ?? []).some((row: any) => row.transaccion?.aprobado === true);
}

/** true si el pago puntual tiene una transacción con aprobado=true. */
async function pagoTieneTransaccionAprobada(client: SupabaseClient, idPago: number): Promise<boolean> {
	const { data } = await client
		.from(PAGO_TABLE)
		.select('transaccion:id_transaccion(aprobado)')
		.eq(PAGO_PK, idPago)
		.maybeSingle();
	return (data as any)?.transaccion?.aprobado === true;
}

/**
 * Regla de negocio de `estado`: pagado si el saldo ya llegó a 0; si no, vencido/pendiente según la
 * fecha de la cuota MÁS CERCANA (fecha_pago_programada, reprogramada a la cuota 'programado' más
 * próxima en cada recalcularCuentaPagar — ver ahí) — solo si la cuenta todavía no tiene ninguna
 * cuota programada (recién creada, sin fraccionar) se usa la fecha de vencimiento contractual como
 * respaldo. Ya no es una marca manual — se recalcula en cada create/update de la cuenta y en cada
 * alta/baja de un pago.
 */
export function computeEstadoCuentaPagar(saldoPendiente: number, fechaVencimiento: string | null, fechaPagoProgramada: string | null): string {
	if (saldoPendiente <= 0) return 'pagado';

	const hoy = new Date();
	hoy.setHours(0, 0, 0, 0);
	const yaVencio = (fecha: string | null) => {
		if (!fecha) return false;
		const d = new Date(fecha);
		return !Number.isNaN(d.getTime()) && d.getTime() < hoy.getTime();
	};

	const fechaAEvaluar = fechaPagoProgramada ?? fechaVencimiento;
	return yaVencio(fechaAEvaluar) ? 'vencido' : 'pendiente';
}

// Embed de centro_costo con los campos que generarCodigoProyecto (codigoProyecto.ts) necesita para
// recalcular el código real cuando está vinculado a un proyecto — mismo criterio y mismos campos que
// el embed equivalente en centroCostos.service.ts (getCentroCostos), para que "Código de proyecto" y
// esta columna "Centro de Costo" siempre muestren lo mismo para el mismo centro.
const CENTRO_COSTO_EMBED =
	'centro_costo:id_centro_costo(codigo, nombre, tipo, id_proyecto, proyecto:id_proyecto(tipo_venta, tip_proyecto, estado_predio, tipo_edifica, tipo_obra, tipo_tramite, tipo_intervencion, tipo_edificacion_obra, mes_obra, anio_obra, nro_pisos, distrito, ubicacion, fecha_inicio_plan, created_at, cliente:id_cliente(nombre)))';

export async function getCuentasPagar(client: SupabaseClient, params: ListParams = {}): Promise<ListResult<CuentaPagar>> {
	const page = Math.max(1, Math.floor(params.page ?? 1));
	const pageSize = Math.max(1, Math.floor(params.pageSize ?? DEFAULT_PAGE_SIZE));
	const sortField = params.sortBy && SORTABLE_KEYS.has(params.sortBy) ? params.sortBy : DEFAULT_SORT_FIELD;
	const sortDir: 'asc' | 'desc' = params.sortDir === 'asc' || params.sortDir === 'desc' ? params.sortDir : DEFAULT_SORT_DIR;

	const from = (page - 1) * pageSize;
	const to = from + pageSize - 1;

	let query = client
		.from(TABLE_NAME)
		.select(`*, proveedor(razon_social, vendedor), ${CENTRO_COSTO_EMBED}`, { count: 'exact' })
		// Ticket #45: ordenar por el texto de `prioridad` da un orden alfabético incorrecto (alto, bajo,
		// media) — igual que cuentas_cobrar (ticket #39), se ordena por la columna calculada prioridad_orden.
		.order(sortField === 'prioridad' ? 'prioridad_orden' : sortField, { ascending: sortDir === 'asc' })
		.range(from, to);

	const search = params.search?.trim();
	if (search) {
		const escaped = search.replace(/[%_]/g, (m) => `\\${m}`);
		const orFilter = SEARCHABLE_COLUMNS.map((col) => `${col}.ilike.%${escaped}%`).join(',');
		query = query.or(orFilter);
	}
	// Una cuenta ya pagada (saldo=0) no es algo pendiente de gestionar — se oculta de la lista por
	// defecto, a pedido del usuario. Solo se muestra si el usuario filtra explícitamente por
	// Estado: Pagado en la barra de filtros (ColumnFilterBar) — ahí sí se respeta su elección.
	if (!isColumnFilterActive(params.columnFilters?.estado)) {
		query = query.neq('estado', 'pagado');
	}
	query = params.soloEliminados ? query.eq('activo', false) : query.eq('activo', true);
	if (params.columnFilters) query = applyColumnFilters(query, FIELDS_CONFIG, params.columnFilters);
	query = aplicarFiltroCentroCosto(query, params.idsCentroCosto, params.incluirSinCentroCosto);

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

/** Primer campo 'currency' visible en tabla — la columna que representa "el monto" de esta lista
 * (para cuentas_pagar: monto_comprometido). Genérico a propósito: evita hardcodear el nombre de
 * columna aquí, se deriva de FIELDS_CONFIG igual que el resto del motor. */
const CAMPO_MONTO = FIELDS_CONFIG.find((f) => f.tipo === 'currency' && f.showInTable)!.key;

/**
 * Suma `monto_comprometido` de TODAS las cuentas ACTIVAS que matchean el buscador + filtros de columna
 * actuales (no solo la página visible) — para el KPI "Total de Filtrado" del listado. Reutiliza
 * exactamente los mismos filtros que arma la tabla (search + columnFilters), así que el número
 * siempre refleja lo que el usuario está viendo filtrado en ese momento. `.eq('activo', true)` (mismo
 * criterio que getResumenPagosDashboard/el equivalente en cuentasCobrar.service.ts): sin este filtro se
 * sumaban también cuentas de compras/ventas ya dadas de baja, que nunca deben contar en un total de
 * cartera vigente.
 */
export async function getMontoFiltrado(
	client: SupabaseClient,
	search: string,
	columnFilters: ColumnFilters,
	idsCentroCosto?: number[],
	incluirSinCentroCosto?: boolean
): Promise<number> {
	let query = client.from(TABLE_NAME).select(CAMPO_MONTO).eq('activo', true);

	const trimmed = search.trim();
	if (trimmed) {
		const escaped = trimmed.replace(/[%_]/g, (m) => `\\${m}`);
		const orFilter = SEARCHABLE_COLUMNS.map((col) => `${col}.ilike.%${escaped}%`).join(',');
		query = query.or(orFilter);
	}
	query = applyColumnFilters(query, FIELDS_CONFIG, columnFilters);
	query = aplicarFiltroCentroCosto(query, idsCentroCosto, incluirSinCentroCosto);

	const { data, error } = await query;
	if (error) throw error;
	return (data ?? []).reduce((sum: number, r: any) => sum + Number(r[CAMPO_MONTO] ?? 0), 0);
}

export interface ResumenPagosDashboardFiltros {
	/** Mismo filtro "Tipo" (Consultoria/Obra/Corporativo/Otros) que el listado principal, resuelto
	 * client-side a ids de centro de costo — ver idsParaTipoFiltro en +page.svelte. */
	idsCentroCosto?: number[];
	incluirSinCentroCosto?: boolean;
	idProveedor?: number;
	/** 'pendiente' | 'pagado' | 'vencido' — "Parcial" es un derivado de fila (ver estadoFilaLabel en
	 * +page.svelte), no un valor real de columna, así que no se filtra por él aquí. */
	estado?: string;
	/** Rango sobre fecha_vencimiento (inclusive). */
	desde?: string;
	hasta?: string;
	search?: string;
}

export interface ResumenPagosDashboard {
	filas: CuentaPagar[];
	totalComprometido: number;
	totalPagado: number;
	totalSaldoPendiente: number;
	totalRetencion: number;
	count: number;
}

/**
 * Panel de pagos de "Movimientos de Caja y Financiamiento" (a diferencia de getCuentasPagar, que
 * excluye estado='pagado' por defecto para la gestión del día a día): acá se necesitan TODAS las
 * cuentas que matcheen los filtros, incluidas las ya pagadas, porque las 4 tarjetas KPI (Total Pagos/
 * Pagado/Pendiente/Retenciones) suman sobre el conjunto completo, no solo lo pendiente de gestionar.
 * Sumas siempre cliente-side (mismo criterio que getMontoFiltrado) — no hay agregación SQL en este
 * sistema. Trae `proveedor(razon_social, ruc, vendedor)` embebido para la columna Proveedor/Consultor.
 */
export async function getResumenPagosDashboard(client: SupabaseClient, filtros: ResumenPagosDashboardFiltros = {}): Promise<ResumenPagosDashboard> {
	let query = client
		.from(TABLE_NAME)
		.select(`*, proveedor(razon_social, ruc, vendedor), ${CENTRO_COSTO_EMBED}`)
		.eq('activo', true)
		.order('fecha_vencimiento', { ascending: false, nullsFirst: false });

	if (filtros.idProveedor) query = query.eq('id_proveedor', filtros.idProveedor);
	if (filtros.estado) query = query.eq('estado', filtros.estado);
	if (filtros.desde) query = query.gte('fecha_vencimiento', filtros.desde);
	if (filtros.hasta) query = query.lte('fecha_vencimiento', filtros.hasta);

	const search = filtros.search?.trim();
	if (search) {
		const escaped = search.replace(/[%_]/g, (m) => `\\${m}`);
		const orFilter = SEARCHABLE_COLUMNS.map((col) => `${col}.ilike.%${escaped}%`).join(',');
		query = query.or(orFilter);
	}
	query = aplicarFiltroCentroCosto(query, filtros.idsCentroCosto, filtros.incluirSinCentroCosto);

	const { data, error } = await query;
	if (error) throw error;
	const filas = (data ?? []) as CuentaPagar[];

	return {
		filas,
		totalComprometido: filas.reduce((sum, f) => sum + Number(f.monto_comprometido ?? 0), 0),
		totalPagado: filas.reduce((sum, f) => sum + Number(f.monto_pagado ?? 0), 0),
		totalSaldoPendiente: filas.reduce((sum, f) => sum + Number(f.saldo_pendiente ?? 0), 0),
		totalRetencion: filas.reduce((sum, f) => sum + Number(f.monto_retencion ?? 0), 0),
		count: filas.length
	};
}

/**
 * "Método de Pago" por cuenta (Efectivo/Transferencia bancaria/Depósito bancario/Yape o Plin) para el
 * panel de pagos — no vive en `cuentas_pagar` (que solo tiene `fotma_pago`, un TÉRMINO de pago —
 * Contado/Crédito —, no un medio), vive en `pagos.medio_pago` (ver pago.config.ts). Se resuelve solo
 * para las cuentas pedidas (la página actual de la tabla, no todo el dashboard) y se queda con el
 * medio_pago de la cuota 'pagado' más reciente de cada cuenta (ORDER BY fecha_pago DESC + primer match
 * gana). Cuenta sin ningún pago 'pagado' todavía simplemente no aparece en el resultado.
 */
export async function getMedioPagoPorCuenta(client: SupabaseClient, idsCuentaPagar: number[]): Promise<Record<number, string>> {
	if (idsCuentaPagar.length === 0) return {};
	const { data, error } = await client
		.from(PAGO_TABLE)
		.select(`${PARENT_FK_COLUMN}, medio_pago, fecha_pago`)
		.in(PARENT_FK_COLUMN, idsCuentaPagar)
		.eq('estado_pago', 'pagado')
		.order('fecha_pago', { ascending: false });
	if (error) throw error;

	const result: Record<number, string> = {};
	for (const row of (data ?? []) as any[]) {
		const id = row[PARENT_FK_COLUMN] as number;
		if (!(id in result) && row.medio_pago) result[id] = row.medio_pago as string;
	}
	return result;
}

/** Conteo global de proveedores activos (`estado != 'baja'`, ver proveedores.service.ts) — tarjeta KPI
 * "Proveedores/Consultores" del panel de pagos, independiente de los filtros de la tabla. */
export async function getProveedoresActivosCount(client: SupabaseClient): Promise<number> {
	const { count, error } = await client.from('proveedor').select('id_proveedor', { count: 'exact', head: true }).neq('estado', 'baja');
	if (error) throw error;
	return count ?? 0;
}

/**
 * "Vencido" depende de la fecha de hoy, no de ningún evento (crear/editar/pagar) — sin un cron en
 * el servidor (esta app es client-side puro), el único momento en que se puede detectar que una
 * cuenta acaba de vencer es cuando se vuelve a listar. Corrige en BD las filas de ESTA página cuyo
 * estado y/o fecha_pago_programada ya no coinciden con lo guardado, y devuelve la lista ya corregida.
 * Recalcula fecha_pago_programada contra las cuotas 'programado' reales (no solo confía en la
 * guardada) — necesario para sanar cuentas cuyo último pago se registró ANTES de que
 * recalcularCuentaPagar empezara a reprogramarla (ver ahí): sin esto, una cuenta con su cuota más
 * próxima ya pagada podía quedar marcada "Vencido" para siempre, con fecha_pago_programada pegada a
 * la de esa cuota vieja en vez de avanzar a la cuota real siguiente.
 * AJUSTAR: solo sana lo que se está viendo en pantalla, no la tabla completa — si se necesita un
 * barrido global real, hace falta un cron/trigger en Supabase (Edge Function programada, por ejemplo).
 */
async function autoCorregirVencidos(client: SupabaseClient, items: CuentaPagar[]): Promise<CuentaPagar[]> {
	const candidatos = items.filter((item) => item.estado !== 'pagado'); // pagado no se re-evalúa por fecha
	if (candidatos.length === 0) return items;

	const idsCandidatos = candidatos.map((item) => item.id_cuenta_pagar);
	const { data: pagos } = await client.from(PAGO_TABLE).select(`${PARENT_FK_COLUMN}, estado_pago, fecha_pago`).in(PARENT_FK_COLUMN, idsCandidatos);
	const programadosPorCuenta = new Map<number, string[]>();
	for (const p of (pagos ?? []) as any[]) {
		if (p.estado_pago !== 'programado') continue;
		const lista = programadosPorCuenta.get(p[PARENT_FK_COLUMN]) ?? [];
		lista.push(p.fecha_pago);
		programadosPorCuenta.set(p[PARENT_FK_COLUMN], lista);
	}

	const actualizaciones: { id: number; estado: string; fechaPagoProgramada: string | null }[] = [];
	const resultado = items.map((item) => {
		if (item.estado === 'pagado') return item;
		const fechas = programadosPorCuenta.get(item.id_cuenta_pagar) ?? [];
		const fechaPagoProgramada = fechas.length > 0 ? fechas.reduce((min, f) => (f < min ? f : min)) : null;
		const esperado = computeEstadoCuentaPagar(item.saldo_pendiente, item.fecha_vencimiento, fechaPagoProgramada);
		if (esperado === item.estado && fechaPagoProgramada === item.fecha_pago_programada) return item;
		actualizaciones.push({ id: item.id_cuenta_pagar, estado: esperado, fechaPagoProgramada });
		return { ...item, estado: esperado, fecha_pago_programada: fechaPagoProgramada };
	});

	if (actualizaciones.length > 0) {
		await Promise.all(
			actualizaciones.map((u) =>
				client.from(TABLE_NAME).update({ estado: u.estado, fecha_pago_programada: u.fechaPagoProgramada }).eq(PK_COLUMN, u.id)
			)
		);
	}

	return resultado;
}


/** H4: con moneda='USD' el monto (siempre en soles) es monto_dolares x tipo_cambio. La pantalla lo deja
 * calculado en el formulario antes de guardar, pero cualquier otro llamador (agentes, importaciones) manda
 * solo dólares y tipo de cambio — y monto_imponible/monto_igv (computeValue) se derivan de
 * monto_comprometido, así que hay que resolverlo ANTES de armar el payload a guardar. */
function conMontoEnSoles(payload: Record<string, unknown>): Record<string, unknown> {
	if (String(payload.moneda ?? '') !== 'USD') return payload;
	const dolares = Number(payload.monto_dolares);
	const cambio = Number(payload.tipo_cambio);
	return dolares > 0 && cambio > 0 ? { ...payload, monto_comprometido: Number((dolares * cambio).toFixed(2)) } : payload;
}

/**
 * H1 (ver Documentacion/tests/README.md): la suma de las cuotas programadas debe ser EXACTAMENTE lo que
 * todavía falta por pagar (monto - lo ya pagado) — antes solo lo exigía FraccionamientoModal.svelte, así
 * que cualquier otro camino (importación, otra pantalla, un agente) dejaba calendarios que no cuadran con la
 * cuenta. Un arreglo vacío es válido (cuenta sin cuotas). null = válido.
 */
export function validarSumaFracciones(montoPendiente: number, fracciones: { fecha: string; monto: number }[]): string | null {
	if (fracciones.length === 0) return null;
	for (const f of fracciones) {
		if (!Number.isFinite(Number(f.monto)) || Number(f.monto) <= 0) return 'Cada cuota debe tener un monto mayor a 0.';
		if (!f.fecha || Number.isNaN(new Date(f.fecha).getTime())) return 'Cada cuota debe tener una fecha válida.';
	}
	const suma = Number(fracciones.reduce((s, f) => s + Number(f.monto), 0).toFixed(2));
	const esperado = Number(Number(montoPendiente).toFixed(2));
	if (Math.abs(suma - esperado) >= 0.01) {
		return `Las cuotas suman ${formatCurrency(suma)} pero lo que falta por pagar es ${formatCurrency(esperado)}. Ajusta las cuotas para que cuadren.`;
	}
	return null;
}

export async function createCuentaPagar(
	client: SupabaseClient,
	payload: Record<string, unknown>,
	usuarioRegistro: string | null,
	fraccionesPersonalizadas: { fecha: string; monto: number }[] = []
): Promise<ServiceResult<CuentaPagar>> {
	payload = conMontoEnSoles(payload);
	const errors = validatePayload(FIELDS_CONFIG, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}

	const saldoInicial = Number(buildWritablePayload(FIELDS_CONFIG, payload).monto_comprometido);
	const errorFracciones = validarSumaFracciones(saldoInicial, fraccionesPersonalizadas);
	if (errorFracciones) return { success: false, message: errorFracciones };
	const insertData: Record<string, unknown> = {
		...buildWritablePayload(FIELDS_CONFIG, payload),
		moneda: (payload.moneda as string) || 'PEN',
		monto_pagado: 0,
		saldo_pendiente: saldoInicial,
		estado: computeEstadoCuentaPagar(saldoInicial, (payload.fecha_vencimiento as string) || null, (payload.fecha_pago_programada as string) || null),
		usuario_registro: usuarioRegistro,
		// No es un campo de FIELDS_CONFIG (nunca se edita a mano, ver cuentas_pagar_cobrar_id_transaccion_migration.sql)
		// — solo llega poblado cuando guardarCuentaPagarConTransaccionPrestamo (finanzas/cuentas-pagar/+page.svelte)
		// lo agrega a mano al payload, justo después de crear la transacción del préstamo.
		id_transaccion: payload.id_transaccion != null ? Number(payload.id_transaccion) : null
	};

	const { data, error } = await client.from(TABLE_NAME).insert(insertData).select('*, proveedor(razon_social)').single();
	if (error) return { success: false, message: `No se pudo crear la cuenta por pagar: ${translateSupabaseError(error, FIELDS_CONFIG)}` };

	await sincronizarCuotasProgramadas(client, data.id_cuenta_pagar, fraccionesPersonalizadas);

	return { success: true, message: 'Cuenta por pagar creada correctamente', data: data as CuentaPagar };
}

/** Cuenta por Pagar vinculada a una transacción de "Préstamo" (ver id_transaccion en la interfaz
 * CuentaPagar) — usado por TransaccionModal.svelte al editar esa transacción, para abrir esta cuenta
 * también en edición con los valores actualizados. null si esa transacción no tiene ninguna cuenta
 * vinculada (préstamo creado antes de cuentas_pagar_cobrar_id_transaccion_migration.sql, o no viene
 * de ese flujo). */
export async function getCuentaPagarPorTransaccion(client: SupabaseClient, idTransaccion: number): Promise<CuentaPagar | null> {
	const { data, error } = await client.from(TABLE_NAME).select('*, proveedor(razon_social)').eq('id_transaccion', idTransaccion).maybeSingle();
	if (error) throw error;
	return (data as CuentaPagar) ?? null;
}

type CuentaParaPrestamista = Pick<CuentaPagar, 'id_cuenta_pagar' | 'id_transaccion' | 'observacion'> & {
	proveedor?: { razon_social?: string | null } | null;
};

/** Nombre del PRESTAMISTA de cada Cuenta por Pagar de "Préstamo Recibido" (id_cuenta_pagar -> nombre); las
 * cuentas que no son préstamos no aparecen en el mapa. En la BD esas cuentas guardan el proveedor genérico
 * NOMBRE_PROVEEDOR_PRESTAMOS (id_proveedor es FK a `proveedor`), así que el nombre real se resuelve así:
 *   1. Por la transacción vinculada (id_transaccion): su Centro de Costo Origen es el prestamista (y una
 *      transacción de categoría "Préstamo" también marca la cuenta como préstamo).
 *   2. Cuentas sin ese vínculo: de la Observación "Préstamo recibido de <nombre>" que se escribe al crearla
 *      (ver datosPrestamoDesdeTransaccion en TransaccionModal.svelte).
 * Si es un préstamo pero no hay forma de saber el nombre, el valor es '' (préstamo sin nombre). Trabaja por
 * lotes (una página de la lista = 2 consultas como máximo). `transaccion.id_centro_costo_origen` no tiene FK
 * declarada en la BD, por eso el centro de costo se busca aparte en vez de embeberlo. */
export async function getPrestamistasDeCuentasPagar(client: SupabaseClient, cuentas: CuentaParaPrestamista[]): Promise<Map<number, string>> {
	const resultado = new Map<number, string>();
	const idsTx = [...new Set(cuentas.map((c) => c.id_transaccion).filter((id): id is number => !!id))];

	const txPorId = new Map<number, { categoria: string | null; id_centro_costo_origen: number | null }>();
	if (idsTx.length > 0) {
		const { data } = await client.from('transaccion').select('id_transaccion, categoria, id_centro_costo_origen').in('id_transaccion', idsTx);
		for (const t of (data ?? []) as any[]) txPorId.set(t.id_transaccion, t);
	}

	const esPrestamo = (c: CuentaParaPrestamista) =>
		c.proveedor?.razon_social === NOMBRE_PROVEEDOR_PRESTAMOS || (!!c.id_transaccion && txPorId.get(c.id_transaccion)?.categoria === 'Préstamo');
	const prestamos = cuentas.filter(esPrestamo);

	const idsOrigen = [
		...new Set(prestamos.map((c) => (c.id_transaccion ? txPorId.get(c.id_transaccion)?.id_centro_costo_origen : null)).filter((id): id is number => !!id))
	];
	const nombrePorCentro = new Map<number, string>();
	if (idsOrigen.length > 0) {
		const { data } = await client.from('centro_costo').select(`id_centro_costo, codigo, nombre, ${CENTRO_COSTO_EMBEDS_NOMBRE}`).in('id_centro_costo', idsOrigen);
		for (const cc of (data ?? []) as any[]) nombrePorCentro.set(cc.id_centro_costo, centroCostoNombreVisible(cc));
	}

	for (const c of prestamos) {
		const idOrigen = c.id_transaccion ? txPorId.get(c.id_transaccion)?.id_centro_costo_origen : null;
		const porTransaccion = idOrigen ? nombrePorCentro.get(idOrigen) : undefined;
		const porObservacion = /^Préstamo recibido de (.+)$/i.exec((c.observacion ?? '').trim())?.[1]?.trim();
		resultado.set(c.id_cuenta_pagar, porTransaccion || porObservacion || '');
	}
	return resultado;
}

/** Versión de una sola cuenta de getPrestamistasDeCuentasPagar: el nombre del prestamista, '' si es un
 * préstamo sin nombre conocido, o null si la cuenta no es un préstamo. */
export async function getPrestamistaDeCuentaPagar(client: SupabaseClient, cuenta: CuentaParaPrestamista): Promise<string | null> {
	const mapa = await getPrestamistasDeCuentasPagar(client, [cuenta]);
	return mapa.has(cuenta.id_cuenta_pagar) ? mapa.get(cuenta.id_cuenta_pagar)! : null;
}

/** Tope de seguridad ante un rango mal puesto (ej. Fin de Periodo de Pago varios años después de Fecha
 * Emisión con frecuencia Semanal) — evita generar miles de filas por un error de tipeo. Ver
 * PREVIEW_TRUNCADO en calcularFechasRecurrentes. */
const MAX_CUENTAS_RECURRENTES = 500;

/** 'YYYY-MM-DD' + n meses, con el mismo ajuste que usa Postgres (`fecha + interval 'n months'`): si el
 * día no existe en el mes destino, se recorta al último día de ese mes (ej. 31-ene + 1 mes -> 28/29-feb)
 * — y el año avanza solo cuando el mes cruza a enero. Sin esto, `Date.setMonth` de JS "desborda" al mes
 * siguiente en vez de recortar (31-ene + 1 mes daría 3-mar, no 28-feb). */
function addMonthsClamped(fechaISO: string, n: number): string {
	const [y, m, d] = fechaISO.split('-').map(Number);
	const totalMeses = m - 1 + n;
	const anioDestino = y + Math.floor(totalMeses / 12);
	const mesDestino = ((totalMeses % 12) + 12) % 12; // 0-indexado
	const ultimoDiaMesDestino = new Date(anioDestino, mesDestino + 1, 0).getDate();
	const diaDestino = Math.min(d, ultimoDiaMesDestino);
	return `${anioDestino}-${String(mesDestino + 1).padStart(2, '0')}-${String(diaDestino).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' + n días (aritmética simple, sin ambigüedad de mes — usado para Semanal/Quincenal). */
function addDias(fechaISO: string, n: number): string {
	const d = new Date(fechaISO + 'T00:00:00');
	d.setDate(d.getDate() + n);
	return d.toISOString().slice(0, 10);
}

export interface FechaCuentaRecurrente {
	numero: number;
	fecha_emision: string;
	fecha_vencimiento: string | null;
	fecha_pago_programada: string | null;
}

/**
 * Calcula las fechas de TODAS las cuentas por pagar que hay que generar para una frecuencia periódica
 * — a pedido EXPLÍCITO del usuario: "frecuencia de pago" indica únicamente cada cuánto se genera una
 * cuenta NUEVA con el MISMO Monto Comprometido, nunca divide el monto entre las cuotas. 'contado' y
 * 'sin_periodicidad' generan una sola cuenta (fila única con las fechas tal cual se ingresaron);
 * 'mensual'/'quincenal'/'semanal' generan una por cada fecha desde `fechaEmisionBase` hasta
 * `finPeriodo` (inclusive), corriendo fecha_vencimiento/fecha_pago_programada por el mismo intervalo
 * para conservar la MISMA distancia a fecha_emision que ya tenía la cuenta original (esa es "la lógica
 * que ya usa el ERP" para la fecha de vencimiento — no hay una fórmula nueva, se preserva el gap
 * original). Usada tanto por la vista previa del formulario (CuentaPagarModal.svelte) como por
 * createCuentasPagarRecurrentes, para que ambas muestren/generen exactamente lo mismo.
 *
 * Sin `finPeriodo` (o frecuencia no periódica), devuelve un array de 1 elemento — el caso normal de
 * "una sola cuenta", para que el llamador no necesite dos caminos distintos.
 */
export function calcularFechasRecurrentes(
	frecuencia: string,
	fechaEmisionBase: string | null | undefined,
	fechaVencimientoBase: string | null | undefined,
	fechaPagoProgramadaBase: string | null | undefined,
	finPeriodo: string | null | undefined
): FechaCuentaRecurrente[] {
	if (!fechaEmisionBase) return [];

	const esPeriodico = frecuencia === 'mensual' || frecuencia === 'quincenal' || frecuencia === 'semanal';
	if (!esPeriodico || !finPeriodo) {
		return [{ numero: 1, fecha_emision: fechaEmisionBase, fecha_vencimiento: fechaVencimientoBase || null, fecha_pago_programada: fechaPagoProgramadaBase || null }];
	}

	const desplazar = (fecha: string, n: number): string =>
		frecuencia === 'mensual' ? addMonthsClamped(fecha, n) : addDias(fecha, n * (frecuencia === 'quincenal' ? 15 : 7));

	const resultado: FechaCuentaRecurrente[] = [];
	for (let n = 0; n < MAX_CUENTAS_RECURRENTES; n++) {
		const emision = desplazar(fechaEmisionBase, n);
		if (emision > finPeriodo) break; // comparación de strings 'YYYY-MM-DD' ordena igual que por fecha
		resultado.push({
			numero: n + 1,
			fecha_emision: emision,
			fecha_vencimiento: fechaVencimientoBase ? desplazar(fechaVencimientoBase, n) : null,
			fecha_pago_programada: fechaPagoProgramadaBase ? desplazar(fechaPagoProgramadaBase, n) : null
		});
	}
	return resultado;
}

/**
 * Genera VARIAS cuentas por pagar de una sola vez, una por cada fecha en `fechas` (ver
 * calcularFechasRecurrentes) — TODAS con el mismo resto de campos que `payload` (mismo Monto
 * Comprometido íntegro en cada una, a pedido explícito del usuario), solo cambian las 3 fechas por
 * fila. Encadena cada cuenta con la anterior de su serie vía `id_cuenta_pagar_padre` (ordenado por
 * id_cuenta_pagar tras el insert — BIGSERIAL asigna en el mismo orden en que se mandaron las filas de
 * un único INSERT; la primera de la serie queda con null) — solo para trazabilidad, nada más depende
 * de esta cadena (a diferencia del cron que se retiró, ver cuentas_pagar_generacion_inmediata_migration.sql).
 * No duplica el fraccionamiento en cuotas (`pagos`) de la cuenta original si estuviera fraccionada —
 * fuera del alcance pedido, se configuraría a mano en cada cuenta generada si hiciera falta.
 */
export async function createCuentasPagarRecurrentes(
	client: SupabaseClient,
	payload: Record<string, unknown>,
	usuarioRegistro: string | null,
	fechas: FechaCuentaRecurrente[]
): Promise<ServiceResult<CuentaPagar[]>> {
	payload = conMontoEnSoles(payload);
	const errors = validatePayload(FIELDS_CONFIG, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}
	if (fechas.length === 0) {
		return { success: false, message: 'No hay ninguna fecha que generar — revisa Fecha Emisión y Fin de Periodo de Pago.' };
	}

	const base = buildWritablePayload(FIELDS_CONFIG, payload);
	const saldoInicial = Number(base.monto_comprometido);

	const filas = fechas.map((f) => ({
		...base,
		moneda: (payload.moneda as string) || 'PEN',
		fecha_emision: f.fecha_emision,
		fecha_vencimiento: f.fecha_vencimiento,
		fecha_pago_programada: f.fecha_pago_programada,
		monto_pagado: 0,
		saldo_pendiente: saldoInicial,
		estado: computeEstadoCuentaPagar(saldoInicial, f.fecha_vencimiento, f.fecha_pago_programada),
		usuario_registro: usuarioRegistro
	}));

	const { data, error } = await client.from(TABLE_NAME).insert(filas).select('*, proveedor(razon_social)');
	if (error) return { success: false, message: `No se pudo generar la serie de cuentas por pagar: ${translateSupabaseError(error, FIELDS_CONFIG)}` };

	const generadas = (data as CuentaPagar[]).slice().sort((a, b) => a.id_cuenta_pagar - b.id_cuenta_pagar);
	if (generadas.length > 1) {
		await Promise.all(
			generadas.slice(1).map((fila, i) => client.from(TABLE_NAME).update({ id_cuenta_pagar_padre: generadas[i].id_cuenta_pagar }).eq(PK_COLUMN, fila.id_cuenta_pagar))
		);
	}

	return { success: true, message: `Se generaron ${generadas.length} cuentas por pagar`, data: generadas };
}

/**
 * Sustituye el calendario de cuotas 'programado' de la cuenta por EXACTAMENTE las fracciones que el
 * usuario configuró en la ventana "Fraccionar este pago" (fecha + monto libres, ver
 * FraccionamientoModal.svelte) — ya no se autogeneran por partes iguales acá: esa validación (que la
 * suma cuadre con monto_comprometido) se hizo del lado del cliente antes de llegar a este punto. Nunca
 * toca las cuotas 'pagado' (esas son reales). Si `fracciones` viene vacío (Forma de Pago = Contado, o
 * el usuario eliminó el fraccionamiento), simplemente deja la cuenta sin cuotas programadas.
 *
 * Exportada (no solo interna a create/updateCuentaPagar) para que el popup de cuotas también se
 * pueda abrir y guardar directo desde /finanzas/cuentas-pagar/panoramas.
 *
 * Devuelve {success,message} en vez de fallar en silencio: create/updateCuentaPagar (donde esto es
 * un efecto SECUNDARIO del guardado principal) siguen ignorando el resultado a propósito para no
 * revertir el guardado de la cuenta por esto — pero el popup de cuotas standalone (donde esto es la
 * ÚNICA acción) SÍ necesita saber si falló para no decirle al usuario "guardado" cuando no se guardó.
 */
/**
 * CxP de planilla (tareo semanal por obra, migración 20261106120000): sus cuotas programadas son los envíos del
 * tareo más la "Proyección de planilla", y su monto lo recalcula la base (fn_planilla_recalcular). El calendario
 * genérico de cuotas no debe borrarlas ni el formulario reescribir el monto. Sin la migración (tabla inexistente)
 * responde false.
 */
export async function esCuentaPlanilla(client: SupabaseClient, idCuentaPagar: number): Promise<boolean> {
	const { data, error } = await client.from('planilla').select('id_planilla').eq('id_cuenta_pagar', idCuentaPagar).limit(1);
	return !error && (data?.length ?? 0) > 0;
}

export async function sincronizarCuotasProgramadas(
	client: SupabaseClient,
	idCuentaPagar: number,
	fracciones: { fecha: string; monto: number }[]
): Promise<{ success: boolean; message: string }> {
	if (await esCuentaPlanilla(client, idCuentaPagar)) {
		return { success: false, message: 'Las cuotas de una planilla se generan desde RRHH → Asistencia → Tareo semanal.' };
	}
	if (fracciones.length > 0) {
		const { data: cuenta } = await client.from(TABLE_NAME).select('monto_comprometido, monto_pagado').eq(PK_COLUMN, idCuentaPagar).single();
		const pendiente = Math.max(Number(cuenta?.monto_comprometido ?? 0) - Number(cuenta?.monto_pagado ?? 0), 0);
		const errorFracciones = validarSumaFracciones(pendiente, fracciones);
		if (errorFracciones) return { success: false, message: errorFracciones };
	}
	const { error: deleteError } = await client.from(PAGO_TABLE).delete().eq(PARENT_FK_COLUMN, idCuentaPagar).eq('estado_pago', 'programado');
	if (deleteError) {
		console.error('No se pudieron limpiar las cuotas programadas anteriores:', deleteError);
		return { success: false, message: `No se pudieron guardar las cuotas: ${deleteError.message}` };
	}
	if (fracciones.length === 0) return { success: true, message: 'Cuotas eliminadas' };

	const filas = fracciones.map((f) => ({ [PARENT_FK_COLUMN]: idCuentaPagar, monto: f.monto, fecha_pago: f.fecha, estado_pago: 'programado' }));
	const { error: insertError } = await client.from(PAGO_TABLE).insert(filas);
	if (insertError) {
		console.error('No se pudieron guardar las cuotas programadas:', insertError);
		return { success: false, message: `No se pudieron guardar las cuotas: ${insertError.message}` };
	}
	return { success: true, message: 'Cuotas guardadas' };
}

export async function updateCuentaPagar(
	client: SupabaseClient,
	id: number,
	payload: Record<string, unknown>,
	esAdmin: boolean = false,
	fraccionesPersonalizadas: { fecha: string; monto: number }[] = []
): Promise<ServiceResult<CuentaPagar>> {
	payload = conMontoEnSoles(payload);
	const errors = validatePayload(FIELDS_CONFIG, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}
	if (!esAdmin && (await cuentaTieneTransaccionAprobada(client, id))) {
		return { success: false, message: BLOQUEADO_POR_APROBACION };
	}

	const updateData = buildWritablePayload(FIELDS_CONFIG, payload);
	const planilla = await esCuentaPlanilla(client, id);
	if (planilla) {
		// Monto y cuotas los maneja el tareo; se pueden editar los demás campos (categoría, observación, etc.).
		delete updateData.monto_comprometido;
		delete updateData.monto_imponible;
		delete updateData.monto_dolares;
	}
	const { data: current } = await client.from(TABLE_NAME).select('monto_pagado, monto_comprometido, condicion_pago').eq(PK_COLUMN, id).single();
	const pagado = Number(current?.monto_pagado ?? 0);
	const comprometido = typeof updateData.monto_comprometido === 'number' ? updateData.monto_comprometido : Number(current?.monto_comprometido ?? 0);
	const saldo = Math.max(comprometido - pagado, 0);
	// Si el calendario que llega es idéntico al ya guardado (el modal lo rehidrata tal cual al editar otros
	// campos), no se revalida: no bloquear la edición de cuentas viejas cuyo calendario ya venía descuadrado.
	const { data: cuotasActuales } = await client.from(PAGO_TABLE).select('fecha_pago, monto').eq(PARENT_FK_COLUMN, id).eq('estado_pago', 'programado');
	const firma = (xs: { fecha: string; monto: number }[]) => JSON.stringify(xs.map((x) => [x.fecha, Number(x.monto)]).sort());
	const sinCambios = firma((cuotasActuales ?? []).map((c: any) => ({ fecha: c.fecha_pago, monto: c.monto }))) === firma(fraccionesPersonalizadas);
	const errorFracciones = sinCambios || planilla ? null : validarSumaFracciones(saldo, fraccionesPersonalizadas);
	if (errorFracciones) return { success: false, message: errorFracciones };
	updateData.saldo_pendiente = saldo;
	updateData.estado = computeEstadoCuentaPagar(saldo, (updateData.fecha_vencimiento as string) || null, (updateData.fecha_pago_programada as string) || null);

	const { data, error } = await client
		.from(TABLE_NAME)
		.update(updateData)
		.eq(PK_COLUMN, id)
		.select('*, proveedor(razon_social)')
		.single();
	if (error) return { success: false, message: `No se pudo actualizar la cuenta por pagar: ${translateSupabaseError(error, FIELDS_CONFIG)}` };

	// El calendario de cuotas se sustituye siempre por lo que traiga `fraccionesPersonalizadas` — el
	// modal hidrata ese arreglo desde las cuotas 'programado' actuales cuando el usuario no tocó nada
	// (ver CuentaPagarModal.svelte), así que esto es efectivamente un no-op si no hubo cambios reales.
	if (!planilla) await sincronizarCuotasProgramadas(client, id, fraccionesPersonalizadas);

	return { success: true, message: 'Cuenta por pagar actualizada correctamente', data: data as CuentaPagar };
}

/**
 * Elimina la cuenta y, en cadena, sus pagos (ON DELETE CASCADE) Y las transacciones de respaldo
 * vinculadas a esos pagos — `transaccion` no tiene FK hacia `pagos`, así que ese borrado en cadena no
 * lo hace la BD sola y hay que hacerlo aquí explícitamente. Bloqueada para no-admins si algún pago
 * tiene una transacción ya aprobada (ver BLOQUEADO_POR_APROBACION).
 */
export async function deleteCuentaPagar(client: SupabaseClient, id: number, esAdmin: boolean = false): Promise<ServiceResult> {
	// A pedido explícito del usuario: una Cuenta por Pagar generada por una transacción de "Préstamo"
	// (id_transaccion, ver cuentas_pagar_cobrar_id_transaccion_migration.sql) NUNCA se puede eliminar,
	// ni siquiera un administrador — a diferencia del caso de abajo (pagos/transacciones vinculadas vía
	// la tabla `pagos`, que sí se borran en cadena), acá la transacción es la fuente real del dinero que
	// entró y borrar la cuenta la dejaría sin ningún registro contable que la respalde.
	const { data: cuentaActual } = await client.from(TABLE_NAME).select('id_transaccion').eq(PK_COLUMN, id).maybeSingle();
	if (cuentaActual?.id_transaccion != null) {
		return { success: false, message: 'No se puede eliminar: esta Cuenta por Pagar está vinculada a una transacción de Préstamo.' };
	}

	if (!esAdmin && (await cuentaTieneTransaccionAprobada(client, id))) {
		return { success: false, message: BLOQUEADO_POR_APROBACION };
	}

	const { data: pagos } = await client.from(PAGO_TABLE).select('id_transaccion').eq(PARENT_FK_COLUMN, id);
	const idsTransaccion = (pagos ?? []).map((p: any) => p.id_transaccion).filter((v: unknown): v is number => v !== null);

	// ON DELETE CASCADE en pagos.id_cuenta_pagar se encarga de borrar sus pagos asociados.
	const { error } = await client.from(TABLE_NAME).delete().eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo eliminar la cuenta por pagar: ${translateSupabaseError(error, FIELDS_CONFIG)}` };

	if (idsTransaccion.length > 0) {
		const { data: txs } = await client.from('transaccion').select('cuente_origen, cuente_destino').in('id_transaccion', idsTransaccion);
		await client.from('transaccion').delete().in('id_transaccion', idsTransaccion);
		// La base ya recalcula el saldo al borrar (trigger de 20261107120000_saldo_bancario_blindado.sql); esto es un
		// respaldo por si el trigger faltara, como pasó en Producción (reclamo del 07/11/2026).
		const cuentas = new Set((txs ?? []).flatMap((t: any) => [t.cuente_origen, t.cuente_destino]).filter(Boolean));
		await Promise.all([...cuentas].map((c) => recalcularSaldoCuentaBanco(client, c as string)));
	}

	return { success: true, message: 'Cuenta por pagar eliminada correctamente' };
}

/** Da de baja una cuenta por pagar (oculta de la lista, reversible, sin contraseña) — a diferencia de
 * deleteCuentaPagar, NO toca sus pagos ni las transacciones ya registradas, solo marca `activo=false`
 * (ver entidades_activo_migration.sql). */
export async function darDeBajaCuentaPagar(client: SupabaseClient, id: number): Promise<ServiceResult> {
	const { error } = await client.from(TABLE_NAME).update({ activo: false }).eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo dar de baja la cuenta por pagar: ${error.message}` };
	return { success: true, message: 'Cuenta por pagar dada de baja correctamente' };
}

/** Restaura una cuenta por pagar dada de baja — se usa desde "Eliminados" (solo-admin), sin
 * contraseña. */
export async function restaurarCuentaPagar(client: SupabaseClient, id: number): Promise<ServiceResult> {
	const { error } = await client.from(TABLE_NAME).update({ activo: true }).eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo restaurar la cuenta por pagar: ${error.message}` };
	return { success: true, message: 'Cuenta por pagar restaurada correctamente' };
}

/** Tickets #21/#23: la lista de cuotas se mostraba de la última a la primera — ascending:true muestra
 * la primera cuota arriba, como pidió el cliente. (CuentaPagarModal.svelte ya re-ordenaba esto mismo por
 * su cuenta al usar este resultado, así que no se ve afectado por este cambio.) */
export async function getPagos(client: SupabaseClient, idCuentaPagar: number): Promise<Pago[]> {
	const { data, error } = await client
		.from(PAGO_TABLE)
		.select('*, transaccion:id_transaccion(aprobado, aprobado_por)')
		.eq(PARENT_FK_COLUMN, idCuentaPagar)
		.order('fecha_pago', { ascending: true });
	if (error) throw error;
	return (data ?? []) as Pago[];
}

/**
 * "Registrar Pago" ya NO confirma solo — funciona exactamente igual que pasar una cuota programada a
 * 'pagado' (ver updatePago): se inserta como 'programado' y se devuelve `transaccionSugerida` para
 * que la UI abra el modal de "Nueva Transacción" de forma obligatoria (ver PagoModal.svelte, que ya
 * reenvía esto sea alta o edición). El pago solo pasa a 'pagado' cuando el usuario confirma esa
 * transacción (confirmarPagoPagado) — si cancela, el pago se queda como 'programado' (visible y
 * editable/eliminable en la lista, no se pierde lo que ya escribió).
 */
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

	const { data: cuenta } = await client
		.from(TABLE_NAME)
.select('id_cuenta_pagar, id_centro_costo, id_proveedor, tipo_documento, num_documento, fotma_pago, monto_comprometido, id_transaccion, proveedor:id_proveedor(razon_social)')
		.eq(PK_COLUMN, idCuentaPagar)
		.single();
	if (!cuenta?.id_centro_costo) {
		return {
			success: false,
			message:
				'No se puede registrar el pago: la cuenta no tiene un Centro de Costo asignado (es necesario para generar la transacción de respaldo). Edita la cuenta y asígnale uno primero.'
		};
	}

	const insertData = {
		...buildWritablePayload(PAGO_FIELDS, payload),
		[PARENT_FK_COLUMN]: idCuentaPagar,
		usuario_registro: usuarioRegistro,
		estado_pago: 'programado' // queda así hasta confirmar la transacción — ver confirmarPagoPagado
	};

	// Un pago suelto (sin cuota programada que reutilizar, ver +page.svelte handleRegistrarPagoClick)
	// no debe dejar la suma de cuotas (pagado + programado) por ENCIMA del Monto Comprometido — a
	// diferencia de editar una cuota existente (ver updatePago/rebalancearUltimaCuota, que ajusta OTRA
	// cuota programada para absorber la diferencia), aquí no hay ninguna cuota que compensar.
	const disponible = await montoDisponible(client, idCuentaPagar);
	const montoNuevo = Number((insertData as Record<string, unknown>).monto);
	if (montoNuevo - disponible > 0.01) {
		return {
			success: false,
			message: `No se puede registrar: el monto (${formatCurrency(montoNuevo)}) supera lo que falta por cubrir de esta cuenta (${formatCurrency(Math.max(disponible, 0))}). Revisa las demás cuotas antes de continuar.`
		};
	}

	const { data, error } = await client.from(PAGO_TABLE).insert(insertData).select('*').single();
	if (error) return { success: false, message: `No se pudo registrar el pago: ${translateSupabaseError(error, PAGO_FIELDS)}` };

	// A diferencia de Crédito (donde fecha_pago_programada ya queda fijada al fraccionar, ANTES de que
	// exista ningún pago real — ver CuentaPagarModal), en Contado esa fecha se deja en blanco hasta
	// que se registra el pago real aquí — sin este recálculo, el Estado/Días de Retraso de la lista
	// principal seguían basados en la fecha de vencimiento contractual en vez de la fecha real recién
	// ingresada, hasta que se confirmaba la transacción de respaldo (ver updatePago, que sí siempre
	// recalcula, incluso sin pasar a 'pagado').
	await recalcularCuentaPagar(client, idCuentaPagar);

	const transaccionSugerida = await construirPayloadTransaccionPorPago(client, { ...cuenta, proveedorNombre: (cuenta as any).proveedor?.razon_social }, {
		id_pago: data.id_pago,
		monto: Number(data.monto),
		fecha_pago: data.fecha_pago,
		medio_pago: data.medio_pago,
		referencia: data.referencia
	});

	return {
		success: true,
		message: 'Pago guardado. Completa la transacción de respaldo para confirmarlo como Pagado.',
		data: data as Pago,
		transaccionSugerida: transaccionSugerida ?? undefined
	};
}

/**
 * Edita una cuota (pensado para las 'programado': ajustar monto/fecha/estado). `estadoPago` es
 * opcional y va aparte de `payload` porque no vive en PAGO_FIELDS (el formulario de "Registrar
 * Pago" no debe mostrarlo — un pago nuevo registrado a mano siempre es 'pagado'). Se usa para que
 * el usuario pueda pasar una cuota a 'pagado' (se pagó antes o después de lo programado) o
 * 'cancelado' (ya no se hará), directo desde el modal de edición.
 */
/**
 * Lápiz de una cuota (ver Documentacion/tests/lapiz-cuotas.md, H8-H10): valida el cambio de monto ANTES de
 * guardarlo. Antes, subir una cuota por encima de lo que falta por pagar dejaba la última cuota en negativo
 * (-7000 en las pruebas), editar la única cuota pendiente descuadraba la cuenta, y se podía cambiar el monto de
 * una cuota ya pagada aunque su transacción de respaldo quedara con otro monto. null = válido.
 */
async function validarEdicionMontoCuota(
	client: SupabaseClient,
	idCuenta: number,
	idCuota: number,
	estadoAnterior: string,
	montoActual: number,
	nuevoMonto: number
): Promise<string | null> {
	if (Math.abs(nuevoMonto - montoActual) < 0.01) return null;
	if (estadoAnterior === 'pagado') {
		return 'No se puede cambiar el monto de una cuota ya pagada: su transacción de respaldo quedaría con otro monto. Corrige la transacción o registra un pago adicional.';
	}
	if (estadoAnterior !== 'programado') return null;

	const { data: cuenta } = await client.from(TABLE_NAME).select('monto_comprometido').eq(PK_COLUMN, idCuenta).single();
	const { data: filas } = await client.from(PAGO_TABLE).select('id_pago, monto, estado_pago, fecha_pago').eq(PARENT_FK_COLUMN, idCuenta);
	const fijos = (filas ?? []).filter((p: any) => p.estado_pago === 'pagado').reduce((s: number, p: any) => s + Number(p.monto), 0);
	const otros = (filas ?? [])
		.filter((p: any) => p.estado_pago === 'programado' && p.id_pago !== idCuota)
		.sort((a: any, b: any) => new Date(a.fecha_pago).getTime() - new Date(b.fecha_pago).getTime());
	const resto = Number(cuenta?.monto_comprometido ?? 0) - fijos;
	const sumaOtros = otros.reduce((s: number, p: any) => s + Number(p.monto), 0);
	const diferencia = Number((resto - (nuevoMonto + sumaOtros)).toFixed(2));

	if (otros.length === 0) {
		if (Math.abs(diferencia) >= 0.01) {
			return `Es la única cuota pendiente: su monto debe ser ${formatCurrency(resto)} (lo que falta por pagar). Para repartir distinto, usa "Configurar Cuotas".`;
		}
		return null;
	}
	const ultima = otros[otros.length - 1];
	const nuevaUltima = Number((Number(ultima.monto) + diferencia).toFixed(2));
	if (nuevaUltima < 0.01) {
		const maximo = Number((resto - sumaOtros + Number(ultima.monto) - 0.01).toFixed(2));
		return `Ese monto es demasiado alto: la última cuota quedaría en ${formatCurrency(nuevaUltima)}. El máximo para esta cuota es ${formatCurrency(Math.max(maximo, 0))}.`;
	}
	return null;
}

export async function updatePago(
	client: SupabaseClient,
	idPago: number,
	payload: Record<string, unknown>,
	estadoPago?: 'programado' | 'pagado' | 'cancelado',
	esAdmin: boolean = false
): Promise<ServiceResult<Pago>> {
	const errors = validatePayload(PAGO_FIELDS, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}
	if (!esAdmin && (await pagoTieneTransaccionAprobada(client, idPago))) {
		return { success: false, message: BLOQUEADO_POR_APROBACION };
	}

	const { data: pagoActual } = await client.from(PAGO_TABLE).select('id_cuenta_pagar, estado_pago, monto').eq(PAGO_PK, idPago).single();
	if (!pagoActual) return { success: false, message: 'Pago no encontrado' };
	const estadoAnterior = pagoActual.estado_pago as 'programado' | 'pagado' | 'cancelado';

	// Al pasar a 'Cancelado' ya NO se reajusta sola la última cuota (a diferencia de un simple cambio
	// de monto): se BLOQUEA la anulación si el resto de los pagos no cuadra con monto_comprometido,
	// para que el usuario ajuste los montos a mano ANTES de anular. Solo aplica a esta transición
	// (no al botón de eliminar/papelera, que es una acción aparte).
	if (estadoPago === 'cancelado' && estadoAnterior !== 'cancelado') {
		const chequeo = await verificarSumaTrasCancelar(client, pagoActual.id_cuenta_pagar, idPago);
		if (!chequeo.cuadra) {
			return {
				success: false,
				message: `No se puede anular: el resto de los pagos sumaría ${formatCurrency(chequeo.sumaResultante)} y el Monto Comprometido es ${formatCurrency(chequeo.montoComprometido)}. Ajusta los montos de las demás cuotas antes de anular esta.`
			};
		}
	}

	// La transición a 'pagado' NUNCA se persiste directamente aquí — exige una transacción de respaldo
	// creada en el mismo paso (ver confirmarPagoPagado, más abajo). El resto de los campos (monto,
	// fecha, etc.) y cualquier otra transición de estado (a 'programado' o 'cancelado') sí se guardan
	// normalmente en este mismo update.
	const pasandoAPagado = estadoPago === 'pagado' && estadoAnterior !== 'pagado';
	const updateData: Record<string, unknown> = buildWritablePayload(PAGO_FIELDS, payload);
	if (!pasandoAPagado && estadoPago !== 'cancelado') {
		const errorMonto = await validarEdicionMontoCuota(client, pagoActual.id_cuenta_pagar, idPago, estadoAnterior, Number(pagoActual.monto), Number(updateData.monto));
		if (errorMonto) return { success: false, message: errorMonto };
	}
	if (estadoPago && !pasandoAPagado) updateData.estado_pago = estadoPago;

	const { data, error } = await client.from(PAGO_TABLE).update(updateData).eq(PAGO_PK, idPago).select('*').single();
	if (error) return { success: false, message: `No se pudo editar el pago: ${translateSupabaseError(error, PAGO_FIELDS)}` };

	// El reajuste automático solo aplica cuando NO se está cancelando (ver verificarSumaTrasCancelar
	// arriba, que ahora bloquea en vez de reajustar para el caso específico de anular una cuota).
	if (estadoPago !== 'cancelado') {
		await rebalancearUltimaCuota(client, data.id_cuenta_pagar, idPago);
	}
	await recalcularCuentaPagar(client, data.id_cuenta_pagar);

	if (!pasandoAPagado) {
		return { success: true, message: 'Pago actualizado correctamente', data: data as Pago };
	}

	// Arma (sin insertar) el payload sugerido de la transacción de respaldo: la UI DEBE abrir el modal
	// de "Nueva Transacción" con esto y el usuario tiene que confirmarlo (ver confirmarPagoPagado) —
	// si cancela ese paso, este pago se queda tal como estaba (todavía NO 'pagado', ver arriba).
	const { data: cuenta } = await client
		.from(TABLE_NAME)
.select('id_cuenta_pagar, id_centro_costo, id_proveedor, tipo_documento, num_documento, fotma_pago, id_transaccion, proveedor:id_proveedor(razon_social)')
		.eq(PK_COLUMN, data.id_cuenta_pagar)
		.single();

	if (!cuenta?.id_centro_costo) {
		return {
			success: true,
			message:
				'Cambios guardados, pero no se pudo pasar a "Pagado": la cuenta no tiene un Centro de Costo asignado (necesario para la transacción de respaldo). Asígnale uno editando la cuenta y vuelve a intentarlo.',
			data: data as Pago
		};
	}

	const transaccionSugerida = await construirPayloadTransaccionPorPago(client, { ...cuenta, proveedorNombre: (cuenta as any).proveedor?.razon_social }, {
		id_pago: data.id_pago,
		monto: Number(data.monto),
		fecha_pago: data.fecha_pago,
		medio_pago: data.medio_pago,
		referencia: data.referencia
	});

	return {
		success: true,
		message: 'Cambios guardados. Completa la transacción de respaldo para confirmar el pago.',
		data: data as Pago,
		transaccionSugerida: transaccionSugerida ?? undefined
	};
}

/**
 * Segundo paso, obligatorio, para pasar una cuota programada a 'pagado': confirma el pago como
 * 'pagado' Y crea su transacción de respaldo (a partir del payload que la UI arma con
 * construirPayloadTransaccionPorPago / lo que el usuario haya ajustado en el modal) en UNA sola
 * llamada atómica a fn_confirmar_pago (ver financial_integrity_rpc_migration.sql) — antes eran dos
 * pasos separados (createTransaccion + UPDATE pagos) sin transacción envolvente: si el segundo paso
 * fallaba, quedaba una transacción "huérfana" ya creada pero sin ningún pago vinculado a ella. Ahora,
 * si cualquier paso falla, TODO se revierte — el pago sigue en su estado anterior, sin transacción
 * fantasma en el ledger.
 */
export async function confirmarPagoPagado(
	client: SupabaseClient,
	idPago: number,
	transaccionPayload: Record<string, unknown>,
	usuarioRegistro: string | null,
	usuarioNombre: string | null = null,
	idempotencyKey: string | null = null
): Promise<ServiceResult<Pago>> {
	const { data: pagoActual } = await client.from(PAGO_TABLE).select('id_cuenta_pagar').eq(PAGO_PK, idPago).single();
	if (!pagoActual) return { success: false, message: 'Pago no encontrado' };

	const built = construirInsertDataTransaccion(transaccionPayload, usuarioRegistro, usuarioNombre);
	if ('errors' in built) return { success: false, message: 'Revisa los campos marcados', errors: built.errors };

	const { data, error } = await client.rpc('fn_confirmar_pago', {
		p_id_cuenta_pagar: pagoActual.id_cuenta_pagar,
		p_transaccion_payload: built.insertData,
		p_id_pago: idPago,
		p_idempotency_key: idempotencyKey
	});
	if (error) return { success: false, message: `No se pudo confirmar el pago: ${translateRpcError(error, PAGO_FIELDS)}` };

	// rebalancearUltimaCuota puede ajustar el monto de OTRA cuota 'programado' (ver esa función) después
	// de que fn_confirmar_pago ya recalculó la cuenta — se recalcula una vez más para que
	// monto_pagado/saldo_pendiente/estado reflejen ese ajuste (mismo orden que la versión anterior).
	await rebalancearUltimaCuota(client, data.id_cuenta_pagar, idPago);
	await recalcularCuentaPagar(client, data.id_cuenta_pagar);

	return { success: true, message: 'Pago confirmado como Pagado', data: data as Pago };
}

export interface CuentaPagarVinculable {
	id_cuenta_pagar: number;
	num_documento: string | null;
	saldo_pendiente: number;
	proveedorNombre: string;
}

/**
 * Busca cuentas por pagar con saldo pendiente para vincular una transacción manual (ver
 * TransaccionModal.svelte, buscador "Vincular con Cuenta por Pagar" del alta libre de Transacciones —
 * reemplaza al viejo campo de texto "Número de Cuota", que no tenía uso real fuera del flujo de
 * confirmar un pago). `idCentroCosto` es obligatorio en la práctica — a pedido del usuario, el
 * buscador solo debe ofrecer cuentas del MISMO centro de costo elegido en la transacción (el origen,
 * que es el que paga), para no poder vincular el gasto de un proyecto contra el presupuesto de otro.
 * Trae todas las cuentas activas con saldo pendiente de ese centro (mismo criterio de volumen que
 * getTransaccionesCalendario: instantáneo al tamaño actual del ERP) y filtra en el cliente por
 * proveedor/N° de documento/id, porque el proveedor vive en una tabla unida y PostgREST no permite un
 * OR de texto libre entre columnas de dos tablas distintas sin un RPC aparte.
 */
export async function buscarCuentasPagarVinculables(
	client: SupabaseClient,
	query: string,
	idCentroCosto: number | null
): Promise<CuentaPagarVinculable[]> {
	if (!idCentroCosto) return [];

	const { data, error } = await client
		.from(TABLE_NAME)
		.select('id_cuenta_pagar, num_documento, saldo_pendiente, proveedor(razon_social)')
		.eq('activo', true)
		.eq('id_centro_costo', idCentroCosto)
		.gt('saldo_pendiente', 0)
		.order('fecha_vencimiento', { ascending: true, nullsFirst: false });
	if (error) throw error;

	const items: CuentaPagarVinculable[] = (data ?? []).map((row: any) => ({
		id_cuenta_pagar: row.id_cuenta_pagar as number,
		num_documento: row.num_documento as string | null,
		saldo_pendiente: Number(row.saldo_pendiente),
		proveedorNombre: row.proveedor?.razon_social ?? `Proveedor #${row.id_cuenta_pagar}`
	}));

	const q = query.trim().toLowerCase();
	if (!q) return items.slice(0, 8);
	return items
		.filter(
			(it) =>
				it.proveedorNombre.toLowerCase().includes(q) ||
				(it.num_documento ?? '').toLowerCase().includes(q) ||
				String(it.id_cuenta_pagar).includes(q)
		)
		.slice(0, 8);
}

/**
 * Crea la transacción Y, en el mismo paso, un pago ya 'pagado' vinculado a ella contra una cuenta por
 * pagar existente — usado desde el buscador "Vincular con Cuenta por Pagar" del alta libre de
 * Transacciones. A diferencia de createPago + confirmarPagoPagado (pensados para cuando el pago se
 * registra ANTES de tener la transacción de respaldo, quedando 'programado' mientras tanto), acá el
 * usuario ya completó todos los datos de la transacción en el mismo formulario, así que el pago se
 * genera directo en 'pagado', sin pasar por ese estado intermedio.
 *
 * Una sola llamada atómica a fn_confirmar_pago (mismo RPC que confirmarPagoPagado, sin `p_id_pago`):
 * el chequeo de monto disponible corre bajo el bloqueo de la cuenta (cierra el TOCTOU que tenía el
 * chequeo `montoDisponible` de antes) y, si el INSERT del pago falla, la transacción recién creada se
 * revierte con él — ya no puede quedar huérfana (antes el propio mensaje de error admitía "la
 * transacción se creó, pero no se pudo registrar el pago... revisa la cuenta manualmente").
 */
export async function registrarPagoDesdeTransaccion(
	client: SupabaseClient,
	idCuentaPagar: number,
	transaccionPayload: Record<string, unknown>,
	usuarioRegistro: string | null,
	usuarioNombre: string | null = null,
	idempotencyKey: string | null = null
): Promise<ServiceResult<Transaccion>> {
	const built = construirInsertDataTransaccion(transaccionPayload, usuarioRegistro, usuarioNombre);
	if ('errors' in built) return { success: false, message: 'Revisa los campos marcados', errors: built.errors };

	const pagoPayload = {
		monto: Number(transaccionPayload.monto_total),
		fecha_pago: transaccionPayload.fecha,
		medio_pago: labelPorCodigoMedioPago(transaccionPayload.medio_pago as string | null),
		referencia: (transaccionPayload.descripcion as string | null) ?? null,
		usuario_registro: usuarioRegistro
	};

	const { data: pago, error } = await client.rpc('fn_confirmar_pago', {
		p_id_cuenta_pagar: idCuentaPagar,
		p_transaccion_payload: built.insertData,
		p_pago_payload: pagoPayload,
		p_idempotency_key: idempotencyKey
	});
	if (error) {
		return { success: false, message: `No se pudo vincular el pago: ${translateRpcError(error, PAGO_FIELDS)}` };
	}

	const { data: transaccion } = await client.from('transaccion').select('*').eq('id_transaccion', (pago as Pago).id_transaccion).single();

	return { success: true, message: 'Transacción creada y vinculada — el pago quedó registrado en la cuenta.', data: transaccion as Transaccion };
}

/**
 * Comprueba si, al anular la cuota `idPagoAAnular`, el resto de los pagos (pagado + programado,
 * excluyendo esa cuota ya que al cancelarse deja de contar) seguiría sumando exactamente
 * monto_comprometido. No modifica nada — solo informa si cuadra o no, para que updatePago decida
 * si bloquea la anulación.
 */
async function verificarSumaTrasCancelar(
	client: SupabaseClient,
	idCuentaPagar: number,
	idPagoAAnular: number
): Promise<{ cuadra: boolean; sumaResultante: number; montoComprometido: number }> {
	const { data: cuenta } = await client.from(TABLE_NAME).select('monto_comprometido').eq(PK_COLUMN, idCuentaPagar).single();
	const montoComprometido = Number(cuenta?.monto_comprometido ?? 0);

	const { data: pagos } = await client
		.from(PAGO_TABLE)
		.select('id_pago, monto, estado_pago')
		.eq(PARENT_FK_COLUMN, idCuentaPagar);

	const sumaResultante = (pagos ?? [])
		.filter((p: any) => p.id_pago !== idPagoAAnular && (p.estado_pago === 'pagado' || p.estado_pago === 'programado'))
		.reduce((sum: number, p: any) => sum + Number(p.monto), 0);

	return {
		cuadra: Number(sumaResultante.toFixed(2)) === Number(montoComprometido.toFixed(2)),
		sumaResultante: Number(sumaResultante.toFixed(2)),
		montoComprometido
	};
}

/**
 * Cuánto le queda "sin comprometer" a una cuenta: Monto Comprometido menos la suma de todas sus
 * cuotas activas (pagado + programado; 'cancelado' no cuenta porque ya no representa una obligación
 * real). Usado por createPago para no dejar que un pago suelto nuevo empuje la suma de cuotas por
 * ENCIMA del monto total de la cuenta — a diferencia de editar una cuota ya existente (ver
 * rebalancearUltimaCuota, más abajo), aquí no hay ninguna otra cuota que pueda absorber el exceso.
 */
async function montoDisponible(client: SupabaseClient, idCuentaPagar: number): Promise<number> {
	const { data: cuenta } = await client.from(TABLE_NAME).select('monto_comprometido').eq(PK_COLUMN, idCuentaPagar).single();
	if (!cuenta) return 0;

	const { data: pagos } = await client.from(PAGO_TABLE).select('monto, estado_pago').eq(PARENT_FK_COLUMN, idCuentaPagar);
	const comprometido = (pagos ?? [])
		.filter((p: any) => p.estado_pago !== 'cancelado')
		.reduce((sum: number, p: any) => sum + Number(p.monto), 0);

	return Number((Number(cuenta.monto_comprometido) - comprometido).toFixed(2));
}

/**
 * El monto total de la cuenta SIEMPRE debe ser igual a la suma de sus cuotas. Si el usuario edita
 * el monto de una cuota a mano, o cancela una (con lo que su monto deja de estar cubierto por el
 * calendario), esta función ajusta la ÚLTIMA cuota 'programado' que quede (excluyendo la que se
 * acaba de editar, para no deshacer justo ese cambio) sumándole/restándole la diferencia — el mismo
 * "colchón de redondeo" que ya se usa al generar el calendario inicial (generarCuotasProgramadas).
 * Si no queda ninguna otra cuota 'programado' para absorber la diferencia, no se toca nada: el
 * descuadre queda visible (la suma ya no cuadrará con monto_comprometido) para que el usuario lo
 * revise a mano, en vez de que el sistema invente un ajuste donde no hay dónde ponerlo.
 */
async function rebalancearUltimaCuota(client: SupabaseClient, idCuentaPagar: number, idPagoEditado: number): Promise<void> {
	const { data: cuenta } = await client.from(TABLE_NAME).select('monto_comprometido').eq(PK_COLUMN, idCuentaPagar).single();
	if (!cuenta) return;

	const { data: pagos } = await client
		.from(PAGO_TABLE)
		.select('id_pago, monto, estado_pago, fecha_pago')
		.eq(PARENT_FK_COLUMN, idCuentaPagar);
	if (!pagos) return;

	const fijos = pagos.filter((p: any) => p.estado_pago === 'pagado').reduce((sum: number, p: any) => sum + Number(p.monto), 0);
	const programado = pagos
		.filter((p: any) => p.estado_pago === 'programado')
		.sort((a: any, b: any) => new Date(a.fecha_pago).getTime() - new Date(b.fecha_pago).getTime());

	const restante = Number(cuenta.monto_comprometido) - fijos;
	const sumaProgramado = programado.reduce((sum: number, p: any) => sum + Number(p.monto), 0);
	const diferencia = Number((restante - sumaProgramado).toFixed(2));
	if (diferencia === 0) return; // ya cuadra, nada que ajustar

	const candidatas = programado.filter((p: any) => p.id_pago !== idPagoEditado);
	if (candidatas.length === 0) return; // no hay otra cuota programada que absorba la diferencia

	const candidata = candidatas[candidatas.length - 1];
	const nuevoMonto = Number((Number(candidata.monto) + diferencia).toFixed(2));
	await client.from(PAGO_TABLE).update({ monto: nuevoMonto }).eq(PAGO_PK, candidata.id_pago);
}

export async function deletePago(client: SupabaseClient, idPago: number, esAdmin: boolean = false): Promise<ServiceResult> {
	const { data: pago, error: fetchError } = await client.from(PAGO_TABLE).select(PARENT_FK_COLUMN).eq(PAGO_PK, idPago).single();
	if (fetchError || !pago) return { success: false, message: 'Pago no encontrado' };

	if (!esAdmin && (await pagoTieneTransaccionAprobada(client, idPago))) {
		return { success: false, message: BLOQUEADO_POR_APROBACION };
	}

	const { error } = await client.from(PAGO_TABLE).delete().eq(PAGO_PK, idPago);
	if (error) return { success: false, message: `No se pudo eliminar el pago: ${translateSupabaseError(error, PAGO_FIELDS)}` };

	await recalcularCuentaPagar(client, (pago as any)[PARENT_FK_COLUMN]);
	return { success: true, message: 'Pago eliminado correctamente' };
}

/**
 * Recalcula monto_pagado/saldo_pendiente sumando SOLO los pagos con estado_pago='pagado' (las
 * cuotas 'programado' generadas por generarCuotasProgramadas NO cuentan hasta que se registren
 * como pagos reales), ajusta estado con computeEstadoCuentaPagar y reprograma fecha_pago_programada
 * a la cuota 'programado' más próxima — mismos criterios de siempre, ver fn_recalcular_cuenta_pagar
 * en financial_integrity_rpc_migration.sql para la fórmula exacta (portada 1:1 desde esta función).
 *
 * Wrapper delgado sobre esa RPC: corre bajo `SELECT ... FOR UPDATE` en una sola transacción de
 * Postgres — antes era un SELECT-calcula-en-JS-UPDATE sin lock, con una condición de carrera
 * confirmada (dos confirmaciones de pago casi simultáneas podían perder una actualización, dejando
 * monto_pagado/saldo_pendiente desactualizados en silencio). Todo caller existente (createPago,
 * updatePago, deletePago) hereda la versión atómica sin cambiar su propio código.
 */
export async function recalcularCuentaPagar(client: SupabaseClient, idCuentaPagar: number): Promise<void> {
	const { error } = await client.rpc('fn_recalcular_cuenta_pagar', { p_id_cuenta_pagar: idCuentaPagar });
	if (error) console.error('[cuentasPagar.service] No se pudo recalcular la cuenta por pagar:', idCuentaPagar, error);
}

/** El dropdown "Proveedor" en Nueva/Editar Cuenta por Pagar muestra la razón social + su producto
 * y servicio (columna real `vendedor`, ver ProveedorModal.svelte) — a pedido del usuario, para poder
 * distinguir proveedores por lo que venden sin abrir el Directorio de Proveedores aparte. */
export async function getProveedorOptions(client: SupabaseClient): Promise<FieldOption[]> {
	const { data, error } = await client.from('proveedor').select('id_proveedor, razon_social, vendedor').order('razon_social');
	if (error) throw error;
	return (data ?? []).map((p: any) => ({
		value: String(p.id_proveedor),
		label: p.vendedor ? `${p.razon_social} - ${p.vendedor}` : p.razon_social
	}));
}
