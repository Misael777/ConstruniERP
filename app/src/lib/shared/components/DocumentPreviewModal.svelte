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
	import { abrirEnlaceExterno } from '$lib/shared/enlaceExterno';
	import { tick, untrack } from 'svelte';

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
	// A pedido explícito del usuario: distingue "no hay ningún documento" (ej. una transacción de
	// Préstamo, que se autogenera sin ningún archivo adjunto) de un error real de carga — antes ambos
	// casos mostraban el mismo aviso genérico "No se pudo cargar la vista previa", que suena a fallo
	// aunque acá simplemente no hay nada que mostrar.
	const sinDocumentos = $derived(documents.length === 0 && !url);
	const downloadTitle = $derived(activeDoc?.filename ? activeDoc.filename : documents.length > 1 && activeDoc ? `${title} - ${activeDoc.label}` : title);
	let previewUrl = $derived(toDrivePreviewUrl(effectiveUrl));

	// ── Visor propio (ticket #81) ─────────────────────────────────────────────────────────────────────────
	// En la app de escritorio, dentro del visor embebido de Google Drive (iframe) la rueda del mouse no
	// desplazaba el documento y no se podía ver completo. En la app (Tauri: escritorio y celular) el archivo
	// se descarga directo de Drive y se muestra aquí mismo: un PDF con pdf.js, página por página, dentro de un
	// contenedor con scroll propio; una imagen, como <img>. En el navegador web, o si algo falla, se usa el
	// visor de Drive de siempre.
	type ModoVisor = 'iframe' | 'cargando' | 'pdf' | 'imagen';
	let modoVisor = $state<ModoVisor>('iframe');
	let imagenUrl = $state<string | null>(null);
	let paginasEl = $state<HTMLDivElement | null>(null);
	let totalPaginas = $state(0);
	let cargaId = 0;

	function liberarImagen() {
		if (imagenUrl) URL.revokeObjectURL(imagenUrl);
		imagenUrl = null;
	}

	async function esPdf(blob: Blob): Promise<boolean> {
		if (blob.type.includes('pdf')) return true;
		const cabecera = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
		return String.fromCharCode(...cabecera) === '%PDF-';
	}

	/** Observación de la clienta (27/11/2026): algunos comprobantes se veían inmensos. Drive (o el archivo local) a veces
	 * no trae el tipo (application/octet-stream o vacío) y la imagen caía al iframe a su tamaño real. Se reconoce la
	 * imagen por sus primeros bytes (JPG, PNG, GIF, WEBP, BMP) para mostrarla siempre ajustada a la ventana. */
	async function tipoImagen(blob: Blob): Promise<string | null> {
		if (blob.type.startsWith('image/')) return blob.type;
		const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
		if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
		if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
		if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
		if (String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
		if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
		return null;
	}

	// Observación de la clienta (26/11/2026): el comprobante recién adjuntado en "Nueva transacción" aún no está en
	// Drive (es un archivo local, blob: o data:). Se mostraba en el iframe a su tamaño real ("como zoom"): ahora usa
	// el visor propio, que ajusta la imagen a la pantalla.
	const esArchivoLocal = (u: string) => u.startsWith('blob:') || u.startsWith('data:');
	let imagenAmpliada = $state(false);

	async function cargarVisorPropio(urlDoc: string, id: number) {
		const fileId = esArchivoLocal(urlDoc) ? null : extractDriveFileId(urlDoc);
		if (!fileId && !esArchivoLocal(urlDoc)) return;
		modoVisor = 'cargando';
		try {
			const blob = fileId ? await downloadFromDriveClient(fileId) : await (await fetch(urlDoc)).blob();
			if (id !== cargaId) return;
			const tipo = await tipoImagen(blob);
			if (id !== cargaId) return;
			if (tipo) {
				imagenUrl = URL.createObjectURL(blob.type === tipo ? blob : new Blob([blob], { type: tipo }));
				modoVisor = 'imagen';
				return;
			}
			if (!(await esPdf(blob))) {
				modoVisor = 'iframe';
				return;
			}
			modoVisor = 'pdf';
			await tick();
			if (id !== cargaId || !paginasEl) return;
			const ancho = Math.max(Math.min(paginasEl.clientWidth, 900) - 2, 200);
			totalPaginas = await import('$lib/shared/pdfPreview').then(({ renderizarPdfEnContenedor }) =>
				renderizarPdfEnContenedor(blob, paginasEl!, ancho, () => id === cargaId)
			);
		} catch (err) {
			console.warn('[DocumentPreviewModal] Visor propio no disponible, se usa el de Drive:', err);
			if (id === cargaId) modoVisor = 'iframe';
		}
	}

	$effect(() => {
		const urlDoc = effectiveUrl;
		const abierto = open;
		const id = ++cargaId;
		// Solo url/open disparan la carga: el resto se lee sin rastrear para no reiniciarla en bucle.
		untrack(() => {
			liberarImagen();
			totalPaginas = 0;
			if (paginasEl) paginasEl.replaceChildren();
			modoVisor = 'iframe';
			imagenAmpliada = false;
			if (abierto && urlDoc && (isRunningInTauri() || esArchivoLocal(urlDoc))) void cargarVisorPropio(urlDoc, id);
		});
		return () => {
			// Al cerrar o cambiar de documento se descarta lo que siga dibujándose.
			if (id === cargaId) cargaId++;
		};
	});

	function sanitizeFilename(name: string) {
		return name.replace(/[^a-z0-9\-_.() ]+/gi, '_').trim() || 'document';
	}

	// A pedido del usuario: antes de descargar, pedir confirmación — en vez de descargar directo al
	// hacer clic en el botón.
	let showDownloadConfirm = $state(false);
	let isDownloading = $state(false);

	function requestDownload() {
		if (!effectiveUrl) {
			toast.error('URL no disponible para descargar');
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
			toast.info('No se pudo descargar directamente — se abrió el archivo en el navegador.');
			void abrirEnlaceExterno(previewUrl).catch((e) => console.error('[DocumentPreviewModal] Tampoco se pudo abrir la URL:', e));
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
					{#if !sinDocumentos}
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
					{/if}
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
				{#if previewUrl && modoVisor === 'cargando'}
					<div class="w-full h-full flex items-center justify-center text-slate-500">
						<div class="text-center">
							<i class="fas fa-spinner fa-spin text-3xl mb-3"></i>
							<p class="text-sm">Cargando documento…</p>
						</div>
					</div>
				{:else if previewUrl && modoVisor === 'pdf'}
					<div class="w-full h-full overflow-y-auto overscroll-contain bg-slate-200 px-3 py-4 sm:px-6">
						<div bind:this={paginasEl} class="mx-auto max-w-[900px] flex flex-col gap-4"></div>
						{#if totalPaginas > 40}
							<p class="text-center text-xs text-slate-500 mt-4">Se muestran las primeras 40 de {totalPaginas} páginas. Descarga el archivo para verlo completo.</p>
						{/if}
					</div>
				{:else if previewUrl && modoVisor === 'imagen' && imagenUrl}
					<!-- La imagen entra completa en la ventana; un clic la amplía a su tamaño real (y otro la vuelve a ajustar). -->
					<div class={`w-full h-full overflow-auto overscroll-contain bg-slate-200 p-4 flex ${imagenAmpliada ? 'items-start justify-start' : 'items-center justify-center'}`}>
						<button type="button" onclick={() => (imagenAmpliada = !imagenAmpliada)} class={`${imagenAmpliada ? 'shrink-0 cursor-zoom-out' : 'max-w-full max-h-full cursor-zoom-in'}`} title={imagenAmpliada ? 'Clic para ajustar a la pantalla' : 'Clic para ampliar'}>
							<img src={imagenUrl} alt={title} class={imagenAmpliada ? 'max-w-none shadow-md bg-white' : 'max-w-full max-h-[calc(90vh-7rem)] object-contain shadow-md bg-white'} />
						</button>
					</div>
				{:else if previewUrl}
					<iframe
						src={previewUrl}
						{title}
						class="w-full h-full border-none"
						allowfullscreen
					></iframe>
				{:else if sinDocumentos}
					<div class="w-full h-full flex items-center justify-center">
						<div class="text-center text-slate-500">
							<i class="fas fa-folder-open text-4xl mb-3"></i>
							<p class="font-medium">Sin documentos</p>
							<p class="text-sm mt-1">Esta transacción no tiene documentos adjuntos.</p>
						</div>
					</div>
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
