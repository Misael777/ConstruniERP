// Node module customization hook: resuelve el alias `$lib/...` (SvelteKit) a `app/src/lib/...` para
// que scripts de Node puro (fuera de Vite/SvelteKit) puedan importar directamente los `*.service.ts`
// reales del ERP, en vez de reimplementar su lógica a mano.
//
// Usado por seed-dev.mjs (ver Documentacion/... plan de Desarrollo/Testing) y pensado para reusarse
// en la Fase C (agent-tools completo) el día que agent-tools también necesite importar estos service.ts.
//
// Solo sirve para archivos SIN acoplamiento a Svelte/SvelteKit real (nada de `$env/dynamic/*`, nada de
// `*.svelte.ts` con runes, nada de componentes `.svelte`) — esos siguen sin poder importarse acá, es una
// limitación del propio código, no de este resolver.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const LIB_ROOT = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/lib') + '/');

export async function resolve(specifier, context, nextResolve) {
	if (specifier.startsWith('$lib/')) {
		const rest = specifier.slice('$lib/'.length);
		const resolved = await resolveConExtension(rest);
		return nextResolve(resolved, context);
	}

	// El resto del repo escribe imports relativos SIN extensión ('../config/centroCostos.config'), estilo
	// bundler — la resolución nativa de Node exige extensión explícita. Ojo: NO alcanza con mirar si el
	// specifier "parece" tener extensión (`path.extname`) — nombres como "centroCostos.config" tienen un
	// punto que path.extname confunde con una extensión real (".config"), así que directamente se
	// intenta primero y se reintenta agregando '.ts' recién si la resolución nativa falla.
	if (specifier.startsWith('./') || specifier.startsWith('../')) {
		try {
			return await nextResolve(specifier, context);
		} catch (err) {
			if (err?.code === 'ERR_MODULE_NOT_FOUND') {
				return nextResolve(`${specifier}.ts`, context);
			}
			throw err;
		}
	}

	return nextResolve(specifier, context);
}

async function resolveConExtension(rest) {
	const candidatos = [rest, `${rest}.ts`, `${rest}/index.ts`];
	for (const candidato of candidatos) {
		const url = new URL(candidato, LIB_ROOT);
		if (existsSync(fileURLToPath(url))) return url.href;
	}
	// Ninguno existe — dejamos que falle con el error nativo de Node (mensaje más claro que inventar uno acá).
	return new URL(`${rest}.ts`, LIB_ROOT).href;
}
