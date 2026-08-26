<script lang="ts">
	// Popup de previsualización de un documento (contrato/proforma/comprobante, PDF o imagen) subido
	// a Google Drive — extraído del que ya existía en comercial/ventas/+page.svelte para poder
	// reusarlo también en Transacciones (mismo patrón, pedido explícito del usuario). Controlado por
	// el padre (open/url/title/onClose como props), la conversión de la URL de Drive a su visor
	// embebible y la descarga viven adentro para que cada llamador solo tenga que pasar la URL cruda.
	import { toDrivePreviewUrl } from '$lib/shared/drivePreview';
	import { extractDriveFileId } from '$lib/shared/uploadProjectDocument';
	import { isRunningInTauri, downloadFromDriveClient } from '$lib/driveUploadClient';
	import { resolveApiUrl } from '$lib/apiClient';
	import { toast } from '$lib/stores/toast';

	let {
		open = false,
		url = '',
		title = '',
		documents = [],
		initialIndex = 0,
		onClose = () => {}
	}: {
		open?: boolean;
		url?: string | null;
		title?: string;
		/** Cuando el documento tiene más de una versión asociada (ej. varias proformas de un proyecto,
		 * o comprobante + factura de una transacción) — a pedido del usuario, se muestra un selector de
		 * pastillas en la cabecera para cambiar entre ellas sin cerrar el popup. Con 0 o 1 elementos se
		 * ignora por completo y el modal se comporta igual que antes, mostrando `url` directo. `filename`
		 * es opcional: si el llamador ya arma un nombre completo por documento (ej. boucher vs. factura
		 * de Transacciones, cada uno con su propia estructura de nombre) se usa tal cual al descargar en
		 * vez del genérico `{title} - {label}`. */
		documents?: { url: string; label: string; filename?: string }[];
		/** Cuál de `documents` mostrar al abrir (ej. la proforma marcada como final, en vez de siempre
		 * la primera de la lista). Se ignora si no hay `documents`. */
		initialIndex?: number;
		onClose?: () => void;
	} = $props();

	let selectedIndex = $state(0);
	$effect(() => {
		if (open) selectedIndex = initialIndex;
	});

	const activeDoc = $derived(documents.length > 0 ? documents[Math.min(selectedIndex, documents.length - 1)] : null);
	const effectiveUrl = $derived(activeDoc ? activeDoc.url : url);
	const downloadTitle = $derived(activeDoc?.filename ? activeDoc.filename : documents.length > 1 && activeDoc ? `${title} - ${activeDoc.label}` : title);
	let previewUrl = $derived(toDrivePreviewUrl(effectiveUrl));

	function sanitizeFilename(name: string) {
		return name.replace(/[^a-z0-9\-_.() ]+/gi, '_').trim() || 'document';
	}

	// A pedido del usuario: antes de descargar, pedir confirmación — en vez de descargar directo al
	// hacer clic en el botón.
	let showDownloadConfirm = $state(false);
	let isDownloading = $state(false);

	function requestDownload() {
		if (!effectiveUrl) {
			alert('URL no disponible para descargar');
			return;
		}
		showDownloadConfirm = true;
	}

	function cancelDownload() {
		showDownloadConfirm = false;
	}

	function extensionPorContentType(contentType: string | null): string {
		if (!contentType) return 'pdf';
		if (contentType.includes('png')) return 'png';
		if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
		if (contentType.includes('webp')) return 'webp';
		return 'pdf';
	}

	/** A pedido explícito del usuario: los enlaces públicos de Drive (`uc?export=download`,
	 * `usercontent.google.com/download`) no garantizan CORS de forma confiable para fetch() desde el
	 * navegador (a veces sí, a veces "blocked by CORS policy") — y una simple navegación directa a
	 * esos enlaces SÍ descarga sin problema, pero pierde el control del nombre de archivo (Drive decide
	 * el suyo). Para tener las dos cosas (descarga confiable Y nombre propio) se usa la MISMA vía
	 * autenticada que ya usa el resto de la app para subir/renombrar/borrar en Drive — sin CORS de por
	 * medio porque en el navegador pasa por este mismo servidor (GET /api/upload-document, server-to-
	 * server con Google) y en Tauri es una llamada directa autenticada (ver downloadFromDriveClient). */
	async function confirmDownload() {
		showDownloadConfirm = false;
		if (!effectiveUrl) return;

		const fileId = extractDriveFileId(effectiveUrl);
		if (!fileId) {
			toast.error('No se pudo determinar el archivo a descargar.');
			return;
		}
		const nombreBase = sanitizeFilename(downloadTitle);

		isDownloading = true;
		try {
			if (isRunningInTauri()) {
				const blob = await downloadFromDriveClient(fileId);
				const { save } = await import('@tauri-apps/plugin-dialog');
				const { writeFile } = await import('@tauri-apps/plugin-fs');
				const extension = extensionPorContentType(blob.type);
				const filename = `${nombreBase}.${extension}`;
				const path = await save({ defaultPath: filename, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
				if (!path) return; // el usuario canceló el diálogo nativo
				await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
				toast.success(`Se guardó en: ${path}`);
			} else {
				// Same-origin: el navegador descarga sin ningún problema de CORS, con el nombre que arma
				// el servidor (ver GET en upload-document/+server.ts, que ya sabe la extensión real).
				const downloadEndpoint = resolveApiUrl(`/api/upload-document?fileId=${encodeURIComponent(fileId)}&filename=${encodeURIComponent(nombreBase)}`);
				window.open(downloadEndpoint, '_blank', 'noopener');
				toast.success('Descarga iniciada — revisa la carpeta de Descargas o la barra de descargas de tu navegador.');
			}
		} catch (err) {
			console.warn('[DocumentPreviewModal] Descarga vía API de Drive falló, abriendo en nueva pestaña', err);
			toast.info('No se pudo descargar directamente — se abrió en una nueva pestaña.');
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
			<div class="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0 gap-3 flex-wrap">
				<div class="min-w-0">
					<h2 class="text-lg font-semibold text-slate-800 truncate">{title}</h2>
					{#if documents.length > 1}
						<div class="flex items-center gap-1.5 mt-1.5 flex-wrap">
							{#each documents as doc, i (i)}
								<button
									type="button"
									onclick={() => (selectedIndex = i)}
									class={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${i === selectedIndex ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
								>
									{doc.label}
								</button>
							{/each}
						</div>
					{/if}
				</div>
				<div class="flex items-center gap-2 shrink-0">
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
					¿Deseas descargar <strong>{sanitizeFilename(downloadTitle)}</strong>?
					{#if isRunningInTauri()}
						Se abrirá un diálogo para que elijas dónde guardarlo.
					{:else}
						Se guardará en tu carpeta de Descargas (o donde tu navegador esté configurado para
						guardar descargas).
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
