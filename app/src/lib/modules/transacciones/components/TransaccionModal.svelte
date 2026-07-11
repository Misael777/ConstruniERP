<script lang="ts">
	import { supabase } from '$lib/supabaseClient';
	import { X, Loader2, Paperclip, ShieldCheck, ShieldOff } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { validatePayload, applyFieldMask, formatCurrency, type FieldOption } from '$lib/shared/fieldConfig';
	import { FIELDS_CONFIG } from '$lib/modules/transacciones/config/transaccion.config';
	import { createTransaccion, updateTransaccion, aprobarTransaccion, desaprobarTransaccion } from '$lib/modules/transacciones/services/transacciones.service';
	import type { Transaccion } from '$lib/modules/transacciones/services/transacciones.service';
	import { permisosState, isAdmin } from '$lib/stores/permisos.svelte';
	import { resolveApiUrl, parseJsonResponse } from '$lib/apiClient';
	import { isRunningInTauri, uploadToDriveClient, renameDriveFileClient, deleteDriveFileClient } from '$lib/driveUploadClient';

	let {
		open = false,
		mode = 'create',
		transaccion = null,
		dynamicOptions = {},
		onClose,
		onSaved,
		onConfirm = null,
		confirmTitle = null,
		confirmButtonLabel = null
	}: {
		open: boolean;
		mode: 'create' | 'edit';
		transaccion: Transaccion | null;
		dynamicOptions?: Record<string, FieldOption[]>;
		onClose: () => void;
		onSaved: () => void;
		/** Cuando se pasa, reemplaza el alta/edición normal: se usa para el flujo "confirmar cobro/pago"
		 * (ver +page.svelte de cuentas-cobrar/cuentas-pagar) donde esta transacción es la prueba
		 * obligatoria de un cobro/pago que recién pasa a 'cobrado'/'pagado' — crearla aquí Y enlazarla
		 * es una sola operación atómica en el backend (confirmarCobroCobrado/confirmarPagoPagado). */
		onConfirm?: ((payload: Record<string, unknown>) => Promise<{ success: boolean; message: string; errors?: Record<string, string>; data?: any }>) | null;
		confirmTitle?: string | null;
		confirmButtonLabel?: string | null;
	} = $props();

	const formFields = FIELDS_CONFIG.filter((f) => f.showInForm);

	function buildInitialValues(): Record<string, string> {
		const values: Record<string, string> = {};
		for (const field of formFields) {
			const raw = transaccion ? (transaccion as any)[field.key] : '';
			values[field.key] = raw === null || raw === undefined ? '' : String(raw);
		}
		return values;
	}

	let formValues = $state<Record<string, string>>(buildInitialValues());
	let fieldErrors = $state<Record<string, string>>({});
	let submitting = $state(false);
	let aprobando = $state(false);

	// Bloquea edición/borrado (todo el form, no solo el comprobante) una vez que un administrador
	// aprobó el comprobante — solo otro administrador puede seguir editando. Ver aprobarTransaccion/
	// desaprobarTransaccion y BLOQUEADO_POR_APROBACION en transacciones.service.ts.
	const bloqueadaPorAprobacion = $derived(mode === 'edit' && !!transaccion?.aprobado && !isAdmin());

	// Comprobante (imagen/PDF) — obligatorio en toda transacción, ver createTransaccion/updateTransaccion.
	// comprobanteUrl arranca con la de la transacción si se está editando una que ya tenía una subida;
	// si el usuario elige un archivo nuevo, ese reemplaza a la anterior recién al confirmar el envío.
	let comprobanteFile = $state<File | null>(null);
	let comprobanteUrl = $state<string | null>(null);
	let comprobanteError = $state('');
	let uploadingComprobante = $state(false);
	let localPreviewUrl = $state<string | null>(null);

	$effect(() => {
		if (open) {
			formValues = buildInitialValues();
			fieldErrors = {};
			comprobanteFile = null;
			comprobanteUrl = transaccion?.comprobante_url ?? null;
			comprobanteError = '';
		}
	});

	// Vista previa local instantánea (antes de subir) cuando el archivo elegido es una imagen.
	$effect(() => {
		if (comprobanteFile && comprobanteFile.type.startsWith('image/')) {
			const url = URL.createObjectURL(comprobanteFile);
			localPreviewUrl = url;
			return () => URL.revokeObjectURL(url);
		}
		localPreviewUrl = null;
	});

	function onComprobanteChange(e: Event) {
		comprobanteFile = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
		if (comprobanteFile) comprobanteError = '';
	}

	function fileExt(name: string): string {
		return name.includes('.') ? `.${name.split('.').pop()}` : '';
	}

	/** Extrae el fileId de Drive de una URL `https://drive.google.com/uc?export=download&id=FILEID`
	 * (formato que usan uploadToDrive/uploadToDriveClient) — para poder renombrar/borrar ese archivo. */
	function extractDriveFileId(url: string | null): string | null {
		if (!url) return null;
		const match = url.match(/[?&]id=([^&]+)/);
		return match ? match[1] : null;
	}

	/**
	 * Sube el comprobante a Google Drive con el nombre `baseName` (código de la transacción cuando ya
	 * se conoce — edición; un nombre temporal si es una transacción nueva, ver handleSubmit) — misma
	 * rama Tauri/web que usan proforma/contrato en NuevaVentaModal.svelte y documentos de proyecto en
	 * DocumentosTab.svelte.
	 */
	async function uploadComprobante(file: File, baseName: string): Promise<{ url: string; fileId: string }> {
		const fileName = `${baseName}${fileExt(file.name)}`;
		if (isRunningInTauri()) {
			return await uploadToDriveClient(file, fileName, 'comprobante');
		}

		const formData = new FormData();
		formData.append('file', file);
		formData.append('type', 'comprobante');
		formData.append('fileName', baseName);

		const response = await fetch(resolveApiUrl('/api/upload-document'), { method: 'POST', body: formData });
		const result = await parseJsonResponse(response);
		if (!response.ok || !result.success) {
			throw new Error(result.error || 'Error al subir el comprobante.');
		}
		return { url: result.url as string, fileId: result.fileId as string };
	}

	/** Renombra el comprobante recién subido a su nombre definitivo (código = id_transaccion, solo se
	 * conoce después de crear la transacción) — mejor esfuerzo, no bloquea el guardado si falla. */
	async function renameComprobante(fileId: string, newName: string): Promise<void> {
		if (isRunningInTauri()) {
			await renameDriveFileClient(fileId, newName);
			return;
		}
		const response = await fetch(resolveApiUrl('/api/upload-document'), {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ fileId, newName })
		});
		await parseJsonResponse(response);
	}

	/** Borra el comprobante anterior al reemplazarlo por uno nuevo, para no dejar duplicados en Drive —
	 * mejor esfuerzo, no bloquea el guardado si falla. */
	async function deleteComprobante(fileId: string): Promise<void> {
		if (isRunningInTauri()) {
			await deleteDriveFileClient(fileId);
			return;
		}
		const response = await fetch(resolveApiUrl('/api/upload-document'), {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ fileId })
		});
		await parseJsonResponse(response);
	}

	async function handleAprobar() {
		if (!transaccion) return;
		aprobando = true;
		try {
			const result = await aprobarTransaccion(supabase, transaccion.id_transaccion, permisosState.userName || null, isAdmin());
			if (result.success) {
				toast.success(result.message);
				onSaved();
				onClose();
			} else {
				toast.error(result.message);
			}
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		} finally {
			aprobando = false;
		}
	}

	async function handleDesaprobar() {
		if (!transaccion) return;
		if (!confirm('¿Quitar la aprobación de este comprobante? Volverá a poder editarse/eliminarse normalmente.')) return;
		aprobando = true;
		try {
			const result = await desaprobarTransaccion(supabase, transaccion.id_transaccion, isAdmin());
			if (result.success) {
				toast.success(result.message);
				onSaved();
				onClose();
			} else {
				toast.error(result.message);
			}
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		} finally {
			aprobando = false;
		}
	}

	function formatFecha(value: string | null | undefined): string {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '—';
		return date.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
	}

	function handleInput(key: string, rawValue: string) {
		const field = formFields.find((f) => f.key === key)!;
		const masked = applyFieldMask(field, rawValue);
		formValues = { ...formValues, [key]: masked };
		// Categoría depende de Tipo (ver optionsWhen en transaccion.config.ts) — si cambia Tipo, la
		// categoría elegida antes puede ya no ser válida, así que se limpia para que el usuario elija
		// de nuevo entre las opciones correctas en vez de dejar guardado un valor incoherente.
		if (key === 'tipo') formValues.categoria = '';
		revalidate();
	}

	function revalidate() {
		fieldErrors = validatePayload(FIELDS_CONFIG, formValues);
	}

	const hasErrors = $derived(Object.keys(fieldErrors).length > 0);
	const title = $derived(confirmTitle ?? (mode === 'create' ? 'Nueva Transacción' : 'Editar Transacción'));

	const modalWidthClass = $derived(formFields.length <= 4 ? 'max-w-md' : formFields.length <= 8 ? 'max-w-2xl' : 'max-w-4xl');
	const gridColsClass = $derived(formFields.length <= 4 ? 'grid-cols-1' : formFields.length <= 8 ? 'grid-cols-2' : 'grid-cols-3');

	function optionsFor(field: (typeof formFields)[number]): FieldOption[] {
		if (field.optionsWhen) return field.optionsWhen(formValues);
		return (field.optionsSource && dynamicOptions[field.key]) || field.options || [];
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (bloqueadaPorAprobacion) {
			toast.error('No se puede modificar: el comprobante ya fue aprobado. Solo un administrador puede hacerlo.');
			return;
		}
		revalidate();
		if (hasErrors) return;

		if (!comprobanteFile && !comprobanteUrl) {
			comprobanteError = 'Debes adjuntar el comprobante (imagen o PDF) de esta transacción.';
			return;
		}

		submitting = true;
		try {
			let finalComprobanteUrl = comprobanteUrl;
			let uploadedFileId: string | null = null;
			let oldFileIdToDelete: string | null = null;

			if (comprobanteFile) {
				uploadingComprobante = true;
				try {
					// Edición: ya se conoce el código (id_transaccion) -> nombre definitivo desde ya, y se
					// marca la foto anterior (si había) para borrarla al terminar. Alta nueva: nombre
					// temporal, se renombra a su código definitivo abajo una vez insertada la fila.
					const baseName =
						mode === 'edit' && transaccion ? `comprobante-${transaccion.id_transaccion}` : `comprobante-temp-${Date.now()}`;
					const uploaded = await uploadComprobante(comprobanteFile, baseName);
					finalComprobanteUrl = uploaded.url;
					uploadedFileId = uploaded.fileId;
					if (mode === 'edit' && transaccion?.comprobante_url) {
						oldFileIdToDelete = extractDriveFileId(transaccion.comprobante_url);
					}
				} finally {
					uploadingComprobante = false;
				}
			}
			const payload = { ...formValues, comprobante_url: finalComprobanteUrl };

			let result;
			if (onConfirm) {
				result = await onConfirm(payload);
			} else if (mode === 'edit' && transaccion) {
				result = await updateTransaccion(supabase, transaccion.id_transaccion, payload, isAdmin());
			} else {
				const { data: userData } = await supabase.auth.getUser();
				result = await createTransaccion(supabase, payload, userData?.user?.email ?? null, permisosState.userName || null);
			}

			if (result.success) {
				// Housekeeping en Drive — mejor esfuerzo: si algo de esto falla no se muestra como error,
				// el guardado ya se completó correctamente (ver renameComprobante/deleteComprobante).
				try {
					const idNuevo = (result.data as any)?.id_transaccion;
					if (uploadedFileId && mode !== 'edit' && idNuevo) {
						await renameComprobante(uploadedFileId, `comprobante-${idNuevo}${fileExt(comprobanteFile!.name)}`);
					}
					if (oldFileIdToDelete && oldFileIdToDelete !== uploadedFileId) {
						await deleteComprobante(oldFileIdToDelete);
					}
				} catch (housekeepingErr) {
					console.warn('[TransaccionModal] No se pudo renombrar/limpiar el comprobante en Drive:', housekeepingErr);
				}

				toast.success(result.message ?? 'Operación realizada con éxito');
				onSaved();
				onClose();
			} else {
				toast.error(result.message ?? 'Ocurrió un error al guardar');
				if (result.errors) fieldErrors = { ...fieldErrors, ...result.errors };
			}
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		} finally {
			submitting = false;
		}
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
		<div class={`bg-white rounded-2xl shadow-2xl w-full ${modalWidthClass} max-h-[90vh] overflow-y-auto`}>
			<div class="sticky top-0 flex items-center justify-between bg-white px-6 py-4 border-b border-slate-200 z-10">
				<h2 class="text-lg font-semibold text-[#0f3b5e]">{title}</h2>
				<button type="button" onclick={onClose} class="p-1 hover:bg-slate-100 rounded-full text-slate-500" aria-label="Cerrar">
					<X size={20} />
				</button>
			</div>

			<form onsubmit={handleSubmit}>
				<div class={`p-6 grid ${gridColsClass} gap-4`}>
					{#if mode === 'edit' && transaccion}
						<div class="col-span-full">
							{#if transaccion.aprobado}
								<div class="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 flex items-center justify-between gap-3 flex-wrap">
									<span class="flex items-center gap-1.5">
										<ShieldCheck size={16} class="shrink-0" />
										Comprobante aprobado por {transaccion.aprobado_por ?? 'un administrador'} el {formatFecha(transaccion.aprobado_en)}.
										{#if !isAdmin()}Solo un administrador puede modificar o eliminar esta transacción ahora.{/if}
									</span>
									{#if isAdmin()}
										<button type="button" onclick={handleDesaprobar} disabled={aprobando} class="shrink-0 flex items-center gap-1 text-emerald-700 hover:text-emerald-900 underline disabled:opacity-50">
											<ShieldOff size={14} /> Quitar aprobación
										</button>
									{/if}
								</div>
							{:else if isAdmin()}
								<button
									type="button"
									onclick={handleAprobar}
									disabled={aprobando}
									class="w-full py-2 rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
								>
									<ShieldCheck size={16} />
									{aprobando ? 'Aprobando…' : 'Aprobar comprobante'}
								</button>
							{/if}
						</div>
					{/if}

					{#each formFields as field (field.key)}
						<div>
							<label for={`tr-${field.key}`} class="block text-sm font-bold text-slate-700 mb-1">
								{field.label}
								{#if field.required}<span class="text-red-500">*</span>{/if}
							</label>

							{#if field.tipo === 'select' || field.options}
								<select
									id={`tr-${field.key}`}
									name={field.key}
									value={formValues[field.key]}
									disabled={bloqueadaPorAprobacion}
									onchange={(e) => handleInput(field.key, (e.target as HTMLSelectElement).value)}
									class={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:opacity-60 disabled:bg-slate-50 ${fieldErrors[field.key] ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
								>
									<option value="" disabled>Selecciona una opción</option>
									{#each optionsFor(field) as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							{:else}
								<input
									id={`tr-${field.key}`}
									name={field.key}
									type={field.tipo === 'number' ? 'number' : field.tipo === 'date' ? 'date' : 'text'}
									inputmode={field.tipo === 'currency' ? 'decimal' : undefined}
									step={field.tipo === 'number' ? 'any' : undefined}
									value={formValues[field.key]}
									maxlength={field.maxLength}
									placeholder={field.placeholder}
									disabled={bloqueadaPorAprobacion}
									oninput={(e) => handleInput(field.key, (e.target as HTMLInputElement).value)}
									class={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:opacity-60 disabled:bg-slate-50 ${fieldErrors[field.key] ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
								/>
							{/if}

							{#if field.tipo === 'currency' && formValues[field.key] && !fieldErrors[field.key]}
								<p class="mt-1 text-xs text-slate-500">{formatCurrency(formValues[field.key])}</p>
							{/if}

							{#if fieldErrors[field.key]}
								<p class="mt-1 text-xs text-red-600">{fieldErrors[field.key]}</p>
							{:else if field.helpText}
								<p class="mt-1 text-xs text-slate-400">{field.helpText}</p>
							{/if}
						</div>
					{/each}

					<div class="col-span-full">
						<label for="tr-comprobante" class="block text-sm font-bold text-slate-700 mb-1">
							Comprobante <span class="text-red-500">*</span>
						</label>
						<label
							for="tr-comprobante"
							class={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${bloqueadaPorAprobacion ? 'opacity-60 cursor-not-allowed bg-slate-50' : 'cursor-pointer hover:bg-slate-50'} ${comprobanteError ? 'border-red-400' : 'border-slate-300'}`}
						>
							<Paperclip size={16} class="text-slate-400 shrink-0" />
							{#if comprobanteFile}
								<span class="truncate">{comprobanteFile.name}</span>
							{:else if comprobanteUrl}
								<span class="truncate text-emerald-700">Comprobante ya adjuntado — elige un archivo para reemplazarlo</span>
							{:else}
								<span class="text-slate-400">Adjuntar imagen o PDF del comprobante…</span>
							{/if}
						</label>
						<input id="tr-comprobante" type="file" accept="image/*,application/pdf" class="hidden" disabled={bloqueadaPorAprobacion} onchange={onComprobanteChange} />

						<!-- Vista previa: local (recién elegido) o la ya guardada en Drive. Para PDFs (o si
						     falla la carga de la imagen) se muestra el enlace "Ver comprobante" nomás. -->
						{#if localPreviewUrl}
							<img src={localPreviewUrl} alt="Vista previa del comprobante" class="mt-2 w-24 h-24 object-cover rounded-lg border border-slate-200" />
						{:else if comprobanteUrl && !comprobanteFile}
							<div class="mt-2 flex items-center gap-3">
								<img
									src={comprobanteUrl}
									alt="Comprobante"
									class="w-24 h-24 object-cover rounded-lg border border-slate-200"
									onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
								/>
								<a href={comprobanteUrl} target="_blank" rel="noopener noreferrer" class="text-xs text-blue-600 hover:underline">Ver comprobante actual</a>
							</div>
						{/if}

						{#if comprobanteError}
							<p class="mt-1 text-xs text-red-600">{comprobanteError}</p>
						{:else}
							<p class="mt-1 text-xs text-slate-400">Toda transacción debe tener un comprobante de respaldo — se sube a Google Drive, igual que el resto de documentos del ERP.</p>
						{/if}
					</div>
				</div>

				<div class="sticky bottom-0 flex gap-2 justify-end bg-white px-6 py-4 border-t border-slate-200">
					<button type="button" onclick={onClose} disabled={submitting} class="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
						Cancelar
					</button>
					{#if !bloqueadaPorAprobacion}
						<button type="submit" disabled={submitting || hasErrors} class="px-4 py-2 text-sm font-medium rounded-lg bg-[#0f3b5e] text-white hover:bg-[#0c2f4c] disabled:opacity-50 flex items-center gap-2">
							{#if submitting}<Loader2 size={16} class="animate-spin" />{/if}
							{uploadingComprobante ? 'Subiendo comprobante…' : (confirmButtonLabel ?? (mode === 'create' ? 'Crear' : 'Actualizar'))}
						</button>
					{/if}
				</div>
			</form>
		</div>
	</div>
{/if}
