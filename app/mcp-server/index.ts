#!/usr/bin/env node
/**
 * Servidor MCP mínimo para ConstruniERP — expone la capa de herramientas de
 * src/lib/server/agent-tools/ vía stdio (local, nada expuesto a internet). Ver Documentacion/AgentTools.md
 * para la arquitectura completa y las reglas de seguridad.
 *
 * Correr SIEMPRE con `npm run mcp` (Producción, lecturas + Tickets) o `npm run mcp:dev` (Dev, todo) — carga app/.env vía --env-file, mismo patrón que los scripts
 * "tauri"/"release" de package.json) — correr `node mcp-server/index.ts` directo no carga ese .env y
 * el servidor va a fallar creyendo que faltan credenciales que en realidad ya están configuradas.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createClient } from '@supabase/supabase-js';
import { crearRegistro, filtrarPorEntorno, type AgentContext, type EntornoAgente } from '../src/lib/server/agent-tools/registry.ts';
import { ticketsTools, type ImagenAdjunta } from '../src/lib/server/agent-tools/tools/tickets.ts';
import { cuentasPagarTools } from '../src/lib/server/agent-tools/tools/cuentas-pagar.ts';
import { cuentasCobrarTools } from '../src/lib/server/agent-tools/tools/cuentas-cobrar.ts';
import { catalogosTools } from '../src/lib/server/agent-tools/tools/catalogos.ts';
import { auditoriaTools } from '../src/lib/server/agent-tools/tools/auditoria.ts';
import { controlFinancieroTools } from '../src/lib/server/agent-tools/tools/control-financiero.ts';

// Sumar un dominio nuevo es agregar su propio archivo en agent-tools/tools/ y pasarlo acá. Las
// herramientas con `escritura: true` solo se registran cuando el servidor apunta a Dev (ver
// filtrarPorEntorno) — Tickets es la excepción explícita (escrituraEnProd).
const TODAS_LAS_TOOLS = crearRegistro(ticketsTools, cuentasPagarTools, cuentasCobrarTools, catalogosTools, auditoriaTools, controlFinancieroTools);

// El entorno se deduce de la URL del proyecto Supabase cargada, no de una variable "modo" que se pueda
// leer mal — mismo criterio que scripts/seed-dev-main.mjs.
const REF_DEV = 'hlfaxszecrxgkbjafepv';
const REF_PROD = 'nqffgnbcwsixlaodhaku';

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
	console.error(
		'[mcp-server] Faltan PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY en el entorno — correlo con `npm run mcp` (no `node mcp-server/index.ts` directo), ver app/package.json.'
	);
	process.exit(1);
}

const entorno: EntornoAgente | null = supabaseUrl.includes(REF_DEV) ? 'dev' : supabaseUrl.includes(REF_PROD) ? 'prod' : null;
if (!entorno) {
	console.error(`[mcp-server] PUBLIC_SUPABASE_URL (${supabaseUrl}) no es ni el proyecto Dev ni el de Producción conocidos — abortando por seguridad.`);
	process.exit(1);
}
const AGENT_TOOLS = filtrarPorEntorno(TODAS_LAS_TOOLS, entorno);

const supabase = createClient(supabaseUrl, serviceRoleKey);
const ctx: AgentContext = { client: supabase, rol: 'operador' };

function esImagenAdjunta(valor: unknown): valor is ImagenAdjunta {
	return !!valor && typeof valor === 'object' && 'mimeType' in valor && 'base64' in valor;
}

const server = new Server({ name: entorno === 'dev' ? 'construnierp-dev' : 'construnierp', version: '0.2.0' }, { capabilities: { tools: {} } });

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
console.error(`[mcp-server] ConstruniERP MCP (${entorno}) listo — herramientas:`, AGENT_TOOLS.map((t) => t.name).join(', '));
