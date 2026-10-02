/**
 * Control de Accesos → Auditoría: lecturas para la pantalla /iam/auditoria. La escritura NUNCA pasa por acá —
 * la hacen las funciones de la base (triggers + RPCs, ver supabase/migrations/20261002120000_auditoria.sql) y
 * $lib/shared/auditoria.ts. La lectura está protegida por RLS: solo quien tenga el permiso ver_iam_auditoria.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type MotivoFin = 'logout_manual' | 'sesion_expirada' | 'app_cerrada' | 'cierre_inesperado';

export interface SesionAuditoria {
	id: string;
	user_id: string;
	usuario: string | null;
	plataforma: string | null;
	version_app: string | null;
	inicio: string;
	ultimo_latido: string;
	fin: string | null;
	motivo_fin: MotivoFin | null;
	detalle: string | null;
}

export interface AccionAuditoria {
	id: number;
	sesion_id: string | null;
	user_id: string | null;
	usuario: string | null;
	tipo: 'insert' | 'update' | 'delete' | 'descarga' | 'pdf' | 'subida';
	tabla: string | null;
	modulo: string | null;
	id_registro: string | null;
	resumen: string | null;
	cambios: Record<string, unknown> | null;
	creado_en: string;
}

export interface ErrorAuditoria {
	id: number;
	sesion_id: string | null;
	usuario: string | null;
	origen: 'js' | 'rust_panic' | 'cierre';
	mensaje: string;
	stack: string | null;
	plataforma: string | null;
	creado_en: string;
}

export interface Pagina<T> {
	items: T[];
	total: number;
}

/** Sin latido por más de esto (y sin cierre registrado) = ya no está conectado. Igual que la base. */
export const MINUTOS_SIN_LATIDO = 3;

export function estaConectada(s: SesionAuditoria): boolean {
	return !s.fin && Date.now() - new Date(s.ultimo_latido).getTime() < MINUTOS_SIN_LATIDO * 60_000;
}

export interface FiltrosComunes {
	page: number;
	pageSize: number;
	usuario?: string;
	desde?: string; // YYYY-MM-DD
	hasta?: string; // YYYY-MM-DD
}

/** Inicio/fin de día en hora local (Perú) como ISO, para filtrar timestamptz por fecha calendario. */
function rangoDia(fecha: string, fin: boolean): string {
	return new Date(`${fecha}T${fin ? '23:59:59.999' : '00:00:00'}`).toISOString();
}

export async function getSesionesConectadas(client: SupabaseClient): Promise<SesionAuditoria[]> {
	const limite = new Date(Date.now() - MINUTOS_SIN_LATIDO * 60_000).toISOString();
	const { data, error } = await client
		.from('auditoria_sesion')
		.select('*')
		.is('fin', null)
		.gte('ultimo_latido', limite)
		.order('inicio', { ascending: false });
	if (error) throw error;
	return (data ?? []) as SesionAuditoria[];
}

export async function getSesiones(client: SupabaseClient, f: FiltrosComunes & { motivo?: MotivoFin | 'abierta' }): Promise<Pagina<SesionAuditoria>> {
	const from = (f.page - 1) * f.pageSize;
	let q = client.from('auditoria_sesion').select('*', { count: 'exact' }).order('inicio', { ascending: false }).range(from, from + f.pageSize - 1);
	if (f.usuario) q = q.eq('usuario', f.usuario);
	if (f.desde) q = q.gte('inicio', rangoDia(f.desde, false));
	if (f.hasta) q = q.lte('inicio', rangoDia(f.hasta, true));
	if (f.motivo === 'abierta') q = q.is('fin', null);
	else if (f.motivo) q = q.eq('motivo_fin', f.motivo);
	const { data, error, count } = await q;
	if (error) throw error;
	return { items: (data ?? []) as SesionAuditoria[], total: count ?? 0 };
}

export async function getAcciones(
	client: SupabaseClient,
	f: FiltrosComunes & { tipo?: AccionAuditoria['tipo']; tabla?: string; sesionId?: string }
): Promise<Pagina<AccionAuditoria>> {
	const from = (f.page - 1) * f.pageSize;
	let q = client.from('auditoria_accion').select('*', { count: 'exact' }).order('creado_en', { ascending: false }).range(from, from + f.pageSize - 1);
	if (f.usuario) q = q.eq('usuario', f.usuario);
	if (f.tipo) q = q.eq('tipo', f.tipo);
	if (f.tabla) q = q.eq('tabla', f.tabla);
	if (f.sesionId) q = q.eq('sesion_id', f.sesionId);
	if (f.desde) q = q.gte('creado_en', rangoDia(f.desde, false));
	if (f.hasta) q = q.lte('creado_en', rangoDia(f.hasta, true));
	const { data, error, count } = await q;
	if (error) throw error;
	return { items: (data ?? []) as AccionAuditoria[], total: count ?? 0 };
}

export async function getErrores(client: SupabaseClient, f: FiltrosComunes & { origen?: ErrorAuditoria['origen'] }): Promise<Pagina<ErrorAuditoria>> {
	const from = (f.page - 1) * f.pageSize;
	let q = client.from('auditoria_error').select('*', { count: 'exact' }).order('creado_en', { ascending: false }).range(from, from + f.pageSize - 1);
	if (f.usuario) q = q.eq('usuario', f.usuario);
	if (f.origen) q = q.eq('origen', f.origen);
	if (f.desde) q = q.gte('creado_en', rangoDia(f.desde, false));
	if (f.hasta) q = q.lte('creado_en', rangoDia(f.hasta, true));
	const { data, error, count } = await q;
	if (error) throw error;
	return { items: (data ?? []) as ErrorAuditoria[], total: count ?? 0 };
}

/** Nombres de empleados para el filtro "Usuario". */
export async function getUsuariosAuditables(client: SupabaseClient): Promise<string[]> {
	const { data, error } = await client.from('empleados').select('nombre').order('nombre');
	if (error) throw error;
	return [...new Set((data ?? []).map((e: any) => e.nombre as string).filter(Boolean))];
}
