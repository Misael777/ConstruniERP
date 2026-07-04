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

export type Prioridad = 'alta' | 'media' | 'baja';
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

/** Heurística por defecto: sin fecha o >15 días = baja, 8-15 días = media, ≤7 días o vencido = alta. AJUSTAR umbrales si se necesita otra regla. */
export function computePrioridad(fechaVencimiento: string | null): Prioridad {
	const dias = diasHastaVencimiento(fechaVencimiento);
	if (dias === null) return 'baja';
	if (dias <= 7) return 'alta';
	if (dias <= 15) return 'media';
	return 'baja';
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
		panoramaOrden: row.panorama_orden
	};
}

/** Pagos pendientes SIN panorama asignado todavía (la "bandeja"). */
export async function getPagosPendientes(
	client: SupabaseClient,
	filters: { idProyecto?: number | null; prioridad?: Prioridad | null } = {}
): Promise<PagoPendienteItem[]> {
	let query = client
		.from('cuentas_pagar')
		.select(SELECT_CON_JOINS)
		.eq('estado', 'pendiente')
		.is('panorama_id', null)
		.order('fecha_vencimiento', { ascending: true, nullsFirst: false });

	const { data, error } = await query;
	if (error) throw error;

	let items = (data ?? []).map(mapRow);
	if (filters.idProyecto) items = items.filter((i) => i.idProyecto === filters.idProyecto);
	if (filters.prioridad) items = items.filter((i) => computePrioridad(i.fechaVencimiento) === filters.prioridad);
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

/** Suma saldo_pendiente de cuentas_cobrar (pendiente + vencido) — ver nota de "Proyección de ingresos" arriba. */
export async function getProyeccionIngresos(client: SupabaseClient): Promise<number> {
	const { data, error } = await client.from('cuentas_cobrar').select('saldo_pendiente').in('estado', ['pendiente', 'vencido']);
	if (error) throw error;
	return (data ?? []).reduce((sum: number, r: any) => sum + Number(r.saldo_pendiente), 0);
}

export async function getProyectoOptions(client: SupabaseClient): Promise<FieldOption[]> {
	const { data, error } = await client.from('proyecto').select('id_proyecto, nombre_proyecto').order('nombre_proyecto');
	if (error) throw error;
	return (data ?? []).map((p: any) => ({ value: String(p.id_proyecto), label: p.nombre_proyecto }));
}
