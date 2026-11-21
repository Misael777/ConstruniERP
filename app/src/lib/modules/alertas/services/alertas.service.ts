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
	const resultados = await Promise.allSettled(tareas);
	resultados.forEach((r) => r.status === 'rejected' && console.error('[alertas] No se pudo cargar un grupo de alertas:', r.reason));
	return resultados.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])).sort((a, b) => a.fecha.localeCompare(b.fecha));
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
	for (const p of (data ?? []) as any[]) {
		const nombre = [p.nombres, p.apellidos].filter(Boolean).join(' ').trim() || p.nombre || `Trabajador #${p.id_personal}`;
		const items: [string, string | null, number][] = [
			['SCTR', p.sctr_vencimiento, DIAS_AVISO_SCTR],
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
				responsable: null,
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
