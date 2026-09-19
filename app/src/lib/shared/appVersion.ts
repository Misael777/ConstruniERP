/**
 * Versión de la app instalada y su registro por usuario (ver app_version_usuario_migration.sql).
 *
 * - En Tauri (Windows/Android) la versión es la que la app trae incrustada al COMPILAR (getVersion(),
 *   sale de tauri.conf.json) — la misma que compara ActualizacionBell.svelte contra app_release.
 * - En el navegador no hay app instalada: se usa la versión de package.json con la que se compiló la
 *   web (__APP_VERSION__, ver vite.config.ts).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isRunningInTauri } from '$lib/driveUploadClient';

export type PlataformaApp = 'android' | 'windows' | 'macos' | 'linux' | 'ios' | 'web';

export interface InfoVersionApp {
	version: string;
	plataforma: PlataformaApp;
}

/** ¿`remota` es una versión más nueva que `instalada`? Compara por segmento numérico — un simple > de
 * strings falla ("1.2.10" < "1.2.9" carácter por carácter). */
export function esVersionMasNueva(remota: string, instalada: string): boolean {
	const a = remota.split('.').map(Number);
	const b = instalada.split('.').map(Number);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		if (x !== y) return x > y;
	}
	return false;
}

let cache: InfoVersionApp | null = null;

/** Versión + plataforma de esta instalación. Nunca lanza: ante cualquier fallo cae a la versión de la
 * compilación web y plataforma 'web'. */
export async function getInfoVersionApp(): Promise<InfoVersionApp> {
	if (cache) return cache;
	let info: InfoVersionApp = { version: __APP_VERSION__, plataforma: 'web' };
	if (isRunningInTauri()) {
		try {
			const { getVersion } = await import('@tauri-apps/api/app');
			const { platform } = await import('@tauri-apps/plugin-os');
			const p = platform();
			info = { version: await getVersion(), plataforma: (['android', 'windows', 'macos', 'linux', 'ios'].includes(p) ? p : 'web') as PlataformaApp };
		} catch (err) {
			console.warn('[appVersion] No se pudo leer la versión/plataforma de Tauri:', err);
		}
	}
	cache = info;
	return info;
}

/** Deja registrada en la base la versión que este usuario tiene instalada (una fila por usuario y
 * plataforma). Best-effort: si la tabla todavía no existe (falta correr app_version_usuario_migration.sql)
 * o falla la red, solo se avisa por consola — nunca debe romper el arranque de la app. */
export async function registrarVersionUsuario(client: SupabaseClient, userId: string, usuario: string | null): Promise<void> {
	try {
		const { version, plataforma } = await getInfoVersionApp();
		const { error } = await client
			.from('app_version_usuario')
			.upsert({ user_id: userId, usuario, plataforma, version, ultima_conexion: new Date().toISOString() }, { onConflict: 'user_id,plataforma' });
		if (error) console.warn('[appVersion] No se pudo registrar la versión instalada:', error.message);
	} catch (err) {
		console.warn('[appVersion] No se pudo registrar la versión instalada:', err);
	}
}
