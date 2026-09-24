// Uso: node --import ./scripts/register-lib-resolver.mjs --experimental-strip-types <archivo.ts>
// Registra lib-resolver.mjs antes de que cargue el entry point (ver el comentario de seed-dev.mjs sobre
// por qué no alcanza con llamar register() dentro del propio entry point).
import { register } from 'node:module';

register('./lib-resolver.mjs', import.meta.url);
