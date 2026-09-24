#!/usr/bin/env node
// Bootstrap: registra el resolver de `$lib/...` ANTES de cargar el script real — un `import` estático
// puesto directo acá se resolvería antes de que el hook quede activo (orden de linking de ESM), por eso
// la lógica real vive en seed-dev-main.mjs y se carga con un `import()` dinámico, después de registrar.
//
// Uso: npm run seed:dev  (carga app/.env.dev — ver el script "seed:dev" en package.json)
import { register } from 'node:module';

register('./lib-resolver.mjs', import.meta.url);
await import('./seed-dev-main.mjs');
