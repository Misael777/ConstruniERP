/**
 * Horarios de trabajo (tablas `horario` + `horario_dia`, migración 20261102160000_horarios.sql).
 * Cada horario define por día de la semana (1 = lunes … 7 = domingo) entrada, salida y refrigerio opcional;
 * un día sin registro es de descanso. Cada trabajador tiene su horario (personal.id_horario).
 * Es un catálogo: se da de baja (deja de ofrecerse), no se borra; los trabajadores que lo tenían lo conservan.
 * Tipo 'libre' (migración 20261103150000): por horas, sin días ni entrada/salida; Asistencia suma los tramos entre marcas.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export interface HorarioDia {
	dia: number;
	hora_entrada: string;
	hora_salida: string;
	refrigerio_inicio: string | null;
	refrigerio_fin: string | null;
}

export interface Horario {
	id_horario: number;
	nombre: string;
	tolerancia_min: number;
	/** fijo: jornada por día; libre: por horas, sin entrada ni salida (sin horario_dia). Sin la migración llega undefined = fijo. */
	tipo?: 'fijo' | 'libre';
	estado: 'activo' | 'baja';
	horario_dia: HorarioDia[];
}

/** 'HH:MM' o 'HH:MM:SS' → minutos desde la medianoche. */
export const aMinutos = (hora: string) => {
	const [h, m] = hora.split(':').map(Number);
	return h * 60 + m;
};

export const hhmm = (hora: string | null) => (hora ? hora.slice(0, 5) : '');

/** Minutos de trabajo del día: de entrada a salida, menos el refrigerio. */
export const minutosDelDia = (d: HorarioDia) =>
	aMinutos(d.hora_salida) - aMinutos(d.hora_entrada) - (d.refrigerio_inicio && d.refrigerio_fin ? aMinutos(d.refrigerio_fin) - aMinutos(d.refrigerio_inicio) : 0);

export const esLibre = (h: Pick<Horario, 'tipo'> | null | undefined) => h?.tipo === 'libre';

export function horasSemanales(h: Pick<Horario, 'horario_dia'>): number {
	return h.horario_dia.reduce((total, d) => total + minutosDelDia(d), 0) / 60;
}

/** "L-V 07:30–17:00 · S 07:30–13:00": agrupa días consecutivos con el mismo horario. */
export function resumenHorario(h: Pick<Horario, 'horario_dia' | 'tipo'>): string {
	if (esLibre(h)) return 'Libre, por horas';
	const dias = [...h.horario_dia].sort((a, b) => a.dia - b.dia);
	const grupos: { desde: number; hasta: number; texto: string }[] = [];
	for (const d of dias) {
		const texto = `${hhmm(d.hora_entrada)}–${hhmm(d.hora_salida)}`;
		const ultimo = grupos.at(-1);
		if (ultimo && ultimo.texto === texto && ultimo.hasta === d.dia - 1) ultimo.hasta = d.dia;
		else grupos.push({ desde: d.dia, hasta: d.dia, texto });
	}
	const letra = (dia: number) => 'LMMJVSD'[dia - 1];
	return grupos.map((g) => `${g.desde === g.hasta ? letra(g.desde) : `${letra(g.desde)}-${letra(g.hasta)}`} ${g.texto}`).join(' · ');
}

export async function getHorarios(client: SupabaseClient, soloEliminados = false): Promise<Horario[]> {
	let query = client.from('horario').select('*, horario_dia(*)').order('nombre');
	query = soloEliminados ? query.eq('estado', 'baja') : query.neq('estado', 'baja');
	const { data, error } = await query;
	if (error) throw error;
	return (data ?? []).map((h) => ({ ...h, horario_dia: [...h.horario_dia].sort((a: HorarioDia, b: HorarioDia) => a.dia - b.dia) }));
}

/** Crea (id null) o actualiza el horario y reemplaza sus días. */
export async function guardarHorario(
	client: SupabaseClient,
	id: number | null,
	datos: { nombre: string; tolerancia_min: number; tipo: 'fijo' | 'libre'; dias: HorarioDia[] }
): Promise<number> {
	let idHorario = id;
	const fila = { nombre: datos.nombre.trim(), tolerancia_min: datos.tipo === 'libre' ? 0 : datos.tolerancia_min, tipo: datos.tipo };
	const dias = datos.tipo === 'libre' ? [] : datos.dias;
	if (idHorario === null) {
		const { data, error } = await client
			.from('horario')
			.insert(fila)
			.select('id_horario')
			.single();
		if (error) throw nombreRepetido(error);
		idHorario = data.id_horario as number;
	} else {
		const { error } = await client.from('horario').update(fila).eq('id_horario', idHorario);
		if (error) throw nombreRepetido(error);
		const { error: errorBorrado } = await client.from('horario_dia').delete().eq('id_horario', idHorario);
		if (errorBorrado) throw errorBorrado;
	}
	if (dias.length) {
		const { error } = await client.from('horario_dia').insert(dias.map((d) => ({ ...d, id_horario: idHorario })));
		if (error) throw error;
	}
	return idHorario;
}

function nombreRepetido(error: { code?: string }) {
	return error.code === '23505' ? new Error('Ya existe un horario con ese nombre.') : error;
}

export async function cambiarEstadoHorario(client: SupabaseClient, id: number, estado: 'activo' | 'baja'): Promise<void> {
	const { error } = await client.from('horario').update({ estado }).eq('id_horario', id);
	if (error) throw nombreRepetido(error);
}

/** Cuántos trabajadores activos tiene cada horario. */
export async function contarPersonalPorHorario(client: SupabaseClient): Promise<Record<number, number>> {
	const { data, error } = await client.from('personal').select('id_horario').eq('estado', 'activo').not('id_horario', 'is', null);
	if (error) throw error;
	const conteo: Record<number, number> = {};
	for (const p of data ?? []) conteo[p.id_horario] = (conteo[p.id_horario] ?? 0) + 1;
	return conteo;
}
