/**
 * Asistencia por trabajador: cruza sus marcaciones (asistencia_marcacion, enlazadas por pin desde cualquier
 * huellero) con su horario (horario_dia) y arma el día a día del periodo en hora de Lima.
 * Reglas: entrada = primera marca del día, salida = última; marcas a menos de 2 min de la anterior son repetidas, y
 * con horario fijo también las que caen a menos de 30 min de la entrada o de la salida. Las marcas del medio se
 * ubican en la salida o la vuelta del refrigerio por cercanía (ver leerJornada). Tardanza: entrada después de hora de entrada + tolerancia (se cuenta desde la
 * hora de entrada). Horas extra: lo trabajado después de la hora de salida, o todo si el día era de descanso.
 * Horario libre (por horas): sin entrada ni salida programadas; las marcas se toman en pares (entrada→salida,
 * entrada→salida…) y se suman los tramos. Sin tardanza, faltas ni horas extra; una marca sin pareja deja el día incompleto.
 * No contempla turnos que pasan la medianoche.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { aMinutos, esLibre, minutosDelDia, type Horario, type HorarioDia } from '$lib/modules/personal/services/horarios.service';

const LIMA_MS = 5 * 3_600_000;
const MARCA_REPETIDA_MIN = 2;
/** Con horario fijo: marcas a menos de esto de la entrada (o de la salida) son la misma entrada (o salida) repetida. */
export const MARCA_REPETIDA_JORNADA_MIN = 30;
/** Eventos del huellero en modo control de acceso desde 20 son verificaciones rechazadas, no asistencia. */
const EVENTO_RECHAZO = 20;

export interface Marca {
	fecha: string;
	minuto: number;
	/** Nombre del huellero, o "ERP" si la registró el propio empleado en Mi asistencia. */
	huellero: string;
	origen?: 'huellero' | 'erp';
}

/** Fila de asistencia_marcacion → Marca en hora de Lima. */
export function aMarca(m: { marcado_en: string; origen?: string | null; huellero?: string | null }): Marca {
	const lima = new Date(Date.parse(m.marcado_en) - LIMA_MS);
	const origen = m.origen === 'erp' ? 'erp' : 'huellero';
	return {
		fecha: lima.toISOString().slice(0, 10),
		minuto: lima.getUTCHours() * 60 + lima.getUTCMinutes(),
		huellero: origen === 'erp' ? 'ERP' : (m.huellero ?? 'Huellero'),
		origen
	};
}

export const marcaValida = (m: { evento?: number | null }) => m.evento == null || m.evento < EVENTO_RECHAZO;

export type EstadoDia = 'puntual' | 'tarde' | 'falta' | 'incompleto' | 'en_curso' | 'descanso' | 'descanso_trabajado' | 'asistio' | 'sin_marcas' | 'fuera_contrato';

export interface DiaAsistencia {
	fecha: string;
	/** 1 = lunes … 7 = domingo. */
	dia: number;
	programado: HorarioDia | null;
	marcas: Marca[];
	entrada: number | null;
	salida: number | null;
	trabajados: number;
	tardanza: number;
	extra: number;
	salidaAnticipada: number;
	estado: EstadoDia;
}

export interface ResumenAsistencia {
	laborables: number;
	asistidos: number;
	faltas: number;
	tardanzas: number;
	minutosTardanza: number;
	incompletos: number;
	minutosTrabajados: number;
	minutosExtra: number;
}

/** clase: etiqueta; celda: fondo y borde del día en el calendario; punto: color de la leyenda. */
export const ESTADOS_DIA: Record<EstadoDia, { texto: string; clase: string; celda: string; punto: string }> = {
	puntual: { texto: 'Puntual', clase: 'bg-emerald-50 text-emerald-700 border-emerald-200', celda: 'bg-emerald-50/60 border-emerald-200', punto: 'bg-emerald-500' },
	tarde: { texto: 'Tardanza', clase: 'bg-amber-50 text-amber-700 border-amber-200', celda: 'bg-amber-50/70 border-amber-200', punto: 'bg-amber-500' },
	falta: { texto: 'Falta', clase: 'bg-rose-50 text-rose-700 border-rose-200', celda: 'bg-rose-50/70 border-rose-200', punto: 'bg-rose-500' },
	incompleto: { texto: 'Sin marca de salida', clase: 'bg-orange-50 text-orange-700 border-orange-200', celda: 'bg-orange-50/70 border-orange-200', punto: 'bg-orange-500' },
	en_curso: { texto: 'En jornada', clase: 'bg-blue-50 text-blue-700 border-blue-200', celda: 'bg-blue-50/60 border-blue-200', punto: 'bg-blue-500' },
	descanso: { texto: 'Descanso', clase: 'bg-slate-50 text-slate-400 border-slate-200', celda: 'bg-slate-50 border-slate-100', punto: 'bg-slate-300' },
	descanso_trabajado: { texto: 'Trabajó en descanso', clase: 'bg-violet-50 text-violet-700 border-violet-200', celda: 'bg-violet-50/70 border-violet-200', punto: 'bg-violet-500' },
	asistio: { texto: 'Asistió', clase: 'bg-emerald-50 text-emerald-700 border-emerald-200', celda: 'bg-emerald-50/60 border-emerald-200', punto: 'bg-emerald-500' },
	sin_marcas: { texto: 'Sin marcas', clase: 'bg-slate-50 text-slate-500 border-slate-200', celda: 'bg-white border-slate-100', punto: 'bg-slate-400' },
	fuera_contrato: { texto: 'Fuera de contrato', clase: 'bg-slate-50 text-slate-300 border-slate-100', celda: 'bg-slate-50/50 border-slate-100', punto: 'bg-slate-200' }
};

/** 'AAAA-MM-DD' ± días. */
export function sumarDias(fecha: string, dias: number): string {
	return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

/** 1 = lunes … 7 = domingo. */
export const diaSemana = (fecha: string) => ((new Date(`${fecha}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** Minutos → "8 h 30 min", "45 min", "—". */
export function duracion(min: number): string {
	if (!min) return '—';
	const h = Math.floor(min / 60);
	const m = Math.round(min % 60);
	return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

export const reloj = (min: number | null) =>
	min == null ? '' : `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Marcas válidas del código `pin` entre dos fechas (inclusive, hora de Lima). */
export async function getMarcas(client: SupabaseClient, pin: string, desde: string, hasta: string): Promise<Marca[]> {
	const consultar = (columnas: string) =>
		client
			.from('asistencia_marcacion')
			.select(columnas)
			.eq('pin', pin)
			.gte('marcado_en', `${desde}T00:00:00-05:00`)
			.lt('marcado_en', `${sumarDias(hasta, 1)}T00:00:00-05:00`)
			.order('marcado_en');
	let { data, error } = await consultar('marcado_en, evento, origen, asistencia_dispositivo(nombre)');
	// Base sin la migración 20261106130000 (no existe la columna origen): se carga igual, todo como huellero.
	if (error?.code === '42703') ({ data, error } = await consultar('marcado_en, evento, asistencia_dispositivo(nombre)'));
	if (error) throw error;
	return ((data ?? []) as unknown as { marcado_en: string; evento: number | null; origen?: string; asistencia_dispositivo: { nombre: string | null } | { nombre: string | null }[] | null }[])
		.filter(marcaValida)
		.map((m) => {
			const disp = m.asistencia_dispositivo;
			return aMarca({ ...m, huellero: Array.isArray(disp) ? disp[0]?.nombre : disp?.nombre });
		});
}

/** Minutos en que [a, b] se cruza con [c, d]. */
const cruce = (a: number, b: number, c: number, d: number) => Math.max(0, Math.min(b, d) - Math.max(a, c));

/**
 * Entrada, salida y minutos trabajados de un día con horario fijo (o sin horario), a partir de las marcas del día
 * (minutos, en orden, ya sin las repetidas a menos de 2 min). A pedido del usuario (18/11/2026): una marca de más
 * (p. ej. 07:30 y otra vez 07:40 porque no vio el aviso del huellero) no debe correr las demás.
 * - Entrada = primera marca; las que siguen a menos de MARCA_REPETIDA_JORNADA_MIN son la misma entrada repetida.
 * - Salida = última marca, si está a más de ese margen de la entrada (si no, el día sigue sin salida); las que la
 *   preceden dentro de ese margen son la misma salida repetida.
 * - Marcas del medio, con refrigerio en el horario: cada una va a la salida o a la vuelta del refrigerio según cuál
 *   le quede más cerca (vale la primera de cada grupo). Con las dos, se suman los tramos reales; si falta alguna, de
 *   entrada a salida menos el refrigerio del horario.
 * - Sin refrigerio en el horario (o día de descanso): marcas del medio en número par = se suman los tramos; si no,
 *   de entrada a salida.
 */
export function leerJornada(
	marcas: number[],
	programado: Pick<HorarioDia, 'refrigerio_inicio' | 'refrigerio_fin'> | null
): { entrada: number | null; salida: number | null; trabajados: number } {
	if (!marcas.length) return { entrada: null, salida: null, trabajados: 0 };
	const entrada = marcas[0];
	const ultima = marcas.at(-1)!;
	if (ultima - entrada < MARCA_REPETIDA_JORNADA_MIN) return { entrada, salida: null, trabajados: 0 };
	const salida = ultima;
	const medio = marcas.filter((x) => x - entrada >= MARCA_REPETIDA_JORNADA_MIN && salida - x >= MARCA_REPETIDA_JORNADA_MIN);

	const refIni = programado?.refrigerio_inicio ? aMinutos(programado.refrigerio_inicio) : null;
	const refFin = programado?.refrigerio_fin ? aMinutos(programado.refrigerio_fin) : null;
	if (refIni != null && refFin != null) {
		const mitad = (refIni + refFin) / 2;
		const sale = medio.find((x) => x <= mitad);
		const vuelve = medio.find((x) => x > mitad);
		const trabajados =
			sale != null && vuelve != null ? sale - entrada + (salida - vuelve) : salida - entrada - cruce(entrada, salida, refIni, refFin);
		return { entrada, salida, trabajados };
	}
	if (medio.length && medio.length % 2 === 0) {
		const puntos = [entrada, ...medio, salida];
		let trabajados = 0;
		for (let i = 0; i < puntos.length; i += 2) trabajados += puntos[i + 1] - puntos[i];
		return { entrada, salida, trabajados };
	}
	return { entrada, salida, trabajados: salida - entrada };
}

/** Día a día de `desde` a `hasta` (sin pasar de hoy). `horario` null = trabajador sin horario asignado. */
export function calcularAsistencia(
	marcas: Marca[],
	horario: Pick<Horario, 'tolerancia_min' | 'horario_dia' | 'tipo'> | null,
	desde: string,
	hasta: string,
	hoy: string,
	contrato: { ingreso: string | null; cese: string | null }
): DiaAsistencia[] {
	const dias: DiaAsistencia[] = [];
	const fin = hasta < hoy ? hasta : hoy;
	const libre = esLibre(horario);
	for (let fecha = desde; fecha <= fin; fecha = sumarDias(fecha, 1)) {
		const dia = diaSemana(fecha);
		const programado = libre ? null : (horario?.horario_dia.find((d) => d.dia === dia) ?? null);
		const delDia: Marca[] = [];
		for (const m of marcas.filter((x) => x.fecha === fecha)) {
			const anterior = delDia.at(-1);
			if (!anterior || m.minuto - anterior.minuto >= MARCA_REPETIDA_MIN) delDia.push(m);
		}
		let entrada: number | null;
		let salida: number | null;
		let trabajados = 0;
		if (libre) {
			entrada = delDia[0]?.minuto ?? null;
			// Libre: con número impar de marcas la última es una entrada sin salida todavía.
			salida = delDia.length > 1 && delDia.length % 2 === 0 ? delDia.at(-1)!.minuto : null;
			for (let i = 0; i + 1 < delDia.length; i += 2) trabajados += delDia[i + 1].minuto - delDia[i].minuto;
		} else {
			({ entrada, salida, trabajados } = leerJornada(
				delDia.map((x) => x.minuto),
				programado
			));
		}

		let tardanza = 0;
		let extra = 0;
		let salidaAnticipada = 0;
		if (programado && entrada != null) {
			const horaEntrada = aMinutos(programado.hora_entrada);
			if (entrada > horaEntrada + (horario?.tolerancia_min ?? 0)) tardanza = entrada - horaEntrada;
			if (salida != null) {
				const horaSalida = aMinutos(programado.hora_salida);
				extra = Math.max(0, salida - Math.max(horaSalida, entrada));
				salidaAnticipada = Math.max(0, horaSalida - salida);
			}
		} else if (!programado && horario && !libre) {
			extra = trabajados;
		}

		let estado: EstadoDia;
		if ((contrato.ingreso && fecha < contrato.ingreso) || (contrato.cese && fecha > contrato.cese)) estado = delDia.length ? 'asistio' : 'fuera_contrato';
		else if (!horario) estado = delDia.length ? 'asistio' : 'sin_marcas';
		else if (libre) estado = !delDia.length ? 'sin_marcas' : salida == null ? (fecha < hoy ? 'incompleto' : 'en_curso') : 'asistio';
		else if (!programado) estado = delDia.length ? 'descanso_trabajado' : 'descanso';
		else if (!delDia.length) estado = fecha < hoy ? 'falta' : 'en_curso';
		else if (salida == null) estado = fecha < hoy ? 'incompleto' : 'en_curso';
		else estado = tardanza ? 'tarde' : 'puntual';
		// Hoy sin marcas todavía no es falta: solo si ya pasó la hora de entrada más la tolerancia.
		if (estado === 'en_curso' && !delDia.length && programado) {
			const ahora = new Date(Date.now() - LIMA_MS);
			const minutoAhora = ahora.getUTCHours() * 60 + ahora.getUTCMinutes();
			if (minutoAhora > aMinutos(programado.hora_salida)) estado = 'falta';
		}

		dias.push({ fecha, dia, programado, marcas: delDia, entrada, salida, trabajados, tardanza, extra, salidaAnticipada, estado });
	}
	return dias;
}

export function resumirAsistencia(dias: DiaAsistencia[]): ResumenAsistencia {
	const r: ResumenAsistencia = { laborables: 0, asistidos: 0, faltas: 0, tardanzas: 0, minutosTardanza: 0, incompletos: 0, minutosTrabajados: 0, minutosExtra: 0 };
	for (const d of dias) {
		if (d.programado && d.estado !== 'fuera_contrato') r.laborables++;
		if (d.marcas.length) r.asistidos++;
		if (d.estado === 'falta') r.faltas++;
		if (d.estado === 'incompleto') r.incompletos++;
		if (d.tardanza) {
			r.tardanzas++;
			r.minutosTardanza += d.tardanza;
		}
		r.minutosTrabajados += d.trabajados;
		r.minutosExtra += d.extra;
	}
	return r;
}

/** Minutos de trabajo programados en el periodo (para comparar con lo trabajado). */
export const minutosProgramados = (dias: DiaAsistencia[]) =>
	dias.reduce((t, d) => t + (d.programado && d.estado !== 'fuera_contrato' ? minutosDelDia(d.programado) : 0), 0);
