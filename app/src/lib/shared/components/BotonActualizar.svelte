<script lang="ts">
	/**
	 * Botón "Actualizar" del módulo de Tickets/Releases (ver Documentacion/MecanismoCICD.md) — un solo
	 * componente, dos comportamientos MUY distintos según la plataforma, decididos y confirmados con
	 * el usuario:
	 *
	 * - Windows: usa @tauri-apps/plugin-updater (check + downloadAndInstall) + @tauri-apps/
	 *   plugin-process (relaunch) — auto-update real, con el diálogo de confirmación nativo del
	 *   plugin. El endpoint/pubkey vive en tauri.conf.json (apunta a GitHub Releases, ver
	 *   ticket_module_migration.sql/MecanismoCICD.md) — SIN una clave de firma real generada
	 *   (`npx tauri signer generate`) y pegada en tauri.conf.json, este flujo NO puede funcionar
	 *   todavía, ver la nota en ese archivo.
	 * - Android: no existe auto-update fuera de Play Store (Android bloquea la auto-instalación) —
	 *   abre el enlace público de descarga directa del APK (Drive) en el navegador del teléfono con
	 *   openUrl, y es el navegador + el instalador de Android quienes terminan la instalación. Ticket
	 *   #8: el flujo anterior (bajar el APK a caché con plugin-fs y abrirlo con `openPath` de
	 *   plugin-opener) NUNCA podía funcionar: `opener:default` no incluye `allow-open-path`, y aunque se
	 *   agregara, en Android `openPath` lanza un ACTION_VIEW con la ruta cruda (sin FileProvider ni MIME
	 *   de APK) y el manifest no declara REQUEST_INSTALL_PACKAGES. Android exige que el usuario haya
	 *   habilitado "Instalar apps desconocidas" para el navegador la primera vez.
	 * - Fuera de Tauri (navegador/`npm run dev`): no hay nada que auto-actualizar — se muestra
	 *   deshabilitado con una nota, no lanza ningún error.
	 */
	import { RefreshCw, Loader2 } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { isRunningInTauri } from '$lib/driveUploadClient';
	import { extractDriveFileId } from '$lib/shared/uploadProjectDocument';
	import { describeError } from '$lib/shared/describeError';
	import { iniciarCarga, type CargaEnCurso } from '$lib/stores/loading.svelte';
	import type { AppRelease } from '$lib/modules/tickets/services/releases.service';

	let { release }: { release: AppRelease } = $props();

	let procesando = $state(false);
	let estadoTexto = $state('');
	/** Último paso alcanzado — se vuelca en el diagnóstico si algo falla, para saber EXACTAMENTE cuál
	 * llamada rompió (los errores de los plugins de Tauri llegan como string, sin stack). */
	let paso = 'sin iniciar';
	let urlIntentada = '';

	function diagnostico(err: any, plataforma: string, urlDescarga: string): string {
		const lineas = [
			`paso que falló: ${paso}`,
			`plataforma: ${plataforma}`,
			`versión destino: v${release.version}`,
			`versión destino url_apk_drive: ${release.url_apk_drive ?? '(vacío)'}`,
			`url intentada: ${urlDescarga || '(aún no armada)'}`,
			`tipo de error: ${typeof err}${err?.name ? ` / ${err.name}` : ''}`,
			`mensaje: ${describeError(err)}`,
			`userAgent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'}`,
			''
		];
		if (err?.stack) {
			lineas.push('stack del error:', String(err.stack));
		} else {
			lineas.push('El error no trae stack (llegó como texto desde el plugin nativo).', 'stack del punto donde se capturó:', new Error().stack ?? '(sin stack)');
		}
		return lineas.join('\n');
	}

	// Ticket #9: la animación de carga acompaña cada paso — se actualiza el mismo mensaje en vez de abrir
	// una espera nueva por paso, para que no destelle entre "Buscando..." y "Descargando...".
	async function actualizarWindows(carga: CargaEnCurso) {
		paso = 'importar plugin-updater/plugin-process';
		const { check } = await import('@tauri-apps/plugin-updater');
		const { relaunch } = await import('@tauri-apps/plugin-process');
		estadoTexto = 'Buscando actualización...';
		carga.actualizar('Buscando actualización…');
		paso = 'check() — consultar latest.json en GitHub';
		const update = await check();
		if (!update) {
			toast.info('Ya tienes la última versión instalada.');
			return;
		}
		estadoTexto = `Descargando v${update.version}...`;
		carga.actualizar(`Descargando la versión ${update.version}…`);
		paso = `downloadAndInstall() v${update.version}`;
		await update.downloadAndInstall();
		toast.success('Actualización instalada — la app se va a reiniciar.');
		paso = 'relaunch()';
		await relaunch();
	}

	async function actualizarAndroid(carga: CargaEnCurso) {
		if (!release.url_apk_drive) {
			toast.error('Esta versión todavía no tiene el APK adjunto — avísale al developer.');
			return;
		}
		paso = 'armar URL de descarga';
		const fileId = extractDriveFileId(release.url_apk_drive) ?? release.url_apk_drive;
		estadoTexto = 'Abriendo descarga...';
		carga.actualizar('Abriendo la descarga…');
		// El archivo de Drive es público (lo sube release.mjs con permiso "anyone reader") y es grande:
		// `confirm=t` en drive.usercontent.google.com salta el aviso "no se puede analizar en busca de
		// virus" que Drive muestra en archivos pesados, así el navegador baja el APK directo.
		const urlDescarga = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
		urlIntentada = urlDescarga;
		paso = 'importar plugin-opener';
		const { openUrl } = await import('@tauri-apps/plugin-opener');
		paso = 'openUrl() — abrir la descarga en el navegador';
		await openUrl(urlDescarga);
		toast.info('Se abrió la descarga en tu navegador. Al terminar, toca el archivo descargado para instalar la nueva versión.');
	}

	async function handleClick() {
		if (!isRunningInTauri()) {
			toast.info('La actualización automática solo funciona en la app instalada (Windows/Android), no en el navegador.');
			return;
		}
		procesando = true;
		paso = 'detectar plataforma (plugin-os)';
		urlIntentada = '';
		let plataforma = 'desconocida';
		const carga = iniciarCarga('Buscando actualización…');
		try {
			const { platform } = await import('@tauri-apps/plugin-os');
			plataforma = platform();
			if (plataforma === 'android') {
				await actualizarAndroid(carga);
			} else {
				await actualizarWindows(carga);
			}
		} catch (err: any) {
			console.error('[BotonActualizar] Error al actualizar:', err);
			// Los errores de los plugins de Tauri llegan como string (no como Error) — con `err?.message` el
			// motivo real se perdía y siempre salía el texto genérico (ticket #8). El detalle completo (paso
			// que falló + stack) va en un bloque copiable dentro del toast rojo.
			toast.error(`No se pudo completar la actualización: ${describeError(err)}`, diagnostico(err, plataforma, urlIntentada));
		} finally {
			carga.cerrar();
			procesando = false;
			estadoTexto = '';
		}
	}
</script>

<button
	type="button"
	onclick={handleClick}
	disabled={procesando}
	class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-60 shrink-0"
>
	{#if procesando}
		<Loader2 size={14} class="animate-spin" /> {estadoTexto || 'Actualizando...'}
	{:else}
		<RefreshCw size={14} /> Actualizar
	{/if}
</button>
