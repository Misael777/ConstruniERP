#!/usr/bin/env node
/**
 * Script de deploy — ver Documentacion/MecanismoCICD.md para el mecanismo completo y
 * Documentacion/PlanModuloTicketsYReleases.md para el diseño del módulo de Tickets.
 *
 * Uso (SIEMPRE vía npm run, no `node scripts/release.mjs` directo — ver por qué en la nota de abajo):
 *   npm run release -- --patch [--apk "C:\ruta\al\app-debug.apk"]
 *   npm run release -- --minor
 *   npm run release -- --major
 *
 * Qué hace, en orden (aborta si cualquier paso falla — nunca deja el sistema a medio publicar):
 *   1. Gate de calidad: npm run check + npx vitest run.
 *   2. Sube la versión en package.json y src-tauri/tauri.conf.json.
 *   3. npm run tauri build (Windows) — con TAURI_SIGNING_PRIVATE_KEY/_PASSWORD en el entorno, Tauri
 *      firma el artefacto de update automáticamente (createUpdaterArtifacts:true en tauri.conf.json).
 *   4. Arma latest.json a partir del .sig generado.
 *   5. gh release create — sube el instalador + latest.json a GitHub Releases.
 *   6. Si se pasó --apk, sube ese archivo a la carpeta de Drive de releases (mismo flujo OAuth2 que
 *      ya usa el resto del ERP para documentos, ver src/lib/server/config.ts).
 *   7. Se conecta a Supabase (service role key) y agrupa TODOS los tickets 'aprobado' sin release
 *      asignado en la fila `app_release` nueva — los deja 'cerrado' directo (ver nota de terminología
 *      en el plan: Cliente=Admin, ya dio su visto bueno al aprobar).
 *
 * Variables de entorno requeridas — el `package.json` ya invoca este script con
 * `node --env-file=.env` (Node 20.6+), así que TODO lo que ya está en tu `app/.env` de siempre
 * (el mismo que usa la app para Supabase/Drive) se carga solo — correr `node scripts/release.mjs`
 * directo, sin pasar por `npm run release`, NO lee ese .env y el script va a fallar creyendo que
 * faltan variables que en realidad ya tenés configuradas.
 *
 * Ya deberías tenerlas (reusadas de `app/.env`, nada nuevo que crear):
 *   PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN
 *
 * Genuinamente NUEVAS, todavía no existen, agregalas a `app/.env`:
 *   TAURI_SIGNING_PRIVATE_KEY, TAURI_SIGNING_PRIVATE_KEY_PASSWORD  (generadas UNA VEZ con
 *     `npx tauri signer generate` — la clave PÚBLICA que imprime va en tauri.conf.json, el
 *     placeholder ya está ahí; la PRIVADA es la que va acá en .env, nunca se commitea)
 *   GOOGLE_DRIVE_FOLDER_ID_RELEASES  (carpeta nueva de Drive, dedicada a los APK de release — no
 *     reusar las de contratos/proformas, mismo mecanismo OAuth2 que src/lib/server/config.ts)
 *
 * Opcional:
 *   GITHUB_REPO  (por defecto 'Misael777/ConstruniERP-releases', ver tauri.conf.json)
 *
 * También necesitás el GitHub CLI (`gh`) instalado y logueado (`gh auth login`) en tu máquina —
 * eso no es una variable de entorno, es una herramienta que se instala una sola vez.
 *
 * ⚠️ IMPORTANTE: las Releases se publican en un repo PÚBLICO dedicado
 * (Misael777/ConstruniERP-releases), NO en el repo privado del código fuente — GitHub Releases
 * requiere autenticación para descargar assets de un repo privado, y el updater de Tauri corriendo
 * en la máquina del cliente no tiene ningún token para eso (fetch anónimo → 404 siempre). El repo de
 * releases solo recibe instaladores/latest.json, nunca código — ver su propio README.
 */
import { execSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, createReadStream, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import { createClient } from '@supabase/supabase-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GITHUB_REPO = process.env.GITHUB_REPO || 'Misael777/ConstruniERP-releases';

function log(msg) {
	console.log(`[release] ${msg}`);
}
function fail(msg) {
	console.error(`[release] ERROR: ${msg}`);
	process.exit(1);
}
function run(cmd, opts = {}) {
	log(`> ${cmd}`);
	execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

// ── 0. Args ──────────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const bumpTipo = args.includes('--major') ? 'major' : args.includes('--minor') ? 'minor' : 'patch';
const apkIdx = args.indexOf('--apk');
const apkPath = apkIdx !== -1 ? args[apkIdx + 1] : null;

// ── 1. Gate de calidad ───────────────────────────────────────────────────────────────────────
log('Paso 1/7 — Gate de calidad (npm run check + vitest)...');
run('npm run check');
run('npx vitest run');

// ── 2. Bump de versión ───────────────────────────────────────────────────────────────────────
log(`Paso 2/7 — Subiendo versión (${bumpTipo})...`);
function bumpVersion(actual, tipo) {
	const [maj, min, pat] = actual.split('.').map(Number);
	if (tipo === 'major') return `${maj + 1}.0.0`;
	if (tipo === 'minor') return `${maj}.${min + 1}.0`;
	return `${maj}.${min}.${pat + 1}`;
}

const pkgPath = join(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const nuevaVersion = bumpVersion(pkg.version, bumpTipo);
pkg.version = nuevaVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, '\t') + '\n');

const tauriConfPath = join(ROOT, 'src-tauri', 'tauri.conf.json');
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf-8'));
tauriConf.version = nuevaVersion;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');

log(`Versión nueva: ${nuevaVersion}`);

if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
	fail(
		'Falta TAURI_SIGNING_PRIVATE_KEY en el entorno — generá el par de claves con `npx tauri signer generate`, ' +
			'poné la CLAVE PÚBLICA en src-tauri/tauri.conf.json (plugins.updater.pubkey) y la PRIVADA acá como ' +
			'variable de entorno (nunca en el repo). Ver Documentacion/MecanismoCICD.md, sección Secretos.'
	);
}

// ── 3. Build de Windows (firma el artefacto de update automáticamente) ──────────────────────
log('Paso 3/7 — Compilando Windows (npm run tauri build)...');
run('npm run tauri build');

// ── 4. Arma latest.json a partir del .sig generado ──────────────────────────────────────────
log('Paso 4/7 — Armando latest.json...');
// ⚠️ Ruta/nombre EXACTO del bundle todavía no verificado contra un build real — Tauri v2 genera el
// instalador NSIS + su .sig bajo src-tauri/target/release/bundle/nsis/. Si tu build usa otro target
// (msi, etc.) ajustá BUNDLE_DIR.
const BUNDLE_DIR = join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
if (!existsSync(BUNDLE_DIR)) {
	fail(`No se encontró el directorio de bundle esperado: ${BUNDLE_DIR}. Revisá dónde quedó el instalador de esta build.`);
}
// Filtra por la versión que ACABAMOS de escribir en tauri.conf.json (nuevaVersion), no solo por la
// extensión — reintentos anteriores (builds fallidos en un paso posterior, ej. gh/Drive) dejan
// instaladores viejos en esta misma carpeta (Tauri no la limpia entre builds) y un simple
// `.find(f => f.endsWith('-setup.exe'))` puede agarrar CUALQUIERA de ellos, no el que se acaba de
// compilar — bug real visto en un deploy: el tag v0.0.5 en GitHub terminó con el instalador de un
// intento v0.0.2 viejo adjunto. Los `_` alrededor evitan que "0.0.2" matchee como substring de "0.0.20".
const archivos = readdirSync(BUNDLE_DIR);
const instaladorNombre = archivos.find((f) => f.endsWith('-setup.exe') && f.includes(`_${nuevaVersion}_`));
const sigNombre = instaladorNombre ? `${instaladorNombre}.sig` : undefined;
if (!instaladorNombre || !sigNombre || !existsSync(join(BUNDLE_DIR, sigNombre))) {
	fail(`No se encontró el instalador (.exe) o la firma (.sig) de la versión ${nuevaVersion} en ${BUNDLE_DIR}. Archivos vistos: ${archivos.join(', ')}`);
}
const rutaInstalador = join(BUNDLE_DIR, instaladorNombre);
const firma = readFileSync(join(BUNDLE_DIR, sigNombre), 'utf-8').trim();

// GitHub reemplaza cada ESPACIO del nombre de archivo por un PUNTO al subir un asset de Release (ej.
// "Construni ERP_0.2.4_x64-setup.exe" queda publicado como "Construni.ERP_0.2.4_x64-setup.exe") — bug
// real visto en un deploy: latest.json apuntaba al nombre CON espacios, que nunca existió en GitHub,
// así que el updater de Tauri siempre recibía 404 al intentar descargar. `instaladorNombre` (con
// espacios) se sigue usando para el archivo LOCAL y para pasárselo a `gh release create` (ese sí
// entiende el nombre real en disco) — pero cualquier URL pública debe usar el nombre YA transformado.
const nombreAssetPublicado = instaladorNombre.replace(/ /g, '.');

const latestJson = {
	version: nuevaVersion,
	notes: `Versión ${nuevaVersion}`,
	pub_date: new Date().toISOString(),
	platforms: {
		'windows-x86_64': {
			signature: firma,
			url: `https://github.com/${GITHUB_REPO}/releases/download/v${nuevaVersion}/${nombreAssetPublicado}`
		}
	}
};
const rutaLatestJson = join(BUNDLE_DIR, 'latest.json');
writeFileSync(rutaLatestJson, JSON.stringify(latestJson, null, 2));

// ── 5. Publica en GitHub Releases ────────────────────────────────────────────────────────────
log('Paso 5/7 — Publicando en GitHub Releases...');
try {
	execFileSync('gh', ['--version'], { stdio: 'ignore' });
} catch {
	fail('No se encontró el GitHub CLI (`gh`) en el PATH — instalalo desde https://cli.github.com/ y corré `gh auth login` una vez.');
}
run(
	`gh release create v${nuevaVersion} "${rutaInstalador}" "${rutaLatestJson}" --repo ${GITHUB_REPO} --title "v${nuevaVersion}" --notes "Ver detalle de tickets incluidos en el módulo de Soporte del ERP."`
);
const urlManifestWin = `https://github.com/${GITHUB_REPO}/releases/latest/download/latest.json`;
const urlInstaladorWin = `https://github.com/${GITHUB_REPO}/releases/download/v${nuevaVersion}/${nombreAssetPublicado}`;

// ── 6. Sube el APK a Drive (si se pasó --apk) ───────────────────────────────────────────────
let urlApkDrive = null;
if (apkPath) {
	log('Paso 6/7 — Subiendo APK a Drive...');
	try {
		urlApkDrive = await subirApkADrive(apkPath, nuevaVersion);
	} catch (err) {
		fail(`No se pudo subir el APK a Drive: ${err?.message || err}`);
	}
} else {
	log('Paso 6/7 — Sin --apk, se omite la subida a Drive (release solo para Windows).');
}

async function obtenerAccessTokenDrive() {
	const { GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN } = process.env;
	if (!GOOGLE_DRIVE_CLIENT_ID || !GOOGLE_DRIVE_CLIENT_SECRET || !GOOGLE_DRIVE_REFRESH_TOKEN) {
		fail('Faltan GOOGLE_DRIVE_CLIENT_ID/GOOGLE_DRIVE_CLIENT_SECRET/GOOGLE_DRIVE_REFRESH_TOKEN en el entorno.');
	}
	const res = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: GOOGLE_DRIVE_CLIENT_ID,
			client_secret: GOOGLE_DRIVE_CLIENT_SECRET,
			refresh_token: GOOGLE_DRIVE_REFRESH_TOKEN,
			grant_type: 'refresh_token'
		})
	});
	const data = await res.json();
	if (!res.ok) fail(`No se pudo obtener el access token de Drive: ${JSON.stringify(data)}`);
	return data.access_token;
}

/** Sube el APK a Drive vía el módulo `https` nativo de Node, NO fetch/undici — probado dos veces en un
 * deploy real: tanto un Buffer armado a mano como un FormData/Blob nativo disparan `ENOBUFS` en Windows
 * al mandar un archivo de decenas de MB como body de fetch (bug conocido de undici con bodies grandes
 * en el socket de Windows, sin relación con CÓMO se arma el body — pasa igual con ambos). El módulo
 * `https` clásico transmite el archivo por streaming real vía `.pipe()`, que respeta el backpressure del
 * socket (Node lleva años usando este mecanismo sin este problema), en vez de que undici intente
 * escribirlo de un tirón. El resto de subidas del ERP (comprobantes, documentos, tickets — ver
 * src/lib/server/config.ts) se quedan con fetch: son archivos chicos, nunca dispararon este bug. */
function subirApkADrive(ruta, version) {
	return new Promise(async (resolve, reject) => {
		try {
			const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID_RELEASES;
			if (!folderId) fail('Falta GOOGLE_DRIVE_FOLDER_ID_RELEASES en el entorno — creá una carpeta de Drive dedicada a los APK de release.');
			const accessToken = await obtenerAccessTokenDrive();
			const nombreArchivo = `construni-erp-v${version}.apk`;

			const metadata = { name: nombreArchivo, parents: [folderId] };
			const boundary = `release-boundary-${Date.now()}`;
			const preambulo =
				`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
				`--${boundary}\r\nContent-Type: application/vnd.android.package-archive\r\n\r\n`;
			const cierre = `\r\n--${boundary}--`;
			const largoTotal = Buffer.byteLength(preambulo) + statSync(ruta).size + Buffer.byteLength(cierre);

			const req = https.request(
				'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true',
				{
					method: 'POST',
					headers: {
						Authorization: `Bearer ${accessToken}`,
						'Content-Type': `multipart/related; boundary=${boundary}`,
						'Content-Length': largoTotal
					}
				},
				(res) => {
					let cuerpo = '';
					res.on('data', (chunk) => (cuerpo += chunk));
					res.on('end', () => {
						let data;
						try {
							data = JSON.parse(cuerpo);
						} catch (err) {
							reject(new Error(`Respuesta de Drive no es JSON válido: ${cuerpo}`));
							return;
						}
						if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
							reject(new Error(`No se pudo subir el APK a Drive (HTTP ${res.statusCode}): ${JSON.stringify(data)}`));
							return;
						}
						resolve(data.id);
					});
				}
			);
			req.on('error', reject);
			req.write(preambulo);
			const lector = createReadStream(ruta);
			lector.on('error', reject);
			lector.on('end', () => req.end(cierre));
			lector.pipe(req, { end: false });
		} catch (err) {
			reject(err);
		}
	}).then(async (fileId) => {
		const accessToken = await obtenerAccessTokenDrive();
		// Público de solo lectura vía link — mismo criterio que uploadToDrive en src/lib/server/config.ts,
		// para que downloadFromDriveClient (BotonActualizar.svelte) pueda leerlo. Body chico, fetch normal
		// acá no tiene el problema de arriba.
		await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ role: 'reader', type: 'anyone' })
		});
		log(`APK subido a Drive con fileId=${fileId}`);
		return fileId;
	});
}

// ── 7. Agrupa tickets aprobados en el release nuevo ─────────────────────────────────────────
log('Paso 7/7 — Agrupando tickets aprobados en Supabase...');
const { PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
	fail('Faltan PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY en el entorno — el release en GitHub/Drive ya se publicó, pero el ticket no va a quedar vinculado. Configurá las variables y corré de nuevo (el script es re-ejecutable: gh/Drive fallarán por versión duplicada, pero podés correr solo este paso a mano si hace falta).');
}
const supabase = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const { data: ticketsAprobados, error: errorTickets } = await supabase
	.from('ticket')
	.select('id_ticket, titulo')
	.eq('estado', 'aprobado')
	.is('id_release', null);
if (errorTickets) fail(`No se pudo consultar tickets aprobados: ${errorTickets.message}`);

const changelog =
	(ticketsAprobados ?? []).length > 0
		? (ticketsAprobados ?? []).map((t) => `- ${t.titulo}`).join('\n')
		: 'Sin tickets asociados a esta versión.';

const { data: release, error: errorRelease } = await supabase
	.from('app_release')
	.insert({
		version: nuevaVersion,
		changelog,
		url_manifest_win: urlManifestWin,
		url_instalador_win: urlInstaladorWin,
		url_apk_drive: urlApkDrive,
		publicado_por: process.env.USER || process.env.USERNAME || 'developer'
	})
	.select('id_release')
	.single();
if (errorRelease) fail(`No se pudo crear la fila de release: ${errorRelease.message}`);

if ((ticketsAprobados ?? []).length > 0) {
	const ids = ticketsAprobados.map((t) => t.id_ticket);
	const { error: errorUpdate } = await supabase.from('ticket').update({ id_release: release.id_release, estado: 'cerrado' }).in('id_ticket', ids);
	if (errorUpdate) fail(`Release creado (id=${release.id_release}) pero no se pudieron actualizar los tickets: ${errorUpdate.message}`);
	log(`${ids.length} ticket(s) agrupados en el release v${nuevaVersion} y marcados como cerrados.`);
} else {
	log('No había tickets aprobados pendientes — release publicado igual (ej. una mejora sin ticket asociado).');
}

log(`✅ Listo — v${nuevaVersion} publicada. Windows: ${urlInstaladorWin}${urlApkDrive ? ` | Android (Drive fileId): ${urlApkDrive}` : ''}`);
