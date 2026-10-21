/**
 * Servicio de acceso a datos para "cuentas_cobrar" + su detalle "cobros".
 * Recibe el SupabaseClient como parámetro; se invoca client-side con el cliente anon
 * ($lib/supabaseClient) para funcionar igual en web y en Tauri (Windows/Android) sin
 * servidor embebido. AJUSTAR: la BD no tiene RLS real todavía, ver nota en +page.svelte.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FieldOption, ColumnFilters } from '$lib/shared/fieldConfig';
import { validatePayload, buildWritablePayload, translateSupabaseError, translateRpcError, formatCurrency, applyColumnFilters } from '$lib/shared/fieldConfig';
import { TABLE_NAME, PK_COLUMN, SEARCHABLE_COLUMNS, DEFAULT_PAGE_SIZE, DEFAULT_SORT_FIELD, DEFAULT_SORT_DIR, FIELDS_CONFIG } from '../config/cuentaCobrar.config';
import {
	TABLE_NAME as COBRO_TABLE,
	PK_COLUMN as COBRO_PK,
	PARENT_FK_COLUMN,
	FIELDS_CONFIG as COBRO_FIELDS
} from '../config/cobro.config';
import { construirPayloadTransaccionPorCobro, construirInsertDataTransaccion, CENTRO_COSTO_EMBEDS_NOMBRE, centroCostoNombreVisible } from '../../transacciones/services/transacciones.service';
import { NOMBRE_CLIENTE_PRESTAMOS } from '../../clientes/services/clientes.service';
import type { Transaccion } from '../../transacciones/services/transacciones.service';
import { generarCodigoProyecto } from '$lib/shared/codigoProyecto';
import { referenciaArmada } from '$lib/shared/acuerdoDePago';

/** Embed proyecto con los campos que generarCodigoProyecto necesita (mismo criterio que
 * getProyectoOptions más abajo) — a pedido explícito del usuario, para agregar el código del proyecto
 * (junto con el número de cuota) a la descripción de la transacción de respaldo al confirmar un cobro
 * (ver construirPayloadTransaccionPorCobro en transacciones.service.ts). Vía `id_proyecto` de la propia
 * cuenta_cobrar (FK ya probada, ver getCuentasCobrar/createCuentaCobrar más abajo) — no vía centro de
 * costo, para reusar el mismo camino ya usado en el resto de este archivo. */
const PROYECTO_CODIGO_EMBED =
	'proyecto:id_proyecto(tipo_venta, tip_proyecto, estado_predio, tipo_edifica, tipo_obra, tipo_tramite, tipo_intervencion, tipo_edificacion_obra, mes_obra, anio_obra, nro_pisos, distrito, ubicacion, fecha_inicio_plan, created_at, cliente:id_cliente(nombre))';

function codigoProyectoDe(cuenta: any): string | null {
	const proyecto = cuenta?.proyecto;
	return proyecto ? generarCodigoProyecto(proyecto) : null;
}

export interface CuentaCobrar {
	id_cuenta_cobrar: number;
	id_cliente: number;
	id_centro_costo: number | null;
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
	monto_dolares: number | null;
	tipo_cambio: number | null;
	observaciones: string | null;
	prioridad: string | null;
	estado: string;
	usuario_registro: string | null;
	created_at: string;
	/** Transacción de "Préstamo Otorgado" (Egreso) que originó esta cuenta — ver
	 * cuentas_pagar_cobrar_id_transaccion_migration.sql. Solo no-null para préstamos creados desde esa
	 * migración en adelante (ver guardarCuentaCobrarConTransaccionPrestamo en
	 * finanzas/cuentas-cobrar/+page.svelte); null para cualquier cuenta creada antes, o que no viene de
	 * ese flujo. Permite que TransaccionModal.svelte encuentre esta cuenta al editar esa transacción. */
	id_transaccion: number | null;
	cliente?: { nombre: string } | null;
	proyecto?: { nombre_proyecto: string; tipo_venta?: string | null } | null;
	/** Fecha de la cuota pendiente más próxima (calculada al listar, no es columna) — ticket #92. */
	proxima_cuota?: string | null;
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
	/** 'cobrado' = registrado a mano en "Registrar Cobro" (default); 'programado' = cuota futura
	 * autogenerada desde "Número de Cuotas" (condición_pago); 'cancelado' = una 'programado' que el
	 * usuario canceló editando su Estado — ninguna de las dos últimas cuenta para el saldo. */
	estado_cobro: 'programado' | 'cobrado' | 'cancelado';
	/** Transacción de respaldo (tipo 'ingreso') que prueba este cobro — ver createCobro y
	 * confirmarCobroCobrado. Un cobro con estado_cobro='cobrado' SIEMPRE debe tener esto no-nulo. */
	id_transaccion: number | null;
	/** Solo viene poblado desde getCobros (join embebido) — usado en la UI para deshabilitar
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
	/** Filtro de los botones "Consultoria"/"Obra"/"Corporativo"/"Otros" del listado (mismo patrón que
	 * cuentasPagar.service.ts), resuelto client-side a partir del tipo real del centro de costo
	 * elegido. undefined = sin filtrar. */
	idsCentroCosto?: number[];
	/** Solo junto a idsCentroCosto (botón "Otros"): además de esos ids, incluye las cuentas sin centro
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
	 * cuota programada recién pasa a 'cobrado' — ver updateCobro y transacciones.service.ts. */
	transaccionSugerida?: Record<string, unknown>;
}

const SORTABLE_KEYS = new Set(FIELDS_CONFIG.filter((f) => f.sortable).map((f) => f.key));

const BLOQUEADO_POR_APROBACION =
	'No se puede modificar/eliminar: tiene un comprobante ya aprobado por un administrador. Solo un administrador puede hacerlo.';

/** true si ALGUNO de los cobros de la cuenta tiene una transacción con aprobado=true. */
async function cuentaTieneTransaccionAprobada(client: SupabaseClient, idCuentaCobrar: number): Promise<boolean> {
	const { data } = await client
		.from(COBRO_TABLE)
		.select('transaccion:id_transaccion(aprobado)')
		.eq(PARENT_FK_COLUMN, idCuentaCobrar);
	return (data ?? []).some((row: any) => row.transaccion?.aprobado === true);
}

/** true si el cobro puntual tiene una transacción con aprobado=true. */
async function cobroTieneTransaccionAprobada(client: SupabaseClient, idCobro: number): Promise<boolean> {
	const { data } = await client
		.from(COBRO_TABLE)
		.select('transaccion:id_transaccion(aprobado)')
		.eq(COBRO_PK, idCobro)
		.maybeSingle();
	return (data as any)?.transaccion?.aprobado === true;
}

/** Estado de una Cuenta por Cobrar — a pedido explícito del usuario, ya NO es una marca manual libre:
 * 'pagado' si ya se cubrió el saldo completo (se generó la transacción de ingreso y quedó cancelada);
 * si no, 'vencido' cuando la fecha de vencimiento ya pasó sin haberse generado esa transacción; si no,
 * 'pendiente'. `saldoPendiente` debe venir calculado con el mismo criterio que "Saldo Pendiente" en
 * CuentaCobrarModal.svelte (transacciones de ingreso reales del centro de costo, ver
 * calcularMontoCobradoYEstado más abajo), no con `monto_cobrado`/`cobros`. */
export function computeEstadoCuentaCobrar(saldoPendiente: number, fechaVencimiento: string | null, proximaCuota: string | null = null): string {
	if (saldoPendiente <= 0) return 'pagado';
	const hoy = new Date();
	hoy.setHours(0, 0, 0, 0);
	// Ticket #92: también vence si la cuota pendiente más próxima ya pasó (antes solo miraba el vencimiento
	// final de la cuenta, y una cuenta con el "1er abono" atrasado seguía en "Pendiente") — mismo criterio
	// que computeEstadoCuentaPagar (fecha_pago_programada).
	for (const fecha of [proximaCuota, fechaVencimiento]) {
		if (!fecha) continue;
		const d = new Date(fecha);
		if (!Number.isNaN(d.getTime()) && d.getTime() < hoy.getTime()) return 'vencido';
	}
	return 'pendiente';
}

/** Único punto que calcula monto_cobrado/saldo_pendiente/estado de una cuenta a partir de la plata
 * REAL ya recibida (transacción de ingreso activa en el centro de costo vinculado) — usado tanto al
 * crear/editar como al recalcular tras un cobro. Sin centro de costo vinculado no hay forma de saber
 * cuánto se recibió, así que queda en 0 (pendiente/vencido según fecha).
 *
 * `esPrestamo` (true si la cuenta tiene id_transaccion, ver esa columna en la interfaz CuentaCobrar):
 * en el flujo "Préstamo Otorgado", `idCentroCosto` NO es el proyecto vendido — es "Prestamista",
 * NUESTRO propio centro que financia el préstamo (ver CuentaCobrarModal.svelte) — ese centro puede
 * tener montones de ingresos reales sin ninguna relación con ESTE préstamo puntual. Sumarlos acá daba
 * saldo_pendiente=0 (estado "Pagado" guardado de verdad en BD) para un préstamo que todavía no cobró
 * nada — mismo bug ya corregido del lado cliente en CuentaCobrarModal.svelte (saldoPendienteReal, solo
 * una vista previa), pero que seguía escribiéndose mal al guardar porque este cálculo del servidor es
 * el que de verdad se persiste. Con esPrestamo=true, monto_cobrado queda en 0 (Pendiente) hasta que se
 * registren cobros reales sobre ESTA cuenta puntual (ver getCobros/sincronizarCuotasProgramadas). */
async function calcularMontoCobradoYEstado(
	client: SupabaseClient,
	idCuentaCobrar: number | null,
	monto: number,
	fechaVencimiento: string | null
): Promise<{ montoCobrado: number; saldoPendiente: number; estado: string }> {
	// H6 (ver Documentacion/tests/README.md): el cobrado de una cuenta sale de SUS PROPIOS cobros 'cobrado'
	// (igual que Pagar sale de sus pagos), no de todos los ingresos hacia el centro de costo destino. Una
	// cuenta que todavía no existe (alta) no tiene cobros: 0.
	let montoCobrado = 0;
	let proximaCuota: string | null = null;
	if (idCuentaCobrar != null) {
		const { data } = await client.from(COBRO_TABLE).select('monto, estado_cobro, fecha_cobro').eq(PARENT_FK_COLUMN, idCuentaCobrar).in('estado_cobro', ['cobrado', 'programado']);
		montoCobrado = Number((data ?? []).filter((c: any) => c.estado_cobro === 'cobrado').reduce((s: number, c: any) => s + Number(c.monto), 0).toFixed(2));
		// Ticket #92: la cuota pendiente más próxima también cuenta para "Vencido".
		for (const c of (data ?? []) as any[]) {
			if (c.estado_cobro === 'programado' && c.fecha_cobro && (!proximaCuota || c.fecha_cobro < proximaCuota)) proximaCuota = String(c.fecha_cobro).slice(0, 10);
		}
	}
	const saldoPendiente = Math.max(monto - montoCobrado, 0);
	return { montoCobrado, saldoPendiente, estado: computeEstadoCuentaCobrar(saldoPendiente, fechaVencimiento, proximaCuota) };
}

/**
 * "Vencido"/"Pagado" dependen de plata recibida en tiempo real y de la fecha de hoy, no de ningún
 * evento puntual — sin un cron en el servidor (app client-side pura), el único momento en que se puede
 * detectar el cambio es al volver a listar. Corrige en BD las filas de ESTA página cuyo
 * monto_cobrado/saldo_pendiente/estado ya no coinciden con lo recibido de verdad, y devuelve la lista
 * ya corregida. Mismo patrón que autoCorregirVencidos en cuentasPagar.service.ts.
 */
async function autoCorregirEstadosCobrar(client: SupabaseClient, items: CuentaCobrar[]): Promise<CuentaCobrar[]> {
	// H6: el cobrado sale de los cobros 'cobrado' PROPIOS de cada cuenta (ya no de los ingresos al centro de
	// costo), así que aplica igual a todas — incluidas las de "Préstamo Otorgado".
	if (items.length === 0) return items;

	const ids = items.map((item) => item.id_cuenta_cobrar);
	const { data: cobros } = await client.from(COBRO_TABLE).select('id_cuenta_cobrar, monto, estado_cobro, fecha_cobro').in(PARENT_FK_COLUMN, ids).in('estado_cobro', ['cobrado', 'programado']);
	const cobradoMap: Record<number, number> = {};
	const proximaCuotaMap: Record<number, string> = {};
	for (const c of (cobros ?? []) as { id_cuenta_cobrar: number; monto: number; estado_cobro: string; fecha_cobro: string }[]) {
		if (c.estado_cobro === 'cobrado') {
			cobradoMap[c.id_cuenta_cobrar] = Number(((cobradoMap[c.id_cuenta_cobrar] ?? 0) + Number(c.monto)).toFixed(2));
		} else if (c.fecha_cobro && (!proximaCuotaMap[c.id_cuenta_cobrar] || c.fecha_cobro < proximaCuotaMap[c.id_cuenta_cobrar])) {
			proximaCuotaMap[c.id_cuenta_cobrar] = String(c.fecha_cobro).slice(0, 10);
		}
	}

	const actualizaciones: { id: number; estado: string; saldo: number; recibido: number }[] = [];
	const resultado = items.map((item) => {
		const recibido = cobradoMap[item.id_cuenta_cobrar] ?? 0;
		const saldo = Math.max(Number(item.monto) - recibido, 0);
		const proximaCuota = proximaCuotaMap[item.id_cuenta_cobrar] ?? null;
		const estado = computeEstadoCuentaCobrar(saldo, item.fecha_vencimiento, proximaCuota);
		const sinCambios = estado === item.estado && Math.abs(saldo - Number(item.saldo_pendiente)) < 0.01 && Math.abs(recibido - Number(item.monto_cobrado)) < 0.01;
		if (sinCambios) return { ...item, proxima_cuota: proximaCuota };
		actualizaciones.push({ id: item.id_cuenta_cobrar, estado, saldo, recibido });
		return { ...item, estado, saldo_pendiente: saldo, monto_cobrado: recibido, proxima_cuota: proximaCuota };
	});

	if (actualizaciones.length > 0) {
		await Promise.all(
			actualizaciones.map((u) =>
				client.from(TABLE_NAME).update({ estado: u.estado, saldo_pendiente: u.saldo, monto_cobrado: u.recibido }).eq(PK_COLUMN, u.id)
			)
		);
	}
	return resultado;
}

/** Filtro del buscador del listado: además de N° documento/responsable/observaciones, busca por el NOMBRE del
 * proyecto y del cliente (lo que se ve en la columna "Proyecto / Cliente / Prestatario") — a pedido del usuario:
 * buscar "Barranco" no encontraba nada. PostgREST no deja filtrar por una tabla embebida dentro de un .or(), así
 * que primero se buscan los ids de proyectos/clientes que coinciden (mismo patrón que el ticket #49 en
 * centroCostos.service.ts) y se agregan al .or() como columnas normales. */
async function filtroBusqueda(client: SupabaseClient, search: string): Promise<string> {
	const escaped = search.replace(/[%_]/g, (m) => `\\${m}`);
	const patron = `%${escaped}%`;
	const [{ data: proyectos }, { data: clientes }] = await Promise.all([
		client.from('proyecto').select('id_proyecto').ilike('nombre_proyecto', patron).limit(500),
		client.from('cliente').select('id_cliente').ilike('nombre', patron).limit(500)
	]);
	const filtros: string[] = SEARCHABLE_COLUMNS.map((col) => `${col}.ilike.${patron}`);
	const idsProyecto = (proyectos ?? []).map((p: any) => p.id_proyecto);
	const idsCliente = (clientes ?? []).map((c: any) => c.id_cliente);
	if (idsProyecto.length) filtros.push(`id_proyecto.in.(${idsProyecto.join(',')})`);
	if (idsCliente.length) filtros.push(`id_cliente.in.(${idsCliente.join(',')})`);
	return filtros.join(',');
}

export async function getCuentasCobrar(client: SupabaseClient, params: ListParams = {}): Promise<ListResult<CuentaCobrar>> {
	const page = Math.max(1, Math.floor(params.page ?? 1));
	const pageSize = Math.max(1, Math.floor(params.pageSize ?? DEFAULT_PAGE_SIZE));
	const sortField = params.sortBy && SORTABLE_KEYS.has(params.sortBy) ? params.sortBy : DEFAULT_SORT_FIELD;
	const sortDir: 'asc' | 'desc' = params.sortDir === 'asc' || params.sortDir === 'desc' ? params.sortDir : DEFAULT_SORT_DIR;

	const from = (page - 1) * pageSize;
	const to = from + pageSize - 1;

	let query = client
		.from(TABLE_NAME)
		.select('*, cliente(nombre), proyecto(nombre_proyecto, tipo_venta)', { count: 'exact' })
		// Prioridad se ordena por su equivalente numérico (alto=1, medio=2, bajo=3): por el texto saldría alfabético.
		.order(sortField === 'prioridad' ? 'prioridad_orden' : sortField, { ascending: sortDir === 'asc' })
		.order('id_cuenta_cobrar', { ascending: false })
		.range(from, to);

	const search = params.search?.trim();
	if (search) query = query.or(await filtroBusqueda(client, search));
	query = params.soloEliminados ? query.eq('activo', false) : query.eq('activo', true);
	if (params.columnFilters) query = applyColumnFilters(query, FIELDS_CONFIG, params.columnFilters);
	query = aplicarFiltroCentroCosto(query, params.idsCentroCosto, params.incluirSinCentroCosto);

	const { data, error, count } = await query;
	if (error) throw error;

	const items = await autoCorregirEstadosCobrar(client, (data ?? []) as CuentaCobrar[]);

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
 * (para cuentas_cobrar: monto). Genérico a propósito, ver nota equivalente en cuentasPagar.service.ts. */
const CAMPO_MONTO = FIELDS_CONFIG.find((f) => f.tipo === 'currency' && f.showInTable)!.key;

/**
 * Suma `monto` de TODAS las cuentas ACTIVAS que matchean el buscador + filtros de columna actuales (no
 * solo la página visible) — para el KPI "Total de Filtrado" del listado. `.eq('activo', true)` (mismo
 * criterio que getCuentasCobrar/getResumenCobros): sin este filtro se sumaban también cuentas de ventas
 * ya dadas de baja (activo=false, ver darDeBajaVenta en aprobaciones.service.ts), que nunca deben
 * contar en un total de cartera vigente. Ver nota equivalente en cuentasPagar.service.ts
 * (getMontoFiltrado), mismo patrón.
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
	if (trimmed) query = query.or(await filtroBusqueda(client, trimmed));
	query = applyColumnFilters(query, FIELDS_CONFIG, columnFilters);
	query = aplicarFiltroCentroCosto(query, idsCentroCosto, incluirSinCentroCosto);

	const { data, error } = await query;
	if (error) throw error;
	return (data ?? []).reduce((sum: number, r: any) => sum + Number(r[CAMPO_MONTO] ?? 0), 0);
}


/**
 * H1 (ver Documentacion/tests/README.md): la suma de las cuotas programadas debe ser EXACTAMENTE lo que
 * todavía falta por cobrar (monto - lo ya cobrado) — antes solo lo exigía FraccionamientoModal.svelte, así
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
		return `Las cuotas suman ${formatCurrency(suma)} pero lo que falta por cobrar es ${formatCurrency(esperado)}. Ajusta las cuotas para que cuadren.`;
	}
	return null;
}

export async function createCuentaCobrar(
	client: SupabaseClient,
	payload: Record<string, unknown>,
	usuarioRegistro: string | null,
	fraccionesPersonalizadas: { fecha: string; monto: number; referencia?: string | null }[] = []
): Promise<ServiceResult<CuentaCobrar>> {
	const errors = validatePayload(FIELDS_CONFIG, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}

	const saldoInicial = Number(buildWritablePayload(FIELDS_CONFIG, payload).monto);
	const errorFracciones = validarSumaFracciones(saldoInicial, fraccionesPersonalizadas);
	if (errorFracciones) return { success: false, message: errorFracciones };
	const idCentroCosto = payload.id_centro_costo != null && payload.id_centro_costo !== '' ? Number(payload.id_centro_costo) : null;
	const fechaVencimiento = (payload.fecha_vencimiento as string) || null;
	const esPrestamo = payload.id_transaccion != null;
	const { montoCobrado, saldoPendiente, estado } = await calcularMontoCobradoYEstado(client, null, saldoInicial, fechaVencimiento);
	const insertData: Record<string, unknown> = {
		...buildWritablePayload(FIELDS_CONFIG, payload),
		monto_cobrado: montoCobrado,
		saldo_pendiente: saldoPendiente,
		estado,
		usuario_registro: usuarioRegistro,
		// No es un campo de FIELDS_CONFIG (nunca se edita a mano, ver cuentas_pagar_cobrar_id_transaccion_migration.sql)
		// — solo llega poblado cuando guardarCuentaCobrarConTransaccionPrestamo (finanzas/cuentas-cobrar/+page.svelte)
		// lo agrega a mano al payload, justo después de crear la transacción del préstamo.
		id_transaccion: payload.id_transaccion != null ? Number(payload.id_transaccion) : null
	};

	const { data, error } = await client.from(TABLE_NAME).insert(insertData).select('*, cliente(nombre), proyecto(nombre_proyecto, tipo_venta)').single();
	if (error) return { success: false, message: `No se pudo crear la cuenta por cobrar: ${translateSupabaseError(error, FIELDS_CONFIG)}` };

	await sincronizarCuotasProgramadas(client, data.id_cuenta_cobrar, fraccionesPersonalizadas);

	return { success: true, message: 'Cuenta por cobrar creada correctamente', data: data as CuentaCobrar };
}

/** Cuenta por Cobrar vinculada a una transacción de "Préstamo Otorgado" (ver id_transaccion en la
 * interfaz CuentaCobrar) — usado por TransaccionModal.svelte al editar esa transacción, para abrir
 * esta cuenta también en edición con los valores actualizados. null si esa transacción no tiene
 * ninguna cuenta vinculada (préstamo creado antes de cuentas_pagar_cobrar_id_transaccion_migration.sql,
 * o no viene de ese flujo). */
export async function getCuentaCobrarPorTransaccion(client: SupabaseClient, idTransaccion: number): Promise<CuentaCobrar | null> {
	const { data, error } = await client.from(TABLE_NAME).select('*, cliente(nombre), proyecto(nombre_proyecto, tipo_venta)').eq('id_transaccion', idTransaccion).maybeSingle();
	if (error) throw error;
	return (data as CuentaCobrar) ?? null;
}

type CuentaParaPrestatario = Pick<CuentaCobrar, 'id_cuenta_cobrar' | 'id_transaccion' | 'observaciones'> & {
	cliente?: { nombre?: string | null } | null;
};

/** Nombre del PRESTATARIO (a quién se le prestó) de cada Cuenta por Cobrar de "Préstamo Otorgado"
 * (id_cuenta_cobrar -> nombre); las cuentas que no son préstamos no aparecen en el mapa. Espejo de
 * getPrestamistasDeCuentasPagar (cuentasPagar.service.ts): esas cuentas guardan el cliente genérico
 * NOMBRE_CLIENTE_PRESTAMOS (id_cliente es FK a `cliente`), así que el nombre real se resuelve así:
 *   1. Por la transacción de Egreso vinculada (id_transaccion): su Centro de Costo DESTINO es el prestatario
 *      (y una transacción "Préstamo Otorgado"/"Préstamo" también marca la cuenta como préstamo).
 *   2. Cuentas sin ese vínculo: de la Observación "Préstamo otorgado a <nombre>" que se escribe al crearla.
 * Préstamo sin nombre conocido = ''. Por lotes (máx. 2 consultas por página). El centro de costo se busca
 * aparte porque `transaccion.id_centro_costo_destino` no tiene FK declarada en la BD. */
export async function getPrestatariosDeCuentasCobrar(client: SupabaseClient, cuentas: CuentaParaPrestatario[]): Promise<Map<number, string>> {
	const resultado = new Map<number, string>();
	const idsTx = [...new Set(cuentas.map((c) => c.id_transaccion).filter((id): id is number => !!id))];

	const txPorId = new Map<number, { categoria: string | null; id_centro_costo_destino: number | null }>();
	if (idsTx.length > 0) {
		const { data } = await client.from('transaccion').select('id_transaccion, categoria, id_centro_costo_destino').in('id_transaccion', idsTx);
		for (const t of (data ?? []) as any[]) txPorId.set(t.id_transaccion, t);
	}

	const CATEGORIAS_PRESTAMO = new Set(['Préstamo Otorgado', 'Préstamo']);
	const esPrestamo = (c: CuentaParaPrestatario) =>
		c.cliente?.nombre === NOMBRE_CLIENTE_PRESTAMOS || (!!c.id_transaccion && CATEGORIAS_PRESTAMO.has(txPorId.get(c.id_transaccion)?.categoria ?? ''));
	const prestamos = cuentas.filter(esPrestamo);

	const idsDestino = [
		...new Set(prestamos.map((c) => (c.id_transaccion ? txPorId.get(c.id_transaccion)?.id_centro_costo_destino : null)).filter((id): id is number => !!id))
	];
	const nombrePorCentro = new Map<number, string>();
	if (idsDestino.length > 0) {
		const { data } = await client.from('centro_costo').select(`id_centro_costo, codigo, nombre, ${CENTRO_COSTO_EMBEDS_NOMBRE}`).in('id_centro_costo', idsDestino);
		for (const cc of (data ?? []) as any[]) nombrePorCentro.set(cc.id_centro_costo, centroCostoNombreVisible(cc));
	}

	for (const c of prestamos) {
		const idDestino = c.id_transaccion ? txPorId.get(c.id_transaccion)?.id_centro_costo_destino : null;
		const porTransaccion = idDestino ? nombrePorCentro.get(idDestino) : undefined;
		const porObservacion = /^Préstamo otorgado a (.+)$/i.exec((c.observaciones ?? '').trim())?.[1]?.trim();
		resultado.set(c.id_cuenta_cobrar, porTransaccion || porObservacion || '');
	}
	return resultado;
}

/** Versión de una sola cuenta de getPrestatariosDeCuentasCobrar: el nombre del prestatario, '' si es un
 * préstamo sin nombre conocido, o null si la cuenta no es un préstamo. */
export async function getPrestatarioDeCuentaCobrar(client: SupabaseClient, cuenta: CuentaParaPrestatario): Promise<string | null> {
	const mapa = await getPrestatariosDeCuentasCobrar(client, [cuenta]);
	return mapa.has(cuenta.id_cuenta_cobrar) ? mapa.get(cuenta.id_cuenta_cobrar)! : null;
}

/**
 * Sustituye el calendario de cuotas 'programado' de la cuenta por EXACTAMENTE las fracciones que el
 * usuario configuró en la ventana "Fraccionar este pago" (fecha + monto libres, ver
 * FraccionamientoModal.svelte) — ya no se autogeneran por partes iguales acá: esa validación (que la
 * suma cuadre con el monto total) se hizo del lado del cliente antes de llegar a este punto. Nunca
 * toca las cuotas 'cobrado' (esas son reales). Si `fracciones` viene vacío (Forma de Pago = Contado,
 * o el usuario eliminó el fraccionamiento), simplemente deja la cuenta sin cuotas programadas.
 *
 * Exportada (no solo interna a create/updateCuentaCobrar) para que el popup de cuotas también se
 * pueda abrir y guardar directo desde /finanzas/cuentas-cobrar/panoramas (tablero de Panoramas de
 * Cobro), sin pasar por el formulario completo de Editar Cuenta por Cobrar.
 *
 * Devuelve {success,message} en vez de fallar en silencio: create/updateCuentaCobrar (donde esto es
 * un efecto SECUNDARIO del guardado principal) siguen ignorando el resultado a propósito para no
 * revertir el guardado de la cuenta por esto — pero el popup de cuotas standalone (donde esto es la
 * ÚNICA acción) SÍ necesita saber si falló para no decirle al usuario "guardado" cuando no se guardó.
 */
export async function sincronizarCuotasProgramadas(
	client: SupabaseClient,
	idCuentaCobrar: number,
	fracciones: { fecha: string; monto: number; referencia?: string | null }[]
): Promise<{ success: boolean; message: string }> {
	if (fracciones.length > 0) {
		const { data: cuenta } = await client.from(TABLE_NAME).select('monto, monto_cobrado').eq(PK_COLUMN, idCuentaCobrar).single();
		const pendiente = Math.max(Number(cuenta?.monto ?? 0) - Number(cuenta?.monto_cobrado ?? 0), 0);
		const errorFracciones = validarSumaFracciones(pendiente, fracciones);
		if (errorFracciones) return { success: false, message: errorFracciones };
	}
	const { error: deleteError } = await client.from(COBRO_TABLE).delete().eq(PARENT_FK_COLUMN, idCuentaCobrar).eq('estado_cobro', 'programado');
	if (deleteError) {
		console.error('No se pudieron limpiar las cuotas programadas anteriores (¿falta la migración de cobros.estado_cobro?):', deleteError);
		return { success: false, message: `No se pudieron guardar las cuotas: ${deleteError.message}` };
	}
	if (fracciones.length === 0) return { success: true, message: 'Cuotas eliminadas' };

	// `referencia` (opcional): concepto de la cuota — ej. el "Hito de cobro" de la Forma de cobranza de Nueva venta.
	const filas = fracciones.map((f) => ({
		[PARENT_FK_COLUMN]: idCuentaCobrar,
		monto: f.monto,
		fecha_cobro: f.fecha,
		estado_cobro: 'programado',
		...(f.referencia?.trim() ? { referencia: f.referencia.trim().slice(0, 100) } : {})
	}));
	const { error: insertError } = await client.from(COBRO_TABLE).insert(filas);
	if (insertError) {
		console.error('No se pudieron guardar las cuotas programadas (¿falta la migración de cobros.estado_cobro?):', insertError);
		return { success: false, message: `No se pudieron guardar las cuotas: ${insertError.message}` };
	}
	return { success: true, message: 'Cuotas guardadas' };
}

export async function updateCuentaCobrar(
	client: SupabaseClient,
	id: number,
	payload: Record<string, unknown>,
	esAdmin: boolean = false,
	fraccionesPersonalizadas: { fecha: string; monto: number; referencia?: string | null }[] = []
): Promise<ServiceResult<CuentaCobrar>> {
	const errors = validatePayload(FIELDS_CONFIG, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}
	if (!esAdmin && (await cuentaTieneTransaccionAprobada(client, id))) {
		return { success: false, message: BLOQUEADO_POR_APROBACION };
	}

	// monto_cobrado / saldo_pendiente / estado no se tocan por el usuario aquí (showInForm:false los
	// excluye de buildWritablePayload) — se recalculan siempre a partir de la plata real recibida (ver
	// calcularMontoCobradoYEstado), no de lo que traiga el formulario.
	const updateData = buildWritablePayload(FIELDS_CONFIG, payload);
	// select('*') en vez de listar columnas: el parser de tipos de supabase-js no soporta el
	// carácter acentuado de "condición_pago" en un select explícito (falla solo a nivel de tipos).
	const { data: current } = await client.from(TABLE_NAME).select('*').eq(PK_COLUMN, id).single();
	const montoFinal = typeof updateData.monto === 'number' ? updateData.monto : Number(current?.monto ?? 0);
	const idCentroCostoFinal =
		updateData.id_centro_costo != null && updateData.id_centro_costo !== ''
			? Number(updateData.id_centro_costo)
			: ((current?.id_centro_costo ?? null) as number | null);
	const fechaVencimientoFinal = (typeof updateData.fecha_vencimiento === 'string' ? updateData.fecha_vencimiento : current?.fecha_vencimiento) || null;
	// id_transaccion no es editable a mano (no está en FIELDS_CONFIG) — se lee del registro actual, no
	// del formulario, mismo motivo que esPrestamo en createCuentaCobrar.
	const esPrestamo = current?.id_transaccion != null;
	const { montoCobrado, saldoPendiente, estado } = await calcularMontoCobradoYEstado(client, id, montoFinal, fechaVencimientoFinal);
	const { data: cuotasActuales } = await client.from(COBRO_TABLE).select('fecha_cobro, monto').eq(PARENT_FK_COLUMN, id).eq('estado_cobro', 'programado');
	const firma = (xs: { fecha: string; monto: number }[]) => JSON.stringify(xs.map((x) => [x.fecha, Number(x.monto)]).sort());
	const sinCambios = firma((cuotasActuales ?? []).map((c: any) => ({ fecha: c.fecha_cobro, monto: c.monto }))) === firma(fraccionesPersonalizadas);
	const errorFracciones = sinCambios ? null : validarSumaFracciones(saldoPendiente, fraccionesPersonalizadas);
	if (errorFracciones) return { success: false, message: errorFracciones };
	updateData.monto_cobrado = montoCobrado;
	updateData.saldo_pendiente = saldoPendiente;
	updateData.estado = estado;

	const { data, error } = await client
		.from(TABLE_NAME)
		.update(updateData)
		.eq(PK_COLUMN, id)
		.select('*, cliente(nombre), proyecto(nombre_proyecto, tipo_venta)')
		.single();
	if (error) return { success: false, message: `No se pudo actualizar la cuenta por cobrar: ${translateSupabaseError(error, FIELDS_CONFIG)}` };

	// El calendario de cuotas se sustituye siempre por lo que traiga `fraccionesPersonalizadas` — el
	// modal hidrata ese arreglo desde las cuotas 'programado' actuales cuando el usuario no tocó nada
	// (ver CuentaCobrarModal.svelte), así que esto es efectivamente un no-op si no hubo cambios reales.
	await sincronizarCuotasProgramadas(client, id, fraccionesPersonalizadas);

	return { success: true, message: 'Cuenta por cobrar actualizada correctamente', data: data as CuentaCobrar };
}

/**
 * Elimina la cuenta y, en cadena, sus cobros (ON DELETE CASCADE) Y las transacciones de respaldo
 * vinculadas a esos cobros — `transaccion` no tiene FK hacia `cobros`, así que ese borrado en cadena
 * no lo hace la BD sola y hay que hacerlo aquí explícitamente. Bloqueada para no-admins si algún
 * cobro tiene una transacción ya aprobada (ver BLOQUEADO_POR_APROBACION).
 */
export async function deleteCuentaCobrar(client: SupabaseClient, id: number, esAdmin: boolean = false): Promise<ServiceResult> {
	// A pedido explícito del usuario: una Cuenta por Cobrar generada por una transacción de "Préstamo
	// Otorgado" (id_transaccion, ver cuentas_pagar_cobrar_id_transaccion_migration.sql) NUNCA se puede
	// eliminar, ni siquiera un administrador — a diferencia del caso de abajo (cobros/transacciones
	// vinculadas vía la tabla `cobros`, que sí se borran en cadena), acá la transacción es la fuente
	// real del dinero que salió y borrar la cuenta la dejaría sin ningún registro contable que la
	// respalde.
	const { data: cuentaActual } = await client.from(TABLE_NAME).select('id_transaccion').eq(PK_COLUMN, id).maybeSingle();
	if (cuentaActual?.id_transaccion != null) {
		return { success: false, message: 'No se puede eliminar: esta Cuenta por Cobrar está vinculada a una transacción de Préstamo.' };
	}

	if (!esAdmin && (await cuentaTieneTransaccionAprobada(client, id))) {
		return { success: false, message: BLOQUEADO_POR_APROBACION };
	}

	const { data: cobros } = await client.from(COBRO_TABLE).select('id_transaccion').eq(PARENT_FK_COLUMN, id);
	const idsTransaccion = (cobros ?? []).map((c: any) => c.id_transaccion).filter((v: unknown): v is number => v !== null);

	// ON DELETE CASCADE en cobros.id_cuenta_cobrar se encarga de borrar sus cobros asociados.
	const { error } = await client.from(TABLE_NAME).delete().eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo eliminar la cuenta por cobrar: ${translateSupabaseError(error, FIELDS_CONFIG)}` };

	if (idsTransaccion.length > 0) {
		await client.from('transaccion').delete().in('id_transaccion', idsTransaccion);
	}

	return { success: true, message: 'Cuenta por cobrar eliminada correctamente' };
}

/** Da de baja una cuenta por cobrar (oculta de la lista, reversible, sin contraseña) — a diferencia de
 * deleteCuentaCobrar, NO toca sus cobros ni las transacciones ya registradas, solo marca
 * `activo=false` (ver entidades_activo_migration.sql). */
export async function darDeBajaCuentaCobrar(client: SupabaseClient, id: number): Promise<ServiceResult> {
	const { error } = await client.from(TABLE_NAME).update({ activo: false }).eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo dar de baja la cuenta por cobrar: ${error.message}` };
	return { success: true, message: 'Cuenta por cobrar dada de baja correctamente' };
}

/** Restaura una cuenta por cobrar dada de baja — se usa desde "Eliminados" (solo-admin), sin
 * contraseña. */
export async function restaurarCuentaCobrar(client: SupabaseClient, id: number): Promise<ServiceResult> {
	const { error } = await client.from(TABLE_NAME).update({ activo: true }).eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo restaurar la cuenta por cobrar: ${error.message}` };
	return { success: true, message: 'Cuenta por cobrar restaurada correctamente' };
}

export async function getCobros(client: SupabaseClient, idCuentaCobrar: number): Promise<Cobro[]> {
	const { data, error } = await client
		.from(COBRO_TABLE)
		.select('*, transaccion:id_transaccion(aprobado, aprobado_por)')
		.eq(PARENT_FK_COLUMN, idCuentaCobrar)
		.order('fecha_cobro', { ascending: false });
	if (error) throw error;
	return (data ?? []) as Cobro[];
}

/**
 * "Registrar Cobro" ya NO confirma solo — funciona exactamente igual que pasar una cuota programada
 * a 'cobrado' (ver updateCobro): se inserta como 'programado' y se devuelve `transaccionSugerida`
 * para que la UI abra el modal de "Nueva Transacción" de forma obligatoria (ver CobroModal.svelte,
 * que ya reenvía esto sea alta o edición). El cobro solo pasa a 'cobrado' cuando el usuario confirma
 * esa transacción (confirmarCobroCobrado) — si cancela, el cobro se queda como 'programado' (visible
 * y editable/eliminable en la lista, no se pierde lo que ya escribió).
 */
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

	const { data: cuenta } = await client
		.from(TABLE_NAME)
		.select(`id_cuenta_cobrar, id_centro_costo, id_cliente, tipo_documento, num_documento, forma_pago, cliente:id_cliente(nombre), ${PROYECTO_CODIGO_EMBED}`)
		.eq(PK_COLUMN, idCuentaCobrar)
		.single();
	if (!cuenta?.id_centro_costo) {
		return {
			success: false,
			message:
				'No se puede registrar el cobro: la cuenta no tiene un Centro de Costo asignado (es necesario para generar la transacción de respaldo). Edita la cuenta y asígnale uno primero.'
		};
	}

	const insertData = {
		...buildWritablePayload(COBRO_FIELDS, payload),
		[PARENT_FK_COLUMN]: idCuentaCobrar,
		usuario_registro: usuarioRegistro,
		estado_cobro: 'programado' // queda así hasta confirmar la transacción — ver confirmarCobroCobrado
	};

	// Un cobro suelto (sin cuota programada que reutilizar, ver +page.svelte handleRegistrarCobroClick)
	// no debe dejar la suma de cuotas (cobrado + programado) por ENCIMA del Monto de la cuenta — mismo
	// guard que createPago en cuentasPagar.service.ts.
	const disponible = await montoDisponible(client, idCuentaCobrar);
	const montoNuevo = Number((insertData as Record<string, unknown>).monto);
	if (montoNuevo - disponible > 0.01) {
		return {
			success: false,
			message: `No se puede registrar: el monto (${formatCurrency(montoNuevo)}) supera lo que falta por cubrir de esta cuenta (${formatCurrency(Math.max(disponible, 0))}). Revisa las demás cuotas antes de continuar.`
		};
	}

	const { data, error } = await client.from(COBRO_TABLE).insert(insertData).select('*').single();
	if (error) return { success: false, message: `No se pudo registrar el cobro: ${translateSupabaseError(error, COBRO_FIELDS)}` };

	const transaccionSugerida = await construirPayloadTransaccionPorCobro(
		client,
		{ ...cuenta, clienteNombre: (cuenta as any).cliente?.nombre, proyectoCodigo: codigoProyectoDe(cuenta) },
		{
			id_cobro: data.id_cobro,
			monto: Number(data.monto),
			fecha_cobro: data.fecha_cobro,
			medio_cobro: data.medio_cobro,
			cuenta_banco: data.cuenta_banco,
			referencia: data.referencia
		}
	);

	return {
		success: true,
		message: 'Cobro guardado. Completa la transacción de respaldo para confirmarlo como Cobrado.',
		data: data as Cobro,
		transaccionSugerida: transaccionSugerida ?? undefined
	};
}

/**
 * Edita una cuota (pensado para las 'programado': ajustar monto/fecha/estado). `estadoCobro` es
 * opcional y va aparte de `payload` porque no vive en COBRO_FIELDS (el formulario de "Registrar
 * Cobro" no debe mostrarlo — un cobro nuevo registrado a mano siempre es 'cobrado'). Se usa para que
 * el usuario pueda pasar una cuota a 'cobrado' (se cobró antes o después de lo programado) o
 * 'cancelado' (ya no se hará), directo desde el modal de edición. Mismo comportamiento que
 * updatePago en cuentasPagar.service.ts.
 */
/**
 * Lápiz de una cuota (ver Documentacion/tests/lapiz-cuotas.md, H8-H10): valida el cambio de monto ANTES de
 * guardarlo. Antes, subir una cuota por encima de lo que falta por cobrar dejaba la última cuota en negativo
 * (-7000 en las pruebas), editar la única cuota pendiente descuadraba la cuenta, y se podía cambiar el monto de
 * una cuota ya cobrada aunque su transacción de respaldo quedara con otro monto. null = válido.
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
	if (estadoAnterior === 'cobrado') {
		return 'No se puede cambiar el monto de una cuota ya cobrada: su transacción de respaldo quedaría con otro monto. Corrige la transacción o registra un cobro adicional.';
	}
	if (estadoAnterior !== 'programado') return null;

	const { data: cuenta } = await client.from(TABLE_NAME).select('monto').eq(PK_COLUMN, idCuenta).single();
	const { data: filas } = await client.from(COBRO_TABLE).select('id_cobro, monto, estado_cobro, fecha_cobro').eq(PARENT_FK_COLUMN, idCuenta);
	const fijos = (filas ?? []).filter((p: any) => p.estado_cobro === 'cobrado').reduce((s: number, p: any) => s + Number(p.monto), 0);
	const otros = (filas ?? [])
		.filter((p: any) => p.estado_cobro === 'programado' && p.id_cobro !== idCuota)
		.sort((a: any, b: any) => new Date(a.fecha_cobro).getTime() - new Date(b.fecha_cobro).getTime());
	const resto = Number(cuenta?.monto ?? 0) - fijos;
	const sumaOtros = otros.reduce((s: number, p: any) => s + Number(p.monto), 0);
	const diferencia = Number((resto - (nuevoMonto + sumaOtros)).toFixed(2));

	if (otros.length === 0) {
		if (Math.abs(diferencia) >= 0.01) {
			return `Es la única cuota pendiente: su monto debe ser ${formatCurrency(resto)} (lo que falta por cobrar). Para repartir distinto, usa "Configurar Cuotas".`;
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

export async function updateCobro(
	client: SupabaseClient,
	idCobro: number,
	payload: Record<string, unknown>,
	estadoCobro?: 'programado' | 'cobrado' | 'cancelado',
	esAdmin: boolean = false
): Promise<ServiceResult<Cobro>> {
	const errors = validatePayload(COBRO_FIELDS, payload);
	if (Object.keys(errors).length > 0) {
		return { success: false, message: 'Revisa los campos marcados', errors };
	}
	if (!esAdmin && (await cobroTieneTransaccionAprobada(client, idCobro))) {
		return { success: false, message: BLOQUEADO_POR_APROBACION };
	}

	const { data: cobroActual } = await client.from(COBRO_TABLE).select('id_cuenta_cobrar, estado_cobro, monto').eq(COBRO_PK, idCobro).single();
	if (!cobroActual) return { success: false, message: 'Cobro no encontrado' };
	const estadoAnterior = cobroActual.estado_cobro as 'programado' | 'cobrado' | 'cancelado';

	// Al pasar a 'Cancelado' ya NO se reajusta sola la última cuota (a diferencia de un simple cambio
	// de monto): se BLOQUEA la anulación si el resto de los cobros no cuadra con el monto de la cuenta,
	// para que el usuario ajuste los montos a mano ANTES de anular. Solo aplica a esta transición
	// (no al botón de eliminar/papelera, que es una acción aparte).
	if (estadoCobro === 'cancelado' && estadoAnterior !== 'cancelado') {
		const chequeo = await verificarSumaTrasCancelar(client, cobroActual.id_cuenta_cobrar, idCobro);
		if (!chequeo.cuadra) {
			return {
				success: false,
				message: `No se puede anular: el resto de los cobros sumaría ${formatCurrency(chequeo.sumaResultante)} y el Monto es ${formatCurrency(chequeo.monto)}. Ajusta los montos de las demás cuotas antes de anular esta.`
			};
		}
	}

	// La transición a 'cobrado' NUNCA se persiste directamente aquí — exige una transacción de
	// respaldo creada en el mismo paso (ver confirmarCobroCobrado, más abajo). El resto de los campos
	// (monto, fecha, etc.) y cualquier otra transición de estado (a 'programado' o 'cancelado') sí se
	// guardan normalmente en este mismo update.
	const pasandoACobrado = estadoCobro === 'cobrado' && estadoAnterior !== 'cobrado';
	const updateData: Record<string, unknown> = buildWritablePayload(COBRO_FIELDS, payload);
	if (!pasandoACobrado && estadoCobro !== 'cancelado') {
		const errorMonto = await validarEdicionMontoCuota(client, cobroActual.id_cuenta_cobrar, idCobro, estadoAnterior, Number(cobroActual.monto), Number(updateData.monto));
		if (errorMonto) return { success: false, message: errorMonto };
	}
	if (estadoCobro && !pasandoACobrado) updateData.estado_cobro = estadoCobro;

	const { data, error } = await client.from(COBRO_TABLE).update(updateData).eq(COBRO_PK, idCobro).select('*').single();
	if (error) return { success: false, message: `No se pudo editar el cobro: ${translateSupabaseError(error, COBRO_FIELDS)}` };

	// El reajuste automático solo aplica cuando NO se está cancelando (ver verificarSumaTrasCancelar
	// arriba, que ahora bloquea en vez de reajustar para el caso específico de anular una cuota).
	if (estadoCobro !== 'cancelado') {
		await rebalancearUltimaCuota(client, data.id_cuenta_cobrar, idCobro);
	}
	await recalcularCuentaCobrar(client, data.id_cuenta_cobrar);

	if (!pasandoACobrado) {
		return { success: true, message: 'Cobro actualizado correctamente', data: data as Cobro };
	}

	// Arma (sin insertar) el payload sugerido de la transacción de respaldo: la UI DEBE abrir el modal
	// de "Nueva Transacción" con esto y el usuario tiene que confirmarlo (ver confirmarCobroCobrado) —
	// si cancela ese paso, este cobro se queda tal como estaba (todavía NO 'cobrado', ver arriba).
	const { data: cuenta } = await client
		.from(TABLE_NAME)
		.select(`id_cuenta_cobrar, id_centro_costo, id_cliente, tipo_documento, num_documento, forma_pago, cliente:id_cliente(nombre), ${PROYECTO_CODIGO_EMBED}`)
		.eq(PK_COLUMN, data.id_cuenta_cobrar)
		.single();

	if (!cuenta?.id_centro_costo) {
		return {
			success: true,
			message:
				'Cambios guardados, pero no se pudo pasar a "Cobrado": la cuenta no tiene un Centro de Costo asignado (necesario para la transacción de respaldo). Asígnale uno editando la cuenta y vuelve a intentarlo.',
			data: data as Cobro
		};
	}

	const transaccionSugerida = await construirPayloadTransaccionPorCobro(
		client,
		{ ...cuenta, clienteNombre: (cuenta as any).cliente?.nombre, proyectoCodigo: codigoProyectoDe(cuenta) },
		{
			id_cobro: data.id_cobro,
			monto: Number(data.monto),
			fecha_cobro: data.fecha_cobro,
			medio_cobro: data.medio_cobro,
			cuenta_banco: data.cuenta_banco,
			referencia: data.referencia
		}
	);

	return {
		success: true,
		message: 'Cambios guardados. Completa la transacción de respaldo para confirmar el cobro.',
		data: data as Cobro,
		transaccionSugerida: transaccionSugerida ?? undefined
	};
}

/**
 * Segundo paso, obligatorio, para pasar una cuota programada a 'cobrado': confirma el cobro como
 * 'cobrado' Y crea su transacción de respaldo en UNA sola llamada atómica a fn_confirmar_cobro (ver
 * financial_integrity_rpc_migration.sql) — mismo motivo/beneficio que confirmarPagoPagado en
 * cuentasPagar.service.ts (antes eran dos pasos separados sin transacción envolvente, con riesgo de
 * dejar una transacción huérfana si el segundo fallaba).
 */
export async function confirmarCobroCobrado(
	client: SupabaseClient,
	idCobro: number,
	transaccionPayload: Record<string, unknown>,
	usuarioRegistro: string | null,
	usuarioNombre: string | null = null,
	idempotencyKey: string | null = null
): Promise<ServiceResult<Cobro>> {
	const { data: cobroActual } = await client.from(COBRO_TABLE).select('id_cuenta_cobrar').eq(COBRO_PK, idCobro).single();
	if (!cobroActual) return { success: false, message: 'Cobro no encontrado' };

	const built = construirInsertDataTransaccion(transaccionPayload, usuarioRegistro, usuarioNombre);
	if ('errors' in built) return { success: false, message: 'Revisa los campos marcados', errors: built.errors };

	const { data, error } = await client.rpc('fn_confirmar_cobro', {
		p_id_cuenta_cobrar: cobroActual.id_cuenta_cobrar,
		p_transaccion_payload: built.insertData,
		p_id_cobro: idCobro,
		p_idempotency_key: idempotencyKey
	});
	if (error) return { success: false, message: `No se pudo confirmar el cobro: ${translateRpcError(error, COBRO_FIELDS)}` };

	// rebalancearUltimaCuota puede ajustar el monto de OTRA cuota 'programado' después de que
	// fn_confirmar_cobro ya recalculó la cuenta — se recalcula una vez más (mismo orden que antes).
	await rebalancearUltimaCuota(client, data.id_cuenta_cobrar, idCobro);
	await recalcularCuentaCobrar(client, data.id_cuenta_cobrar);

	return { success: true, message: 'Cobro confirmado como Cobrado', data: data as Cobro };
}

export interface CuentaCobrarVinculable {
	id_cuenta_cobrar: number;
	num_documento: string | null;
	saldo_pendiente: number;
	clienteNombre: string;
}

/**
 * Busca cuentas por cobrar con saldo pendiente para vincular una transacción manual — mismo criterio
 * que buscarCuentasPagarVinculables en cuentasPagar.service.ts (ver ahí el porqué del filtrado en el
 * cliente en vez de un OR de PostgREST entre tablas). `idCentroCosto` es obligatorio en la práctica —
 * a pedido del usuario, el buscador solo debe ofrecer cuentas del MISMO centro de costo elegido en la
 * transacción (el destino, que es el que recibe), para no poder vincular el cobro de un proyecto
 * contra el de otro.
 */
export async function buscarCuentasCobrarVinculables(
	client: SupabaseClient,
	query: string,
	idCentroCosto: number | null
): Promise<CuentaCobrarVinculable[]> {
	if (!idCentroCosto) return [];

	const { data, error } = await client
		.from(TABLE_NAME)
		.select('id_cuenta_cobrar, num_documento, saldo_pendiente, cliente(nombre)')
		.eq('activo', true)
		.eq('id_centro_costo', idCentroCosto)
		.gt('saldo_pendiente', 0)
		.order('fecha_vencimiento', { ascending: true, nullsFirst: false });
	if (error) throw error;

	const items: CuentaCobrarVinculable[] = (data ?? []).map((row: any) => ({
		id_cuenta_cobrar: row.id_cuenta_cobrar as number,
		num_documento: row.num_documento as string | null,
		saldo_pendiente: Number(row.saldo_pendiente),
		clienteNombre: row.cliente?.nombre ?? `Cliente #${row.id_cuenta_cobrar}`
	}));

	const q = query.trim().toLowerCase();
	if (!q) return items.slice(0, 8);
	return items
		.filter(
			(it) =>
				it.clienteNombre.toLowerCase().includes(q) ||
				(it.num_documento ?? '').toLowerCase().includes(q) ||
				String(it.id_cuenta_cobrar).includes(q)
		)
		.slice(0, 8);
}

/**
 * Crea la transacción Y, en el mismo paso, un cobro ya 'cobrado' vinculado a ella contra una cuenta
 * por cobrar existente — mismo criterio que registrarPagoDesdeTransaccion en cuentasPagar.service.ts,
 * ahora vía una sola llamada atómica a fn_confirmar_cobro (sin `p_id_cobro`) — ver
 * financial_integrity_rpc_migration.sql: cierra el mismo TOCTOU y la misma ventana de "transacción
 * huérfana si el INSERT del cobro fallaba" que tenía la versión anterior.
 * `medio_cobro` solo tiene 2 opciones en su catálogo (Efectivo/Transferencia bancaria, ver
 * cobro.config.ts) mientras que transaccion.medio_pago tiene 4 — se copia el código tal cual (mismo
 * criterio ya usado en construirPayloadTransaccionPorCobro, que hace el camino inverso): si el usuario
 * eligió "Depósito bancario" o "Yape o Plin" en la transacción, el código queda fuera del catálogo
 * mostrado en Cuentas por Cobrar, pero no hay CHECK en BD que lo bloquee.
 */
export async function registrarCobroDesdeTransaccion(
	client: SupabaseClient,
	idCuentaCobrar: number,
	transaccionPayload: Record<string, unknown>,
	usuarioRegistro: string | null,
	usuarioNombre: string | null = null,
	idempotencyKey: string | null = null
): Promise<ServiceResult<Transaccion>> {
	const built = construirInsertDataTransaccion(transaccionPayload, usuarioRegistro, usuarioNombre);
	if ('errors' in built) return { success: false, message: 'Revisa los campos marcados', errors: built.errors };

	const medioPagoCodigo = transaccionPayload.medio_pago as string | null;
	const cobroPayload = {
		monto: Number(transaccionPayload.monto_total),
		fecha_cobro: transaccionPayload.fecha,
		medio_cobro: medioPagoCodigo ? Number(medioPagoCodigo) : null,
		cuenta_banco: (transaccionPayload.cuente_destino as string | null) ?? null,
		referencia: (transaccionPayload.descripcion as string | null) ?? null,
		usuario_registro: usuarioRegistro
	};

	const { data: cobro, error } = await client.rpc('fn_confirmar_cobro', {
		p_id_cuenta_cobrar: idCuentaCobrar,
		p_transaccion_payload: built.insertData,
		p_cobro_payload: cobroPayload,
		p_idempotency_key: idempotencyKey
	});
	if (error) {
		return { success: false, message: `No se pudo vincular el cobro: ${translateRpcError(error, COBRO_FIELDS)}` };
	}

	const { data: transaccion } = await client.from('transaccion').select('*').eq('id_transaccion', (cobro as Cobro).id_transaccion).single();

	return { success: true, message: 'Transacción creada y vinculada — el cobro quedó registrado en la cuenta.', data: transaccion as Transaccion };
}

/**
 * Comprueba si, al anular la cuota `idCobroAAnular`, el resto de los cobros (cobrado + programado,
 * excluyendo esa cuota ya que al cancelarse deja de contar) seguiría sumando exactamente el monto de
 * la cuenta. No modifica nada — solo informa si cuadra o no, para que updateCobro decida si bloquea
 * la anulación.
 */
async function verificarSumaTrasCancelar(
	client: SupabaseClient,
	idCuentaCobrar: number,
	idCobroAAnular: number
): Promise<{ cuadra: boolean; sumaResultante: number; monto: number }> {
	const { data: cuenta } = await client.from(TABLE_NAME).select('monto').eq(PK_COLUMN, idCuentaCobrar).single();
	const monto = Number(cuenta?.monto ?? 0);

	const { data: cobros } = await client
		.from(COBRO_TABLE)
		.select('id_cobro, monto, estado_cobro')
		.eq(PARENT_FK_COLUMN, idCuentaCobrar);

	const sumaResultante = (cobros ?? [])
		.filter((c: any) => c.id_cobro !== idCobroAAnular && (c.estado_cobro === 'cobrado' || c.estado_cobro === 'programado'))
		.reduce((sum: number, c: any) => sum + Number(c.monto), 0);

	return {
		cuadra: Number(sumaResultante.toFixed(2)) === Number(monto.toFixed(2)),
		sumaResultante: Number(sumaResultante.toFixed(2)),
		monto
	};
}

/**
 * Cuánto le queda "sin comprometer" a una cuenta: Monto menos la suma de todas sus cuotas activas
 * (cobrado + programado; 'cancelado' no cuenta). Usado por createCobro para no dejar que un cobro
 * suelto nuevo empuje la suma de cuotas por ENCIMA del monto total de la cuenta — a diferencia de
 * editar una cuota ya existente (ver rebalancearUltimaCuota, más abajo), aquí no hay ninguna otra
 * cuota que pueda absorber el exceso. Mismo criterio que montoDisponible en cuentasPagar.service.ts.
 */
async function montoDisponible(client: SupabaseClient, idCuentaCobrar: number): Promise<number> {
	const { data: cuenta } = await client.from(TABLE_NAME).select('monto').eq(PK_COLUMN, idCuentaCobrar).single();
	if (!cuenta) return 0;

	const { data: cobros } = await client.from(COBRO_TABLE).select('monto, estado_cobro').eq(PARENT_FK_COLUMN, idCuentaCobrar);
	const comprometido = (cobros ?? [])
		.filter((c: any) => c.estado_cobro !== 'cancelado')
		.reduce((sum: number, c: any) => sum + Number(c.monto), 0);

	return Number((Number(cuenta.monto) - comprometido).toFixed(2));
}

/**
 * El monto total de la cuenta SIEMPRE debe ser igual a la suma de sus cuotas. Si el usuario edita el
 * monto de una cuota a mano, o cancela una (con lo que su monto deja de estar cubierto por el
 * calendario), esta función ajusta la ÚLTIMA cuota 'programado' que quede (excluyendo la que se acaba
 * de editar, para no deshacer justo ese cambio) sumándole/restándole la diferencia — el mismo
 * "colchón de redondeo" que ya se usa al generar el calendario inicial (generarCobrosProgramados). Si
 * no queda ninguna otra cuota 'programado' para absorber la diferencia, no se toca nada.
 */
async function rebalancearUltimaCuota(client: SupabaseClient, idCuentaCobrar: number, idCobroEditado: number): Promise<void> {
	const { data: cuenta } = await client.from(TABLE_NAME).select('monto').eq(PK_COLUMN, idCuentaCobrar).single();
	if (!cuenta) return;

	const { data: cobros } = await client
		.from(COBRO_TABLE)
		.select('id_cobro, monto, estado_cobro, fecha_cobro')
		.eq(PARENT_FK_COLUMN, idCuentaCobrar);
	if (!cobros) return;

	const fijos = cobros.filter((c: any) => c.estado_cobro === 'cobrado').reduce((sum: number, c: any) => sum + Number(c.monto), 0);
	const programado = cobros
		.filter((c: any) => c.estado_cobro === 'programado')
		.sort((a: any, b: any) => new Date(a.fecha_cobro).getTime() - new Date(b.fecha_cobro).getTime());

	const restante = Number(cuenta.monto) - fijos;
	const sumaProgramado = programado.reduce((sum: number, c: any) => sum + Number(c.monto), 0);
	const diferencia = Number((restante - sumaProgramado).toFixed(2));
	if (diferencia === 0) return; // ya cuadra, nada que ajustar

	const candidatas = programado.filter((c: any) => c.id_cobro !== idCobroEditado);
	if (candidatas.length === 0) return; // no hay otra cuota programada que absorba la diferencia

	const candidata = candidatas[candidatas.length - 1];
	const nuevoMonto = Number((Number(candidata.monto) + diferencia).toFixed(2));
	await client.from(COBRO_TABLE).update({ monto: nuevoMonto }).eq(COBRO_PK, candidata.id_cobro);
}

export async function deleteCobro(client: SupabaseClient, idCobro: number, esAdmin: boolean = false): Promise<ServiceResult> {
	const { data: cobro, error: fetchError } = await client.from(COBRO_TABLE).select(PARENT_FK_COLUMN).eq(COBRO_PK, idCobro).single();
	if (fetchError || !cobro) return { success: false, message: 'Cobro no encontrado' };

	if (!esAdmin && (await cobroTieneTransaccionAprobada(client, idCobro))) {
		return { success: false, message: BLOQUEADO_POR_APROBACION };
	}

	const { error } = await client.from(COBRO_TABLE).delete().eq(COBRO_PK, idCobro);
	if (error) return { success: false, message: `No se pudo eliminar el cobro: ${translateSupabaseError(error, COBRO_FIELDS)}` };

	await recalcularCuentaCobrar(client, (cobro as any)[PARENT_FK_COLUMN]);
	return { success: true, message: 'Cobro eliminado correctamente' };
}

/**
 * Recalcula monto_cobrado/saldo_pendiente/estado de una cuenta a partir de la plata REAL ya recibida
 * (transacción de ingreso activa en su centro de costo) — los 3 estados (Pendiente/Pagado/Vencido) se
 * derivan solos, mismos criterios de siempre (ver fn_recalcular_cuenta_cobrar en
 * financial_integrity_rpc_migration.sql, fórmula portada 1:1 desde esta función).
 *
 * Wrapper delgado sobre esa RPC: corre bajo `SELECT ... FOR UPDATE` en una sola transacción de
 * Postgres — antes era un SELECT-calcula-en-JS-UPDATE sin lock, con la misma condición de carrera que
 * recalcularCuentaPagar en cuentasPagar.service.ts (ver ahí). Se llama tras registrar/eliminar un
 * cobro, que es cuando cambia la transacción vinculada.
 */
/** yyyy-mm-dd + n días (calendario, sin depender de la zona horaria). */
function sumarDias(fecha: string, dias: number): string {
	const d = new Date(`${fecha}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + dias);
	return d.toISOString().slice(0, 10);
}

/**
 * A pedido del usuario: toda venta CERRADA debe tener su Cuenta por Cobrar (antes solo la creaba "Nueva venta"
 * con Forma de cobranza; "Cerrar venta" desde Editar venta no creaba ninguna). Si la venta ya tiene una (por
 * proyecto o por su centro de costo) no hace nada. Si no, la crea por el Valor venta: cada ingreso que ya
 * entró al centro de costo del proyecto (ej. el adelanto) queda como cuota COBRADA enlazada a su transacción,
 * y el saldo como una cuota pendiente a 30 días. Misma regla que la migración cuentas_cobrar_ventas_cerradas.
 * Nunca lanza: devuelve un mensaje si no pudo (el cierre de la venta no debe fallar por esto).
 */
export async function asegurarCuentaCobrarDeVenta(
	client: SupabaseClient,
	venta: {
		idProyecto: number;
		idCliente: number;
		idCentroCosto: number | null;
		montoVenta: number;
		fechaVenta: string;
		responsable: string | null;
		proyectoNombre: string;
	},
	usuarioRegistro: string | null
): Promise<{ creada: boolean; mensaje: string | null }> {
	try {
		const filtros = [`id_proyecto.eq.${venta.idProyecto}`];
		if (venta.idCentroCosto) filtros.push(`id_centro_costo.eq.${venta.idCentroCosto}`);
		const { data: existentes, error: errExistentes } = await client.from(TABLE_NAME).select(PK_COLUMN).eq('activo', true).or(filtros.join(','));
		if (errExistentes) return { creada: false, mensaje: errExistentes.message };
		if ((existentes ?? []).length > 0) return { creada: false, mensaje: null };

		const monto = Math.round(Number(venta.montoVenta) * 100) / 100;
		if (!(monto > 0)) return { creada: false, mensaje: null };

		// Ingresos ya recibidos en el centro de costo del proyecto que todavía no son cuota de ninguna cuenta.
		let ingresos: { id_transaccion: number; fecha: string; monto: number; categoria: string | null }[] = [];
		if (venta.idCentroCosto) {
			const { data: tx } = await client
				.from('transaccion')
				.select('id_transaccion, fecha, monto_total, monto_convertido, tipo_moneda, categoria')
				.eq('id_centro_costo_destino', venta.idCentroCosto)
				.eq('tipo', 'ingreso')
				.eq('estado', 'activo')
				.order('fecha', { ascending: true });
			const ids = (tx ?? []).map((t: any) => t.id_transaccion);
			const { data: yaEnCuotas } = ids.length ? await client.from(COBRO_TABLE).select('id_transaccion').in('id_transaccion', ids) : { data: [] };
			const usados = new Set((yaEnCuotas ?? []).map((c: any) => c.id_transaccion));
			ingresos = (tx ?? [])
				.filter((t: any) => !usados.has(t.id_transaccion))
				.map((t: any) => ({
					id_transaccion: t.id_transaccion,
					fecha: t.fecha,
					monto: Math.round((t.tipo_moneda === 'dolares' && t.monto_convertido != null ? Number(t.monto_convertido) : Number(t.monto_total)) * 100) / 100,
					categoria: t.categoria ?? null
				}))
				.filter((t) => t.monto > 0);
		}
		const cobrado = Math.round(ingresos.reduce((s, t) => s + t.monto, 0) * 100) / 100;
		if (cobrado - monto > 0.01) {
			return { creada: false, mensaje: `Lo ya cobrado (${formatCurrency(cobrado)}) supera el Valor venta (${formatCurrency(monto)}): crea la Cuenta por Cobrar a mano.` };
		}
		const saldo = Math.round((monto - cobrado) * 100) / 100;
		// 30 días desde la fecha de venta, o desde hoy si la venta es antigua (así el saldo no nace vencido).
		const hoy = new Date().toLocaleDateString('en-CA');
		const fechaSaldo = sumarDias(venta.fechaVenta > hoy ? venta.fechaVenta : hoy, 30);
		// Ticket #102: si el adelanto llegó en varias armadas, cada una queda como "Adelanto – Nª armada" (así el
		// cronograma las nombra a todas como adelanto, ver contarArmadasAdelanto).
		const adelantos = ingresos.filter((t) => t.categoria === 'Adelanto');
		const fracciones = [
			...ingresos.map((t) => ({
				fecha: t.fecha,
				monto: t.monto,
				referencia: adelantos.length > 1 && t.categoria === 'Adelanto' ? referenciaArmada(adelantos.indexOf(t)) : t.categoria
			})),
			...(saldo > 0.005 ? [{ fecha: fechaSaldo, monto: saldo, referencia: 'Saldo de la venta' }] : [])
		];

		const result = await createCuentaCobrar(
			client,
			{
				id_cliente: venta.idCliente,
				id_centro_costo: venta.idCentroCosto,
				id_proyecto: venta.idProyecto,
				monto,
				forma_pago: '2', // Crédito
				'condición_pago': fracciones.length,
				responsable: venta.responsable,
				fecha_emision: venta.fechaVenta,
				fecha_vencimiento: saldo > 0.005 ? fechaSaldo : venta.fechaVenta,
				moneda: 'PEN',
				observaciones: `Cuenta por cobrar de la venta ${venta.proyectoNombre}`.slice(0, 200)
			},
			usuarioRegistro,
			fracciones
		);
		if (!result.success || !result.data) return { creada: false, mensaje: result.message };
		const idCuenta = result.data.id_cuenta_cobrar;

		// Las cuotas de los ingresos ya recibidos pasan a 'cobrado', enlazadas a su transacción.
		if (ingresos.length > 0) {
			const { data: cuotas } = await client
				.from(COBRO_TABLE)
				.select('id_cobro, fecha_cobro, monto')
				.eq(PARENT_FK_COLUMN, idCuenta)
				.eq('estado_cobro', 'programado')
				.order('id_cobro', { ascending: true });
			const libres = [...(cuotas ?? [])];
			for (const t of ingresos) {
				const i = libres.findIndex((c: any) => c.fecha_cobro === t.fecha && Math.abs(Number(c.monto) - t.monto) < 0.01);
				if (i < 0) continue;
				const [cuota] = libres.splice(i, 1);
				await client.from(COBRO_TABLE).update({ estado_cobro: 'cobrado', id_transaccion: t.id_transaccion }).eq(COBRO_PK, (cuota as any).id_cobro);
			}
			await recalcularCuentaCobrar(client, idCuenta);
		}
		return { creada: true, mensaje: null };
	} catch (err: any) {
		return { creada: false, mensaje: err?.message ?? String(err) };
	}
}

export async function recalcularCuentaCobrar(client: SupabaseClient, idCuentaCobrar: number): Promise<void> {
	const { error } = await client.rpc('fn_recalcular_cuenta_cobrar', { p_id_cuenta_cobrar: idCuentaCobrar });
	if (error) console.error('[cuentasCobrar.service] No se pudo recalcular la cuenta por cobrar:', idCuentaCobrar, error);
}

export async function getClienteOptions(client: SupabaseClient): Promise<FieldOption[]> {
	// Solo activos — la misma lista que el Directorio de Clientes (los dados de baja no se ofrecen).
	const { data, error } = await client.from('cliente').select('id_cliente, nombre').neq('estado', 'baja').order('nombre');
	if (error) throw error;
	return (data ?? []).map((c: any) => ({ value: String(c.id_cliente), label: c.nombre }));
}

/** A pedido explícito del usuario (corrige el criterio anterior: ya no "no dado de baja", sino
 * exactamente esto): el selector "Proyecto" de Nueva/Editar Cuenta por Cobrar solo ofrece proyectos
 * con `estado_proyecto = 'venta_cerrada'` — una cuenta por cobrar corresponde a una venta ya
 * confirmada, no a un proyecto todavía en negociación ni a uno dado de baja.
 *
 * La etiqueta muestra el código generado del proyecto (mismo `generarCodigoProyecto` que usa Ventas
 * y Centro de Costos) en vez de `nombre_proyecto` crudo — a pedido del usuario, el campo "Proyecto" se
 * autocompleta con este código al elegir el Centro de Costo vinculado (ver
 * getCentroCostoProyectoMap/handleInput en CuentaCobrarModal.svelte). */
export async function getProyectoOptions(client: SupabaseClient): Promise<FieldOption[]> {
	const { data, error } = await client
		.from('proyecto')
		.select(
			'id_proyecto, tipo_venta, tip_proyecto, estado_predio, tipo_edifica, tipo_obra, tipo_tramite, tipo_intervencion, tipo_edificacion_obra, mes_obra, anio_obra, nro_pisos, distrito, ubicacion, fecha_inicio_plan, created_at, cliente:id_cliente(nombre)'
		)
		.eq('estado_proyecto', 'venta_cerrada')
		.order('fecha_inicio_plan', { ascending: false });
	if (error) throw error;
	return (data ?? []).map((p: any) => ({ value: String(p.id_proyecto), label: generarCodigoProyecto(p) }));
}
