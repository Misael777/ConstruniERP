<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { supabase } from '$lib/supabaseClient';
	import { uploadProjectDocument } from '$lib/shared/uploadProjectDocument';
	import { describeError } from '$lib/shared/describeError';
	import DocumentPreviewModal from '$lib/shared/components/DocumentPreviewModal.svelte';

	interface ProyectoRef {
		id_proyecto: number | string;
		nombre_proyecto: string;
		contrato?: string | null;
		estado_proyecto?: string | null;
	}

	interface ProformaDoc {
		id_documento: number;
		nombre: string;
		storage_url: string | null;
		file_size: number | null;
		created_at: string;
		es_proforma_final: boolean;
	}

	let {
		open = false,
		proyecto = null,
		onClose = () => {},
		onUpdated = () => {}
	}: {
		open?: boolean;
		proyecto?: ProyectoRef | null;
		onClose?: () => void;
		onUpdated?: () => void;
	} = $props();

	let proformas = $state<ProformaDoc[]>([]);
	let isLoadingProformas = $state(false);
	let selectedFinalId = $state<number | null>(null);

	let localContratoUrl = $state<string | null>(null);
	let localEstado = $state<string>('activo');

	let isUploadingProforma = $state(false);
	let isUploadingContrato = $state(false);
	let isClosing = $state(false);
	let actionError = $state('');

	let previewOpen = $state(false);
	let previewUrl = $state('');
	let previewTitle = $state('');

	// Recarga todo cada vez que se abre el modal para un proyecto — evita mostrar datos obsoletos
	// si la venta cambió desde otra pestaña/sesión.
	$effect(() => {
		if (open && proyecto) {
			actionError = '';
			localContratoUrl = proyecto.contrato || null;
			localEstado = proyecto.estado_proyecto || 'activo';
			loadProformas();
		}
	});

	async function loadProformas() {
		if (!proyecto) return;
		isLoadingProformas = true;
		try {
			const { data, error } = await supabase
				.from('documento_proyecto')
				.select('id_documento,nombre,storage_url,file_size,created_at,es_proforma_final')
				.eq('id_proyecto', proyecto.id_proyecto)
				.eq('tipo_documento', 'Proforma')
				.order('created_at', { ascending: false });

			if (error) throw error;
			proformas = (data || []) as ProformaDoc[];
			selectedFinalId = proformas.find((p) => p.es_proforma_final)?.id_documento ?? null;
		} catch (err) {
			console.error('[ProformasVentaModal] Error cargando proformas:', err);
			actionError = `No se pudieron cargar las proformas. ${describeError(err)}`;
		} finally {
			isLoadingProformas = false;
		}
	}

	function fmtSize(b: number | null): string {
		if (!b) return '';
		if (b < 1024) return `${b} B`;
		if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
		return `${(b / (1024 * 1024)).toFixed(1)} MB`;
	}

	function fmtDate(d: string | null | undefined): string {
		if (!d) return '—';
		return new Date(d).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
	}

	async function handleAddProformaFile(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		(event.currentTarget as HTMLInputElement).value = '';
		if (!file || !proyecto) return;

		isUploadingProforma = true;
		actionError = '';
		try {
			const { url } = await uploadProjectDocument(file, {
				type: 'proforma',
				projectId: proyecto.id_proyecto,
				projectName: proyecto.nombre_proyecto
			});

			const { error } = await supabase.from('documento_proyecto').insert({
				id_proyecto: Number(proyecto.id_proyecto),
				nombre: file.name.replace(/\.[^.]+$/, ''),
				tipo_documento: 'Proforma',
				estado: 'borrador',
				es_proforma_final: false,
				storage_url: url,
				file_size: file.size,
				file_type: file.type
			});

			if (error) throw error;
			await loadProformas();
			onUpdated();
		} catch (err) {
			console.error('[ProformasVentaModal] Error subiendo proforma:', err);
			actionError = `No se pudo subir la proforma. ${describeError(err)}`;
		} finally {
			isUploadingProforma = false;
		}
	}

	async function handleEliminarProforma(doc: ProformaDoc) {
		if (!confirm(`¿Eliminar la proforma "${doc.nombre}"? Esta acción no se puede deshacer.`)) return;
		try {
			const { error } = await supabase.from('documento_proyecto').delete().eq('id_documento', doc.id_documento);
			if (error) throw error;
			if (selectedFinalId === doc.id_documento) selectedFinalId = null;
			await loadProformas();
			onUpdated();
		} catch (err) {
			console.error('[ProformasVentaModal] Error eliminando proforma:', err);
			actionError = `No se pudo eliminar la proforma. ${describeError(err)}`;
		}
	}

	function handleVerProforma(doc: ProformaDoc) {
		if (!doc.storage_url) return;
		previewUrl = doc.storage_url;
		previewTitle = doc.nombre;
		previewOpen = true;
	}

	function handleVerContrato() {
		if (!localContratoUrl) return;
		previewUrl = localContratoUrl;
		previewTitle = `Contrato - ${proyecto?.nombre_proyecto ?? ''}`;
		previewOpen = true;
	}

	async function handleContratoFile(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		(event.currentTarget as HTMLInputElement).value = '';
		if (!file || !proyecto) return;

		isUploadingContrato = true;
		actionError = '';
		try {
			const { url } = await uploadProjectDocument(file, {
				type: 'contrato',
				projectId: proyecto.id_proyecto,
				projectName: proyecto.nombre_proyecto
			});
			localContratoUrl = url;
			onUpdated();
		} catch (err) {
			console.error('[ProformasVentaModal] Error subiendo contrato:', err);
			actionError = `No se pudo subir el contrato. ${describeError(err)}`;
		} finally {
			isUploadingContrato = false;
		}
	}

	let canClose = $derived(localEstado !== 'venta_cerrada' && !!localContratoUrl && selectedFinalId !== null);

	async function handleCerrarVenta() {
		if (!canClose || !proyecto || selectedFinalId === null) return;
		isClosing = true;
		actionError = '';
		try {
			const { error: clearError } = await supabase
				.from('documento_proyecto')
				.update({ es_proforma_final: false })
				.eq('id_proyecto', proyecto.id_proyecto)
				.eq('es_proforma_final', true);
			if (clearError) throw clearError;

			const { error: setError } = await supabase
				.from('documento_proyecto')
				.update({ es_proforma_final: true })
				.eq('id_documento', selectedFinalId);
			if (setError) throw setError;

			const { error: closeError } = await supabase
				.from('proyecto')
				.update({ estado_proyecto: 'venta_cerrada' })
				.eq('id_proyecto', proyecto.id_proyecto);
			if (closeError) throw closeError;

			localEstado = 'venta_cerrada';
			await loadProformas();
			onUpdated();
		} catch (err) {
			console.error('[ProformasVentaModal] Error cerrando venta:', err);
			alert(`No se pudo cerrar la venta.\n${describeError(err)}`);
		} finally {
			isClosing = false;
		}
	}
</script>

{#if open && proyecto}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4 overflow-y-auto" transition:fade={{ duration: 200 }}>
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8 relative" transition:scale={{ duration: 300, start: 0.95 }}>
			<!-- Header -->
			<div class="flex items-center justify-between p-6 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl z-10">
				<div>
					<h2 class="text-xl font-bold text-slate-800">Proformas y cierre de venta</h2>
					<p class="text-sm text-slate-500 mt-0.5">{proyecto.nombre_proyecto}</p>
				</div>
				<button onclick={onClose} aria-label="Cerrar modal" class="text-slate-400 hover:text-slate-600 transition-colors p-2 rounded-full hover:bg-slate-100">
					<i class="fas fa-times text-lg"></i>
				</button>
			</div>

			<div class="p-6 space-y-6 overflow-y-auto max-h-[calc(100vh-260px)]">
				{#if actionError}
					<div class="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm flex items-start gap-2">
						<i class="fas fa-exclamation-circle mt-0.5 shrink-0"></i>
						<span>{actionError}</span>
					</div>
				{/if}

				{#if localEstado === 'venta_cerrada'}
					<div class="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm flex items-center gap-2">
						<i class="fas fa-check-circle"></i>
						<span class="font-semibold">Venta cerrada</span>
					</div>
				{/if}

				<!-- Proformas -->
				<section>
					<div class="flex items-center justify-between mb-3">
						<h3 class="text-sm font-bold text-slate-800 flex items-center gap-2">
							<div class="w-1.5 h-4 bg-blue-600 rounded-full"></div>
							Proformas
						</h3>
						{#if localEstado !== 'venta_cerrada'}
							<label class="cursor-pointer px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 transition-colors">
								<input type="file" accept="application/pdf" class="hidden" onchange={handleAddProformaFile} disabled={isUploadingProforma} />
								{#if isUploadingProforma}
									<i class="fas fa-spinner fa-spin"></i> Subiendo...
								{:else}
									<i class="fas fa-plus"></i> Agregar proforma
								{/if}
							</label>
						{/if}
					</div>

					{#if isLoadingProformas}
						<div class="text-center py-6 text-slate-400 text-sm">
							<i class="fas fa-spinner fa-spin"></i> Cargando proformas...
						</div>
					{:else if proformas.length === 0}
						<div class="text-center py-6 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-sm">
							Aún no se ha adjuntado ninguna proforma.
						</div>
					{:else}
						<div class="space-y-2">
							{#each proformas as doc (doc.id_documento)}
								<div class="flex items-center gap-3 p-3 border border-slate-200 rounded-xl">
									{#if localEstado !== 'venta_cerrada'}
										<input
											type="radio"
											name="proforma-final"
											checked={selectedFinalId === doc.id_documento}
											onchange={() => (selectedFinalId = doc.id_documento)}
											class="shrink-0 accent-blue-600"
											aria-label="Marcar como proforma final"
										/>
									{:else if doc.es_proforma_final}
										<i class="fas fa-check-circle text-emerald-500 shrink-0" title="Proforma final"></i>
									{:else}
										<span class="w-4 shrink-0"></span>
									{/if}
									<i class="far fa-file-pdf text-rose-500 shrink-0"></i>
									<div class="min-w-0 flex-1">
										<p class="text-sm font-medium text-slate-700 truncate">{doc.nombre}</p>
										<p class="text-[11px] text-slate-400">{fmtDate(doc.created_at)} · {fmtSize(doc.file_size)}</p>
									</div>
									{#if doc.es_proforma_final}
										<span class="shrink-0 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-[10px] font-bold border border-emerald-200">Final</span>
									{/if}
									<button onclick={() => handleVerProforma(doc)} class="shrink-0 text-slate-400 hover:text-blue-600 p-1.5 rounded transition-colors" title="Ver" aria-label="Ver proforma">
										<i class="fas fa-eye"></i>
									</button>
									{#if localEstado !== 'venta_cerrada'}
										<button onclick={() => handleEliminarProforma(doc)} class="shrink-0 text-slate-400 hover:text-rose-600 p-1.5 rounded transition-colors" title="Eliminar" aria-label="Eliminar proforma">
											<i class="fas fa-trash-alt"></i>
										</button>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</section>

				<!-- Contrato -->
				<section class="border-t border-slate-100 pt-5">
					<h3 class="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
						<div class="w-1.5 h-4 bg-orange-500 rounded-full"></div>
						Contrato
					</h3>
					{#if localContratoUrl}
						<div class="flex items-center gap-3 p-3 border border-slate-200 rounded-xl">
							<i class="far fa-file-pdf text-rose-500 shrink-0"></i>
							<p class="text-sm font-medium text-slate-700 flex-1">Contrato adjunto</p>
							<button onclick={handleVerContrato} class="shrink-0 text-slate-400 hover:text-blue-600 p-1.5 rounded transition-colors" title="Ver" aria-label="Ver contrato">
								<i class="fas fa-eye"></i>
							</button>
						</div>
					{:else}
						<label class="cursor-pointer px-3 py-2 border border-dashed border-slate-300 rounded-xl text-sm text-slate-500 hover:bg-slate-50 flex items-center justify-center gap-2 transition-colors">
							<input type="file" accept="application/pdf" class="hidden" onchange={handleContratoFile} disabled={isUploadingContrato} />
							{#if isUploadingContrato}
								<i class="fas fa-spinner fa-spin"></i> Subiendo contrato...
							{:else}
								<i class="fas fa-cloud-upload-alt"></i> Adjuntar contrato
							{/if}
						</label>
					{/if}
				</section>
			</div>

			<!-- Footer -->
			<div class="p-6 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex justify-end gap-3">
				<button onclick={onClose} class="px-5 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 hover:text-slate-800 font-medium text-sm transition-colors shadow-sm">
					Cerrar
				</button>
				{#if localEstado !== 'venta_cerrada'}
					<button
						onclick={handleCerrarVenta}
						disabled={!canClose || isClosing}
						title={!canClose ? 'Sube el contrato y marca una proforma como final para poder cerrar la venta' : ''}
						class="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-medium text-sm shadow-md shadow-blue-600/20 active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{#if isClosing}
							<i class="fas fa-spinner fa-spin"></i> Cerrando...
						{:else}
							<i class="fas fa-lock"></i> Cerrar venta
						{/if}
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<DocumentPreviewModal open={previewOpen} url={previewUrl} title={previewTitle} onClose={() => (previewOpen = false)} />
