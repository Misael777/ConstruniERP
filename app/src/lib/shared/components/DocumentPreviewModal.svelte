<script lang="ts">
	// Popup de previsualización de un documento (contrato/proforma/comprobante, PDF o imagen) subido
	// a Google Drive — extraído del que ya existía en comercial/ventas/+page.svelte para poder
	// reusarlo también en Transacciones (mismo patrón, pedido explícito del usuario). Controlado por
	// el padre (open/url/title/onClose como props), la conversión de la URL de Drive a su visor
	// embebible y la descarga viven adentro para que cada llamador solo tenga que pasar la URL cruda.
	import { toDrivePreviewUrl } from '$lib/shared/drivePreview';
	import { toast } from '$lib/stores/toast';

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

	// A pedido del usuario: el botón "Descargar" no daba ninguna señal de que algo estaba pasando —
	// ahora muestra un spinner mientras descarga y, si el servidor informa el tamaño del archivo
	// (header Content-Length — no siempre viene, depende de cómo responda Drive), una barra de
	// progreso real en vez de solo un spinner indeterminado.
	let isDownloading = $state(false);
	let downloadProgress = $state<number | null>(null);

	function sanitizeFilename(name: string) {
		return name.replace(/[^a-z0-9\-_.() ]+/gi, '_').trim() || 'document';
	}

	async function downloadFile() {
		if (!previewUrl) {
			alert('URL no disponible para descargar');
			return;
		}
		const filename = sanitizeFilename(title) + '.pdf';
		isDownloading = true;
		downloadProgress = null;
		try {
			const res = await fetch(previewUrl, { mode: 'cors' });
			if (!res.ok || !res.body) throw new Error('Fetch failed');

			// Streaming manual (en vez de res.blob() directo) para poder reportar progreso en el camino —
			// si el header no trae el tamaño total, downloadProgress se queda en null y el botón solo
			// muestra el spinner (progreso indeterminado), sin barra.
			const totalStr = res.headers.get('Content-Length');
			const total = totalStr ? Number(totalStr) : 0;
			const reader = res.body.getReader();
			const chunks: BlobPart[] = [];
			let recibido = 0;
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				if (value) {
					chunks.push(value);
					recibido += value.byteLength;
					if (total > 0) downloadProgress = Math.round((recibido / total) * 100);
				}
			}

			const blob = new Blob(chunks);
			const objUrl = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = objUrl;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(objUrl);
			toast.success(`"${title}" se descargó correctamente.`);
		} catch (err) {
			console.warn('[DocumentPreviewModal] descarga por fetch falló, abriendo en nueva pestaña', err);
			toast.info('No se pudo descargar directamente — se abrió en una nueva pestaña.');
			window.open(previewUrl, '_blank', 'noopener');
		} finally {
			isDownloading = false;
			downloadProgress = null;
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
						onclick={downloadFile}
						disabled={isDownloading}
						class="text-slate-500 hover:text-slate-700 transition-colors w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-transparent"
						aria-label={isDownloading ? 'Descargando…' : 'Descargar'}
						title={isDownloading ? 'Descargando…' : 'Descargar'}
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

			<!-- Barra de progreso — solo aparece si el servidor informó el tamaño del archivo
			     (downloadProgress !== null); archivos sin Content-Length quedan con el spinner del botón de
			     arriba como único indicador (progreso indeterminado). -->
			{#if isDownloading && downloadProgress !== null}
				<div class="h-1 bg-slate-100 flex-shrink-0">
					<div class="h-full bg-blue-500 transition-all duration-150" style={`width: ${downloadProgress}%`}></div>
				</div>
			{/if}

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
{/if}
