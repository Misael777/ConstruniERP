/**
 * Ticket #46 "Submódulo de Pre-Venta" (Comercial): oportunidades del embudo comercial y sus actividades agendadas
 * (tablas oportunidad / oportunidad_actividad, migración 20261128120000). Los indicadores y paneles laterales se
 * calculan aquí con funciones puras (preventa.service.test.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type EtapaOportunidad = 'prospecto' | 'calificacion' | 'visita_tecnica' | 'propuesta' | 'cotizacion' | 'negociacion' | 'adjudicada' | 'perdida';
export type PrioridadOportunidad = 'alta' | 'media' | 'baja';
export type TipoActividad = 'llamada' | 'videollamada' | 'visita_campo' | 'visita_oficina' | 'envio_proforma' | 'envio_contrato' | 'envio_brochure' | 'reunion' | 'seguimiento';

/** Etapas en el orden del embudo (columnas del Kanban) con su color. */
export const ETAPAS: { value: EtapaOportunidad; label: string; chip: string; punto: string; borde: string; probabilidad: number }[] = [
	{ value: 'prospecto', label: 'Prospecto', chip: 'bg-slate-100 text-slate-700 border-slate-200', punto: 'bg-slate-700', borde: 'border-l-slate-500', probabilidad: 10 },
	{ value: 'calificacion', label: 'Calificación', chip: 'bg-violet-50 text-violet-700 border-violet-200', punto: 'bg-violet-500', borde: 'border-l-violet-500', probabilidad: 30 },
	{ value: 'visita_tecnica', label: 'Visita técnica', chip: 'bg-teal-50 text-teal-700 border-teal-200', punto: 'bg-teal-500', borde: 'border-l-teal-500', probabilidad: 40 },
	{ value: 'propuesta', label: 'Propuesta', chip: 'bg-indigo-50 text-indigo-700 border-indigo-200', punto: 'bg-blue-500', borde: 'border-l-blue-500', probabilidad: 60 },
	{ value: 'cotizacion', label: 'Cotización', chip: 'bg-amber-50 text-amber-700 border-amber-200', punto: 'bg-amber-500', borde: 'border-l-amber-500', probabilidad: 70 },
	{ value: 'negociacion', label: 'Negociación', chip: 'bg-orange-50 text-orange-700 border-orange-200', punto: 'bg-orange-500', borde: 'border-l-orange-500', probabilidad: 80 },
	{ value: 'adjudicada', label: 'Adjudicada', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', punto: 'bg-emerald-500', borde: 'border-l-emerald-500', probabilidad: 100 },
	{ value: 'perdida', label: 'Perdida', chip: 'bg-rose-50 text-rose-700 border-rose-200', punto: 'bg-rose-500', borde: 'border-l-rose-500', probabilidad: 0 }
];
export const etapaDe = (e: string) => ETAPAS.find((x) => x.value === e) ?? ETAPAS[0];

export const PRIORIDADES: Record<PrioridadOportunidad, { label: string; punto: string; chip: string }> = {
	alta: { label: 'Alta', punto: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700' },
	media: { label: 'Media', punto: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700' },
	baja: { label: 'Baja', punto: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700' }
};

export const TIPOS_ACTIVIDAD: { value: TipoActividad; label: string; icono: string; menu?: boolean }[] = [
	{ value: 'llamada', label: 'Llamada', icono: 'fa-phone', menu: true },
	{ value: 'videollamada', label: 'Videollamada', icono: 'fa-video', menu: true },
	{ value: 'visita_campo', label: 'Visita en campo', icono: 'fa-location-dot', menu: true },
	{ value: 'visita_oficina', label: 'Visita en oficina', icono: 'fa-building', menu: true },
	{ value: 'envio_proforma', label: 'Envío de proforma', icono: 'fa-file-invoice', menu: true },
	{ value: 'envio_contrato', label: 'Envío de contrato', icono: 'fa-file-signature', menu: true },
	{ value: 'envio_brochure', label: 'Enviar brochure', icono: 'fa-book-open', menu: true },
	{ value: 'reunion', label: 'Reunión', icono: 'fa-people-group' },
	{ value: 'seguimiento', label: 'Seguimiento', icono: 'fa-rotate' }
];
export const tipoActividadDe = (t: string) => TIPOS_ACTIVIDAD.find((x) => x.value === t) ?? TIPOS_ACTIVIDAD[0];

export const TIPOS_OPORTUNIDAD = ['Proyecto de construcción', 'Consultoría (diseño)', 'Consultoría (BIM)', 'Supervisión de obra', 'Licencias y trámites', 'Remodelación', 'Otro'];
export const ORIGENES = ['Referido', 'Página web', 'Redes sociales', 'Llamada entrante', 'Visita a obra', 'Feria o evento', 'Licitación', 'Otro'];
export const TIPOS_COMPROBANTE = ['Factura', 'Boleta', 'Recibo por honorarios'];
export const IGV = 0.18;

export interface Oportunidad {
	id_oportunidad: number;
	codigo: string | null;
	id_cliente: number | null;
	prospecto: string | null;
	nombre: string;
	tipo: string | null;
	origen: string | null;
	id_ejecutivo: number | null;
	etapa: EtapaOportunidad;
	prioridad: PrioridadOportunidad;
	moneda: 'PEN' | 'USD';
	valor_sin_igv: number;
	con_igv: boolean;
	probabilidad: number;
	fecha_registro: string;
	fecha_cierre: string | null;
	vigencia_propuesta: string | null;
	tipo_comprobante: string | null;
	comision_porcentaje: number | null;
	descripcion: string | null;
	notas: string | null;
	motivo_perdida: string | null;
	activo: boolean;
	usuario_registro: string | null;
	updated_at?: string;
	cliente?: { nombre: string; num_documento: string | null } | null;
	ejecutivo?: { nombre: string } | null;
}
export interface ActividadOportunidad {
	id_actividad: number;
	id_oportunidad: number | null;
	tipo: TipoActividad;
	titulo: string;
	fecha_hora: string;
	enlace: string | null;
	lugar: string | null;
	notas: string | null;
	responsable: string | null;
	completada: boolean;
	usuario_registro: string | null;
}

// ─────────── Cálculos (puros) ───────────

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Valor con IGV (si la oportunidad lo lleva). */
export const valorConIgv = (o: Pick<Oportunidad, 'valor_sin_igv' | 'con_igv'>) => r2(o.con_igv ? o.valor_sin_igv * (1 + IGV) : o.valor_sin_igv);
/** Valor ponderado = valor estimado × probabilidad de cierre. */
export const valorPonderado = (o: Pick<Oportunidad, 'valor_sin_igv' | 'con_igv' | 'probabilidad'>) => r2((valorConIgv(o) * o.probabilidad) / 100);
/** Comisión del asesor sobre el valor sin IGV. */
export const comisionAsesor = (o: Pick<Oportunidad, 'valor_sin_igv' | 'comision_porcentaje'>) => r2((o.valor_sin_igv * (o.comision_porcentaje ?? 0)) / 100);

/** "Abierta" = sigue en el embudo (ni adjudicada ni perdida). */
export const abierta = (o: Pick<Oportunidad, 'etapa' | 'activo'>) => o.activo && o.etapa !== 'adjudicada' && o.etapa !== 'perdida';

export interface IndicadoresPreventa {
	activas: number;
	valorPipeline: number;
	cotizacionesEnviadas: number;
	enNegociacion: number;
	ganadasMes: number;
	perdidasMes: number;
	tasaConversion: number | null;
	porConfirmar: number;
}
/**
 * Tarjetas de arriba. "Ganadas/Perdidas este mes" por la fecha de su último cambio (updated_at) en el mes de `hoy`.
 * Tasa de conversión = ganadas / (ganadas + perdidas) de todo el historial. "Por confirmar" = valor ponderado de las abiertas.
 */
export function indicadores(ops: Oportunidad[], hoy: string): IndicadoresPreventa {
	const mes = hoy.slice(0, 7);
	const vivas = ops.filter((o) => o.activo);
	const abiertas = vivas.filter(abierta);
	const delMes = (o: Oportunidad) => (o.updated_at ?? o.fecha_registro).slice(0, 7) === mes;
	const ganadas = vivas.filter((o) => o.etapa === 'adjudicada');
	const perdidas = vivas.filter((o) => o.etapa === 'perdida');
	return {
		activas: abiertas.length,
		valorPipeline: r2(abiertas.reduce((t, o) => t + valorConIgv(o), 0)),
		cotizacionesEnviadas: abiertas.filter((o) => o.etapa === 'cotizacion' || o.etapa === 'propuesta').length,
		enNegociacion: abiertas.filter((o) => o.etapa === 'negociacion').length,
		ganadasMes: ganadas.filter(delMes).length,
		perdidasMes: perdidas.filter(delMes).length,
		tasaConversion: ganadas.length + perdidas.length ? Math.round((ganadas.length / (ganadas.length + perdidas.length)) * 100) : null,
		porConfirmar: r2(abiertas.reduce((t, o) => t + valorPonderado(o), 0))
	};
}

/** Oportunidades abiertas que cierran dentro de `dias` días (incluye las ya vencidas sin cerrar), de la más próxima. */
export function porVencer(ops: Oportunidad[], hoy: string, dias = 7): (Oportunidad & { diasParaCierre: number })[] {
	const t0 = Date.parse(`${hoy}T00:00:00Z`);
	return ops
		.filter((o) => abierta(o) && o.fecha_cierre)
		.map((o) => ({ ...o, diasParaCierre: Math.round((Date.parse(`${o.fecha_cierre}T00:00:00Z`) - t0) / 86400000) }))
		.filter((o) => o.diasParaCierre <= dias)
		.sort((a, b) => a.diasParaCierre - b.diasParaCierre);
}

/** Mejores oportunidades abiertas por valor ponderado. */
export const mejores = (ops: Oportunidad[], n = 3) => ops.filter(abierta).sort((a, b) => valorPonderado(b) - valorPonderado(a)).slice(0, n);

/** Próxima actividad pendiente de cada oportunidad. */
export function proximaActividad(acts: ActividadOportunidad[], ahoraIso: string): Map<number, ActividadOportunidad> {
	const m = new Map<number, ActividadOportunidad>();
	for (const a of [...acts].filter((x) => !x.completada && x.fecha_hora >= ahoraIso).sort((x, y) => x.fecha_hora.localeCompare(y.fecha_hora))) {
		if (a.id_oportunidad != null && !m.has(a.id_oportunidad)) m.set(a.id_oportunidad, a);
	}
	return m;
}

/** Texto para buscar (sin tildes). */
export const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ─────────── Datos ───────────

const SELECT_OP = '*, cliente:id_cliente(nombre, num_documento), ejecutivo:id_ejecutivo(nombre)';

export async function getOportunidades(client: SupabaseClient): Promise<Oportunidad[]> {
	const { data, error } = await client.from('oportunidad').select(SELECT_OP).eq('activo', true).order('created_at', { ascending: false });
	if (error) throw error;
	return ((data ?? []) as any[]).map((o) => ({ ...o, valor_sin_igv: Number(o.valor_sin_igv), comision_porcentaje: o.comision_porcentaje != null ? Number(o.comision_porcentaje) : null }));
}

export async function getActividades(client: SupabaseClient): Promise<ActividadOportunidad[]> {
	const { data, error } = await client.from('oportunidad_actividad').select('*').order('fecha_hora');
	if (error) throw error;
	return (data ?? []) as ActividadOportunidad[];
}

type CamposOportunidad = Omit<Oportunidad, 'id_oportunidad' | 'codigo' | 'activo' | 'cliente' | 'ejecutivo' | 'updated_at'>;

export async function guardarOportunidad(client: SupabaseClient, datos: CamposOportunidad, id?: number | null): Promise<number> {
	const fila = { ...datos, prospecto: datos.id_cliente ? null : datos.prospecto?.trim() || null, nombre: datos.nombre.trim() };
	const { data, error } = id
		? await client.from('oportunidad').update(fila).eq('id_oportunidad', id).select('id_oportunidad').single()
		: await client.from('oportunidad').insert(fila).select('id_oportunidad').single();
	if (error) throw error;
	return Number((data as any).id_oportunidad);
}

/** Mover de etapa (Kanban): la probabilidad sigue a la etapa salvo que se haya puesto a mano una mayor. */
export async function moverEtapa(client: SupabaseClient, o: Oportunidad, etapa: EtapaOportunidad, motivoPerdida: string | null = null): Promise<void> {
	const probabilidad = etapa === 'adjudicada' ? 100 : etapa === 'perdida' ? 0 : Math.max(etapaDe(etapa).probabilidad, Math.min(o.probabilidad, 95));
	const { error } = await client
		.from('oportunidad')
		.update({ etapa, probabilidad, ...(etapa === 'perdida' ? { motivo_perdida: motivoPerdida } : {}) })
		.eq('id_oportunidad', o.id_oportunidad);
	if (error) throw error;
}

/** Archivar (sale de las vistas; no se borra). */
export async function archivarOportunidad(client: SupabaseClient, id: number): Promise<void> {
	const { error } = await client.from('oportunidad').update({ activo: false }).eq('id_oportunidad', id);
	if (error) throw error;
}

export async function guardarActividad(client: SupabaseClient, a: Omit<ActividadOportunidad, 'id_actividad'>, id?: number | null): Promise<void> {
	const { error } = id ? await client.from('oportunidad_actividad').update(a).eq('id_actividad', id) : await client.from('oportunidad_actividad').insert(a);
	if (error) throw error;
}
export async function completarActividad(client: SupabaseClient, id: number, completada: boolean): Promise<void> {
	const { error } = await client.from('oportunidad_actividad').update({ completada }).eq('id_actividad', id);
	if (error) throw error;
}
export async function borrarActividad(client: SupabaseClient, id: number): Promise<void> {
	const { error } = await client.from('oportunidad_actividad').delete().eq('id_actividad', id);
	if (error) throw error;
}

/** Clientes registrados para elegir (o se escribe un prospecto nuevo). */
export async function getClientesOpciones(client: SupabaseClient): Promise<{ id: number; nombre: string; doc: string | null }[]> {
	const { data, error } = await client.from('cliente').select('id_cliente, nombre, num_documento').order('nombre');
	if (error) return [];
	return ((data ?? []) as any[]).map((c) => ({ id: Number(c.id_cliente), nombre: c.nombre, doc: c.num_documento ?? null }));
}
/** Ejecutivos comerciales = usuarios activos del ERP. */
export async function getEjecutivos(client: SupabaseClient): Promise<{ id: number; nombre: string }[]> {
	const { data, error } = await client.from('empleados').select('id, nombre').eq('estado', 'activo').order('nombre');
	if (error) return [];
	return ((data ?? []) as any[]).map((e) => ({ id: Number(e.id), nombre: e.nombre }));
}
