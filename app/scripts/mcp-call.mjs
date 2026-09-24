// Cliente MCP mínimo por línea de comandos (JSON-RPC sobre stdio) — para llamar a las herramientas del
// servidor MCP de ConstruniERP SIN depender de que Claude Code las exponga como herramientas nativas (hoy
// "Connected" en `claude mcp list` no garantiza que aparezcan). Ver Documentacion/GuiaAgente.md.
//
// Uso (desde app/):
//   node scripts/mcp-call.mjs dev list
//   node scripts/mcp-call.mjs prod list
//   node scripts/mcp-call.mjs dev '[{"name":"listar_cuentas_pagar","arguments":{"limit":5}}]'
//   node scripts/mcp-call.mjs prod '[{"name":"ver_ticket","arguments":{"id_ticket":30}}]'
//
// El primer argumento elige el archivo de entorno (dev -> .env.dev, prod -> .env). El servidor decide por sí
// mismo qué herramientas registrar según la URL de Supabase (en prod no existen las de escritura, salvo Tickets).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const [entorno, spec] = process.argv.slice(2);
if (!['dev', 'prod'].includes(entorno) || !spec) {
	console.error("Uso: node scripts/mcp-call.mjs <dev|prod> <list | '[{\"name\":\"...\",\"arguments\":{}}]'>");
	process.exit(1);
}
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(
	process.execPath,
	[`--env-file=${entorno === 'dev' ? '.env.dev' : '.env'}`, '--import', './scripts/register-lib-resolver.mjs', '--experimental-strip-types', 'mcp-server/index.ts'],
	{ cwd: APP, stdio: ['pipe', 'pipe', 'pipe'] }
);
let buf = '';
const waiters = new Map();
child.stdout.on('data', (d) => {
	buf += d;
	let i;
	while ((i = buf.indexOf('\n')) >= 0) {
		const line = buf.slice(0, i);
		buf = buf.slice(i + 1);
		if (!line.trim()) continue;
		const m = JSON.parse(line);
		if (m.id && waiters.has(m.id)) waiters.get(m.id)(m);
	}
});
child.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));
let n = 0;
const rpc = (method, params) =>
	new Promise((res) => {
		const id = ++n;
		waiters.set(id, res);
		child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
	});

await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mcp-call', version: '1' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

if (spec === 'list') {
	const r = await rpc('tools/list', {});
	for (const t of r.result.tools) console.log(`${t.name}\n    ${t.description.slice(0, 160)}`);
} else {
	for (const call of JSON.parse(spec)) {
		const r = await rpc('tools/call', { name: call.name, arguments: call.arguments ?? {} });
		const bloque = r.result?.content?.[0];
		const txt = bloque?.type === 'image' ? `[imagen ${bloque.mimeType}, ${bloque.data.length} bytes base64]` : bloque?.text ?? JSON.stringify(r);
		console.log(`\n### ${call.name}${r.result?.isError ? ' (ERROR)' : ''}\n${txt}`);
	}
}
child.kill();
