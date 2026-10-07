<script lang="ts">
	// Vista previa de una Factura antes de imprimir/descargar — a pedido explícito del usuario
	// ("debemos emitir facturas y además previsualizarlas antes de imprimir"). Arma el PDF con
	// generarFacturaPdf (facturaPdf.ts, mismo pipeline HTML->PNG->PDF que el resto del ERP) y muestra
	// el PNG resultante como vista previa real (no un iframe de Drive, como DocumentPreviewModal —
	// acá el documento se genera en el momento, no se sube a ningún lado). "Descargar" reusa
	// guardarArchivoBinario (saveFile.ts, ya soporta Tauri Windows/Android + navegador). "Imprimir" en
	// navegador abre el PDF en una pestaña nueva (el visor nativo del navegador ya trae su propio
	// botón de imprimir); en Tauri no hay una vía nativa confiable de imprimir sin plugins nuevos, así
	// que ahí "Imprimir" hace lo mismo que "Descargar" con un aviso.
	import { untrack } from 'svelte';
	import { X, Download, Printer, Loader2 } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { isRunningInTauri } from '$lib/driveUploadClient';
	import { guardarArchivoBinario } from '$lib/shared/saveFile';
	import { base64ToUint8Array } from '$lib/shared/base64';
	import { generarFacturaPdf, type DatosFacturaPdf } from '$lib/shared/facturaPdf';

	const NOMBRE_TIPO_DOCUMENTO: Record<DatosFacturaPdf['tipoDocumento'], string> = {
		factura: 'Factura',
		boleta: 'Boleta',
		nota_credito: 'Nota de Crédito',
		nota_debito: 'Nota de Débito'
	};

	let {
		open = false,
		datos = null,
		onClose,
		onAutorizar = null,
		autorizando = false
	}: {
		open?: boolean;
		datos: DatosFacturaPdf | null;
		onClose: () => void;
		/** Cuando viene, se muestra "Autorizar y emitir" (paso obligatorio antes de guardar la imagen y
		 * emitir la factura — a pedido explícito del usuario: previsualización → autorización). El padre
		 * hace el trabajo real (guardar, regenerar con el folio real, subir a Drive, emitir). */
		onAutorizar?: (() => Promise<void>) | null;
		autorizando?: boolean;
	} = $props();

	let loading = $state(false);
	let error = $state('');
	let pngDataUrl = $state('');
	let pdfBase64 = $state('');

	// La generación va en untrack: generarFacturaPdf abre la capa "Generando el PDF…" (conCarga), que LEE y
	// escribe la lista reactiva de cargas (loading.svelte.ts). Sin untrack, este efecto quedaba suscrito a esa
	// lista: al terminar el PDF la lista cambiaba, el efecto volvía a correr y empezaba otro PDF — un ciclo sin fin
	// que dejaba la vista previa girando para siempre. Solo debe volver a generar si cambian `open` o `datos`.
	$effect(() => {
		if (!open || !datos) return;
		const datosActuales = datos;
		untrack(() => generarVistaPrevia(datosActuales));
	});

	function generarVistaPrevia(datosActuales: DatosFacturaPdf) {
		loading = true;
		error = '';
		pngDataUrl = '';
		pdfBase64 = '';
		generarFacturaPdf(datosActuales)
			.then((r) => {
				pngDataUrl = r.pngDataUrl;
				pdfBase64 = r.pdfBase64;
			})
			.catch((err) => {
				console.error('[FacturaPreviewModal] No se pudo generar la vista previa:', err);
				error = 'No se pudo generar la vista previa de la factura.';
			})
			.finally(() => {
				loading = false;
			});
	}

	async function handleDescargar() {
		if (!pdfBase64 || !datos) return;
		try {
			await guardarArchivoBinario(pdfBase64, `Factura_${datos.folio ?? 'borrador'}.pdf`, 'application/pdf');
			toast.success('PDF descargado');
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudo descargar el PDF');
		}
	}

	async function handleImprimir() {
		if (!pdfBase64 || !datos) return;
		if (isRunningInTauri()) {
			await handleDescargar();
			toast.info('Se guardó el PDF — ábrelo desde tu explorador de archivos para imprimirlo.');
			return;
		}
		const bytes = base64ToUint8Array(pdfBase64);
		const blob = new Blob([bytes], { type: 'application/pdf' });
		const url = URL.createObjectURL(blob);
		window.open(url, '_blank', 'noopener');
		// No se revoca el object URL de inmediato: la pestaña nueva todavía lo está cargando.
		setTimeout(() => URL.revokeObjectURL(url), 60000);
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl h-[90vh] flex flex-col overflow-hidden">
			<div class="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
				<h2 class="text-lg font-semibold text-slate-800">Vista previa — {datos?.folio ?? NOMBRE_TIPO_DOCUMENTO[datos?.tipoDocumento ?? 'factura']}</h2>
				<div class="flex items-center gap-2">
					{#if onAutorizar}
						<button
							onclick={() => onAutorizar?.()}
							disabled={loading || !pdfBase64 || autorizando}
							class="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
						>
							{#if autorizando}<Loader2 size={14} class="animate-spin" />{/if} Autorizar y emitir
						</button>
						{/if}
					<button
						onclick={handleDescargar}
						disabled={loading || !pdfBase64}
						class="text-slate-500 hover:text-slate-700 transition-colors w-9 h-9 flex items-center justify-center hover:bg-slate-100 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
						title="Descargar PDF"
						aria-label="Descargar PDF"
					>
						<Download size={18} />
					</button>
					<button
						onclick={handleImprimir}
						disabled={loading || !pdfBase64}
						class="text-slate-500 hover:text-slate-700 transition-colors w-9 h-9 flex items-center justify-center hover:bg-slate-100 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
						title="Imprimir"
						aria-label="Imprimir"
					>
						<Printer size={18} />
					</button>
					<button onclick={onClose} class="text-slate-400 hover:text-slate-600 transition-colors w-9 h-9 flex items-center justify-center hover:bg-slate-100 rounded-lg" aria-label="Cerrar">
						<X size={18} />
					</button>
				</div>
			</div>

			<div class="flex-1 overflow-auto bg-slate-100 p-4">
				{#if loading}
					<div class="w-full h-full flex items-center justify-center text-slate-400">
						<Loader2 class="animate-spin" size={28} />
					</div>
				{:else if error}
					<div class="w-full h-full flex items-center justify-center text-center text-slate-500">
						<p>{error}</p>
					</div>
				{:else if pngDataUrl}
					<img src={pngDataUrl} alt="Vista previa de la factura" class="w-full h-auto rounded-lg shadow" />
				{/if}
			</div>
		</div>
	</div>
{/if}
