<script lang="ts">
	import { supabase } from '$lib/supabaseClient';
	import { X, Loader2, ShieldCheck, ShieldOff, Lock, Pencil, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, CloudUpload, Info, Trash2, Plus, ListTree } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { validatePayload, applyFieldMask, formatCurrency, getOptionLabel, type FieldOption } from '$lib/shared/fieldConfig';
	import { FIELDS_CONFIG } from '$lib/modules/transacciones/config/transaccion.config';
	import {
		createTransaccion,
		updateTransaccion,
		aprobarTransaccion,
		desaprobarTransaccion,
		anularTransaccion,
		reactivarTransaccion,
		getCentroCostoTipoVentaMap,
		getCentroCostoOptionsClientes,
		getCentroCostoClienteIdMap,
		getCentroCostoOptionsProveedores,
		getCentroCostoOptionsEmpleados,
		getCentroCostoTipoMap,
		getDetalleCategoria,
		sincronizarDetalleCategoria,
		type DetalleCategoria
	} from '$lib/modules/transacciones/services/transacciones.service';
	import type { Transaccion } from '$lib/modules/transacciones/services/transacciones.service';
	import { permisosState, isAdmin } from '$lib/stores/permisos.svelte';
	import { resolveApiUrl, parseJsonResponse } from '$lib/apiClient';
	import { isRunningInTauri, uploadToDriveClient, renameDriveFileClient, deleteDriveFileClient } from '$lib/driveUploadClient';
	import { extractDriveFileId } from '$lib/shared/uploadProjectDocument';
	import { reconocerComprobante, type ReconocerComprobanteResult } from '$lib/shared/ocrComprobante';
	import DocumentPreviewModal from '$lib/shared/components/DocumentPreviewModal.svelte';
	import { toDriveThumbnailUrl } from '$lib/shared/drivePreview';
	import { registrarPagoDesdeTransaccion, buscarCuentasPagarVinculables } from '$lib/modules/cuentas-pagar/services/cuentasPagar.service';
	import { registrarCobroDesdeTransaccion, buscarCuentasCobrarVinculables } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';
	import { renderPdfFirstPageToDataUrl } from '$lib/shared/pdfPreview';

	/** Algunos orígenes de archivo (ej. selector de galería en el WebView de Android) no informan bien
	 * `File.type` — llega vacío o genérico ("application/octet-stream") aunque el archivo SÍ sea una
	 * imagen, lo que hacía que la vista previa dentro del cuadro de "Adjuntar boucher de pago" nunca se
	 * mostrara (se caía a la rama "solo ícono + nombre"). Se agrega la extensión como respaldo — sin
	 * ninguna API específica de plataforma, funciona igual en web, Tauri Windows y Tauri Android. */
	function esArchivoImagen(file: File): boolean {
		if (file.type.startsWith('image/')) return true;
		return /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i.test(file.name);
	}

	function esArchivoPdf(file: File): boolean {
		return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
	}

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
		lockedFields = [],
		initialComprobanteFile = null
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
		/** Ingreso rápido desde el Share Sheet de Android (ver shareTarget.ts) — si llega, se adjunta
		 * solo como si el usuario lo hubiera elegido a mano (misma ruta que processComprobanteFiles,
		 * dispara el reconocimiento automático de Fecha/Monto igual). Solo aplica al abrir el modal en
		 * mode='create'; se ignora en cualquier otro caso. */
		initialComprobanteFile?: File | null;
	} = $props();

	const formFields = FIELDS_CONFIG.filter((f) => f.showInForm);
	// "Alcance de la Transacción" (Interna/Externa) tiene su propio widget (dos botones grandes al
	// inicio del formulario, ver template) en vez del <select> genérico — se excluye del render normal.
	const otherFields = formFields.filter((f) => f.key !== 'tipo_alcance');

	// A pedido del usuario (nuevo diseño "Nueva Transacción"): el formulario ya no se recorre con un
	// solo {#each} en el orden de FIELDS_CONFIG — se agrupa en secciones fijas (núcleo siempre visible +
	// "Otros campos" colapsable). Estas constantes solo ubican cada FieldConfig ya existente; no
	// duplican su definición (validación/máscara/opciones siguen viniendo de transaccion.config.ts).
	const origenField = otherFields.find((f) => f.key === 'id_centro_costo_origen')!;
	const destinoField = otherFields.find((f) => f.key === 'id_centro_costo_destino')!;
	const tipoField = otherFields.find((f) => f.key === 'tipo')!;
	const cuentaOrigenField = otherFields.find((f) => f.key === 'cuente_origen')!;
	const cuentaDestinoField = otherFields.find((f) => f.key === 'cuente_destino')!;
	const categoriaField = otherFields.find((f) => f.key === 'categoria')!;
	const tipoDocumentoField = otherFields.find((f) => f.key === 'tipo_documento')!;
	const numDocumentoField = otherFields.find((f) => f.key === 'num_documento')!;
	const formaPagoField = otherFields.find((f) => f.key === 'forma_pago')!;
	const medioPagoField = otherFields.find((f) => f.key === 'medio_pago')!;
	const descripcionField = otherFields.find((f) => f.key === 'descripcion')!;

	function buildInitialValues(): Record<string, string> {
		const values: Record<string, string> = {};
		for (const field of formFields) {
			const raw = transaccion ? (transaccion as any)[field.key] : '';
			values[field.key] = raw === null || raw === undefined ? '' : String(raw);
		}
		// Transacción nueva sin alcance elegido todavía -> por defecto Externa (mismo comportamiento
		// que el formulario tenía antes de agregar este toggle).
		if (!transaccion && !values.tipo_alcance) values.tipo_alcance = 'externa';
		// Transacción nueva sin Tipo elegido todavía -> por defecto Egreso, a pedido del usuario (el
		// selector manual ahora solo ofrece Egreso/Ingreso, ver optionsWhen en transaccion.config.ts).
		if (!transaccion && !values.tipo) values.tipo = 'egreso';
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

	const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB, a pedido del usuario (ver texto de ayuda del dropzone)

	// Comprobante (boucher de pago) — obligatorio en toda transacción, ver createTransaccion/
	// updateTransaccion. comprobanteUrl arranca con la de la transacción si se está editando una que ya
	// tenía una subida; si el usuario elige un archivo nuevo, ese reemplaza a la anterior recién al
	// confirmar el envío.
	let comprobanteFile = $state<File | null>(null);
	let comprobanteUrl = $state<string | null>(null);
	let comprobanteError = $state('');
	let uploadingComprobante = $state(false);
	let localPreviewUrl = $state<string | null>(null);
	let showComprobantePreview = $state(false);

	// Factura o boleta de venta — adjunto SEPARADO y OPCIONAL del comprobante (ver
	// transaccion_factura_migration.sql), a pedido del usuario en el nuevo diseño.
	let facturaFile = $state<File | null>(null);
	let facturaUrl = $state<string | null>(null);
	let uploadingFactura = $state(false);
	let localPreviewUrlFactura = $state<string | null>(null);
	let showFacturaPreview = $state(false);

	// Reconocimiento automático (OCR + regex, sin IA, ver ocrComprobante.ts) de Fecha/Monto/N°
	// de Operación al subir el boucher — a pedido del usuario. fechaLocked/montoLocked/
	// numOperacionLocked = true mientras el valor viene del reconocimiento automático (input
	// deshabilitado); el lápiz de al lado lo habilita a mano.
	let ocrLoading = $state(false);
	let ocrConfianza = $state<'alta' | 'media' | 'baja' | null>(null);
	let fechaLocked = $state(false);
	let montoLocked = $state(false);
	let numOperacionLocked = $state(false);

	let anulando = $state(false);

	// Buscador "Vincular con Cuenta por Pagar/Cobrar" (a pedido del usuario, reemplaza al viejo campo
	// de texto "Número de Cuota", sin uso real fuera del flujo de confirmar un pago). Solo aplica al
	// alta libre de una sola transacción (mode==='create' && !onConfirm && no está en la cola de
	// varios comprobantes) — ver condición de render en el template. registrarPagoDesdeTransaccion/
	// registrarCobroDesdeTransaccion (cuentasPagar/cuentasCobrar.service.ts) hacen el trabajo real:
	// crean la transacción Y un pago/cobro 'pagado'/'cobrado' ya vinculado, en el mismo paso.
	type CuentaVinculadaOpcion = { id: number; label: string; saldo: number };
	let cuentaVinculadaBusqueda = $state('');
	let cuentaVinculadaResultados = $state<CuentaVinculadaOpcion[]>([]);
	let cuentaVinculadaSeleccionada = $state<CuentaVinculadaOpcion | null>(null);
	let cuentaVinculadaBuscando = $state(false);
	let cuentaVinculadaAbierta = $state(false);
	let cuentaVinculadaBuscarTimeout: ReturnType<typeof setTimeout> | undefined;

	function limpiarCuentaVinculada() {
		cuentaVinculadaSeleccionada = null;
		cuentaVinculadaBusqueda = '';
		cuentaVinculadaResultados = [];
	}

	function seleccionarCuentaVinculada(opcion: CuentaVinculadaOpcion) {
		cuentaVinculadaSeleccionada = opcion;
		cuentaVinculadaAbierta = false;
		cuentaVinculadaBusqueda = '';
		cuentaVinculadaResultados = [];
	}

	async function ejecutarBusquedaCuentaVinculada(query: string) {
		cuentaVinculadaBuscando = true;
		try {
			if (formValues.tipo === 'egreso') {
				const items = await buscarCuentasPagarVinculables(supabase, query);
				cuentaVinculadaResultados = items.map((it) => ({
					id: it.id_cuenta_pagar,
					label: `${it.proveedorNombre}${it.num_documento ? ' · ' + it.num_documento : ''}`,
					saldo: it.saldo_pendiente
				}));
			} else if (formValues.tipo === 'ingreso') {
				const items = await buscarCuentasCobrarVinculables(supabase, query);
				cuentaVinculadaResultados = items.map((it) => ({
					id: it.id_cuenta_cobrar,
					label: `${it.clienteNombre}${it.num_documento ? ' · ' + it.num_documento : ''}`,
					saldo: it.saldo_pendiente
				}));
			} else {
				cuentaVinculadaResultados = [];
			}
		} catch (err) {
			console.warn('[TransaccionModal] No se pudo buscar cuentas para vincular:', err);
			cuentaVinculadaResultados = [];
		} finally {
			cuentaVinculadaBuscando = false;
		}
	}

	function onCuentaVinculadaFocus() {
		cuentaVinculadaAbierta = true;
		if (cuentaVinculadaResultados.length === 0 && !cuentaVinculadaBuscando) ejecutarBusquedaCuentaVinculada(cuentaVinculadaBusqueda);
	}

	function onCuentaVinculadaInput(e: Event) {
		cuentaVinculadaBusqueda = (e.target as HTMLInputElement).value;
		cuentaVinculadaAbierta = true;
		if (cuentaVinculadaBuscarTimeout) clearTimeout(cuentaVinculadaBuscarTimeout);
		cuentaVinculadaBuscarTimeout = setTimeout(() => ejecutarBusquedaCuentaVinculada(cuentaVinculadaBusqueda), 300);
	}

	// Delay antes de cerrar el dropdown al perder foco — sin esto, el blur cierra la lista ANTES de
	// que el click en un resultado llegue a registrarse.
	function onCuentaVinculadaBlur() {
		setTimeout(() => (cuentaVinculadaAbierta = false), 150);
	}

	// Cola de comprobantes cuando se eligen VARIOS archivos a la vez en modo 'create' (sin onConfirm) —
	// a pedido del usuario, cada uno se revisa/edita con las flechas de "Otros campos (opcionales)" y
	// se guarda como una transacción independiente (ver handleSubmit). colaDrafts guarda el formulario
	// a medio llenar de cada índice todavía no guardado; colaOcrCache evita repetir la llamada de OCR
	// al volver a un índice ya visitado.
	let colaArchivos = $state<File[]>([]);
	let colaIndex = $state(0);
	let colaDrafts = $state<Record<number, Record<string, string>>>({});
	let colaOcrCache = $state<Record<number, ReconocerComprobanteResult>>({});

	// A pedido del usuario: "Otros campos (opcionales)" arranca colapsada — antes arrancaba abierta.
	let otrosCamposAbierto = $state(false);

	$effect(() => {
		if (open) {
			formValues = buildInitialValues();
			fieldErrors = {};
			comprobanteFile = null;
			comprobanteUrl = transaccion?.comprobante_url ?? null;
			comprobanteError = '';
			facturaFile = null;
			facturaUrl = transaccion?.factura_url ?? null;
			colaArchivos = [];
			colaDrafts = {};
			colaOcrCache = {};
			colaIndex = 0;
			fechaLocked = false;
			montoLocked = false;
			numOperacionLocked = false;
			claseDestino = '';
			ocrConfianza = null;
			otrosCamposAbierto = false;
			detalleCategoria = [];
			detalleCategoriaAbierto = false;
			detalleCategoriaCargadoParaId = null;
			categoriaObraGrupo = '';
			limpiarCuentaVinculada();
			if (mode === 'create' && initialComprobanteFile) {
				processComprobanteFiles([initialComprobanteFile]);
			}
		}
	});

	// Vista previa local instantánea (antes de subir) cuando el archivo elegido es una imagen — o, si es
	// un PDF, la primera página renderizada a imagen vía pdf.js (ver renderPdfFirstPageToDataUrl):
	// un `<embed>`/`<iframe>` con el PDF crudo no se ve en el WebView de Android, así que se genera una
	// miniatura real en vez de mostrar solo un ícono + el nombre del archivo. `token` descarta el
	// resultado si el usuario ya cambió de archivo antes de que termine de renderizar.
	let comprobantePdfPreviewToken = 0;
	$effect(() => {
		if (comprobanteFile && esArchivoImagen(comprobanteFile)) {
			const url = URL.createObjectURL(comprobanteFile);
			localPreviewUrl = url;
			return () => URL.revokeObjectURL(url);
		}
		if (comprobanteFile && esArchivoPdf(comprobanteFile)) {
			const token = ++comprobantePdfPreviewToken;
			localPreviewUrl = null;
			renderPdfFirstPageToDataUrl(comprobanteFile)
				.then((dataUrl) => {
					if (token === comprobantePdfPreviewToken) localPreviewUrl = dataUrl;
				})
				.catch((err) => console.error('[TransaccionModal] No se pudo generar la vista previa del PDF (comprobante):', err));
			return;
		}
		localPreviewUrl = null;
	});

	let facturaPdfPreviewToken = 0;
	$effect(() => {
		if (facturaFile && esArchivoImagen(facturaFile)) {
			const url = URL.createObjectURL(facturaFile);
			localPreviewUrlFactura = url;
			return () => URL.revokeObjectURL(url);
		}
		if (facturaFile && esArchivoPdf(facturaFile)) {
			const token = ++facturaPdfPreviewToken;
			localPreviewUrlFactura = null;
			renderPdfFirstPageToDataUrl(facturaFile)
				.then((dataUrl) => {
					if (token === facturaPdfPreviewToken) localPreviewUrlFactura = dataUrl;
				})
				.catch((err) => console.error('[TransaccionModal] No se pudo generar la vista previa del PDF (factura):', err));
			return;
		}
		localPreviewUrlFactura = null;
	});

	// Miniatura del archivo ya subido a Drive (para mostrarla de fondo en el recuadro de arrastrar y
	// soltar) — la URL cruda guardada en BD es de descarga directa, no sirve como `<img src>` (ver
	// toDriveThumbnailUrl).
	const comprobanteThumbUrl = $derived(toDriveThumbnailUrl(comprobanteUrl));
	const facturaThumbUrl = $derived(toDriveThumbnailUrl(facturaUrl));

	/** Lee fecha/monto del comprobante vía OCR + regex, sin IA (ver ocrComprobante.ts). `cacheIndex` no
	 * nulo cuando viene de la cola de varios comprobantes (se cachea el resultado por índice para no
	 * repetir la llamada al volver a un archivo ya revisado con las flechas). Nunca bloquea el guardado
	 * manual: si falla o la imagen no es reconocible, el usuario completa Fecha/Monto a mano. */
	async function runOcr(file: File, cacheIndex: number | null) {
		fechaLocked = false;
		montoLocked = false;
		numOperacionLocked = false;
		ocrConfianza = null;
		if (!esArchivoImagen(file)) return; // la Edge Function solo procesa bloques `image`, no PDF
		ocrLoading = true;
		try {
			const result = await reconocerComprobante(file);
			if (cacheIndex !== null) colaOcrCache = { ...colaOcrCache, [cacheIndex]: result };
			if (result.success) {
				const updates: Record<string, string> = {};
				if (result.fecha) {
					updates.fecha = result.fecha;
					fechaLocked = true;
				}
				if (result.monto !== null && result.monto !== undefined) {
					updates.monto_total = String(result.monto);
					montoLocked = true;
				}
				if (result.num_operacion) {
					updates.num_operacion = result.num_operacion;
					numOperacionLocked = true;
				}
				if (Object.keys(updates).length > 0) formValues = { ...formValues, ...updates };
				ocrConfianza = result.confianza ?? null;
				revalidate();
			} else {
				toast.error('No se pudo reconocer fecha/monto automáticamente. Complétalos a mano.');
			}
		} finally {
			ocrLoading = false;
		}
	}

	function processComprobanteFiles(files: File[]) {
		if (files.length === 0) return;
		const tooBig = files.find((f) => f.size > MAX_FILE_SIZE);
		if (tooBig) {
			comprobanteError = `"${tooBig.name}" supera el máximo de 5MB.`;
			return;
		}

		if (mode === 'create' && !onConfirm && files.length > 1) {
			colaArchivos = files;
			colaDrafts = {};
			colaOcrCache = {};
			colaIndex = 0;
			formValues = buildInitialValues();
			comprobanteUrl = null;
			comprobanteError = '';
			comprobanteFile = files[0];
			limpiarCuentaVinculada();
			runOcr(files[0], 0);
			return;
		}

		colaArchivos = [];
		comprobanteFile = files[0];
		comprobanteError = '';
		runOcr(files[0], null);
	}

	function onComprobanteChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const files = input.files ? Array.from(input.files) : [];
		input.value = '';
		processComprobanteFiles(files);
	}

	function onComprobanteDrop(e: DragEvent) {
		e.preventDefault();
		if (bloqueadaPorAprobacion) return;
		processComprobanteFiles(e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : []);
	}

	function processFacturaFile(files: File[]) {
		const file = files[0];
		if (!file) return;
		if (file.size > MAX_FILE_SIZE) {
			toast.error(`"${file.name}" supera el máximo de 5MB.`);
			return;
		}
		facturaFile = file;
	}

	function onFacturaChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const files = input.files ? Array.from(input.files) : [];
		input.value = '';
		processFacturaFile(files);
	}

	function onFacturaDrop(e: DragEvent) {
		e.preventDefault();
		if (bloqueadaPorAprobacion) return;
		processFacturaFile(e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : []);
	}

	/** Guarda el formulario a medio llenar del índice actual de la cola antes de navegar a otro. */
	function guardarDraftActual() {
		colaDrafts = { ...colaDrafts, [colaIndex]: { ...formValues } };
	}

	/** Carga el comprobante/formulario del índice `idx` de la cola — reusa el resultado de OCR ya
	 * cacheado si el usuario ya había pasado por ese archivo antes. */
	function cargarDraft(idx: number) {
		comprobanteFile = colaArchivos[idx] ?? null;
		comprobanteUrl = null;
		comprobanteError = '';
		const cached = colaOcrCache[idx];
		const draft = colaDrafts[idx];
		formValues = draft ?? buildInitialValues();
		fechaLocked = !!cached?.success && !!cached.fecha;
		montoLocked = !!cached?.success && cached.monto !== null && cached.monto !== undefined;
		numOperacionLocked = !!cached?.success && !!cached.num_operacion;
		ocrConfianza = cached?.confianza ?? null;
		if (!cached && comprobanteFile) runOcr(comprobanteFile, idx);
		revalidate();
	}

	function irAAnterior() {
		if (colaIndex <= 0) return;
		guardarDraftActual();
		colaIndex -= 1;
		cargarDraft(colaIndex);
	}

	function irASiguiente() {
		if (colaIndex >= colaArchivos.length - 1) return;
		guardarDraftActual();
		colaIndex += 1;
		cargarDraft(colaIndex);
	}

	function fileExt(name: string): string {
		return name.includes('.') ? `.${name.split('.').pop()}` : '';
	}

	/**
	 * Sube un archivo (comprobante o factura) a Google Drive con el nombre `baseName` — misma rama
	 * Tauri/web que usan proforma/contrato en NuevaVentaModal.svelte y documentos de proyecto en
	 * DocumentosTab.svelte. Ambos tipos de adjunto de este modal reusan el mismo folder de Drive
	 * ('comprobante' en el backend) — no hay un folder dedicado para facturas todavía, y crear uno
	 * nuevo es un cambio de configuración de servidor fuera del alcance de este formulario.
	 */
	async function subirArchivo(file: File, baseName: string): Promise<{ url: string; fileId: string }> {
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
			throw new Error(result.details || result.error || 'Error al subir el archivo.');
		}
		return { url: result.url as string, fileId: result.fileId as string };
	}

	/** Renombra un archivo recién subido a su nombre definitivo (código = id_transaccion, solo se
	 * conoce después de crear la transacción) — mejor esfuerzo, no bloquea el guardado si falla. */
	async function renombrarArchivo(fileId: string, newName: string): Promise<void> {
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

	/** Borra el archivo anterior al reemplazarlo por uno nuevo, para no dejar duplicados en Drive —
	 * mejor esfuerzo, no bloquea el guardado si falla. */
	async function borrarArchivo(fileId: string): Promise<void> {
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

	async function handleAnular() {
		if (!transaccion) return;
		if (
			!confirm(
				'¿Anular esta transacción? Si respalda un pago o cobro ya confirmado, ese pago/cobro volverá a quedar programado (sin transacción de respaldo) y la cuenta se recalculará.'
			)
		)
			return;
		anulando = true;
		try {
			const result = await anularTransaccion(supabase, transaccion.id_transaccion, isAdmin());
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
			anulando = false;
		}
	}

	async function handleReactivar() {
		if (!transaccion) return;
		anulando = true;
		try {
			const result = await reactivarTransaccion(supabase, transaccion.id_transaccion, isAdmin());
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
			anulando = false;
		}
	}

	function formatFecha(value: string | null | undefined): string {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '—';
		// timeZone: 'UTC' evita el corrimiento de un día que 'new Date("YYYY-MM-DD")' produce en husos
		// horarios detrás de UTC (Perú, UTC-5) al leerse de vuelta en hora local.
		return date.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
	}

	function handleInput(key: string, rawValue: string) {
		const field = formFields.find((f) => f.key === key)!;
		const masked = applyFieldMask(field, rawValue);
		formValues = { ...formValues, [key]: masked };
		// Categoría depende de Tipo (ver optionsWhen en transaccion.config.ts) y, si el proyecto es de
		// Obra, también del Centro de Costo elegido (ver esProyectoDeObra) — si cualquiera de los tres
		// cambia, la categoría elegida antes puede ya no ser válida, así que se limpia para que el
		// usuario elija de nuevo entre las opciones correctas en vez de dejar guardado un valor
		// incoherente.
		if (key === 'tipo' || key === 'id_centro_costo_origen' || key === 'id_centro_costo_destino') {
			formValues.categoria = '';
			categoriaObraGrupo = '';
		}
		// "Tipo de Gasto" (7 dropdowns, ver TIPOS_GASTO_CONSULTORIA) solo aplica a Egreso en proyectos de
		// Consultoría — mismos disparadores que Categoría para limpiarlo si deja de aplicar.
		if (key === 'tipo' || key === 'id_centro_costo_origen' || key === 'id_centro_costo_destino') formValues.tipo_gasto = '';
		// En Ingreso, "Centro de Costo Destino" se filtra en cascada a los proyectos del cliente elegido
		// en "Centro de Costo Origen" (ver optionsFor/centroCostoClienteIdMap) — si Origen cambia, el
		// Destino ya elegido puede pertenecer a otro cliente, así que se limpia.
		if (key === 'id_centro_costo_origen' && formValues.tipo === 'ingreso') formValues.id_centro_costo_destino = '';
		// "Clase" (Proveedores/Empleados/Cliente) solo aplica en Egreso — si Tipo cambia a otra cosa, se
		// limpia junto con el Destino (que ya no calzaría con la lista filtrada por esa Clase).
		if (key === 'tipo' && masked !== 'egreso') {
			claseDestino = '';
			formValues.id_centro_costo_destino = '';
		}
		// Cuenta Destino/Origen cambian de texto libre a un <select> de cuentas bancarias registradas
		// cuando Alcance=Externa y Tipo=Ingreso (destino) o Egreso (origen) — ver cuentaDestinoEsBancaria/
		// cuentaOrigenEsBancaria. Si Tipo o Alcance cambian, se limpian los dos para no dejar guardado un
		// valor que ya no calza con el modo de campo (texto libre vs. cuenta elegida de la lista).
		if (key === 'tipo' || key === 'tipo_alcance') {
			formValues.cuente_destino = '';
			formValues.cuente_origen = '';
		}
		// Efectivo/Yape o Plin no tienen una cuenta bancaria de por medio — se bloquean y limpian Cuenta
		// Origen/Destino (a pedido del usuario), igual que se limpian arriba al cambiar Tipo/Alcance.
		if (key === 'medio_pago' && (masked === '1' || masked === '4')) {
			formValues.cuente_destino = '';
			formValues.cuente_origen = '';
		}
		if (key === 'tipo_alcance') {
			// Tipo de Documento también depende del Alcance (Talonario/Boucher en Interna vs el
			// catálogo completo en Externa, ver optionsWhen) — se limpia en cualquier dirección del
			// cambio para no dejar guardado un código que ya no es una opción válida.
			formValues.tipo_documento = '';
			// Interna = movimiento entre centros de costo propios -> Tipo se fuerza a 'transferencia' y
			// Estado a 'consulta' (ver estadoActual más abajo), ambos quedan bloqueados (ver
			// camposBloqueadosPorInterna en el template); Forma de Pago también se bloquea, sin forzarle
			// valor. Al volver a Externa se desbloquea todo, dejando los valores como estén.
			if (rawValue === 'interna') {
				formValues.tipo = 'transferencia';
			}
		}
		if (key === 'tipo') {
			cuentaVinculadaSeleccionada = null;
			cuentaVinculadaBusqueda = '';
			cuentaVinculadaResultados = [];
		}
		revalidate();
	}

	function revalidate() {
		fieldErrors = validatePayload(FIELDS_CONFIG, formValues);
	}

	const hasErrors = $derived(Object.keys(fieldErrors).length > 0);
	const title = $derived(confirmTitle ?? (mode === 'create' ? 'Nueva Transacción' : 'Editar Transacción'));
	const bloqueadoPorInterna = $derived(formValues.tipo_alcance === 'interna');
	// Estado ya no es un <select> manual (ver transaccion.config.ts) — se calcula acá para el badge:
	// 'consulta' mientras el Alcance sea Interna (preview inmediato, antes de guardar — el backend
	// aplica exactamente la misma regla en resolveEstadoTransaccion), si no, el valor persistido
	// (anulado se preserva hasta que un admin lo reactiva; una transacción nueva todavía sin guardar
	// se asume 'activo').
	const estadoActual = $derived(formValues.tipo_alcance === 'interna' ? 'consulta' : (transaccion?.estado ?? 'activo'));
	// Cuenta Destino/Origen se vuelven un <select> de cuentas bancarias autorizadas (en vez de texto
	// libre) en dos casos: (1) transacción Externa: en Ingreso, el dinero entrante debe ir a una
	// cuenta bancaria propia ya registrada (Destino); en Egreso, el dinero saliente debe salir de una
	// cuenta propia ya registrada (Origen). (2) transacción Interna: al ser un movimiento entre
	// centros de costo propios, AMBOS lados (origen y destino) son cuentas bancarias registradas. Ver
	// getCuentaBancoOptions.
	// "Categoría" en "Confirmar Cobro — Transacción de Respaldo" (única pantalla donde `onConfirm` viene
	// con Tipo='ingreso', ver cuentas-cobrar/+page.svelte) ofrece este catálogo propio en vez del genérico
	// de Ingreso (Consultoría/Ingresos por Servicios, ver optionsWhen en transaccion.config.ts) — a
	// pedido explícito del usuario, y solo para esta pantalla: cualquier otra transacción de tipo
	// Ingreso (ej. "Nueva Transacción" a mano) sigue mostrando el catálogo genérico de siempre.
	const esConfirmarCobro = $derived(!!onConfirm && formValues.tipo === 'ingreso');
	const CATEGORIA_CONFIRMAR_COBRO: FieldOption[] = [
		{ value: 'G. Operativos', label: 'G. Operativos' },
		{ value: 'G. Administrativos', label: 'G. Administrativos' },
		{ value: 'Servicio', label: 'Servicio' },
		{ value: 'Materiales', label: 'Materiales' }
	];

	// "Categoría" cuando el Centro de Costo del proyecto (Destino en Ingreso, Origen en Egreso — el
	// lado que es "nuestro" en cada caso) pertenece a una venta de OBRA (código con prefijo "OBRA" o
	// "SUP", ver getCentroCostoTipoVentaMap/codigoProyecto.ts) — a pedido explícito del usuario, ofrece
	// un catálogo propio, distinto del genérico de transaccion.config.ts (que sigue aplicando para
	// Consultoría/Corporativo/sin centro elegido todavía).
	let centroCostoTipoVentaMap = $state<Record<string, string | null>>({});
	let centroCostoTipoVentaMapCargado = $state(false);
	$effect(() => {
		if (open && !centroCostoTipoVentaMapCargado) {
			centroCostoTipoVentaMapCargado = true;
			getCentroCostoTipoVentaMap(supabase)
				.then((mapa) => (centroCostoTipoVentaMap = mapa))
				.catch((err) => console.error('[TransaccionModal] No se pudo cargar el tipo de venta por centro de costo:', err));
		}
	});
	const idCentroCostoProyecto = $derived(formValues.tipo === 'ingreso' ? formValues.id_centro_costo_destino : formValues.tipo === 'egreso' ? formValues.id_centro_costo_origen : '');
	const esProyectoDeObra = $derived(centroCostoTipoVentaMap[idCentroCostoProyecto] === 'obra');
	// A pedido explícito del usuario: la sección "Tipo de Gasto" (7 dropdowns, ver TIPOS_GASTO_CONSULTORIA más
	// abajo) se muestra para Consultoría, no para Obra (reemplaza la condición original) — Categoría sí
	// sigue usando esProyectoDeObra tal cual, son dos cosas independientes.
	const esProyectoDeConsultoria = $derived(centroCostoTipoVentaMap[idCentroCostoProyecto] === 'consultoria');

	// "Corporativo" no es un tipo de PROYECTO (a diferencia de Obra/Consultoría) — es un Centro de
	// Costo de tipo 'bolsa general', creado a mano, sin ningún proyecto vinculado (ver
	// getCentroCostoTipoMap, que lee `centro_costo.tipo` directo, no el tipo_venta de un proyecto).
	let centroCostoTipoMap = $state<Record<string, string>>({});
	let centroCostoTipoMapCargado = $state(false);
	$effect(() => {
		if (open && !centroCostoTipoMapCargado) {
			centroCostoTipoMapCargado = true;
			getCentroCostoTipoMap(supabase)
				.then((mapa) => (centroCostoTipoMap = mapa))
				.catch((err) => console.error('[TransaccionModal] No se pudo cargar el tipo de centro de costo:', err));
		}
	});
	const esCorporativo = $derived(centroCostoTipoMap[idCentroCostoProyecto] === 'bolsa general');

	// "Detalle de la categoría" — a pedido explícito del usuario: tabla editable de subcategorías
	// (Subcategoría/Descripción/Cantidad/Unidad/Precio Unitario/Total, con total autocalculado),
	// visible en cuanto hay una Categoría elegida (cualquier tipo de proyecto). Se acumula client-side
	// mientras se llena el formulario y se guarda TODO junto (borra + reinserta, ver
	// sincronizarDetalleCategoria) recién cuando se confirma Crear/Actualizar — no antes, porque en
	// modo 'create' la transacción (y su id_transaccion) todavía no existe.
	type DetalleCategoriaFila = DetalleCategoria & { _key: number };
	let detalleCategoriaAbierto = $state(false);
	let detalleCategoria = $state<DetalleCategoriaFila[]>([]);
	let detalleCategoriaKeySeq = 0;
	const UNIDADES_DETALLE = ['und', 'kg', 'bolsa', 'm', 'm²', 'm³', 'gal', 'lt', 'caja', 'rollo', 'par', 'juego', 'global'];
	const totalDetalleCategoria = $derived(detalleCategoria.reduce((sum, f) => sum + (Number(f.cantidad) || 0) * (Number(f.precio_unitario) || 0), 0));

	function agregarFilaDetalleCategoria() {
		detalleCategoriaKeySeq += 1;
		detalleCategoria = [
			...detalleCategoria,
			{ _key: detalleCategoriaKeySeq, subcategoria: '', descripcion: '', cantidad: 1, unidad: 'und', precio_unitario: 0, total: 0 }
		];
	}
	function eliminarFilaDetalleCategoria(key: number) {
		detalleCategoria = detalleCategoria.filter((f) => f._key !== key);
	}

	// Al abrir en modo edición, trae el detalle ya guardado de esa transacción (si tiene) — en modo
	// create arranca vacío (ver el $effect principal de `open`, que ya limpia detalleCategoria).
	let detalleCategoriaCargadoParaId: number | null = null;
	$effect(() => {
		if (open && mode === 'edit' && transaccion && detalleCategoriaCargadoParaId !== transaccion.id_transaccion) {
			detalleCategoriaCargadoParaId = transaccion.id_transaccion;
			getDetalleCategoria(supabase, transaccion.id_transaccion)
				.then((filas) => {
					detalleCategoria = filas.map((f) => {
						detalleCategoriaKeySeq += 1;
						return { ...f, _key: detalleCategoriaKeySeq };
					});
					if (detalleCategoria.length > 0) detalleCategoriaAbierto = true;
				})
				.catch((err) => console.error('[TransaccionModal] No se pudo cargar el detalle de categoría:', err));
		}
	});

	// A pedido explícito del usuario: en Ingreso+Externa, "Centro de Costo Origen" pasa a mostrar la
	// lista de CLIENTES (antes mostraba "solo proyectos", ver optionsFor más abajo) y "Centro de Costo
	// Destino", en cascada, solo los PROYECTOS de ese cliente — ver getCentroCostoClienteIdMap. También
	// se cargan acá las listas de proveedores/empleados: en Egreso+Externa se usan para "Centro de
	// Costo Destino" según el selector "Clase" (ver más abajo).
	let centroCostoOptionsClientes = $state<FieldOption[]>([]);
	let centroCostoClienteIdMap = $state<Record<string, string | null>>({});
	let centroCostoOptionsProveedores = $state<FieldOption[]>([]);
	let centroCostoOptionsEmpleados = $state<FieldOption[]>([]);
	let centroCostoClientesCargado = $state(false);
	$effect(() => {
		if (open && !centroCostoClientesCargado) {
			centroCostoClientesCargado = true;
			Promise.all([
				getCentroCostoOptionsClientes(supabase),
				getCentroCostoClienteIdMap(supabase),
				getCentroCostoOptionsProveedores(supabase),
				getCentroCostoOptionsEmpleados(supabase)
			])
				.then(([opciones, mapa, proveedores, empleados]) => {
					centroCostoOptionsClientes = opciones;
					centroCostoClienteIdMap = mapa;
					centroCostoOptionsProveedores = proveedores;
					centroCostoOptionsEmpleados = empleados;
				})
				.catch((err) => console.error('[TransaccionModal] No se pudo cargar la lista de clientes/proveedores/empleados/proyectos:', err));
		}
	});

	// "Clase" (Proveedores/Empleados/Cliente) — dropdown propio, SOLO en Egreso+Externa, entre Centro
	// de Costo Origen y Destino (a pedido explícito del usuario): clasifica qué "Cuenta Interna"
	// ofrece Destino. No es una columna de `transaccion` — es un filtro puramente de UI, se resetea al
	// abrir el modal (ver el $effect principal de `open` más abajo) y al cambiar Tipo/Alcance.
	type ClaseDestino = '' | 'proveedores' | 'empleados' | 'cliente';
	let claseDestino = $state<ClaseDestino>('');
	function handleClaseDestinoChange(value: string) {
		claseDestino = value as ClaseDestino;
		formValues = { ...formValues, id_centro_costo_destino: '' };
	}
	const OPCIONES_CLASE_DESTINO: { value: ClaseDestino; label: string }[] = [
		{ value: 'proveedores', label: 'Proveedores' },
		{ value: 'empleados', label: 'Empleados' },
		{ value: 'cliente', label: 'Cliente' }
	];
	// Al editar una transacción de Egreso ya guardada, infiere la Clase a partir de a qué lista
	// pertenece el Destino guardado — para no arrancar con el selector vacío y el campo Destino oculto.
	$effect(() => {
		if (open && mode === 'edit' && transaccion && formValues.tipo === 'egreso' && !claseDestino && centroCostoClientesCargado) {
			const destinoId = String(transaccion.id_centro_costo_destino);
			if (centroCostoOptionsProveedores.some((o) => o.value === destinoId)) claseDestino = 'proveedores';
			else if (centroCostoOptionsEmpleados.some((o) => o.value === destinoId)) claseDestino = 'empleados';
			else if (centroCostoOptionsClientes.some((o) => o.value === destinoId)) claseDestino = 'cliente';
		}
	});
	const CATEGORIA_OBRA_INGRESO: FieldOption[] = [
		{ value: 'Adelanto', label: 'Adelanto' },
		{ value: 'Valorización', label: 'Valorización' },
		{ value: 'Adenda', label: 'Adenda' }
	];
	const CATEGORIA_OBRA_EGRESO: FieldOption[] = [
		{ value: 'Sub Contrata', label: 'Sub Contrata' },
		{ value: 'Material', label: 'Material' },
		{ value: 'Servicios', label: 'Servicios' },
		{ value: 'Honorarios', label: 'Honorarios' },
		{ value: 'Equipos', label: 'Equipos' },
		{ value: 'Compras', label: 'Compras' },
		{ value: 'Alquileres', label: 'Alquileres' },
		{ value: 'Préstamo', label: 'Préstamo' },
		{ value: 'Gastos generales', label: 'Gastos generales' }
	];
	// Categoría cuando el Centro de Costo es "Corporativo" (tipo 'bolsa general', ver esCorporativo) —
	// a pedido explícito del usuario: Ingreso solo ofrece Inyecciones/Préstamo; Egreso ofrece las
	// mismas 8 categorías del cuadro "Tipo de Gasto" de Corporativo (ver TIPOS_GASTO_CORPORATIVO).
	const CATEGORIA_CORPORATIVO_INGRESO: FieldOption[] = [
		{ value: 'Inyecciones', label: 'Inyecciones' },
		{ value: 'Préstamo', label: 'Préstamo' }
	];
	const CATEGORIA_CORPORATIVO_EGRESO: FieldOption[] = [
		{ value: 'Honorarios', label: 'Honorarios' },
		{ value: 'Alquileres', label: 'Alquileres' },
		{ value: 'Servicios', label: 'Servicios' },
		{ value: 'Préstamo', label: 'Préstamo' },
		{ value: 'Compras', label: 'Compras' },
		{ value: 'Movilidad', label: 'Movilidad' },
		{ value: 'Impuestos', label: 'Impuestos' },
		{ value: 'Inversión', label: 'Inversión' }
	];

	// "Tipo de Gasto" — 7 dropdowns propios (uno por concepto, a pedido explícito del usuario, según
	// su cuadro de referencia), visibles en "Otros campos" solo para Egreso en proyectos de
	// Consultoría. Los 7 comparten formValues.tipo_gasto: cada <select> solo tiene sus propias
	// opciones en la lista, así que el que NO tenga el valor actual entre sus opciones queda
	// deseleccionado solo (sin lógica extra) — no hace falta limpiar los otros 6 a mano al elegir uno.
	const TIPOS_GASTO_CONSULTORIA: { key: string; label: string; opciones: string[] }[] = [
		{ key: 'honorarios', label: 'Honorarios', opciones: ['Oficina Técnica', 'Honorarios Firma', 'Comisión Ventas', 'Gestor(a) de Proyectos', 'Otros Honorarios'] },
		{ key: 'alquileres', label: 'Alquileres', opciones: ['Otros Alquiler'] },
		{ key: 'servicios', label: 'Servicios', opciones: ['Internet', 'Imprenta', 'Almacenamiento', 'Municipalidad', 'Sunarp', 'Otros Servicios'] },
		{ key: 'sub_contrata', label: 'Sub Contrata', opciones: ['Calicatas', 'Ensayos Laboratorio', 'Equipo Topográfico', 'Otros Subcontratos'] },
		{ key: 'compras', label: 'Compras', opciones: ['Útiles de Limpieza', 'Útiles de Oficina', 'Alimentos', 'Peajes', 'Festividad', 'Ferretería', 'Otras Compras'] },
		{ key: 'movilidad', label: 'Movilidad', opciones: ['Visita Técnica', 'Envíos y Recojos', 'Otras Movilidades'] },
		{ key: 'impuestos', label: 'Impuestos', opciones: ['Detracción', 'Otros Impuestos'] }
	];

	// Mismo patrón que TIPOS_GASTO_CONSULTORIA (comparten formValues.tipo_gasto — son mutuamente
	// excluyentes, un proyecto nunca es Obra y Consultoría a la vez), pero para Egreso en proyectos de
	// Obra, con su propio cuadro de referencia (catálogo mucho más detallado por partida de obra).
	const TIPOS_GASTO_OBRA: { key: string; label: string; opciones: string[] }[] = [
		{
			key: 'sub_contrata',
			label: 'Sub Contrata',
			opciones: [
				'Maestro de Obra Principal',
				'Movimiento Tierras',
				'Movimiento Desmonte',
				'Transporte Madera y Puntales',
				'Inspección de Obra',
				'Alquiler de Herramientas',
				'Demolición',
				'Oficial',
				'Peón',
				'Ayudante',
				'Eléctrico',
				'Otras Subcontratos'
			]
		},
		{
			key: 'material',
			label: 'Material',
			opciones: [
				'Acero 3/4"',
				'Acero 5/8"',
				'Acero 1/2"',
				'Acero 3/8"',
				'Acero 8mm',
				'Acero 6mm',
				'Premezclado',
				'Ladrillo',
				'Concreto',
				'Arena',
				'Confitillo',
				'Piedra Chancada',
				'Adhesivos Epóxicos',
				'Otros Materiales'
			]
		},
		{ key: 'servicios_obra', label: 'Servicios', opciones: ['Ensayos Laboratorio', 'Movilidad', 'Multas', 'Sindicato', 'Portátil SSHH', 'SCTR', 'IGV', 'Otros Servicios'] },
		{ key: 'honorarios_obra', label: 'Honorarios', opciones: ['Residente', 'Soma', 'Calidad', 'Otros Honorarios'] },
		{ key: 'equipos', label: 'Equipos', opciones: ['Compactadora', 'Vibradora', 'Winche', 'Buggies', 'Otros Equipos'] },
		{ key: 'compras_obra', label: 'Compras', opciones: ['EPPS', 'Festividad', 'Equipo de Seguridad', 'Malla Raschel', 'Seguridad', 'Otras Compras'] },
		{ key: 'gastos_generales', label: 'Gastos Generales', opciones: ['Implementación de Oficina de Obra', 'Implementación de Almacén', 'Otros Gastos Generales'] }
	];

	// Categoría en cascada para Obra + Egreso, a pedido explícito del usuario: primer dropdown = grupo
	// (mismas columnas de TIPOS_GASTO_OBRA), segundo dropdown = la opción de ese grupo, que se guarda
	// directo en formValues.categoria. categoriaObraGrupo es puro estado de UI (no se persiste); al
	// editar una transacción existente se reconstruye buscando en qué grupo cae el valor ya guardado.
	let categoriaObraGrupo = $state('');
	const categoriaObraGrupoEfectivo = $derived.by(() => {
		if (categoriaObraGrupo) return categoriaObraGrupo;
		return TIPOS_GASTO_OBRA.find((g) => g.opciones.includes(formValues.categoria))?.key ?? '';
	});
	function handleCategoriaObraGrupoChange(value: string) {
		categoriaObraGrupo = value;
		handleInput('categoria', '');
	}

	// Mismo patrón que TIPOS_GASTO_OBRA/TIPOS_GASTO_CONSULTORIA (comparten formValues.tipo_gasto — un
	// Centro de Costo nunca es Corporativo y a la vez Obra/Consultoría), pero para "Corporativo"
	// (Centro de Costo tipo 'bolsa general'), con su propio cuadro de referencia.
	const TIPOS_GASTO_CORPORATIVO: { key: string; label: string; opciones: string[] }[] = [
		{ key: 'honorarios_corp', label: 'Honorarios', opciones: ['Administración', 'Gestión de Obra', 'Coordinación de Obra', 'Comercial', 'Marketing', 'Oficina Técnica'] },
		{ key: 'alquileres_corp', label: 'Alquileres', opciones: ['Oficina'] },
		{ key: 'servicios_corp', label: 'Servicios', opciones: ['Agua y Luz', 'Mantenimiento Ascensor', 'Publicidad', 'Emergencia', 'Limpieza', 'Otros Servicios'] },
		{ key: 'prestamo', label: 'Préstamo', opciones: ['Tarjeta de Crédito Pierina', 'Tarjeta de Primo de Willy'] },
		{ key: 'compras_corp', label: 'Compras', opciones: ['Comida', 'Otras Compras'] },
		{ key: 'movilidad_corp', label: 'Movilidad', opciones: ['Prospectos de Ventas', 'Oficina', 'Producción'] },
		{ key: 'impuestos_corp', label: 'Impuestos', opciones: ['IGV', 'Renta', 'Tasas Muni'] },
		{ key: 'inversion', label: 'Inversión', opciones: ['Capacitación', 'Mantenimiento Equipos', 'Año Nuevo y Navidad', 'Implementación Oficina'] }
	];

	const cuentaDestinoEsBancaria = $derived(bloqueadoPorInterna || (formValues.tipo_alcance === 'externa' && formValues.tipo === 'ingreso'));
	const cuentaOrigenEsBancaria = $derived(bloqueadoPorInterna || (formValues.tipo_alcance === 'externa' && formValues.tipo === 'egreso'));
	// Efectivo ('1') o Yape o Plin ('4') no pasan por ninguna cuenta bancaria — a pedido del usuario,
	// Cuenta Origen y Cuenta Destino se bloquean (y se limpian, ver handleInput) en ambos casos.
	const cuentasBloqueadasPorMedioPago = $derived(['1', '4'].includes(String(formValues.medio_pago ?? '')));
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

	/** Quita el prefijo "código del centro de costo - " de cada opción (ej. "PROY-83 - OBRA_...",
	 * "CLI-25 - Empresa 5") — a pedido explícito del usuario, Origen/Destino de Transacción ya no
	 * muestran el código del centro de costo, solo el nombre/código del proyecto (o cliente/proveedor/
	 * empleado) vinculado. Las etiquetas siempre vienen armadas como "{codigo} - {nombre}" (ver
	 * centroCostoOptionLabel en transacciones.service.ts), así que basta con cortar hasta el primer
	 * " - ". Si por alguna razón una opción no tuviera ese separador, se deja tal cual. */
	function soloNombreCentro(opciones: FieldOption[]): FieldOption[] {
		return opciones.map((o) => {
			const idx = o.label.indexOf(' - ');
			return idx === -1 ? o : { ...o, label: o.label.slice(idx + 3) };
		});
	}

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
			// A pedido explícito del usuario: en el <select> ya no se muestra el código del CENTRO DE
			// COSTO (ej. "PROY-83 - ...", "CLI-25 - ...") — solo el nombre/código del proyecto (o
			// cliente/proveedor/empleado) vinculado, ver soloNombreCentro más abajo.
			if (lockedFields.includes(field.key)) return soloNombreCentro(dynamicOptions[field.key] || []);
			// Excepciones a pedido del usuario, todas en Externa:
			// - Ingreso: "Centro de Costo Origen" muestra la lista de CLIENTES (antes mostraba "solo
			//   proyectos", igual que Interna) y "Centro de Costo Destino", en cascada, solo los
			//   PROYECTOS del cliente elegido en Origen (ver centroCostoClienteIdMap más arriba) — vacío
			//   mientras no se haya elegido un cliente todavía.
			// - Egreso: "Centro de Costo Origen" usa "Centro de Costos" en su sentido estricto (proyectos
			//   y corporativo — ver getCentroCostoOptionsSoloCentros, misma definición que el tab "Centro
			//   de Costos" del submódulo Centro de Costos y Cuentas Internas) y "Centro de Costo Destino"
			//   muestra "Cuentas Internas" (proveedor/empleado/cliente), filtradas por el selector
			//   "Clase" que aparece entre ambos campos (ver claseDestino/OPCIONES_CLASE_DESTINO) — vacío
			//   mientras no se haya elegido una Clase todavía.
			if (formValues.tipo === 'ingreso' && formValues.tipo_alcance === 'externa') {
				if (field.key === 'id_centro_costo_origen') return soloNombreCentro(centroCostoOptionsClientes);
				const idCliente = centroCostoClienteIdMap[formValues.id_centro_costo_origen] ?? null;
				if (!idCliente) return [];
				return soloNombreCentro((dynamicOptions.id_centro_costo_destino || []).filter((opt) => centroCostoClienteIdMap[opt.value] === idCliente));
			}
			if (formValues.tipo === 'egreso' && formValues.tipo_alcance === 'externa') {
				if (field.key === 'id_centro_costo_origen') return soloNombreCentro(dynamicOptions.id_centro_costo_destino_solo_centros || []);
				if (claseDestino === 'proveedores') return soloNombreCentro(centroCostoOptionsProveedores);
				if (claseDestino === 'empleados') return soloNombreCentro(centroCostoOptionsEmpleados);
				if (claseDestino === 'cliente') return soloNombreCentro(centroCostoOptionsClientes);
				return [];
			}
			const key = formValues.tipo_alcance === 'externa' ? `${field.key}_externo` : field.key;
			return soloNombreCentro(dynamicOptions[key] || []);
		}
		if (field.key === 'cuente_destino' && cuentaDestinoEsBancaria) return dynamicOptions.cuenta_banco || [];
		if (field.key === 'cuente_origen' && cuentaOrigenEsBancaria) return dynamicOptions.cuenta_banco || [];
		if (field.key === 'categoria' && esConfirmarCobro) return CATEGORIA_CONFIRMAR_COBRO;
		if (field.key === 'categoria' && esProyectoDeObra && formValues.tipo === 'ingreso') return CATEGORIA_OBRA_INGRESO;
		if (field.key === 'categoria' && esProyectoDeObra && formValues.tipo === 'egreso') return CATEGORIA_OBRA_EGRESO;
		if (field.key === 'categoria' && esCorporativo && formValues.tipo === 'ingreso') return CATEGORIA_CORPORATIVO_INGRESO;
		if (field.key === 'categoria' && esCorporativo && formValues.tipo === 'egreso') return CATEGORIA_CORPORATIVO_EGRESO;
		if (field.optionsWhen) return field.optionsWhen(formValues);
		return (field.optionsSource && dynamicOptions[field.key]) || field.options || [];
	}

	/** Etiqueta del campo — normalmente `field.label` tal cual, salvo Origen/Destino en Ingreso+Externa:
	 * como ahí muestran clientes/proyectos (ver optionsFor), a pedido explícito del usuario la etiqueta
	 * también cambia para reflejar lo que de verdad se está eligiendo. */
	function labelFor(field: (typeof formFields)[number]): string {
		if (formValues.tipo === 'ingreso' && formValues.tipo_alcance === 'externa') {
			if (field.key === 'id_centro_costo_origen') return 'Cliente';
			if (field.key === 'id_centro_costo_destino') return 'Proyecto';
		}
		return field.label;
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
					const uploaded = await subirArchivo(comprobanteFile, baseName);
					finalComprobanteUrl = uploaded.url;
					uploadedFileId = uploaded.fileId;
					if (mode === 'edit' && transaccion?.comprobante_url) {
						oldFileIdToDelete = extractDriveFileId(transaccion.comprobante_url);
					}
				} finally {
					uploadingComprobante = false;
				}
			}

			let finalFacturaUrl = facturaUrl;
			let uploadedFacturaFileId: string | null = null;
			let oldFacturaFileIdToDelete: string | null = null;

			if (facturaFile) {
				uploadingFactura = true;
				try {
					const baseName = mode === 'edit' && transaccion ? `factura-${transaccion.id_transaccion}` : `factura-temp-${Date.now()}`;
					const uploaded = await subirArchivo(facturaFile, baseName);
					finalFacturaUrl = uploaded.url;
					uploadedFacturaFileId = uploaded.fileId;
					if (mode === 'edit' && transaccion?.factura_url) {
						oldFacturaFileIdToDelete = extractDriveFileId(transaccion.factura_url);
					}
				} finally {
					uploadingFactura = false;
				}
			}

			const payload = { ...formValues, comprobante_url: finalComprobanteUrl, factura_url: finalFacturaUrl };

			let result;
			if (onConfirm) {
				result = await onConfirm(payload);
			} else if (mode === 'edit' && transaccion) {
				result = await updateTransaccion(supabase, transaccion.id_transaccion, payload, isAdmin());
			} else if (cuentaVinculadaSeleccionada && colaArchivos.length <= 1 && formValues.tipo === 'egreso') {
				const { data: userData } = await supabase.auth.getUser();
				result = await registrarPagoDesdeTransaccion(
					supabase,
					cuentaVinculadaSeleccionada.id,
					payload,
					userData?.user?.email ?? null,
					permisosState.userName || null
				);
			} else if (cuentaVinculadaSeleccionada && colaArchivos.length <= 1 && formValues.tipo === 'ingreso') {
				const { data: userData } = await supabase.auth.getUser();
				result = await registrarCobroDesdeTransaccion(
					supabase,
					cuentaVinculadaSeleccionada.id,
					payload,
					userData?.user?.email ?? null,
					permisosState.userName || null
				);
			} else {
				const { data: userData } = await supabase.auth.getUser();
				result = await createTransaccion(supabase, payload, userData?.user?.email ?? null, permisosState.userName || null);
			}

			if (result.success) {
				// Housekeeping en Drive — mejor esfuerzo: si algo de esto falla no se muestra como error,
				// el guardado ya se completó correctamente.
				try {
					const idNuevo = (result.data as any)?.id_transaccion;
					if (uploadedFileId && mode !== 'edit' && idNuevo) {
						await renombrarArchivo(uploadedFileId, `comprobante-${idNuevo}${fileExt(comprobanteFile!.name)}`);
					}
					if (oldFileIdToDelete && oldFileIdToDelete !== uploadedFileId) {
						await borrarArchivo(oldFileIdToDelete);
					}
					if (uploadedFacturaFileId && mode !== 'edit' && idNuevo) {
						await renombrarArchivo(uploadedFacturaFileId, `factura-${idNuevo}${fileExt(facturaFile!.name)}`);
					}
					if (oldFacturaFileIdToDelete && oldFacturaFileIdToDelete !== uploadedFacturaFileId) {
						await borrarArchivo(oldFacturaFileIdToDelete);
					}
				} catch (housekeepingErr) {
					console.warn('[TransaccionModal] No se pudo renombrar/limpiar los archivos en Drive:', housekeepingErr);
				}

				// "Detalle de la categoría" (ver detalleCategoria más arriba) — se guarda TODO junto recién
				// acá, ya con el id_transaccion real (en 'create' no existía hasta este punto). Mejor
				// esfuerzo: si falla, no se revierte el guardado principal de la transacción, ya completado.
				try {
					const idParaDetalle = (result.data as any)?.id_transaccion;
					if (idParaDetalle) {
						await sincronizarDetalleCategoria(
							supabase,
							idParaDetalle,
							detalleCategoria.filter((f) => f.subcategoria.trim())
						);
					}
				} catch (detalleErr) {
					console.warn('[TransaccionModal] No se pudo guardar el detalle de categoría:', detalleErr);
				}

				// Cola de varios comprobantes: esta transacción ya quedó guardada de verdad, así que se
				// avanza al siguiente borrador en vez de cerrar el modal — a pedido del usuario.
				const hayMasEnCola = colaArchivos.length > 1 && colaIndex < colaArchivos.length - 1;
				if (hayMasEnCola) {
					toast.success(`Transacción ${colaIndex + 1} de ${colaArchivos.length} guardada.`);
					const { [colaIndex]: _omitido, ...restoDrafts } = colaDrafts;
					colaDrafts = restoDrafts;
					colaIndex += 1;
					facturaFile = null;
					facturaUrl = null;
					cargarDraft(colaIndex);
				} else {
					toast.success(result.message ?? 'Operación realizada con éxito');
					onSaved();
					onClose();
				}
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

{#snippet fieldBlock(field: (typeof formFields)[number])}
	{@const isLocked = lockedFields.includes(field.key)}
	{@const isBloqueadoInterna = bloqueadoPorInterna && CAMPOS_BLOQUEADOS_POR_INTERNA.has(field.key)}
	{@const isBloqueadoPorMedioPago = cuentasBloqueadasPorMedioPago && (field.key === 'cuente_origen' || field.key === 'cuente_destino')}
	{@const isDisabled = bloqueadaPorAprobacion || isLocked || isBloqueadoInterna || isBloqueadoPorMedioPago}
	<div>
		<label for={`tr-${field.key}`} class="flex items-center gap-1 text-sm font-bold text-[#0f3b5e] mb-1">
			{labelFor(field)}
			{#if field.required}<span class="text-red-500">*</span>{/if}
			{#if isLocked || isBloqueadoInterna || isBloqueadoPorMedioPago}<Lock size={12} class="text-slate-400" />{/if}
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
		{:else if isBloqueadoPorMedioPago}
			<p class="mt-1 text-xs text-slate-400">Se bloquea porque el Medio de Pago no pasa por una cuenta bancaria.</p>
		{:else if (field.key === 'cuente_destino' && cuentaDestinoEsBancaria) || (field.key === 'cuente_origen' && cuentaOrigenEsBancaria)}
			<p class="mt-1 text-xs text-slate-400">Se elige entre las cuentas bancarias registradas (Finanzas → Cuentas Bancarias).</p>
		{:else if field.helpText}
			<p class="mt-1 text-xs text-slate-400">{field.helpText}</p>
		{/if}
	</div>
{/snippet}

{#if open}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
			<div class="sticky top-0 flex items-center justify-between bg-white px-6 py-4 border-b border-slate-200 z-10">
				<h2 class="text-lg font-semibold text-[#0f3b5e]">{title}</h2>
				<button type="button" onclick={onClose} class="p-1 hover:bg-slate-100 rounded-full text-slate-500" aria-label="Cerrar">
					<X size={20} />
				</button>
			</div>

			<form onsubmit={handleSubmit}>
				<div class="p-6 flex flex-col gap-5">
					{#if mode === 'edit' && transaccion}
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
					{/if}

					<!-- Alcance de la Transacción -->
					<div>
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

					<!-- A pedido del usuario: nuevo diseño con el comprobante a la izquierda (arriba en celular)
					     y los campos núcleo agrupados en una tarjeta con borde a la derecha — antes todo iba
					     apilado a lo ancho completo. Responsive: flex-col en mobile (dropzone arriba, campos
					     abajo, cada fila de campos ya colapsa a 1 columna con sm:grid-cols-3), flex-row desde
					     md: con el dropzone a la izquierda con ancho fijo y alto estirado a la misma altura
					     que la columna de campos (items-stretch, default de flexbox). -->
					<div class="rounded-2xl border border-slate-200 p-5">
						<h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Datos de la Transacción</h3>
						<div class="flex flex-col md:flex-row gap-5">
							<!-- Tipo + Adjuntar boucher de pago — a pedido explícito del usuario: el campo Tipo
							     se muestra junto al comprobante, antes que el resto de los campos núcleo. -->
							<div class="md:w-56 shrink-0 flex flex-col gap-4">
								{@render fieldBlock(tipoField)}
								<div class="flex flex-col flex-1">
								<label class="block text-sm font-bold text-[#0f3b5e] mb-1">
									Adjuntar boucher de pago <span class="text-red-500">*</span>
								</label>
								<label
									for="tr-comprobante"
									ondragover={(e) => e.preventDefault()}
									ondrop={onComprobanteDrop}
									class={`relative flex flex-col items-center justify-center gap-2 w-full h-36 md:h-auto md:flex-1 min-h-[9rem] rounded-xl border-2 border-dashed text-center overflow-hidden transition-colors p-3 ${bloqueadaPorAprobacion ? 'opacity-60 cursor-not-allowed bg-slate-50' : 'cursor-pointer hover:bg-slate-50'} ${comprobanteError ? 'border-red-400' : 'border-slate-300'}`}
								>
									{#if localPreviewUrl}
										<img src={localPreviewUrl} alt="Vista previa del comprobante" class="absolute inset-0 w-full h-full object-cover" />
										<div class="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[11px] font-medium px-2 py-1.5 flex items-center justify-center gap-1">
											<CloudUpload size={12} class="shrink-0" /> Nuevo archivo seleccionado
										</div>
									{:else if comprobanteUrl && !comprobanteFile}
										<img
											src={comprobanteThumbUrl}
											alt="Comprobante actual"
											class="absolute inset-0 w-full h-full object-cover"
											onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
										/>
										<div class="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[11px] font-medium px-2 py-1.5 flex items-center justify-center gap-1 text-center">
											<CloudUpload size={12} class="shrink-0" /> Haz clic o arrastra para reemplazar
										</div>
									{:else if comprobanteFile}
										<CloudUpload size={28} class="text-blue-400" />
										<span class="text-xs font-medium text-slate-700 leading-tight px-1 line-clamp-2 break-all">{comprobanteFile.name}</span>
									{:else}
										<CloudUpload size={32} class="text-blue-400" />
										<span class="text-sm font-medium text-slate-600 leading-tight">Arrastra o selecciona un archivo</span>
										<span class="text-xs text-slate-400">JPG, PNG o PDF (máx. 5MB)</span>
									{/if}
								</label>
								<div class="flex flex-col gap-1 mt-1.5">
									{#if comprobanteUrl && !comprobanteFile}
										<button type="button" onclick={() => (showComprobantePreview = true)} class="text-xs text-blue-600 hover:underline text-left w-fit">
											Ver comprobante actual
										</button>
									{/if}
									{#if comprobanteError}
										<p class="text-xs text-red-600">{comprobanteError}</p>
									{:else if comprobanteFile || comprobanteUrl}
										<p class="text-xs text-slate-400">Toda transacción debe tener un comprobante de respaldo.</p>
									{/if}
								</div>
								<input
									id="tr-comprobante"
									type="file"
									accept="image/*,application/pdf"
									multiple={mode === 'create' && !onConfirm}
									class="hidden"
									disabled={bloqueadaPorAprobacion}
									onchange={onComprobanteChange}
								/>
								</div>
							</div>

							<!-- Campos núcleo: Centro de costo origen/destino, Cuenta origen/destino,
							     Fecha/Monto (reconocidos) — Tipo se movió junto al comprobante, ver arriba. -->
							<div class="flex-1 flex flex-col gap-4 min-w-0">
								<!-- grid-cols-2 (no -3): estas dos filas siempre traen exactamente un par de
								     campos — a diferencia de la fila de abajo (3 reconocidos), forzarlas a 3
								     columnas dejaba un hueco vacío a la derecha, ver pedido del usuario. -->
								<div class={`grid grid-cols-1 gap-4 ${formValues.tipo === 'egreso' ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
									{@render fieldBlock(origenField)}
									{#if formValues.tipo === 'egreso'}
										<div>
											<label for="tr-clase-destino" class="text-sm font-bold text-[#0f3b5e] mb-1 block">Clase</label>
											<select
												id="tr-clase-destino"
												value={claseDestino}
												disabled={bloqueadaPorAprobacion}
												onchange={(e) => handleClaseDestinoChange((e.target as HTMLSelectElement).value)}
												class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60 disabled:bg-slate-50"
											>
												<option value="" disabled>Selecciona una opción</option>
												{#each OPCIONES_CLASE_DESTINO as opt}
													<option value={opt.value}>{opt.label}</option>
												{/each}
											</select>
											<p class="mt-1 text-xs text-slate-400">Clasifica qué muestra Centro de Costo Destino.</p>
										</div>
									{/if}
									{@render fieldBlock(destinoField)}
								</div>

								<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
									{@render fieldBlock(cuentaOrigenField)}
									{@render fieldBlock(cuentaDestinoField)}
								</div>

								<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
									<div>
										<label for="tr-fecha" class="flex items-center gap-1 text-sm font-bold text-[#0f3b5e] mb-1">
											Fecha (reconocida) <span class="text-red-500">*</span>
											{#if ocrLoading}<Loader2 size={12} class="animate-spin text-slate-400" />{/if}
										</label>
										<div class="flex items-center gap-2">
											<input
												id="tr-fecha"
												type="date"
												value={formValues.fecha}
												disabled={fechaLocked || bloqueadaPorAprobacion}
												oninput={(e) => handleInput('fecha', (e.target as HTMLInputElement).value)}
												class={`flex-1 min-w-0 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:opacity-70 disabled:bg-slate-50 ${fieldErrors.fecha ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
											/>
											<button
												type="button"
												onclick={() => (fechaLocked = false)}
												disabled={bloqueadaPorAprobacion || !fechaLocked}
												title="Editar fecha"
												aria-label="Editar fecha"
												class="shrink-0 p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
											>
												<Pencil size={14} />
											</button>
										</div>
										{#if fieldErrors.fecha}
											<p class="mt-1 text-xs text-red-600">{fieldErrors.fecha}</p>
										{:else if fechaLocked}
											<p class="mt-1 text-xs text-slate-400">Valor reconocido automáticamente. Edita si hay algún error.</p>
										{/if}
									</div>
									<div>
										<label for="tr-monto" class="flex items-center gap-1 text-sm font-bold text-[#0f3b5e] mb-1">
											Monto (reconocido) <span class="text-red-500">*</span>
											{#if ocrLoading}<Loader2 size={12} class="animate-spin text-slate-400" />{/if}
										</label>
										<div class="flex items-center gap-2">
											<input
												id="tr-monto"
												type="text"
												inputmode="decimal"
												value={formValues.monto_total}
												disabled={montoLocked || bloqueadaPorAprobacion}
												oninput={(e) => handleInput('monto_total', (e.target as HTMLInputElement).value)}
												placeholder="0.00"
												class={`flex-1 min-w-0 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:opacity-70 disabled:bg-slate-50 ${fieldErrors.monto_total ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
											/>
											<button
												type="button"
												onclick={() => (montoLocked = false)}
												disabled={bloqueadaPorAprobacion || !montoLocked}
												title="Editar monto"
												aria-label="Editar monto"
												class="shrink-0 p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
											>
												<Pencil size={14} />
											</button>
										</div>
										{#if formValues.monto_total && !fieldErrors.monto_total}
											<p class="mt-1 text-xs text-slate-500">{formatCurrency(formValues.monto_total)}</p>
										{/if}
										{#if fieldErrors.monto_total}
											<p class="mt-1 text-xs text-red-600">{fieldErrors.monto_total}</p>
										{:else if montoLocked}
											<p class="mt-1 text-xs text-slate-400">Valor reconocido automáticamente. Edita si hay algún error.</p>
										{/if}
									</div>
									<div>
										<label for="tr-num-operacion" class="flex items-center gap-1 text-sm font-bold text-[#0f3b5e] mb-1 whitespace-nowrap">
											N° de Operación
											{#if ocrLoading}<Loader2 size={12} class="animate-spin text-slate-400" />{/if}
										</label>
										<div class="flex items-center gap-2">
											<input
												id="tr-num-operacion"
												type="text"
												value={formValues.num_operacion}
												disabled={numOperacionLocked || bloqueadaPorAprobacion}
												oninput={(e) => handleInput('num_operacion', (e.target as HTMLInputElement).value)}
												placeholder="N° de operación"
												class={`flex-1 min-w-0 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:opacity-70 disabled:bg-slate-50 ${fieldErrors.num_operacion ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
											/>
											<button
												type="button"
												onclick={() => (numOperacionLocked = false)}
												disabled={bloqueadaPorAprobacion || !numOperacionLocked}
												title="Editar N° de operación"
												aria-label="Editar N° de operación"
												class="shrink-0 p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
											>
												<Pencil size={14} />
											</button>
										</div>
										{#if fieldErrors.num_operacion}
											<p class="mt-1 text-xs text-red-600">{fieldErrors.num_operacion}</p>
										{:else if numOperacionLocked}
											<p class="mt-1 text-xs text-slate-400">Valor reconocido automáticamente. Edita si hay algún error.</p>
										{:else}
											<p class="mt-1 text-xs text-slate-400">Opcional — se completa sola si el boucher lo muestra.</p>
										{/if}
									</div>
								</div>
							</div>
						</div>
					</div>

					<!-- Otros campos (opcionales) -->
					<div class="rounded-2xl border border-slate-200 p-5">
						<div class="flex items-center justify-between flex-wrap gap-2">
							<button
								type="button"
								onclick={() => (otrosCamposAbierto = !otrosCamposAbierto)}
								class="flex items-center gap-1.5 text-sm font-bold text-blue-600"
							>
								Otros campos (opcionales)
								{#if otrosCamposAbierto}<ChevronUp size={16} />{:else}<ChevronDown size={16} />{/if}
							</button>

							{#if colaArchivos.length > 1}
								<div class="flex items-center gap-2">
									<button
										type="button"
										onclick={irAAnterior}
										disabled={colaIndex === 0}
										title="Comprobante anterior"
										aria-label="Comprobante anterior"
										class="w-8 h-8 rounded-full border border-slate-300 flex items-center justify-center text-slate-500 hover:bg-slate-100 disabled:opacity-40"
									>
										<ChevronLeft size={16} />
									</button>
									<span class="text-xs text-slate-500 font-medium">{colaIndex + 1} de {colaArchivos.length}</span>
									<button
										type="button"
										onclick={irASiguiente}
										disabled={colaIndex === colaArchivos.length - 1}
										title="Comprobante siguiente"
										aria-label="Comprobante siguiente"
										class="w-8 h-8 rounded-full border border-slate-300 flex items-center justify-center text-slate-500 hover:bg-slate-100 disabled:opacity-40"
									>
										<ChevronRight size={16} />
									</button>
								</div>
							{/if}
						</div>

						{#if otrosCamposAbierto}
							<div class="mt-4 flex flex-col gap-4">
								<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
									{#if esProyectoDeObra && formValues.tipo === 'egreso'}
										<!-- Categoría en cascada (Obra + Egreso), a pedido explícito del usuario: primer
										     dropdown = grupo (columnas de la tabla de referencia), segundo dropdown = la
										     opción de ese grupo — reemplaza al antiguo bloque "Tipo de Gasto" de 7
										     dropdowns paralelos (ver TIPOS_GASTO_OBRA/categoriaObraGrupo más arriba). -->
										<div>
											<label for="tr-categoria-obra-grupo" class="flex items-center gap-1 text-sm font-bold text-[#0f3b5e] mb-1">
												Categoría<span class="text-red-500">*</span>
											</label>
											<div class="grid grid-cols-2 gap-2">
												<select
													id="tr-categoria-obra-grupo"
													value={categoriaObraGrupoEfectivo}
													disabled={bloqueadaPorAprobacion}
													onchange={(e) => handleCategoriaObraGrupoChange((e.target as HTMLSelectElement).value)}
													class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60 disabled:bg-slate-50"
												>
													<option value="">Categoría</option>
													{#each TIPOS_GASTO_OBRA as grupo}
														<option value={grupo.key}>{grupo.label}</option>
													{/each}
												</select>
												<select
													id="tr-categoria-obra-subcategoria"
													value={formValues.categoria}
													disabled={bloqueadaPorAprobacion || !categoriaObraGrupoEfectivo}
													onchange={(e) => handleInput('categoria', (e.target as HTMLSelectElement).value)}
													class={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:opacity-60 disabled:bg-slate-50 ${fieldErrors.categoria ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
												>
													<option value="">Subcategoría</option>
													{#each TIPOS_GASTO_OBRA.find((g) => g.key === categoriaObraGrupoEfectivo)?.opciones ?? [] as opt}
														<option value={opt}>{opt}</option>
													{/each}
												</select>
											</div>
											{#if fieldErrors.categoria}<p class="mt-1 text-xs text-red-500">{fieldErrors.categoria}</p>{/if}
										</div>
									{:else}
										{@render fieldBlock(categoriaField)}
									{/if}
									{@render fieldBlock(tipoDocumentoField)}
									{@render fieldBlock(numDocumentoField)}
								</div>
								<!-- grid-cols-2 salvo que el tercer campo (Vincular con Cuenta por Pagar/Cobrar)
								     vaya a aparecer — igual que Origen/Clase/Destino más arriba, forzar 3 columnas
								     cuando ese campo no se muestra deja un hueco vacío a la derecha. -->
								<div class={`grid grid-cols-1 gap-4 ${mode === 'create' && !onConfirm && colaArchivos.length <= 1 && (formValues.tipo === 'egreso' || formValues.tipo === 'ingreso') ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
									{@render fieldBlock(formaPagoField)}
									{@render fieldBlock(medioPagoField)}
									{#if mode === 'create' && !onConfirm && colaArchivos.length <= 1 && (formValues.tipo === 'egreso' || formValues.tipo === 'ingreso')}
										<div class="relative">
											<label for="tr-cuenta-vinculada" class="block text-sm font-bold text-[#0f3b5e] mb-1">
												Vincular con Cuenta por {formValues.tipo === 'egreso' ? 'Pagar' : 'Cobrar'}
											</label>
											{#if cuentaVinculadaSeleccionada}
												<div class="flex items-center justify-between gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm">
													<div class="min-w-0">
														<p class="font-medium text-blue-800 truncate">{cuentaVinculadaSeleccionada.label}</p>
														<p class="text-xs text-blue-600">Saldo: {formatCurrency(cuentaVinculadaSeleccionada.saldo)}</p>
													</div>
													<button
														type="button"
														onclick={limpiarCuentaVinculada}
														class="shrink-0 p-1 rounded-full text-blue-600 hover:bg-blue-100"
														aria-label="Quitar vínculo"
														title="Quitar vínculo"
													>
														<X size={14} />
													</button>
												</div>
											{:else}
												<input
													id="tr-cuenta-vinculada"
													type="text"
													value={cuentaVinculadaBusqueda}
													oninput={onCuentaVinculadaInput}
													onfocus={onCuentaVinculadaFocus}
													onblur={onCuentaVinculadaBlur}
													placeholder="Buscar proveedor/cliente, N° doc. o ID…"
													autocomplete="off"
													class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
												/>
												{#if cuentaVinculadaAbierta}
													<div class="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
														{#if cuentaVinculadaBuscando}
															<p class="px-3 py-2 text-xs text-slate-400 flex items-center gap-1.5">
																<Loader2 size={12} class="animate-spin" /> Buscando…
															</p>
														{:else if cuentaVinculadaResultados.length === 0}
															<p class="px-3 py-2 text-xs text-slate-400">Sin cuentas con saldo pendiente que coincidan.</p>
														{:else}
															{#each cuentaVinculadaResultados as opcion (opcion.id)}
																<button
																	type="button"
																	onclick={() => seleccionarCuentaVinculada(opcion)}
																	class="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0"
																>
																	<p class="font-medium text-slate-700 truncate">{opcion.label}</p>
																	<p class="text-xs text-slate-400">Saldo: {formatCurrency(opcion.saldo)}</p>
																</button>
															{/each}
														{/if}
													</div>
												{/if}
												<p class="mt-1 text-xs text-slate-400">Opcional — registra un pago/cobro real contra esa cuenta.</p>
											{/if}
										</div>
									{/if}
								</div>
								<!-- Tipo de Gasto — 7 dropdowns propios, a pedido explícito del usuario, solo para
								     Egreso en proyectos de Consultoría (ver TIPOS_GASTO_CONSULTORIA/esProyectoDeConsultoria).
								     Va ANTES que Factura/Descripción/Estado (a pedido del usuario, esos tres bajan
								     al final del todo, ver más abajo). -->
								{#if esProyectoDeConsultoria && formValues.tipo === 'egreso'}
									<div>
										<span class="block text-sm font-bold text-[#0f3b5e] mb-1">Tipo de Gasto</span>
										<div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
											{#each TIPOS_GASTO_CONSULTORIA as grupo}
												<div>
													<label for={`tr-tipo-gasto-${grupo.key}`} class="block text-xs font-semibold text-slate-500 mb-1">{grupo.label}</label>
													<select
														id={`tr-tipo-gasto-${grupo.key}`}
														value={formValues.tipo_gasto}
														disabled={bloqueadaPorAprobacion}
														onchange={(e) => handleInput('tipo_gasto', (e.target as HTMLSelectElement).value)}
														class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60 disabled:bg-slate-50"
													>
														<option value="">Selecciona una opción</option>
														{#each grupo.opciones as opt}
															<option value={opt}>{opt}</option>
														{/each}
													</select>
												</div>
											{/each}
										</div>
									</div>
								{/if}

								<!-- Para Obra + Egreso, el desglose "Tipo de Gasto" (7 dropdowns) fue REEMPLAZADO por
								     Categoría en cascada (ver el bloque de Categoría más arriba, categoriaObraGrupo/
								     TIPOS_GASTO_OBRA) a pedido explícito del usuario — evita capturar el mismo dato
								     dos veces. TIPOS_GASTO_OBRA se sigue usando como fuente de datos de esa cascada. -->

								<!-- Tipo de Gasto — 7 dropdowns propios, a pedido explícito del usuario, para Centro
								     de Costo "Corporativo" (tipo 'bolsa general', ver TIPOS_GASTO_CORPORATIVO/
								     esCorporativo) y solo para Egreso (un Ingreso — Inyecciones/Préstamo — no tiene
								     "gasto" que clasificar) — mutuamente excluyente con Obra/Consultoría de arriba.
								     También va ANTES de Factura/Descripción/Estado. -->
								{#if esCorporativo && formValues.tipo === 'egreso'}
									<div>
										<span class="block text-sm font-bold text-[#0f3b5e] mb-1">Tipo de Gasto</span>
										<div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
											{#each TIPOS_GASTO_CORPORATIVO as grupo}
												<div>
													<label for={`tr-tipo-gasto-${grupo.key}`} class="block text-xs font-semibold text-slate-500 mb-1">{grupo.label}</label>
													<select
														id={`tr-tipo-gasto-${grupo.key}`}
														value={formValues.tipo_gasto}
														disabled={bloqueadaPorAprobacion}
														onchange={(e) => handleInput('tipo_gasto', (e.target as HTMLSelectElement).value)}
														class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60 disabled:bg-slate-50"
													>
														<option value="">Selecciona una opción</option>
														{#each grupo.opciones as opt}
															<option value={opt}>{opt}</option>
														{/each}
													</select>
												</div>
											{/each}
										</div>
									</div>
								{/if}

								<!-- A pedido explícito del usuario: Adjuntar factura/Descripción/Estado van al FINAL
								     de "Otros campos", después de Tipo de Gasto — 3 columnas iguales, simétrico. -->
								<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
									<div>
										<label class="block text-sm font-bold text-[#0f3b5e] mb-1">Adjuntar factura o boleta de venta</label>
										<div class="flex items-start gap-3">
											<label
												for="tr-factura"
												ondragover={(e) => e.preventDefault()}
												ondrop={onFacturaDrop}
												class={`relative flex flex-col items-center justify-center gap-1 w-24 h-24 shrink-0 rounded-xl border-2 border-dashed border-slate-300 text-center overflow-hidden transition-colors ${bloqueadaPorAprobacion ? 'opacity-60 cursor-not-allowed bg-slate-50' : 'cursor-pointer hover:bg-slate-50'}`}
											>
												{#if localPreviewUrlFactura}
													<img src={localPreviewUrlFactura} alt="Vista previa de la factura" class="absolute inset-0 w-full h-full object-cover" />
												{:else if facturaUrl && !facturaFile}
													<img
														src={facturaThumbUrl}
														alt="Factura actual"
														class="absolute inset-0 w-full h-full object-cover"
														onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
													/>
													<div class="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[9px] font-medium py-0.5 flex items-center justify-center" title="Haz clic o arrastra para reemplazar">
														<CloudUpload size={9} class="shrink-0" />
													</div>
												{:else if facturaFile}
													<CloudUpload size={16} class="text-blue-400" />
													<span class="text-[10px] font-medium text-slate-700 leading-tight px-1 line-clamp-2 break-all">{facturaFile.name}</span>
												{:else}
													<CloudUpload size={18} class="text-blue-400" />
													<span class="text-[10px] font-medium text-slate-600 leading-tight px-1">Arrastra o selecciona</span>
												{/if}
											</label>
											<div class="flex flex-col gap-1 min-w-0 pt-0.5">
												{#if facturaUrl && !facturaFile}
													<button type="button" onclick={() => (showFacturaPreview = true)} class="text-xs text-blue-600 hover:underline text-left w-fit">
														Ver factura actual
													</button>
												{/if}
												<p class="text-xs text-slate-400">JPG, PNG o PDF (máx. 5MB).</p>
											</div>
										</div>
										<input id="tr-factura" type="file" accept="image/*,application/pdf" class="hidden" disabled={bloqueadaPorAprobacion} onchange={onFacturaChange} />
									</div>
									<div>
										<label for="tr-descripcion" class="block text-sm font-bold text-[#0f3b5e] mb-1">{descripcionField.label}</label>
										<textarea
											id="tr-descripcion"
											rows="3"
											value={formValues.descripcion}
											disabled={bloqueadaPorAprobacion}
											oninput={(e) => handleInput('descripcion', (e.target as HTMLTextAreaElement).value)}
											placeholder={descripcionField.placeholder}
											class="w-full h-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60 disabled:bg-slate-50 resize-none"
										></textarea>
										{#if fieldErrors.descripcion}<p class="mt-1 text-xs text-red-600">{fieldErrors.descripcion}</p>{/if}
									</div>
									<div>
										<span class="block text-sm font-bold text-[#0f3b5e] mb-1">Estado</span>
										{#if estadoActual === 'anulado'}
											<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
												<ShieldOff size={12} /> Anulada
											</span>
											{#if isAdmin() && mode === 'edit'}
												<button
													type="button"
													onclick={handleReactivar}
													disabled={anulando}
													class="block mt-1 text-xs text-blue-600 hover:underline disabled:opacity-50"
												>
													{anulando ? 'Reactivando…' : 'Reactivar'}
												</button>
											{/if}
										{:else if estadoActual === 'consulta'}
											<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
												Consulta (interna)
											</span>
										{:else}
											<span
												class={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${transaccion?.aprobado ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}
											>
												{transaccion?.aprobado ? 'Aprobada' : 'Pendiente de aprobación'}
											</span>
											{#if isAdmin() && mode === 'edit'}
												<button
													type="button"
													onclick={handleAnular}
													disabled={anulando}
													class="block mt-1 text-xs text-red-600 hover:underline disabled:opacity-50"
												>
													{anulando ? 'Anulando…' : 'Anular esta transacción'}
												</button>
											{/if}
										{/if}
									</div>
								</div>

								<p class="text-xs text-slate-400 flex items-center gap-1.5">
									<Info size={12} class="shrink-0" />
									Estos campos son opcionales. Otra área de la empresa se encargará de completarlos.
								</p>
							</div>
						{/if}
					</div>
				</div>

				<!-- Detalle — sección propia (a pedido explícito del usuario, antes vivía dentro de "Otros
				     campos"), visible en cuanto hay una Categoría elegida, sea cual sea el tipo de
				     proyecto/transacción — EXCEPTO en proyectos de Obra con transacción de tipo Ingreso
				     (Adelanto/Valorización/Adenda), donde no aplica desglose de subcategorías, a pedido
				     explícito del usuario. Ver detalleCategoria/agregarFilaDetalleCategoria más arriba. -->
				{#if formValues.categoria && !(esProyectoDeObra && formValues.tipo === 'ingreso')}
					<div class="rounded-2xl border border-slate-200 p-5">
						<div class="flex items-center justify-between flex-wrap gap-2 mb-4">
							<div class="flex items-center gap-2">
								<ListTree size={16} class="text-blue-500" />
								<span class="text-sm font-bold text-[#0f3b5e]">Detalle</span>
								<span class="text-xs text-slate-400">Categoría seleccionada: {getOptionLabel(categoriaField, formValues.categoria)}</span>
							</div>
							<button
								type="button"
								onclick={agregarFilaDetalleCategoria}
								disabled={bloqueadaPorAprobacion}
								class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-300 text-blue-600 text-xs font-semibold hover:bg-blue-50 disabled:opacity-50"
							>
								<Plus size={13} /> Agregar subcategoría
							</button>
						</div>

						{#if detalleCategoria.length === 0}
							<p class="text-xs text-slate-400 text-center py-4">Sin subcategorías todavía — usa "Agregar subcategoría".</p>
						{:else}
							<div class="overflow-x-auto">
								<table class="w-full text-sm min-w-[720px]">
									<thead>
										<tr class="text-[11px] text-slate-500 uppercase tracking-wide">
											<th class="text-left px-2 py-1.5 font-semibold">Subcategoría</th>
											<th class="text-left px-2 py-1.5 font-semibold">Descripción</th>
											<th class="text-right px-2 py-1.5 font-semibold w-20">Cantidad</th>
											<th class="text-left px-2 py-1.5 font-semibold w-24">Unidad</th>
											<th class="text-right px-2 py-1.5 font-semibold w-28">Precio unitario</th>
											<th class="text-right px-2 py-1.5 font-semibold w-28">Total</th>
											<th class="w-8"></th>
										</tr>
									</thead>
									<tbody>
										{#each detalleCategoria as fila (fila._key)}
											<tr class="border-t border-slate-100">
												<td class="px-2 py-1.5">
													<input
														type="text"
														bind:value={fila.subcategoria}
														disabled={bloqueadaPorAprobacion}
														placeholder="Ej. Cemento"
														class="w-full rounded-md border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
													/>
												</td>
												<td class="px-2 py-1.5">
													<input
														type="text"
														bind:value={fila.descripcion}
														disabled={bloqueadaPorAprobacion}
														placeholder="Ej. Cemento Tipo I"
														class="w-full rounded-md border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
													/>
												</td>
												<td class="px-2 py-1.5">
													<input
														type="number"
														min="0"
														step="any"
														bind:value={fila.cantidad}
														disabled={bloqueadaPorAprobacion}
														class="w-full rounded-md border border-slate-200 px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
													/>
												</td>
												<td class="px-2 py-1.5">
													<select
														bind:value={fila.unidad}
														disabled={bloqueadaPorAprobacion}
														class="w-full rounded-md border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
													>
														{#each UNIDADES_DETALLE as u}
															<option value={u}>{u}</option>
														{/each}
													</select>
												</td>
												<td class="px-2 py-1.5">
													<input
														type="number"
														min="0"
														step="any"
														bind:value={fila.precio_unitario}
														disabled={bloqueadaPorAprobacion}
														class="w-full rounded-md border border-slate-200 px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
													/>
												</td>
												<td class="px-2 py-1.5 text-right font-medium text-slate-700 whitespace-nowrap">
													{formatCurrency((Number(fila.cantidad) || 0) * (Number(fila.precio_unitario) || 0))}
												</td>
												<td class="px-2 py-1.5 text-center">
													<button
														type="button"
														onclick={() => eliminarFilaDetalleCategoria(fila._key)}
														disabled={bloqueadaPorAprobacion}
														class="p-1 rounded text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
														aria-label="Eliminar subcategoría"
														title="Eliminar subcategoría"
													>
														<Trash2 size={14} />
													</button>
												</td>
											</tr>
										{/each}
									</tbody>
									<tfoot>
										<tr class="border-t border-slate-200">
											<td colspan="5" class="px-2 py-2 text-right text-xs font-semibold text-slate-500">Total detallado:</td>
											<td class="px-2 py-2 text-right font-bold text-[#0f3b5e] whitespace-nowrap">{formatCurrency(totalDetalleCategoria)}</td>
											<td></td>
										</tr>
									</tfoot>
								</table>
							</div>
						{/if}
					</div>
				{/if}

				<div class="sticky bottom-0 flex gap-2 justify-end bg-white px-6 py-4 border-t border-slate-200">
					<button type="button" onclick={onClose} disabled={submitting} class="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
						Cancelar
					</button>
					{#if !bloqueadaPorAprobacion}
						<button type="submit" disabled={submitting || hasErrors} class="px-4 py-2 text-sm font-medium rounded-lg bg-[#0f3b5e] text-white hover:bg-[#0c2f4c] disabled:opacity-50 flex items-center gap-2">
							{#if submitting}<Loader2 size={16} class="animate-spin" />{/if}
							{#if submitting}
								{uploadingComprobante || uploadingFactura ? 'Subiendo archivos…' : 'Guardando…'}
							{:else if colaArchivos.length > 1 && colaIndex < colaArchivos.length - 1}
								Guardar y continuar
							{:else}
								{confirmButtonLabel ?? (mode === 'create' ? 'Crear' : 'Actualizar')}
							{/if}
						</button>
					{/if}
				</div>
			</form>
		</div>
	</div>
{/if}

<DocumentPreviewModal
	open={showComprobantePreview}
	url={comprobanteUrl}
	title="Comprobante"
	onClose={() => (showComprobantePreview = false)}
/>

<DocumentPreviewModal
	open={showFacturaPreview}
	url={facturaUrl}
	title="Factura o boleta de venta"
	onClose={() => (showFacturaPreview = false)}
/>
