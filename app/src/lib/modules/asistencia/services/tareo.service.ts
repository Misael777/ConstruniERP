/**
 * Tareo semanal por obra (pedido del cliente, 06/11/2026): el residente de obra revisa las horas de cada trabajador
 * en la semana (lunes a domingo), corrige los días que hagan falta, marca feriados, agrega bonos y envía a Cuentas por
 * Pagar. Tablas y funciones en supabase/migrations/20261106120000_tareo_planilla.sql.
 *
 * Horas del día: las calcula calcularAsistencia (asistencia.service.ts) con las marcas del huellero de ESTA obra (o
 * de un huellero sin obra, si el trabajador está asignado a ella). Un ajuste del residente (tareo_ajuste) reemplaza
 * el cálculo; un feriado sin ajuste reconoce la jornada.
 *
 * Pago por hora exacta (decisión del usuario): S/ por día = monto_pago ÷ días calendario del periodo (diaria 1,
 * semanal 7, quincenal 15, mensual 30); tarifa por hora = S/ por día ÷ horas de su jornada (promedio de los días de
 * su horario; sin horario o libre, 8 h). Pago del día = horas reconocidas × tarifa. Total = suma + bonos.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { calcularAsistencia, sumarDias, diaSemana, reloj, duracion, type Marca, type DiaAsistencia } from './asistencia.service';
import { minutosDelDia, esLibre, type Horario } from '$lib/modules/personal/services/horarios.service';
import { nombreCompleto, type Personal } from '$lib/modules/personal/services/personal.service';

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
	pago: number;
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
	subtotal: number;
	bonos: number;
	total: number;
	enviado: number;
	pendiente: number;
	fechaCxp: string | null;
	/** Días sin salida o con algo que revisar. */
	porRevisar: number;
	sinMonto: boolean;
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
	asignado = true
): FilaTareo {
	const domingo = sumarDias(lunes, 6);
	const asistencia = calcularAsistencia(marcas, horario, lunes, domingo, hoy, { ingreso: p.fecha_ingreso, cese: p.fecha_cese });
	const porFecha = new Map(asistencia.map((d) => [d.fecha, d]));
	const jornadaMin = jornadaMinutos(horario);
	const { tarifaDia, tarifaHora } = tarifas(p, jornadaMin);

	const dias: DiaTareo[] = [];
	for (let i = 0; i < 7; i++) {
		const fecha = sumarDias(lunes, i);
		const a = porFecha.get(fecha) ?? null;
		const ajuste = ajustes.find((x) => x.fecha === fecha && x.id_personal === p.id_personal) ?? null;
		const feriado = asignado ? (feriados.find((f) => f.fecha === fecha) ?? null) : null;
		const minutosHuellero = a?.trabajados ?? 0;
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
			minutos = Math.max(laborable, minutosHuellero);
			origen = 'feriado';
		} else if (!a) {
			estado = 'por_venir';
		} else if (minutosHuellero > 0) {
			estado = 'asistio';
			minutos = minutosHuellero;
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
		dias.push({ fecha, dia: diaSemana(fecha), estado, minutosHuellero, minutos, origen, ajuste, feriado, asistencia: a, pago: r2((minutos / 60) * tarifaHora) });
	}

	const minutos = dias.reduce((t, d) => t + d.minutos, 0);
	const subtotal = r2(dias.reduce((t, d) => t + d.pago, 0));
	const bonos = Number(guardado?.bonos ?? 0);
	const total = r2(subtotal + bonos);
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
		subtotal,
		bonos,
		total,
		enviado,
		pendiente: r2(Math.max(total - enviado, 0)),
		fechaCxp: guardado?.fecha_cxp ?? null,
		porRevisar: dias.filter((d) => d.estado === 'pendiente').length,
		sinMonto: !(Number(p.monto_pago ?? 0) > 0)
	};
}

// ─────────────────────────── Datos ───────────────────────────

export interface ObraTareo {
	id_centro_costo: number;
	codigo: string;
	nombre: string;
}

/** Obras con personal activo asignado o con un huellero instalado. */
export async function getObrasTareo(client: SupabaseClient): Promise<ObraTareo[]> {
	const [{ data: per, error: e1 }, { data: disp, error: e2 }] = await Promise.all([
		client.from('personal').select('id_centro_costo').eq('estado', 'activo').not('id_centro_costo', 'is', null),
		client.from('asistencia_dispositivo').select('id_centro_costo').not('id_centro_costo', 'is', null)
	]);
	if (e1) throw e1;
	if (e2) throw e2;
	const ids = [...new Set([...(per ?? []), ...(disp ?? [])].map((x) => x.id_centro_costo as number))];
	if (!ids.length) return [];
	const { data, error } = await client.from('centro_costo').select('id_centro_costo, codigo, nombre').in('id_centro_costo', ids).order('codigo');
	if (error) throw error;
	return (data ?? []) as ObraTareo[];
}

export interface DatosTareo {
	filas: FilaTareo[];
	feriados: FeriadoTareo[];
	semana: { estado: 'borrador' | 'aprobado'; aprobado_por: string | null; aprobado_en: string | null } | null;
}

/** Carga la semana de la obra: trabajadores asignados, los que marcaron en sus huelleros y los ya enviados. */
export async function cargarTareo(client: SupabaseClient, idCentroCosto: number, lunes: string, hoy: string): Promise<DatosTareo> {
	const domingo = sumarDias(lunes, 6);
	const seleccion = '*, centro_costo(codigo, nombre), horario(*, horario_dia(*))';

	const { data: asignados, error: eA } = await client
		.from('personal')
		.select(seleccion)
		.eq('id_centro_costo', idCentroCosto)
		.neq('estado', 'baja');
	if (eA) throw eA;
	const pinsAsignados = (asignados ?? []).map((p) => p.pin as string);

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
		client.from('tareo_semana').select('id_tareo, estado, aprobado_por, aprobado_en, tareo_trabajador(id_personal, bonos, total, enviado, fecha_cxp)').eq('id_centro_costo', idCentroCosto).eq('semana_inicio', lunes).maybeSingle(),
		client.from('tareo_feriado').select('id_feriado, fecha, id_centro_costo, descripcion').gte('fecha', lunes).lte('fecha', domingo).or(`id_centro_costo.is.null,id_centro_costo.eq.${idCentroCosto}`)
	]);
	if (eM) throw eM;
	if (eS) throw eS;
	if (eF) throw eF;

	const asignadosPorPin = new Set(pinsAsignados);
	// Marca de esta obra, o de un huellero sin obra si el trabajador es de esta obra.
	const marcasValidas = (marcasCrudas ?? []).filter(
		(m) => (m.evento == null || m.evento < EVENTO_RECHAZO) && (m.id_centro_costo === idCentroCosto || (m.id_centro_costo == null && asignadosPorPin.has(m.pin)))
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
	const trabajadores = [...(asignados ?? []), ...extra].filter(
		(p) => pinsConMarca.has(p.pin) || idsGuardados.has(p.id_personal) || ((!p.fecha_ingreso || p.fecha_ingreso <= domingo) && (!p.fecha_cese || p.fecha_cese >= lunes) && p.estado === 'activo')
	);

	const ids = trabajadores.map((p) => p.id_personal as number);
	const { data: ajustes, error: eAj } = ids.length
		? await client.from('tareo_ajuste').select('id_personal, fecha, estado, minutos_reconocidos, observacion, usuario').in('id_personal', ids).eq('id_centro_costo', idCentroCosto).gte('fecha', lunes).lte('fecha', domingo)
		: { data: [], error: null };
	if (eAj) throw eAj;

	const marcasPorPin = new Map<string, MarcaTareo[]>();
	for (const m of marcasValidas) {
		const lima = new Date(Date.parse(m.marcado_en) - LIMA_MS);
		const disp = m.asistencia_dispositivo as { nombre: string | null } | { nombre: string | null }[] | null;
		const lista = marcasPorPin.get(m.pin) ?? [];
		lista.push({
			fecha: lima.toISOString().slice(0, 10),
			minuto: lima.getUTCHours() * 60 + lima.getUTCMinutes(),
			huellero: (Array.isArray(disp) ? disp[0]?.nombre : disp?.nombre) ?? (m.id_dispositivo ? 'Huellero' : 'Manual'),
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
				p.id_centro_costo === idCentroCosto
			);
		})
		.sort((a, b) => nombreCompleto(a.personal).localeCompare(nombreCompleto(b.personal), 'es'));

	return {
		filas,
		feriados: (feriados ?? []) as FeriadoTareo[],
		semana: semana ? { estado: semana.estado, aprobado_por: semana.aprobado_por, aprobado_en: semana.aprobado_en } : null
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

/** Bonos y Fecha CxP de un trabajador (borrador de la semana). */
export async function guardarTrabajador(client: SupabaseClient, idCentroCosto: number, lunes: string, idPersonal: number, bonos: number, fechaCxp: string | null): Promise<void> {
	const { error } = await client.rpc('fn_tareo_guardar_trabajador', {
		p_id_centro_costo: idCentroCosto,
		p_semana_inicio: lunes,
		p_id_personal: idPersonal,
		p_bonos: bonos,
		p_fecha_cxp: fechaCxp
	});
	if (error) throw error;
}

export interface EnvioTareo {
	fila: FilaTareo;
	monto: number;
	fechaCxp: string;
}

/** Envía a Cuentas por Pagar (una cuota por trabajador en la planilla de la obra) y aprueba la semana. */
export async function enviarTareo(client: SupabaseClient, idCentroCosto: number, lunes: string, envios: EnvioTareo[], usuario: string | null): Promise<number> {
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
	const { data, error } = await client.rpc('fn_tareo_enviar', { p_id_centro_costo: idCentroCosto, p_semana_inicio: lunes, p_items: items, p_usuario: usuario });
	if (error) throw error;
	return (data as { enviados?: number } | null)?.enviados ?? 0;
}

/** Crea/actualiza la CxP proyectada de planilla del periodo actual de cada obra. Sin la migración no hace nada. */
export async function proyectarPlanillas(client: SupabaseClient): Promise<void> {
	const { error } = await client.rpc('fn_planilla_proyectar_todo');
	if (error && error.code !== 'PGRST202' && error.code !== '42883') console.warn('No se pudo proyectar la planilla:', error.message);
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
	hoja.addRow([`Semana del ${ddmm(lunes)} al ${ddmm(fechas[6])}/${fechas[6].slice(0, 4)} · horas reconocidas por día`]);
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
			...f.dias.map((d) => (d.minutos ? r2(d.minutos / 60) : d.estado === 'falta' ? 'F' : d.estado === 'feriado' ? 'FER' : '')),
			f.diasTrabajados,
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
