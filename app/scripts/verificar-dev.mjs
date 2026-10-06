// Verifica que app/.env.dev apunte a la base de DESARROLLO y que las credenciales funcionen (solo lectura).
// Uso (desde app/): node --env-file=.env.dev scripts/verificar-dev.mjs   — lo llama setup-dev.bat.
// Ver Documentacion/GuiaDevYTests.md.
import { createClient } from '@supabase/supabase-js';

const DEV_REF = 'hlfaxszecrxgkbjafepv';
const url = process.env.PUBLIC_SUPABASE_URL ?? '';
const faltan = ['PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL'].filter((v) => !process.env[v]);
if (faltan.length) {
	console.error(`[verificar-dev] Faltan variables en .env.dev: ${faltan.join(', ')}`);
	process.exit(1);
}
if (!url.includes(DEV_REF)) {
	console.error(`[verificar-dev] SEGURIDAD: .env.dev no apunta a Dev (${DEV_REF}). Revisa el archivo.`);
	process.exit(1);
}
if (!(process.env.SUPABASE_DB_URL ?? '').includes(DEV_REF)) {
	console.error(`[verificar-dev] SEGURIDAD: SUPABASE_DB_URL de .env.dev no es la de Dev (${DEV_REF}).`);
	process.exit(1);
}

const c = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { count, error } = await c.from('centro_costo').select('id_centro_costo', { count: 'exact', head: true });
if (error) {
	console.error(`[verificar-dev] No se pudo consultar Dev: ${error.message}`);
	console.error('[verificar-dev] Si el proyecto Dev esta pausado, hay que reactivarlo desde el dashboard de Supabase.');
	process.exit(1);
}
console.log(`[verificar-dev] OK: conectado a Dev (${DEV_REF}); centro_costo tiene ${count} filas.`);
