/**
 * Registro genérico de herramientas para agentes de IA sobre ConstruniERP — a pedido explícito del
 * usuario, la base reutilizable para DOS transportes (ver Documentacion/AgentTools.md):
 *   1. El servidor MCP de hoy (app/mcp-server/index.ts) — para que Claude Code use estas herramientas
 *      directo en sesiones de trabajo.
 *   2. A futuro (NO construido todavía), un endpoint de chat embebido en la propia plataforma — la
 *      MISMA capa de herramientas, llamada directo desde SvelteKit con la API de Claude, sin MCP de
 *      por medio.
 *
 * IMPORTANTE — nunca se importa desde código que corra en el navegador: los handlers usan
 * SUPABASE_SERVICE_ROLE_KEY (acceso total, sin RLS), que solo debe vivir en procesos de servidor/Node
 * puro (el servidor MCP hoy; un +server.ts de SvelteKit mañana).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** JSON Schema mínimo — mismo formato que espera el protocolo MCP para describir los parámetros de
 * una herramienta (ver CallToolRequestSchema/ListToolsRequestSchema en @modelcontextprotocol/sdk). */
export interface JsonSchema {
	type: 'object';
	properties?: Record<string, unknown>;
	required?: string[];
	additionalProperties?: boolean;
}

/** Quién está llamando — en esta fase siempre "operador" (acceso total, como administrador). El campo
 * existe desde ahora para que, cuando exista el chat embebido (Fase 3, no construida todavía), pueda
 * llevar el permiso REAL de un empleado/cliente logueado (re-derivado del lado del servidor, mismo
 * criterio que loadPermisos en permisos.svelte.ts) sin tener que rediseñar esta interfaz. */
export interface AgentContext {
	client: SupabaseClient;
	rol: 'operador';
}

export interface AgentTool {
	name: string;
	description: string;
	inputSchema: JsonSchema;
	/** Permiso requerido — mismo string que ya usa hasPermiso() en permisos.svelte.ts (ej.
	 * 'ver_soporte_developer'). null = sin restricción particular. En esta fase (contexto fijo
	 * "operador") no se aplica ningún chequeo todavía — el campo solo documenta qué permiso hace
	 * falta, para cuando la Fase 3 sí tenga que filtrar herramientas por usuario real. */
	permiso: string | null;
	handler: (input: Record<string, unknown>, ctx: AgentContext) => Promise<unknown>;
}

/** Junta varios grupos de herramientas (uno por dominio, ver tools/tickets.ts) en un solo array plano
 * — sumar un dominio nuevo (Transacciones, Cuentas Bancarias, Releases, etc.) es agregar su propio
 * archivo en tools/ y pasarlo acá, sin tocar esta función ni el servidor MCP. */
export function crearRegistro(...grupos: AgentTool[][]): AgentTool[] {
	return grupos.flat();
}
