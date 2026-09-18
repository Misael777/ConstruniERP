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
	 *   descarga el APK del release desde Drive (mismo cliente autenticado que ya usa el resto del ERP
	 *   para documentos) y usa @tauri-apps/plugin-opener para invocarle al usuario el instalador
	 *   nativo del APK ya descargado. ⚠️ Sin verificar en un dispositivo real todavía — Android exige
	 *   que el usuario ya haya habilitado "Instalar apps desconocidas" para esta app la primera vez.
	 * - Fuera de Tauri (navegador/`npm run dev`): no hay nada que auto-actualizar — se muestra
	 *   deshabilitado con una nota, no lanza ningún error.
	 */
	import { RefreshCw, Loader2 } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { isRunningInTauri, downloadFromDriveClientStream } from '$lib/driveUploadClient';
	import { extractDriveFileId } from '$lib/shared/uploadProjectDocument';
	import type { AppRelease } from '$lib/modules/tickets/services/releases.service';

	let { release }: { release: AppRelease } = $props();

	let procesando = $state(false);
	let estadoTexto = $state('');

	async function actualizarWindows() {
		const { check } = await import('@tauri-apps/plugin-updater');
		const { relaunch } = await import('@tauri-apps/plugin-process');
		estadoTexto = 'Buscando actualización...';
		const update = await check();
		if (!update) {
			toast.info('Ya tienes la última versión instalada.');
			return;
		}
		estadoTexto = `Descargando v${update.version}...`;
		await update.downloadAndInstall();
		toast.success('Actualización instalada — la app se va a reiniciar.');
		await relaunch();
	}

	async function actualizarAndroid() {
		if (!release.url_apk_drive) {
			toast.error('Esta versión todavía no tiene el APK adjunto — avísale al developer.');
			return;
		}
		const fileId = extractDriveFileId(release.url_apk_drive) ?? release.url_apk_drive;
		estadoTexto = 'Descargando APK...';
		// Stream directo a disco (ver downloadFromDriveClientStream) — bug real reportado por el usuario
		// (con video): cargar el APK completo en memoria como Blob→ArrayBuffer→Uint8Array antes de
		// pasarlo al puente de Tauri tiraba `Invalid array length` en un teléfono de gama baja (~185MB,
		// demasiada memoria de una sola vez para ese WebView). writeFile acepta un ReadableStream directo.
		const stream = await downloadFromDriveClientStream(fileId);

		const { writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
		const { join, cacheDir } = await import('@tauri-apps/api/path');
		const nombreArchivo = `construni-erp-v${release.version}.apk`;
		await writeFile(nombreArchivo, stream, { baseDir: BaseDirectory.Cache });
		const rutaCompleta = await join(await cacheDir(), nombreArchivo);

		estadoTexto = 'Abriendo instalador...';
		const { openPath } = await import('@tauri-apps/plugin-opener');
		await openPath(rutaCompleta);
		toast.info('Sigue los pasos del instalador de Android para terminar de actualizar.');
	}

	async function handleClick() {
		if (!isRunningInTauri()) {
			toast.info('La actualización automática solo funciona en la app instalada (Windows/Android), no en el navegador.');
			return;
		}
		procesando = true;
		try {
			const { platform } = await import('@tauri-apps/plugin-os');
			const plataforma = platform();
			if (plataforma === 'android') {
				await actualizarAndroid();
			} else {
				await actualizarWindows();
			}
		} catch (err: any) {
			console.error('[BotonActualizar] Error al actualizar:', err);
			toast.error(err?.message ?? 'No se pudo completar la actualización.');
		} finally {
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
