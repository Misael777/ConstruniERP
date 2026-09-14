<script lang="ts">
	import { goto } from '$app/navigation';
	import { getFechaLocalHoy } from '$lib/shared/dateUtils';
	import { supabase } from '$lib/supabaseClient';
	import { X, Loader2, ShieldCheck, ShieldOff, Lock, Pencil, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, CloudUpload, Info, Trash2, Plus, ListTree, FileText, RefreshCw, User } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { base64ToUint8Array } from '$lib/shared/base64';
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
		getCentroCostoOptions,
		getCentroCostoOptionsClientesYCorporativoUOtro,
		getCentroCostoOptionsSoloCentros,
		getCentroCostoOptionsClientes,
		getCentroCostoClienteIdMap,
		getCentroCostoOptionsProveedores,
		getCentroCostoOptionsSubcontratistas,
		getCentroCostoOptionsEmpleados,
		getCentroCostoTipoMap,
		getDetalleCategoria,
		sincronizarDetalleCategoria,
		type DetalleCategoria,
		getComprobantesPago,
		sincronizarComprobantesPago,
		type ComprobantePago,
		getSiguienteNumeroComprobanteInterno,
		getSiguienteNumeroReciboPago,
		getSiguienteNumeroReciboPagoNoEfectivo,
		getSiguienteNumeroReciboPagoProveedor,
		getSaldosCentroCosto,
		getCuentasBancoUsadasEnIngresos,
		validarSaldoSuficiente
	} from '$lib/modules/transacciones/services/transacciones.service';
	import { getSaldosCuentaBanco, getMonedasCuentaBanco } from '$lib/modules/cuentas-bancarias/services/cuentaBanco.service';
	import { formatearFechaCorta } from '$lib/shared/pdfFormatoUtil';
	import { generarComprobanteTransferenciaInternaBase64, construirHtmlCompleto as construirHtmlInterna, type DatosComprobanteInterno } from '$lib/shared/comprobanteTransferenciaInterna';
	import { generarReciboPagoBase64, construirHtmlCompleto as construirHtmlReciboPago, type DatosReciboPago } from '$lib/shared/reciboPagoEfectivo';
	import { generarReciboPagoProveedorBase64, construirHtmlCompleto as construirHtmlReciboProveedor, type DatosReciboPagoProveedor } from '$lib/shared/reciboPagoProveedor';
	import ReciboPagoModal, { type DatosFirmaReciboPago } from '$lib/modules/transacciones/components/ReciboPagoModal.svelte';
	import ReciboPagoProveedorModal, { type DatosFirmaReciboPagoProveedor } from '$lib/modules/transacciones/components/ReciboPagoProveedorModal.svelte';
	import type { Transaccion } from '$lib/modules/transacciones/services/transacciones.service';
	import { permisosState, isAdmin } from '$lib/stores/permisos.svelte';
	import { resolveApiUrl, parseJsonResponse } from '$lib/apiClient';
	import { isRunningInTauri, uploadToDriveClient, renameDriveFileClient, deleteDriveFileClient, downloadFromDriveClient } from '$lib/driveUploadClient';
	import { extractDriveFileId } from '$lib/shared/uploadProjectDocument';
	import { reconocerComprobante, reconocerComprobantePago, type ReconocerComprobanteResult } from '$lib/shared/ocrComprobante';
	import DocumentPreviewModal from '$lib/shared/components/DocumentPreviewModal.svelte';
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
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
		onConfirm?: ((payload: Record<string, unknown>, idempotencyKey: string) => Promise<{ success: boolean; message: string; errors?: Record<string, string>; data?: any }>) | null;
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
		// A pedido explícito del usuario: "Tipo de Moneda" arranca en 'soles' — tanto al crear como al
		// editar una transacción vieja de antes de agregar este campo (tipo_moneda llega vacío/null de
		// la BD en ese caso), mismo criterio que el DEFAULT 'soles' de la propia columna (ver
		// transaccion_moneda_migration.sql).
		if (!values.tipo_moneda) values.tipo_moneda = 'soles';
		return values;
	}

	let formValues = $state<Record<string, string>>(buildInitialValues());
	let fieldErrors = $state<Record<string, string>>({});
	let submitting = $state(false);
	let aprobando = $state(false);

	// "Monto Convertido" (= Monto (reconocido) × Tipo de Cambio) — a pedido explícito del usuario, se
	// calcula solo, no es editable a mano (ver disabledValue en transaccion.config.ts, que guarda este
	// mismo valor tal cual). Solo aplica con Tipo de Moneda = Dólares; en Soles queda vacío (el campo ni
	// siquiera se muestra, ver template más abajo).
	$effect(() => {
		if (formValues.tipo_moneda !== 'dolares') {
			if (formValues.monto_convertido !== '') formValues.monto_convertido = '';
			return;
		}
		const monto = Number(formValues.monto_total);
		const cambio = Number(formValues.tipo_cambio);
		// A pedido explícito del usuario: 4 decimales (no 2, como el resto de los montos en soles) — el
		// tipo de cambio en sí ya trae hasta 2 decimales, así que el producto necesita más precisión
		// para no perderla de más al redondear.
		const nuevo = Number.isFinite(monto) && formValues.monto_total !== '' && Number.isFinite(cambio) && formValues.tipo_cambio !== '' ? (monto * cambio).toFixed(4) : '';
		if (formValues.monto_convertido !== nuevo) formValues.monto_convertido = nuevo;
	});

	// Bloquea edición/borrado (todo el form, no solo el comprobante) una vez que un administrador aprobó
	// el comprobante — a pedido explícito del usuario, sin excepción de administrador (antes un admin sí
	// podía seguir editando). La transacción sigue siendo VISIBLE, con todos los campos deshabilitados;
	// para volver a editarla hay que quitar la aprobación primero (ver handleDesaprobar más abajo, esa
	// acción sigue siendo admin-only). Ver aprobarTransaccion/desaprobarTransaccion y
	// BLOQUEADO_POR_APROBACION en transacciones.service.ts.
	const bloqueadaPorAprobacion = $derived(mode === 'edit' && !!transaccion?.aprobado);

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

	/** Comprobante autogenerado por el ERP (Boucher Interna/Recibo por Pago/Recibo a Proveedor) YA
	 * guardado en Drive — a pedido explícito del usuario, vive en su propio campo/espacio, separado de
	 * comprobanteFile/comprobanteUrl ("Adjuntar boucher de pago", que sube el usuario a mano) y de
	 * comprobantesPago ("Comprobantes de pago", documentos de terceros). Ver
	 * transaccion_comprobante_autogenerado_migration.sql y generarComprobanteAutogenerado/handleSubmit. */
	let comprobanteAutogeneradoUrl = $state<string | null>(null);
	let uploadingComprobanteAutogenerado = $state(false);

	// Comprobantes de pago — cuarta sección, a pedido explícito del usuario: reemplaza el antiguo campo
	// único "Adjuntar factura o boleta de venta" por VARIOS adjuntos, cada uno con su propio Tipo de
	// Documento/N° de Documento/Monto (ver transaccion_comprobante_pago_migration.sql). Para Egreso son
	// comprobantes de pago; para Ingreso, comprobantes de recepción de dinero de Construni — mismo
	// mecanismo, solo cambia el rótulo (ver comprobantesPagoLabel más abajo).
	type ComprobantePagoFila = ComprobantePago & { _key: number; file?: File; ocrCargando?: boolean };
	let comprobantesPago = $state<ComprobantePagoFila[]>([]);
	// Snapshot de lo que había guardado al abrir en modo edición — para, al guardar, saber qué filas
	// quitó el usuario y borrar esos archivos de Drive (no solo la fila de metadatos). Ver handleSubmit.
	let comprobantesPagoOriginales: ComprobantePagoFila[] = [];
	let comprobantesPagoKeySeq = 0;
	let comprobantesPagoCargadoParaId: number | null = null;
	let uploadingComprobantesPago = $state(false);
	let previewComprobantePago = $state<ComprobantePagoFila | null>(null);
	/** `documents` para el DocumentPreviewModal de una fila de "Comprobantes de pago" — arma la URL UNA
	 * sola vez (createObjectURL para un archivo local recién elegido, aún no subido) y el nombre de
	 * descarga con la estructura pedida (ver nombreDescargaComprobante). */
	const previewComprobantePagoDocs = $derived.by(() => {
		if (!previewComprobantePago) return [];
		const url = previewComprobantePago.file ? URL.createObjectURL(previewComprobantePago.file) : (previewComprobantePago.url ?? '');
		return [{ url, label: previewComprobantePago.nombre_archivo ?? 'Comprobante', filename: nombreDescargaComprobante(previewComprobantePago.num_documento ?? '') }];
	});

	function agregarComprobantesPago(files: FileList | File[]) {
		const nuevas: ComprobantePagoFila[] = [];
		for (const file of Array.from(files)) {
			if (file.size > MAX_FILE_SIZE) {
				toast.error(`"${file.name}" supera el máximo de 5MB.`);
				continue;
			}
			comprobantesPagoKeySeq += 1;
			nuevas.push({ _key: comprobantesPagoKeySeq, tipo_documento: '', num_documento: '', monto: null, url: '', nombre_archivo: file.name, file, ocrCargando: true });
		}
		comprobantesPago = [...comprobantesPago, ...nuevas];
		for (const fila of nuevas) ejecutarOcrComprobantePago(fila);
	}

	/** Lee Tipo de Documento/N° de Documento/Monto del archivo recién agregado (imagen o PDF, ver
	 * reconocerComprobantePago) y completa esa fila sola — a pedido explícito del usuario. Si no
	 * reconoce nada, la fila queda igual para completarla a mano; nunca bloquea el flujo. */
	async function ejecutarOcrComprobantePago(fila: ComprobantePagoFila) {
		if (!fila.file) return;
		try {
			const result = await reconocerComprobantePago(fila.file);
			comprobantesPago = comprobantesPago.map((f) => {
				if (f._key !== fila._key) return f;
				const actualizado: ComprobantePagoFila = { ...f, ocrCargando: false };
				if (result.success) {
					if (result.tipo_documento) actualizado.tipo_documento = result.tipo_documento;
					if (result.num_documento) actualizado.num_documento = result.num_documento;
					if (result.monto !== null && result.monto !== undefined) actualizado.monto = result.monto;
				}
				return actualizado;
			});
		} catch (err) {
			console.error('[TransaccionModal] No se pudo reconocer el comprobante de pago:', err);
			comprobantesPago = comprobantesPago.map((f) => (f._key === fila._key ? { ...f, ocrCargando: false } : f));
		}
	}

	/** Vuelve a leer un comprobante YA GUARDADO (fila.url, subido a Drive en una edición anterior) — a
	 * pedido explícito del usuario: el OCR de arriba (ejecutarOcrComprobantePago) solo corre para
	 * archivos recién agregados en esta misma sesión de edición (fila.file); una fila cargada desde la
	 * BD (ver getComprobantesPago más abajo) nunca se vuelve a reconocer sola, así que si quedó con
	 * datos incorrectos (ej. guardada antes de un ajuste al OCR) se queda así para siempre a menos que
	 * el usuario presione este botón. Descarga el archivo real de Drive (mismo patrón dual Tauri/
	 * navegador que DocumentPreviewModal.svelte) y le corre reconocerComprobantePago encima. */
	async function releerComprobantePago(fila: ComprobantePagoFila) {
		if (!fila.url) return;
		const fileId = extractDriveFileId(fila.url);
		if (!fileId) {
			toast.error('No se pudo identificar el archivo para volver a leerlo.');
			return;
		}
		comprobantesPago = comprobantesPago.map((f) => (f._key === fila._key ? { ...f, ocrCargando: true } : f));
		try {
			let blob: Blob;
			if (isRunningInTauri()) {
				blob = await downloadFromDriveClient(fileId);
			} else {
				const nombreBase = (fila.nombre_archivo || 'comprobante').replace(/\.[^./]+$/, '');
				const res = await fetch(resolveApiUrl(`/api/upload-document?fileId=${encodeURIComponent(fileId)}&filename=${encodeURIComponent(nombreBase)}`));
				if (!res.ok) throw new Error(`No se pudo descargar el archivo (HTTP ${res.status}).`);
				blob = await res.blob();
			}
			const nombreArchivo = fila.nombre_archivo || 'comprobante.pdf';
			const file = new File([blob], nombreArchivo, { type: blob.type || 'application/pdf' });
			const result = await reconocerComprobantePago(file);
			comprobantesPago = comprobantesPago.map((f) => {
				if (f._key !== fila._key) return f;
				const actualizado: ComprobantePagoFila = { ...f, ocrCargando: false };
				if (result.success) {
					if (result.tipo_documento) actualizado.tipo_documento = result.tipo_documento;
					if (result.num_documento) actualizado.num_documento = result.num_documento;
					if (result.monto !== null && result.monto !== undefined) actualizado.monto = result.monto;
				}
				return actualizado;
			});
			if (result.success) toast.success('Comprobante releído — revisa los campos.');
			else toast.error('No se pudo reconocer ningún dato de este comprobante. Complétalos a mano.');
		} catch (err) {
			console.error('[TransaccionModal] No se pudo volver a leer el comprobante:', err);
			toast.error('No se pudo volver a leer el comprobante.');
			comprobantesPago = comprobantesPago.map((f) => (f._key === fila._key ? { ...f, ocrCargando: false } : f));
		}
	}

	function onComprobantesPagoChange(e: Event) {
		const files = (e.target as HTMLInputElement).files;
		if (files && files.length > 0) agregarComprobantesPago(files);
		(e.target as HTMLInputElement).value = '';
	}
	function onComprobantesPagoDrop(e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) agregarComprobantesPago(e.dataTransfer.files);
	}
	function eliminarComprobantePago(key: number) {
		comprobantesPago = comprobantesPago.filter((f) => f._key !== key);
	}

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

	// El centro de costo que "es nuestro" en cada tipo — Egreso sale del origen, Ingreso entra al
	// destino (el otro lado ya es la contraparte externa, ver optionsFor más abajo). El buscador solo
	// debe ofrecer cuentas de ESE centro de costo (a pedido del usuario: no se puede vincular el gasto
	// de un proyecto contra el presupuesto de otro).
	const idCentroCostoParaVinculo = $derived(
		formValues.tipo === 'egreso'
			? Number(formValues.id_centro_costo_origen) || null
			: formValues.tipo === 'ingreso'
				? Number(formValues.id_centro_costo_destino) || null
				: null
	);

	async function ejecutarBusquedaCuentaVinculada(query: string) {
		if (!idCentroCostoParaVinculo) {
			cuentaVinculadaResultados = [];
			return;
		}
		cuentaVinculadaBuscando = true;
		try {
			if (formValues.tipo === 'egreso') {
				const items = await buscarCuentasPagarVinculables(supabase, query, idCentroCostoParaVinculo);
				cuentaVinculadaResultados = items.map((it) => ({
					id: it.id_cuenta_pagar,
					label: `${it.proveedorNombre}${it.num_documento ? ' · ' + it.num_documento : ''}`,
					saldo: it.saldo_pendiente
				}));
			} else if (formValues.tipo === 'ingreso') {
				const items = await buscarCuentasCobrarVinculables(supabase, query, idCentroCostoParaVinculo);
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

	// A pedido explícito del usuario: si el proyecto/cliente elegido YA tiene una cuenta por
	// pagar/cobrar con saldo pendiente, debe verse reflejada acá — antes la búsqueda recién corría
	// cuando el usuario hacía foco manual en el campo de texto (ver onCuentaVinculadaFocus), así que si
	// nunca llegaba a hacer clic ahí (por ejemplo, tras elegir el Centro de Costo, dar por hecho que ya
	// no había nada que vincular) la cuenta existente quedaba sin mostrarse pese a que sí existía.
	// Precarga los resultados apenas hay un Centro de Costo válido, sin esperar el foco.
	$effect(() => {
		if (!idCentroCostoParaVinculo) return;
		ejecutarBusquedaCuentaVinculada('');
	});

	function onCuentaVinculadaFocus() {
		cuentaVinculadaAbierta = true;
		if (!idCentroCostoParaVinculo) return;
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

	// Idempotency key para fn_crear_transaccion/fn_confirmar_pago/fn_confirmar_cobro (ver
	// financial_integrity_rpc_migration.sql) — se genera UNA vez al abrir el modal y viaja tal cual en
	// cada intento de guardado, incluidos los reintentos: si el usuario hace doble-click o un guardado
	// se reintenta tras un timeout de red, el backend reconoce la misma key y devuelve la transacción
	// ya creada en vez de duplicarla. Se regenera recién cuando el modal se vuelve a abrir.
	let idempotencyKey = $state('');

	$effect(() => {
		if (open) {
			idempotencyKey = crypto.randomUUID();
			formValues = buildInitialValues();
			fieldErrors = {};
			comprobanteFile = null;
			comprobanteUrl = transaccion?.comprobante_url ?? null;
			comprobanteError = '';
			comprobanteAutogeneradoUrl = transaccion?.comprobante_autogenerado_url ?? null;
			saldosRevelados = {};
			comprobantesPago = [];
			comprobantesPagoOriginales = [];
			comprobantesPagoCargadoParaId = null;
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
			detallePageNum = 1;
			categoriaObraGrupo = '';
			categoriaCorpGrupo = '';
			categoriaConsultoriaGrupo = '';
			catalogoAbiertoAuto = false;
			comprobanteInternoNumero = transaccion?.num_comprobante_interno ?? null;
			numeroReciboPago = transaccion?.num_recibo_pago ?? null;
			numeroReciboPagoNoEfectivo = transaccion?.num_recibo_pago_no_efectivo ?? null;
			numeroReciboPagoProveedor = transaccion?.num_recibo_pago_proveedor ?? null;
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

	// Miniatura del archivo ya subido a Drive (para mostrarla de fondo en el recuadro de arrastrar y
	// soltar) — la URL cruda guardada en BD es de descarga directa, no sirve como `<img src>` (ver
	// toDriveThumbnailUrl).
	const comprobanteThumbUrl = $derived(toDriveThumbnailUrl(comprobanteUrl));

	/** Lee fecha/monto del comprobante vía OCR + regex, sin IA (ver ocrComprobante.ts, ya soporta imagen
	 * y PDF). `cacheIndex` no nulo cuando viene de la cola de varios comprobantes (se cachea el
	 * resultado por índice para no repetir la llamada al volver a un archivo ya revisado con las
	 * flechas). Nunca bloquea el guardado manual: si falla o el archivo no es reconocible (de cualquier
	 * tipo), el usuario completa Fecha/Monto/N° de Operación a mano — los campos ya quedan habilitados
	 * (fechaLocked/montoLocked/numOperacionLocked en false) y se avisa con un toast. */
	async function runOcr(file: File, cacheIndex: number | null) {
		fechaLocked = false;
		montoLocked = false;
		numOperacionLocked = false;
		ocrConfianza = null;
		if (!esArchivoImagen(file) && !esArchivoPdf(file)) {
			toast.error('Este tipo de archivo no se puede leer automáticamente — completa Fecha/Monto/N° de Operación a mano.');
			return;
		}
		ocrLoading = true;
		try {
			const result = await reconocerComprobante(file);
			if (cacheIndex !== null) colaOcrCache = { ...colaOcrCache, [cacheIndex]: result };
			// Moneda se aplica pase lo que pase con fecha/monto/N° de operación (incluso si el OCR no
			// reconoció ninguno de esos tres y "success" viene false) — a pedido explícito del usuario, si
			// el boucher dice "Dólares"/"USD" el Tipo de Moneda debe cambiar solo.
			if (result.moneda === 'dolares' && formValues.tipo_moneda !== 'dolares') {
				formValues = { ...formValues, tipo_moneda: 'dolares' };
			}
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

	/** Nombre de archivo al DESCARGAR el boucher de pago (o el comprobante autogenerado por el ERP,
	 * mismo criterio) desde Nueva/Editar Transacción — a pedido explícito del usuario, con una
	 * estructura fija: fecha_OPER_numOperación_TRANS_numTransacción (ej.
	 * "12_01_2026_OPER_01121436_TRANS_117"). DocumentPreviewModal ya sanitiza caracteres inválidos de
	 * sistema de archivos al descargar (ver sanitizeFilename ahí), acá solo se arma el texto con "_"
	 * como separador. En 'create' (transacción todavía sin guardar) num_transaccion queda vacío — no hay
	 * un N° real todavía. */
	function nombreDescargaBoucher(): string {
		const fechaTexto = formValues.fecha ? formatearFechaCorta(formValues.fecha).replace(/\//g, '_') : '';
		const numOperacion = formValues.num_operacion || '';
		const numTransaccion = transaccion?.id_transaccion ?? '';
		return `${fechaTexto}_OPER_${numOperacion}_TRANS_${numTransaccion}`;
	}

	/** Nombre de archivo al descargar una fila de "Comprobantes de pago" — a pedido explícito del
	 * usuario, distinto orden según Ingreso/Egreso:
	 *  - Ingreso: numDocumento_TRANS_numTransacción_OPER_numOperación_fecha
	 *  - Egreso: fecha_numDocumento_TRANS_numTransacción_OPER_numOperación
	 * `numDocumento` es el de esa fila puntual (cada comprobante puede tener el suyo); fecha/N°
	 * Operación/N° Transacción son los de la transacción, compartidos por todas las filas. */
	function nombreDescargaComprobante(numDocumento: string): string {
		const fechaTexto = formValues.fecha ? formatearFechaCorta(formValues.fecha).replace(/\//g, '_') : '';
		const numOperacion = formValues.num_operacion || '';
		const numTransaccion = transaccion?.id_transaccion ?? '';
		const doc = numDocumento || 'sin-documento';
		if (formValues.tipo === 'ingreso') return `${doc}_TRANS_${numTransaccion}_OPER_${numOperacion}_${fechaTexto}`;
		return `${fechaTexto}_${doc}_TRANS_${numTransaccion}_OPER_${numOperacion}`;
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

	/** A diferencia de formatFecha (fuerza UTC porque lee campos 'YYYY-MM-DD' sin hora, ver comentario
	 * arriba), `created_at` SÍ es un timestamp real con hora — se muestra en hora local tal cual ocurrió,
	 * para el pie "Transacción registrada por" (a pedido explícito del usuario). */
	function formatFechaHora(value: string | null | undefined): string {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '—';
		return date.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	/** Los labels de Origen/Destino vienen como "código - nombre" (ver centroCostoOptionLabel en
	 * transacciones.service.ts) — separa las dos partes para el comprobante de transferencia interna
	 * (ver comprobanteTransferenciaInterna.ts), que las muestra en líneas distintas. */
	function separarCodigoNombre(label: string): [string, string] {
		const idx = label.indexOf(' - ');
		return idx === -1 ? [label, ''] : [label.slice(0, idx), label.slice(idx + 3)];
	}

	/** Abre el HTML del recibo (vista previa en vivo, ver reciboAutoHtml) en una pestaña nueva vía Blob
	 * URL — sin generar ningún PDF. El navegador ya terminó de cargar el documento mucho antes de los
	 * 30s, así que revocar el Blob URL recién ahí no corta la vista previa, solo libera memoria. */
	// A pedido explícito del usuario: la vista previa de un recibo autogenerado por el ERP debe verse
	// DENTRO del sistema (un modal propio, mismo criterio que DocumentPreviewModal para los comprobantes
	// ya subidos a Drive), no solo "como web" — antes esto abría una pestaña nueva del navegador vía
	// `window.open(blob:...)`, que no tiene un equivalente confiable en Tauri Windows/Android (no hay
	// pestañas de navegador reales ahí). Renderiza el mismo HTML en un iframe a tamaño completo dentro
	// de un popup propio (ver previewHtmlModalOpen/reciboAutoHtml más abajo) — funciona igual en
	// navegador, Tauri Windows y Tauri Android, sin ninguna API específica de plataforma.
	let previewHtmlModalOpen = $state(false);
	function abrirPreviewHtml(_html: string) {
		previewHtmlModalOpen = true;
	}

	/** Genera el PDF DE VERDAD (recién acá se paga el costo de html2canvas/jsPDF) del comprobante
	 * autogenerado que aplique — a pedido explícito del usuario, este comprobante NO se guarda como
	 * "Adjuntar boucher de pago" (comprobanteFile) ni como "Comprobantes de pago" (comprobantesPago):
	 * tiene su propio campo independiente (comprobanteAutogeneradoUrl), subido a Drive aparte en
	 * handleSubmit (ver ahí). Cubre los 3 tipos de comprobante (Boucher Interna / Recibo de Pago / Recibo
	 * de Pago a Proveedor) — todos se arman directo del formulario actual, sin popup obligatorio: la
	 * firma (ver firmaClienteDataUrl/etc. y el botón "Firmar Comprobante") es opcional y aplica para
	 * cualquier medio de pago, no bloquea la generación si falta. La marca de agua "BORRADOR" es solo de
	 * la vista previa en HTML (reciboAutoHtml) — el PDF que de verdad se guarda/sube nunca la lleva
	 * (sinMarcaAgua=true). Devuelve null solo si ningún tipo de comprobante autogenerado aplica a esta
	 * transacción. Si el correlativo todavía no se resolvió (el $effect que lo asigna no llegó a tiempo),
	 * se resuelve acá mismo antes de generar. A pedido explícito del usuario: el PDF generado acá NUNCA
	 * se descarga/guarda localmente (ni diálogo nativo en Tauri ni descarga de navegador) — sube directo
	 * a Drive (ver handleSubmit) y de ahí en más solo se descarga si el usuario presiona el botón
	 * "Descargar" explícito en DocumentPreviewModal.svelte (vista previa/"ojo" de la lista). */
	async function generarComprobanteAutogenerado(): Promise<File | null> {
		if (formValues.tipo_alcance === 'interna') {
			let numero = comprobanteInternoNumero;
			if (!numero) {
				numero = await getSiguienteNumeroComprobanteInterno(supabase);
				comprobanteInternoNumero = numero;
			}
			const datos = construirDatosBoucherInterna(numero);
			const nombreArchivo = `RECIBO-TRANSFERENCIA-INTERNA-${String(numero).padStart(4, '0')}.pdf`;
			const base64 = await generarComprobanteTransferenciaInternaBase64(datos, true);
			return new File([base64ToUint8Array(base64)], nombreArchivo, { type: 'application/pdf' });
		}
		if (mostrarBotonReciboPago) {
			let numero = esReciboPagoEfectivo ? numeroReciboPago : numeroReciboPagoNoEfectivo;
			if (!numero) {
				numero = esReciboPagoEfectivo
					? await getSiguienteNumeroReciboPago(supabase)
					: await getSiguienteNumeroReciboPagoNoEfectivo(supabase);
				if (esReciboPagoEfectivo) numeroReciboPago = numero;
				else numeroReciboPagoNoEfectivo = numero;
			}
			const datos = construirDatosReciboPagoAuto(numero);
			const nombreArchivo = `RECIBO-DE-PAGO-${String(numero).padStart(7, '0')}.pdf`;
			const base64 = await generarReciboPagoBase64(datos, true);
			return new File([base64ToUint8Array(base64)], nombreArchivo, { type: 'application/pdf' });
		}
		if (mostrarBotonReciboPagoProveedor) {
			let numero = numeroReciboPagoProveedor;
			if (!numero) {
				numero = await getSiguienteNumeroReciboPagoProveedor(supabase);
				numeroReciboPagoProveedor = numero;
			}
			const datos = construirDatosReciboPagoProveedorAuto(numero);
			const nombreArchivo = `RECIBO-DE-PAGO-A-PROVEEDOR-${String(numero).padStart(7, '0')}.pdf`;
			const base64 = await generarReciboPagoProveedorBase64(datos, true);
			return new File([base64ToUint8Array(base64)], nombreArchivo, { type: 'application/pdf' });
		}

		return null;
	}

	// Boucher de Transferencia Interna — a pedido explícito del usuario, ya NO hay botón "Autogenerar":
	// se genera solo, en vivo, apenas Alcance=Interna (ver reciboAutoHtml más abajo, y
	// generarComprobanteAutogenerado en handleSubmit para la conversión real a PDF al guardar). El N° de
	// comprobante se pide una sola vez, apenas aplica la condición (ver $effect debajo), y se reusa en
	// cualquier regeneración posterior — recién se persiste en la BD al guardar.
	let comprobanteInternoNumero = $state<number | null>(null);

	/** Arma los datos del Boucher de Transferencia Interna a partir del formulario — la reusan tanto
	 * reciboAutoHtml (vista previa en vivo) como generarComprobanteAutogenerado (PDF real al guardar). */
	function construirDatosBoucherInterna(numero: number): DatosComprobanteInterno {
		const origenLabel = optionsFor(origenField).find((o) => o.value === String(formValues.id_centro_costo_origen))?.label ?? '';
		const destinoLabel = optionsFor(destinoField).find((o) => o.value === String(formValues.id_centro_costo_destino))?.label ?? '';
		const [origenCodigo, origenNombre] = separarCodigoNombre(origenLabel);
		const [destinoCodigo, destinoNombre] = separarCodigoNombre(destinoLabel);
		// A pedido explícito del usuario, con imagen de referencia: la sección "Cuentas Bancarias" del
		// recibo debe mostrar la cuenta bancaria REAL usada en la transacción (misma fuente que los
		// campos Cuenta Origen/Destino del formulario, ambos bancarios en Interna — ver
		// cuentaOrigenEsBancaria/cuentaDestinoEsBancaria), no un código contable fijo inventado.
		const cuentaBancariaOrigen = (dynamicOptions.cuenta_banco || []).find((o) => o.value === formValues.cuente_origen)?.label ?? formValues.cuente_origen ?? '—';
		const cuentaBancariaDestino = (dynamicOptions.cuenta_banco || []).find((o) => o.value === formValues.cuente_destino)?.label ?? formValues.cuente_destino ?? '—';
		return {
			numero,
			fecha: formValues.fecha,
			origenCodigo,
			origenNombre,
			destinoCodigo,
			destinoNombre,
			monto: Number(formValues.monto_total) || 0,
			// A pedido explícito del usuario: el concepto del recibo siempre es "Transferencia Interna"
			// (no la Descripción del formulario, que puede estar vacía o hablar de otra cosa).
			concepto: 'Transferencia Interna',
			usuario: permisosState.userName || 'Usuario',
			cuentaBancariaOrigen,
			cuentaBancariaDestino
		};
	}

	// Asigna el correlativo del Boucher Interna una sola vez, apenas Alcance=Interna — sin esperar
	// ningún click (a pedido explícito del usuario: "siempre se debe autogenerar"). También fija
	// num_operacion con el N° del propio recibo (no aplica un N° de Operación real en una transferencia
	// interna, no hay banco externo de por medio) — mismo criterio que antes tenía el botón manual.
	$effect(() => {
		if (formValues.tipo_alcance !== 'interna' || comprobanteInternoNumero) return;
		getSiguienteNumeroComprobanteInterno(supabase)
			.then((numero) => {
				comprobanteInternoNumero = numero;
				formValues = { ...formValues, num_operacion: String(numero).padStart(4, '0') };
				numOperacionLocked = false;
			})
			.catch((err) => console.error('[TransaccionModal] No se pudo asignar el N° de Boucher Interna:', err));
	});

	// Recibo de Pago (Externa+Ingreso) — a pedido explícito del usuario: siempre se autogenera solo, en
	// vivo, para CUALQUIER medio de pago (ver reciboAutoHtml/construirDatosReciboPagoAuto más abajo).
	// Concepto y datos del cliente se muestran como campos editables en el propio formulario (ver
	// template) — se prellenan solos pero el usuario puede corregirlos. La firma manuscrita es OPCIONAL
	// y aplica para cualquier medio de pago, no solo Efectivo (a pedido explícito del usuario): un botón
	// "Firmar Comprobante" abre un popup solo con las firmas (ver abrirFirmaReciboPago más abajo) — no
	// bloquea nada si el usuario no firma, el comprobante se genera igual.
	const mostrarBotonReciboPago = $derived(formValues.tipo_alcance === 'externa' && formValues.tipo === 'ingreso');
	// Recibo de Pago a Proveedor (Externa+Egreso) — mismo criterio que mostrarBotonReciboPago pero para
	// Egreso en vez de Ingreso (acá la empresa entrega el dinero, ver reciboPagoProveedor.ts).
	const mostrarBotonReciboPagoProveedor = $derived(formValues.tipo_alcance === 'externa' && formValues.tipo === 'egreso');
	const esReciboPagoEfectivo = $derived(formValues.medio_pago === '1'); // '1' = Efectivo (ver FIELDS_CONFIG) — solo afecta qué texto muestra la sección "FORMA DE PAGO" del PDF y qué correlativo usa, ya no si se puede firmar.
	let reciboPagoModalOpen = $state(false);
	let numeroReciboPago = $state<number | null>(null);
	// Correlativo independiente del recibo NO Efectivo — son dos recibos DIFERENTES (ver
	// reciboPagoEfectivo.ts), cada uno con su propia numeración serial, a pedido explícito del usuario.
	let numeroReciboPagoNoEfectivo = $state<number | null>(null);
	// Cliente que paga — a pedido explícito del usuario, se autocompleta desde la transacción (para
	// Externa+Ingreso, "Centro de Costo Origen" ES el cliente, ver centroCostoClienteIdMap/optionsFor más
	// abajo) pero queda editable en el formulario (bind:value, ver template) por si hace falta corregirlo.
	let clienteReciboNombre = $state('');
	let clienteReciboDni = $state('');
	// Firma manuscrita del Recibo de Pago — opcional, capturada en el popup "Firmar Comprobante" (ver
	// ReciboPagoModal.svelte, ahora reducido a solo firmas + DNI de quien recibe). receptorDniFirma se
	// prellena con el DNI del empleado logueado (ver permisosState.dni) recién al abrir el popup.
	let firmaClienteDataUrl = $state('');
	let firmaReceptorDataUrl = $state('');
	let receptorDniFirma = $state('');
	$effect(() => {
		if (!mostrarBotonReciboPago) return;
		const idCliente = centroCostoClienteIdMap[formValues.id_centro_costo_origen];
		if (!idCliente) {
			clienteReciboNombre = '';
			clienteReciboDni = '';
			firmaClienteDataUrl = '';
			firmaReceptorDataUrl = '';
			return;
		}
		supabase
			.from('cliente')
			.select('nombre, num_documento')
			.eq('id_cliente', idCliente)
			.maybeSingle()
			.then(({ data }) => {
				clienteReciboNombre = data?.nombre ?? '';
				clienteReciboDni = data?.num_documento ?? '';
				// Cambió el cliente -> cualquier firma que hubiera quedaba de otra persona, ya no aplica.
				firmaClienteDataUrl = '';
				firmaReceptorDataUrl = '';
			});
	});
	function abrirFirmaReciboPago() {
		reciboPagoModalOpen = true;
	}
	function handleFirmarReciboPago(datos: DatosFirmaReciboPago) {
		firmaClienteDataUrl = datos.firmaClienteDataUrl;
		firmaReceptorDataUrl = datos.firmaReceptorDataUrl;
		receptorDniFirma = datos.receptorDni;
		reciboPagoModalOpen = false;
		toast.success('Firma guardada — se incluirá en el comprobante al guardar.');
	}

	// Popup "Firmar Comprobante" para Recibo de Pago a Proveedor — mismo criterio que
	// abrirFirmaReciboPago, pero para Externa+Egreso: acá "Centro de Costo Destino" ES el proveedor (ver
	// getCentroCostoOptionsProveedores/optionsFor más abajo), así que basta resolver su id_proveedor y
	// traer razón social/RUC.
	let reciboPagoProveedorModalOpen = $state(false);
	let numeroReciboPagoProveedor = $state<number | null>(null);
	let proveedorReciboNombre = $state('');
	let proveedorReciboRuc = $state('');
	let firmaEntregoDataUrl = $state('');
	let firmaRecibioDataUrl = $state('');
	let entregoDniFirma = $state('');
	$effect(() => {
		if (!mostrarBotonReciboPagoProveedor) return;
		const idCentro = formValues.id_centro_costo_destino;
		if (!idCentro) {
			proveedorReciboNombre = '';
			proveedorReciboRuc = '';
			firmaEntregoDataUrl = '';
			firmaRecibioDataUrl = '';
			return;
		}
		supabase
			.from('centro_costo')
			.select('id_proveedor')
			.eq('id_centro_costo', idCentro)
			.maybeSingle()
			.then(({ data: centroCosto }) => {
				if (!centroCosto?.id_proveedor) {
					proveedorReciboNombre = '';
					proveedorReciboRuc = '';
					firmaEntregoDataUrl = '';
					firmaRecibioDataUrl = '';
					return;
				}
				supabase
					.from('proveedor')
					.select('razon_social, ruc')
					.eq('id_proveedor', centroCosto.id_proveedor)
					.maybeSingle()
					.then(({ data }) => {
						proveedorReciboNombre = data?.razon_social ?? '';
						proveedorReciboRuc = data?.ruc ?? '';
						// Cambió el proveedor -> cualquier firma que hubiera quedaba de otro proveedor.
						firmaEntregoDataUrl = '';
						firmaRecibioDataUrl = '';
					});
			});
	});
	function abrirFirmaReciboPagoProveedor() {
		reciboPagoProveedorModalOpen = true;
	}
	function handleFirmarReciboPagoProveedor(datos: DatosFirmaReciboPagoProveedor) {
		firmaEntregoDataUrl = datos.firmaEntregoDataUrl;
		firmaRecibioDataUrl = datos.firmaRecibioDataUrl;
		entregoDniFirma = datos.entregoDni;
		reciboPagoProveedorModalOpen = false;
		toast.success('Firma guardada — se incluirá en el comprobante al guardar.');
	}

	// Concepto del Recibo de Pago/Proveedor — a pedido explícito del usuario, campo siempre visible y
	// editable en el formulario (no un popup): se prellena con la Descripción de la transacción y sigue
	// esa Descripción en vivo mientras el usuario no lo toque; apenas lo edita a mano, esa edición manda
	// (conceptoReciboOverride) hasta que el usuario la borre de nuevo.
	let conceptoReciboOverride = $state<string | null>(null);
	const conceptoRecibo = $derived(conceptoReciboOverride ?? formValues.descripcion ?? '');
	function onConceptoReciboInput(e: Event) {
		conceptoReciboOverride = (e.target as HTMLTextAreaElement).value;
	}

	// Asignan los correlativos del Recibo de Pago (Ingreso) y del Recibo a Proveedor (Egreso) una sola
	// vez, apenas aplica la condición — sin esperar ningún click (a pedido explícito del usuario: "siempre
	// se debe autogenerar"). El de Ingreso usa el correlativo Efectivo o el no-Efectivo según corresponda
	// (dos series independientes, ver numeroReciboPagoNoEfectivo arriba); el de Proveedor usa UN SOLO
	// correlativo compartido entre ambos casos — no se toca ese diseño, solo se adelanta su asignación.
	$effect(() => {
		if (!mostrarBotonReciboPago) return;
		if (esReciboPagoEfectivo) {
			if (numeroReciboPago) return;
			getSiguienteNumeroReciboPago(supabase)
				.then((numero) => (numeroReciboPago = numero))
				.catch((err) => console.error('[TransaccionModal] No se pudo asignar el N° de Recibo de Pago:', err));
		} else {
			if (numeroReciboPagoNoEfectivo) return;
			getSiguienteNumeroReciboPagoNoEfectivo(supabase)
				.then((numero) => (numeroReciboPagoNoEfectivo = numero))
				.catch((err) => console.error('[TransaccionModal] No se pudo asignar el N° de Recibo de Pago:', err));
		}
	});
	$effect(() => {
		if (!mostrarBotonReciboPagoProveedor || numeroReciboPagoProveedor) return;
		getSiguienteNumeroReciboPagoProveedor(supabase)
			.then((numero) => (numeroReciboPagoProveedor = numero))
			.catch((err) => console.error('[TransaccionModal] No se pudo asignar el N° de Recibo a Proveedor:', err));
	});

	/** Arma los datos del Recibo de Pago — se autogenera solo, para cualquier medio de pago. Concepto y
	 * datos del cliente salen de los campos editables del formulario (conceptoRecibo/clienteReciboNombre/
	 * clienteReciboDni); la firma es opcional (firmaClienteDataUrl/firmaReceptorDataUrl, vacías si el
	 * usuario nunca abrió "Firmar Comprobante") — el nombre/titular de la cuenta de origen no tiene
	 * equivalente en el formulario principal, así que queda sin dato (la plantilla ya muestra "—"). */
	function construirDatosReciboPagoAuto(numero: number): DatosReciboPago {
		const destinoLabel = optionsFor(destinoField).find((o) => o.value === String(formValues.id_centro_costo_destino))?.label ?? '';
		const [proyectoCodigo, proyectoNombre] = separarCodigoNombre(destinoLabel);
		return {
			numero,
			fecha: formValues.fecha,
			proyectoCodigo,
			proyectoNombre,
			monto: Number(formValues.monto_total) || 0,
			concepto: conceptoRecibo,
			clienteNombre: clienteReciboNombre,
			clienteDni: clienteReciboDni,
			firmaClienteDataUrl,
			receptorNombre: permisosState.userName || 'Usuario',
			receptorDni: receptorDniFirma || permisosState.dni || '',
			firmaReceptorDataUrl,
			esEfectivo: esReciboPagoEfectivo,
			medioPagoLabel: getOptionLabel(medioPagoField, formValues.medio_pago),
			numeroOperacion: formValues.num_operacion
		};
	}

	/** Arma los datos del Recibo de Pago a Proveedor — mismo criterio que construirDatosReciboPagoAuto. */
	function construirDatosReciboPagoProveedorAuto(numero: number): DatosReciboPagoProveedor {
		const origenLabel = optionsFor(origenField).find((o) => o.value === String(formValues.id_centro_costo_origen))?.label ?? '';
		const [, proyectoNombre] = separarCodigoNombre(origenLabel);
		return {
			numero,
			fecha: formValues.fecha,
			proveedorNombre: proveedorReciboNombre,
			proveedorRuc: proveedorReciboRuc,
			proyectoNombre,
			monto: Number(formValues.monto_total) || 0,
			concepto: conceptoRecibo,
			entregoNombre: permisosState.userName || 'Usuario',
			entregoDni: entregoDniFirma || permisosState.dni || '',
			firmaEntregoDataUrl,
			recibioNombre: proveedorReciboNombre,
			recibioDni: proveedorReciboRuc,
			firmaRecibioDataUrl,
			esEfectivo: esReciboPagoEfectivo,
			formaPagoTexto: getOptionLabel(medioPagoField, formValues.medio_pago)
		};
	}

	/** Vista previa en vivo del comprobante que aplique — Boucher Interna, Recibo de Pago o Recibo a
	 * Proveedor, para CUALQUIER medio de pago (con o sin firma). Se recalcula solo, en cada cambio del
	 * formulario (barato: solo arma el HTML, sin html2canvas). */
	const reciboAutoHtml = $derived.by(() => {
		if (formValues.tipo_alcance === 'interna') {
			return construirHtmlInterna(construirDatosBoucherInterna(comprobanteInternoNumero ?? 0));
		}
		if (mostrarBotonReciboPago) {
			const numero = (esReciboPagoEfectivo ? numeroReciboPago : numeroReciboPagoNoEfectivo) ?? 0;
			return construirHtmlReciboPago(construirDatosReciboPagoAuto(numero));
		}
		if (mostrarBotonReciboPagoProveedor) {
			return construirHtmlReciboProveedor(construirDatosReciboPagoProveedorAuto(numeroReciboPagoProveedor ?? 0));
		}
		return null;
	});

	// Miniatura de vista previa (ver template más abajo) — a pedido explícito del usuario: antes tenía
	// una escala/alto fijos (0.245 / 1300px) que asumían que las 2 copias del recibo siempre entraban en
	// ese alto; con contenido más largo (ej. nombres largos que envuelven a 2 líneas) las 2 copias
	// completas no cabían y la miniatura se veía "cortada" a la mitad de la segunda copia. Ahora la
	// escala se recalcula cada vez que el iframe termina de cargar (dispara de nuevo en cada cambio de
	// reciboAutoHtml, ya que cambiar `srcdoc` recarga el iframe) midiendo el alto REAL del documento ya
	// renderizado, igual que "object-fit: contain" para una imagen — las 2 copias completas SIEMPRE
	// entran en el recuadro visible, nunca se recortan.
	let previewWrapperEl: HTMLDivElement | undefined = $state();
	let previewIframeEl: HTMLIFrameElement | undefined = $state();
	let previewEscala = $state(0.245);
	function ajustarEscalaPreview() {
		const doc = previewIframeEl?.contentDocument;
		if (!doc || !previewWrapperEl) return;
		// OJO: documentElement.scrollHeight NO sirve acá — como el iframe mide 3000px de alto (ver arriba,
		// a propósito, generoso para que su scroll interno nunca recorte nada antes de medir), un
		// contenido más corto que eso hace que scrollHeight devuelva el alto del VIEWPORT (3000), no el
		// del contenido real (scrollHeight = el mayor entre ambos). Se mide en cambio la posición del
		// borde inferior de la ÚLTIMA copia (siempre el último hijo directo de <body>, ver
		// construirHtmlCompleto en comprobanteTransferenciaInterna.ts/reciboPagoEfectivo.ts/
		// reciboPagoProveedor.ts) + 20px del padding inferior del <body> de esa plantilla.
		const ultimaCopia = doc.body?.lastElementChild as HTMLElement | null;
		if (!ultimaCopia) return;
		const altoContenido = ultimaCopia.getBoundingClientRect().bottom + 20;
		const anchoContenido = 780; // ancho fijo del iframe (ver style más abajo), no hace falta medirlo.
		const cajaAncho = previewWrapperEl.clientWidth;
		const cajaAlto = previewWrapperEl.clientHeight;
		if (!altoContenido || !cajaAncho || !cajaAlto) return;
		previewEscala = Math.min(cajaAncho / anchoContenido, cajaAlto / altoContenido);
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
		// A pedido explícito del usuario: si Categoría ya es "Préstamo" y lo que cambió fue el propio
		// Proyecto (Destino) — el usuario está usando el selector "todos los centros de costo por tipo"
		// que justamente habilita esa Categoría (ver categoriaEsPrestamo/optionsFor) — NO se limpia: todo
		// el sentido de ese selector es poder cambiar de Proyecto sin perder la Categoría ya elegida.
		const mantenerPrestamo = key === 'id_centro_costo_destino' && formValues.tipo === 'ingreso' && formValues.categoria === 'Préstamo';
		// Espejo de mantenerPrestamo, para Egreso: si Categoría ya es "Préstamo Otorgado" y lo que
		// cambió fue el Centro de Costo Origen O el Destino (ver categoriaEsPrestamoOtorgado/optionsFor —
		// esta Categoría se alcanza tanto con Origen=Corporativo como con Clase=Otro en Destino), NO se
		// limpia — mismo criterio, poder reasignar cuál de nuestros centros financia el préstamo, o a
		// quién se le presta, sin perder la Categoría ya elegida.
		const mantenerPrestamoOtorgado =
			(key === 'id_centro_costo_origen' || key === 'id_centro_costo_destino') &&
			formValues.tipo === 'egreso' &&
			((claseEsOtroOPrestamo && formValues.categoria === 'Préstamo') || formValues.categoria === 'Préstamo Otorgado');
		if ((key === 'tipo' || key === 'id_centro_costo_origen' || key === 'id_centro_costo_destino') && !mantenerPrestamo && !mantenerPrestamoOtorgado) {
			formValues.categoria = '';
			categoriaObraGrupo = '';
			categoriaCorpGrupo = '';
			categoriaConsultoriaGrupo = '';
		}
		// "Tipo de Gasto" (7 dropdowns, ver TIPOS_GASTO_CONSULTORIA) solo aplica a Egreso en proyectos de
		// Consultoría — mismos disparadores que Categoría para limpiarlo si deja de aplicar.
		if (key === 'tipo' || key === 'id_centro_costo_origen' || key === 'id_centro_costo_destino') formValues.tipo_gasto = '';
		// En Egreso Y en Transacción Interna, "Cuenta origen" se filtra en cascada a las cuentas que
		// recibieron un Ingreso de este Centro de Costo Origen (ver cuentasBancoIngresosOrigen/
		// optionsFor) — si Origen cambia, la cuenta ya elegida puede no calzar con el nuevo centro, así
		// que se limpia (mismo criterio que Destino arriba en Ingreso).
		if (key === 'id_centro_costo_origen' && (formValues.tipo === 'egreso' || formValues.tipo_alcance === 'interna')) formValues.cuente_origen = '';
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
		// Cambiar el Medio de Pago invalida lo que hubiera elegido antes en Cuenta Origen/Destino — con
		// Yape o Plin ('4') ninguna de las dos aplica (se bloquean, ver medioPagoBloqueaAmbasCuentas);
		// con Efectivo ('1') la cuenta "propia" pasa a filtrarse a solo cuentas de Efectivo (ver
		// filtrarCuentasEfectivo/optionsFor), así que una cuenta bancaria normal ya elegida antes ya no
		// calzaría con la lista filtrada — se limpian ambas en los dos casos, igual que al cambiar
		// Tipo/Alcance arriba.
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
		// El buscador de vínculo filtra por centro de costo (ver idCentroCostoParaVinculo) — si Tipo u
		// alguno de los dos Centro de Costo cambia, lo ya elegido/buscado puede ya no calzar, así que se
		// limpia para no dejar una cuenta vinculada de un centro de costo distinto al actual.
		if (key === 'tipo' || key === 'id_centro_costo_origen' || key === 'id_centro_costo_destino') {
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

	// "Clase" (Proveedores/Empleados/Cliente/Otro) — declarado acá arriba (y no junto al resto de su
	// lógica, más abajo con handleClaseDestinoChange/OPCIONES_CLASE_DESTINO) porque
	// categoriaEsPrestamoOtorgado, justo abajo, ya necesita leerlo — TypeScript exige que un `let`
	// exista antes de su primera referencia en el archivo, aunque sea dentro de un $derived que recién
	// se evalúa después.
	type ClaseDestino = '' | 'proveedores' | 'subcontratista' | 'empleados' | 'cliente' | 'otro' | 'prestamo';
	let claseDestino = $state<ClaseDestino>('');
	// "Otro" y "Préstamo" disparan el mismo comportamiento especial de Categoría/Detalle (ver
	// optionsFor/catalogoDetalleActual más abajo) — la única diferencia entre ambos está en qué
	// centros de costo ofrece "Centro de Costo Destino" (ver optionsFor: "Otro" muestra Obra/
	// Consultoría/Corporativo/Otro, "Préstamo" muestra específicamente los de tipo 'prestamo', ej.
	// "Persona Externa"). Se agrupan acá para no repetir la doble condición en cada sitio.
	const claseEsOtroOPrestamo = $derived(claseDestino === 'otro' || claseDestino === 'prestamo');

	// A pedido explícito del usuario: en Ingreso, apenas Categoría="Préstamo" (en Nueva Y en Editar) —
	// ver optionsFor, que deja de acotar "Proyecto" a solo Corporativo y muestra TODOS los centros de
	// costo agrupados por tipo (un préstamo puede terminar imputado a cualquier proyecto).
	const categoriaEsPrestamo = $derived(formValues.tipo === 'ingreso' && formValues.categoria === 'Préstamo');
	// A pedido explícito del usuario: en Ingreso, si "Persona/Empresa" (Origen) es un centro de costo de
	// tipo 'prestamo' (ej. "Persona Externa", ver formOptions en centroCostos.config.ts) — sin importar
	// qué Categoría se haya elegido todavía — "Proyecto" (Destino) también deja de acotarse y muestra
	// TODOS los centros de costo agrupados por tipo, mismo criterio que categoriaEsPrestamo: un préstamo
	// puede terminar imputado a cualquier proyecto.
	const origenEsTipoPrestamo = $derived(formValues.tipo === 'ingreso' && centroCostoTipoMap[formValues.id_centro_costo_origen] === 'prestamo');
	const destinoMuestraTodosLosCentros = $derived(categoriaEsPrestamo || origenEsTipoPrestamo);
	// A pedido explícito del usuario: al CREAR (no al editar) una transacción Ingreso con Categoría
	// "Préstamo", ya no se crea ninguna transacción — se registra directo como Cuenta por Pagar (ver
	// handleSubmit, que corta ahí mismo, y el botón "Crear" que se convierte en "Cuentas por Pagar" más
	// abajo en el template). NO exige esCorporativo: "Préstamo" solo aparece como opción de Categoría
	// mientras Proyecto es Corporativo (ver CATEGORIA_CORPORATIVO_INGRESO), pero una vez elegida, el
	// usuario puede reasignar Proyecto a cualquier otro centro de costo sin perder la Categoría (ver
	// mantenerPrestamo en handleInput) — el gatillo real es la Categoría en sí, no en qué Proyecto haya
	// terminado.
	const esPrestamoCorporativoIngreso = $derived(mode === 'create' && categoriaEsPrestamo);

	// Espejo de categoriaEsPrestamo/esPrestamoCorporativoIngreso, para Egreso — dos formas de llegar acá:
	// 1) Origen=Corporativo (esCorporativo), donde la Categoría "Préstamo Otorgado" es un valor DISTINTO
	//    del "Préstamo" genérico de CATEGORIA_CORPORATIVO_EGRESO (que sigue siendo una categoría normal
	//    de gasto, ej. pagar una cuota de un préstamo ya existente — no chocan).
	// 2) Clase="Otro" o Clase="Préstamo" en Destino (ver CATEGORIA_OTRO_EGRESO/claseEsOtroOPrestamo/
	//    optionsFor), donde el catálogo reducido usa "Préstamo" directamente — sin ambigüedad ahí, esa
	//    lista no tiene ningún otro significado de "Préstamo" con el que pueda confundirse.
	// A pedido explícito del usuario, al CREAR (no al editar) una transacción Egreso con cualquiera de
	// las dos, tampoco se crea la transacción acá: se registra como Cuenta por Cobrar (ver handleSubmit
	// y el botón "Cuentas por Cobrar" más abajo en el template).
	const categoriaEsPrestamoOtorgado = $derived(
		formValues.tipo === 'egreso' &&
			((claseEsOtroOPrestamo && formValues.categoria === 'Préstamo') || formValues.categoria === 'Préstamo Otorgado')
	);
	const esPrestamoOtorgadoEgreso = $derived(mode === 'create' && categoriaEsPrestamoOtorgado);

	// Etiqueta corta por tipo de centro de costo — solo para agrupar visualmente "Proyecto" cuando
	// categoriaEsPrestamo (ver grupoParaOpcion/optionsFor). Mismos valores que TIPO_CENTRO_COSTO_OPTIONS
	// en dashboardFinanzas.service.ts, pero no vale la pena importarlo solo por este mapa chico.
	const TIPO_CENTRO_COSTO_LABEL_CORTO: Record<string, string> = {
		obra: 'Obra',
		consultoria: 'Consultoría',
		'bolsa general': 'Corporativo',
		area: 'Área',
		otro: 'Otro',
		proyecto: 'Proyecto',
		cliente: 'Cliente',
		proveedor: 'Proveedor',
		empleado: 'Empleado',
		subcontratista: 'Subcontratista'
	};

	// A pedido explícito del usuario: en Ingreso+Externa, si "Persona/Empresa" (Origen) es de tipo
	// Corporativo (bolsa general) u Otro, "Proyecto" (Destino) no tiene una lista real de proyectos que
	// ofrecer — se autocompleta directo con el propio Centro de Costo Corporativo (optionsFor ya reduce
	// la lista de Destino a esa única opción en ese caso, esto además la deja YA elegida, sin que el
	// usuario tenga que abrir el dropdown para confirmar la única opción disponible). EXCEPCIÓN: si ya
	// está en modo Préstamo (categoriaEsPrestamo), Proyecto se elige libre entre TODOS los centros de
	// costo (ver optionsFor) — este autocompletado no debe pisar esa elección de vuelta a Corporativo.
	$effect(() => {
		if (formValues.tipo !== 'ingreso' || formValues.tipo_alcance !== 'externa' || categoriaEsPrestamo) return;
		const tipoOrigen = centroCostoTipoMap[formValues.id_centro_costo_origen];
		if (tipoOrigen !== 'bolsa general' && tipoOrigen !== 'otro') return;
		const corporativo = centroCostoOptionsPersonaEmpresa.find((o) => centroCostoTipoMap[o.value] === 'bolsa general');
		if (corporativo && formValues.id_centro_costo_destino !== corporativo.value) {
			formValues = { ...formValues, id_centro_costo_destino: corporativo.value };
		}
	});

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

	// Paginación de la tabla de Detalle — a pedido explícito del usuario, 10 filas por página. Se
	// "clampea" en vez de corregirse con un $effect (mismo criterio que otras tablas paginadas del
	// ERP, ver movimientos-caja/+page.svelte): si se borran filas y la página actual queda fuera de
	// rango, detallePaginaActual cae sola a la última página válida sin tocar el estado detallePageNum.
	const DETALLE_PAGE_SIZE = 10;
	let detallePageNum = $state(1);
	const detalleTotalPages = $derived(Math.max(1, Math.ceil(detalleCategoria.length / DETALLE_PAGE_SIZE)));
	const detallePaginaActual = $derived(Math.min(detallePageNum, detalleTotalPages));
	const detallePagina = $derived(detalleCategoria.slice((detallePaginaActual - 1) * DETALLE_PAGE_SIZE, detallePaginaActual * DETALLE_PAGE_SIZE));
	function irAPaginaDetalle(p: number) {
		if (p < 1 || p > detalleTotalPages) return;
		detallePageNum = p;
	}

	function agregarFilaDetalleCategoria() {
		detalleCategoriaKeySeq += 1;
		detalleCategoria = [
			...detalleCategoria,
			{ _key: detalleCategoriaKeySeq, subcategoria: '', descripcion: '', cantidad: 1, unidad: 'und', precio_unitario: 0, total: 0 }
		];
		// Salta a la última página para que la fila recién agregada quede visible de una — si no, con
		// 10+ filas ya cargadas parecería que el botón no hizo nada.
		detallePageNum = Math.ceil(detalleCategoria.length / DETALLE_PAGE_SIZE);
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
					detallePageNum = 1;
				})
				.catch((err) => console.error('[TransaccionModal] No se pudo cargar el detalle de categoría:', err));
		}
	});

	// Al abrir en modo edición, trae los comprobantes de pago ya guardados de esa transacción — mismo
	// patrón que el detalle de categoría de arriba.
	$effect(() => {
		if (open && mode === 'edit' && transaccion && comprobantesPagoCargadoParaId !== transaccion.id_transaccion) {
			comprobantesPagoCargadoParaId = transaccion.id_transaccion;
			getComprobantesPago(supabase, transaccion.id_transaccion)
				.then((filas) => {
					comprobantesPago = filas.map((f) => {
						comprobantesPagoKeySeq += 1;
						return { ...f, _key: comprobantesPagoKeySeq };
					});
					comprobantesPagoOriginales = comprobantesPago;
				})
				.catch((err) => console.error('[TransaccionModal] No se pudo cargar los comprobantes de pago:', err));
		}
	});

	// A pedido explícito del usuario: en Ingreso+Externa, "Centro de Costo Origen" (etiqueta "Persona/
	// Empresa", ver labelFor) muestra Clientes + centros de costo de tipo Otro o Corporativo (bolsa
	// general) — ver getCentroCostoOptionsClientesYCorporativoUOtro. Versiones anteriores de este mismo
	// campo mostraron: solo clientes; todos los centros de costo sin filtrar; solo tipo 'proyecto'/
	// 'otro'; el mismo grupo "Centros de Costos" del módulo (obra/consultoría/bolsa general/otro +
	// proyectos de venta cerrada, ver getCentroCostoOptionsSoloCentros) — esta es la definición vigente.
	// "Centro de Costo Destino" (Proyecto) ya NO depende de esta elección — muestra siempre el mismo
	// conjunto que el tab "Centro de Costos" del submódulo homónimo (ver centroCostoOptionsSoloCentros
	// más abajo), sin ninguna cascada cliente→proyectos (la que había antes se quitó a pedido explícito
	// del usuario), salvo la excepción Corporativo/Otro/Préstamo (ver más abajo, optionsFor).
	// centroCostoClienteIdMap se sigue usando para prellenar el nombre/DNI del cliente en el Recibo de
	// Pago cuando el centro elegido SÍ es un cliente (ver clienteReciboNombre/clienteReciboDni más
	// abajo) — solo se quitó su uso para FILTRAR opciones. centroCostoOptionsClientes/Proveedores/
	// Subcontratistas/Empleados se siguen cargando para Egreso+Externa, donde el selector "Clase" (ver
	// más abajo) sigue ofreciendo cada una por separado.
	let centroCostoOptionsPersonaEmpresa = $state<FieldOption[]>([]);
	let centroCostoOptionsClientes = $state<FieldOption[]>([]);
	let centroCostoClienteIdMap = $state<Record<string, string | null>>({});
	let centroCostoOptionsProveedores = $state<FieldOption[]>([]);
	let centroCostoOptionsSubcontratistas = $state<FieldOption[]>([]);
	let centroCostoOptionsEmpleados = $state<FieldOption[]>([]);
	// A pedido explícito del usuario: en Ingreso, si Categoría="Préstamo", "Proyecto" (Destino) deja de
	// estar acotado (a "solo el Corporativo", ver optionsFor) y muestra TODOS los centros de costo,
	// agrupados por tipo (Obra/Consultoría/Corporativo/Otro/etc., ver grupoParaOpcion/optionsFor) — un
	// préstamo puede terminar imputado a cualquier proyecto, no solo a Corporativo.
	let centroCostoOptionsTodos = $state<FieldOption[]>([]);
	// A pedido explícito del usuario: en Ingreso+Externa, "Proyecto" (Destino) — cuando no aplica ninguna
	// de las excepciones de arriba (Préstamo, Origen Corporativo/Otro) — muestra el mismo conjunto que el
	// tab "Centro de Costos" del submódulo homónimo (obra/consultoría/bolsa general manuales + proyectos
	// con venta cerrada, ver getCentroCostoOptionsSoloCentros), antes mostraba la lista general de
	// "proyectos" que le pasaba cada página contenedora vía dynamicOptions — se carga acá adentro en vez
	// de depender de esa prop para que la lista sea la misma sin importar desde qué página (Transacciones,
	// Cuentas por Pagar, Cuentas por Cobrar, Ventas) se abra el modal.
	let centroCostoOptionsSoloCentros = $state<FieldOption[]>([]);
	let centroCostoClientesCargado = $state(false);

	// "Saldo actual"/"Monto actual" junto a Cuenta Origen/Destino y Centro de Costo Origen/Destino — a
	// pedido explícito del usuario, solo estético/informativo (no valida ni bloquea nada, ver
	// fieldBlock más abajo). Mapas cargados de un tirón (una sola consulta cada uno, ver
	// getSaldosCuentaBanco/getSaldosCentroCosto) en vez de una consulta por opción del <select>.
	let saldosCuentaBanco = $state<Record<string, number>>({});
	let saldosCentroCosto = $state<Record<string, number>>({});
	// A pedido explícito del usuario: el símbolo de moneda de "Saldo actual"/"Saldo en la lista" de
	// Cuenta Origen/Destino debe ser el REAL de esa cuenta ('$' Dólares, 'S/.' Soles) — antes siempre se
	// formateaba en Soles (ver formatCurrency), sin importar la moneda real. Ver getMonedasCuentaBanco/
	// simboloMonedaCuenta más abajo.
	let monedasCuentaBanco = $state<Record<string, string>>({});
	async function cargarSaldos() {
		try {
			const [cuentas, centros, monedas] = await Promise.all([getSaldosCuentaBanco(supabase), getSaldosCentroCosto(supabase), getMonedasCuentaBanco(supabase)]);
			saldosCuentaBanco = cuentas;
			saldosCentroCosto = centros;
			monedasCuentaBanco = monedas;
		} catch (err) {
			console.error('[TransaccionModal] No se pudieron cargar los saldos de cuentas/centros de costo:', err);
		}
	}
	/** '$' Dólares, 'S/.' Soles, '' si es 'otro' o no se conoce todavía la moneda de esa cuenta —
	 * mismo criterio que simboloMoneda en CuentaBancoModal.svelte/finanzas/cuentas-bancarias/+page.svelte. */
	function simboloMonedaCuenta(numeroCuenta: string): string {
		const tipo = monedasCuentaBanco[numeroCuenta];
		if (tipo === 'dolares') return '$';
		if (tipo === 'soles') return 'S/.';
		return '';
	}
	/** "Monto (reconocido)" formateado con el símbolo real de "Tipo de Moneda" ('$' Dólares, 'S/.'
	 * Soles) — a pedido explícito del usuario, antes usaba formatCurrency (siempre Soles) sin importar
	 * la moneda elegida para ESTA transacción. */
	function formatMontoTotal(valor: string): string {
		const num = Number(valor);
		if (valor === '' || Number.isNaN(num)) return '';
		const texto = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
		return formValues.tipo_moneda === 'dolares' ? `$ ${texto}` : `S/. ${texto}`;
	}
	// A diferencia de centroCostoClientesCargado (listas relativamente estáticas, se cargan una sola vez
	// por vida del componente), los saldos cambian con cada transacción — se recarga en CADA apertura
	// del modal (no solo la primera), para no mostrar un número desactualizado tras guardar algo en la
	// apertura anterior.
	let saldosAbiertoAnterior = false;
	$effect(() => {
		if (open && !saldosAbiertoAnterior) cargarSaldos();
		saldosAbiertoAnterior = open;
	});

	// En Egreso Y en Transacción Interna, a pedido explícito del usuario: "Cuenta origen" prioriza las
	// cuentas bancarias que alguna vez RECIBIERON un Ingreso a favor de este mismo Centro de Costo
	// Origen — pagar/transferir desde donde de verdad entró el dinero de ese proyecto, no desde
	// cualquier cuenta de la empresa. Si esa lista sale vacía (el centro nunca recibió ningún Ingreso
	// todavía), optionsFor cae de vuelta a mostrar TODAS las cuentas registradas (ver más abajo) —
	// nunca deja el campo sin ninguna opción.
	let cuentasBancoIngresosOrigen = $state<string[]>([]);
	$effect(() => {
		const aplica = formValues.tipo === 'egreso' || bloqueadoPorInterna;
		const idCentroCosto = aplica && formValues.id_centro_costo_origen ? Number(formValues.id_centro_costo_origen) : null;
		if (!open || !idCentroCosto) {
			cuentasBancoIngresosOrigen = [];
			return;
		}
		getCuentasBancoUsadasEnIngresos(supabase, idCentroCosto)
			.then((cuentas) => (cuentasBancoIngresosOrigen = cuentas))
			.catch((err) => {
				console.error('[TransaccionModal] No se pudieron cargar las cuentas usadas en ingresos del centro de costo:', err);
				cuentasBancoIngresosOrigen = [];
			});
	});

	$effect(() => {
		if (open && !centroCostoClientesCargado) {
			centroCostoClientesCargado = true;
			Promise.all([
				getCentroCostoOptionsClientes(supabase),
				getCentroCostoClienteIdMap(supabase),
				getCentroCostoOptionsProveedores(supabase),
				getCentroCostoOptionsSubcontratistas(supabase),
				getCentroCostoOptionsEmpleados(supabase),
				getCentroCostoOptionsClientesYCorporativoUOtro(supabase),
				getCentroCostoOptions(supabase),
				getCentroCostoOptionsSoloCentros(supabase)
			])
				.then(([opciones, mapa, proveedores, subcontratistas, empleados, personaEmpresa, todos, soloCentros]) => {
					centroCostoOptionsClientes = opciones;
					centroCostoClienteIdMap = mapa;
					centroCostoOptionsProveedores = proveedores;
					centroCostoOptionsSubcontratistas = subcontratistas;
					centroCostoOptionsEmpleados = empleados;
					centroCostoOptionsPersonaEmpresa = personaEmpresa;
					centroCostoOptionsTodos = todos;
					centroCostoOptionsSoloCentros = soloCentros;
				})
				.catch((err) => console.error('[TransaccionModal] No se pudo cargar la lista de clientes/proveedores/subcontratistas/empleados/proyectos:', err));
		}
	});

	// "Clase" (Proveedores/Empleados/Cliente/Otro) — dropdown propio, SOLO en Egreso+Externa, entre
	// Centro de Costo Origen y Destino (a pedido explícito del usuario): clasifica qué "Cuenta Interna"
	// ofrece Destino. No es una columna de `transaccion` — es un filtro puramente de UI, se resetea al
	// abrir el modal (ver el $effect principal de `open` más abajo) y al cambiar Tipo/Alcance. (El
	// `type`/`let claseDestino` en sí quedaron declarados más arriba, junto a esCorporativo — ver nota
	// ahí.)
	function handleClaseDestinoChange(value: string) {
		const clasePrevia = claseDestino;
		claseDestino = value as ClaseDestino;
		formValues = { ...formValues, id_centro_costo_destino: '' };
		// Si se sale de "Otro"/"Préstamo" y la Categoría elegida era una de las de Corporativo (esas solo
		// se ofrecen con Clase=Otro/Préstamo o esCorporativo, ver optionsFor) — se limpia, igual que el
		// resto de campos que dependen de Destino en handleInput, para no dejar guardado un valor que ya
		// no aparece en la lista de opciones. Si esCorporativo sigue siendo true (Origen=Corporativo), esa
		// lista sigue aplicando igual, no se limpia.
		const clasePreviaEraOtroOPrestamo = clasePrevia === 'otro' || clasePrevia === 'prestamo';
		const claseNuevaEsOtroOPrestamo = value === 'otro' || value === 'prestamo';
		if (clasePreviaEraOtroOPrestamo && !claseNuevaEsOtroOPrestamo && !esCorporativo) {
			formValues.categoria = '';
		}
		// Espejo, al ENTRAR a "Otro"/"Préstamo": si la Categoría ya elegida no es una de las 2 del
		// catálogo reducido (Inyecciones/Préstamo, ver CATEGORIA_OTRO_EGRESO) — ej. venía de las 8 de
		// Corporativo — se limpia, para no dejar seleccionado un valor que ya no aparece en la lista que
		// se va a mostrar.
		if (claseNuevaEsOtroOPrestamo && !['Inyecciones', 'Préstamo'].includes(formValues.categoria)) {
			formValues.categoria = '';
		}
	}
	// "Subcontratista" filtra los centros de costo de proveedores cuyo "Producto y Servicio" es
	// 'SUBCONTRATISTA - OBRA' (centro_costo.tipo='subcontratista', ver sincronizarTipoCentroCostoProveedor
	// en centroCostos.service.ts) — lista real y separada de "Proveedores", a pedido explícito del usuario.
	// "Otro" (a pedido explícito del usuario) — a diferencia de las 4 anteriores (cada una acotada a una
	// lista curada de una sola entidad), no filtra nada: Centro de Costo Destino pasa a mostrar TODOS los
	// centros de costo sin restringir (ver optionsFor/centroCostoOptionsTodos) — para cubrir el caso de un
	// Egreso cuyo destino no es proveedor/subcontratista/empleado/cliente (ej. un centro de costo de
	// proyecto, Corporativo, o tipo 'otro' propiamente dicho).
	// "Préstamo" (a pedido explícito del usuario) — a diferencia de "Otro" (que muestra Obra/
	// Consultoría/Corporativo/Otro), esta filtra específicamente a los centros de costo de tipo
	// 'prestamo' (ej. "Persona Externa", ver centroCostos.config.ts) — las cuentas creadas a mano
	// justo para representar a quien recibe un préstamo otorgado.
	const OPCIONES_CLASE_DESTINO: { value: ClaseDestino; label: string }[] = [
		{ value: 'proveedores', label: 'Proveedores' },
		{ value: 'subcontratista', label: 'Subcontratista' },
		{ value: 'empleados', label: 'Empleados' },
		{ value: 'cliente', label: 'Cliente' },
		{ value: 'otro', label: 'Otro' },
		{ value: 'prestamo', label: 'Préstamo' }
	];
	// Al editar una transacción de Egreso ya guardada, infiere la Clase a partir de a qué lista
	// pertenece el Destino guardado — para no arrancar con el selector vacío y el campo Destino oculto.
	// "Otro" es el fallback cuando el Destino guardado no calza con NINGUNA de las 4 listas curadas (ej.
	// transacciones viejas hacia un centro de costo de proyecto/Corporativo/tipo 'otro') — antes de
	// agregar esta opción, ese caso dejaba Clase vacía y Centro de Costo Destino sin ninguna opción que
	// mostrar (ver optionsFor), ocultando de hecho el valor ya guardado.
	$effect(() => {
		if (open && mode === 'edit' && transaccion && formValues.tipo === 'egreso' && !claseDestino && centroCostoClientesCargado) {
			const destinoId = String(transaccion.id_centro_costo_destino);
			if (centroCostoOptionsProveedores.some((o) => o.value === destinoId)) claseDestino = 'proveedores';
			else if (centroCostoOptionsSubcontratistas.some((o) => o.value === destinoId)) claseDestino = 'subcontratista';
			else if (centroCostoOptionsEmpleados.some((o) => o.value === destinoId)) claseDestino = 'empleados';
			else if (centroCostoOptionsClientes.some((o) => o.value === destinoId)) claseDestino = 'cliente';
			else if (centroCostoTipoMap[destinoId] === 'prestamo') claseDestino = 'prestamo';
			else claseDestino = 'otro';
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
		{ value: 'Inversión', label: 'Inversión' },
		// A pedido explícito del usuario: valor DISTINTO del "Préstamo" de arriba (esa sigue siendo una
		// categoría normal de gasto, ej. pagar una cuota) — dispara el flujo espejo de Ingreso+Préstamo,
		// ver categoriaEsPrestamoOtorgado/esPrestamoOtorgadoEgreso más arriba. Solo aplica cuando esta
		// lista se ofrece por esCorporativo (Origen=Corporativo); ver CATEGORIA_OTRO_EGRESO más abajo
		// para el mismo flujo alcanzado por Clase=Otro, que usa el "Préstamo" de arriba directamente
		// (sin ambigüedad ahí, porque esa lista no tiene ningún otro significado de "Préstamo").
		{ value: 'Préstamo Otorgado', label: 'Préstamo Otorgado' }
	];
	// A pedido explícito del usuario: Egreso + Clase="Otro" (ver claseDestino/optionsFor) ofrece este
	// catálogo reducido, en vez de las 8 categorías de CATEGORIA_CORPORATIVO_EGRESO — mismas 2 opciones
	// que CATEGORIA_CORPORATIVO_INGRESO. Acá "Préstamo" SÍ dispara el flujo de Préstamo Otorgado (ver
	// categoriaEsPrestamoOtorgado), porque en esta lista acotada no hay otro "Préstamo" con el que
	// pueda confundirse (a diferencia de CATEGORIA_CORPORATIVO_EGRESO, donde "Préstamo" ya significa
	// "pagar una cuota" y por eso esa lista usa "Préstamo Otorgado" para no chocar).
	const CATEGORIA_OTRO_EGRESO: FieldOption[] = [
		{ value: 'Inyecciones', label: 'Inyecciones' },
		{ value: 'Préstamo', label: 'Préstamo' }
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

	// Categoría en cascada para Consultoría + Egreso, a pedido explícito del usuario — mismo patrón que
	// categoriaObraGrupo/categoriaCorpGrupo más abajo, pero con TIPOS_GASTO_CONSULTORIA como fuente.
	let categoriaConsultoriaGrupo = $state('');
	const categoriaConsultoriaGrupoEfectivo = $derived.by(() => {
		if (categoriaConsultoriaGrupo) return categoriaConsultoriaGrupo;
		return TIPOS_GASTO_CONSULTORIA.find((g) => g.opciones.includes(formValues.categoria))?.key ?? '';
	});
	function handleCategoriaConsultoriaGrupoChange(value: string) {
		categoriaConsultoriaGrupo = value;
		handleInput('categoria', '');
	}

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
				'Operario',
				'Ayudante',
				'Oficial',
				'Vigilante',
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
		{ key: 'gastos_generales', label: 'Gastos Generales', opciones: ['Implementación de Oficina de Obra', 'Implementación de Almacén', 'Otros Gastos Generales'] },
		// A pedido explícito del usuario: 'Alquileres' y 'Préstamo' se agregan como grupos propios del
		// Catálogo de Obra/Supervisión (antes solo existían como categorías planas del sistema viejo,
		// CATEGORIA_OBRA_EGRESO). Sin un cuadro de referencia con subopciones específicas, cada uno
		// arranca con un solo item genérico — mismo criterio que 'Alquileres' en TIPOS_GASTO_CONSULTORIA.
		{ key: 'alquileres_obra', label: 'Alquileres', opciones: ['Otros Alquiler'] },
		{ key: 'prestamo_obra', label: 'Préstamo', opciones: ['Otros Préstamo'] }
	];

	// Especialidad de Operario/Oficial/Ayudante (2do nivel de Sub Contrata, ver TIPOS_GASTO_OBRA), a
	// pedido explícito del usuario con su propio cuadro de referencia — presentada como <optgroup>
	// DENTRO del mismo dropdown de Subcategoría (ver template más abajo), no como un 3er selector aparte
	// (versión anterior, más compleja). El valor final que se guarda en formValues.categoria/se agrega a
	// Detalle es la especialidad elegida (ej. "Operario Carpintero"), no el rol genérico — ver
	// transaccion.config.ts, que también necesita cada especialidad en su lista de `options` para pasar
	// validatePayload.
	const SUBOPCIONES_SUBCONTRATA: Record<string, string[]> = {
		Operario: ['Operario Carpintero', 'Operario Albañil', 'Operario Fierrero', 'Operario Eléctrico', 'Operario Sanitario', 'Operario Multifuncional'],
		Oficial: ['Oficial Carpintero', 'Oficial Albañil', 'Oficial Fierrero', 'Oficial Eléctrico'],
		Ayudante: ['Ayudante Sanitario', 'Ayudante Carpintero', 'Ayudante Albañil', 'Ayudante Fierrero', 'Ayudante Eléctrico', 'Ayudante General']
	};
	/** Si `valor` es una especialidad (ej. "Operario Carpintero"), devuelve su rol padre ("Operario") —
	 * solo para reconstruir a qué GRUPO ("Sub Contrata") pertenece un valor ya guardado al editar (ver
	 * categoriaObraGrupoEfectivo más abajo); el dropdown en sí ya no lo necesita (un <select> nativo
	 * selecciona su <option> aunque esté dentro de un <optgroup>, sin ayuda extra). null si `valor` no es
	 * ninguna especialidad. */
	function rolPadreDeSubOpcion(valor: string): string | null {
		for (const rol in SUBOPCIONES_SUBCONTRATA) {
			if (SUBOPCIONES_SUBCONTRATA[rol].includes(valor)) return rol;
		}
		return null;
	}

	// Categoría en cascada para Obra + Egreso, a pedido explícito del usuario: primer dropdown = grupo
	// (mismas columnas de TIPOS_GASTO_OBRA), segundo dropdown = la opción de ese grupo, que se guarda
	// directo en formValues.categoria. categoriaObraGrupo es puro estado de UI (no se persiste); al
	// editar una transacción existente se reconstruye buscando en qué grupo cae el valor ya guardado —
	// tolerante a que ese valor ya sea una especialidad de tercer nivel (ver rolPadreDeSubOpcion).
	let categoriaObraGrupo = $state('');
	const categoriaObraGrupoEfectivo = $derived.by(() => {
		if (categoriaObraGrupo) return categoriaObraGrupo;
		const valor = rolPadreDeSubOpcion(formValues.categoria) ?? formValues.categoria;
		return TIPOS_GASTO_OBRA.find((g) => g.opciones.includes(valor))?.key ?? '';
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

	// Categoría en cascada para Corporativo + Egreso, a pedido explícito del usuario — mismo patrón que
	// categoriaObraGrupo/TIPOS_GASTO_OBRA más arriba, pero con TIPOS_GASTO_CORPORATIVO como fuente.
	let categoriaCorpGrupo = $state('');
	const categoriaCorpGrupoEfectivo = $derived.by(() => {
		if (categoriaCorpGrupo) return categoriaCorpGrupo;
		return TIPOS_GASTO_CORPORATIVO.find((g) => g.opciones.includes(formValues.categoria))?.key ?? '';
	});
	function handleCategoriaCorpGrupoChange(value: string) {
		categoriaCorpGrupo = value;
		handleInput('categoria', '');
	}

	// "Catálogo" de la sección Detalle, a pedido explícito del usuario: reusa el mismo cuadro de
	// referencia (Grupo → Subopción) que ya arma la Categoría en cascada de arriba, según el tipo de
	// proyecto del Centro de Costo elegido — para no mantener un catálogo duplicado. Si el proyecto no es
	// Obra/Consultoría/Corporativo (o todavía no se eligió Centro de Costo) no hay catálogo que ofrecer;
	// en ese caso "+Agregar subcategoría" (ver template) vuelve a agregar una fila en blanco para
	// escribir a mano, como única alternativa funcional.
	// Solo aplica a Egreso — en Ingreso, Obra usa Adelanto/Valorización/Adenda y Corporativo usa
	// Inyecciones/Préstamo (ambas listas planas, sin desglose de subcategorías), así que "Otros campos"
	// debe seguir mostrando el selector normal de Categoría en vez de la vista de solo lectura.
	// A pedido explícito del usuario: con Clase="Otro" o Clase="Préstamo" (ver claseEsOtroOPrestamo/
	// CATEGORIA_OTRO_EGRESO en optionsFor), basta esa sola condición para que la Categoría vuelva a ser
	// el selector plano de solo 2 opciones (Inyecciones/Préstamo) — NO ninguna de las 3 cascadas
	// Grupo→Subcategoría (TIPOS_GASTO_OBRA/CONSULTORIA/CORPORATIVO), sin importar de qué tipo sea el
	// Centro de Costo Origen. Sin esta excepción, esProyectoDeObra/esProyectoDeConsultoria/esCorporativo
	// por sí solos forzaban su cascada (ver el {#if catalogoDetalleActual.length > 0} del template) y el
	// "Préstamo" elegido ahí terminaba siendo solo el GRUPO — la Categoría real quedaba en la
	// Subcategoría elegida (ej. "Tarjeta de Crédito Pierina"), nunca el literal "Préstamo" que
	// categoriaEsPrestamoOtorgado espera.
	const catalogoDetalleActual = $derived(
		formValues.tipo !== 'egreso' || claseEsOtroOPrestamo
			? []
			: esProyectoDeObra
				? TIPOS_GASTO_OBRA
				: esProyectoDeConsultoria
					? TIPOS_GASTO_CONSULTORIA
					: esCorporativo
						? TIPOS_GASTO_CORPORATIVO
						: []
	);
	// A pedido explícito del usuario: en cuanto el Centro de Costo elegido resuelve a un catálogo
	// (Obra/Consultoría/Corporativo + Egreso), la sección "Detalle" se abre sola — no hace falta que el
	// usuario haga clic en la flechita. catalogoAbiertoAuto evita reabrirla de nuevo si el usuario la
	// cierra a mano mientras la condición sigue vigente; se resetea apenas esa condición deja de darse.
	let catalogoAbiertoAuto = false;
	$effect(() => {
		if (open && catalogoDetalleActual.length > 0 && !catalogoAbiertoAuto) {
			catalogoAbiertoAuto = true;
			detalleCategoriaAbierto = true;
		} else if (catalogoDetalleActual.length === 0) {
			catalogoAbiertoAuto = false;
		}
	});
	// El Grupo elegido en el Catálogo de Detalle reusa el mismo estado (categoriaObraGrupo/
	// categoriaCorpGrupo/categoriaConsultoriaGrupo) que antes vivía en "Otros campos" — a pedido
	// explícito del usuario, esa cascada se movió por completo acá, así que ya no hace falta un cuarto
	// estado paralelo solo para Detalle.
	const detalleCatalogoGrupoEfectivo = $derived(esProyectoDeObra ? categoriaObraGrupoEfectivo : esProyectoDeConsultoria ? categoriaConsultoriaGrupoEfectivo : esCorporativo ? categoriaCorpGrupoEfectivo : '');
	function handleDetalleCatalogoGrupoChange(value: string) {
		if (esProyectoDeObra) handleCategoriaObraGrupoChange(value);
		else if (esProyectoDeConsultoria) handleCategoriaConsultoriaGrupoChange(value);
		else if (esCorporativo) handleCategoriaCorpGrupoChange(value);
	}
	function agregarFilaDesdeCatalogo(subcategoria: string) {
		if (!subcategoria) return;
		// Además de agregar la fila al Detalle, esta selección ES la Categoría de la transacción — a
		// pedido explícito del usuario, ya no hay un selector aparte en "Otros campos" para elegirla.
		handleInput('categoria', subcategoria);
		detalleCategoriaKeySeq += 1;
		detalleCategoria = [
			...detalleCategoria,
			{ _key: detalleCategoriaKeySeq, subcategoria, descripcion: '', cantidad: 1, unidad: 'und', precio_unitario: 0, total: 0 }
		];
		detallePageNum = Math.ceil(detalleCategoria.length / DETALLE_PAGE_SIZE);
	}

	const cuentaDestinoEsBancaria = $derived(bloqueadoPorInterna || (formValues.tipo_alcance === 'externa' && formValues.tipo === 'ingreso'));
	const cuentaOrigenEsBancaria = $derived(bloqueadoPorInterna || (formValues.tipo_alcance === 'externa' && formValues.tipo === 'egreso'));
	// Yape o Plin ('4') no pasa por ninguna cuenta bancaria de ningún lado — sigue bloqueando Cuenta
	// Origen y Cuenta Destino por completo (y se limpian, ver handleInput), sin cambios de diseño acá.
	const medioPagoBloqueaAmbasCuentas = $derived(String(formValues.medio_pago ?? '') === '4');
	// Efectivo ('1') — a pedido explícito del usuario: la cuenta "propia" (Destino en Ingreso, Origen en
	// Egreso, ver cuentaDestinoEsBancaria/cuentaOrigenEsBancaria) YA NO se bloquea — el pago en efectivo
	// sí registra una cuenta bancaria real, pero debe ser una cuenta de EFECTIVO (caja chica/fondo, ver
	// filtrarCuentasEfectivo más abajo), no cualquier cuenta bancaria. La cuenta de la CONTRAPARTE
	// (Origen en Ingreso, Destino en Egreso) sigue sin sentido en efectivo — no hay cuenta bancaria de
	// la otra parte que registrar — así que esa sí se sigue bloqueando (ver isBloqueadoPorMedioPago).
	const medioPagoEsEfectivo = $derived(String(formValues.medio_pago ?? '') === '1');
	/** Cuentas bancarias registradas cuyo nombre/titular contiene "efectivo" (ej. "EFECTIVO_GUILLERMO")
	 * — así se modela una caja chica/fondo de efectivo en Finanzas → Cuentas Bancarias, no hay una
	 * columna/tipo separado para distinguirlas de una cuenta bancaria real. */
	function filtrarCuentasEfectivo(opciones: FieldOption[]): FieldOption[] {
		return opciones.filter((o) => /efectivo/i.test(o.label));
	}
	/** A pedido explícito del usuario: "Cuenta Origen"/"Cuenta Destino" solo ofrecen las cuentas
	 * bancarias de la MISMA moneda que "Tipo de Moneda" (ver monedasCuentaBanco/getMonedasCuentaBanco)
	 * — con Soles, solo cuentas en soles; con Dólares, solo cuentas en dólares. Si el valor ya elegido
	 * (editando) no calza con la moneda actual, se agrega igual — mismo criterio de seguridad que
	 * Clase=Otro/Préstamo en Centro de Costo Destino, para no dejar el campo con un valor que no
	 * aparece en su propia lista. */
	function filtrarCuentasPorMoneda(opciones: FieldOption[], valorActual?: string): FieldOption[] {
		const monedaActual = formValues.tipo_moneda === 'dolares' ? 'dolares' : 'soles';
		const filtradas = opciones.filter((o) => monedasCuentaBanco[o.value] === monedaActual);
		if (valorActual && !filtradas.some((o) => o.value === valorActual)) {
			const actual = opciones.find((o) => o.value === valorActual);
			if (actual) filtradas.push(actual);
		}
		return filtradas;
	}
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
			// - Ingreso: "Centro de Costo Origen" ("Persona/Empresa", ver labelFor) muestra Clientes +
			//   centros de costo de tipo Otro o Corporativo (bolsa general, ver
			//   getCentroCostoOptionsClientesYCorporativoUOtro) y "Centro de Costo Destino" (Proyecto)
			//   muestra el mismo conjunto que el tab "Centro de Costos" del submódulo homónimo (obra/
			//   consultoría/bolsa general manuales + proyectos con venta cerrada, ver
			//   getCentroCostoOptionsSoloCentros/centroCostoOptionsSoloCentros) — SIN cascada, sin importar
			//   qué se haya elegido en Origen (la cascada cliente→proyectos que había antes se quitó a
			//   pedido explícito del usuario). EXCEPCIÓN, a pedido explícito del usuario: si Origen es de tipo
			//   Corporativo u Otro, ninguno tiene proyectos propios — Destino pasa a mostrar directo el
			//   propio Centro de Costo Corporativo (mismo criterio que el caso "Socio o Banca" que existía
			//   antes de la cascada por cliente). OTRA EXCEPCIÓN, sobre la anterior: si Categoría="Préstamo"
			//   (categoriaEsPrestamo) O si Origen ya es un centro de costo de tipo 'prestamo' (ej. "Persona
			//   Externa", ver origenEsTipoPrestamo/destinoMuestraTodosLosCentros), Destino deja de estar
			//   acotado y muestra TODOS los centros de costo, agrupados por tipo (ver grupoParaOpcion) — un
			//   préstamo puede terminar imputado a cualquier proyecto, no solo a Corporativo.
			// - Egreso: "Centro de Costo Origen" usa "Centro de Costos" en su sentido estricto (proyectos
			//   y corporativo — ver getCentroCostoOptionsSoloCentros, misma definición que el tab "Centro
			//   de Costos" del submódulo Centro de Costos y Cuentas Internas) y "Centro de Costo Destino"
			//   muestra "Cuentas Internas" (proveedor/empleado/cliente), filtradas por el selector
			//   "Clase" que aparece entre ambos campos (ver claseDestino/OPCIONES_CLASE_DESTINO) — vacío
			//   mientras no se haya elegido una Clase todavía.
			if (formValues.tipo === 'ingreso' && formValues.tipo_alcance === 'externa') {
				if (field.key === 'id_centro_costo_origen') return soloNombreCentro(centroCostoOptionsPersonaEmpresa);
				if (destinoMuestraTodosLosCentros) {
					// Ordenado por grupo (tipo) — SelectConSaldo (ver grupoParaOpcion/fieldBlock) necesita
					// las opciones de un mismo grupo CONSECUTIVAS para dibujar un solo encabezado por
					// grupo, no las reordena por su cuenta.
					const ordenado = [...centroCostoOptionsTodos].sort((a, b) => {
						const grupoA = TIPO_CENTRO_COSTO_LABEL_CORTO[centroCostoTipoMap[a.value]] ?? 'Otros';
						const grupoB = TIPO_CENTRO_COSTO_LABEL_CORTO[centroCostoTipoMap[b.value]] ?? 'Otros';
						return grupoA === grupoB ? 0 : grupoA < grupoB ? -1 : 1;
					});
					return soloNombreCentro(ordenado);
				}
				const tipoOrigen = centroCostoTipoMap[formValues.id_centro_costo_origen];
				if (tipoOrigen === 'bolsa general' || tipoOrigen === 'otro') {
					const corporativo = centroCostoOptionsPersonaEmpresa.find((o) => centroCostoTipoMap[o.value] === 'bolsa general');
					return corporativo ? soloNombreCentro([corporativo]) : [];
				}
				return soloNombreCentro(centroCostoOptionsSoloCentros);
			}
			if (formValues.tipo === 'egreso' && formValues.tipo_alcance === 'externa') {
				if (field.key === 'id_centro_costo_origen') return soloNombreCentro(dynamicOptions.id_centro_costo_destino_solo_centros || []);
				if (claseDestino === 'proveedores') return soloNombreCentro(centroCostoOptionsProveedores);
				if (claseDestino === 'subcontratista') return soloNombreCentro(centroCostoOptionsSubcontratistas);
				if (claseDestino === 'empleados') return soloNombreCentro(centroCostoOptionsEmpleados);
				if (claseDestino === 'cliente') return soloNombreCentro(centroCostoOptionsClientes);
				// "Otro" (a pedido explícito del usuario) — cuentas externas de tipo 'otro', 'consultoria',
				// 'obra' o 'bolsa general' (Corporativo): cubre el caso de un Egreso cuyo destino no es un
				// proveedor/subcontratista/empleado/cliente registrado (ej. un préstamo que se le da a una
				// persona sin vínculo formal en el sistema — ver categoria más abajo, esCorporativo).
				if (claseDestino === 'otro') {
					const TIPOS_CLASE_OTRO = new Set(['otro', 'consultoria', 'obra', 'bolsa general']);
					const opcionesOtro = centroCostoOptionsTodos.filter((o) => TIPOS_CLASE_OTRO.has(centroCostoTipoMap[o.value]));
					// Si el Destino ya guardado (ver el fallback a 'otro' en el $effect de arriba, al editar)
					// no calza con ninguno de esos 4 tipos, se agrega igual — sin esto, el campo quedaría con
					// un valor elegido que no aparece en su propia lista de opciones.
					if (formValues.id_centro_costo_destino && !opcionesOtro.some((o) => o.value === formValues.id_centro_costo_destino)) {
						const actual = centroCostoOptionsTodos.find((o) => o.value === formValues.id_centro_costo_destino);
						if (actual) opcionesOtro.push(actual);
					}
					return soloNombreCentro(opcionesOtro);
				}
				// "Préstamo" (a pedido explícito del usuario) — a diferencia de "Otro" de arriba, filtra
				// específicamente a los centros de costo de tipo 'prestamo' (ej. "Persona Externa"), las
				// cuentas creadas a mano justo para representar a quien recibe un préstamo otorgado.
				if (claseDestino === 'prestamo') {
					const opcionesPrestamo = centroCostoOptionsTodos.filter((o) => centroCostoTipoMap[o.value] === 'prestamo');
					if (formValues.id_centro_costo_destino && !opcionesPrestamo.some((o) => o.value === formValues.id_centro_costo_destino)) {
						const actual = centroCostoOptionsTodos.find((o) => o.value === formValues.id_centro_costo_destino);
						if (actual) opcionesPrestamo.push(actual);
					}
					return soloNombreCentro(opcionesPrestamo);
				}
				return [];
			}
			// A pedido explícito del usuario: en Transacción Interna, "Centro de Costo Origen" y "Centro de
			// Costo Destino" muestran el mismo conjunto que el tab "Centro de Costos" del submódulo
			// homónimo (obra/consultoría/bolsa general/otro + proyectos con venta cerrada, ver
			// getCentroCostoOptionsSoloCentros/centroCostoOptionsSoloCentros) — antes mostraban solo
			// centros vinculados a un proyecto (cualquier estado de venta), vía dynamicOptions.
			if (formValues.tipo_alcance !== 'externa') return soloNombreCentro(centroCostoOptionsSoloCentros);
			const key = `${field.key}_externo`;
			return soloNombreCentro(dynamicOptions[key] || []);
		}
		if (field.key === 'cuente_destino' && cuentaDestinoEsBancaria) {
			const todas = filtrarCuentasPorMoneda(dynamicOptions.cuenta_banco || [], formValues.cuente_destino);
			return medioPagoEsEfectivo ? filtrarCuentasEfectivo(todas) : todas;
		}
		if (field.key === 'cuente_origen' && cuentaOrigenEsBancaria) {
			const todas = filtrarCuentasPorMoneda(dynamicOptions.cuenta_banco || [], formValues.cuente_origen);
			// Efectivo: solo cuentas de caja chica/fondo (ver filtrarCuentasEfectivo) — manda sobre el
			// filtro de "cuentas que recibieron algún Ingreso" de abajo, no se combinan.
			if (medioPagoEsEfectivo) return filtrarCuentasEfectivo(todas);
			// Egreso Y Transacción Interna: prioriza las cuentas que recibieron algún Ingreso de este
			// Centro de Costo Origen (ver cuentasBancoIngresosOrigen) — si esa lista sale vacía (el centro
			// nunca recibió ningún Ingreso), cae de vuelta a TODAS las cuentas registradas, para no dejar
			// el campo sin opciones.
			if ((formValues.tipo === 'egreso' || bloqueadoPorInterna) && cuentasBancoIngresosOrigen.length > 0) {
				const filtradas = todas.filter((o) => cuentasBancoIngresosOrigen.includes(o.value));
				if (filtradas.length > 0) return filtradas;
			}
			return todas;
		}
		if (field.key === 'categoria' && esConfirmarCobro) return CATEGORIA_CONFIRMAR_COBRO;
		// A pedido explícito del usuario: en Egreso, basta con que Clase="Otro" o Clase="Préstamo" para
		// que "Categoría" ofrezca el catálogo reducido (Inyecciones/Préstamo, ver CATEGORIA_OTRO_EGRESO)
		// — manda por ENCIMA de esProyectoDeObra/esCorporativo (ambos basados en el Centro de Costo
		// Origen, un eje independiente de Clase/Destino): aunque el Origen sea de Obra o Corporativo, con
		// Clase="Otro"/"Préstamo" igual se muestra esta lista, no CATEGORIA_OBRA_EGRESO/
		// CATEGORIA_CORPORATIVO_EGRESO.
		if (field.key === 'categoria' && formValues.tipo === 'egreso' && claseEsOtroOPrestamo) return CATEGORIA_OTRO_EGRESO;
		if (field.key === 'categoria' && esProyectoDeObra && formValues.tipo === 'ingreso') return CATEGORIA_OBRA_INGRESO;
		if (field.key === 'categoria' && esProyectoDeObra && formValues.tipo === 'egreso') return CATEGORIA_OBRA_EGRESO;
		if (field.key === 'categoria' && esCorporativo && formValues.tipo === 'ingreso') return CATEGORIA_CORPORATIVO_INGRESO;
		if (field.key === 'categoria' && esCorporativo && formValues.tipo === 'egreso') return CATEGORIA_CORPORATIVO_EGRESO;
		if (field.optionsWhen) return field.optionsWhen(formValues);
		return (field.optionsSource && dynamicOptions[field.key]) || field.options || [];
	}

	/** true para los 4 campos que muestran su saldo/monto actual pegado al lado derecho DENTRO del
	 * dropdown — a pedido explícito del usuario, con imagen de referencia: Centro de Costo Origen/
	 * Destino y Cuenta Origen/Destino (esta última solo cuando es una cuenta bancaria registrada, ver
	 * cuentaOrigenEsBancaria/cuentaDestinoEsBancaria). Un <option> nativo no puede alinear nada a la
	 * derecha (es texto plano), así que estos 4 campos usan SelectConSaldo.svelte en vez del <select>
	 * nativo que sigue usando el resto del formulario (ver fieldBlock más abajo). */
	function esCampoConSaldo(field: (typeof formFields)[number]): boolean {
		return (
			field.key === 'id_centro_costo_origen' ||
			field.key === 'id_centro_costo_destino' ||
			(field.key === 'cuente_destino' && cuentaDestinoEsBancaria) ||
			(field.key === 'cuente_origen' && cuentaOrigenEsBancaria)
		);
	}

	/** Saldo/monto actual de una opción puntual, para SelectConSaldo — ver getSaldosCentroCosto/
	 * getSaldosCuentaBanco. undefined = sin saldo conocido todavía (los mapas siguen cargando), el
	 * componente simplemente no muestra nada al costado en vez de un "S/ 0.00" engañoso. */
	function saldoParaOpcion(field: (typeof formFields)[number], opt: FieldOption): number | undefined {
		if (field.key === 'id_centro_costo_origen' || field.key === 'id_centro_costo_destino') {
			return opt.value in saldosCentroCosto ? saldosCentroCosto[opt.value] : undefined;
		}
		if ((field.key === 'cuente_destino' && cuentaDestinoEsBancaria) || (field.key === 'cuente_origen' && cuentaOrigenEsBancaria)) {
			return opt.value in saldosCuentaBanco ? saldosCuentaBanco[opt.value] : undefined;
		}
		return undefined;
	}

	/** Símbolo de moneda para el saldo de una opción de Cuenta Origen/Destino (ver saldoParaOpcion) — a
	 * pedido explícito del usuario, '$'/'S/.' según la moneda REAL de esa cuenta bancaria, en vez del
	 * formatCurrency genérico (siempre Soles) que usaba SelectConSaldo por defecto. undefined para
	 * Centro de Costo (esos no tienen una moneda propia distinta, siguen con formatCurrency). */
	function simboloParaOpcion(field: (typeof formFields)[number], opt: FieldOption): string | undefined {
		if ((field.key === 'cuente_destino' && cuentaDestinoEsBancaria) || (field.key === 'cuente_origen' && cuentaOrigenEsBancaria)) {
			return simboloMonedaCuenta(opt.value) || undefined;
		}
		return undefined;
	}

	/** Grupo (por tipo de centro de costo) para una opción de "Proyecto" (Destino), SOLO cuando
	 * destinoMuestraTodosLosCentros (ver optionsFor, que en ese caso ya ordena la lista por grupo) —
	 * undefined en cualquier otro campo/caso, para que SelectConSaldo no dibuje ningún encabezado
	 * (comportamiento normal, sin agrupar). */
	function grupoParaOpcion(field: (typeof formFields)[number], opt: FieldOption): string | undefined {
		if (field.key !== 'id_centro_costo_destino' || !destinoMuestraTodosLosCentros) return undefined;
		return TIPO_CENTRO_COSTO_LABEL_CORTO[centroCostoTipoMap[opt.value]] ?? 'Otros';
	}

	/** Saldo de la opción YA ELEGIDA (no de cada opción de la lista, ver saldoParaOpcion arriba) — a
	 * pedido explícito del usuario: una vez elegida una Cuenta o un Centro de Costo, su saldo debe
	 * seguir viéndose DEBAJO del dropdown ya cerrado, no solo dentro de la lista mientras está abierta. */
	function saldoSeleccionado(field: (typeof formFields)[number]): number | undefined {
		const valor = formValues[field.key];
		if (!valor) return undefined;
		return saldoParaOpcion(field, { value: valor, label: '' });
	}

	/** Formatea el "Saldo actual" YA ELEGIDO (ver saldoSeleccionado) con el símbolo real de esa cuenta
	 * bancaria ('$'/'S/.', ver simboloMonedaCuenta) en vez del formatCurrency genérico — a pedido
	 * explícito del usuario, mismo criterio que simboloParaOpcion para la lista desplegada. */
	function formatSaldoSeleccionado(field: (typeof formFields)[number], saldo: number): string {
		const simbolo = simboloParaOpcion(field, { value: formValues[field.key], label: '' });
		if (simbolo) return `${simbolo} ${new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(saldo)}`;
		return formatCurrency(saldo);
	}

	/** "Saldo actual" de la opción ya elegida (ver saldoSeleccionado) — a pedido explícito del usuario,
	 * arranca oculto tras asteriscos y solo se revela al hacer clic encima; uno por campo (Cuenta Origen/
	 * Destino, Centro de Costo Origen/Destino pueden estar los 4 visibles a la vez). Se reinicia a oculto
	 * cada vez que cambia la opción elegida en ese campo (ver el {#key} en el template) — no se queda
	 * "pegado" revelado al cambiar de cuenta/centro de costo. */
	let saldosRevelados = $state<Record<string, boolean>>({});

	/** Etiqueta del campo — normalmente `field.label` tal cual, salvo Origen/Destino en Ingreso+Externa:
	 * como ahí muestran clientes/proyectos (ver optionsFor), a pedido explícito del usuario la etiqueta
	 * también cambia para reflejar lo que de verdad se está eligiendo. */
	function labelFor(field: (typeof formFields)[number]): string {
		// A pedido explícito del usuario: con Categoría="Préstamo" (Ingreso, ver categoriaEsPrestamo) o
		// "Préstamo"/"Préstamo Otorgado" (Egreso, ver categoriaEsPrestamoOtorgado), Origen pasa a
		// llamarse "Prestamista" (quién presta) y Destino "Prestatario" (a quién se le presta) — manda
		// por ENCIMA de "Persona/Empresa"/"Proyecto" de abajo (que sigue aplicando en Ingreso+Externa
		// mientras la Categoría NO sea Préstamo).
		if (formValues.tipo === 'ingreso' && categoriaEsPrestamo) {
			if (field.key === 'id_centro_costo_origen') return 'Prestamista';
			if (field.key === 'id_centro_costo_destino') return 'Prestatario';
		}
		if (formValues.tipo === 'egreso' && categoriaEsPrestamoOtorgado) {
			if (field.key === 'id_centro_costo_origen') return 'Prestamista';
			if (field.key === 'id_centro_costo_destino') return 'Prestatario';
		}
		if (formValues.tipo === 'ingreso' && formValues.tipo_alcance === 'externa') {
			// A pedido explícito del usuario: ya no es necesariamente un cliente (el campo ahora ofrece
			// TODOS los centros de costo, ver optionsFor), así que la etiqueta pasa a ser más genérica.
			if (field.key === 'id_centro_costo_origen') return 'Persona/Empresa';
			if (field.key === 'id_centro_costo_destino') return 'Proyecto';
		}
		return field.label;
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (bloqueadaPorAprobacion) {
			toast.error('No se puede modificar: el comprobante ya fue aprobado. Un administrador debe quitar la aprobación primero.');
			return;
		}
		revalidate();
		if (hasErrors) {
			toast.error('Revisa los campos marcados en rojo antes de guardar.');
			return;
		}

		// A pedido explícito del usuario: al CREAR una transacción Ingreso donde el Proyecto (Destino) es
		// Corporativo y la Categoría elegida es "Préstamo" (ver CATEGORIA_CORPORATIVO_INGRESO), la
		// transacción NO se crea acá — un préstamo se registra directo como Cuenta por Pagar, no como un
		// Ingreso. El botón (ver template, más abajo) ya cambia de "Crear" a "Cuentas por Pagar" para
		// este caso, pero este mismo chequeo va acá arriba de todo (antes de pedir comprobante o crear
		// nada) como respaldo — por si el formulario se llega a enviar de otra forma (ej. Enter en un
		// campo de texto) sin pasar por el clic del botón. Deja los datos ya conocidos (Centro de Costo
		// destino, Centro de Costo origen — el prestamista real, ver id_centro_costo_origen abajo —,
		// Monto, Fecha de Emisión) en sessionStorage para que finanzas/cuentas-pagar/+page.svelte los
		// recoja en su onMount y abra "Nueva Cuenta por Pagar" precargada (ver
		// abrirCreacionPrecargadaDesdeTransaccion ahí, y getOrCrearProveedorPrestamos para el proveedor
		// genérico con el que ese campo queda bloqueado). La transacción de Ingreso en sí (el dinero que
		// de verdad entra) recién se graba ahí, en el momento en que esa Cuenta por Pagar se guarda (ver
		// crearTransaccionPorPrestamoRecibido) — no acá, y no antes.
		if (esPrestamoCorporativoIngreso) {
			// A pedido explícito del usuario: "Fecha Emisión" de la Cuenta por Pagar arranca en la fecha
			// ACTUAL (día en que de verdad se está registrando), no en la Fecha (reconocida) de esta
			// transacción — esos dos pueden no coincidir (ej. un boucher escaneado con fecha vieja). El
			// usuario sigue pudiendo cambiarla a mano en el formulario de la Cuenta por Pagar.
			sessionStorage.setItem(
				'cuentaPagarPrefill',
				JSON.stringify({
					id_centro_costo: formValues.id_centro_costo_destino,
					id_centro_costo_origen: formValues.id_centro_costo_origen,
					monto_comprometido: formValues.monto_total,
					fecha_emision: getFechaLocalHoy(),
					observacion: 'Préstamo recibido'
				})
			);
			onClose();
			goto('/finanzas/cuentas-pagar?prefillCuentaPagar=1');
			return;
		}

		// Espejo del bloque anterior, para Egreso: al CREAR una transacción donde el Centro de Costo
		// Origen es Corporativo y la Categoría elegida es "Préstamo Otorgado" (ver
		// CATEGORIA_CORPORATIVO_EGRESO — valor DISTINTO del "Préstamo" genérico de Egreso, que sigue
		// siendo una categoría normal de gasto, ej. pagar una cuota de un préstamo ya existente, y no
		// dispara nada de esto), la transacción tampoco se crea acá — un préstamo OTORGADO se registra
		// como Cuenta por Cobrar (la empresa ahora tiene un derecho de cobro), y la transacción de Egreso
		// recién se graba al guardar esa Cuenta por Cobrar (ver crearTransaccionPorPrestamoOtorgado en
		// cuentas-cobrar/+page.svelte).
		if (esPrestamoOtorgadoEgreso) {
			// Chequeo de saldo del "Centro de costo origen" (quien presta) ANTES de redirigir — a pedido
			// explícito del usuario: sin esto, el usuario llenaba toda la Cuenta por Cobrar (cuotas,
			// fechas, etc.) para recién enterarse de un saldo insuficiente al guardar (ver
			// crearTransaccionPorPrestamoOtorgado en cuentas-cobrar/+page.svelte, que hace el chequeo
			// real/autoritativo vía fn_crear_transaccion bajo lock — este de acá es solo un aviso
			// temprano con los mismos números, no reemplaza a ese). Mismo helper que ya usa
			// updateTransaccion.
			const saldoCheck = await validarSaldoSuficiente(supabase, {
				tipo: 'egreso',
				monto_total: formValues.monto_total,
				id_centro_costo_origen: formValues.id_centro_costo_origen
			});
			if (!saldoCheck.ok) {
				toast.error(saldoCheck.message);
				return;
			}

			// "Proyecto" en Cuenta por Cobrar es una FK real a la tabla `proyecto` (no a `centro_costo`) —
			// no se puede meter ahí el id del prestatario (ver el pedido del usuario en
			// finanzas/cuentas-cobrar/+page.svelte). En su lugar, el nombre del prestatario real
			// (Centro de Costo Destino de ESTA transacción) va dentro de "Observaciones", para que quede
			// visible/guardado en la Cuenta por Cobrar sin violar esa relación.
			const nombreDestino = soloNombreCentro(centroCostoOptionsTodos).find((o) => o.value === formValues.id_centro_costo_destino)?.label;
			// A pedido explícito del usuario: "Fecha Emisión" de la Cuenta por Cobrar arranca en la fecha
			// ACTUAL (mismo criterio que crearTransaccionPorPrestamoRecibido más arriba), no en la Fecha
			// (reconocida) de esta transacción.
			sessionStorage.setItem(
				'cuentaCobrarPrefill',
				JSON.stringify({
					id_centro_costo: formValues.id_centro_costo_origen,
					id_centro_costo_destino: formValues.id_centro_costo_destino,
					monto: formValues.monto_total,
					fecha_emision: getFechaLocalHoy(),
					observaciones: nombreDestino ? `Préstamo otorgado a ${nombreDestino}` : 'Préstamo otorgado'
				})
			);
			onClose();
			goto('/finanzas/cuentas-cobrar?prefillCuentaCobrar=1');
			return;
		}

		// Una transacción Interna, y cualquier Externa+Ingreso/Egreso, emiten su propio comprobante
		// oficial solas, en vivo, sin ningún paso manual (ver reciboAutoHtml) — la firma es opcional (ver
		// botón "Firmar Comprobante") y nunca bloquea el guardado, así que en ninguno de esos casos se
		// requiere que el usuario adjunte además una foto/PDF de respaldo.
		const reciboAutogeneradoAplica = formValues.tipo_alcance === 'interna' || mostrarBotonReciboPago || mostrarBotonReciboPagoProveedor;
		if (!reciboAutogeneradoAplica && !comprobanteFile && !comprobanteUrl) {
			comprobanteError = 'Debes adjuntar el comprobante (imagen o PDF) de esta transacción.';
			toast.error(comprobanteError);
			return;
		}

		submitting = true;
		try {
			// El PDF de verdad (html2canvas/jsPDF) del comprobante autogenerado que aplique se arma acá,
			// justo antes de guardar/actualizar, y SIN la marca de agua "BORRADOR" (esa solo va en la vista
			// previa HTML, nunca en el archivo real). Devuelve null solo si ningún tipo de comprobante
			// autogenerado aplica a esta transacción.
			const reciboGeneradoFile = await generarComprobanteAutogenerado();

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

			// Comprobante autogenerado por el ERP — a pedido explícito del usuario, sube y se guarda en su
			// PROPIO campo (comprobanteAutogeneradoUrl), separado del comprobante que el usuario adjunta a
			// mano arriba (comprobanteFile/comprobanteUrl): antes reusaba ese mismo campo y le pisaba/
			// borraba el boucher que el usuario ya había subido.
			let finalComprobanteAutogeneradoUrl = comprobanteAutogeneradoUrl;
			let uploadedAutoFileId: string | null = null;
			if (reciboGeneradoFile) {
				uploadingComprobanteAutogenerado = true;
				try {
					const baseNameAuto =
						mode === 'edit' && transaccion
							? `comprobante-autogenerado-${transaccion.id_transaccion}`
							: `comprobante-autogenerado-temp-${Date.now()}`;
					const uploadedAuto = await subirArchivo(reciboGeneradoFile, baseNameAuto);
					finalComprobanteAutogeneradoUrl = uploadedAuto.url;
					uploadedAutoFileId = uploadedAuto.fileId;
					if (mode === 'edit' && transaccion?.comprobante_autogenerado_url) {
						const oldAutoFileId = extractDriveFileId(transaccion.comprobante_autogenerado_url);
						if (oldAutoFileId && oldAutoFileId !== uploadedAuto.fileId) await borrarArchivo(oldAutoFileId).catch(() => {});
					}
				} finally {
					uploadingComprobanteAutogenerado = false;
				}
			}

			// num_comprobante_interno: solo viaja si ya se resolvió el correlativo (ver comprobanteInternoNumero
			// y su $effect más arriba) — null si esta transacción nunca fue de Alcance Interna.
			const payload = {
				...formValues,
				comprobante_url: finalComprobanteUrl,
				comprobante_autogenerado_url: finalComprobanteAutogeneradoUrl,
				num_comprobante_interno: comprobanteInternoNumero,
				num_recibo_pago: numeroReciboPago,
				num_recibo_pago_no_efectivo: numeroReciboPagoNoEfectivo,
				num_recibo_pago_proveedor: numeroReciboPagoProveedor
			};

			let result;
			if (onConfirm) {
				result = await onConfirm(payload, idempotencyKey);
			} else if (mode === 'edit' && transaccion) {
				result = await updateTransaccion(supabase, transaccion.id_transaccion, payload, isAdmin());
			} else if (cuentaVinculadaSeleccionada && colaArchivos.length <= 1 && formValues.tipo === 'egreso') {
				const { data: userData } = await supabase.auth.getUser();
				result = await registrarPagoDesdeTransaccion(
					supabase,
					cuentaVinculadaSeleccionada.id,
					payload,
					userData?.user?.email ?? null,
					permisosState.userName || null,
					idempotencyKey
				);
			} else if (cuentaVinculadaSeleccionada && colaArchivos.length <= 1 && formValues.tipo === 'ingreso') {
				const { data: userData } = await supabase.auth.getUser();
				result = await registrarCobroDesdeTransaccion(
					supabase,
					cuentaVinculadaSeleccionada.id,
					payload,
					userData?.user?.email ?? null,
					permisosState.userName || null,
					idempotencyKey
				);
			} else {
				const { data: userData } = await supabase.auth.getUser();
				result = await createTransaccion(supabase, payload, userData?.user?.email ?? null, permisosState.userName || null, idempotencyKey);
			}

			if (result.success) {
				// Se guardó — la próxima llamada (siguiente ítem de la cola, o un guardado manual nuevo)
				// necesita su PROPIA idempotency key; un reintento tras un error, en cambio, reutiliza la
				// key de arriba sin pasar por acá (ver comentario en su declaración).
				idempotencyKey = crypto.randomUUID();

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
					if (uploadedAutoFileId && mode !== 'edit' && idNuevo) {
						await renombrarArchivo(uploadedAutoFileId, `comprobante-autogenerado-${idNuevo}${fileExt(reciboGeneradoFile!.name)}`);
					}
				} catch (housekeepingErr) {
					console.warn('[TransaccionModal] No se pudo renombrar/limpiar los archivos en Drive:', housekeepingErr);
				}
				comprobanteAutogeneradoUrl = finalComprobanteAutogeneradoUrl;

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

				// Comprobantes de pago (ver comprobantesPago más arriba) — se suben a Drive y se sincronizan
				// recién acá, ya con el id_transaccion real. Los que existían antes y el usuario quitó en
				// esta edición se borran de Drive aparte (no solo de la tabla de metadatos), para no dejar
				// archivos huérfanos. Mejor esfuerzo: si falla, no se revierte el guardado principal.
				try {
					const idParaComprobantes = (result.data as any)?.id_transaccion;
					if (idParaComprobantes) {
						uploadingComprobantesPago = true;
						const urlsActuales = new Set(comprobantesPago.map((f) => f.url).filter(Boolean));
						const quitados = comprobantesPagoOriginales.filter((f) => f.url && !urlsActuales.has(f.url));
						for (const fila of quitados) {
							const fileId = extractDriveFileId(fila.url);
							if (fileId) await borrarArchivo(fileId).catch(() => {});
						}

						const filasFinal: ComprobantePago[] = [];
						for (const fila of comprobantesPago) {
							if (fila.file) {
								const baseName = `comprobante-pago-${idParaComprobantes}-${Date.now()}-${fila._key}`;
								const uploaded = await subirArchivo(fila.file, baseName);
								filasFinal.push({
									tipo_documento: fila.tipo_documento,
									num_documento: fila.num_documento,
									monto: fila.monto,
									url: uploaded.url,
									nombre_archivo: fila.nombre_archivo
								});
							} else if (fila.url) {
								filasFinal.push({
									tipo_documento: fila.tipo_documento,
									num_documento: fila.num_documento,
									monto: fila.monto,
									url: fila.url,
									nombre_archivo: fila.nombre_archivo
								});
							}
						}
						await sincronizarComprobantesPago(supabase, idParaComprobantes, filasFinal);
					}
				} catch (comprobantesErr) {
					console.error('[TransaccionModal] No se pudo guardar los comprobantes de pago:', comprobantesErr);
					toast.error('No se pudieron guardar los comprobantes de la sección "Comprobantes" — revisa la consola (F12) para más detalle.');
				} finally {
					uploadingComprobantesPago = false;
				}

				// Cola de varios comprobantes: esta transacción ya quedó guardada de verdad, así que se
				// avanza al siguiente borrador en vez de cerrar el modal — a pedido del usuario.
				const hayMasEnCola = colaArchivos.length > 1 && colaIndex < colaArchivos.length - 1;
				if (hayMasEnCola) {
					toast.success(`Transacción ${colaIndex + 1} de ${colaArchivos.length} guardada.`);
					const { [colaIndex]: _omitido, ...restoDrafts } = colaDrafts;
					colaDrafts = restoDrafts;
					colaIndex += 1;
					comprobantesPago = [];
					comprobantesPagoOriginales = [];
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
	{@const esCuentaPropiaBancaria = (field.key === 'cuente_destino' && cuentaDestinoEsBancaria) || (field.key === 'cuente_origen' && cuentaOrigenEsBancaria)}
	{@const isBloqueadoPorMedioPago =
		(field.key === 'cuente_origen' || field.key === 'cuente_destino') && (medioPagoBloqueaAmbasCuentas || (medioPagoEsEfectivo && !esCuentaPropiaBancaria))}
	{@const isDisabled = bloqueadaPorAprobacion || isLocked || isBloqueadoInterna || isBloqueadoPorMedioPago}
	<div>
		<label for={`tr-${field.key}`} class="flex items-center gap-1 text-sm font-bold text-[#0f3b5e] mb-1">
			{labelFor(field)}
			{#if field.required}<span class="text-red-500">*</span>{/if}
			{#if isLocked || isBloqueadoInterna || isBloqueadoPorMedioPago}<Lock size={12} class="text-slate-400" />{/if}
		</label>

		{#if esCampoConSaldo(field)}
			{@const saldoElegido = saldoSeleccionado(field)}
			<SelectConSaldo
				id={`tr-${field.key}`}
				value={formValues[field.key]}
				options={optionsFor(field).map((opt) => ({ value: opt.value, label: opt.label, saldo: saldoParaOpcion(field, opt), grupo: grupoParaOpcion(field, opt), simbolo: simboloParaOpcion(field, opt) }))}
				disabled={isDisabled}
				hasError={!!fieldErrors[field.key]}
				onchange={(v) => {
					handleInput(field.key, v);
					saldosRevelados = { ...saldosRevelados, [field.key]: false };
				}}
			/>
			{#if saldoElegido !== undefined}
				<button
					type="button"
					onclick={() => (saldosRevelados = { ...saldosRevelados, [field.key]: !saldosRevelados[field.key] })}
					class={`mt-1 text-xs font-semibold text-left hover:underline w-fit ${saldoElegido >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
					title={saldosRevelados[field.key] ? 'Clic para ocultar el saldo' : 'Clic para ver el saldo'}
				>
					Saldo actual: {saldosRevelados[field.key] ? formatSaldoSeleccionado(field, saldoElegido) : '••••••••'}
				</button>
			{/if}
		{:else if field.tipo === 'select' || field.options}
			<div class="relative">
				<select
					id={`tr-${field.key}`}
					name={field.key}
					value={formValues[field.key]}
					disabled={isDisabled}
					onchange={(e) => handleInput(field.key, (e.target as HTMLSelectElement).value)}
					class={`w-full appearance-none rounded-lg border px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 disabled:opacity-60 disabled:bg-slate-50 ${fieldErrors[field.key] ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
				>
					<option value="" disabled>Selecciona una opción</option>
					{#each optionsFor(field) as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
				<ChevronDown size={16} class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
			</div>
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
		{:else if esCuentaPropiaBancaria && medioPagoEsEfectivo}
			<p class="mt-1 text-xs text-slate-400">Se elige entre las cuentas de Efectivo registradas (Finanzas → Cuentas Bancarias).</p>
		{:else if field.key === 'cuente_origen' && cuentaOrigenEsBancaria && (formValues.tipo === 'egreso' || bloqueadoPorInterna) && cuentasBancoIngresosOrigen.length > 0}
			<p class="mt-1 text-xs text-slate-400">Solo cuentas que recibieron algún Ingreso de este Centro de Costo Origen.</p>
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
				<div class="flex items-center gap-2">
					<button type="button" onclick={onClose} class="p-1 hover:bg-slate-100 rounded-full text-slate-500" aria-label="Cerrar">
						<X size={20} />
					</button>
				</div>
			</div>

			<form onsubmit={handleSubmit}>
				<div class="p-6 flex flex-col gap-5">
					{#if mode === 'edit' && transaccion}
						{#if transaccion.aprobado}
							<div class="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 flex items-center justify-between gap-3 flex-wrap">
								<span class="flex items-center gap-1.5">
									<ShieldCheck size={16} class="shrink-0" />
									Comprobante aprobado por {transaccion.aprobado_por ?? 'un administrador'} el {formatFecha(transaccion.aprobado_en)}.
									Esta transacción está bloqueada y no se puede editar mientras esté aprobada.
									{#if isAdmin()}Para editarla, quita la aprobación primero.{/if}
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
						<div class="flex items-center justify-between mb-4">
							<h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider">Datos de la Transacción</h3>
							<!-- N° de transacción — a pedido explícito del usuario, arriba del área de datos de la
							     transacción, solo lectura, visible en TODAS las circunstancias (Nueva y Editar). En
							     modo 'create' el id real todavía no existe (recién se genera al guardar, lo asigna
							     la BD) — mostrar un número "adivinado" de antemano sería engañoso (mismo motivo por
							     el que esta sesión evitó los intentos de numeración secuencial "preview" para los
							     recibos, ver getSiguienteNumeroReciboPago), así que se avisa que se asignará. -->
							{#if mode === 'edit' && transaccion}
								<span class="px-2 py-1 rounded-full bg-slate-100 text-slate-500 text-xs font-medium" title="Número de transacción">
									N° {transaccion.id_transaccion}
								</span>
							{:else}
								<span class="px-2 py-1 rounded-full bg-slate-100 text-slate-400 text-xs font-medium italic" title="El número se asigna automáticamente al guardar">
									N° se asignará al guardar
								</span>
							{/if}
						</div>
						<div class="flex flex-col md:flex-row gap-5">
							<!-- Tipo + Adjuntar boucher de pago — a pedido explícito del usuario: el campo Tipo
							     se muestra junto al comprobante, antes que el resto de los campos núcleo. -->
							<div class="md:w-56 shrink-0 flex flex-col gap-4">
								{@render fieldBlock(tipoField)}
								<!-- Categoría — a pedido explícito del usuario, se movió acá (antes vivía dentro de
								     "Otros campos", más abajo): ahora queda debajo de Tipo y arriba de "Adjuntar
								     boucher de pago". flex-col en vez de grid-cols-2 (a diferencia de su posición
								     anterior): esta columna es angosta (md:w-56 ≈ 224px), 2 selects lado a lado no
								     entrarían cómodos. -->
								{#if catalogoDetalleActual.length > 0}
									<!-- Categoría en cascada (a pedido explícito del usuario, vuelve a ser interactiva
									     acá — no solo de lectura): reusa el mismo estado de Grupo que la sección
									     Detalle (detalleCatalogoGrupoEfectivo/handleDetalleCatalogoGrupoChange), así
									     que elegir acá o en Detalle queda siempre sincronizado. Elegir acá SOLO fija
									     la Categoría (no agrega una fila a Detalle, a diferencia de elegir allá, ver
									     agregarFilaDesdeCatalogo). -->
									<div>
										<label for="tr-categoria-otros-grupo" class="flex items-center gap-1 text-sm font-bold text-[#0f3b5e] mb-1">
											Categoría<span class="text-red-500">*</span>
										</label>
										<div class="flex flex-col gap-2">
											<div class="relative">
												<select
													id="tr-categoria-otros-grupo"
													value={detalleCatalogoGrupoEfectivo}
													disabled={bloqueadaPorAprobacion}
													onchange={(e) => handleDetalleCatalogoGrupoChange((e.target as HTMLSelectElement).value)}
													class="w-full appearance-none rounded-lg border border-slate-300 px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60 disabled:bg-slate-50"
												>
													<option value="">Categoría</option>
													{#each catalogoDetalleActual as grupo}
														<option value={grupo.key}>{grupo.label}</option>
													{/each}
												</select>
												<ChevronDown size={16} class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
											</div>
											<div class="relative">
												<!-- Especialidad de Operario/Oficial/Ayudante (ver SUBOPCIONES_SUBCONTRATA) —
												     a pedido explícito del usuario, presentada en el MISMO dropdown vía
												     <optgroup> nativo (más simple que un 3er selector aparte): el rol se ve
												     como encabezado de grupo y sus especialidades debajo, un solo clic para
												     elegir. -->
												<select
													id="tr-categoria-otros-subcategoria"
													value={formValues.categoria}
													disabled={bloqueadaPorAprobacion || !detalleCatalogoGrupoEfectivo}
													onchange={(e) => handleInput('categoria', (e.target as HTMLSelectElement).value)}
													class={`w-full appearance-none rounded-lg border px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 disabled:opacity-60 disabled:bg-slate-50 ${fieldErrors.categoria ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
												>
													<option value="">Subcategoría</option>
													{#each catalogoDetalleActual.find((g) => g.key === detalleCatalogoGrupoEfectivo)?.opciones ?? [] as opt}
														{#if SUBOPCIONES_SUBCONTRATA[opt]}
															<optgroup label={opt}>
																{#each SUBOPCIONES_SUBCONTRATA[opt] as sub}
																	<option value={sub}>{sub}</option>
																{/each}
															</optgroup>
														{:else}
															<option value={opt}>{opt}</option>
														{/if}
													{/each}
												</select>
												<ChevronDown size={16} class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
											</div>
										</div>
										{#if fieldErrors.categoria}<p class="mt-1 text-xs text-red-500">{fieldErrors.categoria}</p>{/if}
									</div>
								{:else}
									{@render fieldBlock(categoriaField)}
								{/if}
								<div class="flex flex-col flex-1">
								<label class="block text-sm font-bold text-[#0f3b5e] mb-1">
									Adjuntar boucher de pago
									{#if formValues.tipo_alcance !== 'interna' && !mostrarBotonReciboPago && !mostrarBotonReciboPagoProveedor}<span class="text-red-500">*</span>{/if}
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
									{:else if formValues.tipo_alcance === 'interna' || mostrarBotonReciboPago || mostrarBotonReciboPagoProveedor}
										<p class="text-xs text-slate-400">Opcional: esta transacción ya emite su propio comprobante (ver botón abajo).</p>
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
											<div class="relative">
												<select
													id="tr-clase-destino"
													value={claseDestino}
													disabled={bloqueadaPorAprobacion}
													onchange={(e) => handleClaseDestinoChange((e.target as HTMLSelectElement).value)}
													class="w-full appearance-none rounded-lg border border-slate-300 px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60 disabled:bg-slate-50"
												>
													<option value="" disabled>Selecciona una opción</option>
													{#each OPCIONES_CLASE_DESTINO as opt}
														<option value={opt.value}>{opt.label}</option>
													{/each}
												</select>
												<ChevronDown size={16} class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
											</div>
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
											<p class="mt-1 text-xs text-slate-500">{formatMontoTotal(formValues.monto_total)}</p>
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

								<!-- Tipo de Moneda/Tipo de Cambio/Monto Convertido — a pedido explicito del
								     usuario: "Tipo de Moneda" siempre visible (Soles por defecto); "Tipo de
								     Cambio" y "Monto Convertido" (calculado solo, ver el $effect mas arriba)
								     SOLO aparecen si se elige Dolares. -->
								<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
									<div>
										<label for="tr-tipo-moneda" class="text-sm font-bold text-[#0f3b5e] mb-1 block">Tipo de Moneda</label>
										<div class="relative">
											<select
												id="tr-tipo-moneda"
												value={formValues.tipo_moneda}
												disabled={bloqueadaPorAprobacion}
												onchange={(e) => handleInput('tipo_moneda', (e.target as HTMLSelectElement).value)}
												class="w-full appearance-none rounded-lg border border-slate-300 px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60 disabled:bg-slate-50"
											>
												<option value="soles">Soles</option>
												<option value="dolares">Dólares</option>
											</select>
											<ChevronDown size={16} class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
										</div>
									</div>
									{#if formValues.tipo_moneda === 'dolares'}
										<div>
											<label for="tr-tipo-cambio" class="text-sm font-bold text-[#0f3b5e] mb-1 block">
												Tipo de Cambio<span class="text-red-500">*</span>
											</label>
											<input
												id="tr-tipo-cambio"
												type="text"
												inputmode="decimal"
												value={formValues.tipo_cambio}
												disabled={bloqueadaPorAprobacion}
												oninput={(e) => handleInput('tipo_cambio', (e.target as HTMLInputElement).value)}
												placeholder="3.75"
												class={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:opacity-60 disabled:bg-slate-50 ${fieldErrors.tipo_cambio ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
											/>
											{#if fieldErrors.tipo_cambio}
												<p class="mt-1 text-xs text-red-600">{fieldErrors.tipo_cambio}</p>
											{:else}
												<p class="mt-1 text-xs text-slate-400">Tipo de cambio del día (S/ por US$).</p>
											{/if}
										</div>
										<div>
											<label for="tr-monto-convertido" class="text-sm font-bold text-[#0f3b5e] mb-1 block">Monto Convertido</label>
											<!-- A pedido explícito del usuario: siempre con el símbolo de Soles ('S/.') — este campo es
											     justamente el equivalente en Soles del Monto (reconocido) en Dólares, sin importar nada más. -->
											<div class="relative">
												<span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 pointer-events-none">S/.</span>
												<input
													id="tr-monto-convertido"
													type="text"
													value={formValues.monto_convertido}
													disabled
													class="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm bg-slate-100 text-slate-600 disabled:cursor-not-allowed"
												/>
											</div>
											<p class="mt-1 text-xs text-slate-400">Se calcula solo: Monto (reconocido) × Tipo de Cambio.</p>
										</div>
									{/if}
								</div>
							</div>
						</div>
					</div>

					<!-- Comprobante autogenerado por el ERP — a pedido explícito del usuario: el recibo que
					     emite el propio sistema (Boucher de Transferencia Interna / Recibo por Pago / Recibo a
					     Proveedor) NO es lo mismo que "Adjuntar boucher de pago" (comprobante externo que sube
					     el usuario a mano) ni "Comprobantes de pago" (documentos de terceros, más abajo) — por
					     eso tiene su propia sección, separada de ambas. Siempre se autogenera solo, para
					     cualquier medio de pago — Concepto y los datos del cliente/proveedor son campos
					     editables acá mismo (se prellenan solos), y la firma es opcional vía "Firmar
					     Comprobante", nunca bloquea el guardado. -->
					{#if formValues.tipo_alcance === 'interna' || mostrarBotonReciboPago || mostrarBotonReciboPagoProveedor}
						<div class="rounded-2xl border border-slate-200 p-5">
							<span class="block text-sm font-bold text-[#0f3b5e] mb-4">Comprobante autogenerado por el ERP</span>
							<p class="text-xs text-slate-500 mb-4">
								Este comprobante lo emite el propio sistema — no hace falta adjuntarlo a mano en "Adjuntar
								boucher de pago" ni en "Comprobantes de pago". Se actualiza en tiempo real con el formulario.
							</p>

							{#if mostrarBotonReciboPago || mostrarBotonReciboPagoProveedor}
								<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
									<div class="sm:col-span-2">
										<label class="block text-xs font-semibold text-slate-600 mb-1" for="cr-concepto">Concepto</label>
										<textarea
											id="cr-concepto"
											rows="2"
											value={conceptoRecibo}
											oninput={onConceptoReciboInput}
											disabled={bloqueadaPorAprobacion}
											placeholder="Descripción del pago..."
											class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm resize-none disabled:opacity-60"
										></textarea>
									</div>
									{#if mostrarBotonReciboPago}
										<div>
											<label class="block text-xs font-semibold text-slate-600 mb-1" for="cr-cliente-nombre">Nombre del cliente</label>
											<input
												id="cr-cliente-nombre"
												type="text"
												bind:value={clienteReciboNombre}
												disabled={bloqueadaPorAprobacion}
												placeholder="Nombre completo"
												class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
											/>
										</div>
										<div>
											<label class="block text-xs font-semibold text-slate-600 mb-1" for="cr-cliente-dni">RUC / DNI del cliente</label>
											<input
												id="cr-cliente-dni"
												type="text"
												bind:value={clienteReciboDni}
												disabled={bloqueadaPorAprobacion}
												placeholder="RUC o DNI"
												class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
											/>
										</div>
									{:else if mostrarBotonReciboPagoProveedor}
										<div>
											<label class="block text-xs font-semibold text-slate-600 mb-1" for="cr-proveedor-nombre">Razón social del proveedor</label>
											<input
												id="cr-proveedor-nombre"
												type="text"
												bind:value={proveedorReciboNombre}
												disabled={bloqueadaPorAprobacion}
												placeholder="Razón social"
												class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
											/>
										</div>
										<div>
											<label class="block text-xs font-semibold text-slate-600 mb-1" for="cr-proveedor-ruc">RUC del proveedor</label>
											<input
												id="cr-proveedor-ruc"
												type="text"
												bind:value={proveedorReciboRuc}
												disabled={bloqueadaPorAprobacion}
												placeholder="RUC"
												class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
											/>
										</div>
									{/if}
								</div>
							{/if}

							<div class="flex flex-col sm:flex-row gap-5">
								<div class="flex-1 flex flex-col gap-2 min-w-0">
									{#if mostrarBotonReciboPago}
										<button
											type="button"
											onclick={abrirFirmaReciboPago}
											disabled={bloqueadaPorAprobacion}
											class="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-blue-300 text-blue-600 text-xs font-semibold hover:bg-blue-50 disabled:opacity-50 w-fit"
										>
											<Pencil size={14} class="shrink-0" />
											{firmaClienteDataUrl && firmaReceptorDataUrl ? 'Firmado — Volver a firmar' : 'Firmar Comprobante'}
										</button>
									{:else if mostrarBotonReciboPagoProveedor}
										<button
											type="button"
											onclick={abrirFirmaReciboPagoProveedor}
											disabled={bloqueadaPorAprobacion}
											class="flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-blue-300 text-blue-600 text-xs font-semibold hover:bg-blue-50 disabled:opacity-50 w-fit"
										>
											<Pencil size={14} class="shrink-0" />
											{firmaEntregoDataUrl && firmaRecibioDataUrl ? 'Firmado — Volver a firmar' : 'Firmar Comprobante'}
										</button>
									{/if}
									{#if reciboAutoHtml}
										<button type="button" onclick={() => abrirPreviewHtml(reciboAutoHtml!)} class="text-xs text-blue-600 hover:underline text-left w-fit">
											Vista previa
										</button>
										<p class="text-xs text-slate-400">Se actualiza en tiempo real con el formulario — se adjuntará automáticamente al guardar.</p>
									{/if}
								</div>
								{#if reciboAutoHtml}
									<!-- Todavía no es un PDF real (eso recién ocurre al guardar, ver
									     generarComprobanteAutogenerado) — se previsualiza el HTML tal cual en un iframe
									     en miniatura, sin pagar el costo de html2canvas antes de tiempo. Alto del iframe
									     generoso (3000px) para que su PROPIO scroll interno nunca recorte el contenido
									     antes de medirlo — el recuadro visible (w-48 h-64) recorta con overflow-hidden,
									     pero previewEscala (ver ajustarEscalaPreview) se recalcula para que las 2 copias
									     completas siempre entren ahí, nunca se ven cortadas. -->
									<div bind:this={previewWrapperEl} class="relative w-full sm:w-48 h-64 shrink-0 rounded-xl border border-slate-200 overflow-hidden bg-white">
										<iframe
											bind:this={previewIframeEl}
											title="Vista previa del recibo"
											srcdoc={reciboAutoHtml}
											onload={ajustarEscalaPreview}
											class="absolute top-0 left-0 border-0 pointer-events-none bg-white"
											style={`width:780px; height:3000px; transform: scale(${previewEscala}); transform-origin: top left;`}
										></iframe>
									</div>
								{/if}
							</div>
						</div>
					{/if}

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
													disabled={!idCentroCostoParaVinculo}
													placeholder={idCentroCostoParaVinculo ? 'Buscar proveedor/cliente, N° doc. o ID…' : `Elige primero el Centro de costo ${formValues.tipo === 'egreso' ? 'origen' : 'destino'}`}
													autocomplete="off"
													class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60 disabled:bg-slate-50"
												/>
												{#if cuentaVinculadaAbierta && idCentroCostoParaVinculo}
													<div class="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
														{#if cuentaVinculadaBuscando}
															<p class="px-3 py-2 text-xs text-slate-400 flex items-center gap-1.5">
																<Loader2 size={12} class="animate-spin" /> Buscando…
															</p>
														{:else if cuentaVinculadaResultados.length === 0}
															<p class="px-3 py-2 text-xs text-slate-400">Sin cuentas con saldo pendiente en ese centro de costo.</p>
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
												<!-- A pedido explícito del usuario: si el centro de costo elegido YA tiene cuenta(s)
												     con saldo pendiente (ver el $effect junto a ejecutarBusquedaCuentaVinculada, que
												     las precarga apenas hay un centro de costo válido), debe notarse SIN que el
												     usuario tenga que hacer clic para abrir el desplegable — antes esta pista era el
												     mismo texto genérico sin importar si había algo encontrado o no. -->
												<p class={`mt-1 text-xs ${idCentroCostoParaVinculo && !cuentaVinculadaBuscando && cuentaVinculadaResultados.length > 0 ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>
													{#if !idCentroCostoParaVinculo}
														Solo se muestran cuentas del centro de costo {formValues.tipo === 'egreso' ? 'origen' : 'destino'} elegido arriba.
													{:else if cuentaVinculadaBuscando}
														Buscando cuentas de este centro de costo…
													{:else if cuentaVinculadaResultados.length > 0}
														✓ {cuentaVinculadaResultados.length} cuenta{cuentaVinculadaResultados.length === 1 ? '' : 's'} con saldo pendiente encontrada{cuentaVinculadaResultados.length === 1 ? '' : 's'} — haz clic para elegirla.
													{:else}
														Opcional — registra un pago/cobro real contra esa cuenta.
													{/if}
												</p>
											{/if}
										</div>
									{/if}
								</div>
								<!-- Para Consultoría + Egreso, el desglose "Tipo de Gasto" (7 dropdowns) fue
								     REEMPLAZADO por Categoría en cascada (ver el bloque de Categoría más arriba,
								     categoriaConsultoriaGrupo/TIPOS_GASTO_CONSULTORIA) a pedido explícito del
								     usuario — evita capturar el mismo dato dos veces. TIPOS_GASTO_CONSULTORIA se
								     sigue usando como fuente de datos de esa cascada. -->

								<!-- Para Obra + Egreso, el desglose "Tipo de Gasto" (7 dropdowns) fue REEMPLAZADO por
								     Categoría en cascada (ver el bloque de Categoría más arriba, categoriaObraGrupo/
								     TIPOS_GASTO_OBRA) a pedido explícito del usuario — evita capturar el mismo dato
								     dos veces. TIPOS_GASTO_OBRA se sigue usando como fuente de datos de esa cascada. -->

								<!-- Para Corporativo + Egreso, el desglose "Tipo de Gasto" (8 dropdowns) fue
								     REEMPLAZADO por Categoría en cascada (ver el bloque de Categoría más arriba,
								     categoriaCorpGrupo/TIPOS_GASTO_CORPORATIVO) a pedido explícito del usuario —
								     evita capturar el mismo dato dos veces. TIPOS_GASTO_CORPORATIVO se sigue usando
								     como fuente de datos de esa cascada. -->

								<!-- A pedido explícito del usuario: "Adjuntar factura o boleta de venta" se retiró por
								     completo de acá — ese adjunto (y ahora varios, cada uno con su propio Tipo/N° de
								     Documento/Monto) vive en la 4ta sección "Comprobantes", más abajo. Descripción/
								     Estado quedan en 2 columnas (ya no 3, para no dejar un hueco vacío). -->
								<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

								<p class="mt-3 text-xs text-slate-400 flex items-center gap-1.5">
									<Info size={12} class="shrink-0" />
									Estos campos son opcionales. Otra área de la empresa se encargará de completarlos.
								</p>
							</div>
						{/if}
					</div>
				</div>

				<!-- Detalle — tercera sección plegable (a pedido explícito del usuario, mismo patrón visual
				     que "Otros campos"), visible en cuanto hay una Categoría elegida O ya hay un catálogo
				     disponible para elegirla (Obra/Consultoría/Corporativo + Egreso, ver
				     catalogoDetalleActual) — SIN el "o catalogoDetalleActual" quedaba en punto muerto: para
				     esos casos Categoría YA NO se elige en "Otros campos" (ver más arriba, ahora es de solo
				     lectura), así que Detalle nunca llegaba a mostrarse para elegirla la primera vez.
				     EXCEPTO cuando el tipo de transacción es Ingreso — a pedido explícito del usuario,
				     bloqueada (oculta) por completo en Ingreso, sea cual sea el tipo de proyecto (antes
				     solo se excluía Obra+Ingreso). TAMBIÉN excluida en Egreso+Categoría="Préstamo"
				     (categoriaEsPrestamoOtorgado) — a pedido explícito del usuario: esa transacción ni
				     siquiera se crea acá (se redirige a Cuentas por Cobrar, ver handleSubmit), así que un
				     detalle de línea por línea no tiene sentido ahí. Ver detalleCategoria/
				     agregarFilaDetalleCategoria más arriba. -->
				{#if (formValues.categoria || catalogoDetalleActual.length > 0) && formValues.tipo !== 'ingreso' && !categoriaEsPrestamoOtorgado}
					<div class="rounded-2xl border border-slate-200 p-5">
						<div class="flex items-center justify-between flex-wrap gap-2">
							<button
								type="button"
								onclick={() => (detalleCategoriaAbierto = !detalleCategoriaAbierto)}
								class="flex items-center gap-1.5 text-sm font-bold text-blue-600"
							>
								<ListTree size={16} class="text-blue-500" />
								Detalle
								{#if detalleCategoriaAbierto}<ChevronUp size={16} />{:else}<ChevronDown size={16} />{/if}
							</button>
							<span class="text-xs text-slate-400">Categoría seleccionada: {formValues.categoria ? getOptionLabel(categoriaField, formValues.categoria) : 'Sin elegir'}</span>
						</div>

						{#if detalleCategoriaAbierto}
							<div class="mt-4 flex flex-col gap-4">
								<!-- Categoría/Subcategoría (a pedido explícito del usuario, antes "Catálogo"/
								     "Subcatálogo"): elegir Categoría→Subcategoría agrega la fila directo Y fija la
								     Categoría de la transacción (ver agregarFilaDesdeCatalogo) — ya no se escribe la
								     Subcategoría a mano, salvo que este tipo de proyecto no tenga catálogo propio
								     (catalogoDetalleActual vacío), donde se mantiene "Agregar subcategoría" (fila en
								     blanco) como única alternativa. -->
								{#if catalogoDetalleActual.length > 0}
									<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
										<div>
											<label for="tr-detalle-catalogo" class="block text-sm font-bold text-[#0f3b5e] mb-1">Categoría</label>
											<div class="relative">
												<select
													id="tr-detalle-catalogo"
													value={detalleCatalogoGrupoEfectivo}
													disabled={bloqueadaPorAprobacion}
													onchange={(e) => handleDetalleCatalogoGrupoChange((e.target as HTMLSelectElement).value)}
													class="w-full appearance-none rounded-lg border border-slate-300 px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60 disabled:bg-slate-50"
												>
													<option value="">Selecciona una opción</option>
													{#each catalogoDetalleActual as grupo}
														<option value={grupo.key}>{grupo.label}</option>
													{/each}
												</select>
												<ChevronDown size={16} class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
											</div>
										</div>
										<div>
											<label for="tr-detalle-subcatalogo" class="block text-sm font-bold text-[#0f3b5e] mb-1">Subcategoría</label>
											<div class="relative">
												<!-- Especialidad de Operario/Oficial/Ayudante (ver SUBOPCIONES_SUBCONTRATA) —
												     agrupada en el MISMO dropdown vía <optgroup> nativo (más simple que un 3er
												     selector aparte): elegir una especialidad agrega la fila directo, igual que
												     cualquier otra opción de esta lista. -->
												<select
													id="tr-detalle-subcatalogo"
													value=""
													disabled={bloqueadaPorAprobacion || !detalleCatalogoGrupoEfectivo}
													onchange={(e) => {
														const target = e.target as HTMLSelectElement;
														agregarFilaDesdeCatalogo(target.value);
														target.value = '';
													}}
													class="w-full appearance-none rounded-lg border border-slate-300 px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60 disabled:bg-slate-50"
												>
													<option value="">Elige una opción para agregarla</option>
													{#each catalogoDetalleActual.find((g) => g.key === detalleCatalogoGrupoEfectivo)?.opciones ?? [] as opt}
														{#if SUBOPCIONES_SUBCONTRATA[opt]}
															<optgroup label={opt}>
																{#each SUBOPCIONES_SUBCONTRATA[opt] as sub}
																	<option value={sub}>{sub}</option>
																{/each}
															</optgroup>
														{:else}
															<option value={opt}>{opt}</option>
														{/if}
													{/each}
												</select>
												<ChevronDown size={16} class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
											</div>
										</div>
									</div>
								{:else}
									<button
										type="button"
										onclick={agregarFilaDetalleCategoria}
										disabled={bloqueadaPorAprobacion}
										class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-300 text-blue-600 text-xs font-semibold hover:bg-blue-50 disabled:opacity-50 w-fit"
									>
										<Plus size={13} /> Agregar subcategoría
									</button>
								{/if}

						{#if detalleCategoria.length === 0}
							<p class="text-xs text-slate-400 text-center py-4">
								{catalogoDetalleActual.length > 0 ? 'Sin subcategorías todavía — elige una del Catálogo.' : 'Sin subcategorías todavía — usa "Agregar subcategoría".'}
							</p>
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
										{#each detallePagina as fila (fila._key)}
											<tr class="border-t border-slate-100">
												<td class="px-2 py-1.5">
													<!-- Solo lectura — a pedido explícito del usuario: la Subcategoría ya quedó fijada
													     al agregar la fila (Categoría→Subcategoría, o "Agregar subcategoría" a mano, ver
													     agregarFilaDetalleCategoria más arriba); dejarla como texto libre editable acá
													     permitía escribir cualquier cosa después, desconectado del catálogo elegido. -->
													<p
														class="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm text-slate-700 truncate"
														title={fila.subcategoria}
													>
														{fila.subcategoria || '—'}
													</p>
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
													<div class="relative">
														<select
															bind:value={fila.unidad}
															disabled={bloqueadaPorAprobacion}
															class="w-full appearance-none rounded-md border border-slate-200 px-2 py-1 pr-6 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
														>
															{#each UNIDADES_DETALLE as u}
																<option value={u}>{u}</option>
															{/each}
														</select>
														<ChevronDown size={13} class="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400" />
													</div>
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
							{#if detalleTotalPages > 1}
								<div class="flex items-center justify-between mt-2 text-xs text-slate-500">
									<span>
										Mostrando {(detallePaginaActual - 1) * DETALLE_PAGE_SIZE + 1} a {Math.min(detallePaginaActual * DETALLE_PAGE_SIZE, detalleCategoria.length)} de {detalleCategoria.length} filas
									</span>
									<div class="flex items-center gap-1">
										<button
											type="button"
											onclick={() => irAPaginaDetalle(detallePaginaActual - 1)}
											disabled={detallePaginaActual <= 1}
											class="px-2 py-1 rounded-md border border-slate-300 disabled:opacity-40 hover:bg-slate-50"
										>
											Anterior
										</button>
										<span class="px-1">Página {detallePaginaActual} de {detalleTotalPages}</span>
										<button
											type="button"
											onclick={() => irAPaginaDetalle(detallePaginaActual + 1)}
											disabled={detallePaginaActual >= detalleTotalPages}
											class="px-2 py-1 rounded-md border border-slate-300 disabled:opacity-40 hover:bg-slate-50"
										>
											Siguiente
										</button>
									</div>
								</div>
							{/if}
						{/if}
							</div>
						{/if}
					</div>
				{/if}

				<!-- Comprobantes — cuarta sección, a pedido explícito del usuario: reemplaza el antiguo campo
				     único "Adjuntar factura o boleta de venta". Egreso = comprobantes de pago; Ingreso =
				     comprobantes de recepción de dinero de Construni — mismo mecanismo, distinto rótulo (ver
				     comprobantesPago/agregarComprobantesPago más arriba). -->
				<div class="rounded-2xl border border-slate-200 p-5">
					<span class="block text-sm font-bold text-[#0f3b5e] mb-4">
						{formValues.tipo === 'ingreso' ? 'Comprobantes de recepción de dinero de Construni' : 'Comprobantes de pago'}
					</span>

					{#if comprobantesPago.length > 0}
						<div class="overflow-x-auto mb-4">
							<table class="w-full text-sm min-w-[640px]">
								<thead>
									<tr class="text-[11px] text-slate-500 uppercase tracking-wide">
										<th class="text-left px-2 py-1.5 font-semibold">Documento adjunto</th>
										<th class="text-left px-2 py-1.5 font-semibold w-40">Tipo de documento</th>
										<th class="text-left px-2 py-1.5 font-semibold w-40">N° de documento</th>
										<th class="text-right px-2 py-1.5 font-semibold w-40">Monto que figura en el documento</th>
										<th class="w-8"></th>
									</tr>
								</thead>
								<tbody>
									{#each comprobantesPago as fila (fila._key)}
										<tr class="border-t border-slate-100">
											<td class="px-2 py-1.5">
												<button
													type="button"
													onclick={() => (previewComprobantePago = fila)}
													class="flex items-center gap-2 text-left hover:underline min-w-0"
													title="Ver comprobante"
												>
													{#if fila.ocrCargando}
														<Loader2 size={16} class="shrink-0 animate-spin text-slate-400" />
													{:else}
														<FileText size={16} class="shrink-0 text-blue-400" />
													{/if}
													<span class="truncate text-blue-600">{fila.nombre_archivo}</span>
												</button>
												{#if fila.ocrCargando}
													<span class="text-[10px] text-slate-400">Leyendo datos…</span>
												{/if}
											</td>
											<td class="px-2 py-1.5">
												<div class="relative">
													<select
														value={fila.tipo_documento ?? ''}
														disabled={bloqueadaPorAprobacion}
														onchange={(e) => (fila.tipo_documento = (e.target as HTMLSelectElement).value)}
														class="w-full appearance-none rounded-md border border-slate-200 px-2 py-1 pr-6 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
													>
														<option value="">Selecciona</option>
														{#each optionsFor(tipoDocumentoField) as opt}
															<option value={opt.value}>{opt.label}</option>
														{/each}
													</select>
													<ChevronDown size={13} class="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400" />
												</div>
											</td>
											<td class="px-2 py-1.5">
												<input
													type="text"
													value={fila.num_documento ?? ''}
													disabled={bloqueadaPorAprobacion}
													oninput={(e) => (fila.num_documento = (e.target as HTMLInputElement).value)}
													placeholder="N° de documento"
													class="w-full rounded-md border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
												/>
											</td>
											<td class="px-2 py-1.5">
												<input
													type="number"
													min="0"
													step="any"
													value={fila.monto ?? ''}
													disabled={bloqueadaPorAprobacion}
													oninput={(e) => (fila.monto = (e.target as HTMLInputElement).value === '' ? null : Number((e.target as HTMLInputElement).value))}
													placeholder="0.00"
													class="w-full rounded-md border border-slate-200 px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
												/>
											</td>
											<td class="px-2 py-1.5 text-center">
												<div class="flex items-center justify-center gap-1">
													{#if fila.url}
														<button
															type="button"
															onclick={() => releerComprobantePago(fila)}
															disabled={bloqueadaPorAprobacion || fila.ocrCargando}
															class="p-1 rounded text-slate-400 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-40"
															aria-label="Volver a leer este comprobante"
															title="Volver a leer este comprobante"
														>
															<RefreshCw size={14} class={fila.ocrCargando ? 'animate-spin' : ''} />
														</button>
													{/if}
													<button
														type="button"
														onclick={() => eliminarComprobantePago(fila._key)}
														disabled={bloqueadaPorAprobacion}
														class="p-1 rounded text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
														aria-label="Quitar comprobante"
														title="Quitar comprobante"
													>
														<Trash2 size={14} />
													</button>
												</div>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}

					<label
						for="tr-comprobantes-pago"
						ondragover={(e) => e.preventDefault()}
						ondrop={onComprobantesPagoDrop}
						class={`flex flex-col items-center justify-center gap-1 w-full h-20 rounded-xl border-2 border-dashed border-slate-300 text-center transition-colors ${bloqueadaPorAprobacion ? 'opacity-60 cursor-not-allowed bg-slate-50' : 'cursor-pointer hover:bg-slate-50'}`}
					>
						<CloudUpload size={20} class="text-blue-400" />
						<span class="text-xs font-medium text-slate-600">Arrastra o selecciona</span>
						<span class="text-[11px] text-slate-400">JPG, PNG o PDF (máx. 5MB c/u) — puedes elegir varios</span>
					</label>
					<input
						id="tr-comprobantes-pago"
						type="file"
						accept="image/*,application/pdf"
						multiple
						class="hidden"
						disabled={bloqueadaPorAprobacion}
						onchange={onComprobantesPagoChange}
					/>

					<p class="mt-3 text-xs text-slate-400 flex items-center gap-1.5">
						<Info size={12} class="shrink-0" />
						Estos campos son opcionales. Otra área de la empresa se encargará de completarlos.
					</p>
				</div>

				<!-- Pie "Transacción registrada por" — a pedido explícito del usuario, con imagen de
				     referencia. Solo aplica en Editar: en Nueva Transacción `usuario_registro`/`created_at`
				     todavía no existen (recién los asigna la BD al guardar). Contenido normal del formulario
				     (no sticky, a diferencia de los botones de abajo) — pertenece a la ventana, no queda
				     flotando pegado aparte. -->
				{#if mode === 'edit' && transaccion}
					<div class="flex items-center gap-3 px-6 py-3 bg-blue-50 border-t border-blue-100">
						<div class="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
							<User size={16} />
						</div>
						<div class="text-xs leading-snug">
							<p class="font-semibold text-slate-700">Transacción registrada por</p>
							<p class="text-slate-500">
								Usuario: {transaccion.usuario_registro ?? '—'}
								<span class="mx-1.5 text-slate-300">|</span>
								Fecha y hora: {formatFechaHora(transaccion.created_at)}
							</p>
						</div>
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
								{uploadingComprobante || uploadingComprobantesPago ? 'Subiendo archivos…' : 'Guardando…'}
							{:else if colaArchivos.length > 1 && colaIndex < colaArchivos.length - 1}
								Guardar y continuar
							{:else if esPrestamoCorporativoIngreso}
								Cuentas por Pagar
							{:else if esPrestamoOtorgadoEgreso}
								Cuentas por Cobrar
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
	documents={comprobanteUrl ? [{ url: comprobanteUrl, label: 'Comprobante', filename: nombreDescargaBoucher() }] : []}
	onClose={() => (showComprobantePreview = false)}
/>

<DocumentPreviewModal
	open={!!previewComprobantePago}
	url={previewComprobantePagoDocs[0]?.url ?? null}
	title={previewComprobantePago?.nombre_archivo ?? 'Comprobante'}
	documents={previewComprobantePagoDocs}
	onClose={() => (previewComprobantePago = null)}
/>

<ReciboPagoModal
	open={reciboPagoModalOpen}
	clienteNombre={clienteReciboNombre}
	receptorDniInicial={receptorDniFirma}
	firmaClienteInicial={firmaClienteDataUrl}
	firmaReceptorInicial={firmaReceptorDataUrl}
	onCancel={() => (reciboPagoModalOpen = false)}
	onGenerar={handleFirmarReciboPago}
/>

<ReciboPagoProveedorModal
	open={reciboPagoProveedorModalOpen}
	proveedorNombre={proveedorReciboNombre}
	entregoDniInicial={entregoDniFirma}
	firmaEntregoInicial={firmaEntregoDataUrl}
	firmaRecibioInicial={firmaRecibioDataUrl}
	onCancel={() => (reciboPagoProveedorModalOpen = false)}
	onGenerar={handleFirmarReciboPagoProveedor}
/>

<!-- Vista previa a tamaño completo del recibo autogenerado por el ERP (ver abrirPreviewHtml más
     arriba) — a pedido explícito del usuario, dentro del sistema (mismo srcdoc que la miniatura de
     "Otros campos", solo más grande), no una pestaña nueva del navegador. -->
{#if previewHtmlModalOpen && reciboAutoHtml}
	<div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl h-[90vh] flex flex-col overflow-hidden">
			<div class="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
				<h2 class="text-lg font-semibold text-slate-800">Vista previa del recibo</h2>
				<button
					type="button"
					onclick={() => (previewHtmlModalOpen = false)}
					class="text-slate-400 hover:text-slate-600 transition-colors w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded-lg"
					aria-label="Cerrar"
				>
					<X size={20} />
				</button>
			</div>
			<div class="flex-1 overflow-auto bg-slate-100">
				<iframe title="Vista previa del recibo" srcdoc={reciboAutoHtml} class="w-full h-full border-0 bg-white"></iframe>
			</div>
		</div>
	</div>
{/if}

