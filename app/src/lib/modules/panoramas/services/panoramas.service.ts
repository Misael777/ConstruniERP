/**
 * Servicio de acceso a datos para el tablero de "Panoramas de Pago" (planeación de flujo de caja).
 *
 * Reutiliza la tabla cuentas_pagar existente (no se creó una tabla de "ítems" nueva, por decisión
 * explícita): cada tarjeta de la bandeja/panorama ES una fila de cuentas_pagar. Se le agregaron dos
 * columnas nuevas:
 *   ALTER TABLE cuentas_pagar ADD COLUMN panorama_id SMALLINT NULL;      -- 1, 2, o NULL = en bandeja
 *   ALTER TABLE cuentas_pagar ADD COLUMN panorama_orden INTEGER NULL;   -- posición al arrastrar/reordenar
 *
 * Hay exactamente 2 panoramas fijos (no CRUD de panoramas, por decisión explícita) — sus nombres
 * ("Panorama 1"/"Panorama 2") y subtítulos están hardcodeados en el +page.svelte, no en la BD.
 *
 * "Prioridad" (Alta/Media/Baja) y "Vencido/Por vencer" NO son columnas de la BD — se calculan al
 * vuelo desde fecha_vencimiento (ver computePrioridad/computeEstadoVencimiento más abajo), porque
 * no existe ese campo en el esquema real. Los umbrales (7/15 días) son un criterio razonable por
 * defecto, AJUSTAR si el ERP define otra regla.
 *
 * "Proyección de ingresos" tampoco tiene tabla propia: se decidió sumar el saldo_pendiente de
 * cuentas_cobrar (pendiente + vencido) — es el mismo número para ambos panoramas, ya que hoy no
 * hay forma de asociar cobros a un panorama específico.
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

export interface PagoPendienteItem {
	/** Alias de id_cuenta_pagar: svelte-dnd-action exige que cada ítem tenga una propiedad `id`. */
	id: number;
	id_cuenta_pagar: number;
	titulo: string;
	proveedorNombre: string;
	monto: number;
	fechaVencimiento: string | null;
	idProyecto: number | null;
	panoramaId: number | null;
	panoramaOrden: number | null;
	prioridad: Prioridad;
	/** monto_comprometido (monto total de la cuenta, no el saldo) y fecha_emision — ya venían en el
	 * `select('*')` de abajo, solo no se exponían. Se agregan para que el popup de cuotas (ver
	 * abrirCuotasDe en +page.svelte) pueda abrir SIN una consulta extra a cuentas_pagar. */
	montoTotal: number;
	fechaEmision: string;
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

const SELECT_CON_JOINS = '*, proveedor(razon_social), presupuesto(id_proyecto, proyecto(nombre_proyecto))';

function mapRow(row: any): PagoPendienteItem {
	return {
		id: row.id_cuenta_pagar,
		id_cuenta_pagar: row.id_cuenta_pagar,
		titulo: row.observacion || row.num_documento || row.responsable || 'Pago sin descripción',
		proveedorNombre: row.proveedor?.razon_social ?? 'Sin proveedor',
		monto: Number(row.monto_comprometido),
		fechaVencimiento: row.fecha_vencimiento,
		idProyecto: row.presupuesto?.id_proyecto ?? null,
		panoramaId: row.panorama_id,
		panoramaOrden: row.panorama_orden,
		prioridad: (row.prioridad as Prioridad) || computePrioridad(row.fecha_vencimiento),
		montoTotal: Number(row.monto_comprometido),
		fechaEmision: row.fecha_emision
	};
}

/** Pagos pendientes SIN panorama asignado todavía (la "bandeja"). Incluye 'vencido' además de
 * 'pendiente' (antes solo traía 'pendiente') — un pago vencido es justo el que más urge planear. */
export async function getPagosPendientes(
	client: SupabaseClient,
	filters: { idProyecto?: number | null; prioridad?: Prioridad | null } = {}
): Promise<PagoPendienteItem[]> {
	let query = client
		.from('cuentas_pagar')
		.select(SELECT_CON_JOINS)
		.in('estado', ['pendiente', 'vencido'])
		.is('panorama_id', null)
		.order('fecha_vencimiento', { ascending: true, nullsFirst: false });

	const { data, error } = await query;
	if (error) throw error;

	let items = (data ?? []).map(mapRow);
	if (filters.idProyecto) items = items.filter((i) => i.idProyecto === filters.idProyecto);
	if (filters.prioridad) items = items.filter((i) => i.prioridad === filters.prioridad);
	return items;
}

/** Pagos ya asignados a un panorama, ordenados por su posición (panorama_orden). */
export async function getPanoramaItems(client: SupabaseClient, panoramaId: PanoramaId): Promise<PagoPendienteItem[]> {
	const { data, error } = await client
		.from('cuentas_pagar')
		.select(SELECT_CON_JOINS)
		.eq('panorama_id', panoramaId)
		.order('panorama_orden', { ascending: true, nullsFirst: false });

	if (error) throw error;
	return (data ?? []).map(mapRow);
}

/** Asigna un pago a un panorama (o lo regresa a la bandeja si panoramaId es null), en la posición dada. */
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

/** Reescribe panorama_orden para toda una columna tras arrastrar-reordenar (1 update por fila). */
export async function reorderPanorama(
	client: SupabaseClient,
	panoramaId: PanoramaId,
	orderedIds: number[]
): Promise<{ success: boolean; message: string }> {
	const results = await Promise.all(
		orderedIds.map((id, index) =>
			client.from('cuentas_pagar').update({ panorama_id: panoramaId, panorama_orden: index }).eq('id_cuenta_pagar', id)
		)
	);
	const failed = results.find((r) => r.error);
	if (failed?.error) return { success: false, message: `No se pudo reordenar: ${failed.error.message}` };
	return { success: true, message: 'Orden actualizado' };
}

/** Suma saldo_pendiente de cuentas_cobrar (pendiente + vencido) — ver nota de "Proyección de ingresos"
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

/** Reprograma fecha_vencimiento de una o más cuentas por pagar (drag-and-drop en la vista Calendario
 * de Panoramas de Pago) — 1 update por fila, igual patrón que reorderPanorama. */
export async function actualizarFechasVencimientoPago(
	client: SupabaseClient,
	cambios: { id: number; fecha: string }[]
): Promise<{ success: boolean; message: string }> {
	const results = await Promise.all(cambios.map((c) => client.from('cuentas_pagar').update({ fecha_vencimiento: c.fecha }).eq('id_cuenta_pagar', c.id)));
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
 * Lado "Panoramas de Cobro" (cuentas_cobrar) — contraparte de todo lo de arriba, mismo patrón:
 * bandeja/panoramas 100% de sesión (no se persiste `panorama_id`/`panorama_orden`, no se agregaron
 * esas columnas a cuentas_cobrar todavía — si más adelante se decide persistir esto, replicar la
 * migración que ya existe en cuentas_pagar).
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
	fechaVencimiento: string | null;
	idProyecto: number | null;
	idCliente: number | null;
	prioridad: PrioridadCobro;
	/** monto (total de la cuenta, no el saldo_pendiente de arriba) y fecha_emision — ya venían en el
	 * `select('*')` de abajo, solo no se exponían. Se agregan para que el popup de cuotas (ver
	 * abrirCuotasDe en +page.svelte) pueda abrir SIN una consulta extra a cuentas_cobrar. */
	montoTotal: number;
	fechaEmision: string;
}

const SELECT_COBRO_CON_JOINS = '*, cliente(nombre), proyecto(nombre_proyecto)';

function mapCobroRow(row: any): IngresoPendienteItem {
	return {
		id: row.id_cuenta_cobrar,
		id_cuenta_cobrar: row.id_cuenta_cobrar,
		titulo: row.num_documento || row.observaciones || row.responsable || 'Cuenta por cobrar sin descripción',
		clienteNombre: row.cliente?.nombre ?? 'Sin cliente',
		proyectoNombre: row.proyecto?.nombre_proyecto ?? null,
		monto: Number(row.saldo_pendiente),
		fechaVencimiento: row.fecha_vencimiento,
		idProyecto: row.id_proyecto,
		idCliente: row.id_cliente,
		prioridad: (row.prioridad as PrioridadCobro) || prioridadCobroPorDefecto(row.fecha_vencimiento),
		montoTotal: Number(row.monto),
		fechaEmision: row.fecha_emision
	};
}

/** Cuentas por cobrar con saldo pendiente (pendiente + vencido) — la "bandeja" del tablero de cobro. */
export async function getCobrosPendientes(
	client: SupabaseClient,
	filters: { idProyecto?: number | null; idCliente?: number | null; prioridad?: PrioridadCobro | null; estado?: 'pendiente' | 'vencido' | null } = {}
): Promise<IngresoPendienteItem[]> {
	let query = client
		.from('cuentas_cobrar')
		.select(SELECT_COBRO_CON_JOINS)
		.in('estado', ['pendiente', 'vencido'])
		.order('fecha_vencimiento', { ascending: true, nullsFirst: false });

	const { data, error } = await query;
	if (error) throw error;

	let items = (data ?? []).map(mapCobroRow);
	if (filters.idProyecto) items = items.filter((i) => i.idProyecto === filters.idProyecto);
	if (filters.idCliente) items = items.filter((i) => i.idCliente === filters.idCliente);
	if (filters.prioridad) items = items.filter((i) => i.prioridad === filters.prioridad);
	if (filters.estado) items = items.filter((i) => (filters.estado === 'vencido' ? computeEstadoVencimiento(i.fechaVencimiento) === 'vencido' : computeEstadoVencimiento(i.fechaVencimiento) === 'por_vencer'));
	return items;
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

/** Suma de cobros reales (estado_cobro='cobrado') con fecha_cobro dentro del rango [desde, hasta]. */
export async function getCobradoEnRango(client: SupabaseClient, desde: string, hasta: string): Promise<number> {
	const { data, error } = await client.from('cobros').select('monto').eq('estado_cobro', 'cobrado').gte('fecha_cobro', desde).lte('fecha_cobro', hasta);
	if (error) throw error;
	return (data ?? []).reduce((sum: number, r: any) => sum + Number(r.monto), 0);
}

export interface ResumenCobros {
	totalPendiente: number;
	vencidoTotal: number;
	vencidoCount: number;
	clientesConVentas: number;
}

/** Agregados para la tarjeta "Resumen general" del tablero de cobro — sobre TODAS las cuentas
 * pendientes/vencidas, sin importar en qué panorama (o bandeja) estén ubicadas en esta sesión. */
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
 * pagar pendientes/vencidas, sin importar en qué panorama (o bandeja) estén ubicadas en esta sesión.
 * Inverso de getResumenCobros. */
export async function getResumenPagos(client: SupabaseClient): Promise<ResumenPagos> {
	const { data, error } = await client.from('cuentas_pagar').select('saldo_pendiente, estado, id_proveedor').in('estado', ['pendiente', 'vencido']);
	if (error) throw error;

	const rows = (data ?? []) as any[];
	const totalPendiente = rows.reduce((sum, r) => sum + Number(r.saldo_pendiente), 0);
	const vencidos = rows.filter((r) => r.estado === 'vencido');
	const vencidoTotal = vencidos.reduce((sum, r) => sum + Number(r.saldo_pendiente), 0);
	const proveedoresConCompras = new Set(rows.map((r) => r.id_proveedor)).size;

	return { totalPendiente, vencidoTotal, vencidoCount: vencidos.length, proveedoresConCompras };
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
