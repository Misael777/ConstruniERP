<script lang="ts">
	// Nueva/Editar Factura (borrador) — en el formato real de Construni. Flujo (a pedido explícito del
	// usuario): elegir CLIENTE → el sistema muestra TODAS sus transacciones de ingreso (soportes) con su
	// documentación consultable (ojito); las que NO tienen factura se pintan en azul lino y se pueden
	// seleccionar; las ya facturadas quedan en verde/deshabilitadas → Vista previa → "Autorizar y emitir"
	// (guarda la imagen en Drive y marca esas transacciones como facturadas).
	//
	// Cliente usaba <select> NATIVO a propósito (el type-ahead del navegador alcanzaba). Ticket #29:
	// ese type-ahead no existe en touch (Android vía Tauri) — tocar el <select> abre el picker nativo
	// del sistema, no hay teclado físico con el que "escribir para saltar" — así que pasa a
	// SelectConSaldo.svelte, mismo combo con buscador que el resto de listas largas de Finanzas. Los
	// campos simples de cabecera se dibujan desde FIELDS_CONFIG (mismo motor genérico que el resto de
	// Finanzas).
	import { supabase } from '$lib/supabaseClient';
	import { onDestroy, untrack } from 'svelte';
	import { clientesState, suscribirClientes, opcionesClientes } from '$lib/stores/clientes.svelte';
	import { X, Loader2, Eye, Check, Lock, Trash2, FileText, CloudUpload, FolderOpen, Camera, FileCheck, Receipt, FileUp, ScanText, CircleCheck, CircleAlert, RefreshCw } from '@lucide/svelte';
	import { toast } from '$lib/stores/toast';
	import { validatePayload, applyFieldMask, type FieldOption } from '$lib/shared/fieldConfig';
	import { FIELDS_CONFIG, TIPOS_NOTA_CREDITO } from '$lib/modules/facturacion/config/factura.config';
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
	import { buscarBienServicioPorNombre, DETRACCION_TIPOS_OPERACION, DETRACCION_CODIGOS_BIEN_SERVICIO } from '$lib/modules/facturacion/config/detraccionCatalogos';
	import {
		getClientesParaFacturar,
		getTransaccionesDelCliente,
		getTransaccionesPorIds,
		getFacturaPorFolio,
		getDocumentosTransaccion,
		calcularTotalesFactura,
		valorSinIgv,
		guardarBorradorFactura,
		autorizarYEmitirFactura,
		adjuntarComprobanteSunat,
		TIPO_DOCUMENTO_POR_COMPROBANTE,
		type Factura,
		type FacturaDetalle,
		type ClienteParaFacturar,
		type TransaccionFacturable,
		type LineaFactura,
		type TipoComprobante
	} from '$lib/modules/facturacion/services/facturacion.service';
	import { getCuentasBancoNacionOptions } from '$lib/modules/cuentas-bancarias/services/cuentaBanco.service';
	import { generarFacturaPdf, type DatosFacturaPdf } from '$lib/shared/facturaPdf';
	import { datosPdfDesdeFactura } from '$lib/modules/facturacion/services/facturaPdfDatos';
	import { DETRACCION_CUENTA_BN_DEFAULT, EMPRESA_NOMBRE } from '$lib/shared/empresaConstantes';
	import ConfirmModal from '$lib/shared/components/ConfirmModal.svelte';
	import { permisosState } from '$lib/stores/permisos.svelte';
	import FacturaPreviewModal from './FacturaPreviewModal.svelte';
	import { leerComprobanteSunat, validarArchivoComprobante, ACEPTA_COMPROBANTE, type MetodoLectura } from '$lib/modules/facturacion/services/leerComprobanteArchivo';
	import { camposReconocidos, type DatosComprobanteLeido } from '$lib/modules/facturacion/services/lectorComprobante';
	import DocumentPreviewModal from '$lib/shared/components/DocumentPreviewModal.svelte';

	let {
		open = false,
		mode = 'create',
		tipoComprobante = 'factura',
		factura = null,
		detalleInicial = [],
		preseleccion = null,
		folioReferenciaInicial = null,
		onClose,
		onSaved
	}: {
		open: boolean;
		mode: 'create' | 'edit';
		/** Determina si esto es "Nueva Factura"/"Nueva Boleta"/"Nueva Nota de Crédito"/"Nueva Nota de
		 * Débito" — mismo formulario base para las 4: filtra las transacciones por transaccion.
		 * tipo_documento (ver TIPO_DOCUMENTO_POR_COMPROBANTE en facturacion.service.ts) y define la serie
		 * del folio (ver fn_asignar_folio_factura en factura_migration.sql). */
		tipoComprobante?: TipoComprobante;
		factura: Factura | null;
		detalleInicial?: FacturaDetalle[];
		/** Al abrir desde la tabla de "Gestión de Comprobantes" (pestaña Factura/Boleta) marcando el
		 * check de una transacción — fija el cliente de una vez (sin pasar por el selector) y deja esa
		 * transacción ya tildada. Solo aplica en mode:'create'. */
		/** idTransacciones: varias ya marcadas (cierre de venta: el adelanto y su detracción van en un solo comprobante). */
		preseleccion?: { idCliente: number; idTransaccion: number | null; idTransacciones?: number[] } | null;
		/** Nota de Crédito abierta desde una transacción YA emitida: folio del comprobante que la cubre, que se
		 * precarga como "Número de FE respecto de la cual se emite la Nota de Crédito". */
		folioReferenciaInicial?: string | null;
		onClose: () => void;
		onSaved: () => void | Promise<void>;
	} = $props();

	const NOMBRE_POR_COMPROBANTE: Record<TipoComprobante, string> = {
		factura: 'Factura',
		boleta: 'Boleta',
		nota_credito: 'Nota de Crédito',
		nota_debito: 'Nota de Débito',
		comprobante_venta: 'Comprobante de Venta'
	};
	const tipoDocumento = $derived(TIPO_DOCUMENTO_POR_COMPROBANTE[tipoComprobante]);
	const nombreDocumento = $derived(NOMBRE_POR_COMPROBANTE[tipoComprobante]);
	// Notas de Crédito/Débito llevan la disposición de campos de la imagen del usuario (ver plantilla).
	const esNota = $derived(tipoComprobante === 'nota_credito' || tipoComprobante === 'nota_debito');

	let cuentasBancoNacion = $state<FieldOption[]>([]);
	// Inyecta las opciones reales (cuentas ya registradas en Cuentas Bancarias cuyo banco es el Banco de
	// la Nación, ver getCuentasBancoNacionOptions) en el campo "N° Cta. Banco de la Nación" — a pedido
	// explícito del usuario, ya no se digita a mano. Se arma como derived en vez de mutar FIELDS_CONFIG
	// (el array de config es compartido/estático a nivel de módulo). Solo depende de cuentasBancoNacion
	// (NO de formValues): buildInitialValues() usa este array para leer field.key antes de que
	// `formValues` termine de inicializarse — si este derived leyera formValues, esa lectura ocurriría
	// en su "temporal dead zone" (ReferenceError) apenas se abre el modal.
	// La Nota de Crédito no lleva información de detracción (a pedido del usuario): esos campos no se muestran ni se validan.
	function esCampoDetraccion(key: string): boolean {
		return key === 'sujeta_detraccion' || key === 'porcentaje_detraccion' || key.startsWith('detraccion_');
	}
	const formFields = $derived(
		FIELDS_CONFIG.filter((f) => f.showInForm && (f.key !== 'tipo_nota' || tipoComprobante === 'nota_credito') && ((f.key !== 'folio_referencia' && f.key !== 'folio_nueva_factura') || modoRuc || ((modoDescuentoGlobal || modoDevolucionTotal) && f.key === 'folio_referencia')) && !(modoRuc && f.key === 'observacion') && !(tipoComprobante === 'nota_credito' && esCampoDetraccion(f.key)) && !(esNota && f.key === 'forma_pago')).map((f) => {
			if (f.key === 'folio_referencia' || f.key === 'folio_nueva_factura') return { ...f, required: true };
			if (f.key === 'detraccion_cuenta_bn') return { ...f, options: cuentasBancoNacion };
			// Nota de Crédito (a pedido del usuario, según su imagen): "Tipo de nota de crédito" y "Motivo o
			// sustento" (el mismo campo Observación) son obligatorios.
			if (tipoComprobante === 'nota_credito' && f.key === 'tipo_nota') return { ...f, required: true };
			if (tipoComprobante === 'nota_credito' && f.key === 'observacion') return { ...f, label: 'Motivo o sustento', required: true };
			return f;
		})
	);

	// Variante para validar/renderizar (revalidate() y el template, ver abajo): si la factura (borrador
	// ya guardado) trae un valor viejo en texto libre que ya no coincide con ninguna cuenta activa (dato
	// de antes de que este campo fuera un dropdown, o la cuenta se dio de baja después), ese valor se
	// agrega igual como opción — si no, el <select> lo mostraría vacío y `validatePayload` lo rechazaría
	// como "valor no permitido" al querer guardar, aunque no se haya tocado ese campo.
	// Selects de detracción cuyo valor guardado puede quedar fuera del catálogo actual (facturas viejas con
	// "Bien o Servicio" en texto libre, o una cuenta dada de baja) — se conserva como opción, ver arriba.
	const CAMPOS_DETRACCION_CON_LEGADO = new Set(['detraccion_cuenta_bn', 'detraccion_bien_servicio', 'detraccion_medio_pago', 'detraccion_tipo_operacion', 'detraccion_codigo_bien']);
	const formFieldsConLegado = $derived(
		formFields.map((f) => {
			if (!CAMPOS_DETRACCION_CON_LEGADO.has(f.key)) return f;
			const valorActual = formValues[f.key];
			const base = f.options ?? [];
			const opciones = valorActual && !base.some((o) => o.value === valorActual) ? [...base, { value: valorActual, label: valorActual }] : base;
			return { ...f, options: opciones };
		})
	);

	// Colores de estado de cada transacción en la lista (a pedido del usuario: azul lino = sin factura).
	// Bien diferenciados a propósito (el azul lino y el verde pálidos anteriores casi no se distinguían del
	// blanco ni entre sí): azul lino más intenso = sin factura; verde marcado = ya facturada.
	const COLOR_SIN_FACTURA = { bg: '#bcd3f2', border: '#5b8fd4' };
	const COLOR_FACTURADA = { bg: '#a8dfb9', border: '#3c9b5c' };

	function hoyISO(): string {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	function buildInitialValues(): Record<string, string> {
		const values: Record<string, string> = {};
		// FIELDS_CONFIG (no formFields): solo se necesita field.key acá, nunca field.options — leer el
		// derived reactivo formFields metería a este effect (ver más abajo, se llama desde ahí) una
		// dependencia de cuentasBancoNacion, que ese mismo effect también escribe de forma asíncrona
		// (fetch de las cuentas del Banco de la Nación). Eso disparaba un loop infinito: el effect se
		// reactivaba a sí mismo en cada respuesta del fetch, reseteando formValues sin parar (el
		// formulario "temblando" sin dejar escribir nada).
		for (const field of FIELDS_CONFIG.filter((f) => f.showInForm)) {
			let raw: unknown = factura ? (factura as any)[field.key] : '';
			if (field.key === 'sujeta_detraccion') raw = factura ? (factura.sujeta_detraccion ? 'si' : 'no') : 'no';
			values[field.key] = raw === null || raw === undefined ? '' : String(raw);
		}
		if (!factura) {
			values.fecha_emision = hoyISO();
			values.forma_pago = 'contado';
			values.detraccion_cuenta_bn = DETRACCION_CUENTA_BN_DEFAULT;
		}
		return values;
	}

	let formValues = $state<Record<string, string>>(buildInitialValues());
	let fieldErrors = $state<Record<string, string>>({});
	let idCliente = $state('');
	// A pedido del usuario: la lista de clientes es la misma del Directorio de Clientes (solo activos) y se
	// actualiza sola al cambiar — ver $lib/stores/clientes.svelte.ts. El cliente ya elegido se conserva aunque esté dado de baja.
	const clientes = $derived(
		clientesState.todos.filter((c) => c.estado !== 'baja' || String(c.id_cliente) === idCliente) as ClienteParaFacturar[]
	);
	onDestroy(suscribirClientes());
	let transacciones = $state<TransaccionFacturable[]>([]);
	let cargandoTransacciones = $state(false);
	let seleccion = $state<number[]>([]);
	let descripciones = $state<Record<number, string>>({});
	// Detalle editable de las Notas (a pedido del usuario, según su imagen): cantidad / unidad / valor unitario
	// por línea. Una nota puede acreditar/debitar un monto distinto al de la transacción de origen; la línea
	// sigue ligada a su transacción (fn_emitir_factura la exige). Facturas/Boletas no usan esto.
	let edicionLineas = $state<Record<number, { cantidad?: string; unidad?: string; precio?: string }>>({});
	const UNIDADES_MEDIDA = ['Servicio', 'Unidad', 'Metro', 'Metro cuadrado', 'Metro cúbico', 'Kilogramo', 'Litro', 'Galón', 'Global', 'Mes', 'Día', 'Hora'];
	function setEdicion(id: number, campo: 'cantidad' | 'unidad' | 'precio', valor: string) {
		edicionLineas = { ...edicionLineas, [id]: { ...edicionLineas[id], [campo]: valor } };
	}

	// ── Nota de Crédito "Anulación por Error en el RUC" (pantalla de la imagen del usuario) ───────────
	const modoRuc = $derived(tipoComprobante === 'nota_credito' && formValues.tipo_nota === '02');
	// Nota de Crédito "Descuento Global" (a pedido del usuario, según su imagen): referencia una Factura emitida
	// (de ahí salen cliente y moneda), sin transacciones; se ingresan el Motivo, el Descuento Global (sin IGV), el
	// ISC y el IGV (propuesto al 18% del descuento, editable).
	const modoDescuentoGlobal = $derived(tipoComprobante === 'nota_credito' && formValues.tipo_nota === '04');
	// Nota de Crédito "Devolución Total" (a pedido del usuario, según su imagen): devuelve la Factura indicada
	// COMPLETA — sus líneas, totales, cliente y moneda salen de ella (igual que "Anulación por error en el RUC");
	// solo se piden Fecha, la factura y el Motivo.
	// Misma pantalla (a pedido del usuario, con imagen) para: 03 Corrección por error en la descripción, 07 Devolución
	// por ítem, 05 Descuento por ítem, 10 Otros conceptos y 13 Ajustes – montos y/o fechas de pago. Toman las
	// líneas y totales de la factura indicada (no hay selección de ítems ni montos en el diseño pedido).
	const TIPOS_NOTA_SOLO_REFERENCIA = new Set(['06', '03', '07', '05', '10', '13']);
	const modoDevolucionTotal = $derived(tipoComprobante === 'nota_credito' && TIPOS_NOTA_SOLO_REFERENCIA.has(String(formValues.tipo_nota ?? '')));
	/** Notas que solo referencian otra factura (sin transacciones). */
	const modoReferencia = $derived(modoRuc || modoDescuentoGlobal || modoDevolucionTotal);
	let descuentoGlobal = $state('');
	let iscDescuento = $state('0');
	let igvDescuento = $state('');
	let igvDescuentoEditado = false;
	const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
	function onDescuentoGlobalInput(valor: string) {
		descuentoGlobal = valor;
		if (!igvDescuentoEditado) igvDescuento = valor ? String(r2((Number(valor) + (Number(iscDescuento) || 0)) * 0.18)) : '';
	}
	function onIscDescuentoInput(valor: string) {
		iscDescuento = valor;
		if (!igvDescuentoEditado && descuentoGlobal) igvDescuento = String(r2(((Number(descuentoGlobal) || 0) + (Number(valor) || 0)) * 0.18));
	}
	type FacturaCompleta = NonNullable<Awaited<ReturnType<typeof getFacturaPorFolio>>>;
	// Número de ESTA Nota de Crédito "Anulación por Error en el RUC" (a pedido del usuario, en el encabezado:
	// "E001 - ____"). Si se deja vacío, el sistema asigna su correlativo (fn_asignar_folio_factura).
	let notaSerie = $state('E001');
	let notaCorrelativo = $state('');
	const folioNotaManual = $derived(
		notaCorrelativo.replace(/\D/g, '') ? `${notaSerie.trim().toUpperCase()}-${notaCorrelativo.replace(/\D/g, '').padStart(8, '0').slice(-8)}` : ''
	);
	let refSerie = $state('E001');
	let refCorrelativo = $state('');
	let nuevaSerie = $state('E001');
	let nuevaCorrelativo = $state('');
	let refFactura = $state<FacturaCompleta | null>(null);
	let cargandoRef = $state(false);
	// Visor de solo lectura para "Ver Factura" (sin botón Autorizar): aparece si la factura aún no tiene imagen guardada.
	let verFacturaOpen = $state(false);
	let verFacturaDatos = $state<DatosFacturaPdf | null>(null);

	function folioDe(serie: string, correlativo: string): string {
		const c = correlativo.replace(/\D/g, '').slice(0, 8);
		return c ? `${serie.trim().toUpperCase()}-${c.padStart(8, '0')}` : '';
	}
	function setFolio(cual: 'ref' | 'nueva', campo: 'serie' | 'corr', valor: string) {
		if (cual === 'ref') {
			if (campo === 'serie') refSerie = valor;
			else refCorrelativo = valor.replace(/\D/g, '').slice(0, 8);
			formValues = { ...formValues, folio_referencia: folioDe(refSerie, refCorrelativo) };
			refFactura = null;
		} else {
			if (campo === 'serie') nuevaSerie = valor;
			else nuevaCorrelativo = valor.replace(/\D/g, '').slice(0, 8);
			formValues = { ...formValues, folio_nueva_factura: folioDe(nuevaSerie, nuevaCorrelativo) };
		}
		revalidate();
	}

	/** Busca la Factura EMITIDA a anular; de ella salen el cliente, las líneas y el monto de la nota. */
	async function resolverReferencia(folio: string | null | undefined): Promise<boolean> {
		if (!folio) return false;
		cargandoRef = true;
		try {
			const r = await getFacturaPorFolio(supabase, folio);
			if (!r) {
				refFactura = null;
				toast.error(`No se encontró la factura ${folio}.`);
				return false;
			}
			if (r.factura.tipo_comprobante !== 'factura' || r.factura.estado !== 'emitida') {
				refFactura = null;
				toast.error(`${folio} debe ser una Factura emitida.`);
				return false;
			}
			refFactura = r;
			idCliente = String(r.factura.id_cliente);
			return true;
		} catch (err) {
			console.error('[FacturaModal] No se pudo buscar la factura a anular:', err);
			toast.error('No se pudo buscar la factura.');
			return false;
		} finally {
			cargandoRef = false;
		}
	}

	/** "Ver Factura": abre la imagen/PDF guardados de la factura con ese número. */
	async function verFacturaPorFolio(folio: string | null | undefined) {
		if (!folio) {
			toast.error('Ingresa primero el número de la factura.');
			return;
		}
		try {
			const r = await getFacturaPorFolio(supabase, folio);
			if (!r) {
				toast.error(`No se encontró la factura ${folio}.`);
				return;
			}
			const docs = [
				...(r.factura.imagen_url ? [{ url: r.factura.imagen_url, label: 'Imagen' }] : []),
				...r.archivos.filter((a) => a.tipo === 'pdf').map((a) => ({ url: a.url, label: 'PDF' }))
			];
			if (docs.length === 0) {
				// Sin imagen guardada (borrador/anulada): se genera la vista previa desde sus datos, con sello de agua.
				verFacturaDatos = datosPdfDesdeFactura(r.factura, r.detalle, r.factura.estado === 'anulada' ? 'ANULADA' : 'BORRADOR');
				verFacturaOpen = true;
				return;
			}
			docsTitle = `Factura ${folio}`;
			docsLista = docs;
			docsOpen = true;
		} catch (err) {
			console.error('[FacturaModal] No se pudo abrir la factura:', err);
			toast.error('No se pudo abrir la factura.');
		}
	}
	async function verFacturaReferencia() {
		await resolverReferencia(formValues.folio_referencia);
		await verFacturaPorFolio(formValues.folio_referencia);
	}

	/** Datos a guardar/imprimir: la Nota de Crédito nunca lleva detracción, y la de "Anulación por Error en
	 * el RUC" arma su motivo con los números de ambas facturas. */
	function payloadGuardar(): Record<string, string> {
		if (tipoComprobante !== 'nota_credito') return formValues;
		const p: Record<string, string> = { ...formValues, sujeta_detraccion: 'no' };
		if (modoRuc) p.observacion = `Anulación por error en el RUC — Factura ${formValues.folio_referencia}; nueva factura ${formValues.folio_nueva_factura}`;
		return p;
	}

	let facturaActual = $state<Factura | null>(null);
	let guardando = $state(false);

	let docsOpen = $state(false);
	let docsTitle = $state('');
	let docsLista = $state<{ url: string; label: string }[]>([]);

	let previewOpen = $state(false);
	let previewDatos = $state<DatosFacturaPdf | null>(null);
	let autorizando = $state(false);
	let confirmarEmision = $state(false);

	// ── Origen de los datos (a pedido del usuario): por CADA documento, un interruptor elige si se arma con
	// los datos de la transacción (lo de siempre) o leyendo el comprobante ya emitido por SUNAT (PDF, foto o
	// XML — ver leerComprobanteArchivo.ts). En modo SUNAT el documento lleva el número de SUNAT como folio y
	// su importe tiene que coincidir con el de las transacciones elegidas (siguen siendo el soporte de pago:
	// fn_emitir_factura las exige y así una transacción nunca se factura dos veces).
	let origenDatos = $state<'transaccion' | 'sunat'>('transaccion');
	let archivoSunat = $state<File | null>(null);
	let leyendoSunat = $state(false);
	let datosSunat = $state<DatosComprobanteLeido | null>(null);
	let metodoLectura = $state<MetodoLectura | null>(null);
	let serieSunat = $state('');
	let numeroSunat = $state('');
	let totalSunat = $state('');
	let docReceptorSunat = $state('');
	let clienteSunatNoEncontrado = $state(false);
	let arrastrandoSunat = $state(false);

	const NOMBRE_TIPO_LEIDO: Record<string, string> = { factura: 'Factura', boleta: 'Boleta', nota_credito: 'Nota de Crédito', nota_debito: 'Nota de Débito' };
	const ETIQUETA_METODO: Record<MetodoLectura, string> = { xml: 'XML de SUNAT', pdf_texto: 'Texto del PDF', ocr: 'OCR (imagen)' };

	function resetSunat() {
		archivoSunat = null;
		datosSunat = null;
		metodoLectura = null;
		serieSunat = '';
		numeroSunat = '';
		totalSunat = '';
		docReceptorSunat = '';
		clienteSunatNoEncontrado = false;
	}

	async function cargarArchivoSunat(file: File | null | undefined) {
		if (!file || leyendoSunat) return;
		const error = validarArchivoComprobante(file);
		if (error) {
			toast.error(error);
			return;
		}
		resetSunat();
		archivoSunat = file;
		leyendoSunat = true;
		try {
			const { datos, metodo } = await leerComprobanteSunat(file);
			datosSunat = datos;
			metodoLectura = metodo;
			serieSunat = datos.serie ?? '';
			numeroSunat = datos.numero ?? '';
			totalSunat = datos.total != null ? String(datos.total) : '';
			docReceptorSunat = datos.doc_receptor ?? '';
			if (datos.fecha_emision) handleInput('fecha_emision', datos.fecha_emision);
			await aplicarClienteSunat();
			const { encontrados, total } = camposReconocidos(datos);
			if (encontrados === 0) toast.error('No se reconoció ningún dato del comprobante. Complétalos a mano.');
			else toast.success(`Comprobante leído: ${encontrados} de ${total} datos reconocidos. Revísalos antes de emitir.`);
		} catch (err: any) {
			console.error('[FacturaModal] No se pudo leer el comprobante de SUNAT:', err);
			toast.error(`No se pudo leer el archivo: ${err?.message ?? 'error inesperado'}`);
		} finally {
			leyendoSunat = false;
		}
	}

	/** Busca en el Directorio de Clientes el RUC/DNI leído; si lo encuentra lo elige y, si hay UNA sola
	 * transacción sin facturar por el mismo importe, la deja tildada. */
	async function aplicarClienteSunat() {
		const doc = docReceptorSunat.replace(/\D/g, '');
		if (!doc) return;
		const c = clientes.find((x) => (x.num_documento ?? '').replace(/\D/g, '') === doc);
		clienteSunatNoEncontrado = !c;
		if (!c) return;
		if (String(c.id_cliente) !== idCliente) await handleClienteChange(String(c.id_cliente));
		const total = Number(totalSunat);
		if (seleccion.length === 0 && total > 0) {
			const coinciden = transacciones.filter((t) => t.id_factura == null && Math.abs(t.monto_total - total) < 0.01);
			if (coinciden.length === 1) seleccion = [coinciden[0].id_transaccion];
		}
	}

	const modoSunat = $derived(origenDatos === 'sunat' && mode === 'create' && !modoReferencia);
	const folioSunat = $derived(serieSunat.trim() && numeroSunat.trim() ? `${serieSunat.trim().toUpperCase()}-${numeroSunat.replace(/\D/g, '').padStart(8, '0').slice(-8)}` : '');
	const totalSunatNum = $derived(Number(totalSunat) || 0);
	const tipoSunatDistinto = $derived(!!datosSunat?.tipo && datosSunat.tipo !== tipoComprobante);

	async function cargarTransacciones(id: string) {
		transacciones = [];
		if (!id) return;
		cargandoTransacciones = true;
		try {
			let lista = await getTransaccionesDelCliente(supabase, Number(id), tipoDocumento);
			// Reabriendo un borrador: sus transacciones guardadas deben verse (y quedar tildadas) siempre,
			// aunque ya no entren en el filtro normal de la lista.
			if (factura) {
				const faltantes = detalleInicial.map((d) => d.id_transaccion).filter((v): v is number => v != null && !lista.some((t) => t.id_transaccion === v));
				if (faltantes.length > 0) lista = [...lista, ...(await getTransaccionesPorIds(supabase, faltantes))];
			}
			transacciones = lista;
		} catch (err) {
			console.error('[FacturaModal] No se pudieron cargar las transacciones del cliente:', err);
			toast.error('No se pudieron cargar las transacciones del cliente.');
		} finally {
			cargandoTransacciones = false;
		}
	}

	$effect(() => {
		if (!open) return;
		// Solo debe correr al ABRIR el modal (o si cambian sus props). Antes leía formValues (folio de referencia de
		// la Nota de Crédito) y quedaba suscrito: cualquier cambio del formulario (motivo, la fecha leída del PDF de
		// SUNAT...) lo volvía a correr y devolvía el interruptor a "La transacción" — "se atascaba".
		void [factura, preseleccion, folioReferenciaInicial, detalleInicial, tipoComprobante];
		untrack(() => {
			formValues = buildInitialValues();
			fieldErrors = {};
			facturaActual = factura;
			idCliente = factura ? String(factura.id_cliente) : preseleccion ? String(preseleccion.idCliente) : '';
			seleccion = detalleInicial.map((d) => d.id_transaccion).filter((v): v is number => v != null);
			descripciones = Object.fromEntries(detalleInicial.filter((d) => d.id_transaccion != null).map((d) => [d.id_transaccion as number, d.descripcion]));
			edicionLineas = Object.fromEntries(detalleInicial.filter((d) => d.id_transaccion != null).map((d) => [d.id_transaccion as number, { cantidad: String(d.cantidad), unidad: d.unidad ?? 'Servicio', precio: String(d.precio_unitario) }]));
			// Anulación por Error en el RUC: serie/número de ambas facturas (se buscan al abrir un borrador guardado).
			const [rs, rc] = (factura?.folio_referencia ?? '').split('-');
			refSerie = rs || 'E001';
			refCorrelativo = rc ?? '';
			const [ns, nc] = (factura?.folio_nueva_factura ?? '').split('-');
			nuevaSerie = ns || 'E001';
			nuevaCorrelativo = nc ?? '';
			refFactura = null;
			notaSerie = 'E001';
			notaCorrelativo = '';
			igvDescuentoEditado = false;
			if (factura && factura.tipo_nota === '04') {
				descuentoGlobal = String(factura.valor_venta ?? '');
				iscDescuento = String(factura.isc ?? 0);
				igvDescuento = String(factura.monto_igv ?? '');
				igvDescuentoEditado = true;
			} else {
				descuentoGlobal = '';
				iscDescuento = '0';
				igvDescuento = '';
			}
			if (factura?.folio_referencia) resolverReferencia(factura.folio_referencia);
			if (!factura && folioReferenciaInicial) {
				const [rs2, rc2] = folioReferenciaInicial.split('-');
				refSerie = rs2 || 'E001';
				refCorrelativo = rc2 ?? '';
				formValues = { ...formValues, folio_referencia: folioReferenciaInicial };
			}
			previewOpen = false;
			previewDatos = null;
			origenDatos = 'transaccion';
			resetSunat();
			getCuentasBancoNacionOptions(supabase)
				.then((data) => {
					cuentasBancoNacion = data;
					// Factura NUEVA: la cuenta del Banco de la Nación viene elegida por defecto (a pedido del usuario) —
					// la de la propia empresa si hay varias, si no la primera. Editando un borrador se respeta lo guardado.
					if (!factura && !formValues.detraccion_cuenta_bn && data.length > 0) {
						const preferida = data.find((o) => o.label.toUpperCase().includes(EMPRESA_NOMBRE.toUpperCase())) ?? data[0];
						formValues = { ...formValues, detraccion_cuenta_bn: preferida.value };
					}
				})
				.catch((err) => console.error('[FacturaModal] No se pudieron cargar las cuentas del Banco de la Nación:', err));
			if (factura) {
				cargarTransacciones(String(factura.id_cliente));
			} else if (preseleccion) {
				// Viene de "Gestión de Comprobantes" con un check ya marcado — se precarga el cliente y, apenas
				// llegan sus transacciones, se tilda la que originó el check (mismo criterio de "no perder lo
				// que el usuario ya eligió" que el resto de flujos de preselección del ERP).
				cargarTransacciones(String(preseleccion.idCliente)).then(() => {
					seleccion = preseleccion.idTransacciones?.length
						? transacciones.filter((t) => preseleccion.idTransacciones!.includes(t.id_transaccion)).map((t) => t.id_transaccion)
						: preseleccion.idTransaccion != null ? [preseleccion.idTransaccion] : [];
				});
			} else {
				transacciones = [];
			}
		});
	});

	const clienteLista = $derived(clientes.find((c) => String(c.id_cliente) === idCliente) ?? null);
	// Editando un borrador se muestran los datos del cliente TAL COMO se guardaron (snapshot en la factura:
	// nombre/documento/dirección), no los actuales de la ficha — y sin depender de que la lista de clientes
	// ya haya terminado de cargar.
	const clienteSeleccionado = $derived<ClienteParaFacturar | null>(
		factura && String(factura.id_cliente) === idCliente
			? {
					id_cliente: factura.id_cliente,
					nombre: factura.cliente_nombre ?? clienteLista?.nombre ?? '',
					tipo_doc: factura.cliente_tipo_doc ?? clienteLista?.tipo_doc ?? null,
					num_documento: factura.cliente_documento ?? clienteLista?.num_documento ?? null,
					direccion: factura.cliente_direccion ?? clienteLista?.direccion ?? null
				}
			: clienteLista
	);
	const transaccionesSeleccionadas = $derived(transacciones.filter((t) => seleccion.includes(t.id_transaccion)));
	const primera = $derived(transaccionesSeleccionadas[0] ?? null);
	const moneda = $derived<'PEN' | 'USD'>(modoReferencia && refFactura ? (refFactura.factura.moneda === 'USD' ? 'USD' : 'PEN') : primera?.tipo_moneda === 'dolares' ? 'USD' : 'PEN');
	const tipoCambio = $derived(modoReferencia && refFactura ? refFactura.factura.tipo_cambio : primera?.tipo_moneda === 'dolares' ? primera.tipo_cambio : null);

	function defaultDescripcion(t: TransaccionFacturable): string {
		const base = [t.categoria, t.descripcion].filter(Boolean).join(' — ') || 'Ingreso';
		return t.num_documento ? `${base} (${t.num_documento})` : base;
	}

	const lineasDeTransacciones = $derived<LineaFactura[]>(
		transaccionesSeleccionadas.map((t) => {
			const ed = esNota ? edicionLineas[t.id_transaccion] : undefined;
			const cantidad = ed?.cantidad !== undefined ? Number(ed.cantidad) || 0 : 1;
			const precio = ed?.precio !== undefined ? Number(ed.precio) || 0 : valorSinIgv(t.monto_total);
			return {
				id_transaccion: t.id_transaccion,
				descripcion: descripciones[t.id_transaccion] ?? defaultDescripcion(t),
				unidad: ed?.unidad || 'Servicio',
				cantidad,
				precio_unitario: precio,
				// Notas: el monto sale de lo editado (cantidad × valor unitario + 18% IGV); Factura/Boleta: el de la transacción.
				monto_total_linea: esNota ? Math.round(cantidad * precio * 1.18 * 100) / 100 : t.monto_total
			};
		})
	);

	const lineasDeReferencia = $derived<LineaFactura[]>(
		refFactura
			? refFactura.detalle.map((d) => ({
					id_transaccion: null,
					descripcion: d.descripcion,
					unidad: d.unidad ?? 'Servicio',
					cantidad: Number(d.cantidad),
					precio_unitario: Number(d.precio_unitario),
					monto_total_linea: Number(d.monto_total_linea ?? Math.round(Number(d.cantidad) * Number(d.precio_unitario) * 1.18 * 100) / 100)
				}))
			: []
	);
	const totalesDescuento = $derived.by(() => {
		const d = r2(Number(descuentoGlobal));
		const isc = r2(Number(iscDescuento));
		const igv = r2(Number(igvDescuento));
		return { subTotalVentas: d, anticipos: 0, descuentos: 0, valorVenta: d, isc, igv, otrosCargos: 0, otrosTributos: 0, redondeo: 0, importeTotal: r2(d + isc + igv), montoDetraccion: 0 };
	});
	const lineaDescuento = $derived<LineaFactura[]>(
		Number(descuentoGlobal) > 0
			? [{
					id_transaccion: null,
					descripcion: `Descuento global${formValues.observacion?.trim() ? ` — ${formValues.observacion.trim()}` : ''}`,
					unidad: 'Servicio',
					cantidad: 1,
					precio_unitario: r2(Number(descuentoGlobal)),
					monto_total_linea: totalesDescuento.importeTotal
				}]
			: []
	);
	const lineas = $derived<LineaFactura[]>(modoRuc || modoDevolucionTotal ? lineasDeReferencia : modoDescuentoGlobal ? lineaDescuento : lineasDeTransacciones);

	const sujetaDetraccion = $derived(tipoComprobante !== 'nota_credito' && String(formValues.sujeta_detraccion ?? 'no') === 'si');
	const totales = $derived.by(() => modoDescuentoGlobal ? totalesDescuento : calcularTotalesFactura(lineas.map((l) => l.monto_total_linea), sujetaDetraccion, Number(formValues.porcentaje_detraccion || 0), tipoComprobante === 'comprobante_venta'));

	function seleccionable(t: TransaccionFacturable): boolean {
		if (t.id_factura != null) return false;
		if (!primera) return true;
		return (t.tipo_moneda === 'dolares') === (primera.tipo_moneda === 'dolares');
	}

	function toggle(t: TransaccionFacturable) {
		if (!seleccionable(t)) return;
		seleccion = seleccion.includes(t.id_transaccion) ? seleccion.filter((id) => id !== t.id_transaccion) : [...seleccion, t.id_transaccion];
	}

	async function handleClienteChange(value: string) {
		idCliente = value;
		seleccion = [];
		descripciones = {};
		await cargarTransacciones(value);
	}

	async function abrirDocumentos(t: TransaccionFacturable) {
		docsTitle = `Soportes — ${t.categoria ?? 'Ingreso'} ${t.fecha}`;
		docsLista = await getDocumentosTransaccion(supabase, t);
		docsOpen = true;
	}

	function handleInput(key: string, rawValue: string) {
		const field = formFields.find((f) => f.key === key)!;
		const nuevo: Record<string, string> = { [key]: applyFieldMask(field, rawValue) };
		// Al elegir "Bien o Servicio" se propone su % de detracción y su código (ambos siguen siendo editables).
		if (key === 'detraccion_bien_servicio') {
			const item = buscarBienServicioPorNombre(rawValue);
			if (item) {
				nuevo.porcentaje_detraccion = String(item.porcentaje);
				// A pedido del usuario: el código de la lista de Bien o Servicio se coloca en "Código de Bien/Servicio".
				nuevo.detraccion_codigo_bien = item.codigo;
			}
		}
		formValues = { ...formValues, ...nuevo };
		revalidate();
	}

	function revalidate() {
		// formFieldsConLegado (no FIELDS_CONFIG) — trae las opciones reales del dropdown "N° Cta. Banco
		// de la Nación" (ver arriba, incluye el valor viejo de un borrador si ya no está entre las
		// cuentas activas); FIELDS_CONFIG tiene ese campo con options:[] a propósito, así que validar
		// contra ese array vacío rechazaría cualquier cuenta elegida.
		fieldErrors = validatePayload(formFieldsConLegado, formValues);
		if (!idCliente) fieldErrors = { ...fieldErrors, id_cliente: 'Selecciona un cliente' };
	}

	// Grupos del formulario (a pedido explícito del usuario): datos generales arriba; "Información de
	// detracción" en su propio recuadro (se desbloquea al elegir Sujeta a detracción = Sí); y debajo
	// Porcentaje / Monto / Cuenta.
	const CLAVES_RECUADRO_DETRACCION = ['detraccion_tipo_operacion', 'detraccion_bien_servicio', 'detraccion_codigo_bien', 'detraccion_medio_pago'];
	const CLAVES_ARRIBA_NOTA = ['tipo_nota', 'fecha_emision', 'observacion'];
	const camposGenerales = $derived(formFieldsConLegado.filter((f) => !f.key.startsWith('detraccion_') && f.key !== 'porcentaje_detraccion' && f.key !== 'folio_referencia' && f.key !== 'folio_nueva_factura' && !(esNota && CLAVES_ARRIBA_NOTA.includes(f.key))));
	const campoTipoNota = $derived(formFieldsConLegado.find((f) => f.key === 'tipo_nota'));
	const campoFechaEmision = $derived(formFieldsConLegado.find((f) => f.key === 'fecha_emision'));
	const campoMotivo = $derived(formFieldsConLegado.find((f) => f.key === 'observacion'));
	const camposRecuadroDetraccion = $derived(CLAVES_RECUADRO_DETRACCION.map((k) => formFieldsConLegado.find((f) => f.key === k)).filter((f): f is (typeof formFieldsConLegado)[number] => !!f));
	const campoPorcentaje = $derived(formFieldsConLegado.find((f) => f.key === 'porcentaje_detraccion'));
	const campoCuenta = $derived(formFieldsConLegado.find((f) => f.key === 'detraccion_cuenta_bn'));

	function etiquetaCodigoBien(codigo: string | null | undefined): string {
		const item = DETRACCION_CODIGOS_BIEN_SERVICIO.find((c) => c.codigo === codigo);
		return item ? `${item.codigo} - ${item.nombre}` : (codigo ?? '');
	}

	function isDisabled(field: (typeof formFields)[number]): boolean {
		return field.disabledWhen?.(formValues) ?? false;
	}

	const soloLectura = $derived(mode === 'edit' && factura?.estado !== 'borrador');
	const puedeContinuar = $derived(!!idCliente && lineas.length > 0);
	const title = $derived(soloLectura ? `Consultar ${nombreDocumento}` : mode === 'create' ? `Nueva ${nombreDocumento}` : `Editar ${nombreDocumento} (Borrador)`);

	function fmt(valor: number): string {
		return `${moneda === 'USD' ? 'US$' : 'S/'} ${Number(valor || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	function fmtTransaccion(t: TransaccionFacturable): string {
		return `${t.tipo_moneda === 'dolares' ? 'US$' : 'S/'} ${t.monto_total.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	function validarAntesDeContinuar(): boolean {
		revalidate();
		if (Object.keys(fieldErrors).length > 0) {
			toast.error('Revisa los campos marcados');
			return false;
		}
		if (modoReferencia && folioNotaManual && !/^[A-Z][A-Z0-9]{3}-\d{8}$/.test(folioNotaManual)) {
			toast.error('La serie de la Nota de Crédito debe tener 4 caracteres (ej. E001).');
			return false;
		}
		if (modoDescuentoGlobal) {
			const error = !refFactura
				? 'Indica la Factura emitida sobre la que se aplica el descuento (usa "Ver Factura" para verificarla).'
				: !(Number(descuentoGlobal) > 0)
					? 'Ingresa el monto del Descuento Global.'
					: Number(iscDescuento) < 0 || Number(igvDescuento) < 0
						? 'El ISC y el IGV no pueden ser negativos.'
						: totalesDescuento.importeTotal - Number(refFactura.factura.monto_total) > 0.01
							? `El descuento (${fmt(totalesDescuento.importeTotal)}) no puede superar el total de la factura (${fmt(Number(refFactura.factura.monto_total))}).`
							: null;
			if (error) {
				toast.error(error);
				return false;
			}
		}
		if (modoDevolucionTotal && !refFactura) {
			toast.error('Indica la Factura emitida a la que corresponde la Nota de Crédito (usa "Ver Factura" para verificarla).');
			return false;
		}
		if (modoRuc && !refFactura) {
			toast.error('Indica una Factura emitida válida (usa "Ver Factura" para verificarla).');
			return false;
		}
		if (lineas.length === 0) {
			toast.error(modoRuc ? 'La factura indicada no tiene líneas.' : 'Selecciona al menos una transacción para facturar.');
			return false;
		}
		if (esNota && lineas.some((l) => !(l.cantidad > 0) || !(l.precio_unitario > 0))) {
			toast.error('Completa la cantidad y el valor unitario de cada línea del detalle.');
			return false;
		}
		if (modoSunat) {
			const error = !archivoSunat
				? 'Sube el comprobante emitido por SUNAT (o cambia a "Datos de la transacción").'
				: !/^[A-Z][A-Z0-9]{3}-\d{8}$/.test(folioSunat)
					? 'Completa la serie (4 caracteres, ej. E001) y el número del comprobante de SUNAT.'
					: tipoSunatDistinto
						? `El archivo es una ${NOMBRE_TIPO_LEIDO[datosSunat!.tipo!]}, pero estás emitiendo una ${nombreDocumento}.`
						: !(totalSunatNum > 0)
							? 'Completa el importe total del comprobante de SUNAT.'
							: Math.abs(totales.importeTotal - totalSunatNum) >= 0.01
								? `El importe del comprobante de SUNAT (${fmt(totalSunatNum)}) no coincide con el de las transacciones elegidas (${fmt(totales.importeTotal)}).`
								: datosSunat?.moneda && datosSunat.moneda !== moneda
									? 'La moneda del comprobante de SUNAT no coincide con la de las transacciones elegidas.'
									: null;
			if (error) {
				toast.error(error);
				return false;
			}
		}
		return true;
	}

	function construirDatosPdf(folio: string | null, marcaAgua: string | null): DatosFacturaPdf {
		const c = clienteSeleccionado;
		return {
			tipoDocumento: tipoComprobante,
			folio,
			fechaEmision: formValues.fecha_emision,
			formaPago: formValues.forma_pago === 'credito' ? 'credito' : 'contado',
			clienteNombre: c?.nombre ?? '',
			clienteDocumentoLabel: c?.tipo_doc ?? 'RUC',
			clienteDocumento: c?.num_documento ?? '',
			clienteDireccion: c?.direccion ?? '',
			moneda,
			observacion: payloadGuardar().observacion ?? '',
			lineas: lineas.map((l) => ({ cantidad: l.cantidad, unidad: l.unidad, descripcion: l.descripcion, valorUnitario: l.precio_unitario, importe: l.monto_total_linea })),
			subTotalVentas: totales.subTotalVentas,
			anticipos: totales.anticipos,
			descuentos: totales.descuentos,
			valorVenta: totales.valorVenta,
			isc: totales.isc,
			igv: totales.igv,
			otrosCargos: totales.otrosCargos,
			otrosTributos: totales.otrosTributos,
			redondeo: totales.redondeo,
			importeTotal: totales.importeTotal,
			sujetaDetraccion,
			porcentajeDetraccion: Number(formValues.porcentaje_detraccion || 0),
			montoDetraccion: totales.montoDetraccion,
			tipoNota: TIPOS_NOTA_CREDITO.find((o) => o.value === formValues.tipo_nota)?.label ?? '',
			detraccionTipoOperacion: DETRACCION_TIPOS_OPERACION.find((o) => o.codigo === formValues.detraccion_tipo_operacion)?.nombre ?? '',
			detraccionBienServicio: formValues.detraccion_bien_servicio ?? '',
			detraccionCodigoBien: etiquetaCodigoBien(formValues.detraccion_codigo_bien),
			detraccionMedioPago: formValues.detraccion_medio_pago ?? '',
			detraccionCuentaBn: formValues.detraccion_cuenta_bn ?? '',
			marcaAgua
		};
	}

	/** Guarda (crea o actualiza) el borrador y recuerda el id/folio real para el siguiente paso. */
	async function guardar(): Promise<Factura | null> {
		const c = clienteSeleccionado;
		if (!c) return null;
		const result = await guardarBorradorFactura(
			supabase,
			payloadGuardar(),
			{ id_cliente: c.id_cliente, nombre: c.nombre, tipo_doc: c.tipo_doc, num_documento: c.num_documento, direccion: c.direccion },
			moneda,
			tipoCambio,
			lineas,
			permisosState.userName || null,
			tipoComprobante,
			facturaActual?.id_factura,
			modoSunat ? folioSunat : modoReferencia && mode === 'create' && folioNotaManual ? folioNotaManual : null,
			modoDescuentoGlobal ? totalesDescuento : null
		);
		if (!result.success || !result.data) {
			toast.error(result.message);
			if (result.errors) fieldErrors = { ...fieldErrors, ...result.errors };
			return null;
		}
		facturaActual = result.data;
		return result.data;
	}

	async function handleGuardarBorrador() {
		if (!validarAntesDeContinuar()) return;
		guardando = true;
		try {
			const saved = await guardar();
			if (saved) {
				toast.success('Borrador guardado');
				await onSaved();
				onClose();
			}
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		} finally {
			guardando = false;
		}
	}

	function handleVistaPrevia() {
		if (!validarAntesDeContinuar()) return;
		previewDatos = construirDatosPdf(facturaActual?.folio ?? (modoSunat ? folioSunat : modoReferencia && folioNotaManual ? folioNotaManual : null), 'VISTA PREVIA');
		previewOpen = true;
	}

	/** Autorización: guarda el borrador (asigna el folio real), regenera la imagen/PDF YA con ese folio y sin
	 * sello, la sube a Drive y emite la factura de forma atómica. Si algo falla, el borrador queda guardado
	 * y las transacciones sin tocar. */
	async function handleAutorizar() {
		if (!validarAntesDeContinuar()) return;
		autorizando = true;
		try {
			const saved = await guardar();
			if (!saved) return;
			const archivos = await generarFacturaPdf(construirDatosPdf(saved.folio, null));
			const result = await autorizarYEmitirFactura(supabase, saved, archivos.pngDataUrl, archivos.pdfBase64, permisosState.userName || null);
			if (result.success) {
				toast.success(result.message);
				if (modoSunat && archivoSunat) {
					const errorAdjunto = await adjuntarComprobanteSunat(supabase, saved, archivoSunat, permisosState.userName || null);
					if (errorAdjunto) toast.error(`El documento se emitió, pero no se guardó el archivo original de SUNAT: ${errorAdjunto}`);
				}
				previewOpen = false;
				await onSaved();
				onClose();
			} else {
				toast.error(result.message);
			}
		} catch (err: any) {
			toast.error(err?.message ?? 'Ocurrió un error inesperado');
		} finally {
			autorizando = false;
		}
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
			<div class="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
				<h2 class="text-lg font-semibold text-[#0f3b5e]">{title}{facturaActual?.folio ? ` — ${facturaActual.folio}` : ''}</h2>
				{#if modoReferencia && mode === 'create' && !facturaActual?.folio}
					<!-- Número de esta Nota de Crédito (opcional: vacío = correlativo automático). -->
					<div class="ml-auto mr-3 flex items-center gap-2">
						<input type="text" maxlength="4" bind:value={notaSerie} aria-label="Serie de la Nota de Crédito" class="w-20 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm uppercase text-[#0f3b5e] focus:outline-none focus:ring-2 focus:ring-blue-200" />
						<span class="text-slate-400">-</span>
						<input type="text" inputmode="numeric" maxlength="8" bind:value={notaCorrelativo} placeholder="Número" aria-label="Número de la Nota de Crédito" title="Opcional: si lo dejas vacío, se asigna el correlativo automático" class="w-28 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-[#0f3b5e] focus:outline-none focus:ring-2 focus:ring-blue-200" />
					</div>
				{/if}
				<button onclick={onClose} class="text-slate-400 hover:text-slate-600 w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded-lg" aria-label="Cerrar">
					<X size={18} />
				</button>
			</div>

			<div class="p-6 overflow-y-auto flex-1">
				{#snippet campo(field: (typeof formFieldsConLegado)[number])}
					<div>
						<label for={`fac-${field.key}`} class="block text-sm font-medium text-[#0f3b5e] mb-1">
							{field.label}
							{#if field.required || (sujetaDetraccion && field.requiredWhen?.(formValues))}<span class="text-red-500">*</span>{/if}
						</label>
						{#if field.tipo === 'select' || field.options}
							<SelectConSaldo
								id={`fac-${field.key}`}
								value={formValues[field.key]}
								options={(field.options ?? [])}
								placeholder="Selecciona una opción"
								disabled={isDisabled(field) || soloLectura}
								onchange={(v) => handleInput(field.key, v)}
							/>
						{:else}
							<input
								id={`fac-${field.key}`}
								type={field.tipo === 'number' ? 'number' : field.tipo === 'date' ? 'date' : 'text'}
								step={field.tipo === 'number' ? 'any' : undefined}
								value={formValues[field.key]}
								maxlength={field.maxLength}
								placeholder={field.placeholder}
								disabled={isDisabled(field) || soloLectura}
								oninput={(e) => handleInput(field.key, (e.target as HTMLInputElement).value)}
								class={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:text-slate-400 ${fieldErrors[field.key] ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
							/>
						{/if}
						{#if fieldErrors[field.key]}
							<p class="mt-1 text-xs text-red-600">{fieldErrors[field.key]}</p>
						{:else if field.helpText}
							<p class="mt-1 text-xs text-slate-400">{field.helpText}</p>
						{/if}
					</div>
				{/snippet}

				{#if mode === 'create' && !modoReferencia && !soloLectura}
					<!-- Origen de los datos de ESTE documento (ver origenDatos en el script): tarjetas seleccionables. -->
					<div class="mb-6">
						<p class="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Origen de los datos</p>
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Origen de los datos">
							{#each [
								{ v: 'transaccion', titulo: 'Desde la transacción', detalle: 'Arma el documento con los pagos ya registrados del cliente.', icono: Receipt },
								{ v: 'sunat', titulo: 'Desde PDF de SUNAT', detalle: 'Lee un comprobante ya emitido (PDF, foto o XML) y usa sus datos.', icono: FileUp }
							] as op (op.v)}
								{@const activo = origenDatos === op.v}
								<button
									type="button"
									role="radio"
									aria-checked={activo}
									onclick={() => (origenDatos = op.v as typeof origenDatos)}
									class={`group flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${activo ? 'border-blue-600 bg-blue-50/70 shadow-sm ring-1 ring-blue-600' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`}
								>
									<span class={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${activo ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 group-hover:text-slate-700'}`}>
										<op.icono size={18} />
									</span>
									<span class="min-w-0 flex-1">
										<span class={`block text-sm font-semibold ${activo ? 'text-blue-900' : 'text-slate-800'}`}>{op.titulo}</span>
										<span class="mt-0.5 block text-xs text-slate-500">{op.detalle}</span>
									</span>
									<span class={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${activo ? 'border-blue-600' : 'border-slate-300'}`}>
										{#if activo}<span class="h-2 w-2 rounded-full bg-blue-600"></span>{/if}
									</span>
								</button>
							{/each}
						</div>
					</div>

					{#if origenDatos === 'sunat'}
						<section class="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
							<header class="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
								<div class="flex items-center gap-2 min-w-0">
									<ScanText size={17} class="text-[#0f3b5e] shrink-0" />
									<h3 class="text-sm font-semibold text-[#0f3b5e] truncate">Comprobante de SUNAT · {nombreDocumento}</h3>
								</div>
								{#if archivoSunat && !leyendoSunat}
									<label for="fac-sunat-archivo" class="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer">
										<RefreshCw size={13} /> Cambiar archivo
									</label>
								{/if}
							</header>

							<div class="p-4">
								{#if leyendoSunat}
									<div class="flex flex-col items-center justify-center gap-2 py-10 text-sm text-slate-500">
										<Loader2 size={24} class="animate-spin text-blue-600" />
										Leyendo el comprobante…
									</div>
								{:else if !archivoSunat}
									<div class="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_13rem] gap-4">
										<label
											for="fac-sunat-archivo"
											ondragover={(e) => { e.preventDefault(); arrastrandoSunat = true; }}
											ondragleave={() => (arrastrandoSunat = false)}
											ondrop={(e) => { e.preventDefault(); arrastrandoSunat = false; cargarArchivoSunat(e.dataTransfer?.files?.[0]); }}
											class={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-9 text-center cursor-pointer transition-colors ${arrastrandoSunat ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-slate-50/60 hover:border-blue-400 hover:bg-blue-50/40'}`}
										>
											<span class="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 text-blue-600"><CloudUpload size={22} /></span>
											<span class="text-sm font-semibold text-slate-800">Arrastra y suelta el comprobante aquí</span>
											<span class="text-xs text-blue-600 font-medium">o haz clic para seleccionarlo</span>
											<span class="mt-2 text-[11px] text-slate-400">PDF, JPG, PNG o XML · máximo 20 MB</span>
										</label>
										<div class="flex flex-col gap-2">
											<label for="fac-sunat-archivo" class="flex items-center justify-center gap-2 rounded-lg bg-[#0f3b5e] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#0c3150] cursor-pointer">
												<FolderOpen size={16} /> Seleccionar archivo
											</label>
											<label for="fac-sunat-foto" class="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
												<Camera size={16} /> Tomar foto
											</label>
											<p class="text-[11px] leading-snug text-slate-400">El PDF de SUNAT se lee al instante; las fotos se leen con OCR y conviene revisarlas.</p>
										</div>
									</div>
								{:else}
									<div class="mb-4 flex flex-wrap items-center gap-2">
										<span class="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
											<FileCheck size={14} class="shrink-0" /><span class="truncate" title={archivoSunat.name}>{archivoSunat.name}</span>
										</span>
										{#if metodoLectura}
											<span class="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">Leído con {ETIQUETA_METODO[metodoLectura]}</span>
										{/if}
									</div>

									{#if tipoSunatDistinto}
										<div class="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
											<CircleAlert size={15} class="mt-px shrink-0" />
											<span>El archivo parece una <b>{NOMBRE_TIPO_LEIDO[datosSunat?.tipo ?? '']}</b>, pero estás emitiendo una <b>{nombreDocumento}</b>. Abre el tipo de documento correcto.</span>
										</div>
									{/if}

									<div class="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3">
										<div>
											<label for="fac-sunat-serie" class="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Serie <span class="text-red-500">*</span></label>
											<input id="fac-sunat-serie" type="text" maxlength="4" bind:value={serieSunat} placeholder="E001" class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 uppercase font-medium" />
										</div>
										<div>
											<label for="fac-sunat-numero" class="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Número <span class="text-red-500">*</span></label>
											<input id="fac-sunat-numero" type="text" inputmode="numeric" maxlength="8" bind:value={numeroSunat} placeholder="00000001" class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 font-medium" />
										</div>
										<div>
											<label for="fac-sunat-doc" class="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">RUC / DNI del cliente</label>
											<input id="fac-sunat-doc" type="text" inputmode="numeric" maxlength="11" bind:value={docReceptorSunat} onchange={aplicarClienteSunat} class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
										</div>
										<div>
											<label for="fac-sunat-total" class="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Importe total <span class="text-red-500">*</span></label>
											<input id="fac-sunat-total" type="number" step="0.01" min="0" inputmode="decimal" bind:value={totalSunat} class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 font-semibold text-right" />
										</div>
									</div>

									<dl class="mt-4 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3 rounded-lg bg-slate-50 px-4 py-3">
										<div class="col-span-2">
											<dt class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cliente</dt>
											<dd class="mt-0.5 truncate text-sm text-slate-800" title={datosSunat?.nombre_receptor ?? ''}>{datosSunat?.nombre_receptor ?? '—'}</dd>
										</div>
										<div>
											<dt class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fecha de emisión</dt>
											<dd class="mt-0.5 text-sm text-slate-800">{datosSunat?.fecha_emision ? datosSunat.fecha_emision.split('-').reverse().join('/') : '—'}</dd>
										</div>
										<div>
											<dt class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Moneda</dt>
											<dd class="mt-0.5 text-sm text-slate-800">{datosSunat?.moneda === 'USD' ? 'Dólares (US$)' : datosSunat?.moneda === 'PEN' ? 'Soles (S/)' : '—'}</dd>
										</div>
										<div>
											<dt class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Op. gravada</dt>
											<dd class="mt-0.5 text-sm text-slate-800">{datosSunat?.subtotal != null ? fmt(datosSunat.subtotal) : '—'}</dd>
										</div>
										<div>
											<dt class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">IGV</dt>
											<dd class="mt-0.5 text-sm text-slate-800">{datosSunat?.igv != null ? fmt(datosSunat.igv) : '—'}</dd>
										</div>
										{#if datosSunat?.serie_numero_referencia}
											<div class="col-span-2">
												<dt class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Documento que modifica</dt>
												<dd class="mt-0.5 text-sm text-slate-800">{datosSunat.serie_numero_referencia}</dd>
											</div>
										{/if}
									</dl>

									{#if clienteSunatNoEncontrado}
										<div class="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
											<CircleAlert size={15} class="mt-px shrink-0" />
											<span>No hay ningún cliente con el documento <b>{docReceptorSunat}</b> en el Directorio de Clientes: regístralo o elígelo abajo.</span>
										</div>
									{/if}
									{#if totalSunatNum > 0 && lineas.length > 0}
										{@const cuadra = Math.abs(totales.importeTotal - totalSunatNum) < 0.01}
										<div class={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${cuadra ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
											{#if cuadra}<CircleCheck size={15} class="mt-px shrink-0" />{:else}<CircleAlert size={15} class="mt-px shrink-0" />{/if}
											<span>{cuadra ? 'El importe coincide con' : 'El importe NO coincide con'} las transacciones elegidas ({fmt(totales.importeTotal)}).</span>
										</div>
									{:else}
										<p class="mt-3 text-xs text-slate-500">Elige abajo la(s) transacción(es) de pago que cubre este comprobante: su importe debe coincidir con el total.</p>
									{/if}
								{/if}
							</div>
							<input id="fac-sunat-archivo" type="file" accept={ACEPTA_COMPROBANTE} class="hidden" onchange={(e) => { const el = e.currentTarget as HTMLInputElement; cargarArchivoSunat(el.files?.[0]); el.value = ''; }} />
							<input id="fac-sunat-foto" type="file" accept="image/*" capture="environment" class="hidden" onchange={(e) => { const el = e.currentTarget as HTMLInputElement; cargarArchivoSunat(el.files?.[0]); el.value = ''; }} />
						</section>
					{/if}
				{/if}

				{#if modoRuc}
					<!-- Nota de Crédito "Anulación por Error en el RUC" (pantalla de la imagen del usuario): no lleva
					     transacciones ni detalle propios — anula la Factura indicada (de ahí salen cliente, líneas y
					     monto) y referencia la Nueva Factura emitida con el RUC correcto. -->
					<div class="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] gap-x-6 gap-y-5 items-start mb-6">
						<span class="hidden md:block"></span>
						<div>{#if campoTipoNota}{@render campo(campoTipoNota)}{/if}</div>

						<span class="text-sm font-semibold text-[#0f3b5e] md:pt-2">Fecha de Emisión</span>
						<div class="max-w-[240px]">
							<input
								type="date"
								value={formValues.fecha_emision}
								disabled={soloLectura}
								oninput={(e) => handleInput('fecha_emision', (e.target as HTMLInputElement).value)}
								class={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:bg-slate-100 ${fieldErrors.fecha_emision ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
							/>
							{#if fieldErrors.fecha_emision}<p class="mt-1 text-xs text-red-600">{fieldErrors.fecha_emision}</p>{/if}
						</div>

						<span class="text-sm font-semibold text-[#0f3b5e] md:pt-2">Número de FE respecto de la cual se emite la Nota de Crédito</span>
						<div>
							<div class="flex items-center gap-3">
								<input type="text" maxlength="4" value={refSerie} disabled={soloLectura} oninput={(e) => setFolio('ref', 'serie', (e.target as HTMLInputElement).value)} class="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100" aria-label="Serie de la factura a anular" />
								<input type="text" inputmode="numeric" maxlength="8" placeholder="Número" value={refCorrelativo} disabled={soloLectura} oninput={(e) => setFolio('ref', 'corr', (e.target as HTMLInputElement).value)} onblur={() => resolverReferencia(formValues.folio_referencia)} class={`flex-1 min-w-0 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:bg-slate-100 ${fieldErrors.folio_referencia ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`} aria-label="Número de la factura a anular" />
								<button type="button" onclick={verFacturaReferencia} disabled={cargandoRef} class="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-sm text-[#0f3b5e] hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap">
									<FileText size={15} /> Ver Factura
								</button>
							</div>
							{#if fieldErrors.folio_referencia}
								<p class="mt-1 text-xs text-red-600">{fieldErrors.folio_referencia}</p>
							{:else if refFactura}
								<p class="mt-1 text-xs text-emerald-700">{refFactura.factura.folio} · {refFactura.factura.cliente_nombre ?? ''} · {fmt(Number(refFactura.factura.monto_total))}</p>
							{/if}
						</div>

						<span class="text-sm font-semibold text-[#0f3b5e] md:pt-2">Número de la Nueva Factura Electrónica</span>
						<div>
							<div class="flex items-center gap-3">
								<input type="text" maxlength="4" value={nuevaSerie} disabled={soloLectura} oninput={(e) => setFolio('nueva', 'serie', (e.target as HTMLInputElement).value)} class="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100" aria-label="Serie de la nueva factura" />
								<input type="text" inputmode="numeric" maxlength="8" placeholder="Número" value={nuevaCorrelativo} disabled={soloLectura} oninput={(e) => setFolio('nueva', 'corr', (e.target as HTMLInputElement).value)} class={`flex-1 min-w-0 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:bg-slate-100 ${fieldErrors.folio_nueva_factura ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`} aria-label="Número de la nueva factura" />
								<button type="button" onclick={() => verFacturaPorFolio(formValues.folio_nueva_factura)} class="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-sm text-[#0f3b5e] hover:bg-slate-50 whitespace-nowrap">
									<FileText size={15} /> Ver Factura
								</button>
							</div>
							{#if fieldErrors.folio_nueva_factura}<p class="mt-1 text-xs text-red-600">{fieldErrors.folio_nueva_factura}</p>{/if}
						</div>
					</div>
				{:else if modoDescuentoGlobal || modoDevolucionTotal}
					<!-- Notas de Crédito "Descuento Global" y "Devolución Total" (pantallas de las imágenes del usuario):
					     referencian una Factura emitida (cliente y moneda salen de ella), sin transacciones. Descuento
					     Global pide además los montos; Devolución Total devuelve la factura completa. -->
					<div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5 mb-6">
						<div class="hidden md:block"></div>
						<div>{#if campoTipoNota}{@render campo(campoTipoNota)}{/if}</div>

						<div class="md:col-span-2 max-w-[240px]">
							<label for="fac-dg-fecha" class="block text-sm font-medium text-[#0f3b5e] mb-1">Fecha de Emisión <span class="text-red-500">*</span></label>
							<input
								id="fac-dg-fecha"
								type="date"
								value={formValues.fecha_emision}
								disabled={soloLectura}
								oninput={(e) => handleInput('fecha_emision', (e.target as HTMLInputElement).value)}
								class={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:bg-slate-100 ${fieldErrors.fecha_emision ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`}
							/>
							{#if fieldErrors.fecha_emision}<p class="mt-1 text-xs text-red-600">{fieldErrors.fecha_emision}</p>{/if}
						</div>

						<div class="md:col-span-2">
							<span class="block text-sm font-medium text-[#0f3b5e] mb-1">Número de FE respecto de la cual se emite la Nota de Crédito <span class="text-red-500">*</span></span>
							<div class="flex items-center gap-3 max-w-xl">
								<input type="text" maxlength="4" value={refSerie} disabled={soloLectura} oninput={(e) => setFolio('ref', 'serie', (e.target as HTMLInputElement).value)} class="w-24 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100" aria-label="Serie de la factura" />
								<input type="text" inputmode="numeric" maxlength="8" placeholder="Número" value={refCorrelativo} disabled={soloLectura} oninput={(e) => setFolio('ref', 'corr', (e.target as HTMLInputElement).value)} onblur={() => resolverReferencia(formValues.folio_referencia)} class={`flex-1 min-w-0 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:bg-slate-100 ${fieldErrors.folio_referencia ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-blue-200'}`} aria-label="Número de la factura" />
								<button type="button" onclick={verFacturaReferencia} disabled={cargandoRef} class="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-sm text-[#0f3b5e] hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap">
									<FileText size={15} /> Ver Factura
								</button>
							</div>
							{#if fieldErrors.folio_referencia}
								<p class="mt-1 text-xs text-red-600">{fieldErrors.folio_referencia}</p>
							{:else if refFactura}
								<p class="mt-1 text-xs text-emerald-700">{refFactura.factura.folio} · {refFactura.factura.cliente_nombre ?? ''} · Total {fmt(Number(refFactura.factura.monto_total))}</p>
							{/if}
						</div>

						<div class="md:col-span-2">{#if campoMotivo}{@render campo(campoMotivo)}{/if}</div>

						{#if modoDevolucionTotal}
							{#if refFactura}
								<p class="md:col-span-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">La nota toma las líneas de la factura indicada: <b>{fmt(totales.importeTotal)}</b> ({lineas.length} línea{lineas.length === 1 ? '' : 's'}).</p>
							{/if}
						{:else}
						<div class="md:col-span-2 grid gap-4 max-w-[240px]">
							<div>
								<label for="fac-dg-descuento" class="block text-sm font-medium text-[#0f3b5e] mb-1">Descuento Global <span class="text-red-500">*</span></label>
								<input id="fac-dg-descuento" type="number" min="0" step="0.01" inputmode="decimal" value={descuentoGlobal} disabled={soloLectura} oninput={(e) => onDescuentoGlobalInput((e.target as HTMLInputElement).value)} placeholder="0.00" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100" />
								<p class="mt-1 text-[11px] text-slate-400">Monto del descuento sin IGV.</p>
							</div>
							<div>
								<label for="fac-dg-isc" class="block text-sm font-medium text-[#0f3b5e] mb-1">ISC</label>
								<input id="fac-dg-isc" type="number" min="0" step="0.01" inputmode="decimal" value={iscDescuento} disabled={soloLectura} oninput={(e) => onIscDescuentoInput((e.target as HTMLInputElement).value)} placeholder="0.00" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100" />
							</div>
							<div>
								<label for="fac-dg-igv" class="block text-sm font-medium text-[#0f3b5e] mb-1">IGV</label>
								<input id="fac-dg-igv" type="number" min="0" step="0.01" inputmode="decimal" value={igvDescuento} disabled={soloLectura} oninput={(e) => { igvDescuentoEditado = true; igvDescuento = (e.target as HTMLInputElement).value; }} placeholder="0.00" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100" />
								<p class="mt-1 text-[11px] text-slate-400">Se propone el 18%; puedes cambiarlo.</p>
							</div>
							<div>
								<span class="block text-sm font-medium text-[#0f3b5e] mb-1">Importe total de la nota</span>
								<input type="text" readonly value={fmt(totalesDescuento.importeTotal)} class="w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700" />
							</div>
						</div>
						{/if}
					</div>
				{:else}
				<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
					<div>
						<label for="fac-cliente" class="block text-sm font-medium text-[#0f3b5e] mb-1">Cliente (Señor/es) <span class="text-red-500">*</span></label>
						<SelectConSaldo
							id="fac-cliente"
							value={idCliente}
							options={[
								...(clienteSeleccionado && !clientes.some((c) => c.id_cliente === clienteSeleccionado.id_cliente)
									? [{ value: String(clienteSeleccionado.id_cliente), label: clienteSeleccionado.nombre }]
									: []),
								...clientes.map((c) => ({ value: String(c.id_cliente), label: c.nombre }))
							]}
							placeholder="Selecciona un cliente"
							disabled={mode === 'edit'}
							hasError={!!fieldErrors.id_cliente}
							onchange={(value) => handleClienteChange(value)}
						/>
						{#if fieldErrors.id_cliente}<p class="mt-1 text-xs text-red-600">{fieldErrors.id_cliente}</p>{/if}
					</div>
					<div>
						<span class="block text-sm font-medium text-[#0f3b5e] mb-1">{clienteSeleccionado?.tipo_doc ?? 'RUC'}</span>
						<input type="text" readonly value={clienteSeleccionado?.num_documento ?? ''} class="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-600 cursor-default" />
					</div>
					{#if esNota}
						{#if campoTipoNota}{@render campo(campoTipoNota)}{/if}
					{:else}
					<div>
						<span class="block text-sm font-medium text-[#0f3b5e] mb-1">Dirección del Cliente</span>
						<input type="text" readonly value={clienteSeleccionado?.direccion ?? ''} class="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-600 cursor-default" />
					</div>
					{/if}
				</div>

				{#if esNota}
					<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
						{#if campoFechaEmision}{@render campo(campoFechaEmision)}{/if}
						<div>
							<span class="block text-sm font-medium text-[#0f3b5e] mb-1">Tipo de moneda <span class="text-red-500">*</span></span>
							<input type="text" readonly value={moneda === 'USD' ? 'Dólares (US$)' : 'Soles (S/)'} class="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-600 cursor-default" />
						</div>
						{#if campoMotivo}{@render campo(campoMotivo)}{/if}
					</div>
				{/if}

				<div class="flex items-center justify-between mb-2 flex-wrap gap-2">
					<h3 class="text-sm font-semibold text-[#0f3b5e]">Transacciones del cliente (soportes de pago)</h3>
					<div class="flex items-center gap-3 text-[11px] text-slate-500">
						<span class="flex items-center gap-1.5"><span class="inline-block shrink-0 w-4 h-4 rounded border-2" style={`background:${COLOR_SIN_FACTURA.bg};border-color:${COLOR_SIN_FACTURA.border}`}></span>Sin factura (seleccionable)</span>
						<span class="flex items-center gap-1.5"><span class="inline-block shrink-0 w-4 h-4 rounded border-2" style={`background:${COLOR_FACTURADA.bg};border-color:${COLOR_FACTURADA.border}`}></span>Ya facturada</span>
					</div>
				</div>

				<div class="border border-slate-200 rounded-xl overflow-hidden mb-6">
					<div class="overflow-x-auto">
						<div class="min-w-[760px]">
							<div class="grid grid-cols-[auto_0.9fr_1.1fr_2fr_1.4fr_1fr_auto] gap-3 items-center px-3 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase">
								<span class="w-4"></span>
								<span>Fecha</span>
								<span>Categoría</span>
								<span>Descripción</span>
								<span>Destino</span>
								<span class="text-right">Monto</span>
								<span class="text-center">Soportes</span>
							</div>
							{#each transacciones as t (t.id_transaccion)}
								{@const facturada = t.id_factura != null}
								{@const marcada = seleccion.includes(t.id_transaccion)}
								{@const habilitada = seleccionable(t) && !soloLectura}
								<div
									role="button"
									tabindex="0"
									onclick={() => !soloLectura && toggle(t)}
									onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && !soloLectura && toggle(t)}
									class={`grid grid-cols-[auto_0.9fr_1.1fr_2fr_1.4fr_1fr_auto] gap-3 items-center px-3 py-2.5 border-b last:border-b-0 text-sm ${habilitada ? 'cursor-pointer' : 'cursor-default'} ${!facturada && !habilitada && !marcada ? 'opacity-50' : ''}`}
									style={`background:${facturada ? COLOR_FACTURADA.bg : COLOR_SIN_FACTURA.bg};border-color:${facturada ? COLOR_FACTURADA.border : COLOR_SIN_FACTURA.border};${marcada ? 'box-shadow: inset 3px 0 0 #1d4ed8;' : ''}`}
									title={!facturada && !seleccionable(t) ? 'Solo se pueden facturar juntas transacciones de la misma moneda.' : undefined}
								>
									{#if facturada}
										<!-- Ya facturada: NO se puede seleccionar (sin casilla), solo un candado. -->
										<span class="w-4 h-4 flex items-center justify-center shrink-0 text-emerald-700" title="Ya facturada"><Lock size={14} /></span>
									{:else}
										<span class="w-4 h-4 rounded border flex items-center justify-center shrink-0" style={`border-color:${marcada ? '#1d4ed8' : '#94a3b8'};background:${marcada ? '#1d4ed8' : '#fff'}`}>
											{#if marcada}<Check size={12} class="text-white" />{/if}
										</span>
									{/if}
									<span class="text-slate-700">{t.fecha}</span>
									<span class="text-slate-700 truncate">{t.categoria ?? '—'}</span>
									<span class="text-slate-600 truncate">{t.descripcion ?? '—'}</span>
									<span class="text-slate-600 truncate">
										{t.destinoLabel}
										{#if facturada}<span class="ml-1 inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-700">Facturada · {t.facturaFolio ?? ''}</span>{/if}
									</span>
									<span class="text-right font-semibold text-slate-800">{fmtTransaccion(t)}</span>
									<span class="flex justify-center">
										<button
											type="button"
											onclick={(e) => { e.stopPropagation(); abrirDocumentos(t); }}
											class="p-1.5 rounded-lg text-slate-500 hover:bg-white hover:text-blue-600"
											title="Ver documentos"
											aria-label="Ver documentos"
										>
											<Eye size={16} />
										</button>
									</span>
								</div>
							{:else}
								<p class="px-3 py-8 text-center text-xs text-slate-400">
									{cargandoTransacciones ? 'Cargando transacciones...' : idCliente ? 'Este cliente no tiene transacciones de ingreso registradas.' : 'Elige un cliente para ver sus transacciones.'}
								</p>
							{/each}
						</div>
					</div>
				</div>


				{#if camposGenerales.length > 0}
					<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
						{#each camposGenerales as field (field.key)}
							{@render campo(field)}
						{/each}
					</div>
				{/if}

				{#if sujetaDetraccion}
				<!-- Información de detracción: solo se muestra con "Sujeta a detracción = Sí" (a pedido explícito del usuario; en Nota de Crédito sujetaDetraccion nunca es verdadero). -->
				<div class={`rounded-xl border p-4 mb-4 ${sujetaDetraccion ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50'}`}>
					<h3 class="text-sm font-semibold text-[#0f3b5e] mb-3">Información de detracción</h3>
					<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
						{#each camposRecuadroDetraccion as field (field.key)}
							{@render campo(field)}
						{/each}
					</div>
				</div>

				<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
					{#if campoPorcentaje}{@render campo(campoPorcentaje)}{/if}
					<div>
						<span class="block text-sm font-medium text-[#0f3b5e] mb-1">Monto de detracción (S/) {#if sujetaDetraccion}<span class="text-red-500">*</span>{/if}</span>
						<input type="text" readonly value={sujetaDetraccion ? totales.montoDetraccion.toFixed(2) : ''} class="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-600 cursor-default" />
					</div>
					{#if campoCuenta}{@render campo(campoCuenta)}{/if}
				</div>
				{/if}

				<div class="flex flex-col lg:flex-row gap-4">
					<div class="flex-1 min-w-0">
						{#if esNota}
							<h3 class="text-sm font-semibold text-[#0f3b5e] mb-2">Detalle de la {nombreDocumento.toLowerCase()}</h3>
							<div class="rounded-xl border border-slate-200 overflow-hidden">
								<div class="overflow-x-auto">
									<div class="min-w-[600px]">
										<div class="grid grid-cols-[90px_150px_1fr_130px_36px] gap-3 items-center px-3 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase">
											<span>Cantidad</span>
											<span>Unidad medida</span>
											<span>Descripción</span>
											<span>Valor unitario</span>
											<span></span>
										</div>
										{#each lineas as l (l.id_transaccion)}
											{@const id = l.id_transaccion as number}
											<div class="grid grid-cols-[90px_150px_1fr_130px_36px] gap-3 items-center px-3 py-2 border-b border-slate-100 last:border-b-0">
												<input type="number" min="0" step="any" value={edicionLineas[id]?.cantidad ?? String(l.cantidad)} disabled={soloLectura} oninput={(e) => setEdicion(id, 'cantidad', (e.target as HTMLInputElement).value)} class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100" aria-label="Cantidad" />
												<select value={l.unidad} disabled={soloLectura} onchange={(e) => setEdicion(id, 'unidad', (e.target as HTMLSelectElement).value)} class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100" aria-label="Unidad medida">
													{#each UNIDADES_MEDIDA.includes(l.unidad) ? UNIDADES_MEDIDA : [...UNIDADES_MEDIDA, l.unidad] as u}
														<option value={u}>{u}</option>
													{/each}
												</select>
												<input type="text" maxlength="200" value={l.descripcion} disabled={soloLectura} oninput={(e) => (descripciones = { ...descripciones, [id]: (e.target as HTMLInputElement).value })} class="w-full min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100" aria-label="Descripción" />
												<div class="flex items-center rounded-lg border border-slate-300 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-blue-200">
													<span class="pl-2 text-xs text-slate-400">{moneda === 'USD' ? 'US$' : 'S/'}</span>
													<input type="number" min="0" step="any" value={edicionLineas[id]?.precio ?? String(l.precio_unitario)} disabled={soloLectura} oninput={(e) => setEdicion(id, 'precio', (e.target as HTMLInputElement).value)} class="w-full min-w-0 px-2 py-1.5 text-sm text-right focus:outline-none disabled:bg-slate-100" aria-label="Valor unitario" />
												</div>
												<button type="button" disabled={soloLectura} onclick={() => (seleccion = seleccion.filter((x) => x !== id))} class="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40" title="Quitar línea" aria-label="Quitar línea">
													<Trash2 size={16} />
												</button>
											</div>
										{:else}
											<p class="px-3 py-6 text-center text-xs text-slate-400">Selecciona una transacción arriba para armar el detalle.</p>
										{/each}
									</div>
								</div>
							</div>
							<p class="mt-2 text-xs text-slate-400">El valor unitario va SIN IGV; el resumen suma el 18% de IGV sobre cantidad × valor unitario. Moneda: {moneda === 'USD' ? 'Dólares' : 'Soles'}.</p>
						{:else}
							<div class="text-xs text-slate-400">
								{lineas.length} transacción{lineas.length === 1 ? '' : 'es'} seleccionada{lineas.length === 1 ? '' : 's'} · Moneda: {moneda === 'USD' ? 'Dólares' : 'Soles'} · Los montos de las transacciones ya incluyen IGV.
							</div>
						{/if}
					</div>
					<div class="w-full lg:w-80 shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-4">
						<h3 class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Resumen</h3>
						<div class="flex flex-col gap-1.5 text-sm">
							{#if tipoComprobante === 'comprobante_venta'}
								<!-- Comprobante de Venta: no afecto al IGV (no se desglosa). -->
								<div class="flex justify-between"><span class="text-slate-500">Valor Venta</span><span class="font-medium text-slate-700">{fmt(totales.valorVenta)}</span></div>
								<p class="text-[11px] text-slate-400">No afecto al IGV.</p>
							{:else}
								<div class="flex justify-between"><span class="text-slate-500">Sub Total Ventas</span><span class="font-medium text-slate-700">{fmt(totales.subTotalVentas)}</span></div>
								<div class="flex justify-between"><span class="text-slate-500">Valor Venta</span><span class="font-medium text-slate-700">{fmt(totales.valorVenta)}</span></div>
								<div class="flex justify-between"><span class="text-slate-500">IGV (18%)</span><span class="font-medium text-slate-700">{fmt(totales.igv)}</span></div>
								<div class="flex justify-between"><span class="text-slate-500">Monto de redondeo</span><span class="font-medium text-slate-700">{fmt(totales.redondeo)}</span></div>
							{/if}
							<div class="flex justify-between pt-2 mt-1 border-t border-slate-200 text-base"><span class="font-semibold text-[#0f3b5e]">Importe Total</span><span class="font-bold text-[#0f3b5e]">{fmt(totales.importeTotal)}</span></div>
							{#if sujetaDetraccion}
								<div class="flex justify-between text-xs pt-1"><span class="text-slate-500">Monto de detracción</span><span class="font-medium text-slate-700">{fmt(totales.montoDetraccion)}</span></div>
							{/if}
						</div>
					</div>
				</div>
				{/if}
			</div>

			{#if !soloLectura}
				<div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 flex-shrink-0">
					<button type="button" onclick={onClose} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Cancelar</button>
					<button
						type="button"
						onclick={handleGuardarBorrador}
						disabled={!puedeContinuar || guardando || autorizando}
						class="px-4 py-2 text-sm bg-slate-700 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
					>
						{#if guardando}<Loader2 size={14} class="animate-spin" />{/if} Guardar Borrador
					</button>
					<button
						type="button"
						onclick={handleVistaPrevia}
						disabled={!puedeContinuar || guardando || autorizando}
						class="px-4 py-2 text-sm bg-[#0f3b5e] text-white rounded-lg hover:bg-[#0c2f4c] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
					>
						<Eye size={14} /> Vista previa
					</button>
					<!-- Pedido de la clienta (20/11/2026): botón visible para dejar el documento DEFINITIVO (antes solo estaba
					     dentro de la Vista previa como "Autorizar y emitir"). Mismo proceso: handleAutorizar. -->
					<button
						type="button"
						onclick={() => { if (validarAntesDeContinuar()) confirmarEmision = true; }}
						disabled={!puedeContinuar || guardando || autorizando}
						class="px-4 py-2 text-sm bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
					>
						{#if autorizando}<Loader2 size={14} class="animate-spin" />{:else}<CircleCheck size={14} />{/if} Emitir {nombreDocumento}
					</button>
				</div>
			{:else}
				<div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 flex-shrink-0">
					<button type="button" onclick={onClose} class="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Cerrar</button>
				</div>
			{/if}
		</div>
	</div>

	<FacturaPreviewModal open={previewOpen} datos={previewDatos} onClose={() => (previewOpen = false)} onAutorizar={handleAutorizar} {autorizando} />
	<FacturaPreviewModal open={verFacturaOpen} datos={verFacturaDatos} onClose={() => (verFacturaOpen = false)} />
	<ConfirmModal
		open={confirmarEmision}
		title={`Emitir ${nombreDocumento}`}
		message={`Se emitirá de forma definitiva: se genera el PDF final sin el sello "BORRADOR", se guarda en Drive y las transacciones quedan marcadas como facturadas. Después ya no se podrá editar (solo anular). Importe total: ${fmt(totales.importeTotal)}.`}
		confirmLabel="Emitir"
		danger={false}
		onConfirm={async () => {
			confirmarEmision = false;
			await handleAutorizar();
		}}
		onClose={() => (confirmarEmision = false)}
	/>
	<DocumentPreviewModal open={docsOpen} documents={docsLista} title={docsTitle} onClose={() => (docsOpen = false)} />
{/if}
