#!/usr/bin/env node
/**
 * Servidor MCP mínimo para ConstruniERP — expone la capa de herramientas de
 * src/lib/server/agent-tools/ vía stdio (local, nada expuesto a internet). Ver Documentacion/AgentTools.md
 * para la arquitectura completa y las reglas de seguridad.
 *
 * Correr SIEMPRE con `npm run mcp` (carga app/.env vía --env-file, mismo patrón que los scripts
 * "tauri"/"release" de package.json) — correr `node mcp-server/index.ts` directo no carga ese .env y
 * el servidor va a fallar creyendo que faltan credenciales que en realidad ya están configuradas.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createClient } from '@supabase/supabase-js';
import { crearRegistro, type AgentContext } from '../src/lib/server/agent-tools/registry.ts';
import { ticketsTools, type ImagenAdjunta } from '../src/lib/server/agent-tools/tools/tickets.ts';

// Sumar un dominio nuevo (Transacciones, Cuentas Bancarias, Releases, etc.) es agregar su propio
// archivo en agent-tools/tools/ y pasarlo acá — no hace falta tocar nada más de este archivo.
const AGENT_TOOLS = crearRegistro(ticketsTools);

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
	console.error(
		'[mcp-server] Faltan PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY en el entorno — correlo con `npm run mcp` (no `node mcp-server/index.ts` directo), ver app/package.json.'
	);
	process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const ctx: AgentContext = { client: supabase, rol: 'operador' };

function esImagenAdjunta(valor: unknown): valor is ImagenAdjunta {
	return !!valor && typeof valor === 'object' && 'mimeType' in valor && 'base64' in valor;
}

const server = new Server({ name: 'construnierp', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: AGENT_TOOLS.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }))
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const tool = AGENT_TOOLS.find((t) => t.name === request.params.name);
	if (!tool) {
		return { content: [{ type: 'text', text: `Herramienta desconocida: ${request.params.name}` }], isError: true };
	}
	try {
		const resultado = await tool.handler((request.params.arguments ?? {}) as Record<string, unknown>, ctx);
		if (esImagenAdjunta(resultado)) {
			return { content: [{ type: 'image', data: resultado.base64, mimeType: resultado.mimeType }] };
		}
		return { content: [{ type: 'text', text: JSON.stringify(resultado, null, 2) }] };
	} catch (err) {
		return { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true };
	}
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[mcp-server] ConstruniERP MCP listo — herramientas:', AGENT_TOOLS.map((t) => t.name).join(', '));
