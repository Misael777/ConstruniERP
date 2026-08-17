/**
 * Servicio de acceso a datos para los tableros de "Panoramas de Pago" y "Panoramas de Cobro"
 * (planeación de flujo de caja).
 *
 * Reutiliza las tablas existentes cuentas_pagar/cuentas_cobrar (no se creó una tabla de "ítems"
 * nueva, por decisión explícita): cada tarjeta de la bandeja/panorama ES una fila de esas tablas —
 * salvo que esté "fraccionada" (ver más abajo), en cuyo caso son sus cuotas (pagos/cobros) las que
 * se arrastran. Columnas agregadas vía panorama_persistencia_migration.sql:
 *   cuentas_pagar / cuentas_cobrar: panorama_id SMALLINT NULL, panorama_orden INTEGER NULL
 *   pagos / cobros:                 panorama_id SMALLINT NULL, panorama_orden INTEGER NULL
 *
 * Hay exactamente 2 panoramas fijos (no CRUD de panoramas, por decisión explícita) — sus nombres
 * ("Panorama 1"/"Panorama 2") y subtítulos están hardcodeados en el +page.svelte, no en la BD.
 *
 * FRACCIONAMIENTO (clusters arrastrables) — pedido explícito del usuario: si una cuenta tiene 2+
 * cuotas 'programado' en pagos/cobros, se considera "fraccionada" y se muestra como un CLUSTER: una
 * tarjeta contenedora con una sub-tarjeta arrastrable por cuota, agrupadas bajo la cuenta. El
 * usuario puede:
 *   (a) arrastrar la tarjeta del cluster completa -> mueve TODAS las cuotas visibles en esa tarjeta
 *       juntas (mismo panorama_id + panorama_orden para todas) — "en bloque".
 *   (b) arrastrar una sub-tarjeta de una cuota individual -> mueve solo esa fila de pagos/cobros,
 *       independiente de sus hermanas.
 * Como consecuencia directa de (b), las cuotas de una misma cuenta pueden terminar repartidas entre
 * la Bandeja y ambos Panoramas — cada columna muestra únicamente el subconjunto de cuotas de esa
 * cuenta que le corresponde a ELLA (panorama_id de la cuota = el de esa columna), agrupadas bajo el
 * mismo encabezado de cuenta. Una cuenta con 0-1 cuota 'programado' NO se considera fraccionada: se
 * sigue mostrando y arrastrando como una tarjeta simple de toda la vida, vía el panorama_id propio
 * de la fila de cuentas_pagar/cuentas_cobrar (sin cambios de comportamiento).
 *
 * Se invoca client-side con el cliente anon, igual que el resto de módulos de finanzas — funciona
 * igual en web y en Tauri (Windows/Android) sin servidor embebido.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FieldOption } from '$lib/shared/fieldConfig';

export const PANORAMA_IDS = [1, 2] as const;
export type PanoramaId = (typeof PANORAMA_IDS)[number];

export type Prioridad = 'alto' | 'media' | 'bajo';
export type EstadoVencimiento = 'vencido' | 'por_vencer';

/** Una cuota individual ('programado') de una cuenta fraccionada — arrastrable por separado.
 * `id` = id_pago/id_cobro, único dentro de la lista de fracciones de ESA tarjeta (suficiente para
 * svelte-dnd-action, que solo exige unicidad dentro de cada dndzone). */
export interface FraccionPanorama {
	id: number;
	idCuenta: number;
	numeroCuota: number;
	totalCuotas: number;
	monto: number;
	fecha: string;
	panoramaId: number | null;
	panoramaOrden: number | null;
}

export interface PagoPendienteItem {
	/** Alias de id_cuenta_pagar: svelte-dnd-action exige que cada ítem tenga una propiedad `id`. */
	id: number;
	id_cuenta_pagar: number;
	titulo: string;
	proveedorNombre: string;
	/** vendedor (columna "Producto y Servicio" del proveedor, ver ProveedorModal.svelte) — null si el
	 * proveedor no tiene uno cargado. */
	producto: string | null;
	monto: number;
	/** saldo_pendiente de TODA la cuenta (no solo lo visible en esta tarjeta/cluster) — para la
	 * Bandeja de Pagos Pendientes, ver +page.svelte. */
	saldoPendiente: number;
	fechaVencimiento: string | null;
	/** fecha_pago_programada — fecha interna de planificación de pago, distinta de fechaVencimiento
	 * (la fecha contractual). Es lo que posiciona/reprograma el calendario de Panoramas de Pago. */
	fechaProgramada: string | null;
	idProyecto: number | null;
	panoramaId: number | null;
	panoramaOrden: number | null;
	prioridad: Prioridad;
	/** monto_comprometido (monto total de la cuenta, no el saldo) y fecha_emision — ya venían en el
	 * `select('*')` de abajo, solo no se exponían. Se agregan para que el popup de cuotas (ver
	 * abrirCuotasDe en +page.svelte) pueda abrir SIN una consulta extra a cuentas_pagar. */
	montoTotal: number;
	fechaEmision: string;
	/** 2+ elementos = esta cuenta está fraccionada, la tarjeta se dibuja como cluster con una
	 * sub-tarjeta arrastrable por cuota (ver nota de arriba). 0 elementos = tarjeta simple normal. */
	fracciones: FraccionPanorama[];
	/** true = la cuenta ya tiene estado='pagado' (ya se ejecutó, con su transacción de egreso real) —
	 * a pedido explícito del usuario: el calendario de "Panorama Actual" las muestra igual que
	 * cualquier otra (ver getCuentasPagarPagadas/getTodasLasCuentasPendientes), pero PanoramaCalendarView
	 * bloquea arrastrarlas a otra fecha (ya no se puede reprogramar un pago que ya se hizo). */
	pagado: boolean;
}

/** Entrada del orden final de una columna (Bandeja/Panorama) tras arrastrar-soltar en la zona
 * EXTERNA — mezcla cuentas simples y clusters completos (ver reorderPanorama). */
export type PanoramaEntry = { tipo: 'cuenta'; id: number } | { tipo: 'cluster'; idsFraccion: number[] };

/** Criterio de orden de la Bandeja (pedido explícito del usuario: "un dropbox de ordenamiento") —
 * 'nombre' es proveedor (pagos) o cliente (cobros), según corresponda. */
export type BandejaSortBy = 'fechaVencimiento' | 'monto' | 'nombre' | 'prioridad';

export interface BandejaParams {
	idProyecto?: number | null;
	prioridad?: string | null;
	estado?: 'pendiente' | 'vencido' | null;
	/** Búsqueda libre por título/proveedor (pagos) o título/cliente/proyecto (cobros), sin distinguir
	 * mayúsculas — mismo criterio simple que el resto del ERP. */
	search?: string;
	sortBy?: BandejaSortBy;
	sortDir?: 'asc' | 'desc';
	page?: number;
	pageSize?: number;
}

export interface BandejaResult<T> {
	items: T[];
	total: number;
	page: number;
	pageSize: number;
	totalPages: number;
}

const RANGO_PRIORIDAD: Record<string, number> = { alto: 0, media: 1, medio: 1, bajo: 2 };

/**
 * Ordena y pagina una lista YA filtrada/clasificada de la bandeja (cuentas simples + clusters
 * mezclados) — pedido explícito del usuario ("que la lista sea paginada... un dropbox de
 * ordenamiento"). Se hace en memoria, sobre el resultado final (después de armar los clusters de
 * fraccionamiento), no con un LIMIT/OFFSET de SQL: la clasificación fraccionada/no-fraccionada de
 * cada cuenta depende de una segunda consulta (pagos/cobros) que no se puede paginar de antemano
 * sin arriesgar cortar una cuenta a la mitad. Para la escala de cuentas pendientes de este ERP
 * (decenas, no decenas de miles) traer todo y paginar en memoria es correcto y simple; si el
 * volumen crece mucho, esto es lo primero que habría que mover a SQL.
 */
function paginarBandeja<T extends { fechaVencimiento: string | null; monto: number; prioridad: string }>(
	items: T[],
	params: BandejaParams,
	nombreDe: (item: T) => string
): BandejaResult<T> {
	const search = params.search?.trim().toLowerCase();
	const filtrados = search ? items.filter((i) => nombreDe(i).toLowerCase().includes(search)) : items;

	const sortBy = params.sortBy ?? 'fechaVencimiento';
	const dir = params.sortDir === 'desc' ? -1 : 1;
	const ordenados = [...filtrados].sort((a, b) => {
		let cmp = 0;
		if (sortBy === 'fechaVencimiento') cmp = (a.fechaVencimiento ?? '9999-99-99').localeCompare(b.fechaVencimiento ?? '9999-99-99');
		else if (sortBy === 'monto') cmp = a.monto - b.monto;
		else if (sortBy === 'prioridad') cmp = (RANGO_PRIORIDAD[a.prioridad] ?? 9) - (RANGO_PRIORIDAD[b.prioridad] ?? 9);
		else cmp = nombreDe(a).localeCompare(nombreDe(b));
		return cmp * dir;
	});

	const total = ordenados.length;
	const pageSize = Math.max(1, Math.floor(params.pageSize ?? 10));
	const page = Math.max(1, Math.floor(params.page ?? 1));
	const totalPages = Math.max(1, Math.ceil(total / pageSize));
	const from = (page - 1) * pageSize;

	return { items: ordenados.slice(from, from + pageSize), total, page, pageSize, totalPages };
}

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Días entre hoy y la fecha de vencimiento (negativo si ya venció). */
function diasHastaVencimiento(fechaVencimiento: string | null): number | null {
	if (!fechaVencimiento) return null;
	const hoy = new Date();
	hoy.setHours(0, 0, 0, 0);
	const venc = new Date(fechaVencimiento);
	if (Number.isNaN(venc.getTime())) return null;
	return Math.round((venc.getTime() - hoy.getTime()) / MS_POR_DIA);
}

/** Heurística por defecto (solo cuando la cuenta no tiene `prioridad` asignada a mano — ver
 * mapRow): sin fecha o >15 días = bajo, 8-15 días = media, ≤7 días o vencido = alto. AJUSTAR
 * umbrales si se necesita otra regla. */
export function computePrioridad(fechaVencimiento: string | null): Prioridad {
	const dias = diasHastaVencimiento(fechaVencimiento);
	if (dias === null) return 'bajo';
	if (dias <= 7) return 'alto';
	if (dias <= 15) return 'media';
	return 'bajo';
}

/** Ya pasó la fecha de vencimiento -> 'vencido'; si no, 'por_vencer'. */
export function computeEstadoVencimiento(fechaVencimiento: string | null): EstadoVencimiento {
	const dias = diasHastaVencimiento(fechaVencimiento);
	return dias !== null && dias < 0 ? 'vencido' : 'por_vencer';
}

const SELECT_CON_JOINS = '*, proveedor(razon_social, vendedor), presupuesto(id_proyecto, proyecto(nombre_proyecto))';

function mapRow(row: any, fracciones: FraccionPanorama[]): PagoPendienteItem {
	return {
		id: row.id_cuenta_pagar,
		id_cuenta_pagar: row.id_cuenta_pagar,
		// A pedido explícito del usuario: el encabezado de la tarjeta (Bandeja/Panoramas/Calendario)
		// prioriza el nombre del PROVEEDOR sobre el N° de documento — antes mostraba el N° de factura
		// cuando no había observación, que identifica menos a simple vista que el proveedor. Solo cae al
		// N° de documento si ni la observación ni el proveedor están disponibles.
		titulo: row.observacion || row.proveedor?.razon_social || row.num_documento || 'Pago sin descripción',
		proveedorNombre: row.proveedor?.razon_social ?? 'Sin proveedor',
		producto: row.proveedor?.vendedor ?? null,
		// Si está fraccionada, `monto` es la suma de SOLO las cuotas 'programado' (no pagadas) visibles
		// en ESTA tarjeta (no el total de la cuenta) — se usa para sumar totales por columna
		// (proyeccionPagos, CSV, etc.); usar el total completo sobre-contaría cuando las cuotas de una
		// cuenta terminan repartidas entre Bandeja/Panorama 1/Panorama 2. Si NO está fraccionada, se usa
		// saldo_pendiente (lo que falta pagar), no monto_comprometido (el total original) — una cuenta
		// simple con pagos parciales ya registrados no debe proyectarse por su monto completo, mismo
		// criterio que las fracciones (que ya excluyen lo pagado). `montoTotal` (abajo) sigue siendo el
		// comprometido original de la cuenta completa, para el popup de cuotas.
		monto: fracciones.length > 0 ? fracciones.reduce((s, f) => s + f.monto, 0) : Number(row.saldo_pendiente),
		saldoPendiente: Number(row.saldo_pendiente),
		fechaVencimiento: row.fecha_vencimiento,
		fechaProgramada: row.fecha_pago_programada,
		idProyecto: row.presupuesto?.id_proyecto ?? null,
		panoramaId: row.panorama_id,
		panoramaOrden: row.panorama_orden,
		prioridad: (row.prioridad as Prioridad) || computePrioridad(row.fecha_vencimiento),
		montoTotal: Number(row.monto_comprometido),
		fechaEmision: row.fecha_emision,
		fracciones,
		pagado: row.estado === 'pagado'
	};
}

/** Trae TODAS las cuotas 'programado' de las cuentas dadas y las agrupa por id_cuenta_pagar. Una
 * cuenta con menos de 2 cuotas no se agrega al mapa (no se considera "fraccionada" — ver nota de
 * arriba), para que el llamador la trate como tarjeta simple sin tener que repetir esa condición. */
async function fraccionesPagoPorCuenta(client: SupabaseClient, idsCuenta: number[]): Promise<Map<number, FraccionPanorama[]>> {
	const resultado = new Map<number, FraccionPanorama[]>();
	if (idsCuenta.length === 0) return resultado;

	const { data, error } = await client
		.from('pagos')
		.select('id_pago, id_cuenta_pagar, monto, fecha_pago, panorama_id, panorama_orden')
		.in('id_cuenta_pagar', idsCuenta)
		.eq('estado_pago', 'programado')
		.order('fecha_pago', { ascending: true });
	if (error) throw error;

	const porCuenta = new Map<number, any[]>();
	for (const fila of data ?? []) {
		const lista = porCuenta.get(fila.id_cuenta_pagar) ?? [];
		lista.push(fila);
		porCuenta.set(fila.id_cuenta_pagar, lista);
	}

	for (const [idCuenta, filas] of porCuenta) {
		if (filas.length < 2) continue;
		resultado.set(
			idCuenta,
			filas.map((f, i) => ({
				id: f.id_pago,
				idCuenta: f.id_cuenta_pagar,
				numeroCuota: i + 1,
				totalCuotas: filas.length,
				monto: Number(f.monto),
				fecha: f.fecha_pago,
				panoramaId: f.panorama_id,
				panoramaOrden: f.panorama_orden
			}))
		);
	}
	return resultado;
}

/** Trae todas las cuentas por pagar pendientes/vencidas + sus fracciones (si las tiene) — base
 * compartida de getPagosPendientes y getPanoramaItems, que solo difieren en QUÉ subconjunto de cada
 * cuenta/cluster le corresponde a su columna. */
async function cuentasPagarConFracciones(client: SupabaseClient): Promise<{ cuentas: any[]; fracciones: Map<number, FraccionPanorama[]> }> {
	const { data, error } = await client
		.from('cuentas_pagar')
		.select(SELECT_CON_JOINS)
		.in('estado', ['pendiente', 'vencido'])
		.order('fecha_vencimiento', { ascending: true, nullsFirst: false });
	if (error) throw error;

	const cuentas = (data ?? []) as any[];
	const fracciones = await fraccionesPagoPorCuenta(client, cuentas.map((c) => c.id_cuenta_pagar));
	return { cuentas, fracciones };
}

/** Pagos pendientes SIN panorama asignado todavía (la "bandeja"), paginada/buscable/ordenable —
 * pedido explícito del usuario para no tener una bandeja infinita. Incluye 'vencido' además de
 * 'pendiente'. Una cuenta fraccionada aparece aquí como cluster mostrando SOLO sus cuotas todavía
 * sin panorama — si ya las movió todas, la cuenta deja de aparecer en la bandeja por completo. */
export async function getPagosPendientes(client: SupabaseClient, params: BandejaParams = {}): Promise<BandejaResult<PagoPendienteItem>> {
	const { cuentas, fracciones } = await cuentasPagarConFracciones(client);

	let items: PagoPendienteItem[] = [];
	for (const row of cuentas) {
		const propias = fracciones.get(row.id_cuenta_pagar);
		if (propias) {
			const sinAsignar = propias.filter((f) => f.panoramaId === null);
			if (sinAsignar.length === 0) continue;
			items.push(mapRow(row, sinAsignar));
		} else {
			if (row.panorama_id !== null) continue;
			items.push(mapRow(row, []));
		}
	}

	if (params.idProyecto) items = items.filter((i) => i.idProyecto === params.idProyecto);
	if (params.prioridad) items = items.filter((i) => i.prioridad === params.prioridad);
	if (params.estado) items = items.filter((i) => (params.estado === 'vencido' ? computeEstadoVencimiento(i.fechaVencimiento) === 'vencido' : computeEstadoVencimiento(i.fechaVencimiento) === 'por_vencer'));

	return paginarBandeja(items, params, (i) => `${i.titulo} ${i.proveedorNombre}`);
}

/** Pagos ya asignados a un panorama. Una cuenta fraccionada aparece como cluster mostrando SOLO las
 * cuotas que están en ESTE panorama específico — sus demás cuotas pueden estar en la bandeja o en
 * el otro panorama, se muestran ahí respectivamente (ver nota de arriba del archivo). */
export async function getPanoramaItems(client: SupabaseClient, panoramaId: PanoramaId): Promise<PagoPendienteItem[]> {
	const { cuentas, fracciones } = await cuentasPagarConFracciones(client);

	const items: PagoPendienteItem[] = [];
	for (const row of cuentas) {
		const propias = fracciones.get(row.id_cuenta_pagar);
		if (propias) {
			const enEstaColumna = propias.filter((f) => f.panoramaId === panoramaId).sort((a, b) => (a.panoramaOrden ?? 0) - (b.panoramaOrden ?? 0));
			if (enEstaColumna.length === 0) continue;
			items.push(mapRow(row, enEstaColumna));
		} else {
			if (row.panorama_id !== panoramaId) continue;
			items.push(mapRow(row, []));
		}
	}
	items.sort((a, b) => (a.panoramaOrden ?? Infinity) - (b.panoramaOrden ?? Infinity));
	return items;
}

/** Cuentas por pagar YA EJECUTADAS (estado='pagado', con su transacción de egreso real) — a pedido
 * explícito del usuario: el calendario de "Panorama Actual" debe mostrar TAMBIÉN estas (no solo
 * pendientes/vencidas), para ver la cartera completa de un vistazo. Se excluyen de la Bandeja/
 * Panorama 1/Panorama 2 (Kanban) a propósito — esos son de planeación de lo que falta pagar, no
 * tendría sentido "asignarle un panorama" a algo que ya se pagó. Sin fracciones: una cuenta pagada no
 * tiene cuotas 'programado' pendientes por definición. `activo` filtrado para no mostrar una dada de
 * baja como si siguiera vigente. */
export async function getCuentasPagarPagadas(client: SupabaseClient): Promise<PagoPendienteItem[]> {
	const { data, error } = await client
		.from('cuentas_pagar')
		.select(SELECT_CON_JOINS)
		.eq('estado', 'pagado')
		.eq('activo', true)
		.order('fecha_pago_programada', { ascending: false, nullsFirst: false });
	if (error) throw error;
	return ((data ?? []) as any[]).map((row) => mapRow(row, []));
}

/** TODAS las cuentas de la cartera (pendientes/vencidas + ya pagadas), sin filtrar por panorama_id —
 * a diferencia de getPagosPendientes (solo bandeja) y getPanoramaItems (solo un panorama), esta es la
 * fuente del calendario "Panorama Actual" (id 0): el espejo del estado real de fecha_pago_programada
 * para toda la cartera, sin importar en qué panorama/bandeja esté cada cuenta hoy. Cada cuenta se
 * devuelve completa (todas sus cuotas), no partida por columna, ya que aquí no hay noción de columna.
 * Incluye las ya pagadas (ver getCuentasPagarPagadas) a pedido explícito del usuario — el calendario
 * las bloquea para arrastrar (ver PanoramaCalendarView.svelte), pero deben verse igual. */
export async function getTodasLasCuentasPendientes(client: SupabaseClient): Promise<PagoPendienteItem[]> {
	const { cuentas, fracciones } = await cuentasPagarConFracciones(client);
	const pendientes = cuentas.map((row) => mapRow(row, fracciones.get(row.id_cuenta_pagar) ?? []));
	const pagadas = await getCuentasPagarPagadas(client);
	return [...pendientes, ...pagadas];
}

/** Asigna una cuenta SIMPLE (no fraccionada) a un panorama (o la regresa a la bandeja si
 * panoramaId es null), en la posición dada. */
export async function assignToPanorama(
	client: SupabaseClient,
	idCuentaPagar: number,
	panoramaId: PanoramaId | null,
	orden: number | null
): Promise<{ success: boolean; message: string }> {
	const { error } = await client
		.from('cuentas_pagar')
		.update({ panorama_id: panoramaId, panorama_orden: orden })
		.eq('id_cuenta_pagar', idCuentaPagar);

	if (error) return { success: false, message: `No se pudo mover el pago: ${error.message}` };
	return { success: true, message: 'Pago movido correctamente' };
}

/**
 * Mueve UNA O VARIAS cuotas (pagos.id_pago) al mismo panorama y con el mismo orden — cubre los dos
 * casos de arrastre de un cluster con UNA sola función: arrastrar la tarjeta completa del cluster
 * (idsFraccion = todas las cuotas visibles en esa tarjeta, "en bloque") y arrastrar una sola
 * sub-tarjeta de cuota individual (idsFraccion = un solo id). `panoramaId=null` las regresa a la
 * bandeja.
 */
export async function assignFraccionesToPanorama(
	client: SupabaseClient,
	idsFraccion: number[],
	panoramaId: PanoramaId | null,
	orden: number | null
): Promise<{ success: boolean; message: string }> {
	const results = await Promise.all(idsFraccion.map((id) => client.from('pagos').update({ panorama_id: panoramaId, panorama_orden: orden }).eq('id_pago', id)));
	const failed = results.find((r) => r.error);
	if (failed?.error) return { success: false, message: `No se pudo mover la cuota: ${failed.error.message}` };
	return { success: true, message: idsFraccion.length > 1 ? 'Cuotas movidas correctamente' : 'Cuota movida correctamente' };
}

/** Reescribe panorama_orden para toda una columna tras arrastrar-reordenar en la zona EXTERNA
 * (mezcla cuentas simples y clusters completos — un cluster escribe el mismo orden en TODAS sus
 * cuotas, ya que se mueve en bloque). 1 update por fila afectada, igual patrón que antes. */
export async function reorderPanorama(client: SupabaseClient, panoramaId: PanoramaId | null, entradas: PanoramaEntry[]): Promise<{ success: boolean; message: string }> {
	const ops: PromiseLike<{ error: any }>[] = [];
	entradas.forEach((entrada, index) => {
		if (entrada.tipo === 'cuenta') {
			ops.push(client.from('cuentas_pagar').update({ panorama_id: panoramaId, panorama_orden: index }).eq('id_cuenta_pagar', entrada.id));
		} else {
			for (const idPago of entrada.idsFraccion) {
				ops.push(client.from('pagos').update({ panorama_id: panoramaId, panorama_orden: index }).eq('id_pago', idPago));
			}
		}
	});
	const results = await Promise.all(ops);
	const failed = results.find((r) => r.error);
	if (failed?.error) return { success: false, message: `No se pudo reordenar: ${failed.error.message}` };
	return { success: true, message: 'Orden actualizado' };
}

/** Reescribe panorama_id/panorama_orden de una lista de cuotas tras arrastrar-soltar en la zona
 * INTERNA de un cluster (reordenar dentro del mismo cluster, o mover una cuota a OTRO cluster ya
 * existente de otra columna) — se llama una vez por cada zona interna que cambió, con su lista
 * final completa, igual criterio que reorderPanorama/handleBandejaFinalize. */
export async function reorderFracciones(client: SupabaseClient, panoramaId: PanoramaId | null, idsFraccion: number[]): Promise<{ success: boolean; message: string }> {
	const results = await Promise.all(idsFraccion.map((id, index) => client.from('pagos').update({ panorama_id: panoramaId, panorama_orden: index }).eq('id_pago', id)));
	const failed = results.find((r) => r.error);
	if (failed?.error) return { success: false, message: `No se pudo reordenar la cuota: ${failed.error.message}` };
	return { success: true, message: 'Orden actualizado' };
}

/** Atajo de un clic (sin arrastrar) para mover UNA cuota a un panorama — respaldo para el caso en
 * que todavía no existe ningún cluster de esa cuenta en la columna destino (no hay dónde soltarla
 * arrastrando). Siempre disponible además del arrastre, nunca lo reemplaza. */
export async function moverFraccionAPanorama(client: SupabaseClient, idPago: number, panoramaId: PanoramaId | null): Promise<{ success: boolean; message: string }> {
	const { error } = await client.from('pagos').update({ panorama_id: panoramaId }).eq('id_pago', idPago);
	if (error) return { success: false, message: `No se pudo mover la cuota: ${error.message}` };
	return { success: true, message: 'Cuota movida correctamente' };
}

/** Reescribe panorama_orden para toda una columna tras arrastrar-reordenar (1 update por fila).
 * Suma saldo_pendiente de cuentas_cobrar (pendiente + vencido) — ver nota de "Proyección de ingresos"
 * arriba. Si se pasan `desde`/`hasta`, solo cuenta lo que vence en ese rango (mismo motivo que
 * getProyeccionPagos: comparar el mismo período en vez de "todo el tiempo" contra "un mes"). */
export async function getProyeccionIngresos(client: SupabaseClient, desde?: string, hasta?: string): Promise<number> {
	let query = client.from('cuentas_cobrar').select('saldo_pendiente').in('estado', ['pendiente', 'vencido']);
	if (desde) query = query.gte('fecha_vencimiento', desde);
	if (hasta) query = query.lte('fecha_vencimiento', hasta);
	const { data, error } = await query;
	if (error) throw error;
	return (data ?? []).reduce((sum: number, r: any) => sum + Number(r.saldo_pendiente), 0);
}

/** Reprograma fecha_pago_programada de una o más cuentas por pagar (drag-and-drop en la vista
 * Calendario de Panoramas de Pago — Panorama Actual escribe directo, P1/P2 escriben acá recién al
 * "Establecer como panorama actual") — 1 update por fila, igual patrón que reorderPanorama. */
export async function actualizarFechasProgramadasPago(
	client: SupabaseClient,
	cambios: { id: number; fecha: string }[]
): Promise<{ success: boolean; message: string }> {
	const results = await Promise.all(cambios.map((c) => client.from('cuentas_pagar').update({ fecha_pago_programada: c.fecha }).eq('id_cuenta_pagar', c.id)));
	const failed = results.find((r) => r.error);
	if (failed?.error) return { success: false, message: `No se pudieron actualizar las fechas: ${failed.error.message}` };
	return { success: true, message: 'Fechas actualizadas' };
}

export async function getProyectoOptions(client: SupabaseClient): Promise<FieldOption[]> {
	const { data, error } = await client.from('proyecto').select('id_proyecto, nombre_proyecto').order('nombre_proyecto');
	if (error) throw error;
	return (data ?? []).map((p: any) => ({ value: String(p.id_proyecto), label: p.nombre_proyecto }));
}

/**
 * =============================================================
 * Lado "Panoramas de Cobro" (cuentas_cobrar) — contraparte de todo lo de arriba, mismo patrón y
 * ahora YA PERSISTE en BD igual que Panoramas de Pago (antes era 100% de sesión — se agregaron
 * panorama_id/panorama_orden a cuentas_cobrar y a cobros vía panorama_persistencia_migration.sql,
 * decisión explícita del usuario para tener paridad real entre ambos tableros).
 *
 * A diferencia de cuentas_pagar (que no tiene un campo de prioridad manual y por eso la calcula sola
 * desde fecha_vencimiento), cuentas_cobrar SÍ tiene una columna real `prioridad` ('alto'|'medio'|'bajo',
 * ver cuentaCobrar.config.ts) elegida a mano por el usuario — se usa esa como fuente de verdad, y solo
 * se cae a un cálculo por fecha (mismos umbrales que computePrioridad, pero en masculino para calzar
 * con los valores reales de la columna) cuando la cuenta no tiene prioridad asignada.
 * =============================================================
 */

export type PrioridadCobro = 'alto' | 'medio' | 'bajo';

/** Fallback cuando la cuenta no tiene `prioridad` asignada a mano — mismos umbrales que computePrioridad. */
function prioridadCobroPorDefecto(fechaVencimiento: string | null): PrioridadCobro {
	const dias = diasHastaVencimiento(fechaVencimiento);
	if (dias === null) return 'bajo';
	if (dias <= 7) return 'alto';
	if (dias <= 15) return 'medio';
	return 'bajo';
}

export interface IngresoPendienteItem {
	/** Alias de id_cuenta_cobrar: svelte-dnd-action exige que cada ítem tenga una propiedad `id`. */
	id: number;
	id_cuenta_cobrar: number;
	titulo: string;
	clienteNombre: string;
	proyectoNombre: string | null;
	monto: number;
	/** saldo_pendiente de TODA la cuenta (no solo lo visible en esta tarjeta/cluster) — para el popup
	 * de cuotas (ver abrirCuotasDe en +page.svelte), que debe repartir solo lo que falta cobrar, no
	 * el monto total de la cuenta. Mismo criterio que PagoPendienteItem.saldoPendiente. */
	saldoPendiente: number;
	fechaVencimiento: string | null;
	idProyecto: number | null;
	idCliente: number | null;
	panoramaId: number | null;
	panoramaOrden: number | null;
	prioridad: PrioridadCobro;
	/** monto (total de la cuenta, no el saldo_pendiente de arriba) y fecha_emision — ya venían en el
	 * `select('*')` de abajo, solo no se exponían. Se agregan para que el popup de cuotas (ver
	 * abrirCuotasDe en +page.svelte) pueda abrir SIN una consulta extra a cuentas_cobrar. */
	montoTotal: number;
	fechaEmision: string;
	/** Ver FraccionPanorama/PagoPendienteItem.fracciones — mismo criterio, sobre "cobros" en vez de "pagos". */
	fracciones: FraccionPanorama[];
}

const SELECT_COBRO_CON_JOINS = '*, cliente(nombre), proyecto(nombre_proyecto)';

function mapCobroRow(row: any, fracciones: FraccionPanorama[]): IngresoPendienteItem {
	return {
		id: row.id_cuenta_cobrar,
		id_cuenta_cobrar: row.id_cuenta_cobrar,
		titulo: row.num_documento || row.observaciones || row.responsable || 'Cuenta por cobrar sin descripción',
		clienteNombre: row.cliente?.nombre ?? 'Sin cliente',
		proyectoNombre: row.proyecto?.nombre_proyecto ?? null,
		// Ver nota equivalente en mapRow: si está fraccionada, `monto` es la suma de solo las cuotas
		// visibles en esta tarjeta, no el saldo pendiente completo de la cuenta.
		monto: fracciones.length > 0 ? fracciones.reduce((s, f) => s + f.monto, 0) : Number(row.saldo_pendiente),
		saldoPendiente: Number(row.saldo_pendiente),
		fechaVencimiento: row.fecha_vencimiento,
		idProyecto: row.id_proyecto,
		idCliente: row.id_cliente,
		panoramaId: row.panorama_id,
		panoramaOrden: row.panorama_orden,
		prioridad: (row.prioridad as PrioridadCobro) || prioridadCobroPorDefecto(row.fecha_vencimiento),
		montoTotal: Number(row.monto),
		fechaEmision: row.fecha_emision,
		fracciones
	};
}

/** Contraparte de fraccionesPagoPorCuenta, sobre "cobros". */
async function fraccionesCobroPorCuenta(client: SupabaseClient, idsCuenta: number[]): Promise<Map<number, FraccionPanorama[]>> {
	const resultado = new Map<number, FraccionPanorama[]>();
	if (idsCuenta.length === 0) return resultado;

	const { data, error } = await client
		.from('cobros')
		.select('id_cobro, id_cuenta_cobrar, monto, fecha_cobro, panorama_id, panorama_orden')
		.in('id_cuenta_cobrar', idsCuenta)
		.eq('estado_cobro', 'programado')
		.order('fecha_cobro', { ascending: true });
	if (error) throw error;

	const porCuenta = new Map<number, any[]>();
	for (const fila of data ?? []) {
		const lista = porCuenta.get(fila.id_cuenta_cobrar) ?? [];
		lista.push(fila);
		porCuenta.set(fila.id_cuenta_cobrar, lista);
	}

	for (const [idCuenta, filas] of porCuenta) {
		if (filas.length < 2) continue;
		resultado.set(
			idCuenta,
			filas.map((f, i) => ({
				id: f.id_cobro,
				idCuenta: f.id_cuenta_cobrar,
				numeroCuota: i + 1,
				totalCuotas: filas.length,
				monto: Number(f.monto),
				fecha: f.fecha_cobro,
				panoramaId: f.panorama_id,
				panoramaOrden: f.panorama_orden
			}))
		);
	}
	return resultado;
}

async function cuentasCobrarConFracciones(client: SupabaseClient): Promise<{ cuentas: any[]; fracciones: Map<number, FraccionPanorama[]> }> {
	const { data, error } = await client
		.from('cuentas_cobrar')
		.select(SELECT_COBRO_CON_JOINS)
		.in('estado', ['pendiente', 'vencido'])
		.order('fecha_vencimiento', { ascending: true, nullsFirst: false });
	if (error) throw error;

	const cuentas = (data ?? []) as any[];
	const fracciones = await fraccionesCobroPorCuenta(client, cuentas.map((c) => c.id_cuenta_cobrar));
	return { cuentas, fracciones };
}

/** Cuentas por cobrar con saldo pendiente SIN panorama asignado (la "bandeja" del tablero de
 * cobro), paginada/buscable/ordenable — contraparte de getPagosPendientes, mismo criterio de
 * clustering por fraccionamiento. */
export async function getCobrosPendientes(
	client: SupabaseClient,
	params: BandejaParams & { idCliente?: number | null } = {}
): Promise<BandejaResult<IngresoPendienteItem>> {
	const { cuentas, fracciones } = await cuentasCobrarConFracciones(client);

	let items: IngresoPendienteItem[] = [];
	for (const row of cuentas) {
		const propias = fracciones.get(row.id_cuenta_cobrar);
		if (propias) {
			const sinAsignar = propias.filter((f) => f.panoramaId === null);
			if (sinAsignar.length === 0) continue;
			items.push(mapCobroRow(row, sinAsignar));
		} else {
			if (row.panorama_id !== null) continue;
			items.push(mapCobroRow(row, []));
		}
	}

	if (params.idProyecto) items = items.filter((i) => i.idProyecto === params.idProyecto);
	if (params.idCliente) items = items.filter((i) => i.idCliente === params.idCliente);
	if (params.prioridad) items = items.filter((i) => i.prioridad === params.prioridad);
	if (params.estado) items = items.filter((i) => (params.estado === 'vencido' ? computeEstadoVencimiento(i.fechaVencimiento) === 'vencido' : computeEstadoVencimiento(i.fechaVencimiento) === 'por_vencer'));

	return paginarBandeja(items, params, (i) => `${i.titulo} ${i.clienteNombre} ${i.proyectoNombre ?? ''}`);
}

/** Cobros ya asignados a un panorama — contraparte de getPanoramaItems. */
export async function getPanoramaItemsCobro(client: SupabaseClient, panoramaId: PanoramaId): Promise<IngresoPendienteItem[]> {
	const { cuentas, fracciones } = await cuentasCobrarConFracciones(client);

	const items: IngresoPendienteItem[] = [];
	for (const row of cuentas) {
		const propias = fracciones.get(row.id_cuenta_cobrar);
		if (propias) {
			const enEstaColumna = propias.filter((f) => f.panoramaId === panoramaId).sort((a, b) => (a.panoramaOrden ?? 0) - (b.panoramaOrden ?? 0));
			if (enEstaColumna.length === 0) continue;
			items.push(mapCobroRow(row, enEstaColumna));
		} else {
			if (row.panorama_id !== panoramaId) continue;
			items.push(mapCobroRow(row, []));
		}
	}
	items.sort((a, b) => (a.panoramaOrden ?? Infinity) - (b.panoramaOrden ?? Infinity));
	return items;
}

/** TODAS las cuentas por cobrar pendientes/vencidas, sin filtrar por panorama_id — contraparte de
 * getTodasLasCuentasPendientes, fuente del calendario "Panorama Actual" (id 0) del lado Cobro. */
export async function getTodasLasCuentasPorCobrarPendientes(client: SupabaseClient): Promise<IngresoPendienteItem[]> {
	const { cuentas, fracciones } = await cuentasCobrarConFracciones(client);
	return cuentas.map((row) => mapCobroRow(row, fracciones.get(row.id_cuenta_cobrar) ?? []));
}

/** Asigna una cuenta por cobrar SIMPLE (no fraccionada) a un panorama — contraparte de assignToPanorama. */
export async function assignToPanoramaCobro(
	client: SupabaseClient,
	idCuentaCobrar: number,
	panoramaId: PanoramaId | null,
	orden: number | null
): Promise<{ success: boolean; message: string }> {
	const { error } = await client
		.from('cuentas_cobrar')
		.update({ panorama_id: panoramaId, panorama_orden: orden })
		.eq('id_cuenta_cobrar', idCuentaCobrar);

	if (error) return { success: false, message: `No se pudo mover el cobro: ${error.message}` };
	return { success: true, message: 'Cobro movido correctamente' };
}

/** Contraparte de assignFraccionesToPanorama, sobre "cobros". */
export async function assignFraccionesToPanoramaCobro(
	client: SupabaseClient,
	idsFraccion: number[],
	panoramaId: PanoramaId | null,
	orden: number | null
): Promise<{ success: boolean; message: string }> {
	const results = await Promise.all(idsFraccion.map((id) => client.from('cobros').update({ panorama_id: panoramaId, panorama_orden: orden }).eq('id_cobro', id)));
	const failed = results.find((r) => r.error);
	if (failed?.error) return { success: false, message: `No se pudo mover la cuota: ${failed.error.message}` };
	return { success: true, message: idsFraccion.length > 1 ? 'Cuotas movidas correctamente' : 'Cuota movida correctamente' };
}

/** Contraparte de reorderPanorama, sobre cuentas_cobrar/cobros. */
export async function reorderPanoramaCobro(client: SupabaseClient, panoramaId: PanoramaId | null, entradas: PanoramaEntry[]): Promise<{ success: boolean; message: string }> {
	const ops: PromiseLike<{ error: any }>[] = [];
	entradas.forEach((entrada, index) => {
		if (entrada.tipo === 'cuenta') {
			ops.push(client.from('cuentas_cobrar').update({ panorama_id: panoramaId, panorama_orden: index }).eq('id_cuenta_cobrar', entrada.id));
		} else {
			for (const idCobro of entrada.idsFraccion) {
				ops.push(client.from('cobros').update({ panorama_id: panoramaId, panorama_orden: index }).eq('id_cobro', idCobro));
			}
		}
	});
	const results = await Promise.all(ops);
	const failed = results.find((r) => r.error);
	if (failed?.error) return { success: false, message: `No se pudo reordenar: ${failed.error.message}` };
	return { success: true, message: 'Orden actualizado' };
}

/** Contraparte de reorderFracciones, sobre "cobros". */
export async function reorderFraccionesCobro(client: SupabaseClient, panoramaId: PanoramaId | null, idsFraccion: number[]): Promise<{ success: boolean; message: string }> {
	const results = await Promise.all(idsFraccion.map((id, index) => client.from('cobros').update({ panorama_id: panoramaId, panorama_orden: index }).eq('id_cobro', id)));
	const failed = results.find((r) => r.error);
	if (failed?.error) return { success: false, message: `No se pudo reordenar la cuota: ${failed.error.message}` };
	return { success: true, message: 'Orden actualizado' };
}

/** Contraparte de moverFraccionAPanorama, sobre "cobros". */
export async function moverFraccionAPanoramaCobro(client: SupabaseClient, idCobro: number, panoramaId: PanoramaId | null): Promise<{ success: boolean; message: string }> {
	const { error } = await client.from('cobros').update({ panorama_id: panoramaId }).eq('id_cobro', idCobro);
	if (error) return { success: false, message: `No se pudo mover la cuota: ${error.message}` };
	return { success: true, message: 'Cuota movida correctamente' };
}

/** Suma saldo_pendiente de cuentas_pagar (pendiente + vencido) — inverso de getProyeccionIngresos, para
 * poder mostrar "Cobertura" (caja disponible ÷ compromisos de pago) en el tablero de cobro. Si se pasan
 * `desde`/`hasta`, solo cuenta los pagos cuya fecha_vencimiento cae en ese rango — así "Cobertura" compara
 * el mismo período en ambos lados (caja+cobros DEL MES ÷ pagos QUE VENCEN ESE MISMO MES), en vez de
 * comparar la caja de un mes contra TODA la deuda pendiente sin importar cuándo vence (lo que hacía que
 * el indicador se viera artificialmente peor de lo que es en la práctica). */
export async function getProyeccionPagos(client: SupabaseClient, desde?: string, hasta?: string): Promise<number> {
	let query = client.from('cuentas_pagar').select('saldo_pendiente').in('estado', ['pendiente', 'vencido']);
	if (desde) query = query.gte('fecha_vencimiento', desde);
	if (hasta) query = query.lte('fecha_vencimiento', hasta);
	const { data, error } = await query;
	if (error) throw error;
	return (data ?? []).reduce((sum: number, r: any) => sum + Number(r.saldo_pendiente), 0);
}

/**
 * Suma de transacciones REALES tipo 'ingreso' registradas hacia el centro de costo de CUALQUIER
 * proyecto (excluye cliente/proveedor/empleado/manual), con `fecha` dentro del rango [desde, hasta] —
 * a pedido explícito del usuario: "Cobrado del mes" debe reflejar la plata efectivamente recibida vía
 * transacciones por cada proyecto, no `cobros.monto` (un total aparte llevado por los cobros puntuales
 * registrados a mano en cada cuenta, que puede desalinearse — mismo criterio ya aplicado en "Saldo
 * Pendiente" de CuentaCobrarModal.svelte, que usa getMontoRecibidoPorCentroCosto).
 *
 * En dos pasos porque `transaccion.id_centro_costo_destino` no tiene FK real hacia `centro_costo` (ver
 * nota en aprobaciones.service.ts) — no se puede pedir el embed directo vía PostgREST, hay que resolver
 * primero los ids de los centros de proyecto y luego filtrar transacciones por esos ids.
 */
export async function getCobradoEnRango(client: SupabaseClient, desde: string, hasta: string): Promise<number> {
	const { data: centros, error: errorCentros } = await client.from('centro_costo').select('id_centro_costo').not('id_proyecto', 'is', null);
	if (errorCentros) throw errorCentros;
	const idsCentrosProyecto = (centros ?? []).map((c: any) => c.id_centro_costo);
	if (idsCentrosProyecto.length === 0) return 0;

	const { data, error } = await client
		.from('transaccion')
		.select('monto_total')
		.eq('tipo', 'ingreso')
		.eq('estado', 'activo')
		.in('id_centro_costo_destino', idsCentrosProyecto)
		.gte('fecha', desde)
		.lte('fecha', hasta);
	if (error) throw error;
	return (data ?? []).reduce((sum: number, r: any) => sum + Number(r.monto_total ?? 0), 0);
}

export interface ResumenCobros {
	totalPendiente: number;
	vencidoTotal: number;
	vencidoCount: number;
	clientesConVentas: number;
}

/** Agregados para la tarjeta "Resumen general" del tablero de cobro — sobre TODAS las cuentas
 * pendientes/vencidas, sin importar en qué panorama (o bandeja) estén ubicadas. */
export async function getResumenCobros(client: SupabaseClient): Promise<ResumenCobros> {
	const { data, error } = await client.from('cuentas_cobrar').select('saldo_pendiente, estado, id_cliente').in('estado', ['pendiente', 'vencido']);
	if (error) throw error;

	const rows = (data ?? []) as any[];
	const totalPendiente = rows.reduce((sum, r) => sum + Number(r.saldo_pendiente), 0);
	const vencidos = rows.filter((r) => r.estado === 'vencido');
	const vencidoTotal = vencidos.reduce((sum, r) => sum + Number(r.saldo_pendiente), 0);
	const clientesConVentas = new Set(rows.map((r) => r.id_cliente)).size;

	return { totalPendiente, vencidoTotal, vencidoCount: vencidos.length, clientesConVentas };
}

/** Suma de pagos reales (estado_pago='pagado') con fecha_pago dentro del rango [desde, hasta] —
 * inverso de getCobradoEnRango, para el KPI "Pagado del mes" del tablero de Panoramas de Pago. */
export async function getPagadoEnRango(client: SupabaseClient, desde: string, hasta: string): Promise<number> {
	const { data, error } = await client.from('pagos').select('monto').eq('estado_pago', 'pagado').gte('fecha_pago', desde).lte('fecha_pago', hasta);
	if (error) throw error;
	return (data ?? []).reduce((sum: number, r: any) => sum + Number(r.monto), 0);
}

export interface ResumenPagos {
	totalPendiente: number;
	vencidoTotal: number;
	vencidoCount: number;
	proveedoresConCompras: number;
}

/** Agregados para "Resumen general" del tablero de Panoramas de Pago — sobre TODAS las cuentas por
 * pagar pendientes/vencidas, sin importar en qué panorama (o bandeja) estén ubicadas. Inverso de
 * getResumenCobros.
 *
 * `vencidoTotal` NO es el saldo completo de las cuentas marcadas 'vencido' (esa cuenta puede tener
 * cuotas futuras que todavía no vencen) — a pedido del usuario, es la suma de los MONTOS de las
 * cuotas ('pagos' con estado_pago='programado') cuya fecha programada ya pasó. Cuentas sin ninguna
 * cuota registrada todavía (fraccionadas o no) usan su propio saldo_pendiente contra
 * fecha_pago_programada/fecha_vencimiento, mismo criterio que computeEstadoCuentaPagar. `vencidoCount`
 * sigue siendo cuentas (documentos) distintas con al menos una cuota vencida, no el conteo de cuotas. */
export async function getResumenPagos(client: SupabaseClient): Promise<ResumenPagos> {
	const { data, error } = await client
		.from('cuentas_pagar')
		.select('id_cuenta_pagar, saldo_pendiente, estado, fecha_vencimiento, fecha_pago_programada, id_proveedor')
		.in('estado', ['pendiente', 'vencido']);
	if (error) throw error;

	const rows = (data ?? []) as any[];
	const totalPendiente = rows.reduce((sum, r) => sum + Number(r.saldo_pendiente), 0);
	const proveedoresConCompras = new Set(rows.map((r) => r.id_proveedor)).size;

	const hoy = new Date();
	hoy.setHours(0, 0, 0, 0);
	const yaVencio = (fecha: string | null) => {
		if (!fecha) return false;
		const d = new Date(fecha);
		return !Number.isNaN(d.getTime()) && d.getTime() < hoy.getTime();
	};

	const ids = rows.map((r) => r.id_cuenta_pagar);
	const { data: pagos } =
		ids.length > 0
			? await client.from('pagos').select('id_cuenta_pagar, monto, fecha_pago').in('id_cuenta_pagar', ids).eq('estado_pago', 'programado')
			: { data: [] as any[] };

	const pagosPorCuenta = new Map<number, any[]>();
	for (const p of (pagos ?? []) as any[]) {
		const lista = pagosPorCuenta.get(p.id_cuenta_pagar) ?? [];
		lista.push(p);
		pagosPorCuenta.set(p.id_cuenta_pagar, lista);
	}

	let vencidoTotal = 0;
	const cuentasVencidas = new Set<number>();
	for (const r of rows) {
		const propios = pagosPorCuenta.get(r.id_cuenta_pagar) ?? [];
		if (propios.length > 0) {
			for (const p of propios) {
				if (yaVencio(p.fecha_pago)) {
					vencidoTotal += Number(p.monto);
					cuentasVencidas.add(r.id_cuenta_pagar);
				}
			}
		} else if (yaVencio(r.fecha_pago_programada ?? r.fecha_vencimiento)) {
			vencidoTotal += Number(r.saldo_pendiente);
			cuentasVencidas.add(r.id_cuenta_pagar);
		}
	}

	return { totalPendiente, vencidoTotal, vencidoCount: cuentasVencidas.size, proveedoresConCompras };
}

/** Reprograma fecha_vencimiento de una o más cuentas por cobrar (drag-and-drop en la vista Calendario
 * de Panoramas de Cobro) — inverso de actualizarFechasVencimientoPago. */
export async function actualizarFechasVencimientoCobro(
	client: SupabaseClient,
	cambios: { id: number; fecha: string }[]
): Promise<{ success: boolean; message: string }> {
	const results = await Promise.all(cambios.map((c) => client.from('cuentas_cobrar').update({ fecha_vencimiento: c.fecha }).eq('id_cuenta_cobrar', c.id)));
	const failed = results.find((r) => r.error);
	if (failed?.error) return { success: false, message: `No se pudieron actualizar las fechas: ${failed.error.message}` };
	return { success: true, message: 'Fechas actualizadas' };
}
