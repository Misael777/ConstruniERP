<script lang="ts">
	// Popup de previsualización de un documento (contrato/proforma/comprobante, PDF o imagen) subido
	// a Google Drive — extraído del que ya existía en comercial/ventas/+page.svelte para poder
	// reusarlo también en Transacciones (mismo patrón, pedido explícito del usuario). Controlado por
	// el padre (open/url/title/onClose como props), la conversión de la URL de Drive a su visor
	// embebible y la descarga viven adentro para que cada llamador solo tenga que pasar la URL cruda.
	import { toDrivePreviewUrl } from '$lib/shared/drivePreview';
	import { isRunningInTauri } from '$lib/driveUploadClient';

	let {
		open = false,
		url = '',
		title = '',
		onClose = () => {}
	}: {
		open?: boolean;
		url?: string | null;
		title?: string;
		onClose?: () => void;
	} = $props();

	let previewUrl = $derived(toDrivePreviewUrl(url));

	function sanitizeFilename(name: string) {
		return name.replace(/[^a-z0-9\-_.() ]+/gi, '_').trim() || 'document';
	}

	// A pedido del usuario: antes de descargar, pedir confirmación y (cuando la plataforma lo permite)
	// dejar elegir la ruta de destino — en vez de descargar directo al hacer clic en el botón.
	let showDownloadConfirm = $state(false);
	let isDownloading = $state(false);
	let downloadError = $state('');

	function requestDownload() {
		if (!previewUrl) {
			alert('URL no disponible para descargar');
			return;
		}
		downloadError = '';
		showDownloadConfirm = true;
	}

	function cancelDownload() {
		showDownloadConfirm = false;
	}

	/** Guarda un blob ya descargado en disco, con ruta elegida por el usuario cuando la plataforma lo
	 * permite: en Tauri (Windows/Android) usa el diálogo nativo "Guardar como" (@tauri-apps/plugin-dialog
	 * + escritura binaria de @tauri-apps/plugin-fs, mismo patrón que guardarArchivoDeTexto.ts para el
	 * CSV de Ventas, adaptado a binario). En navegador, si soporta el selector de archivos nativo
	 * (Chrome/Edge de escritorio) lo usa para elegir la ruta real; si no, cae al Blob + `<a download>`
	 * de siempre, que el navegador guarda según su propia configuración de descargas. */
	async function guardarBinario(blob: Blob, filename: string): Promise<void> {
		if (isRunningInTauri()) {
			const { save } = await import('@tauri-apps/plugin-dialog');
			const { writeFile } = await import('@tauri-apps/plugin-fs');

			const extension = filename.includes('.') ? filename.split('.').pop()! : 'pdf';
			const path = await save({
				defaultPath: filename,
				filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
			});
			if (!path) return; // el usuario canceló el diálogo nativo — no es un error

			const buffer = new Uint8Array(await blob.arrayBuffer());
			await writeFile(path, buffer);
			return;
		}

		const picker = (window as any).showSaveFilePicker;
		if (typeof picker === 'function') {
			try {
				const handle = await picker({ suggestedName: filename });
				const writable = await handle.createWritable();
				await writable.write(blob);
				await writable.close();
				return;
			} catch (err: any) {
				if (err?.name === 'AbortError') return; // el usuario canceló el selector nativo
				console.warn('[DocumentPreviewModal] showSaveFilePicker falló, uso el flujo clásico', err);
			}
		}

		const objUrl = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = objUrl;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(objUrl);
	}

	async function confirmDownload() {
		showDownloadConfirm = false;
		if (!previewUrl) return;

		const filename = sanitizeFilename(title) + '.pdf';
		isDownloading = true;
		downloadError = '';
		try {
			const res = await fetch(previewUrl, { mode: 'cors' });
			if (!res.ok) throw new Error('Fetch failed');
			const blob = await res.blob();
			await guardarBinario(blob, filename);
		} catch (err) {
			console.warn('[DocumentPreviewModal] descarga por fetch falló, abriendo en nueva pestaña', err);
			window.open(previewUrl, '_blank', 'noopener');
		} finally {
			isDownloading = false;
		}
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden">
			<!-- Modal Header -->
			<div class="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
				<h2 class="text-lg font-semibold text-slate-800">{title}</h2>
				<div class="flex items-center gap-2">
					<button
						onclick={requestDownload}
						disabled={isDownloading}
						class="text-slate-500 hover:text-slate-700 transition-colors w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
						aria-label="Descargar"
						title="Descargar"
					>
						{#if isDownloading}
							<i class="fas fa-spinner fa-spin text-lg"></i>
						{:else}
							<i class="fas fa-download text-lg"></i>
						{/if}
					</button>
					<button
						onclick={onClose}
						class="text-slate-400 hover:text-slate-600 transition-colors w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded-lg"
						aria-label="Cerrar"
					>
						<i class="fas fa-times text-lg"></i>
					</button>
				</div>
			</div>

			<div class="flex-1 overflow-hidden bg-slate-100">
				{#if previewUrl}
					<iframe
						src={previewUrl}
						{title}
						class="w-full h-full border-none"
						allowfullscreen
					></iframe>
				{:else}
					<div class="w-full h-full flex items-center justify-center">
						<div class="text-center text-slate-500">
							<i class="fas fa-exclamation-circle text-4xl mb-3"></i>
							<p class="font-medium">No se pudo cargar la vista previa</p>
							<p class="text-sm mt-1">URL no disponible</p>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>

	<!-- Confirmación de descarga (a pedido del usuario) — se muestra ANTES de descargar, en vez de
	     descargar directo al hacer clic en el botón. -->
	{#if showDownloadConfirm}
		<div class="fixed inset-0 bg-black/40 z-[120] flex items-center justify-center p-4">
			<div
				class="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5"
				role="dialog"
				aria-modal="true"
				aria-labelledby="download-confirm-title"
			>
				<h3 id="download-confirm-title" class="text-base font-semibold text-slate-800 mb-1">Descargar documento</h3>
				<p class="text-sm text-slate-600 mb-4">
					¿Deseas descargar <strong>{sanitizeFilename(title)}.pdf</strong>?
					{#if isRunningInTauri()}
						Se abrirá un diálogo para que elijas dónde guardarlo.
					{:else}
						Si tu navegador lo permite, podrás elegir la carpeta de destino; si no, se guardará en tu carpeta de Descargas.
					{/if}
				</p>
				<div class="flex justify-end gap-2">
					<button
						onclick={cancelDownload}
						class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
					>
						Cancelar
					</button>
					<button
						onclick={confirmDownload}
						class="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
					>
						Descargar
					</button>
				</div>
			</div>
		</div>
	{/if}
{/if}
