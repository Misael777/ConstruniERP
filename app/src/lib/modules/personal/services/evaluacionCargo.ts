/**
 * Ticket #152 (27/11/2026) "Evaluar cargo": evaluación del cargo de un trabajador (tabla personal_evaluacion_cargo,
 * migración 20261128110000). Tres formatos según las imágenes de la clienta:
 *   - obrero:      aptitudes con rendimiento (unidad, esperado, real → cumplimiento) + calidad de ejecución y seguridad.
 *   - consultoria: aptitudes técnicas con calificación % + desempeño profesional (criterios con peso y nota 1–5).
 *   - gerencial:   aptitudes gerenciales con peso y nota 1–5 + objetivos (KPI: meta y resultado) + ponderación entre ambos.
 * Evalúa solo el jefe inmediato del trabajador o un administrador (lo valida fn_guardar_evaluacion_cargo).
 * Los cálculos son funciones puras (probadas en evaluacionCargo.test.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AptitudCargo, NivelAptitud } from './personal.service';

export type FormatoEvaluacion = 'obrero' | 'consultoria' | 'gerencial';
export type ValidacionAptitud = 'validado' | 'observado' | 'no_calificado';
export type EstadoEvaluacion = 'en_evaluacion' | 'aprobado' | 'ascenso' | 'baja';

export const FORMATOS_EVALUACION: { value: FormatoEvaluacion; label: string; subtitulo: string }[] = [
	{ value: 'obrero', label: 'Personal obrero', subtitulo: 'Define el cargo y las aptitudes técnicas del trabajador.' },
	{ value: 'consultoria', label: 'Consultoría (diseño y BIM)', subtitulo: 'Evaluación por competencias del desempeño profesional.' },
	{ value: 'gerencial', label: 'Gerencial, jefatura y dirección', subtitulo: 'Evaluación de aptitudes gerenciales y cumplimiento de objetivos.' }
];
export const ESTADOS_EVALUACION: Record<EstadoEvaluacion, { texto: string; clase: string }> = {
	en_evaluacion: { texto: 'En evaluación', clase: 'bg-orange-50 text-orange-600 border-orange-200' },
	aprobado: { texto: 'Cargo aprobado', clase: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
	ascenso: { texto: 'Ascenso recomendado', clase: 'bg-blue-50 text-blue-700 border-blue-200' },
	baja: { texto: 'Cargo dado de baja', clase: 'bg-rose-50 text-rose-600 border-rose-200' }
};
export const VALIDACIONES: Record<ValidacionAptitud, { texto: string; clase: string; icono: string }> = {
	validado: { texto: 'Validado', clase: 'bg-emerald-50 text-emerald-700 border-emerald-200', icono: 'fa-check' },
	observado: { texto: 'Observado', clase: 'bg-orange-50 text-orange-600 border-orange-200', icono: 'fa-circle-exclamation' },
	no_calificado: { texto: 'No calificado', clase: 'bg-rose-50 text-rose-600 border-rose-200', icono: 'fa-circle-xmark' }
};
/** Notas 1–5 de los criterios y aptitudes gerenciales. */
export const NOTAS: { value: number; label: string }[] = [
	{ value: 5, label: 'Excelente (5/5)' },
	{ value: 4, label: 'Bueno (4/5)' },
	{ value: 3, label: 'Regular (3/5)' },
	{ value: 2, label: 'Deficiente (2/5)' },
	{ value: 1, label: 'Muy deficiente (1/5)' }
];
export const UNIDADES_RENDIMIENTO = ['m²/día', 'ml/día', 'm³/día', 'und/día', 'kg/día', 'pto/día'];
export const OPCIONES_CALIDAD = ['Excelente', 'Buena', 'Regular', 'Deficiente'];
export const OPCIONES_SEGURIDAD = ['Cumple', 'Cumple con observaciones', 'No cumple'];

export interface AptitudEvaluada {
	actividad: string;
	nivelDeclarado: NivelAptitud | null;
	nivelEvaluado: NivelAptitud | null;
	/** obrero */
	unidad?: string | null;
	esperado?: number | null;
	real?: number | null;
	/** consultoria: calificación 0–100 */
	calificacion?: number | null;
	/** validación puesta a mano; null = automática según el cumplimiento/calificación */
	validacion?: ValidacionAptitud | null;
}
export interface CriterioEvaluado {
	criterio: string;
	peso: number;
	nota: number | null;
}
export interface ObjetivoEvaluado {
	indicador: string;
	unidad: string;
	meta: number | null;
	real: number | null;
}

export interface EvaluacionCargo {
	id_evaluacion?: number;
	id_personal: number;
	id_cargo_historial: number | null;
	formato: FormatoEvaluacion;
	cargo: string;
	periodo_inicio: string;
	periodo_fin: string;
	aptitudes: AptitudEvaluada[];
	criterios: CriterioEvaluado[];
	objetivos: ObjetivoEvaluado[];
	peso_aptitudes: number | null;
	calificacion_final: number | null;
	observaciones: string | null;
	calidad_ejecucion: string | null;
	cumplimiento_seguridad: string | null;
	evaluado_por: string;
	fecha_evaluacion: string;
	estado: EstadoEvaluacion;
	sustento: string;
	cargo_ascenso: string | null;
	registrado_por?: string | null;
	created_at?: string;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Formato sugerido: gerencial por el nombre del cargo; obrero si es de construcción civil u obra; si no, consultoría. */
export function formatoSugerido(cargo: string, opciones: { esObra?: boolean } = {}): FormatoEvaluacion {
	if (/gerent|director|jef[ea]|coordinador|administrador|supervisor/i.test(cargo)) return 'gerencial';
	if (opciones.esObra || /operari|oficial|pe[oó]n|ayudante|capataz|maestro de obra|alba[nñ]il|fierrer|carpinter|electricista|gasfiter|soldador/i.test(cargo)) return 'obrero';
	return 'consultoria';
}

/** Obrero: rendimiento real / esperado, en % (0–100, redondeado). null si falta un dato. */
export function cumplimientoRendimiento(a: Pick<AptitudEvaluada, 'esperado' | 'real'>): number | null {
	if (a.esperado == null || a.real == null || !(a.esperado > 0)) return null;
	return Math.round(Math.min(Math.max(a.real / a.esperado, 0), 1) * 100);
}

/** % de la aptitud según el formato (obrero: cumplimiento; consultoría: calificación). */
export function porcentajeAptitud(a: AptitudEvaluada, formato: FormatoEvaluacion): number | null {
	if (formato === 'obrero') return cumplimientoRendimiento(a);
	return a.calificacion == null ? null : Math.min(Math.max(a.calificacion, 0), 100);
}

/** Validación automática: 80 % o más validado, 60 % o más observado, menos no calificado. */
export function validacionAutomatica(pct: number | null): ValidacionAptitud | null {
	if (pct == null) return null;
	return pct >= 80 ? 'validado' : pct >= 60 ? 'observado' : 'no_calificado';
}

/** Puntaje ponderado de un criterio (peso × nota/5) y subtotal de la tabla. */
export const puntajeCriterio = (c: CriterioEvaluado) => (c.nota == null ? 0 : r1((c.peso * c.nota) / 5));
export function subtotalCriterios(criterios: CriterioEvaluado[]): { pesoTotal: number; subtotal: number } {
	return {
		pesoTotal: r1(criterios.reduce((t, c) => t + (Number(c.peso) || 0), 0)),
		subtotal: r1(criterios.reduce((t, c) => t + puntajeCriterio(c), 0))
	};
}

/** KPI: resultado / meta en % (0–100). */
export function cumplimientoObjetivo(o: ObjetivoEvaluado): number | null {
	if (o.meta == null || o.real == null || !(o.meta > 0)) return null;
	return Math.round(Math.min(Math.max(o.real / o.meta, 0), 1) * 100);
}
export function subtotalObjetivos(objetivos: ObjetivoEvaluado[]): number | null {
	const v = objetivos.map(cumplimientoObjetivo).filter((x): x is number => x != null);
	return v.length ? r1(v.reduce((t, x) => t + x, 0) / v.length) : null;
}

/** Promedio de los % de las aptitudes (obrero y consultoría). */
export function promedioAptitudes(aptitudes: AptitudEvaluada[], formato: FormatoEvaluacion): number | null {
	const v = aptitudes.map((a) => porcentajeAptitud(a, formato)).filter((x): x is number => x != null);
	return v.length ? r1(v.reduce((t, x) => t + x, 0) / v.length) : null;
}

/**
 * Calificación final:
 *   obrero:      promedio del cumplimiento de las aptitudes.
 *   consultoría: promedio entre las aptitudes técnicas y el desempeño profesional (si falta uno, el otro).
 *   gerencial:   aptitudes × peso + objetivos × (100 − peso) (en la imagen: 89 × 40 % + 92 × 60 % = 90.8 %).
 */
export function calificacionFinal(e: Pick<EvaluacionCargo, 'formato' | 'aptitudes' | 'criterios' | 'objetivos' | 'peso_aptitudes'>): number | null {
	if (e.formato === 'obrero') return promedioAptitudes(e.aptitudes, 'obrero');
	if (e.formato === 'consultoria') {
		const ap = promedioAptitudes(e.aptitudes, 'consultoria');
		const de = e.criterios.length ? subtotalCriterios(e.criterios).subtotal : null;
		if (ap == null) return de;
		if (de == null) return ap;
		return r1((ap + de) / 2);
	}
	const ap = e.criterios.length ? subtotalCriterios(e.criterios).subtotal : null;
	const ob = subtotalObjetivos(e.objetivos);
	const peso = e.peso_aptitudes ?? 40;
	if (ap == null) return ob;
	if (ob == null) return ap;
	return r1((ap * peso) / 100 + (ob * (100 - peso)) / 100);
}

export const CRITERIOS_CONSULTORIA: CriterioEvaluado[] = [
	{ criterio: 'Calidad técnica', peso: 30, nota: null },
	{ criterio: 'Cumplimiento de plazos', peso: 25, nota: null },
	{ criterio: 'Autonomía y resolución de problemas', peso: 20, nota: null },
	{ criterio: 'Coordinación y comunicación', peso: 15, nota: null },
	{ criterio: 'Organización y responsabilidad', peso: 10, nota: null }
];
export const APTITUDES_GERENCIALES: CriterioEvaluado[] = [
	{ criterio: 'Dirección estratégica', peso: 25, nota: null },
	{ criterio: 'Liderazgo de gerencias', peso: 20, nota: null },
	{ criterio: 'Toma de decisiones', peso: 20, nota: null },
	{ criterio: 'Gestión financiera y riesgos', peso: 15, nota: null },
	{ criterio: 'Gestión interáreas', peso: 10, nota: null },
	{ criterio: 'Gobernanza y responsabilidad', peso: 10, nota: null }
];
export const OBJETIVOS_GERENCIALES: ObjetivoEvaluado[] = [
	{ indicador: 'Facturación del período', unidad: 'S/', meta: null, real: null },
	{ indicador: 'Margen operativo', unidad: '%', meta: null, real: null },
	{ indicador: 'Cumplimiento del plan empresarial', unidad: '%', meta: null, real: null },
	{ indicador: 'Metas consolidadas de las áreas', unidad: '%', meta: null, real: null },
	{ indicador: 'Cobranza dentro del plazo', unidad: '%', meta: null, real: null }
];

/** Aptitudes del cargo (historial de cargos) como filas a evaluar: el nivel declarado es el del cargo. */
export function aptitudesDesdeCargo(aptitudes: AptitudCargo[] | undefined): AptitudEvaluada[] {
	return (aptitudes ?? [])
		.filter((a) => a.actividad?.trim())
		.map((a) => ({ actividad: a.actividad.trim(), nivelDeclarado: a.nivel ?? null, nivelEvaluado: a.nivel ?? null, unidad: null, esperado: null, real: null, calificacion: null, validacion: null }));
}

/** Evaluaciones de un trabajador, de la más reciente a la más antigua. Sin la migración: lista vacía. */
export async function getEvaluacionesCargo(client: SupabaseClient, idPersonal: number): Promise<EvaluacionCargo[]> {
	const { data, error } = await client
		.from('personal_evaluacion_cargo')
		.select('*')
		.eq('id_personal', idPersonal)
		.order('fecha_evaluacion', { ascending: false })
		.order('created_at', { ascending: false });
	if (error) return [];
	return ((data ?? []) as any[]).map((r) => ({
		...r,
		peso_aptitudes: r.peso_aptitudes != null ? Number(r.peso_aptitudes) : null,
		calificacion_final: r.calificacion_final != null ? Number(r.calificacion_final) : null,
		aptitudes: Array.isArray(r.aptitudes) ? r.aptitudes : [],
		criterios: Array.isArray(r.criterios) ? r.criterios : [],
		objetivos: Array.isArray(r.objetivos) ? r.objetivos : []
	})) as EvaluacionCargo[];
}

/** Guarda la evaluación (fn_guardar_evaluacion_cargo valida que sea el jefe inmediato o un administrador). */
export async function guardarEvaluacionCargo(client: SupabaseClient, e: EvaluacionCargo): Promise<number> {
	const { data, error } = await client.rpc('fn_guardar_evaluacion_cargo', { p: { ...e, calificacion_final: calificacionFinal(e) } });
	if (error) throw error;
	return Number(data);
}
