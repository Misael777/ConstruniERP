/**
 * Servicio de Incidencias — Control Financiero (ver control_financiero_migration.sql). Registra
 * hallazgos generados por Consistencia/Conciliación (o dados de alta a mano) y su ciclo de vida:
 * OPEN → INVESTIGATING → CAUSE_IDENTIFIED → (ADJUSTMENT_REQUIRED →) RESOLVED → CLOSED. Cada
 * transición es su PROPIA función (mismo criterio que aprobarSolicitud/rechazarSolicitud en
 * aprobaciones.service.ts) — nunca un updateEstado(id, cualquierEstado) genérico — y deja registro
 * en `incidencia_evento`, que es el historial/auditoría propio de la incidencia (no
 * instance_audit_log: ese trigger exige project_id, y una incidencia financiera no está atada a un
 * proyecto). 100% client-side (Supabase anon key), igual que el resto del ERP.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type Severidad = 'baja' | 'media' | 'alta' | 'critica';
export type EstadoIncidencia = 'OPEN' | 'INVESTIGATING' | 'CAUSE_IDENTIFIED' | 'ADJUSTMENT_REQUIRED' | 'RESOLVED' | 'CLOSED';
export type TipoEntidadIncidencia = 'conciliacion' | 'centro_costo' | 'cuenta_banco' | 'transaccion' | 'revision_financiera' | 'otro';

export interface Incidencia {
	id_incidencia: number;
	severidad: Severidad;
	estado: EstadoIncidencia;
	fecha_deteccion: string;
	tipo_entidad: TipoEntidadIncidencia;
	id_entidad: number | null;
	origen_check: string | null;
	causa: string | null;
	descripcion: string;
	monto_diferencia: number | null;
	creado_por: string | null;
	resuelto_por: string | null;
	resuelto_en: string | null;
	created_at: string;
}

export interface IncidenciaEvento {
	id_evento: number;
	id_incidencia: number;
	tipo_evento: 'creacion' | 'cambio_estado' | 'nota' | 'ajuste_registrado';
	estado_anterior: EstadoIncidencia | null;
	estado_nuevo: EstadoIncidencia | null;
	comentario: string | null;
	usuario: string | null;
	created_at: string;
}

export interface ServiceResult<T = undefined> {
	success: boolean;
	message: string;
	data?: T;
}

const TABLE_NAME = 'incidencia';
const EVENTO_TABLE = 'incidencia_evento';

/** Etiqueta legible para "entidad afectada" en la lista — resuelve a algo humano cuando es barato
 * (numero_cuenta/codigo), si no cae a "tipo #id". No lanza si la entidad ya no existe (dato
 * históricamente correcto, la incidencia sigue siendo válida aunque el registro se haya borrado). */
export async function getEtiquetaEntidadAfectada(client: SupabaseClient, tipoEntidad: TipoEntidadIncidencia, idEntidad: number | null): Promise<string> {
	if (idEntidad === null) return tipoEntidad;
	try {
		if (tipoEntidad === 'cuenta_banco') {
			const { data } = await client.from('cuenta_banco').select('numero_cuenta').eq('id_cuenta_banco', idEntidad).maybeSingle();
			if (data?.numero_cuenta) return `Cuenta ${data.numero_cuenta}`;
		} else if (tipoEntidad === 'centro_costo') {
			const { data } = await client.from('centro_costo').select('codigo').eq('id_centro_costo', idEntidad).maybeSingle();
			if (data?.codigo) return `Centro de Costo ${data.codigo}`;
		} else if (tipoEntidad === 'conciliacion') {
			return `Conciliación #${idEntidad}`;
		}
	} catch {
		// dato huérfano/borrado — cae al fallback genérico de abajo
	}
	return `${tipoEntidad} #${idEntidad}`;
}

export interface FiltrosIncidencia {
	estado?: EstadoIncidencia;
	severidad?: Severidad;
	/** Por defecto oculta CLOSED (a pedido implícito del flujo: una incidencia cerrada ya no necesita
	 * gestión activa). Si el usuario filtra explícitamente por estado='CLOSED', se respeta. */
	incluirCerradas?: boolean;
}

export async function getIncidencias(client: SupabaseClient, filtros: FiltrosIncidencia = {}): Promise<Incidencia[]> {
	let query = client.from(TABLE_NAME).select('*').order('fecha_deteccion', { ascending: false });
	if (filtros.estado) query = query.eq('estado', filtros.estado);
	else if (!filtros.incluirCerradas) query = query.neq('estado', 'CLOSED');
	if (filtros.severidad) query = query.eq('severidad', filtros.severidad);
	const { data, error } = await query;
	if (error) throw error;
	return (data ?? []) as Incidencia[];
}

/** Conteo de incidencias abiertas (todo lo que no es RESOLVED/CLOSED) — para el KPI del Dashboard. */
export async function getIncidenciasAbiertasCount(client: SupabaseClient): Promise<number> {
	const { count, error } = await client
		.from(TABLE_NAME)
		.select('id_incidencia', { count: 'exact', head: true })
		.not('estado', 'in', '(RESOLVED,CLOSED)');
	if (error) throw error;
	return count ?? 0;
}

export async function getEventosIncidencia(client: SupabaseClient, idIncidencia: number): Promise<IncidenciaEvento[]> {
	const { data, error } = await client.from(EVENTO_TABLE).select('*').eq('id_incidencia', idIncidencia).order('created_at', { ascending: true });
	if (error) throw error;
	return (data ?? []) as IncidenciaEvento[];
}

export interface CrearIncidenciaPayload {
	severidad: Severidad;
	tipo_entidad: TipoEntidadIncidencia;
	id_entidad: number | null;
	origen_check?: string | null;
	descripcion: string;
	monto_diferencia?: number | null;
}

/** Alta de una incidencia — usada tanto por el flujo automático (Conciliación con diferencia,
 * chequeos de Consistencia en 'error') como por un alta manual desde la UI. Deja el primer evento
 * ('creacion') en el historial. */
export async function crearIncidencia(client: SupabaseClient, payload: CrearIncidenciaPayload, creadoPor: string | null): Promise<ServiceResult<Incidencia>> {
	const { data, error } = await client
		.from(TABLE_NAME)
		.insert({ ...payload, creado_por: creadoPor })
		.select('*')
		.single();
	if (error) return { success: false, message: `No se pudo crear la incidencia: ${error.message}` };

	await client.from(EVENTO_TABLE).insert({
		id_incidencia: data.id_incidencia,
		tipo_evento: 'creacion',
		estado_nuevo: 'OPEN',
		comentario: payload.descripcion,
		usuario: creadoPor
	});

	return { success: true, message: 'Incidencia creada', data: data as Incidencia };
}

async function transicionar(
	client: SupabaseClient,
	id: number,
	estadoNuevo: EstadoIncidencia,
	camposExtra: Record<string, unknown>,
	usuario: string | null,
	comentario: string | null
): Promise<ServiceResult<Incidencia>> {
	const { data: actual } = await client.from(TABLE_NAME).select('estado').eq('id_incidencia', id).single();
	if (!actual) return { success: false, message: 'Incidencia no encontrada' };

	const { data, error } = await client
		.from(TABLE_NAME)
		.update({ estado: estadoNuevo, ...camposExtra })
		.eq('id_incidencia', id)
		.select('*')
		.single();
	if (error) return { success: false, message: `No se pudo actualizar la incidencia: ${error.message}` };

	await client.from(EVENTO_TABLE).insert({
		id_incidencia: id,
		tipo_evento: 'cambio_estado',
		estado_anterior: actual.estado,
		estado_nuevo: estadoNuevo,
		comentario,
		usuario
	});

	return { success: true, message: 'Incidencia actualizada', data: data as Incidencia };
}

export async function iniciarInvestigacion(client: SupabaseClient, id: number, usuario: string | null): Promise<ServiceResult<Incidencia>> {
	return transicionar(client, id, 'INVESTIGATING', {}, usuario, 'Investigación iniciada');
}

export async function identificarCausa(client: SupabaseClient, id: number, causa: string, usuario: string | null): Promise<ServiceResult<Incidencia>> {
	if (!causa.trim()) return { success: false, message: 'Describe la causa antes de continuar.' };
	return transicionar(client, id, 'CAUSE_IDENTIFIED', { causa: causa.trim() }, usuario, causa.trim());
}

export async function requerirAjuste(client: SupabaseClient, id: number, usuario: string | null): Promise<ServiceResult<Incidencia>> {
	return transicionar(client, id, 'ADJUSTMENT_REQUIRED', {}, usuario, 'Se requiere un ajuste para resolver');
}

/** La causa identificada no implica corregir ningún saldo (ej. una diferencia de tiempo que se
 * autorresuelve) — resuelve directo sin pasar por ADJUSTMENT_REQUIRED. */
export async function resolverSinAjuste(client: SupabaseClient, id: number, comentario: string, usuario: string | null): Promise<ServiceResult<Incidencia>> {
	return transicionar(client, id, 'RESOLVED', { resuelto_por: usuario, resuelto_en: new Date().toISOString() }, usuario, comentario || 'Resuelta sin necesidad de ajuste');
}

/** Cierra el ciclo cuando SÍ hizo falta un ajuste — a diferencia de las demás transiciones, esta
 * exige que el llamador ya haya verificado credenciales de administrador con verifyAdminCredentials
 * + AdminConfirmModal ANTES de llamar a esto (mismo criterio que confirmarEliminarPermanente en
 * cuentas-pagar/+page.svelte): un ajuste redefine "la verdad" de un saldo, no es una transición de
 * workflow más. Deja un evento 'ajuste_registrado' además del cambio de estado, para que el
 * historial distinga claramente un ajuste real de una resolución sin ajuste. */
export async function registrarAjusteYResolver(client: SupabaseClient, id: number, comentarioAjuste: string, usuario: string | null): Promise<ServiceResult<Incidencia>> {
	if (!comentarioAjuste.trim()) return { success: false, message: 'Describe el ajuste realizado antes de continuar.' };

	const { data: actual } = await client.from(TABLE_NAME).select('estado').eq('id_incidencia', id).single();
	if (!actual) return { success: false, message: 'Incidencia no encontrada' };

	const { data, error } = await client
		.from(TABLE_NAME)
		.update({ estado: 'RESOLVED', resuelto_por: usuario, resuelto_en: new Date().toISOString() })
		.eq('id_incidencia', id)
		.select('*')
		.single();
	if (error) return { success: false, message: `No se pudo registrar el ajuste: ${error.message}` };

	await client.from(EVENTO_TABLE).insert({
		id_incidencia: id,
		tipo_evento: 'ajuste_registrado',
		estado_anterior: actual.estado,
		estado_nuevo: 'RESOLVED',
		comentario: comentarioAjuste.trim(),
		usuario
	});

	return { success: true, message: 'Ajuste registrado — incidencia resuelta', data: data as Incidencia };
}

export async function cerrarIncidencia(client: SupabaseClient, id: number, usuario: string | null): Promise<ServiceResult<Incidencia>> {
	return transicionar(client, id, 'CLOSED', {}, usuario, 'Incidencia cerrada');
}
