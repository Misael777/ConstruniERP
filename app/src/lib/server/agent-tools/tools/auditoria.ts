/**
 * Herramientas de agente (solo lectura) para Control de Accesos → Auditoría — sirven para diagnosticar
 * tickets de "se me cerró la sesión / se cerró la app" (ej. #33/#35/#36) con datos reales: cuándo empezó y
 * terminó cada sesión, por qué terminó, qué hizo el usuario y qué errores hubo.
 * Ver supabase/migrations/20261002120000_auditoria.sql.
 */
import type { AgentTool } from '../registry.ts';
import { limiteDe } from './_util.ts';

const listarAuditoriaSesiones: AgentTool = {
	name: 'listar_auditoria_sesiones',
	description:
		'Sesiones de la app (últimos 14 días): usuario, plataforma, versión, inicio, último latido, fin y motivo_fin (logout_manual | sesion_expirada | app_cerrada | cierre_inesperado; null = sin terminar). Filtros opcionales: usuario (nombre exacto del empleado), solo_abiertas (true = sin fin). limit default 50, máx 200.',
	inputSchema: {
		type: 'object',
		properties: {
			usuario: { type: 'string' },
			solo_abiertas: { type: 'boolean' },
			limit: { type: 'number' }
		},
		additionalProperties: false
	},
	permiso: 'ver_iam_auditoria',
	async handler(input, ctx) {
		const i = (input ?? {}) as { usuario?: string; solo_abiertas?: boolean; limit?: number };
		let q = ctx.client
			.from('auditoria_sesion')
			.select('id, usuario, plataforma, version_app, inicio, ultimo_latido, fin, motivo_fin, detalle')
			.order('inicio', { ascending: false })
			.limit(limiteDe(i.limit));
		if (i.usuario) q = q.eq('usuario', i.usuario);
		if (i.solo_abiertas) q = q.is('fin', null);
		const { data, error } = await q;
		if (error) throw new Error(error.message);
		return data ?? [];
	}
};

const listarAuditoriaAcciones: AgentTool = {
	name: 'listar_auditoria_acciones',
	description:
		'Acciones registradas (últimos 14 días): cambios de datos por trigger (insert/update/delete con tabla, id_registro y cambios) y descargas/PDFs/subidas (con modulo y resumen). Filtros opcionales: usuario, sesion_id, tabla, tipo. limit default 50, máx 200.',
	inputSchema: {
		type: 'object',
		properties: {
			usuario: { type: 'string' },
			sesion_id: { type: 'string' },
			tabla: { type: 'string' },
			tipo: { type: 'string', enum: ['insert', 'update', 'delete', 'descarga', 'pdf', 'subida'] },
			limit: { type: 'number' }
		},
		additionalProperties: false
	},
	permiso: 'ver_iam_auditoria',
	async handler(input, ctx) {
		const i = (input ?? {}) as { usuario?: string; sesion_id?: string; tabla?: string; tipo?: string; limit?: number };
		let q = ctx.client.from('auditoria_accion').select('*').order('creado_en', { ascending: false }).limit(limiteDe(i.limit));
		if (i.usuario) q = q.eq('usuario', i.usuario);
		if (i.sesion_id) q = q.eq('sesion_id', i.sesion_id);
		if (i.tabla) q = q.eq('tabla', i.tabla);
		if (i.tipo) q = q.eq('tipo', i.tipo);
		const { data, error } = await q;
		if (error) throw new Error(error.message);
		return data ?? [];
	}
};

const listarAuditoriaErrores: AgentTool = {
	name: 'listar_auditoria_errores',
	description:
		'Errores de la app (últimos 7 días): origen (js | rust_panic | cierre), mensaje, stack, plataforma, usuario y sesión. Filtro opcional: usuario. limit default 50, máx 200.',
	inputSchema: {
		type: 'object',
		properties: { usuario: { type: 'string' }, limit: { type: 'number' } },
		additionalProperties: false
	},
	permiso: 'ver_iam_auditoria',
	async handler(input, ctx) {
		const i = (input ?? {}) as { usuario?: string; limit?: number };
		let q = ctx.client.from('auditoria_error').select('*').order('creado_en', { ascending: false }).limit(limiteDe(i.limit));
		if (i.usuario) q = q.eq('usuario', i.usuario);
		const { data, error } = await q;
		if (error) throw new Error(error.message);
		return data ?? [];
	}
};

export const auditoriaTools: AgentTool[] = [listarAuditoriaSesiones, listarAuditoriaAcciones, listarAuditoriaErrores];
