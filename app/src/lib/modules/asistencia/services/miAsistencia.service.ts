/**
 * Mi asistencia: el empleado con horario libre o mixto registra su ingreso y su salida desde el ERP, sin huellero
 * (botón «Mi asistencia» de Inicio). Todo pasa por RPC SECURITY DEFINER (migración 20261106130000): cada
 * usuario solo lee y marca lo suyo, y la hora la pone el servidor. Las marcas se cuentan en pares, igual que el
 * horario libre: 1.ª ingreso, 2.ª salida, 3.ª ingreso…
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Horario } from '$lib/modules/personal/services/horarios.service';
import { aMarca, marcaValida, type Marca } from './asistencia.service';

const MARCA_REPETIDA_MIN = 2;

export interface MiFicha {
	id_personal: number;
	pin: string;
	nombre: string;
	obra: string | null;
	fecha_ingreso: string | null;
	fecha_cese: string | null;
	/** Ticket #110: método "Registro manual": marca desde el ERP aunque su horario sea fijo. */
	registro_manual?: boolean;
}

export interface MiAsistencia {
	personal: MiFicha;
	horario: Horario | null;
	marcas: Marca[];
}

/** null = el usuario no está vinculado a una ficha de Personal (o la base aún no tiene la migración). */
export async function getMiAsistencia(client: SupabaseClient, desde: string, hasta: string): Promise<MiAsistencia | null> {
	const { data, error } = await client.rpc('fn_mi_asistencia', { p_desde: desde, p_hasta: hasta });
	// PGRST202: la función no existe todavía en esta base → como si no estuviera vinculado.
	if (error?.code === 'PGRST202') return null;
	if (error) throw error;
	if (!data) return null;
	return {
		personal: data.personal,
		horario: data.horario,
		marcas: (data.marcas ?? []).filter(marcaValida).map(aMarca)
	};
}

/** Registra un ingreso o una salida (el servidor decide la hora). Devuelve la hora registrada (ISO). */
export async function marcarMiAsistencia(client: SupabaseClient): Promise<string> {
	const { data, error } = await client.rpc('fn_mi_asistencia_marcar');
	if (error) throw new Error(error.message);
	return data.marcado_en as string;
}

export interface Tramo {
	inicio: number;
	/** null = sigue en jornada. */
	fin: number | null;
}

/** Jornada de un día: tramos en pares, si sigue trabajando y los minutos (el tramo abierto cuenta hasta `ahoraMin`). */
export function jornadaDelDia(marcas: Marca[], fecha: string, ahoraMin: number | null = null) {
	const delDia: number[] = [];
	for (const m of marcas.filter((x) => x.fecha === fecha)) {
		const anterior = delDia.at(-1);
		if (anterior == null || m.minuto - anterior >= MARCA_REPETIDA_MIN) delDia.push(m.minuto);
	}
	const tramos: Tramo[] = [];
	for (let i = 0; i < delDia.length; i += 2) tramos.push({ inicio: delDia[i], fin: delDia[i + 1] ?? null });
	const enJornada = delDia.length % 2 === 1;
	const minutos = tramos.reduce((s, t) => s + Math.max(0, (t.fin ?? ahoraMin ?? t.inicio) - t.inicio), 0);
	return { tramos, enJornada, minutos };
}
