/**
 * Tareo semanal por obra (pedido del cliente, 06/11/2026): el residente de obra revisa las horas de cada trabajador
 * en la semana (lunes a domingo), corrige los días que hagan falta, marca feriados, agrega bonos y envía a Cuentas por
 * Pagar. Tablas y funciones en supabase/migrations/20261106120000_tareo_planilla.sql.
 *
 * Horas del día: las calcula calcularAsistencia (asistencia.service.ts) con las marcas del huellero de ESTA obra (o
 * de un huellero sin obra, si el trabajador está asignado a ella). Un ajuste del residente (tareo_ajuste) reemplaza
 * el cálculo; un feriado sin ajuste reconoce la jornada.
 *
 * Pago por DÍA o MEDIO DÍA (ticket #132, 21/11/2026: "nosotros no pagamos por horas"; antes era por hora exacta):
 * S/ por día = monto_pago ÷ días calendario del periodo (diaria 1, semanal 7, quincenal 15, mensual 30). Cada día vale
 * 1 si las horas reconocidas superan la mitad de su jornada, ½ si hay horas pero no pasan la mitad, y 0 sin horas
 * (ver fraccionDia). Pago del día = fracción × S/ por día. Total = suma + bonos. La jornada es el promedio de los días
 * de su horario (sin horario o libre, 8 h); "Medio día" en la edición reconoce justo la mitad → ½ día.
 *
 * Tickets #118/#119 (24/11/2026, migración 20261124120000): cada trabajador queda "Pendiente" hasta que su JEFE
 * INMEDIATO (personal.id_jefe_inmediato) o un administrador lo aprueba; solo lo aprobado se envía a CxP, y si el total
 * cambia después hay que aprobarlo de nuevo. Vista Proyección (Obra): días registrados + días previstos, fondo separado y
 * reservas (cuota "Proyección de planilla" en CxP). Pestaña Consultoría: tareo por quincena o mes del personal que no es
 * de obra (ver cargarTareoConsultoria).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { calcularAsistencia, sumarDias, diaSemana, reloj, duracion, type Marca, type DiaAsistencia } from './asistencia.service';
import { minutosDelDia, esLibre, type Horario } from '$lib/modules/personal/services/horarios.service';
import { nombreCompleto, type Personal } from '$lib/modules/personal/services/personal.service';
import { nombreCentro } from './huelleros.service';

const LIMA_MS = 5 * 3_600_000;
const EVENTO_RECHAZO = 20;
export const JORNADA_POR_DEFECTO_MIN = 8 * 60;
export const DIAS_PERIODO: Record<string, number> = { diaria: 1, semanal: 7, quincenal: 15, mensual: 30 };

export type EstadoAjuste = 'asistio' | 'feriado' | 'sin_trabajo' | 'falta';
/** Estado que se muestra en la celda. pendiente = marcó entrada y no salida: el residente debe revisarlo. */
export type EstadoCelda = EstadoAjuste | 'pendiente' | 'sin_marcas' | 'descanso' | 'por_venir' | 'fuera_contrato';
/** De dónde salen las horas: huella o rostro (huellero), manual (marca sin huellero), modificado (residente). */
export type OrigenDia = 'huella' | 'rostro' | 'manual' | 'modificado' | 'feriado' | null;

export const ESTADOS_AJUSTE: { value: EstadoAjuste; label: string }[] = [
	{ value: 'asistio', label: 'Asistió' },
	{ value: 'feriado', label: 'Feriado' },
	{ value: 'sin_trabajo', label: 'Sin trabajo en obra' },
	{ value: 'falta', label: 'Falta' }
];

export const ESTADOS_CELDA: Record<EstadoCelda, { texto: string; clase: string }> = {
	asistio: { texto: 'Asistió', clase: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
	feriado: { texto: 'Feriado', clase: 'bg-sky-50 text-sky-800 border-sky-200' },
	sin_trabajo: { texto: 'Sin trabajo', clase: 'bg-slate-100 text-slate-600 border-slate-200' },
	falta: { texto: 'Falta', clase: 'bg-rose-50 text-rose-700 border-rose-200' },
	pendiente: { texto: 'Sin salida', clase: 'bg-orange-50 text-orange-700 border-orange-200' },
	sin_marcas: { texto: 'Sin marcas', clase: 'bg-white text-slate-400 border-slate-200' },
	descanso: { texto: 'Descanso', clase: 'bg-slate-50 text-slate-400 border-slate-100' },
	por_venir: { texto: '', clase: 'bg-white text-slate-300 border-dashed border-slate-200' },
	fuera_contrato: { texto: 'Fuera de contrato', clase: 'bg-slate-50 text-slate-300 border-slate-100' }
};

export const ORIGENES: Record<Exclude<OrigenDia, null>, { texto: string; icono: string; color: string }> = {
	huella: { texto: 'Huella (huellero)', icono: 'fa-fingerprint', color: 'text-emerald-600' },
	rostro: { texto: 'Rostro (huellero)', icono: 'fa-face-smile', color: 'text-blue-600' },
	manual: { texto: 'Marca manual', icono: 'fa-keyboard', color: 'text-slate-500' },
	modificado: { texto: 'Modificado por el residente', icono: 'fa-pen', color: 'text-amber-600' },
	feriado: { texto: 'Feriado', icono: 'fa-umbrella-beach', color: 'text-sky-600' }
};

export interface MarcaTareo extends Marca {
	/** 1 huella, 15 rostro (ZKTeco); null si no vino del huellero. */
	modo: number | null;
	manual: boolean;
}

export interface AjusteTareo {
	id_personal: number;
	fecha: string;
	estado: EstadoAjuste;
	minutos_reconocidos: number;
	observacion: string | null;
	usuario: string | null;
}

/** Ticket #117: horas extra del día que registra el jefe inmediato (o un administrador); se pagan por hora. */
export interface ExtraTareo {
	id_personal: number;
	id_centro_costo?: number;
	fecha: string;
	minutos: number;
	observacion: string | null;
	registrado_por: string | null;
}

export interface FeriadoTareo {
	id_feriado: number;
	fecha: string;
	id_centro_costo: number | null;
	descripcion: string | null;
}

export interface TrabajadorGuardado {
	id_personal: number;
	bonos: number;
	total: number;
	enviado: number;
	fecha_cxp: string | null;
	tareo_envio?: { monto: number; id_pago: number | null }[] | null;
	aprobado_monto?: number | null;
	aprobado_por?: string | null;
	aprobado_en?: string | null;
	reserva_monto?: number | null;
	reserva_fecha?: string | null;
}

export interface DiaTareo {
	fecha: string;
	dia: number;
	estado: EstadoCelda;
	/** Lo que dice el huellero (antes de ajustes). */
	minutosHuellero: number;
	/** Horas reconocidas para el pago. */
	minutos: number;
	origen: OrigenDia;
	ajuste: AjusteTareo | null;
	feriado: FeriadoTareo | null;
	asistencia: DiaAsistencia | null;
	/** Ticket #132: 1 = día completo, 0.5 = medio día, 0 = sin pago. */
	fraccion: number;
	pago: number;
	/** Ticket #117: lo que el huellero marca después de su hora de salida (no se paga solo; sirve de referencia). */
	extraHuellero: number;
	/** Horas extra registradas por el jefe inmediato (se pagan por hora). */
	extra: ExtraTareo | null;
}

export interface FilaTareo {
	personal: Personal;
	horario: Horario | null;
	dias: DiaTareo[];
	jornadaMin: number;
	tarifaDia: number;
	tarifaHora: number;
	minutos: number;
	diasTrabajados: number;
	/** Ticket #132: días pagados (suma de fracciones: 1 o ½ por día). */
	diasPagados: number;
	subtotal: number;
	bonos: number;
	total: number;
	enviado: number;
	pendiente: number;
	fechaCxp: string | null;
	/** Días sin salida o con algo que revisar. */
	porRevisar: number;
	sinMonto: boolean;
	/** Tickets #118/#119: total aprobado por el jefe inmediato (null = sin aprobar) y quién/cuándo. */
	aprobadoMonto: number | null;
	aprobadoPor: string | null;
	aprobadoEn: string | null;
	/** Reserva programada desde la vista Proyección (monto y fecha de la cuota proyectada en CxP). */
	reservaMonto: number | null;
	reservaFecha: string | null;
	/** Ticket #117: horas extra registradas por el jefe en el periodo y su importe (minutos × S/ por hora). */
	extrasMin: number;
	extrasMonto: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Minutos de la jornada del trabajador: promedio de sus días programados; sin horario fijo, 8 h. */
export function jornadaMinutos(horario: Pick<Horario, 'horario_dia' | 'tipo'> | null): number {
	if (!horario || esLibre(horario) || !horario.horario_dia.length) return JORNADA_POR_DEFECTO_MIN;
	const total = horario.horario_dia.reduce((t, d) => t + minutosDelDia(d), 0);
	return Math.round(total / horario.horario_dia.length) || JORNADA_POR_DEFECTO_MIN;
}

export function tarifas(p: Pick<Personal, 'monto_pago' | 'periodicidad_pago'>, jornadaMin: number) {
	const monto = Number(p.monto_pago ?? 0);
	const tarifaDia = monto > 0 ? monto / (DIAS_PERIODO[p.periodicidad_pago ?? ''] ?? 30) : 0;
	return { tarifaDia, tarifaHora: jornadaMin > 0 ? tarifaDia / (jornadaMin / 60) : 0 };
}

/** Ticket #132: fracción de día que se paga según las horas reconocidas: más de la mitad de la jornada = 1 día,
 * algo de horas hasta la mitad = ½ día, sin horas = 0. */
export function fraccionDia(minutos: number, jornadaMin: number): number {
	if (minutos <= 0) return 0;
	return minutos > (jornadaMin || JORNADA_POR_DEFECTO_MIN) / 2 ? 1 : 0.5;
}

/** "1 día", "½ día", "3½ días". */
export function textoDias(d: number): string {
	const entero = Math.floor(d);
	const medio = d - entero >= 0.5;
	const num = entero === 0 && medio ? '½' : `${entero}${medio ? '½' : ''}`;
	return `${num} día${d > 1 || d === 0 ? 's' : ''}`;
}

/** Lunes de la semana de `fecha`. */
export const lunesDe = (fecha: string) => sumarDias(fecha, 1 - diaSemana(fecha));

/** Origen de las horas del día según cómo se marcó. */
function origenDeMarcas(marcas: MarcaTareo[]): OrigenDia {
	if (!marcas.length) return null;
	if (marcas.some((m) => m.manual)) return 'manual';
	return marcas.some((m) => m.modo === 15) ? 'rostro' : 'huella';
}

/** Arma la fila de un trabajador para la semana que empieza en `lunes`. Pura (sin base), probada en tareo.service.test.ts.
 * `asignado` = el trabajador es de esta obra: solo a ellos el feriado les reconoce la jornada (a uno de otra obra
 * que vino algún día se le paga lo trabajado aquí; su feriado lo reconoce el tareo de su propia obra). */
export function calcularFila(
	p: Personal,
	horario: Horario | null,
	marcas: MarcaTareo[],
	ajustes: AjusteTareo[],
	feriados: FeriadoTareo[],
	guardado: TrabajadorGuardado | null,
	lunes: string,
	hoy: string,
	asignado = true,
	/** Días del periodo desde `lunes` (7 = semana; Consultoría usa la quincena o el mes). */
	nDias = 7,
	extras: ExtraTareo[] = []
): FilaTareo {
	const domingo = sumarDias(lunes, nDias - 1);
	const asistencia = calcularAsistencia(marcas, horario, lunes, domingo, hoy, { ingreso: p.fecha_ingreso, cese: p.fecha_cese });
	const porFecha = new Map(asistencia.map((d) => [d.fecha, d]));
	const jornadaMin = jornadaMinutos(horario);
	const { tarifaDia, tarifaHora } = tarifas(p, jornadaMin);

	const dias: DiaTareo[] = [];
	for (let i = 0; i < nDias; i++) {
		const fecha = sumarDias(lunes, i);
		const a = porFecha.get(fecha) ?? null;
		const ajuste = ajustes.find((x) => x.fecha === fecha && x.id_personal === p.id_personal) ?? null;
		const feriado = asignado ? (feriados.find((f) => f.fecha === fecha) ?? null) : null;
		const minutosHuellero = a?.trabajados ?? 0;
		// Ticket #117: con horario fijo, salir después de la hora de salida no suma: cuenta hasta su salida normal.
		// Las horas extra las registra el jefe inmediato (ExtraTareo).
		const extraHuellero = a?.programado ? (a.extra ?? 0) : 0;
		const minutosJornada = Math.max(0, minutosHuellero - extraHuellero);
		const extra = extras.find((x) => x.fecha === fecha && x.id_personal === p.id_personal) ?? null;
		let estado: EstadoCelda;
		let minutos = 0;
		let origen: OrigenDia = origenDeMarcas((a?.marcas ?? []) as MarcaTareo[]);

		if (ajuste) {
			estado = ajuste.estado;
			minutos = ajuste.minutos_reconocidos;
			origen = 'modificado';
		} else if (a?.estado === 'fuera_contrato') {
			estado = 'fuera_contrato';
		} else if (feriado) {
			// Feriado: se reconoce la jornada si era día de trabajo (o lo trabajado, si es más).
			const laborable = a?.programado ? minutosDelDia(a.programado) : horario && !esLibre(horario) ? 0 : diaSemana(fecha) < 7 ? jornadaMin : 0;
			estado = 'feriado';
			minutos = Math.max(laborable, minutosJornada);
			origen = 'feriado';
		} else if (!a) {
			estado = 'por_venir';
		} else if (minutosJornada > 0) {
			estado = 'asistio';
			minutos = minutosJornada;
		} else if (a.estado === 'incompleto') {
			estado = 'pendiente';
		} else if (a.estado === 'en_curso') {
			estado = a.marcas.length ? 'pendiente' : 'por_venir';
		} else if (a.estado === 'falta') {
			estado = 'falta';
		} else if (a.estado === 'descanso') {
			estado = 'descanso';
		} else {
			estado = 'sin_marcas';
		}
		const fraccion = fraccionDia(minutos, jornadaMin);
		dias.push({ fecha, dia: diaSemana(fecha), estado, minutosHuellero, minutos, origen, ajuste, feriado, asistencia: a, fraccion, pago: r2(fraccion * tarifaDia), extraHuellero, extra });
	}
	const extrasMin = dias.reduce((t, d) => t + (d.extra?.minutos ?? 0), 0);
	const extrasMonto = r2((extrasMin / 60) * tarifaHora);

	const minutos = dias.reduce((t, d) => t + d.minutos, 0);
	const subtotal = r2(dias.reduce((t, d) => t + d.pago, 0));
	const bonos = Number(guardado?.bonos ?? 0);
	const total = r2(subtotal + extrasMonto + bonos);
	const enviado = Number(guardado?.enviado ?? 0);
	return {
		personal: p,
		horario,
		dias,
		jornadaMin,
		tarifaDia,
		tarifaHora,
		minutos,
		diasTrabajados: dias.filter((d) => d.minutos > 0).length,
		diasPagados: dias.reduce((t, d) => t + d.fraccion, 0),
		subtotal,
		bonos,
		total,
		enviado,
		pendiente: r2(Math.max(total - enviado, 0)),
		fechaCxp: guardado?.fecha_cxp ?? null,
		porRevisar: dias.filter((d) => d.estado === 'pendiente').length,
		sinMonto: !(Number(p.monto_pago ?? 0) > 0),
		aprobadoMonto: guardado?.aprobado_monto != null ? Number(guardado.aprobado_monto) : null,
		aprobadoPor: guardado?.aprobado_por ?? null,
		aprobadoEn: guardado?.aprobado_en ?? null,
		reservaMonto: guardado?.reserva_monto != null ? Number(guardado.reserva_monto) : null,
		reservaFecha: guardado?.reserva_fecha ?? null,
		extrasMin,
		extrasMonto
	};
}

// ─────────────────────────── Aprobación (tickets #118/#119) ───────────────────────────

/** aprobado: el jefe aprobó este mismo total. cambio: aprobó otro total (hay que aprobar de nuevo). previo: se envió
 * antes de que existiera la aprobación (vale como aprobado). pendiente: sin aprobar. */
export type EstadoAprobacion = 'aprobado' | 'cambio' | 'previo' | 'pendiente';

export function aprobacionDe(f: Pick<FilaTareo, 'aprobadoMonto' | 'enviado'>, totalActual: number): EstadoAprobacion {
	if (f.aprobadoMonto == null) return f.enviado > 0 ? 'previo' : 'pendiente';
	return Math.abs(f.aprobadoMonto - totalActual) <= 0.005 ? 'aprobado' : 'cambio';
}
export const estaAprobado = (e: EstadoAprobacion) => e === 'aprobado' || e === 'previo';

// ─────────────────────────── Proyección (ticket #118) ───────────────────────────

export interface DiaProyectado {
	fecha: string;
	dia: number;
	/** true = día ya registrado (hasta hoy); false = previsto. */
	registrado: boolean;
	fraccion: number;
}

export interface ProyeccionFila {
	dias: DiaProyectado[];
	/** Lo ya ganado según la asistencia registrada (hasta hoy). */
	acumulado: number;
	/** Días previstos (desde mañana) × S/ por día. */
	porCompletar: number;
	diasPrevistos: number;
}

/** Fracción prevista de un día futuro según su horario: día de trabajo = 1 (½ si su jornada de ese día no pasa la
 * mitad de la normal); descanso = 0; sin horario fijo, de lunes a sábado. Fuera de contrato = 0. */
export function fraccionPrevista(p: Pick<Personal, 'fecha_ingreso' | 'fecha_cese'>, horario: Horario | null, jornadaMin: number, fecha: string): number {
	if ((p.fecha_ingreso && fecha < p.fecha_ingreso) || (p.fecha_cese && fecha > p.fecha_cese)) return 0;
	const dia = diaSemana(fecha);
	if (!horario || esLibre(horario) || !horario.horario_dia.length) return dia < 7 ? 1 : 0;
	const hd = horario.horario_dia.find((x) => x.dia === dia);
	return hd ? fraccionDia(minutosDelDia(hd), jornadaMin) : 0;
}

/** Proyección de la semana de un trabajador: lo registrado hasta hoy y lo previsto desde mañana. Pura. */
export function proyectarFila(f: FilaTareo, hoy: string): ProyeccionFila {
	const dias = f.dias.map((d) => {
		const registrado = d.fecha <= hoy;
		// Un día futuro ya marcado como feriado (o editado) se prevé con lo reconocido; si no, según su horario.
		const fraccion = registrado || d.estado !== 'por_venir' ? d.fraccion : fraccionPrevista(f.personal, f.horario, f.jornadaMin, d.fecha);
		return { fecha: d.fecha, dia: d.dia, registrado, fraccion };
	});
	const acumulado = r2(f.dias.filter((d) => d.fecha <= hoy).reduce((t, d) => t + d.pago, 0));
	const diasPrevistos = dias.filter((d) => !d.registrado).reduce((t, d) => t + d.fraccion, 0);
	return { dias, acumulado, porCompletar: r2(diasPrevistos * f.tarifaDia), diasPrevistos };
}

// ─────────────────────────── Datos ───────────────────────────

export interface ObraTareo {
	id_centro_costo: number;
	codigo: string;
	nombre: string;
}

/** Ids de los trabajadores asignados a la obra en personal_obra (varias obras por trabajador). Vacío si la base aún
 * no tiene esa tabla (migración 20261116120000): entonces solo cuenta la obra principal. */
async function idsPorObra(client: SupabaseClient, idCentroCosto: number): Promise<number[]> {
	const { data, error } = await client.from('personal_obra').select('id_personal').eq('id_centro_costo', idCentroCosto);
	return error ? [] : (data ?? []).map((x) => x.id_personal as number);
}

/** Ticket #118: un centro es de OBRA si es un proyecto que no es de consultoría. El personal cuya obra o área
 * principal no es de obra (consultoría, corporativo, bolsa general, sin centro) va a la pestaña Consultoría. */
export function esCentroObra(c: { tipo?: string | null; proyecto?: { tipo_venta?: string | null } | { tipo_venta?: string | null }[] | null } | null | undefined): boolean {
	if (!c || c.tipo !== 'proyecto') return false;
	const pr = Array.isArray(c.proyecto) ? c.proyecto[0] : c.proyecto;
	return (pr?.tipo_venta ?? null) !== 'consultoria';
}

/** Obras (ver esCentroObra) con personal activo asignado (principal u otra de sus obras) o con un huellero instalado. */
export async function getObrasTareo(client: SupabaseClient): Promise<ObraTareo[]> {
	const [{ data: per, error: e1 }, { data: disp, error: e2 }, { data: otras }] = await Promise.all([
		client.from('personal').select('id_centro_costo').eq('estado', 'activo').not('id_centro_costo', 'is', null),
		client.from('asistencia_dispositivo').select('id_centro_costo').not('id_centro_costo', 'is', null),
		client.from('personal_obra').select('id_centro_costo, personal!inner(estado)').eq('personal.estado', 'activo') // sin la tabla: data null
	]);
	if (e1) throw e1;
	if (e2) throw e2;
	const ids = [...new Set([...(per ?? []), ...(disp ?? []), ...(otras ?? [])].map((x) => x.id_centro_costo as number))];
	if (!ids.length) return [];
	const { data, error } = await client.from('centro_costo').select('id_centro_costo, codigo, nombre, tipo, proyecto(nombre_proyecto, tipo_venta)').in('id_centro_costo', ids).order('codigo');
	if (error) throw error;
	// El centro de un proyecto se llama solo con su número: se muestra el nombre del proyecto.
	return (data ?? []).filter((c: any) => esCentroObra(c)).map((c: any) => ({ id_centro_costo: c.id_centro_costo, ...nombreCentro(c)! }));
}

/** Diagnóstico de marcas (pedido del usuario, 19/11/2026): TODAS las marcas del trabajador en la semana, cuenten o
 * no en el tareo de esta obra, con el motivo. Así el residente ve por qué un día sale Falta sin revisar la base. */
export interface MarcaDiagnostico {
	fecha: string;
	hora: string;
	huellero: string;
	/** Obra en la que quedó registrada la marca (la del huellero al recibirla). */
	obra: string;
	modo: number | null;
	evento: number | null;
	cuenta: boolean;
	motivo: string;
}

/** Por qué una marca cuenta (o no) en el tareo de `idCentroCosto`. Mismo criterio que el filtro de cargarTareo. */
export function motivoMarca(
	m: { evento: number | null; id_centro_costo: number | null; id_dispositivo: number | null; pin: string },
	idCentroCosto: number,
	pinsPrincipal: Set<string>,
	nombreObra: (id: number) => string
): { cuenta: boolean; motivo: string } {
	if (m.evento != null && m.evento >= EVENTO_RECHAZO) return { cuenta: false, motivo: `Rechazada por el huellero (evento ${m.evento}: no lo reconoció o no tenía acceso)` };
	if (m.id_centro_costo === idCentroCosto) return { cuenta: true, motivo: m.id_dispositivo == null ? 'Marca manual en esta obra' : 'Huellero de esta obra' };
	if (m.id_centro_costo == null) {
		const origen = m.id_dispositivo == null ? 'Marca desde el ERP (Mi asistencia)' : 'Huellero sin obra asignada';
		return pinsPrincipal.has(m.pin)
			? { cuenta: true, motivo: `${origen}: cuenta en la obra principal del trabajador (esta)` }
			: { cuenta: false, motivo: `${origen}: solo cuenta en la obra principal del trabajador, que no es esta` };
	}
	return { cuenta: false, motivo: `Registrada en otra obra (${nombreObra(m.id_centro_costo)}): el huellero está asignado a esa obra. Cuenta en el tareo de esa obra.` };
}

export interface DatosTareo {
	filas: FilaTareo[];
	feriados: FeriadoTareo[];
	/** Por id_personal: todas sus marcas de la semana con el motivo de si cuentan o no. */
	diagnostico: Record<number, MarcaDiagnostico[]>;
	semana: { estado: 'borrador' | 'aprobado'; aprobado_por: string | null; aprobado_en: string | null; fondo_separado: number | null } | null;
	/** Ticket #133: lo marcado como enviado cuyo pago en CxP ya se eliminó (se puede liberar para reenviar). */
	enviadoSinPago: number;
}

/** Horas extra del periodo (#117). Sin la migración 20261125120000 (tabla tareo_extra): ninguna. */
async function cargarExtras(client: SupabaseClient, ids: number[], desde: string, hasta: string, idCentroCosto?: number): Promise<ExtraTareo[]> {
	if (!ids.length) return [];
	let q = client.from('tareo_extra').select('id_personal, id_centro_costo, fecha, minutos, observacion, registrado_por').in('id_personal', ids).gte('fecha', desde).lte('fecha', hasta);
	if (idCentroCosto) q = q.eq('id_centro_costo', idCentroCosto);
	const { data, error } = await q;
	return error ? [] : ((data ?? []) as ExtraTareo[]);
}

/** Ticket #117: el jefe inmediato (o un administrador) registra las horas extra del día (0 = quitarlas). */
export async function registrarHorasExtra(client: SupabaseClient, idPersonal: number, idCentroCosto: number, fecha: string, minutos: number, observacion: string): Promise<void> {
	const { error } = await client.rpc('fn_tareo_horas_extra', {
		p_id_personal: idPersonal,
		p_id_centro_costo: idCentroCosto,
		p_fecha: fecha,
		p_minutos: Math.max(0, Math.round(minutos)),
		p_observacion: observacion.trim() || null
	});
	if (error) throw error;
}

const CAMPOS_GUARDADO = 'id_personal, bonos, total, enviado, fecha_cxp, aprobado_monto, aprobado_por, aprobado_en, reserva_monto, reserva_fecha, tareo_envio(monto, id_pago)';

/** Carga la semana de la obra: trabajadores asignados, los que marcaron en sus huelleros y los ya enviados. */
export async function cargarTareo(client: SupabaseClient, idCentroCosto: number, lunes: string, hoy: string): Promise<DatosTareo> {
	const domingo = sumarDias(lunes, 6);
	// Obra principal por su FK: con personal_obra hay dos caminos de personal a centro_costo (PGRST201).
	const seleccion = '*, centro_costo!personal_id_centro_costo_fkey(codigo, nombre, tipo, proyecto(tipo_venta)), horario(*, horario_dia(*))';

	// Asignados: obra principal o cualquiera de sus obras (personal_obra).
	const idsObra = await idsPorObra(client, idCentroCosto);
	const { data: asignados, error: eA } = await client
		.from('personal')
		.select(seleccion)
		.or(idsObra.length ? `id_centro_costo.eq.${idCentroCosto},id_personal.in.(${idsObra.join(',')})` : `id_centro_costo.eq.${idCentroCosto}`)
		.neq('estado', 'baja');
	if (eA) throw eA;
	const pinsAsignados = (asignados ?? []).map((p) => p.pin as string);
	// Las marcas sin obra (huellero sin lugar, «Mi asistencia») cuentan solo en su obra PRINCIPAL: si no, un trabajador
	// con varias obras las sumaría en cada una.
	const pinsPrincipal = new Set((asignados ?? []).filter((p) => p.id_centro_costo === idCentroCosto).map((p) => p.pin as string));

	let consultaMarcas = client
		.from('asistencia_marcacion')
		.select('pin, marcado_en, evento, modo_verificacion, id_dispositivo, id_centro_costo, asistencia_dispositivo(nombre)')
		.gte('marcado_en', `${lunes}T00:00:00-05:00`)
		.lt('marcado_en', `${sumarDias(domingo, 1)}T00:00:00-05:00`)
		.order('marcado_en');
	const pinsLista = pinsAsignados.map((x) => `"${x.replace(/"/g, '')}"`).join(',');
	consultaMarcas = pinsLista
		? consultaMarcas.or(`id_centro_costo.eq.${idCentroCosto},pin.in.(${pinsLista})`)
		: consultaMarcas.eq('id_centro_costo', idCentroCosto);

	const [{ data: marcasCrudas, error: eM }, { data: semana, error: eS }, { data: feriados, error: eF }] = await Promise.all([
		consultaMarcas,
		client
			.from('tareo_semana')
			.select(`id_tareo, estado, aprobado_por, aprobado_en, fondo_separado, tareo_trabajador(${CAMPOS_GUARDADO})`)
			.eq('id_centro_costo', idCentroCosto)
			.eq('semana_inicio', lunes)
			.eq('periodo', 'semanal')
			.maybeSingle(),
		client.from('tareo_feriado').select('id_feriado, fecha, id_centro_costo, descripcion').gte('fecha', lunes).lte('fecha', domingo).or(`id_centro_costo.is.null,id_centro_costo.eq.${idCentroCosto}`)
	]);
	if (eM) throw eM;
	if (eS) throw eS;
	if (eF) throw eF;

	const asignadosPorPin = new Set(pinsAsignados);
	// Marca de esta obra, o de un huellero sin obra si el trabajador es de esta obra.
	const marcasValidas = (marcasCrudas ?? []).filter(
		(m) => (m.evento == null || m.evento < EVENTO_RECHAZO) && (m.id_centro_costo === idCentroCosto || (m.id_centro_costo == null && pinsPrincipal.has(m.pin)))
	);
	const guardados = ((semana?.tareo_trabajador ?? []) as TrabajadorGuardado[]);

	// Trabajadores de otras obras que marcaron aquí o que ya se enviaron en este tareo.
	const idsAsignados = new Set((asignados ?? []).map((p) => p.id_personal as number));
	const pinsExtra = [...new Set(marcasValidas.map((m) => m.pin))].filter((pin) => !asignadosPorPin.has(pin));
	const idsExtra = guardados.map((g) => g.id_personal).filter((id) => !idsAsignados.has(id));
	let extra: any[] = [];
	if (pinsExtra.length || idsExtra.length) {
		const filtros = [pinsExtra.length ? `pin.in.(${pinsExtra.map((x) => `"${x.replace(/"/g, '')}"`).join(',')})` : '', idsExtra.length ? `id_personal.in.(${idsExtra.join(',')})` : ''].filter(Boolean).join(',');
		const { data, error } = await client.from('personal').select(seleccion).or(filtros);
		if (error) throw error;
		extra = data ?? [];
	}
	// Activos en algún día de la semana (o con marcas / ya enviados).
	const pinsConMarca = new Set(marcasValidas.map((m) => m.pin));
	const idsGuardados = new Set(guardados.map((g) => g.id_personal));
	// Ticket #122/#118: el personal de Consultoría, Corporativo u oficina (su obra o área principal no es de obra) va al
	// tareo de Consultoría aunque marque en el huellero de una obra; aquí solo si ya tenía tareo guardado en esta obra.
	const trabajadores = [...(asignados ?? []), ...extra].filter(
		(p) =>
			(p.id_centro_costo == null || esCentroObra(p.centro_costo) || idsGuardados.has(p.id_personal)) &&
			(pinsConMarca.has(p.pin) || idsGuardados.has(p.id_personal) || ((!p.fecha_ingreso || p.fecha_ingreso <= domingo) && (!p.fecha_cese || p.fecha_cese >= lunes) && p.estado === 'activo'))
	);

	const ids = trabajadores.map((p) => p.id_personal as number);
	const [{ data: ajustes, error: eAj }, extrasSemana] = await Promise.all([
		ids.length
			? client.from('tareo_ajuste').select('id_personal, fecha, estado, minutos_reconocidos, observacion, usuario').in('id_personal', ids).eq('id_centro_costo', idCentroCosto).gte('fecha', lunes).lte('fecha', domingo)
			: Promise.resolve({ data: [], error: null }),
		cargarExtras(client, ids, lunes, domingo, idCentroCosto)
	]);
	if (eAj) throw eAj;

	const marcasPorPin = new Map<string, MarcaTareo[]>();
	for (const m of marcasValidas) {
		const lima = new Date(Date.parse(m.marcado_en) - LIMA_MS);
		const disp = m.asistencia_dispositivo as { nombre: string | null } | { nombre: string | null }[] | null;
		const lista = marcasPorPin.get(m.pin) ?? [];
		lista.push({
			fecha: lima.toISOString().slice(0, 10),
			minuto: lima.getUTCHours() * 60 + lima.getUTCMinutes(),
			huellero: (Array.isArray(disp) ? disp[0]?.nombre : disp?.nombre) ?? (m.id_dispositivo ? 'Huellero' : 'ERP (Mi asistencia)'),
			modo: m.modo_verificacion ?? null,
			manual: m.id_dispositivo == null
		});
		marcasPorPin.set(m.pin, lista);
	}

	const filas = trabajadores
		.map((p) => {
			const h = p.horario ? ({ ...p.horario, horario_dia: [...(p.horario.horario_dia ?? [])].sort((a: any, b: any) => a.dia - b.dia) } as Horario) : null;
			return calcularFila(
				p as Personal,
				h,
				marcasPorPin.get(p.pin) ?? [],
				(ajustes ?? []) as AjusteTareo[],
				(feriados ?? []) as FeriadoTareo[],
				guardados.find((g) => g.id_personal === p.id_personal) ?? null,
				lunes,
				hoy,
				p.id_centro_costo === idCentroCosto || idsObra.includes(p.id_personal),
				7,
				extrasSemana
			);
		})
		.sort((a, b) => nombreCompleto(a.personal).localeCompare(nombreCompleto(b.personal), 'es'));

	// Diagnóstico: todas las marcas crudas de cada trabajador del tareo, con el motivo.
	const idsObrasMarcas = [...new Set((marcasCrudas ?? []).map((m) => m.id_centro_costo as number | null).filter((x): x is number => x != null && x !== idCentroCosto))];
	const obrasMarcas = new Map<number, string>();
	if (idsObrasMarcas.length) {
		const { data } = await client.from('centro_costo').select('id_centro_costo, codigo, nombre, proyecto(nombre_proyecto)').in('id_centro_costo', idsObrasMarcas);
		for (const c of (data ?? []) as any[]) {
			const n = nombreCentro(c);
			obrasMarcas.set(c.id_centro_costo, n ? `${n.codigo} · ${n.nombre}` : String(c.id_centro_costo));
		}
	}
	const nombreObra = (id: number) => obrasMarcas.get(id) ?? `obra #${id}`;
	const idPorPin = new Map(trabajadores.map((p) => [p.pin as string, p.id_personal as number]));
	const diagnostico: Record<number, MarcaDiagnostico[]> = {};
	for (const m of marcasCrudas ?? []) {
		const id = idPorPin.get(m.pin);
		if (id == null) continue;
		const lima = new Date(Date.parse(m.marcado_en) - LIMA_MS).toISOString();
		const disp = m.asistencia_dispositivo as { nombre: string | null } | { nombre: string | null }[] | null;
		const { cuenta, motivo } = motivoMarca(m as any, idCentroCosto, pinsPrincipal, nombreObra);
		(diagnostico[id] ??= []).push({
			fecha: lima.slice(0, 10),
			hora: lima.slice(11, 19),
			huellero: (Array.isArray(disp) ? disp[0]?.nombre : disp?.nombre) ?? (m.id_dispositivo ? 'Huellero' : 'ERP (Mi asistencia)'),
			obra: m.id_centro_costo == null ? 'Sin obra' : m.id_centro_costo === idCentroCosto ? 'Esta obra' : nombreObra(m.id_centro_costo),
			modo: m.modo_verificacion ?? null,
			evento: m.evento ?? null,
			cuenta,
			motivo
		});
	}

	return {
		filas,
		feriados: (feriados ?? []) as FeriadoTareo[],
		diagnostico,
		semana: semana
			? { estado: semana.estado, aprobado_por: semana.aprobado_por, aprobado_en: semana.aprobado_en, fondo_separado: semana.fondo_separado != null ? Number(semana.fondo_separado) : null }
			: null,
		enviadoSinPago: r2(guardados.reduce((t, g) => t + (g.tareo_envio ?? []).filter((e) => e.id_pago == null).reduce((u, e) => u + Number(e.monto), 0), 0))
	};
}

/** Guarda (o reemplaza) el ajuste del residente para esos trabajadores y ese día. */
export async function guardarAjuste(
	client: SupabaseClient,
	idsPersonal: number[],
	idCentroCosto: number,
	fecha: string,
	datos: { estado: EstadoAjuste; minutos: number; observacion: string },
	usuario: string | null
): Promise<void> {
	const filas = idsPersonal.map((id) => ({
		id_personal: id,
		id_centro_costo: idCentroCosto,
		fecha,
		estado: datos.estado,
		minutos_reconocidos: Math.max(0, Math.min(1440, Math.round(datos.minutos))),
		observacion: datos.observacion.trim().slice(0, 200) || null,
		usuario,
		updated_at: new Date().toISOString()
	}));
	const { error } = await client.from('tareo_ajuste').upsert(filas, { onConflict: 'id_personal,fecha,id_centro_costo' });
	if (error) throw error;
}

/** Quita el ajuste de esa obra: el día vuelve a lo que diga el huellero. */
export async function quitarAjuste(client: SupabaseClient, idPersonal: number, idCentroCosto: number, fecha: string): Promise<void> {
	const { error } = await client.from('tareo_ajuste').delete().eq('id_personal', idPersonal).eq('id_centro_costo', idCentroCosto).eq('fecha', fecha);
	if (error) throw error;
}

export async function agregarFeriado(client: SupabaseClient, fecha: string, idCentroCosto: number | null, descripcion: string, usuario: string | null): Promise<void> {
	const { error } = await client.from('tareo_feriado').insert({ fecha, id_centro_costo: idCentroCosto, descripcion: descripcion.trim().slice(0, 100) || null, usuario });
	if (error) throw error.code === '23505' ? new Error('Ese día ya está marcado como feriado.') : error;
}

export async function quitarFeriado(client: SupabaseClient, idFeriado: number): Promise<void> {
	const { error } = await client.from('tareo_feriado').delete().eq('id_feriado', idFeriado);
	if (error) throw error;
}

export type PeriodoTareo = 'semanal' | 'quincenal' | 'mensual';

/** Bonos y Fecha CxP de un trabajador (borrador de la semana, o de la quincena/mes en Consultoría). */
export async function guardarTrabajador(client: SupabaseClient, idCentroCosto: number, lunes: string, idPersonal: number, bonos: number, fechaCxp: string | null, periodo: PeriodoTareo = 'semanal'): Promise<void> {
	const { error } = await client.rpc('fn_tareo_guardar_trabajador', {
		p_id_centro_costo: idCentroCosto,
		p_semana_inicio: lunes,
		p_id_personal: idPersonal,
		p_bonos: bonos,
		p_fecha_cxp: fechaCxp,
		p_periodo: periodo
	});
	if (error) throw error;
}

/** Tickets #118/#119: el jefe inmediato (o un administrador) aprueba el total de esos trabajadores. */
export async function aprobarTareo(client: SupabaseClient, idCentroCosto: number, inicio: string, filas: { fila: FilaTareo; total: number }[], periodo: PeriodoTareo = 'semanal'): Promise<number> {
	const items = filas.map(({ fila, total }) => ({
		id_personal: fila.personal.id_personal,
		nombre: nombreCompleto(fila.personal),
		minutos: fila.minutos,
		tarifa_hora: Math.round(fila.tarifaHora * 10_000) / 10_000,
		total: r2(total)
	}));
	const { data, error } = await client.rpc('fn_tareo_aprobar', { p_id_centro_costo: idCentroCosto, p_inicio: inicio, p_items: items, p_periodo: periodo });
	if (error) throw error;
	return Number(data ?? 0);
}

/** Ticket #118 (Proyección): fondo separado de la obra en la semana (null = sin dato). */
export async function guardarFondo(client: SupabaseClient, idCentroCosto: number, lunes: string, monto: number | null, periodo: PeriodoTareo = 'semanal'): Promise<void> {
	const args: Record<string, unknown> = { p_id_centro_costo: idCentroCosto, p_semana_inicio: lunes, p_monto: monto };
	if (periodo !== 'semanal') args.p_periodo = periodo;
	const { error } = await client.rpc('fn_tareo_fondo', args);
	if (error) throw error;
}

// ─────────────────── Requerimientos de personal y aptitudes (ticket #118, 26/11/2026) ───────────────────

export type ModoRequerimiento = 'obra' | 'semana';

export interface RequerimientoTareo {
	id_requerimiento?: number;
	id_centro_costo: number;
	/** null = vale para todas las semanas de la obra. */
	semana_inicio: string | null;
	cargo: string;
	cantidad: number;
	aptitudes: string[];
	/** S/ por día de referencia para estimar el costo de las vacantes (si no, el promedio de los asignados). */
	tarifa_dia: number | null;
}

export interface PlanTareo {
	/** false si la base aún no tiene la migración 20261127120000. */
	disponible: boolean;
	modo: ModoRequerimiento;
	requerimientos: RequerimientoTareo[];
	/** Presupuesto escrito a mano para el periodo. */
	presupuesto: number | null;
	/** Fondo separado del periodo. */
	fondo: number | null;
}

const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
export const mismoTexto = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && normalizar(a) === normalizar(b);

/** Cuántas de las aptitudes requeridas tiene el trabajador. Pura. */
export function cumpleAptitudes(delTrabajador: string[] | null | undefined, requeridas: string[]): { tiene: number; total: number; faltan: string[] } {
	const propias = (delTrabajador ?? []).map(normalizar);
	const faltan = requeridas.filter((r) => !propias.includes(normalizar(r)));
	return { tiene: requeridas.length - faltan.length, total: requeridas.length, faltan };
}

/** Requerimientos (según el modo de la obra), presupuesto y fondo del periodo. Nunca lanza por falta de migración. */
export async function cargarPlanTareo(client: SupabaseClient, idCentroCosto: number, inicio: string, periodo: PeriodoTareo = 'semanal'): Promise<PlanTareo> {
	const [{ data: cfg, error: eC }, { data: reqs, error: eR }, { data: sem }] = await Promise.all([
		client.from('tareo_obra_config').select('requerimiento_modo').eq('id_centro_costo', idCentroCosto).maybeSingle(),
		client.from('tareo_requerimiento').select('*').eq('id_centro_costo', idCentroCosto).order('id_requerimiento'),
		client.from('tareo_semana').select('presupuesto_disponible, fondo_separado').eq('id_centro_costo', idCentroCosto).eq('semana_inicio', inicio).eq('periodo', periodo).maybeSingle()
	]);
	if (eC || eR) return { disponible: false, modo: 'obra', requerimientos: [], presupuesto: null, fondo: (sem as any)?.fondo_separado != null ? Number((sem as any).fondo_separado) : null };
	const modo = ((cfg as any)?.requerimiento_modo ?? 'obra') as ModoRequerimiento;
	const requerimientos = ((reqs ?? []) as any[])
		.filter((r) => (modo === 'obra' ? r.semana_inicio == null : r.semana_inicio === inicio))
		.map((r) => ({ ...r, cantidad: Number(r.cantidad), tarifa_dia: r.tarifa_dia != null ? Number(r.tarifa_dia) : null, aptitudes: r.aptitudes ?? [] }) as RequerimientoTareo);
	const s = sem as any;
	return {
		disponible: true,
		modo,
		requerimientos,
		presupuesto: s?.presupuesto_disponible != null ? Number(s.presupuesto_disponible) : null,
		fondo: s?.fondo_separado != null ? Number(s.fondo_separado) : null
	};
}

export async function guardarModoRequerimiento(client: SupabaseClient, idCentroCosto: number, modo: ModoRequerimiento, usuario: string | null): Promise<void> {
	const { error } = await client.from('tareo_obra_config').upsert({ id_centro_costo: idCentroCosto, requerimiento_modo: modo, usuario, updated_at: new Date().toISOString() });
	if (error) throw error;
}

export async function guardarRequerimiento(client: SupabaseClient, r: RequerimientoTareo, usuario: string | null): Promise<void> {
	const fila = {
		id_centro_costo: r.id_centro_costo,
		semana_inicio: r.semana_inicio,
		cargo: r.cargo.trim().slice(0, 100),
		cantidad: Math.max(1, Math.min(999, Math.round(r.cantidad))),
		aptitudes: [...new Set(r.aptitudes.map((a) => a.trim()).filter(Boolean))],
		tarifa_dia: r.tarifa_dia != null && r.tarifa_dia > 0 ? r2(r.tarifa_dia) : null,
		usuario
	};
	const { error } = r.id_requerimiento
		? await client.from('tareo_requerimiento').update(fila).eq('id_requerimiento', r.id_requerimiento)
		: await client.from('tareo_requerimiento').insert(fila);
	if (error) throw error;
}

export async function eliminarRequerimiento(client: SupabaseClient, idRequerimiento: number): Promise<void> {
	const { error } = await client.from('tareo_requerimiento').delete().eq('id_requerimiento', idRequerimiento);
	if (error) throw error;
}

/** Copia a `lunes` los requerimientos de la semana anterior (modo por semana). Devuelve cuántos copió. */
export async function copiarRequerimientosSemanaAnterior(client: SupabaseClient, idCentroCosto: number, lunes: string, usuario: string | null): Promise<number> {
	const { data, error } = await client.from('tareo_requerimiento').select('*').eq('id_centro_costo', idCentroCosto).eq('semana_inicio', sumarDias(lunes, -7));
	if (error) throw error;
	const filas = ((data ?? []) as any[]).map((r) => ({ id_centro_costo: idCentroCosto, semana_inicio: lunes, cargo: r.cargo, cantidad: r.cantidad, aptitudes: r.aptitudes ?? [], tarifa_dia: r.tarifa_dia, usuario }));
	if (!filas.length) return 0;
	const { error: e2 } = await client.from('tareo_requerimiento').insert(filas);
	if (e2) throw e2;
	return filas.length;
}

export async function guardarPresupuesto(client: SupabaseClient, idCentroCosto: number, inicio: string, monto: number | null, periodo: PeriodoTareo = 'semanal'): Promise<void> {
	const { error } = await client.rpc('fn_tareo_presupuesto', { p_id_centro_costo: idCentroCosto, p_semana_inicio: inicio, p_monto: monto, p_periodo: periodo });
	if (error) throw error;
}

/** Aptitudes ya usadas (de trabajadores y requerimientos), para sugerirlas. */
export async function catalogoAptitudes(client: SupabaseClient): Promise<string[]> {
	const [{ data: p }, { data: r }] = await Promise.all([
		client.from('personal').select('aptitudes').neq('estado', 'baja'),
		client.from('tareo_requerimiento').select('aptitudes')
	]);
	const todas = [...((p ?? []) as any[]), ...((r ?? []) as any[])].flatMap((x) => (x.aptitudes ?? []) as string[]);
	const vistos = new Map<string, string>();
	for (const a of todas) if (a?.trim() && !vistos.has(normalizar(a))) vistos.set(normalizar(a), a.trim());
	return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es'));
}

/** Ticket #118 (Proyección): reserva el monto proyectado de esos trabajadores para la fecha (monto 0 = quitar). */
export async function reservarTareo(client: SupabaseClient, idCentroCosto: number, lunes: string, items: { idPersonal: number; monto: number }[], fecha: string, usuario: string | null): Promise<number> {
	const { data, error } = await client.rpc('fn_tareo_reservar', {
		p_id_centro_costo: idCentroCosto,
		p_semana_inicio: lunes,
		p_items: items.map((i) => ({ id_personal: i.idPersonal, monto: r2(i.monto) })),
		p_fecha: fecha,
		p_usuario: usuario
	});
	if (error) throw error;
	return Number(data ?? 0);
}

export interface EnvioTareo {
	fila: FilaTareo;
	monto: number;
	fechaCxp: string;
}

/** Ticket #133: libera lo enviado cuyo pago se eliminó de CxP (obra y semana), para poder reenviarlo. Devuelve el monto. */
export async function liberarEnviosSinPago(client: SupabaseClient, idCentroCosto: number, lunes: string, periodo: PeriodoTareo = 'semanal'): Promise<number> {
	const { data, error } = await client.rpc('fn_tareo_liberar_envios_sin_pago', { p_id_centro_costo: idCentroCosto, p_semana_inicio: lunes, p_periodo: periodo });
	if (error) throw error;
	return Number(data ?? 0);
}

/** Envía a Cuentas por Pagar (una cuota por trabajador en la planilla de la obra). Solo lo aprobado (#118). */
export async function enviarTareo(client: SupabaseClient, idCentroCosto: number, lunes: string, envios: EnvioTareo[], usuario: string | null, periodo: PeriodoTareo = 'semanal'): Promise<number> {
	const items = envios.map((e) => ({
		id_personal: e.fila.personal.id_personal,
		minutos: e.fila.minutos,
		tarifa_hora: Math.round(e.fila.tarifaHora * 10_000) / 10_000,
		bonos: e.fila.bonos,
		total: e.fila.total,
		monto: r2(e.monto),
		fecha_cxp: e.fechaCxp,
		nombre: nombreCompleto(e.fila.personal)
	}));
	const { data, error } = await client.rpc('fn_tareo_enviar', { p_id_centro_costo: idCentroCosto, p_semana_inicio: lunes, p_items: items, p_usuario: usuario, p_periodo: periodo });
	if (error) throw error;
	return (data as { enviados?: number } | null)?.enviados ?? 0;
}

/** Crea/actualiza la CxP proyectada de planilla del periodo actual de cada obra. Sin la migración no hace nada. */
export async function proyectarPlanillas(client: SupabaseClient): Promise<void> {
	const { error } = await client.rpc('fn_planilla_proyectar_todo');
	if (error && error.code !== 'PGRST202' && error.code !== '42883') console.warn('No se pudo proyectar la planilla:', error.message);
}

// ─────────────────────────── Consultoría (ticket #118) ───────────────────────────

export type GrupoConsultoria = 'quincenal' | 'mensual';

/** Pedido de la clienta (26/11/2026): el personal del centro Corporativo (tipo 'bolsa general') tiene su propia pestaña
 * en el tareo, igual a la de Consultoría. Consultoría muestra el resto del personal que no es de obra. */
export type AmbitoTareo = 'consultoria' | 'corporativo';
export const esCentroCorporativo = (c: { tipo?: string | null } | null | undefined) => c?.tipo === 'bolsa general';

const finDeMes = (f: string) => sumarDias(`${sumarDias(`${f.slice(0, 7)}-28`, 4).slice(0, 7)}-01`, -1);

/** Periodo de pago que contiene `fecha`: quincena (1–15 / 16–fin de mes) o mes completo. */
export function periodoConsultoria(grupo: GrupoConsultoria, fecha: string): { inicio: string; fin: string } {
	const ym = fecha.slice(0, 7);
	if (grupo === 'mensual') return { inicio: `${ym}-01`, fin: finDeMes(fecha) };
	return Number(fecha.slice(8)) <= 15 ? { inicio: `${ym}-01`, fin: `${ym}-15` } : { inicio: `${ym}-16`, fin: finDeMes(fecha) };
}

const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000) + 1;

export interface FilaConsultoria {
	/** Días del periodo (calcularFila); subtotal = base + ajuste y total = subtotal + bonos (ver calcularFilaConsultoria). */
	fila: FilaTareo;
	idCentroCosto: number | null;
	centro: string;
	/** 15 (quincena) o 30 (mes): divisor del S/ por día. */
	diasBase: number;
	diasReconocidos: number;
	/** Monto del periodo según Personal. */
	base: number;
	/** (días reconocidos − días base) × S/ por día: negativo si faltó. */
	ajuste: number;
}

/** Cuánto se descuenta de un día (0, ½ o 1): faltas sin marcas en su horario fijo (salvo trabajo remoto, que no marca),
 * días editados con menos de una jornada, medio día y días fuera de su contrato. Los días por venir no descuentan. */
export function descuentoDia(d: DiaTareo, horario: Horario | null, remoto: boolean): number {
	if (d.estado === 'fuera_contrato') return 1;
	if (d.estado === 'por_venir') return 0;
	const laborable = !!d.asistencia?.programado || ((!horario || esLibre(horario)) && d.dia < 7);
	if (d.ajuste) return d.ajuste.estado === 'falta' || d.ajuste.estado === 'sin_trabajo' || laborable ? 1 - d.fraccion : 0;
	if (d.estado === 'falta') return remoto ? 0 : 1;
	if (d.estado === 'asistio') return laborable ? 1 - d.fraccion : 0;
	return 0;
}

/** Fila de Consultoría: sueldo del periodo ajustado por asistencia. Pura (sobre una fila ya calculada). */
export function calcularFilaConsultoria(f: FilaTareo, grupo: GrupoConsultoria, idCentroCosto: number | null, centro: string): FilaConsultoria {
	const diasBase = DIAS_PERIODO[grupo];
	const base = r2(Number(f.personal.monto_pago ?? 0));
	const remoto = f.personal.modalidad === 'remoto';
	const descuento = f.dias.reduce((t, d) => t + descuentoDia(d, f.horario, remoto), 0);
	const diasReconocidos = Math.max(0, Math.min(diasBase, diasBase - descuento));
	const ajuste = r2((diasReconocidos - diasBase) * f.tarifaDia);
	const subtotal = r2(base + ajuste);
	const total = r2(subtotal + f.extrasMonto + f.bonos);
	return {
		fila: { ...f, subtotal, total, diasPagados: diasReconocidos, pendiente: r2(Math.max(total - f.enviado, 0)) },
		idCentroCosto,
		centro,
		diasBase,
		diasReconocidos,
		base,
		ajuste
	};
}

/** Ticket #118 (26/11/2026): Proyección de Consultoría y Corporativo = sueldo completo del periodo. Lo registrado hasta
 * hoy (días transcurridos menos sus descuentos) y lo que falta por completar hasta el cierre. Pura. */
export function proyectarConsultoria(c: FilaConsultoria, hoy: string): { diasRegistrados: number; diasPrevistos: number; acumulado: number; porCompletar: number } {
	const remoto = c.fila.personal.modalidad === 'remoto';
	const pasados = c.fila.dias.filter((d) => d.fecha <= hoy && d.estado !== 'fuera_contrato');
	const descuento = pasados.reduce((t, d) => t + descuentoDia(d, c.fila.horario, remoto), 0);
	const diasRegistrados = Math.max(0, Math.min(c.diasReconocidos, pasados.length - descuento));
	const diasPrevistos = Math.max(0, c.diasReconocidos - diasRegistrados);
	const subtotal = r2(c.base + c.ajuste);
	const acumulado = r2(Math.min(subtotal, diasRegistrados * c.fila.tarifaDia));
	return { diasRegistrados, diasPrevistos, acumulado, porCompletar: r2(Math.max(subtotal - acumulado, 0)) };
}

function aMarcaTareo(m: any): { pin: string; marca: MarcaTareo } {
	const lima = new Date(Date.parse(m.marcado_en) - LIMA_MS);
	const disp = m.asistencia_dispositivo as { nombre: string | null } | { nombre: string | null }[] | null;
	return {
		pin: m.pin,
		marca: {
			fecha: lima.toISOString().slice(0, 10),
			minuto: lima.getUTCHours() * 60 + lima.getUTCMinutes(),
			huellero: (Array.isArray(disp) ? disp[0]?.nombre : disp?.nombre) ?? (m.id_dispositivo ? 'Huellero' : 'ERP (Mi asistencia)'),
			modo: m.modo_verificacion ?? null,
			manual: m.id_dispositivo == null
		}
	};
}

/** Tareo de Consultoría del periodo: personal que cobra por quincena o mes y cuya obra o área principal no es de obra
 * (o lo que ya se guardó/envió en ese periodo). Sus marcas cuentan de cualquier huellero o de «Mi asistencia». */
export async function cargarTareoConsultoria(
	client: SupabaseClient,
	grupo: GrupoConsultoria,
	inicio: string,
	hoy: string,
	ambito: AmbitoTareo = 'consultoria'
): Promise<FilaConsultoria[]> {
	const { fin } = periodoConsultoria(grupo, inicio);
	const nDias = diasEntre(inicio, fin);
	const seleccion = '*, centro_costo!personal_id_centro_costo_fkey(codigo, nombre, tipo, proyecto(nombre_proyecto, tipo_venta)), horario(*, horario_dia(*))';
	const [{ data: per, error: eP }, { data: semanas, error: eS }] = await Promise.all([
		client.from('personal').select(seleccion).eq('periodicidad_pago', grupo).neq('estado', 'baja'),
		client.from('tareo_semana').select(`id_centro_costo, tareo_trabajador(${CAMPOS_GUARDADO})`).eq('semana_inicio', inicio).eq('periodo', grupo)
	]);
	if (eP) throw eP;
	if (eS) throw eS;
	const guardados = new Map<string, TrabajadorGuardado>();
	for (const s of (semanas ?? []) as any[]) for (const t of (s.tareo_trabajador ?? []) as TrabajadorGuardado[]) guardados.set(`${s.id_centro_costo}:${t.id_personal}`, t);
	const guardadoDe = (p: any) => (p.id_centro_costo ? (guardados.get(`${p.id_centro_costo}:${p.id_personal}`) ?? null) : null);

	const trabajadores = ((per ?? []) as any[]).filter(
		(p) =>
			!esCentroObra(p.centro_costo) &&
			esCentroCorporativo(p.centro_costo) === (ambito === 'corporativo') &&
			(guardadoDe(p) || (p.estado === 'activo' && (!p.fecha_ingreso || p.fecha_ingreso <= fin) && (!p.fecha_cese || p.fecha_cese >= inicio)))
	);
	if (!trabajadores.length) return [];
	const ids = trabajadores.map((p) => p.id_personal as number);
	const pins = [...new Set(trabajadores.map((p) => String(p.pin)))];

	const [{ data: marcas, error: eM }, { data: ajustes, error: eA }, { data: feriados, error: eF }, extrasPeriodo] = await Promise.all([
		client
			.from('asistencia_marcacion')
			.select('pin, marcado_en, evento, modo_verificacion, id_dispositivo, asistencia_dispositivo(nombre)')
			.gte('marcado_en', `${inicio}T00:00:00-05:00`)
			.lt('marcado_en', `${sumarDias(fin, 1)}T00:00:00-05:00`)
			.in('pin', pins)
			.order('marcado_en'),
		client.from('tareo_ajuste').select('id_personal, id_centro_costo, fecha, estado, minutos_reconocidos, observacion, usuario').in('id_personal', ids).gte('fecha', inicio).lte('fecha', fin),
		client.from('tareo_feriado').select('id_feriado, fecha, id_centro_costo, descripcion').gte('fecha', inicio).lte('fecha', fin),
		cargarExtras(client, ids, inicio, fin)
	]);
	if (eM) throw eM;
	if (eA) throw eA;
	if (eF) throw eF;

	const marcasPorPin = new Map<string, MarcaTareo[]>();
	for (const m of marcas ?? []) {
		if (m.evento != null && m.evento >= EVENTO_RECHAZO) continue;
		const { pin, marca } = aMarcaTareo(m);
		marcasPorPin.set(pin, [...(marcasPorPin.get(pin) ?? []), marca]);
	}

	return trabajadores
		.map((p) => {
			const h = p.horario ? ({ ...p.horario, horario_dia: [...(p.horario.horario_dia ?? [])].sort((a: any, b: any) => a.dia - b.dia) } as Horario) : null;
			const idCentro = (p.id_centro_costo as number | null) ?? null;
			const fila = calcularFila(
				p as Personal,
				h,
				marcasPorPin.get(p.pin) ?? [],
				((ajustes ?? []) as any[]).filter((a) => a.id_centro_costo === idCentro) as AjusteTareo[],
				((feriados ?? []) as FeriadoTareo[]).filter((f) => f.id_centro_costo == null || f.id_centro_costo === idCentro),
				guardadoDe(p),
				inicio,
				hoy,
				true,
				nDias,
				extrasPeriodo.filter((x) => x.id_centro_costo === idCentro)
			);
			const centro = p.centro_costo ? (nombreCentro(p.centro_costo)?.nombre ?? p.centro_costo.nombre ?? '') : '';
			return calcularFilaConsultoria(fila, grupo, idCentro, centro);
		})
		.sort((a, b) => nombreCompleto(a.fila.personal).localeCompare(nombreCompleto(b.fila.personal), 'es'));
}

// ─────────────────────────── Excel ───────────────────────────

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

/** Arma el Excel y lo guarda (diálogo "Guardar como" en la app, descarga en el navegador). */
export async function exportarTareoXLSX(obra: ObraTareo, lunes: string, filas: FilaTareo[]): Promise<void> {
	const buffer = await generarTareoXLSX(obra, lunes, filas);
	const [{ guardarArchivoBinario }, { arrayBufferToBase64 }] = await Promise.all([import('$lib/shared/saveFile'), import('$lib/shared/base64')]);
	await guardarArchivoBinario(arrayBufferToBase64(buffer), `tareo_${obra.codigo}_${lunes}.xlsx`, XLSX_MIME);
}

/** Tareo de la semana en Excel: hoja "Tareo" (horas por día y pago) y hoja "Detalle" (cada día con sus marcas). */
export async function generarTareoXLSX(obra: ObraTareo, lunes: string, filas: FilaTareo[]): Promise<ArrayBuffer> {
	const ExcelJS = (await import('exceljs')).default;
	const wb = new ExcelJS.Workbook();
	wb.creator = 'Construni ERP';
	const fechas = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));

	const hoja = wb.addWorksheet('Tareo');
	hoja.addRow([`Tareo semanal · ${obra.codigo} ${obra.nombre}`]).font = { bold: true, size: 13 };
	hoja.addRow([`Semana del ${ddmm(lunes)} al ${ddmm(fechas[6])}/${fechas[6].slice(0, 4)} · días pagados (1 = día completo, 0.5 = medio día)`]);
	hoja.addRow([]);
	const cab = hoja.addRow(['Trabajador', 'Documento', 'Cargo', ...fechas.map((f, i) => `${DIAS_CORTOS[i]} ${ddmm(f)}`), 'Días', 'Horas', 'S/ día', 'S/ hora', 'Subtotal', 'Bonos', 'Total', 'Enviado a CxP', 'Pendiente', 'Fecha CxP']);
	cab.font = { bold: true };
	cab.eachCell((c) => {
		c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
		c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
	});
	for (const f of filas) {
		hoja.addRow([
			nombreCompleto(f.personal),
			f.personal.numero_documento ?? '',
			f.personal.cargo ?? '',
			...f.dias.map((d) => (d.fraccion ? d.fraccion : d.estado === 'falta' ? 'F' : d.estado === 'feriado' ? 'FER' : '')),
			f.diasPagados,
			r2(f.minutos / 60),
			r2(f.tarifaDia),
			r2(f.tarifaHora),
			f.subtotal,
			f.bonos,
			f.total,
			f.enviado,
			f.pendiente,
			f.fechaCxp ? `${ddmm(f.fechaCxp)}/${f.fechaCxp.slice(0, 4)}` : ''
		]);
	}
	const totalRow = hoja.addRow([
		'TOTAL', '', '', ...fechas.map(() => ''), '', r2(filas.reduce((t, f) => t + f.minutos, 0) / 60), '', '',
		r2(filas.reduce((t, f) => t + f.subtotal, 0)), r2(filas.reduce((t, f) => t + f.bonos, 0)), r2(filas.reduce((t, f) => t + f.total, 0)),
		r2(filas.reduce((t, f) => t + f.enviado, 0)), r2(filas.reduce((t, f) => t + f.pendiente, 0)), ''
	]);
	totalRow.font = { bold: true };
	hoja.columns.forEach((col, i) => {
		col.width = i === 0 ? 32 : i < 3 ? 14 : i < 10 ? 10 : 12;
		if (i >= 12 && i <= 18) col.numFmt = '#,##0.00';
	});
	hoja.views = [{ state: 'frozen', xSplit: 1, ySplit: 4 }];

	const det = wb.addWorksheet('Detalle');
	const cabDet = det.addRow(['Trabajador', 'Fecha', 'Día', 'Estado', 'Entrada', 'Salida', 'Horas huellero', 'Horas reconocidas', 'Pago S/', 'Origen', 'Marcas', 'Observación']);
	cabDet.font = { bold: true };
	for (const f of filas) {
		for (const d of f.dias) {
			if (d.estado === 'por_venir') continue;
			det.addRow([
				nombreCompleto(f.personal),
				`${ddmm(d.fecha)}/${d.fecha.slice(0, 4)}`,
				DIAS_CORTOS[d.dia - 1],
				ESTADOS_CELDA[d.estado].texto,
				reloj(d.asistencia?.entrada ?? null),
				reloj(d.asistencia?.salida ?? null),
				duracion(d.minutosHuellero),
				duracion(d.minutos),
				d.pago,
				d.origen ? ORIGENES[d.origen].texto : '',
				(d.asistencia?.marcas ?? []).map((m) => `${reloj(m.minuto)} ${m.huellero}`).join(' · '),
				d.ajuste?.observacion ?? d.feriado?.descripcion ?? ''
			]);
		}
	}
	det.columns.forEach((col, i) => (col.width = [32, 12, 6, 16, 8, 8, 14, 16, 10, 24, 40, 30][i] ?? 12));
	det.getColumn(9).numFmt = '#,##0.00';
	det.views = [{ state: 'frozen', ySplit: 1 }];

	return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
