<script lang="ts">
	/**
	 * "Detalle de Transacción" (ticket #83) — se abre solo al terminar de registrar un Ingreso o Egreso
	 * externo (ver handleSaved en finanzas/tranzacciones/+page.svelte), según la imagen de referencia del
	 * cliente: resultado, monto, fecha/hora, la captura del comprobante y el mensaje de la transacción (el
	 * mismo del botón de mensaje de la lista, ver mensajeR2.ts).
	 *   - "Compartir": comprobante + mensaje interno ("Yo, …, he registrado el pago…").
	 *   - "Compartir a proveedor" (Egreso) / "Compartir a cliente" (Ingreso): comprobante + el mensaje
	 *     redactado para el tercero ("Se pagó S/ … al proveedor …").
	 * Cómo se comparte en cada plataforma: ver compartir.ts.
	 */
	import { CheckCircle2, CalendarDays, Share2, X, ReceiptText, Info, Loader2 } from '@lucide/svelte';
	import { toDriveThumbnailUrl } from '$lib/shared/drivePreview';
	import { compartirComprobante, descargarComprobante } from '$lib/shared/compartir';
	import { formatCurrency } from '$lib/shared/fieldConfig';
	import { toast } from '$lib/stores/toast';

	let {
		open,
		tipo,
		monto,
		fechaHora,
		comprobanteUrl,
		mensaje,
		mensajeTercero,
		tercero,
		onClose
	}: {
		open: boolean;
		tipo: 'ingreso' | 'egreso';
		monto: number;
		/** Ya formateada, ej. "06/10/2026 - 10:24 a. m.". */
		fechaHora: string;
		comprobanteUrl: string | null;
		mensaje: string;
		mensajeTercero: string;
		tercero: 'proveedor' | 'cliente';
		onClose: () => void;
	} = $props();

	let compartiendo = $state<'propio' | 'tercero' | null>(null);
	let archivo: Blob | null | undefined = undefined; // undefined = aún no se descargó
	let imagenFallo = $state(false);

	$effect(() => {
		if (open) {
			archivo = undefined;
			imagenFallo = false;
		}
	});

	async function compartir(cual: 'propio' | 'tercero') {
		if (compartiendo) return;
		compartiendo = cual;
		try {
			if (archivo === undefined) archivo = await descargarComprobante(comprobanteUrl);
			const resultado = await compartirComprobante({
				texto: cual === 'propio' ? mensaje : mensajeTercero,
				archivo,
				nombreBase: `comprobante-${tipo}`
			});
			if (resultado === 'copiado') toast.info('Se copió el mensaje: pégalo junto con el comprobante en WhatsApp o en el correo.');
		} catch (err) {
			console.error('[DetalleTransaccionModal] No se pudo compartir:', err);
			toast.error('No se pudo abrir el menú de compartir.');
		} finally {
			compartiendo = null;
		}
	}
</script>

{#if open}
	<div class="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-3 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="detalle-tx-titulo">
		<div class="w-full max-w-lg max-h-[92dvh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
			<div class="sticky top-0 z-10 flex items-center justify-between gap-3 bg-white px-5 py-4 border-b border-slate-100">
				<div class="flex items-center gap-2.5">
					<ReceiptText class="text-[#0f3b5e]" size={24} />
					<h2 id="detalle-tx-titulo" class="text-lg font-bold text-[#0f3b5e]">Detalle de Transacción</h2>
				</div>
				<button type="button" onclick={onClose} class="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Cerrar"><X size={20} /></button>
			</div>

			<div class="p-4 sm:p-5 space-y-4">
				<div class="rounded-xl bg-slate-50 border border-slate-100 p-4 flex flex-col sm:flex-row sm:items-center gap-4">
					<div class="flex-1 min-w-0">
						<p class="flex items-center gap-2 font-semibold text-emerald-700">
							<CheckCircle2 size={20} class="text-emerald-600" />
							{tipo === 'egreso' ? 'Egreso registrado' : 'Ingreso registrado'}
						</p>
						<p class="mt-1 text-3xl font-bold text-[#0f3b5e]">{formatCurrency(monto)}</p>
						<p class="mt-1 flex items-center gap-1.5 text-sm text-slate-600"><CalendarDays size={15} /> {fechaHora}</p>
					</div>
					<div class="flex flex-col gap-2 sm:w-52">
						<button type="button" onclick={() => compartir('propio')} disabled={!!compartiendo} class="flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-60">
							{#if compartiendo === 'propio'}<Loader2 size={16} class="animate-spin" />{:else}<Share2 size={16} />{/if}
							Compartir
						</button>
						<button type="button" onclick={() => compartir('tercero')} disabled={!!compartiendo} class="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
							{#if compartiendo === 'tercero'}<Loader2 size={16} class="animate-spin" />{:else}<Share2 size={16} />{/if}
							{tercero === 'proveedor' ? 'Compartir a proveedor' : 'Compartir a cliente'}
						</button>
					</div>
				</div>

				<div>
					<h3 class="mb-2 font-semibold text-[#0f3b5e]">Captura de la transacción</h3>
					<div class="flex justify-center rounded-xl bg-slate-50 border border-slate-100 p-3">
						{#if comprobanteUrl && !imagenFallo}
							<img src={toDriveThumbnailUrl(comprobanteUrl, 900)} alt="Comprobante de la transacción" class="max-h-[45dvh] w-auto rounded-lg shadow-sm bg-white" onerror={() => (imagenFallo = true)} />
						{:else}
							<p class="py-8 text-sm text-slate-400">{comprobanteUrl ? 'No se pudo mostrar la vista previa del comprobante.' : 'Esta transacción no tiene comprobante adjunto.'}</p>
						{/if}
					</div>
				</div>

				<div class="flex gap-3 rounded-xl bg-blue-50 border border-blue-100 p-4">
					<Info size={20} class="shrink-0 text-blue-600 mt-0.5" />
					<p class="text-sm text-slate-700 whitespace-pre-line">{mensaje}</p>
				</div>
			</div>
		</div>
	</div>
{/if}
