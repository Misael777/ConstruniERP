<script lang="ts">
	// Popup de previsualización de un documento (contrato/proforma/comprobante, PDF o imagen) subido
	// a Google Drive — extraído del que ya existía en comercial/ventas/+page.svelte para poder
	// reusarlo también en Transacciones (mismo patrón, pedido explícito del usuario). Controlado por
	// el padre (open/url/title/onClose como props), la conversión de la URL de Drive a su visor
	// embebible y la descarga viven adentro para que cada llamador solo tenga que pasar la URL cruda.
	import { toDrivePreviewUrl } from '$lib/shared/drivePreview';

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

	async function downloadFile() {
		if (!previewUrl) {
			alert('URL no disponible para descargar');
			return;
		}
		const filename = sanitizeFilename(title) + '.pdf';
		try {
			const res = await fetch(previewUrl, { mode: 'cors' });
			if (!res.ok) throw new Error('Fetch failed');
			const blob = await res.blob();
			const objUrl = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = objUrl;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(objUrl);
		} catch (err) {
			console.warn('[DocumentPreviewModal] descarga por fetch falló, abriendo en nueva pestaña', err);
			window.open(previewUrl, '_blank', 'noopener');
		}
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden">
			<!-- Modal Header -->
			<div class="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
				<h2 class="text-lg font-semibold text-slate-800">{title}</h2>
				<div class="flex items-center gap-2">
					<button
						onclick={downloadFile}
						class="text-slate-500 hover:text-slate-700 transition-colors w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded-lg"
						aria-label="Descargar"
						title="Descargar"
					>
						<i class="fas fa-download text-lg"></i>
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
{/if}
