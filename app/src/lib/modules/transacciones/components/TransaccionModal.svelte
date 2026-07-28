<script lang="ts">
	import { supabase } from '$lib/supabaseClient';
	import { X, Loader2, Paperclip, ShieldCheck, ShieldOff, Lock } from '@lucide/svelte';
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
		confirmButtonLabel = null,
		lockedFields = []
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
		/** Claves de FIELDS_CONFIG que llegan pre-determinadas y no deben poder tocarse — hoy usado
		 * para id_centro_costo_origen/id_centro_costo_destino en el flujo de confirmar un pago/cobro:
		 * esos dos ya los decide la cuenta por pagar/cobrar (su propio centro de costo + el del
		 * proveedor/cliente, ver construirPayloadTransaccionPorPago/Cobro en transacciones.service.ts)
		 * — dejarlos editables permitiría registrar la transacción contra un centro de costo distinto
		 * al que la cuenta dice, descuadrando el reporte de esa cuenta. Se siguen viendo (no se ocultan),
		 * solo quedan deshabilitados con una explicación. */
		lockedFields?: string[];
	} = $props();

	const formFields = FIELDS_CONFIG.filter((f) => f.showInForm);
	// "Alcance de la Transacción" (Interna/Externa) tiene su propio widget (dos botones grandes al
	// inicio del formulario, ver template) en vez del <select> genérico — se excluye del {#each} normal.
	const otherFields = formFields.filter((f) => f.key !== 'tipo_alcance');

	function buildInitialValues(): Record<string, string> {
		const values: Record<string, string> = {};
		for (const field of formFields) {
			const raw = transaccion ? (transaccion as any)[field.key] : '';
			values[field.key] = raw === null || raw === undefined ? '' : String(raw);
		}
		// Transacción nueva sin alcance elegido todavía -> por defecto Externa (mismo comportamiento
		// que el formulario tenía antes de agregar este toggle).
		if (!transaccion && !values.tipo_alcance) values.tipo_alcance = 'externa';
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
			// safeEndpoint (servidor) devuelve `error` genérico ("Internal server error") + `details` con
			// la causa real (ej. falta configurar GOOGLE_DRIVE_FOLDER_ID_COMPROBANTES) — se prioriza
			// `details` para que el mensaje sea accionable en vez de mostrar siempre el mismo texto vacío.
			throw new Error(result.details || result.error || 'Error al subir el comprobante.');
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
		// Cuenta Destino/Origen cambian de texto libre a un <select> de cuentas bancarias registradas
		// cuando Alcance=Externa y Tipo=Ingreso (destino) o Egreso (origen) — ver cuentaDestinoEsBancaria/
		// cuentaOrigenEsBancaria. Si Tipo o Alcance cambian, se limpian los dos para no dejar guardado un
		// valor que ya no calza con el modo de campo (texto libre vs. cuenta elegida de la lista).
		if (key === 'tipo' || key === 'tipo_alcance') {
			formValues.cuente_destino = '';
			formValues.cuente_origen = '';
		}
		if (key === 'tipo_alcance') {
			// Tipo de Documento también depende del Alcance (Talonario/Boucher en Interna vs el
			// catálogo completo en Externa, ver optionsWhen) — se limpia en cualquier dirección del
			// cambio para no dejar guardado un código que ya no es una opción válida.
			formValues.tipo_documento = '';
			// Interna = movimiento entre centros de costo propios -> Tipo se fuerza a 'transferencia' y
			// Estado a 'consulta', ambos quedan bloqueados (ver camposBloqueadosPorInterna en el
			// template); Número de Cuota y Forma de Pago también se bloquean, pero sin forzarles valor.
			// Al volver a Externa se desbloquea todo, dejando los valores como estén.
			if (rawValue === 'interna') {
				formValues.tipo = 'transferencia';
				formValues.estado = 'consulta';
			}
		}
		revalidate();
	}

	function revalidate() {
		fieldErrors = validatePayload(FIELDS_CONFIG, formValues);
	}

	const hasErrors = $derived(Object.keys(fieldErrors).length > 0);
	const title = $derived(confirmTitle ?? (mode === 'create' ? 'Nueva Transacción' : 'Editar Transacción'));
	const bloqueadoPorInterna = $derived(formValues.tipo_alcance === 'interna');
	// Cuenta Destino/Origen se vuelven un <select> de cuentas bancarias autorizadas (en vez de texto
	// libre) en dos casos: (1) transacción Externa: en Ingreso, el dinero entrante debe ir a una
	// cuenta bancaria propia ya registrada (Destino); en Egreso, el dinero saliente debe salir de una
	// cuenta propia ya registrada (Origen). (2) transacción Interna: al ser un movimiento entre
	// centros de costo propios, AMBOS lados (origen y destino) son cuentas bancarias registradas. Ver
	// getCuentaBancoOptions.
	const cuentaDestinoEsBancaria = $derived(bloqueadoPorInterna || (formValues.tipo_alcance === 'externa' && formValues.tipo === 'ingreso'));
	const cuentaOrigenEsBancaria = $derived(bloqueadoPorInterna || (formValues.tipo_alcance === 'externa' && formValues.tipo === 'egreso'));
	// Campos que se bloquean cuando el Alcance es Interna — 'tipo' y 'estado' además se fuerzan a un
	// valor fijo (ver handleInput); 'tipo_transaccion' (Número de Cuota) y 'forma_pago' solo se
	// bloquean, sin forzarles ningún valor.
	const CAMPOS_BLOQUEADOS_POR_INTERNA = new Set(['tipo', 'estado', 'tipo_transaccion', 'forma_pago']);
	// Transacción de respaldo de un pago confirmado (ver lockedFields, siempre llega con Tipo='egreso'
	// ya fijado por la cuenta por pagar): un egreso siempre sale hacia una cuenta externa, así que el
	// Alcance se fuerza a Externa y se bloquea junto con el resto de campos prellenados — ver el
	// $effect más abajo que aplica el valor forzado.
	const alcanceForzadoExterna = $derived(lockedFields.includes('tipo') && formValues.tipo === 'egreso');

	$effect(() => {
		if (alcanceForzadoExterna && formValues.tipo_alcance !== 'externa') {
			formValues = { ...formValues, tipo_alcance: 'externa' };
		}
	});

	const modalWidthClass = $derived(otherFields.length <= 4 ? 'max-w-md' : otherFields.length <= 8 ? 'max-w-2xl' : 'max-w-4xl');
	const gridColsClass = $derived(otherFields.length <= 4 ? 'grid-cols-1' : otherFields.length <= 8 ? 'grid-cols-2' : 'grid-cols-3');

	function optionsFor(field: (typeof formFields)[number]): FieldOption[] {
		// Origen/Destino de Transacción muestran una lista distinta según el Alcance: en Interna, solo
		// proyectos (dynamicOptions[key]); en Externa, proveedores/clientes/empleados (dynamicOptions[key
		// + '_externo']) — ver getCentroCostoOptionsProyectos/getCentroCostoOptionsExternos y cómo las
		// pasa cada página (+page.svelte de Transacciones y de Movimientos de Caja). Excepción: si el
		// campo llega bloqueado (ver lockedFields — caso "confirmar pago/cobro"), el valor ya lo decide
		// la cuenta y no se elige de una lista con curaduría por Alcance, así que se usa la lista PLANA
		// (todos los centros de costo, sin filtrar por tipo/vínculo) — la variante "_externo" excluye
		// centros sin vincular a una entidad (ej. Bolsa General, Consultoría) y dejaba ese caso sin
		// ninguna opción que calzara con el id ya guardado.
		if (field.key === 'id_centro_costo_origen' || field.key === 'id_centro_costo_destino') {
			if (lockedFields.includes(field.key)) return dynamicOptions[field.key] || [];
			const key = formValues.tipo_alcance === 'externa' ? `${field.key}_externo` : field.key;
			return dynamicOptions[key] || [];
		}
		if (field.key === 'cuente_destino' && cuentaDestinoEsBancaria) return dynamicOptions.cuenta_banco || [];
		if (field.key === 'cuente_origen' && cuentaOrigenEsBancaria) return dynamicOptions.cuenta_banco || [];
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

					<div class="col-span-full">
						<span class="flex items-center gap-1 text-sm font-bold text-[#0f3b5e] mb-1">
							Alcance de la Transacción <span class="text-red-500">*</span>
						</span>
						<div class="grid grid-cols-2 gap-2">
							<label
								class={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-semibold transition-colors cursor-pointer ${bloqueadaPorAprobacion || alcanceForzadoExterna ? 'opacity-60 cursor-not-allowed' : ''} ${formValues.tipo_alcance === 'interna' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
							>
								<input
									type="radio"
									name="tipo_alcance"
									value="interna"
									checked={formValues.tipo_alcance === 'interna'}
									disabled={bloqueadaPorAprobacion || alcanceForzadoExterna}
									onchange={() => handleInput('tipo_alcance', 'interna')}
									class="accent-blue-600"
								/>
								Transacción Interna
							</label>
							<label
								class={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-semibold transition-colors cursor-pointer ${bloqueadaPorAprobacion || alcanceForzadoExterna ? 'opacity-60 cursor-not-allowed' : ''} ${formValues.tipo_alcance === 'externa' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
							>
								<input
									type="radio"
									name="tipo_alcance"
									value="externa"
									checked={formValues.tipo_alcance === 'externa'}
									disabled={bloqueadaPorAprobacion || alcanceForzadoExterna}
									onchange={() => handleInput('tipo_alcance', 'externa')}
									class="accent-blue-600"
								/>
								Transacción Externa
								{#if alcanceForzadoExterna}<Lock size={12} class="text-slate-400" />{/if}
							</label>
						</div>
						{#if formValues.tipo_alcance === 'interna'}
							<p class="mt-1 text-xs text-slate-400">Movimiento entre centros de costo propios — el Tipo se fija en "Transferencia".</p>
						{:else if alcanceForzadoExterna}
							<p class="mt-1 text-xs text-slate-400">Se fija en "Externa" porque esta transacción es de un Egreso — no se puede cambiar aquí.</p>
						{/if}
						{#if fieldErrors.tipo_alcance}<p class="mt-1 text-xs text-red-600">{fieldErrors.tipo_alcance}</p>{/if}
					</div>

					{#each otherFields as field (field.key)}
						{@const isLocked = lockedFields.includes(field.key)}
						{@const isBloqueadoInterna = bloqueadoPorInterna && CAMPOS_BLOQUEADOS_POR_INTERNA.has(field.key)}
						{@const isDisabled = bloqueadaPorAprobacion || isLocked || isBloqueadoInterna}
						<div>
							<label for={`tr-${field.key}`} class="flex items-center gap-1 text-sm font-bold text-[#0f3b5e] mb-1">
								{field.label}
								{#if field.required}<span class="text-red-500">*</span>{/if}
								{#if isLocked || isBloqueadoInterna}<Lock size={12} class="text-slate-400" />{/if}
							</label>

							{#if field.tipo === 'select' || field.options || (field.key === 'cuente_destino' && cuentaDestinoEsBancaria) || (field.key === 'cuente_origen' && cuentaOrigenEsBancaria)}
								<select
									id={`tr-${field.key}`}
									name={field.key}
									value={formValues[field.key]}
									disabled={isDisabled}
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
									disabled={isDisabled}
									oninput={(e) => handleInput(field.key, (e.target as HTMLInputElement).value)}
									class={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:opacity-60 disabled:bg-slate-50 ${fieldErrors[field.key] ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
								/>
							{/if}

							{#if field.tipo === 'currency' && formValues[field.key] && !fieldErrors[field.key]}
								<p class="mt-1 text-xs text-slate-500">{formatCurrency(formValues[field.key])}</p>
							{/if}

							{#if fieldErrors[field.key]}
								<p class="mt-1 text-xs text-red-600">{fieldErrors[field.key]}</p>
							{:else if isLocked}
								<p class="mt-1 text-xs text-slate-400">Ya lo determina la cuenta — no se puede cambiar aquí.</p>
							{:else if field.key === 'tipo' && isBloqueadoInterna}
								<p class="mt-1 text-xs text-slate-400">Se fija en "Transferencia" porque el alcance es Transacción Interna.</p>
							{:else if field.key === 'estado' && isBloqueadoInterna}
								<p class="mt-1 text-xs text-slate-400">Se fija en "Consulta" porque el alcance es Transacción Interna.</p>
							{:else if isBloqueadoInterna}
								<p class="mt-1 text-xs text-slate-400">Se bloquea porque el alcance es Transacción Interna.</p>
							{:else if (field.key === 'cuente_destino' && cuentaDestinoEsBancaria) || (field.key === 'cuente_origen' && cuentaOrigenEsBancaria)}
								<p class="mt-1 text-xs text-slate-400">Se elige entre las cuentas bancarias registradas (Finanzas → Cuentas Bancarias).</p>
							{:else if field.helpText}
								<p class="mt-1 text-xs text-slate-400">{field.helpText}</p>
							{/if}
						</div>
					{/each}

					<div class="col-span-full">
						<label for="tr-comprobante" class="block text-sm font-bold text-[#0f3b5e] mb-1">
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
