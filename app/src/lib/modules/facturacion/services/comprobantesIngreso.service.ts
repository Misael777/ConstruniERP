/**
 * Repositorio de comprobantes de INGRESO (Factura, Boleta, Nota de Crédito, Nota de Débito) — sección de
 * "Emisión de Comprobante" (a pedido del usuario, con imagen de referencia). Se suben los comprobantes
 * reales (PDF, foto o XML de SUNAT), se leen con OCR + regex o del XML (ver lectorComprobante.ts), quedan
 * vinculados a una o varias transacciones de ingreso y un administrador los marca Revisado u Observado.
 * Distinto de la tabla `factura` (comprobantes INTERNOS que genera el propio ERP, ver facturacion.service.ts).
 * Tablas: comprobante_ingreso + comprobante_ingreso_transaccion (migración 20260930032337).
 * Recibe el SupabaseClient como parámetro; corre client-side igual en web, Tauri Windows y Tauri Android.
 * La subida del archivo a Drive la hace el componente (uploadProjectDocument) antes de crear el registro.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { EMPRESA_RUC } from '$lib/shared/empresaConstantes';
import { getTransaccionesPorIds, getClientesParaFacturar, type TransaccionFacturable } from './facturacion.service';
import type { TipoComprobanteIngreso, DatosComprobanteLeido } from './lectorComprobante';

export type EstadoComprobanteIngreso = 'pendiente' | 'revisado' | 'observado';
export type ArchivoTipoComprobante = 'pdf' | 'imagen' | 'xml';
export type FuenteDatosComprobante = 'ocr' | 'xml' | 'manual';

export const NOMBRE_TIPO_COMPROBANTE_INGRESO: Record<TipoComprobanteIngreso, string> = {
	factura: 'Factura',
	boleta: 'Boleta',
	nota_credito: 'Nota de Crédito',
	nota_debito: 'Nota de Débito'
};

export interface ComprobanteIngreso {
	id_comprobante: number;
	tipo: TipoComprobanteIngreso;
	serie: string | null;
	numero: string | null;
	fecha_emision: string | null;
	ruc_emisor: string | null;
	razon_social_emisor: string | null;
	doc_receptor: string | null;
	nombre_receptor: string | null;
	id_cliente: number | null;
	moneda: 'PEN' | 'USD';
	subtotal: number | null;
	igv: number | null;
	total: number | null;
	id_comprobante_referencia: number | null;
	estado: EstadoComprobanteIngreso;
	motivo_observacion: string | null;
	revisado_por: string | null;
	revisado_en: string | null;
	archivo_url: string;
	archivo_nombre: string | null;
	archivo_tipo: ArchivoTipoComprobante;
	fuente_datos: FuenteDatosComprobante;
	texto_ocr: string | null;
	activo: boolean;
	usuario_registro: string | null;
	created_at: string;
	updated_at: string;
	cliente?: { nombre: string } | null;
	/** N° de transacciones de ingreso vinculadas (solo en la lista). */
	cantidadTransacciones?: number;
}

export interface ComprobanteIngresoDetalle extends ComprobanteIngreso {
	transacciones: TransaccionFacturable[];
	/** "F001-00000245" del comprobante que corrige (solo NC/ND). */
	referenciaSerieNumero: string | null;
}

export interface ServiceResult<T = undefined> {
	success: boolean;
	message: string;
	data?: T;
}

/** "F001-00000245" (o "—" si falta la serie o el número). */
export function serieNumero(c: Pick<ComprobanteIngreso, 'serie' | 'numero'>): string {
	return c.serie && c.numero ? `${c.serie}-${c.numero}` : '—';
}

/** Avisos automáticos sobre los datos leídos — se muestran al revisar, no bloquean el guardado. */
export function advertenciasComprobante(c: Partial<ComprobanteIngreso>): string[] {
	const avisos: string[] = [];
	if (c.ruc_emisor && c.ruc_emisor !== EMPRESA_RUC) avisos.push(`El RUC emisor (${c.ruc_emisor}) no es el de la empresa (${EMPRESA_RUC}).`);
	if (c.subtotal != null && c.igv != null && c.total != null && Math.abs(c.subtotal + c.igv - c.total) > 0.05) {
		avisos.push('Subtotal + IGV no coincide con el Total.');
	}
	if ((c.tipo === 'nota_credito' || c.tipo === 'nota_debito') && !c.id_comprobante_referencia) avisos.push('Falta indicar el comprobante que modifica.');
	return avisos;
}

// ── Lectura ─────────────────────────────────────────────────────────────────────────────────────

export interface ListParams {
	page?: number;
	pageSize?: number;
	search?: string;
	tipo?: TipoComprobanteIngreso | null;
	estado?: EstadoComprobanteIngreso | null;
	soloEliminados?: boolean;
}

export async function getComprobantesIngreso(
	client: SupabaseClient,
	params: ListParams = {}
): Promise<{ items: ComprobanteIngreso[]; total: number; totalPages: number }> {
	const page = Math.max(1, params.page ?? 1);
	const pageSize = Math.max(1, params.pageSize ?? 10);
	const from = (page - 1) * pageSize;

	let query = client
		.from('comprobante_ingreso')
		.select('*, cliente(nombre), relaciones:comprobante_ingreso_transaccion(count)', { count: 'exact' })
		.eq('activo', !params.soloEliminados)
		.order('created_at', { ascending: false })
		.range(from, from + pageSize - 1);
	if (params.tipo) query = query.eq('tipo', params.tipo);
	if (params.estado) query = query.eq('estado', params.estado);
	const search = params.search?.trim();
	if (search) {
		const s = search.replace(/[%_,()]/g, ' ');
		query = query.or(`serie.ilike.%${s}%,numero.ilike.%${s}%,nombre_receptor.ilike.%${s}%,doc_receptor.ilike.%${s}%,archivo_nombre.ilike.%${s}%`);
	}

	const { data, error, count } = await query;
	if (error) throw error;
	const items = ((data ?? []) as any[]).map((r) => ({ ...r, cantidadTransacciones: r.relaciones?.[0]?.count ?? 0 })) as ComprobanteIngreso[];
	const total = count ?? 0;
	return { items, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export interface KpisComprobantesIngreso {
	total: number;
	revisados: number;
	pendientes: number;
	observados: number;
	/** Variación % de comprobantes subidos este mes frente al mes anterior (null sin datos del mes anterior). */
	variacionMes: number | null;
}

function inicioDeMes(desplazamiento = 0): string {
	const hoy = new Date();
	return new Date(hoy.getFullYear(), hoy.getMonth() + desplazamiento, 1).toISOString();
}

export async function getKpisComprobantesIngreso(client: SupabaseClient): Promise<KpisComprobantesIngreso> {
	const contar = async (filtro: (q: any) => any) => {
		const { count, error } = await filtro(client.from('comprobante_ingreso').select('id_comprobante', { count: 'exact', head: true }).eq('activo', true));
		if (error) throw error;
		return count ?? 0;
	};
	const [total, revisados, pendientes, observados, esteMes, mesAnterior] = await Promise.all([
		contar((q) => q),
		contar((q) => q.eq('estado', 'revisado')),
		contar((q) => q.eq('estado', 'pendiente')),
		contar((q) => q.eq('estado', 'observado')),
		contar((q) => q.gte('created_at', inicioDeMes(0))),
		contar((q) => q.gte('created_at', inicioDeMes(-1)).lt('created_at', inicioDeMes(0)))
	]);
	return { total, revisados, pendientes, observados, variacionMes: mesAnterior > 0 ? Math.round(((esteMes - mesAnterior) / mesAnterior) * 100) : null };
}

export interface EstadisticaTipoMes {
	tipo: TipoComprobanteIngreso;
	cantidad: number;
	monto: number;
}

/** Comprobantes del mes en curso por tipo (según fecha de emisión) — para "Estadísticas del mes". */
export async function getEstadisticasMes(client: SupabaseClient): Promise<EstadisticaTipoMes[]> {
	const hoy = new Date();
	const desde = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
	const { data, error } = await client.from('comprobante_ingreso').select('tipo, total').eq('activo', true).gte('fecha_emision', desde);
	if (error) throw error;
	const porTipo = new Map<TipoComprobanteIngreso, EstadisticaTipoMes>();
	for (const t of Object.keys(NOMBRE_TIPO_COMPROBANTE_INGRESO) as TipoComprobanteIngreso[]) porTipo.set(t, { tipo: t, cantidad: 0, monto: 0 });
	for (const r of (data ?? []) as { tipo: TipoComprobanteIngreso; total: number | null }[]) {
		const e = porTipo.get(r.tipo);
		if (!e) continue;
		e.cantidad += 1;
		// Una Nota de Crédito resta del monto del mes.
		e.monto += (r.tipo === 'nota_credito' ? -1 : 1) * Number(r.total ?? 0);
	}
	return [...porTipo.values()];
}

export async function getComprobanteIngresoDetalle(client: SupabaseClient, id: number): Promise<ComprobanteIngresoDetalle | null> {
	const { data, error } = await client.from('comprobante_ingreso').select('*, cliente(nombre)').eq('id_comprobante', id).maybeSingle();
	if (error) throw error;
	if (!data) return null;
	const { data: rel } = await client.from('comprobante_ingreso_transaccion').select('id_transaccion').eq('id_comprobante', id);
	const ids = ((rel ?? []) as { id_transaccion: number }[]).map((r) => r.id_transaccion);
	const transacciones = ids.length ? await getTransaccionesPorIds(client, ids) : [];
	let referenciaSerieNumero: string | null = null;
	if (data.id_comprobante_referencia) {
		const { data: ref } = await client.from('comprobante_ingreso').select('serie, numero').eq('id_comprobante', data.id_comprobante_referencia).maybeSingle();
		if (ref) referenciaSerieNumero = serieNumero(ref as any);
	}
	return { ...(data as ComprobanteIngreso), transacciones, referenciaSerieNumero };
}

/** Facturas/Boletas activas para elegir el "comprobante que modifica" de una NC/ND. */
export async function getComprobantesReferenciables(client: SupabaseClient): Promise<{ value: string; label: string }[]> {
	const { data, error } = await client
		.from('comprobante_ingreso')
		.select('id_comprobante, tipo, serie, numero, nombre_receptor, total')
		.eq('activo', true)
		.in('tipo', ['factura', 'boleta'])
		.order('fecha_emision', { ascending: false });
	if (error) throw error;
	return ((data ?? []) as any[]).map((c) => ({
		value: String(c.id_comprobante),
		label: `${serieNumero(c)} · ${c.nombre_receptor ?? 'Sin cliente'}`
	}));
}

/** Cliente del ERP cuyo RUC/DNI coincide con el receptor leído (para vincularlo solo). */
export async function buscarClientePorDocumento(client: SupabaseClient, documento: string | null): Promise<number | null> {
	const doc = documento?.replace(/\D/g, '');
	if (!doc) return null;
	const clientes = await getClientesParaFacturar(client);
	return clientes.find((c) => (c.num_documento ?? '').replace(/\D/g, '') === doc)?.id_cliente ?? null;
}

/** Comprobante (factura/boleta) por su "SERIE-NÚMERO" — para resolver la referencia leída de una NC/ND. */
export async function buscarComprobantePorSerieNumero(client: SupabaseClient, serieNumeroTexto: string | null): Promise<number | null> {
	const m = serieNumeroTexto?.toUpperCase().match(/^([A-Z0-9]{4})-(\d{1,8})$/);
	if (!m) return null;
	const { data } = await client
		.from('comprobante_ingreso')
		.select('id_comprobante')
		.eq('activo', true)
		.eq('serie', m[1])
		.eq('numero', m[2].padStart(8, '0'))
		.limit(1)
		.maybeSingle();
	return data?.id_comprobante ?? null;
}

// ── Escritura ───────────────────────────────────────────────────────────────────────────────────

/** Campos editables en "Información General". */
export type CambiosComprobante = Partial<
	Pick<
		ComprobanteIngreso,
		| 'tipo'
		| 'serie'
		| 'numero'
		| 'fecha_emision'
		| 'ruc_emisor'
		| 'razon_social_emisor'
		| 'doc_receptor'
		| 'nombre_receptor'
		| 'id_cliente'
		| 'moneda'
		| 'subtotal'
		| 'igv'
		| 'total'
		| 'id_comprobante_referencia'
	>
>;

export const MENSAJE_MIGRACION_FALTANTE =
	'El Repositorio de comprobantes todavía no está activado en la base de datos: falta aplicar la migración 20260930032337_comprobante_ingreso_repositorio.sql. Pídeselo al administrador del sistema.';

/** true si el error es "la tabla no existe" — Postgres lo reporta como 42P01 y la API de Supabase
 * (PostgREST) como PGRST205 ("Could not find the table ... in the schema cache"). */
export function esTablaFaltante(error: unknown): boolean {
	const e = error as { code?: string; message?: string } | null;
	return e?.code === '42P01' || e?.code === 'PGRST205' || /could not find the table/i.test(e?.message ?? '');
}

function mensajeError(error: { code?: string; message?: string }): string {
	if (error.code === '23505') return 'Ese comprobante (tipo, RUC emisor, serie y número) ya está registrado.';
	if (esTablaFaltante(error)) return MENSAJE_MIGRACION_FALTANTE;
	return error.message ?? 'Error inesperado.';
}

function normalizarCambios(c: CambiosComprobante): CambiosComprobante {
	const r: CambiosComprobante = { ...c };
	if (r.serie != null) r.serie = r.serie.trim().toUpperCase() || null;
	if (r.numero != null) r.numero = r.numero.replace(/\D/g, '') ? r.numero.replace(/\D/g, '').padStart(8, '0') : null;
	for (const k of ['ruc_emisor', 'doc_receptor'] as const) if (r[k] != null) r[k] = r[k]!.replace(/\D/g, '') || null;
	for (const k of ['razon_social_emisor', 'nombre_receptor'] as const) if (r[k] != null) r[k] = r[k]!.trim() || null;
	if (r.fecha_emision === '') r.fecha_emision = null;
	return r;
}

export interface NuevoComprobanteIngreso {
	datos: DatosComprobanteLeido & { id_cliente: number | null; id_comprobante_referencia: number | null };
	archivo_url: string;
	archivo_nombre: string;
	archivo_tipo: ArchivoTipoComprobante;
	fuente_datos: FuenteDatosComprobante;
	texto_ocr: string | null;
	idsTransacciones: number[];
	usuario: string | null;
}

export async function crearComprobanteIngreso(client: SupabaseClient, nuevo: NuevoComprobanteIngreso): Promise<ServiceResult<ComprobanteIngreso>> {
	const d = nuevo.datos;
	if (!d.tipo) return { success: false, message: 'Indica el tipo de comprobante (Factura, Boleta, Nota de Crédito o Nota de Débito).' };
	const fila = {
		...normalizarCambios({
			tipo: d.tipo,
			serie: d.serie,
			numero: d.numero,
			fecha_emision: d.fecha_emision,
			ruc_emisor: d.ruc_emisor,
			razon_social_emisor: d.razon_social_emisor,
			doc_receptor: d.doc_receptor,
			nombre_receptor: d.nombre_receptor,
			id_cliente: d.id_cliente,
			moneda: d.moneda ?? 'PEN',
			subtotal: d.subtotal,
			igv: d.igv,
			total: d.total,
			id_comprobante_referencia: d.id_comprobante_referencia
		}),
		archivo_url: nuevo.archivo_url,
		archivo_nombre: nuevo.archivo_nombre,
		archivo_tipo: nuevo.archivo_tipo,
		fuente_datos: nuevo.fuente_datos,
		texto_ocr: nuevo.texto_ocr,
		usuario_registro: nuevo.usuario
	};
	const { data, error } = await client.from('comprobante_ingreso').insert(fila).select('*').single();
	if (error) return { success: false, message: `No se pudo guardar el comprobante: ${mensajeError(error)}` };

	if (nuevo.idsTransacciones.length) {
		const vinculo = await vincularTransacciones(client, data.id_comprobante, nuevo.idsTransacciones);
		if (!vinculo.success) return { success: true, message: `Comprobante guardado, pero ${vinculo.message}`, data: data as ComprobanteIngreso };
	}
	return { success: true, message: 'Comprobante guardado correctamente.', data: data as ComprobanteIngreso };
}

export async function actualizarComprobanteIngreso(client: SupabaseClient, id: number, cambios: CambiosComprobante): Promise<ServiceResult> {
	const { error } = await client.from('comprobante_ingreso').update(normalizarCambios(cambios)).eq('id_comprobante', id);
	if (error) return { success: false, message: `No se pudo actualizar el comprobante: ${mensajeError(error)}` };
	return { success: true, message: 'Comprobante actualizado.' };
}

/** Revisado / Observado (con motivo) / volver a Pendiente — solo administradores (control de la app). */
export async function cambiarEstadoComprobante(
	client: SupabaseClient,
	id: number,
	estado: EstadoComprobanteIngreso,
	opciones: { esAdmin: boolean; usuario: string | null; motivo?: string | null }
): Promise<ServiceResult> {
	if (!opciones.esAdmin) return { success: false, message: 'Solo un administrador puede revisar u observar comprobantes.' };
	const motivo = opciones.motivo?.trim() || null;
	if (estado === 'observado' && !motivo) return { success: false, message: 'Indica el motivo de la observación.' };
	const { error } = await client
		.from('comprobante_ingreso')
		.update({
			estado,
			motivo_observacion: estado === 'observado' ? motivo : null,
			revisado_por: estado === 'pendiente' ? null : opciones.usuario,
			revisado_en: estado === 'pendiente' ? null : new Date().toISOString()
		})
		.eq('id_comprobante', id);
	if (error) return { success: false, message: `No se pudo cambiar el estado: ${mensajeError(error)}` };
	return { success: true, message: estado === 'revisado' ? 'Comprobante marcado como Revisado.' : estado === 'observado' ? 'Comprobante observado.' : 'Comprobante devuelto a Pendiente.' };
}

export async function vincularTransacciones(client: SupabaseClient, idComprobante: number, idsTransacciones: number[]): Promise<ServiceResult> {
	const filas = [...new Set(idsTransacciones)].map((id_transaccion) => ({ id_comprobante: idComprobante, id_transaccion }));
	if (!filas.length) return { success: true, message: 'Sin cambios.' };
	const { error } = await client.from('comprobante_ingreso_transaccion').upsert(filas, { onConflict: 'id_comprobante,id_transaccion', ignoreDuplicates: true });
	if (error) return { success: false, message: `no se pudieron vincular las transacciones: ${mensajeError(error)}` };
	return { success: true, message: filas.length === 1 ? 'Transacción vinculada.' : `${filas.length} transacciones vinculadas.` };
}

export async function desvincularTransaccion(client: SupabaseClient, idComprobante: number, idTransaccion: number): Promise<ServiceResult> {
	const { error } = await client.from('comprobante_ingreso_transaccion').delete().eq('id_comprobante', idComprobante).eq('id_transaccion', idTransaccion);
	if (error) return { success: false, message: `No se pudo quitar la transacción: ${mensajeError(error)}` };
	return { success: true, message: 'Transacción desvinculada.' };
}

// ── Baja lógica (patrón dar-de-baja del ERP) ────────────────────────────────────────────────────────

export async function darDeBajaComprobanteIngreso(client: SupabaseClient, id: number): Promise<ServiceResult> {
	const { error } = await client.from('comprobante_ingreso').update({ activo: false }).eq('id_comprobante', id);
	if (error) return { success: false, message: `No se pudo dar de baja el comprobante: ${mensajeError(error)}` };
	return { success: true, message: 'Comprobante dado de baja.' };
}

export async function restaurarComprobanteIngreso(client: SupabaseClient, id: number): Promise<ServiceResult> {
	const { error } = await client.from('comprobante_ingreso').update({ activo: true }).eq('id_comprobante', id);
	if (error) return { success: false, message: `No se pudo restaurar el comprobante: ${mensajeError(error)}` };
	return { success: true, message: 'Comprobante restaurado.' };
}

/** Borrado real (solo desde "Eliminados", tras contraseña de admin). Devuelve la URL del archivo para que
 * el componente lo borre también de Drive (mejor esfuerzo). */
export async function eliminarComprobanteIngresoPermanente(client: SupabaseClient, id: number): Promise<ServiceResult<{ archivo_url: string | null }>> {
	const { data: actual } = await client.from('comprobante_ingreso').select('archivo_url').eq('id_comprobante', id).maybeSingle();
	const { error } = await client.from('comprobante_ingreso').delete().eq('id_comprobante', id);
	if (error) return { success: false, message: `No se pudo eliminar el comprobante: ${mensajeError(error)}` };
	return { success: true, message: 'Comprobante eliminado permanentemente.', data: { archivo_url: actual?.archivo_url ?? null } };
}
