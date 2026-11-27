/**
 * Alertas de tareas (ícono ⚠ de la cabecera, pedido de la clienta con imagen, 20/11/2026): junta en un solo lugar lo
 * que vence pronto o ya venció en todo el ERP, para no tener que revisar módulo por módulo (p. ej. renovar el SCTR).
 *
 * No hay una tabla de "tareas": cada alerta se deriva de los datos de su módulo.
 *  - Recursos Humanos: SCTR (7 días antes) y examen médico (30 días antes), mismas reglas que Personal.
 *  - Proyectos: actividades del cronograma que terminan en ≤ 7 días (o ya debían terminar) y no están al 100 %.
 *  - Finanzas: cuotas por cobrar y pagos por pagar programados que vencen en ≤ 7 días o ya vencieron — UNA alerta
 *    por cuenta (no por cuota), para que la deuda antigua no infle el contador.
 *
 * "Mis tareas" = soy el responsable de la cuenta. "Delegadas" = la registré yo y el responsable es otra persona.
 * Personal: el responsable es "Responsable de los vencimientos" de la ficha (ticket #125). Sin responsable (o el
 * cronograma) solo aparecen en "Todas".
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { DIAS_AVISO_SCTR, DIAS_AVISO_VENCIMIENTO, hoyLima } from '$lib/modules/personal/services/personal.service';

export type ModuloAlerta = 'rrhh' | 'proyectos' | 'finanzas';
export type PrioridadAlerta = 'alta' | 'media' | 'baja';

export interface AlertaTarea {
	id: string;
	modulo: ModuloAlerta;
	titulo: string;
	detalle?: string;
	/** Fecha que manda (la más antigua vencida o la próxima), 'AAAA-MM-DD'. */
	fecha: string;
	prioridad: PrioridadAlerta;
	/** true: la prioridad la puso alguien (en la cuenta o en tarea_prioridad); false: automática por fecha. */
	prioridadManual?: boolean;
	responsable: string | null;
	registradoPor: string | null;
	href: string;
}

export const DIAS_ALERTA_FINANZAS = 7;
export const DIAS_ALERTA_PROYECTOS = 7;

const sumarDias = (fecha: string, dias: number) => {
	const d = new Date(`${fecha}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + dias);
	return d.toISOString().slice(0, 10);
};

/** Días desde hoy hasta la fecha (negativo = vencido). */
export function diasHasta(fecha: string, hoy = hoyLima()): number {
	return Math.round((Date.parse(fecha) - Date.parse(hoy)) / 86_400_000);
}

/** Prioridad de la cuenta si la tiene (alto/medio/bajo); si no, por fecha: vencido, hoy o mañana = Alta. */
function prioridadDe(valor: string | null | undefined, fecha: string, hoy: string): PrioridadAlerta {
	const v = (valor ?? '').toLowerCase();
	if (v.startsWith('alt')) return 'alta';
	if (v.startsWith('med')) return 'media';
	if (v.startsWith('baj')) return 'baja';
	return diasHasta(fecha, hoy) <= 1 ? 'alta' : 'media';
}

const s2 = (n: number) => `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function getAlertasTareas(client: SupabaseClient, modulos: Record<ModuloAlerta, boolean>): Promise<AlertaTarea[]> {
	const hoy = hoyLima();
	const tareas: Promise<AlertaTarea[]>[] = [];
	if (modulos.rrhh) tareas.push(alertasPersonal(client, hoy));
	if (modulos.proyectos) tareas.push(alertasCronograma(client, hoy));
	if (modulos.finanzas) tareas.push(alertasCobros(client, hoy), alertasPagos(client, hoy));
	// Un módulo que falla no tumba a los demás (el panel muestra lo que sí cargó).
	const [resultados, manuales] = await Promise.all([Promise.allSettled(tareas), getPrioridadesManuales(client)]);
	resultados.forEach((r) => r.status === 'rejected' && console.error('[alertas] No se pudo cargar un grupo de alertas:', r.reason));
	return resultados
		.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
		.map((a) => {
			// Finanzas guarda la prioridad en la cuenta (ya viene aplicada); el resto, en tarea_prioridad.
			const m = a.modulo !== 'finanzas' ? manuales.get(a.id) : undefined;
			return m ? { ...a, prioridad: m, prioridadManual: true } : a;
		})
		.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

async function alertasPersonal(client: SupabaseClient, hoy: string): Promise<AlertaTarea[]> {
	const consultar = (columnas: string) =>
		client
			.from('personal')
			.select(columnas)
			.neq('estado', 'baja')
			.or(`sctr_vencimiento.lte.${sumarDias(hoy, DIAS_AVISO_SCTR)},examen_medico_vencimiento.lte.${sumarDias(hoy, DIAS_AVISO_VENCIMIENTO)}`);
	const BASE = 'id_personal, nombres, apellidos, nombre, sctr_vencimiento, examen_medico_vencimiento';
	let { data, error } = await consultar(`${BASE}, responsable_vencimientos`);
	// Base sin la migración 20261121130000 (columna responsable_vencimientos): sin responsable.
	if (error?.code === '42703' || error?.code === 'PGRST204') ({ data, error } = await consultar(BASE));
	if (error) throw error;
	const out: AlertaTarea[] = [];
	const nombreDe = (p: any) => [p?.nombres, p?.apellidos].filter(Boolean).join(' ').trim() || p?.nombre || 'Trabajador';

	// Ticket #110: seguros (SCTR salud, SCTR pensión, Vida Ley) y contratos — avisa por el ÚLTIMO de cada tipo.
	const SEGURO: Record<string, [string, number]> = { sctr_salud: ['SCTR salud', 7], sctr_pension: ['SCTR pensión', 7], vida_ley: ['Vida Ley', 30] };
	const conSctrNuevo = new Set<number>();
	const [{ data: segs }, { data: conts }] = await Promise.all([
		client.from('personal_seguro').select('id_personal, tipo, fecha_fin, personal!inner(nombres, apellidos, nombre, estado, responsable_vencimientos)').not('fecha_fin', 'is', null).neq('personal.estado', 'baja'),
		client.from('personal_contrato').select('id_personal, numero, fecha_fin, personal!inner(nombres, apellidos, nombre, estado, responsable_vencimientos)').not('fecha_fin', 'is', null).neq('personal.estado', 'baja')
	]);
	const ultimo = new Map<string, any>();
	for (const s of (segs ?? []) as any[]) {
		if (s.tipo !== 'vida_ley') conSctrNuevo.add(s.id_personal);
		const k = `${s.id_personal}:${s.tipo}`;
		if (!ultimo.has(k) || ultimo.get(k).fecha_fin < s.fecha_fin) ultimo.set(k, s);
	}
	for (const c of (conts ?? []) as any[]) {
		const k = `${c.id_personal}:contrato`;
		if (!ultimo.has(k) || ultimo.get(k).fecha_fin < c.fecha_fin) ultimo.set(k, { ...c, tipo: 'contrato' });
	}
	for (const [k, x] of ultimo) {
		const [que, aviso] = x.tipo === 'contrato' ? [`Contrato${x.numero ? ` ${x.numero}` : ''}`, 30] : SEGURO[x.tipo] ?? [x.tipo, 7];
		const per = Array.isArray(x.personal) ? x.personal[0] : x.personal;
		if (diasHasta(x.fecha_fin, hoy) > aviso) continue;
		out.push({
			id: `rrhh-${k}`,
			modulo: 'rrhh',
			titulo: `${que} · ${nombreDe(per)}`,
			detalle: diasHasta(x.fecha_fin, hoy) < 0 ? 'Renovar: ya venció' : 'Renovar antes del vencimiento',
			fecha: x.fecha_fin,
			prioridad: diasHasta(x.fecha_fin, hoy) <= 3 ? 'alta' : 'media',
			responsable: per?.responsable_vencimientos ?? null,
			registradoPor: null,
			href: '/rrhh/personal'
		});
	}

	for (const p of (data ?? []) as any[]) {
		const nombre = [p.nombres, p.apellidos].filter(Boolean).join(' ').trim() || p.nombre || `Trabajador #${p.id_personal}`;
		const items: [string, string | null, number][] = [
			// El SCTR de la versión anterior (un solo campo) solo avisa si aún no tiene SCTR en el historial de seguros.
			['SCTR', conSctrNuevo.has(p.id_personal) ? null : p.sctr_vencimiento, DIAS_AVISO_SCTR],
			['Examen médico', p.examen_medico_vencimiento, DIAS_AVISO_VENCIMIENTO]
		];
		for (const [que, fecha, aviso] of items) {
			if (!fecha || diasHasta(fecha, hoy) > aviso) continue;
			out.push({
				id: `rrhh-${que}-${p.id_personal}`,
				modulo: 'rrhh',
				titulo: `${que} · ${nombre}`,
				detalle: diasHasta(fecha, hoy) < 0 ? 'Renovar: ya venció' : 'Renovar antes del vencimiento',
				fecha,
				prioridad: diasHasta(fecha, hoy) <= 3 ? 'alta' : 'media',
				// Ticket #125 (rechazado 24/11/2026): la alerta va a "Mis tareas" del responsable de los vencimientos.
				responsable: p.responsable_vencimientos ?? null,
				registradoPor: null,
				href: '/rrhh/personal'
			});
		}
	}
	return out;
}

async function alertasCronograma(client: SupabaseClient, hoy: string): Promise<AlertaTarea[]> {
	const { data, error } = await client
		.from('cronograma_actividad')
		.select('id_cronograma_actividad, id_proyecto, nombre_actividad, fecha_fin_plan, porcentaje_avance_real, fecha_fin_real, usuario_registro, proyecto(nombre_proyecto)')
		.is('fecha_fin_real', null)
		.not('fecha_fin_plan', 'is', null)
		.lte('fecha_fin_plan', sumarDias(hoy, DIAS_ALERTA_PROYECTOS));
	if (error) throw error;
	return (data ?? [])
		.filter((a: any) => Number(a.porcentaje_avance_real ?? 0) < 100)
		.map((a: any) => ({
			id: `proy-${a.id_cronograma_actividad}`,
			modulo: 'proyectos' as const,
			titulo: `${a.nombre_actividad} · ${a.proyecto?.nombre_proyecto ?? `Proyecto #${a.id_proyecto}`}`,
			detalle: `Avance ${Number(a.porcentaje_avance_real ?? 0)} %`,
			fecha: a.fecha_fin_plan,
			prioridad: prioridadDe(null, a.fecha_fin_plan, hoy),
			responsable: null,
			registradoPor: a.usuario_registro ?? null,
			href: `/proyectos/gestion/${a.id_proyecto}`
		}));
}

/** Agrupa cuotas por cuenta: la fecha que manda es la más antigua; el detalle dice cuántas vencieron / vienen. */
function agrupar<T extends { fecha: string; monto: number }>(cuotas: T[], hoy: string) {
	const ordenadas = [...cuotas].sort((a, b) => a.fecha.localeCompare(b.fecha));
	const vencidas = ordenadas.filter((c) => c.fecha < hoy);
	const total = ordenadas.reduce((s, c) => s + c.monto, 0);
	const partes: string[] = [];
	if (vencidas.length) partes.push(`${vencidas.length} cuota${vencidas.length === 1 ? '' : 's'} vencida${vencidas.length === 1 ? '' : 's'}`);
	const proximas = ordenadas.length - vencidas.length;
	if (proximas) partes.push(`${proximas} por vencer`);
	return { fecha: ordenadas[0].fecha, detalle: `${partes.join(' · ')} · ${s2(total)}`, primera: ordenadas[0] };
}

async function alertasCobros(client: SupabaseClient, hoy: string): Promise<AlertaTarea[]> {
	const { data, error } = await client
		.from('cobros')
		.select('id_cobro, id_cuenta_cobrar, monto, fecha_cobro, cobro_grupo(tipo), cuentas_cobrar!inner(responsable, usuario_registro, prioridad, activo, proyecto(nombre_proyecto), cliente(nombre))')
		.eq('estado_cobro', 'programado')
		.eq('cuentas_cobrar.activo', true)
		.lte('fecha_cobro', sumarDias(hoy, DIAS_ALERTA_FINANZAS));
	if (error) throw error;
	const porCuenta = new Map<number, any[]>();
	for (const c of data ?? []) porCuenta.set(c.id_cuenta_cobrar, [...(porCuenta.get(c.id_cuenta_cobrar) ?? []), c]);
	return [...porCuenta.entries()].map(([id, lista]) => {
		const cc = lista[0].cuentas_cobrar;
		const g = agrupar(lista.map((c: any) => ({ fecha: c.fecha_cobro as string, monto: Number(c.monto), tipo: c.cobro_grupo?.tipo })), hoy);
		const soloValorizacion = lista.every((c: any) => c.cobro_grupo?.tipo === 'valorizacion');
		const nombre = cc?.proyecto?.nombre_proyecto ?? cc?.cliente?.nombre ?? `Cuenta #${id}`;
		return {
			id: `cxc-${id}`,
			modulo: 'finanzas' as const,
			titulo: `${soloValorizacion ? 'Cobro de valorización' : 'Cuenta por cobrar'} · ${nombre}`,
			detalle: g.detalle,
			fecha: g.fecha,
			prioridad: prioridadDe(cc?.prioridad, g.fecha, hoy),
			prioridadManual: !!cc?.prioridad,
			responsable: cc?.responsable ?? null,
			registradoPor: cc?.usuario_registro ?? null,
			href: `/finanzas/cuentas-cobrar?resumenCuenta=${id}`
		};
	});
}

async function alertasPagos(client: SupabaseClient, hoy: string): Promise<AlertaTarea[]> {
	const { data, error } = await client
		.from('pagos')
		.select('id_pago, id_cuenta_pagar, monto, fecha_pago, cuentas_pagar!inner(responsable, usuario_registro, prioridad, activo, num_documento, proveedor(razon_social))')
		.eq('estado_pago', 'programado')
		.eq('cuentas_pagar.activo', true)
		.lte('fecha_pago', sumarDias(hoy, DIAS_ALERTA_FINANZAS));
	if (error) throw error;
	const porCuenta = new Map<number, any[]>();
	for (const p of data ?? []) porCuenta.set(p.id_cuenta_pagar, [...(porCuenta.get(p.id_cuenta_pagar) ?? []), p]);
	return [...porCuenta.entries()].map(([id, lista]) => {
		const cp = lista[0].cuentas_pagar;
		const g = agrupar(lista.map((p: any) => ({ fecha: p.fecha_pago as string, monto: Number(p.monto) })), hoy);
		const nombre = cp?.proveedor?.razon_social ?? cp?.num_documento ?? `Cuenta #${id}`;
		return {
			id: `cxp-${id}`,
			modulo: 'finanzas' as const,
			titulo: `Cuenta por pagar · ${nombre}`,
			detalle: g.detalle,
			fecha: g.fecha,
			prioridad: prioridadDe(cp?.prioridad, g.fecha, hoy),
			prioridadManual: !!cp?.prioridad,
			responsable: cp?.responsable ?? null,
			registradoPor: cp?.usuario_registro ?? null,
			href: '/finanzas/cuentas-pagar'
		};
	});
}

/** "Vence hoy" / "Vence mañana" / "Vencido hace 3 d" / "23 nov." */
export function etiquetaVencimiento(fecha: string, hoy = hoyLima()): { texto: string; urgente: boolean } {
	const d = diasHasta(fecha, hoy);
	if (d < 0) return { texto: d === -1 ? 'Venció ayer' : `Vencido hace ${-d} d`, urgente: true };
	if (d === 0) return { texto: 'Vence hoy', urgente: true };
	if (d === 1) return { texto: 'Vence mañana', urgente: true };
	const f = new Date(`${fecha}T12:00:00Z`);
	return { texto: f.toLocaleDateString('es-PE', { day: 'numeric', month: 'short', timeZone: 'UTC' }), urgente: false };
}

// ─────────────── Ticket #112: "Tareas de hoy" — aplazar o completar una alerta (por usuario) ───────────────

export interface EstadoTarea {
	id_alerta: string;
	estado: 'aplazada' | 'completada';
	aplazada_hasta: string | null;
	fecha_alerta: string | null;
}

/** Lo que el usuario hizo con sus alertas. Sin la migración 20261127150000: vacío (todas pendientes). */
export async function getEstadosTareas(client: SupabaseClient): Promise<Map<string, EstadoTarea>> {
	const { data, error } = await client.from('tarea_estado').select('id_alerta, estado, aplazada_hasta, fecha_alerta');
	if (error) return new Map();
	return new Map(((data ?? []) as EstadoTarea[]).map((e) => [e.id_alerta, e]));
}

/** Aplaza (hasta una fecha), completa o devuelve a pendiente (estado null) una alerta. */
export async function guardarEstadoTarea(client: SupabaseClient, alerta: AlertaTarea, estado: 'aplazada' | 'completada' | null, aplazadaHasta: string | null = null): Promise<void> {
	if (!estado) {
		const { error } = await client.from('tarea_estado').delete().eq('id_alerta', alerta.id);
		if (error) throw error;
		return;
	}
	const { data: u } = await client.auth.getUser();
	const { error } = await client.from('tarea_estado').upsert(
		{ auth_user_id: u.user?.id, id_alerta: alerta.id, estado, aplazada_hasta: estado === 'aplazada' ? aplazadaHasta : null, fecha_alerta: alerta.fecha, updated_at: new Date().toISOString() },
		{ onConflict: 'auth_user_id,id_alerta' }
	);
	if (error) throw error;
}

/** En qué pestaña va una alerta: completada (si no cambió de fecha), aplazada (hasta una fecha futura) o hoy. */
export function pestanaTarea(a: AlertaTarea, e: EstadoTarea | undefined, hoy = hoyLima()): 'hoy' | 'aplazada' | 'completada' {
	if (!e || (e.fecha_alerta && e.fecha_alerta !== a.fecha)) return 'hoy';
	if (e.estado === 'completada') return 'completada';
	return e.aplazada_hasta && e.aplazada_hasta > hoy ? 'aplazada' : 'hoy';
}

// ─────────────── Pedido 27/11/2026: prioridad a mano (compartida) y orden a mano (personal) ───────────────

/** Prioridades puestas a mano en RRHH/Proyectos (tabla tarea_prioridad). Sin la migración 20261127180000: vacío. */
async function getPrioridadesManuales(client: SupabaseClient): Promise<Map<string, PrioridadAlerta>> {
	const { data, error } = await client.from('tarea_prioridad').select('id_alerta, prioridad');
	if (error) return new Map();
	return new Map(((data ?? []) as { id_alerta: string; prioridad: PrioridadAlerta }[]).map((r) => [r.id_alerta, r.prioridad]));
}

/**
 * Cambia la prioridad de una tarea para todos (null = volver a automática, por fecha). En Finanzas se guarda en la
 * cuenta por cobrar/pagar (la misma prioridad que se ve en esos módulos; CxC usa alto/medio/bajo y CxP alto/media/bajo).
 */
export async function guardarPrioridadTarea(client: SupabaseClient, alerta: AlertaTarea, prioridad: PrioridadAlerta | null, usuario: string | null = null): Promise<void> {
	const m = /^cx([cp])-(\d+)$/.exec(alerta.id);
	if (m) {
		const cobrar = m[1] === 'c';
		const valor = !prioridad ? null : prioridad === 'alta' ? 'alto' : prioridad === 'baja' ? 'bajo' : cobrar ? 'medio' : 'media';
		const { error } = await client
			.from(cobrar ? 'cuentas_cobrar' : 'cuentas_pagar')
			.update({ prioridad: valor })
			.eq(cobrar ? 'id_cuenta_cobrar' : 'id_cuenta_pagar', Number(m[2]));
		if (error) throw error;
		return;
	}
	const { error } = prioridad
		? await client.from('tarea_prioridad').upsert({ id_alerta: alerta.id, prioridad, usuario, updated_at: new Date().toISOString() }, { onConflict: 'id_alerta' })
		: await client.from('tarea_prioridad').delete().eq('id_alerta', alerta.id);
	if (error) throw error;
}

/** Orden manual del usuario (id de alerta → posición). Sin la migración 20261127180000: vacío. */
export async function getOrdenTareas(client: SupabaseClient): Promise<Map<string, number>> {
	const { data, error } = await client.from('tarea_orden').select('id_alerta, orden');
	if (error) return new Map();
	return new Map(((data ?? []) as { id_alerta: string; orden: number }[]).map((r) => [r.id_alerta, r.orden]));
}

/** Guarda el orden manual de una lista de tareas (la posición en el arreglo). */
export async function guardarOrdenTareas(client: SupabaseClient, ids: string[]): Promise<void> {
	if (!ids.length) return;
	const { data: u } = await client.auth.getUser();
	const ahora = new Date().toISOString();
	const { error } = await client
		.from('tarea_orden')
		.upsert(ids.map((id_alerta, orden) => ({ auth_user_id: u.user?.id, id_alerta, orden, updated_at: ahora })), { onConflict: 'auth_user_id,id_alerta' });
	if (error) throw error;
}

/**
 * Día en que la tarea va en el calendario: el día al que se movió (tarea_estado 'aplazada', aplazada_hasta) o su fecha;
 * nunca antes de hoy (lo vencido va en hoy, marcado como vencido). Si la alerta cambió de fecha, se ignora lo guardado.
 */
export function diaPlanTarea(a: AlertaTarea, e: EstadoTarea | undefined, hoy = hoyLima()): string {
	const vigente = e && (!e.fecha_alerta || e.fecha_alerta === a.fecha);
	const dia = vigente && e!.estado === 'aplazada' && e!.aplazada_hasta ? e!.aplazada_hasta : a.fecha;
	return dia < hoy ? hoy : dia;
}
