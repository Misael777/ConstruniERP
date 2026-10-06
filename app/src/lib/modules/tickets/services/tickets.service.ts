/**
 * Módulo de Tickets (Libro de Reclamaciones/Incidencias) — reemplaza el reporte de reclamos/
 * sugerencias/incidencias/requerimientos por WhatsApp con algo trazable dentro del propio ERP (el
 * cliente no tiene acceso a GitHub ni sabe qué es). Ver Documentacion/PlanModuloTicketsYReleases.md
 * para el diseño completo.
 *
 * Ciclo de vida (orden estricto, ver el plan): abierto → en_progreso → resuelto → aprobado|rechazado.
 * Solo Admin aprueba/rechaza (isAdmin(), gate de UI — mismo criterio "sin RLS real" que el resto del
 * ERP). Un ticket 'aprobado' queda esperando a que el script de deploy (fuera de la app, ver
 * Documentacion/MecanismoCICD.md) lo agrupe en un release y lo pase directo a 'cerrado' — no hay una
 * acción de "cerrar" manual dentro del ERP.
 *
 * Recibe el SupabaseClient como parámetro — mismo criterio que el resto de los servicios del ERP.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { permisosState } from '$lib/stores/permisos.svelte';

export type TipoTicket = 'reclamo' | 'sugerencia' | 'incidencia' | 'requerimiento';
export type PrioridadTicket = 'baja' | 'media' | 'alta' | 'critica';
export type EstadoTicket = 'abierto' | 'en_progreso' | 'resuelto' | 'aprobado' | 'rechazado' | 'cerrado';
/** Ticket #63: 'app' = app del celular, 'web' = navegador o app de escritorio. null = tickets anteriores. */
export type PlataformaTicket = 'web' | 'app';

export interface Ticket {
	id_ticket: number;
	tipo: TipoTicket;
	modulo: string | null;
	titulo: string;
	descripcion: string;
	prioridad: PrioridadTicket;
	estado: EstadoTicket;
	creado_por: string | null;
	creado_por_id: string | null;
	resuelto_por: string | null;
	resuelto_en: string | null;
	aprobado_por: string | null;
	aprobado_en: string | null;
	motivo_rechazo: string | null;
	id_release: number | null;
	created_at: string;
	imagen_url: string | null;
	plataforma?: PlataformaTicket | null;
}

export interface TicketComentario {
	id_comentario: number;
	id_ticket: number;
	autor: string | null;
	autor_id: string | null;
	mensaje: string;
	created_at: string;
	imagen_url: string | null;
}

export interface ServiceResult<T = undefined> {
	success: boolean;
	message?: string;
	data?: T;
}

const TABLE_NAME = 'ticket';
const COMENTARIO_TABLE = 'ticket_comentario';
const EVENTO_TABLE = 'ticket_evento';

/** Registra un cambio de estado en ticket_evento — mismo patrón de auditoría que incidencia_evento en
 * control-financiero. Best-effort: si falla, no bloquea la transición principal (ya se guardó el
 * estado nuevo en `ticket`, perder solo el registro de auditoría no amerita revertir la acción real). */
async function registrarEvento(
	client: SupabaseClient,
	idTicket: number,
	estadoAnterior: string | null,
	estadoNuevo: string,
	usuario: string | null,
	comentario?: string | null
): Promise<void> {
	try {
		await client.from(EVENTO_TABLE).insert({
			id_ticket: idTicket,
			estado_anterior: estadoAnterior,
			estado_nuevo: estadoNuevo,
			usuario,
			comentario: comentario ?? null
		});
	} catch (err) {
		console.warn('[tickets.service] No se pudo registrar el evento de auditoría:', err);
	}
}

/** Crea un ticket nuevo — cualquier usuario con el permiso 'ver_soporte_tickets' (otorgado a todos
 * los roles, ver ticket_module_migration.sql) puede reportar. Resuelve "quién lo crea" internamente
 * (permisosState.userName + auth.getUser().id), mismo criterio que crearSolicitud en
 * aprobaciones.service.ts. */
export async function crearTicket(
	client: SupabaseClient,
	params: { tipo: TipoTicket; modulo: string | null; titulo: string; descripcion: string; prioridad: PrioridadTicket; imagenUrl?: string | null; plataforma?: PlataformaTicket | null }
): Promise<ServiceResult<Ticket>> {
	try {
		const { data: userData } = await client.auth.getUser();
		const creadoPor = permisosState.userName || null;
		const fila: Record<string, unknown> = {
			tipo: params.tipo,
			modulo: params.modulo,
			titulo: params.titulo,
			descripcion: params.descripcion,
			prioridad: params.prioridad,
			estado: 'abierto',
			creado_por: creadoPor,
			creado_por_id: userData?.user?.id ?? null,
			imagen_url: params.imagenUrl ?? null,
			plataforma: params.plataforma ?? null
		};
		let { data, error } = await client.from(TABLE_NAME).insert(fila).select('*').single();
		// Si la base todavía no tiene la columna `plataforma` (falta la migración ticket_plataforma), se guarda
		// el ticket igual, sin ese dato: reportar nunca debe fallar por esto.
		if (error && /plataforma/i.test(error.message)) {
			delete fila.plataforma;
			({ data, error } = await client.from(TABLE_NAME).insert(fila).select('*').single());
		}
		if (error) return { success: false, message: error.message };
		await registrarEvento(client, (data as Ticket).id_ticket, null, 'abierto', creadoPor);
		return { success: true, message: 'Ticket registrado correctamente', data: data as Ticket };
	} catch (err: any) {
		return { success: false, message: err?.message || String(err) };
	}
}

/** Tickets creados por el usuario actual — para "Mis Tickets". */
export async function getMisTickets(client: SupabaseClient): Promise<Ticket[]> {
	const { data: userData } = await client.auth.getUser();
	if (!userData?.user?.id) return [];
	const { data, error } = await client
		.from(TABLE_NAME)
		.select('*')
		.eq('creado_por_id', userData.user.id)
		.order('created_at', { ascending: false });
	if (error) throw error;
	return (data ?? []) as Ticket[];
}

/** Todos los tickets — para el Panel Developer (developer/admin, gate de UI vía hasPermiso). Filtros
 * opcionales, un solo criterio a la vez, mismo patrón que ListParams en transacciones.service.ts. */
export interface FiltrosTicketDeveloper {
	estado?: EstadoTicket;
	tipo?: TipoTicket;
	prioridad?: PrioridadTicket;
	plataforma?: PlataformaTicket;
}
export async function getTicketsDeveloper(client: SupabaseClient, filtros: FiltrosTicketDeveloper = {}): Promise<Ticket[]> {
	let query = client.from(TABLE_NAME).select('*').order('created_at', { ascending: false });
	if (filtros.estado) query = query.eq('estado', filtros.estado);
	if (filtros.tipo) query = query.eq('tipo', filtros.tipo);
	if (filtros.prioridad) query = query.eq('prioridad', filtros.prioridad);
	if (filtros.plataforma) query = query.eq('plataforma', filtros.plataforma);
	const { data, error } = await query;
	if (error) throw error;
	return (data ?? []) as Ticket[];
}

export async function getTicket(client: SupabaseClient, idTicket: number): Promise<Ticket | null> {
	const { data, error } = await client.from(TABLE_NAME).select('*').eq('id_ticket', idTicket).maybeSingle();
	if (error) throw error;
	return (data as Ticket) ?? null;
}

export async function getComentarios(client: SupabaseClient, idTicket: number): Promise<TicketComentario[]> {
	const { data, error } = await client
		.from(COMENTARIO_TABLE)
		.select('*')
		.eq('id_ticket', idTicket)
		.order('created_at', { ascending: true });
	if (error) throw error;
	return (data ?? []) as TicketComentario[];
}

/** Agrega un comentario al hilo de un ticket ("el foro") — lo puede usar tanto el reportante como
 * developer/admin, sin restricción adicional (la visibilidad del ticket en sí ya la gatea la UI). */
export async function agregarComentario(client: SupabaseClient, idTicket: number, mensaje: string, imagenUrl?: string | null): Promise<ServiceResult<TicketComentario>> {
	if (!mensaje.trim()) return { success: false, message: 'El mensaje no puede estar vacío.' };
	try {
		const { data: userData } = await client.auth.getUser();
		const { data, error } = await client
			.from(COMENTARIO_TABLE)
			.insert({
				id_ticket: idTicket,
				autor: permisosState.userName || null,
				autor_id: userData?.user?.id ?? null,
				mensaje: mensaje.trim(),
				imagen_url: imagenUrl ?? null
			})
			.select('*')
			.single();
		if (error) return { success: false, message: error.message };
		return { success: true, data: data as TicketComentario };
	} catch (err: any) {
		return { success: false, message: err?.message || String(err) };
	}
}

async function cambiarEstado(
	client: SupabaseClient,
	idTicket: number,
	nuevoEstado: EstadoTicket,
	usuario: string | null,
	extra: Record<string, unknown> = {},
	comentarioEvento?: string
): Promise<ServiceResult<Ticket>> {
	const { data: actual, error: fetchError } = await client.from(TABLE_NAME).select('estado').eq('id_ticket', idTicket).single();
	if (fetchError || !actual) return { success: false, message: fetchError?.message || 'Ticket no encontrado.' };

	const { data, error } = await client
		.from(TABLE_NAME)
		.update({ estado: nuevoEstado, ...extra })
		.eq('id_ticket', idTicket)
		.select('*')
		.single();
	if (error) return { success: false, message: error.message };

	await registrarEvento(client, idTicket, actual.estado, nuevoEstado, usuario, comentarioEvento);
	return { success: true, data: data as Ticket };
}

/** Developer marca que ya empezó a trabajar en el ticket. */
export async function marcarEnProgreso(client: SupabaseClient, idTicket: number): Promise<ServiceResult<Ticket>> {
	return cambiarEstado(client, idTicket, 'en_progreso', permisosState.userName || null);
}

/** Developer marca que ya arregló el código — el Admin todavía tiene que Aprobar antes de que cuente
 * para el próximo release (ver crearRelease en releases.service.ts). */
export async function marcarResuelto(client: SupabaseClient, idTicket: number): Promise<ServiceResult<Ticket>> {
	const usuario = permisosState.userName || null;
	// motivo_rechazo se limpia acá (a pedido explícito del usuario) — reenviar un ticket antes
	// 'rechazado' para una nueva revisión no debe seguir mostrando el motivo del rechazo VIEJO, que
	// ya no aplica al fix actual; si el admin lo vuelve a rechazar, ahí se guarda un motivo nuevo.
	return cambiarEstado(client, idTicket, 'resuelto', usuario, { resuelto_por: usuario, resuelto_en: new Date().toISOString(), motivo_rechazo: null });
}

/** Admin-only (gate de UI, ver isAdmin() en TransaccionModal.svelte para el mismo criterio ya usado
 * en el resto del ERP) — aprueba un ticket resuelto. Queda esperando a que el script de deploy lo
 * agrupe en el próximo release. */
export async function aprobarTicket(client: SupabaseClient, idTicket: number, aprobadoPor: string | null): Promise<ServiceResult<Ticket>> {
	return cambiarEstado(client, idTicket, 'aprobado', aprobadoPor, { aprobado_por: aprobadoPor, aprobado_en: new Date().toISOString() });
}

/** Admin-only — rechaza un ticket resuelto, vuelve al developer con el motivo. */
export async function rechazarTicket(client: SupabaseClient, idTicket: number, motivo: string, rechazadoPor: string | null): Promise<ServiceResult<Ticket>> {
	return cambiarEstado(
		client,
		idTicket,
		'rechazado',
		rechazadoPor,
		{ aprobado_por: rechazadoPor, aprobado_en: new Date().toISOString(), motivo_rechazo: motivo },
		motivo
	);
}
