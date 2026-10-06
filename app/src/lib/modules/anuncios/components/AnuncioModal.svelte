<script lang="ts">
	/**
	 * Popup "Nuevo Anuncio"/"Editar Anuncio" — solo lo abre un admin desde la landing de Dashboard (ver
	 * +page.svelte). Imagen opcional, misma rama Tauri/web de subida a Drive que el resto del ERP (ver
	 * subirArchivo en TransaccionModal.svelte) — folder 'documento' (no hay uno dedicado a anuncios).
	 */
	import { X, Loader2, ImagePlus, Trash2 } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { isRunningInTauri, uploadToDriveClient, deleteDriveFileClient } from '$lib/driveUploadClient';
	import { extractDriveFileId } from '$lib/shared/uploadProjectDocument';
	import { toDriveThumbnailUrl } from '$lib/shared/drivePreview';
	import { resolveApiUrl, parseJsonResponse } from '$lib/apiClient';
	import type { Anuncio, AnuncioPayload } from '$lib/modules/anuncios/services/anuncios.service';

	let {
		open = false,
		mode = 'create',
		anuncio = null,
		generando = false,
		onCancel,
		onGuardar
	}: {
		open?: boolean;
		mode?: 'create' | 'edit';
		anuncio?: Anuncio | null;
		generando?: boolean;
		onCancel: () => void;
		onGuardar: (payload: AnuncioPayload) => void | Promise<void>;
	} = $props();

	const MAX_CONTENIDO = 2000;
	const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB, mismo tope que el resto de adjuntos del ERP

	let titulo = $state('');
	let contenido = $state('');
	let fechaPublicacion = $state('');
	let imagenUrl = $state<string | null>(null);
	let imagenFile = $state<File | null>(null);
	let imagenPreviewUrl = $state<string | null>(null);
	let subiendoImagen = $state(false);
	let errores = $state<Record<string, string>>({});

	const title = $derived(mode === 'create' ? 'Nuevo Anuncio' : 'Editar Anuncio');
	// Ticket #61: la imagen ya guardada se muestra por la miniatura de Drive (la URL de descarga no se puede incrustar).
	const imagenMostrada = $derived(imagenPreviewUrl ?? (imagenUrl ? toDriveThumbnailUrl(imagenUrl, 1600) : null));

	let abiertoAnterior = false;
	$effect(() => {
		if (open && !abiertoAnterior) {
			titulo = anuncio?.titulo ?? '';
			contenido = anuncio?.contenido ?? '';
			fechaPublicacion = anuncio?.fecha_publicacion ?? new Date().toISOString().slice(0, 10);
			imagenUrl = anuncio?.imagen_url ?? null;
			imagenFile = null;
			imagenPreviewUrl = null;
			errores = {};
		}
		abiertoAnterior = open;
	});

	function onImagenChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		(e.target as HTMLInputElement).value = '';
		if (!file) return;
		if (file.size > MAX_FILE_SIZE) {
			toast.error('La imagen supera el máximo de 5MB.');
			return;
		}
		imagenFile = file;
		if (imagenPreviewUrl) URL.revokeObjectURL(imagenPreviewUrl);
		imagenPreviewUrl = URL.createObjectURL(file);
	}

	function quitarImagen() {
		imagenFile = null;
		imagenUrl = null;
		if (imagenPreviewUrl) URL.revokeObjectURL(imagenPreviewUrl);
		imagenPreviewUrl = null;
	}

	function fileExt(name: string): string {
		return name.includes('.') ? `.${name.split('.').pop()}` : '';
	}

	/** Misma rama Tauri/web que subirArchivo en TransaccionModal.svelte — ver ese archivo para el
	 * criterio completo (folder 'documento' por no haber uno dedicado a anuncios todavía). */
	async function subirImagen(file: File): Promise<string> {
		const fileName = `anuncio-${Date.now()}${fileExt(file.name)}`;
		if (isRunningInTauri()) {
			const { url } = await uploadToDriveClient(file, fileName, 'documento');
			return url;
		}
		const formData = new FormData();
		formData.append('file', file);
		formData.append('type', 'documento');
		formData.append('fileName', fileName.replace(fileExt(file.name), ''));
		const response = await fetch(resolveApiUrl('/api/upload-document'), { method: 'POST', body: formData });
		const result = await parseJsonResponse(response);
		if (!response.ok || !result.success) {
			throw new Error(result.details || result.error || 'Error al subir la imagen.');
		}
		return result.url as string;
	}

	function validar(): boolean {
		const errs: Record<string, string> = {};
		if (!titulo.trim()) errs.titulo = 'Requerido.';
		if (!contenido.trim()) errs.contenido = 'Requerido.';
		if (!fechaPublicacion) errs.fecha_publicacion = 'Requerido.';
		errores = errs;
		return Object.keys(errs).length === 0;
	}

	async function handleGuardar() {
		if (!validar()) {
			toast.error('Completa los campos requeridos.');
			return;
		}
		subiendoImagen = !!imagenFile;
		try {
			let finalImagenUrl = imagenUrl;
			if (imagenFile) {
				finalImagenUrl = await subirImagen(imagenFile);
				// Reemplaza una imagen anterior — mejor esfuerzo, no bloquea si falla el borrado.
				if (mode === 'edit' && anuncio?.imagen_url) {
					const oldFileId = extractDriveFileId(anuncio.imagen_url);
					if (oldFileId) await deleteDriveFileClient(oldFileId).catch(() => {});
				}
			} else if (mode === 'edit' && anuncio?.imagen_url && !imagenUrl) {
				// El usuario quitó la imagen sin reemplazarla — se borra la vieja de Drive también.
				const oldFileId = extractDriveFileId(anuncio.imagen_url);
				if (oldFileId) await deleteDriveFileClient(oldFileId).catch(() => {});
			}

			await onGuardar({
				titulo: titulo.trim(),
				contenido: contenido.trim(),
				imagen_url: finalImagenUrl,
				fecha_publicacion: fechaPublicacion
			});
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudo subir la imagen del anuncio.');
		} finally {
			subiendoImagen = false;
		}
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
			<div class="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
				<h2 class="text-base font-bold text-[#0f3b5e]">{title}</h2>
				<button type="button" onclick={onCancel} class="text-slate-400 hover:text-slate-600" aria-label="Cerrar">
					<X size={20} />
				</button>
			</div>

			<div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
				<div>
					<label class="block text-sm font-bold text-[#0f3b5e] mb-1" for="an-titulo">
						Título <span class="text-red-500">*</span>
					</label>
					<input
						id="an-titulo"
						type="text"
						bind:value={titulo}
						placeholder="Ej. Nuevo horario de atención"
						class={`w-full rounded-lg border px-3 py-2 text-sm ${errores.titulo ? 'border-red-400' : 'border-slate-300'}`}
					/>
					{#if errores.titulo}<p class="text-xs text-red-600 mt-1">{errores.titulo}</p>{/if}
				</div>

				<div>
					<label class="block text-sm font-bold text-[#0f3b5e] mb-1" for="an-fecha">
						Fecha de publicación <span class="text-red-500">*</span>
					</label>
					<input
						id="an-fecha"
						type="date"
						bind:value={fechaPublicacion}
						class={`w-full rounded-lg border px-3 py-2 text-sm ${errores.fecha_publicacion ? 'border-red-400' : 'border-slate-300'}`}
					/>
					{#if errores.fecha_publicacion}<p class="text-xs text-red-600 mt-1">{errores.fecha_publicacion}</p>{/if}
				</div>

				<div>
					<label class="block text-sm font-bold text-[#0f3b5e] mb-1" for="an-contenido">
						Contenido <span class="text-red-500">*</span>
					</label>
					<textarea
						id="an-contenido"
						rows="5"
						maxlength={MAX_CONTENIDO}
						bind:value={contenido}
						placeholder="Escribe el anuncio..."
						class={`w-full rounded-lg border px-3 py-2 text-sm resize-none ${errores.contenido ? 'border-red-400' : 'border-slate-300'}`}
					></textarea>
					<div class="flex items-center justify-between mt-1">
						{#if errores.contenido}<p class="text-xs text-red-600">{errores.contenido}</p>{:else}<span></span>{/if}
						<span class="text-xs text-slate-400">{contenido.length}/{MAX_CONTENIDO}</span>
					</div>
				</div>

				<div>
					<span class="block text-sm font-bold text-[#0f3b5e] mb-1">Imagen (opcional)</span>
					{#if imagenMostrada}
						<div class="relative w-full h-36 rounded-lg border border-slate-200 overflow-hidden group">
							<img src={imagenMostrada} alt="Vista previa del anuncio" class="w-full h-full object-cover" />
							<button
								type="button"
								onclick={quitarImagen}
								class="absolute top-2 right-2 p-1.5 rounded-full bg-white/90 text-red-600 hover:bg-white shadow"
								aria-label="Quitar imagen"
								title="Quitar imagen"
							>
								<Trash2 size={14} />
							</button>
						</div>
					{:else}
						<label
							for="an-imagen"
							class="flex flex-col items-center justify-center gap-1.5 w-full h-24 rounded-lg border-2 border-dashed border-slate-300 text-slate-400 cursor-pointer hover:border-blue-300 hover:text-blue-500"
						>
							<ImagePlus size={20} />
							<span class="text-xs">Arrastra o selecciona una imagen</span>
						</label>
						<input id="an-imagen" type="file" accept="image/*" class="hidden" onchange={onImagenChange} />
					{/if}
				</div>
			</div>

			<div class="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-200 shrink-0">
				<button
					type="button"
					onclick={onCancel}
					disabled={generando || subiendoImagen}
					class="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
				>
					Cancelar
				</button>
				<button
					type="button"
					onclick={handleGuardar}
					disabled={generando || subiendoImagen}
					class="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
				>
					{#if generando || subiendoImagen}<Loader2 size={16} class="animate-spin" />{/if}
					{mode === 'create' ? 'Publicar' : 'Guardar cambios'}
				</button>
			</div>
		</div>
	</div>
{/if}
