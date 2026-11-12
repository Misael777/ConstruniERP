/**
 * Huelleros ZKTeco de las obras (tabla `asistencia_dispositivo`, migración 20261030120000_asistencia_huellero.sql).
 * Un huellero se registra solo la primera vez que se conecta al receptor ADMS (servicios/huellero-adms/worker.js)
 * y queda 'pendiente' hasta que se le asigna nombre y obra aquí; desde entonces sus marcas llevan esa obra.
 * Dar de baja = estado 'baja' (el receptor deja de guardar sus marcas); ver skill dar-de-baja-pattern.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** Datos que el receptor en la nube necesita; se muestran en la ayuda "Agregar un huellero". */
export const RECEPTOR_ADMS = {
	direccion: 'construni-asistencia.construnisys.workers.dev',
	puerto: 80
};

/** El huellero consulta al receptor cada 30-60 s: sin noticias en 3 min se considera fuera de línea. */
const MINUTOS_EN_LINEA = 3;

export interface Huellero {
	id_dispositivo: number;
	numero_serie: string;
	nombre: string | null;
	id_centro_costo: number | null;
	estado: 'pendiente' | 'activo' | 'baja';
	ultima_conexion: string | null;
	ultima_ip: string | null;
	info: string | null;
	/** Base a la que el receptor envía sus datos; la cambia solo el rol developer (migración 20261103120000). */
	destino: 'produccion' | 'desarrollo';
	created_at: string;
	centro_costo: { codigo: string; nombre: string } | null;
	/** Marcaciones recibidas hoy (hora de Lima). */
	marcas_hoy: number;
	/** Órdenes del ERP que el huellero aún no confirma (alta/retiro de trabajadores, sincronizar). */
	ordenes_pendientes: number;
	/** Órdenes que el huellero rechazó en los últimos 7 días. */
	ordenes_error: number;
}

export function estaEnLinea(huellero: Pick<Huellero, 'ultima_conexion'>, ahora = Date.now()): boolean {
	if (!huellero.ultima_conexion) return false;
	return ahora - new Date(huellero.ultima_conexion).getTime() < MINUTOS_EN_LINEA * 60_000;
}

/** Inicio del día de hoy en Lima (UTC-5, sin horario de verano) como ISO, para contar las marcas de hoy. */
function inicioDeHoyLima(): string {
	const lima = new Date(Date.now() - 5 * 3_600_000);
	return `${lima.toISOString().slice(0, 10)}T00:00:00-05:00`;
}

export async function getHuelleros(client: SupabaseClient, soloEliminados = false): Promise<Huellero[]> {
	let query = client
		.from('asistencia_dispositivo')
		.select(`*, ${CENTRO_COSTO_SELECT}`)
		.order('created_at', { ascending: true });
	query = soloEliminados ? query.eq('estado', 'baja') : query.neq('estado', 'baja');
	const { data: filas, error } = await query;
	if (error) throw error;
	const data = (filas ?? []).map((h: any) => ({ ...h, centro_costo: nombreCentro(h.centro_costo) }));

	const ids = (data ?? []).map((h) => h.id_dispositivo);
	const marcasHoy: Record<number, number> = {};
	const pendientes: Record<number, number> = {};
	const errores: Record<number, number> = {};
	if (ids.length) {
		const hace7Dias = new Date(Date.now() - 7 * 86_400_000).toISOString();
		const [marcas, ordenes] = await Promise.all([
			client.from('asistencia_marcacion').select('id_dispositivo').in('id_dispositivo', ids).gte('marcado_en', inicioDeHoyLima()),
			client
				.from('asistencia_comando')
				.select('id_dispositivo, estado')
				.in('id_dispositivo', ids)
				.or(`estado.in.(pendiente,enviado),and(estado.eq.error,created_at.gte.${hace7Dias})`)
		]);
		if (marcas.error) throw marcas.error;
		if (ordenes.error) throw ordenes.error;
		for (const m of marcas.data ?? []) marcasHoy[m.id_dispositivo] = (marcasHoy[m.id_dispositivo] ?? 0) + 1;
		for (const o of ordenes.data ?? []) {
			const destino = o.estado === 'error' ? errores : pendientes;
			destino[o.id_dispositivo] = (destino[o.id_dispositivo] ?? 0) + 1;
		}
	}
	return (data ?? []).map((h) => ({
		...h,
		marcas_hoy: marcasHoy[h.id_dispositivo] ?? 0,
		ordenes_pendientes: pendientes[h.id_dispositivo] ?? 0,
		ordenes_error: errores[h.id_dispositivo] ?? 0
	}));
}

/** Pide al huellero todos sus usuarios (llegan al Personal del ERP) y le reenvía el personal activo de su obra.
 * Devuelve cuántos trabajadores se le reenviaron. */
export async function sincronizarHuellero(client: SupabaseClient, id: number): Promise<number> {
	const { data, error } = await client.rpc('fn_asistencia_sincronizar', { p_id_dispositivo: id });
	if (error) throw error;
	return data ?? 0;
}

export type EstadoEnHuellero = 'enviando' | 'en_huellero' | 'error' | 'retirado';

/** Clave de getEstadoEnHuelleros: código del trabajador + huellero. */
export const claveEnHuellero = (pin: string, idDispositivo: number) => `${pin}|${idDispositivo}`;

/** Estado de cada trabajador en cada huellero (clave claveEnHuellero), según su orden más reciente ahí. */
export async function getEstadoEnHuelleros(client: SupabaseClient): Promise<Record<string, EstadoEnHuellero>> {
	const { data, error } = await client
		.from('asistencia_comando')
		.select('pin, id_dispositivo, estado, comando')
		.not('pin', 'is', null)
		.order('id_comando', { ascending: false })
		.limit(2000);
	if (error) throw error;
	const estados: Record<string, EstadoEnHuellero> = {};
	for (const o of data ?? []) {
		const clave = claveEnHuellero(o.pin, o.id_dispositivo);
		if (estados[clave]) continue;
		if (o.estado === 'pendiente' || o.estado === 'enviado') estados[clave] = 'enviando';
		else if (o.estado === 'error') estados[clave] = 'error';
		else estados[clave] = o.comando.startsWith('DATA DELETE') ? 'retirado' : 'en_huellero';
	}
	return estados;
}

/** Guarda nombre y obra. Con obra asignada el huellero pasa a 'activo'; sin obra vuelve a 'pendiente'.
 * Las marcas que llegaron mientras no tenía obra se quedan con la obra asignada ahora. */
export async function guardarHuellero(
	client: SupabaseClient,
	id: number,
	cambios: { nombre: string | null; id_centro_costo: number | null }
): Promise<void> {
	const { error } = await client
		.from('asistencia_dispositivo')
		.update({
			nombre: cambios.nombre?.trim() || null,
			id_centro_costo: cambios.id_centro_costo,
			estado: cambios.id_centro_costo ? 'activo' : 'pendiente'
		})
		.eq('id_dispositivo', id);
	if (error) throw error;
	if (cambios.id_centro_costo) {
		const { error: errorMarcas } = await client
			.from('asistencia_marcacion')
			.update({ id_centro_costo: cambios.id_centro_costo })
			.eq('id_dispositivo', id)
			.is('id_centro_costo', null);
		if (errorMarcas) throw errorMarcas;
	}
}

export async function darDeBajaHuellero(client: SupabaseClient, id: number): Promise<void> {
	const { error } = await client.from('asistencia_dispositivo').update({ estado: 'baja' }).eq('id_dispositivo', id);
	if (error) throw error;
}

export async function restaurarHuellero(client: SupabaseClient, id: number): Promise<void> {
	const { data, error: errorLectura } = await client
		.from('asistencia_dispositivo')
		.select('id_centro_costo')
		.eq('id_dispositivo', id)
		.single();
	if (errorLectura) throw errorLectura;
	const { error } = await client
		.from('asistencia_dispositivo')
		.update({ estado: data.id_centro_costo ? 'activo' : 'pendiente' })
		.eq('id_dispositivo', id);
	if (error) throw error;
}

/** Borra el huellero y TODAS sus marcaciones (ON DELETE CASCADE). Solo desde "Ver eliminados" con contraseña. */
export async function eliminarHuelleroPermanente(client: SupabaseClient, id: number): Promise<void> {
	const { error } = await client.from('asistencia_dispositivo').delete().eq('id_dispositivo', id);
	if (error) throw error;
}

/** Centros de costo donde puede estar un huellero o trabajar una persona: Corporativo, Obras y Consultoría
 * (a pedido del usuario; consultoría se sumó el 10/11/2026). */
const GRUPOS_LUGAR: { tipos: string[]; grupo: string }[] = [
	{ tipos: ['bolsa general'], grupo: 'Corporativo / Oficina' },
	{ tipos: ['obra', 'proyecto'], grupo: 'Obras' },
	{ tipos: ['consultoria'], grupo: 'Consultoría' }
];

/** Embebido de centro_costo con el nombre del proyecto: el centro de un proyecto se llama solo con su número
 * ("13"), así que se muestra el nombre del proyecto vinculado. Usar junto con nombreCentro(). */
export const CENTRO_COSTO_SELECT = 'centro_costo(codigo, nombre, tipo, proyecto(nombre_proyecto))';

/** Deja { codigo, nombre } con el nombre del proyecto si el centro está vinculado a uno. */
export function nombreCentro<T extends { codigo: string; nombre: string; tipo?: string; proyecto?: { nombre_proyecto: string | null } | null }>(
	cc: T | null | undefined
): { codigo: string; nombre: string; tipo?: string } | null {
	if (!cc) return null;
	const r: { codigo: string; nombre: string; tipo?: string } = { codigo: cc.codigo, nombre: cc.proyecto?.nombre_proyecto?.trim() || cc.nombre };
	if (cc.tipo) r.tipo = cc.tipo;
	return r;
}

/** Obras y áreas (centros de costo activos) agrupadas para SelectConSaldo. */
export async function getObrasParaHuellero(client: SupabaseClient): Promise<{ value: string; label: string; grupo: string }[]> {
	const { data, error } = await client
		.from('centro_costo')
		.select('id_centro_costo, codigo, nombre, tipo, proyecto(nombre_proyecto)')
		.in('tipo', GRUPOS_LUGAR.flatMap((g) => g.tipos))
		.eq('estado', 'activo')
		.order('codigo');
	if (error) throw error;
	return GRUPOS_LUGAR.flatMap(({ tipos, grupo }) =>
		(data ?? [])
			.filter((c) => tipos.includes(c.tipo))
			.map((c: any) => ({ value: String(c.id_centro_costo), label: `${c.codigo} · ${nombreCentro(c)!.nombre}`, grupo }))
	);
}

export interface HuelleroElegible {
	id_dispositivo: number;
	nombre: string;
	id_centro_costo: number | null;
	lugar: string;
	/** Identificador del equipo (número de serie, SN). */
	numero_serie: string;
	/** Se conectó al ERP en los últimos minutos (ver estaEnLinea). */
	en_linea: boolean;
}

/** Huelleros a los que se puede vincular un trabajador (activos o pendientes de asignar lugar). */
export async function getHuellerosElegibles(client: SupabaseClient): Promise<HuelleroElegible[]> {
	const { data, error } = await client
		.from('asistencia_dispositivo')
		.select(`id_dispositivo, numero_serie, nombre, id_centro_costo, ultima_conexion, ${CENTRO_COSTO_SELECT}`)
		.neq('estado', 'baja')
		.order('created_at');
	if (error) throw error;
	return (data ?? []).map((h: any) => ({
		id_dispositivo: h.id_dispositivo,
		nombre: h.nombre || `Huellero ${h.numero_serie}`,
		id_centro_costo: h.id_centro_costo,
		lugar: h.centro_costo ? `${h.centro_costo.codigo} · ${nombreCentro(h.centro_costo)!.nombre}` : 'Sin obra o área asignada',
		numero_serie: h.numero_serie,
		en_linea: estaEnLinea(h)
	}));
}

/** Envía los datos del huellero a Producción o a Desarrollo (solo rol developer; la base lo vuelve a verificar).
 * El receptor lo toma en menos de un minuto. */
export async function cambiarDestinoHuellero(client: SupabaseClient, id: number, destino: Huellero['destino']): Promise<void> {
	const { error } = await client.from('asistencia_dispositivo').update({ destino }).eq('id_dispositivo', id);
	if (error) throw error;
}
