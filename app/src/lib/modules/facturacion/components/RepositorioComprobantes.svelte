<script lang="ts">
	/**
	 * Repositorio de comprobantes de INGRESO — sección "Repositorio de comprobantes" de Emisión de
	 * Comprobante (a pedido del usuario, con imagen de referencia). Sube Factura/Boleta/Nota de Crédito/
	 * Nota de Débito (PDF, foto o XML de SUNAT), lee sus datos con OCR + regex (o del XML, exacto), los deja
	 * editar, los vincula a una o varias transacciones de ingreso y un administrador los marca Revisado u
	 * Observado. Servicio: comprobantesIngreso.service.ts; lectura: lectorComprobante.ts + leerTextoComprobante.
	 * Todo con APIs web estándar (input file con capture, drag & drop, canvas, iframe de Drive): funciona igual
	 * en navegador, Tauri Windows y Tauri Android — en Android, "Tomar foto" abre la cámara.
	 */
	import { onMount, onDestroy } from 'svelte';
	import { clientesState, suscribirClientes, opcionesClientes } from '$lib/stores/clientes.svelte';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin, permisosState } from '$lib/stores/permisos.svelte';
	import { toast } from '$lib/stores/toast';
	import { describeError } from '$lib/shared/describeError';
	import { formatCurrency, currencyMask } from '$lib/shared/fieldConfig';
	import { uploadProjectDocument, deleteProjectDocumentFile } from '$lib/shared/uploadProjectDocument';
	import { leerTextoComprobante } from '$lib/shared/ocrComprobante';
	import { renderPdfFirstPageToDataUrl } from '$lib/shared/pdfPreview';
	import { toDrivePreviewUrl } from '$lib/shared/drivePreview';
	import { verifyAdminCredentials } from '$lib/shared/adminAuth';
	import { confirmar } from '$lib/stores/confirmDialog.svelte';
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
	import AdminConfirmModal from '$lib/shared/components/AdminConfirmModal.svelte';
	import DocumentPreviewModal from '$lib/shared/components/DocumentPreviewModal.svelte';
	import {
		UploadCloud, FolderOpen, Camera, FileText, FileImage, FileCode, Files, CheckCircle2, Clock, AlertTriangle,
		Pencil, Save, X, Link2, Unlink, ZoomIn, ZoomOut, RotateCw, Maximize2, Trash2, RotateCcw, Trash, Search,
		ChevronLeft, ChevronRight, Eye, Loader2, ShieldCheck, Undo2
	} from '@lucide/svelte';
	import { extraerDatosDeTexto, leerXmlSunat, camposReconocidos, datosVacios, type DatosComprobanteLeido, type TipoComprobanteIngreso } from '../services/lectorComprobante';
	import { getTransaccionesDelCliente, type TransaccionFacturable } from '../services/facturacion.service';
	import {
		getComprobantesIngreso, getKpisComprobantesIngreso, getEstadisticasMes, getComprobanteIngresoDetalle, getComprobantesReferenciables,
		buscarClientePorDocumento, buscarComprobantePorSerieNumero, crearComprobanteIngreso, actualizarComprobanteIngreso, cambiarEstadoComprobante,
		vincularTransacciones, desvincularTransaccion, darDeBajaComprobanteIngreso, restaurarComprobanteIngreso, eliminarComprobanteIngresoPermanente,
		advertenciasComprobante, serieNumero, NOMBRE_TIPO_COMPROBANTE_INGRESO, esTablaFaltante, MENSAJE_MIGRACION_FALTANTE,
		type ComprobanteIngreso, type ComprobanteIngresoDetalle, type KpisComprobantesIngreso, type EstadisticaTipoMes,
		type EstadoComprobanteIngreso, type ArchivoTipoComprobante, type FuenteDatosComprobante, type CambiosComprobante
	} from '../services/comprobantesIngreso.service';

	const TAMANO_MAXIMO = 20 * 1024 * 1024;
	const ACEPTA = '.pdf,.jpg,.jpeg,.png,.webp,.xml,application/pdf,image/*,text/xml,application/xml';

	const TIPO_OPCIONES = (Object.keys(NOMBRE_TIPO_COMPROBANTE_INGRESO) as TipoComprobanteIngreso[]).map((t) => ({ value: t, label: NOMBRE_TIPO_COMPROBANTE_INGRESO[t] }));
	const TIPO_BADGE: Record<TipoComprobanteIngreso, string> = {
		factura: 'bg-blue-50 text-blue-700 border-blue-200',
		boleta: 'bg-violet-50 text-violet-700 border-violet-200',
		nota_credito: 'bg-orange-50 text-orange-700 border-orange-200',
		nota_debito: 'bg-pink-50 text-pink-700 border-pink-200'
	};
	const ESTADO_BADGE: Record<EstadoComprobanteIngreso, string> = {
		revisado: 'bg-emerald-50 text-emerald-700 border-emerald-200',
		pendiente: 'bg-amber-50 text-amber-700 border-amber-200',
		observado: 'bg-red-50 text-red-700 border-red-200'
	};
	const ESTADO_TEXTO: Record<EstadoComprobanteIngreso, string> = { revisado: 'Revisado', pendiente: 'Pendiente', observado: 'Observado' };

	// ── Lista, KPIs y estadísticas ──────────────────────────────────────────────────────────────────
	let kpis = $state<KpisComprobantesIngreso>({ total: 0, revisados: 0, pendientes: 0, observados: 0, variacionMes: null });
	let estadisticas = $state<EstadisticaTipoMes[]>([]);
	let items = $state<ComprobanteIngreso[]>([]);
	let total = $state(0);
	let pageNum = $state(1);
	let totalPages = $state(1);
	let cargandoLista = $state(true);
	let errorCarga = $state('');
	let verTodos = $state(false);
	let verEliminados = $state(false);
	let filtroTipo = $state<TipoComprobanteIngreso | ''>('');
	let filtroEstado = $state<EstadoComprobanteIngreso | ''>('');
	let busqueda = $state('');
	let busquedaTimer: ReturnType<typeof setTimeout>;

	async function cargarLista() {
		cargandoLista = true;
		try {
			const r = await getComprobantesIngreso(supabase, {
				page: pageNum,
				pageSize: verTodos ? 10 : 5,
				search: busqueda,
				tipo: filtroTipo || null,
				estado: filtroEstado || null,
				soloEliminados: verEliminados
			});
			items = r.items;
			total = r.total;
			totalPages = r.totalPages;
			errorCarga = '';
		} catch (err) {
			errorCarga = esTablaFaltante(err) ? MENSAJE_MIGRACION_FALTANTE : describeError(err);
		} finally {
			cargandoLista = false;
		}
	}

	async function cargarResumen() {
		try {
			[kpis, estadisticas] = await Promise.all([getKpisComprobantesIngreso(supabase), getEstadisticasMes(supabase)]);
		} catch (err) {
			console.warn('[Repositorio] No se pudieron cargar los KPIs:', err);
		}
	}

	async function refrescarTodo() {
		await Promise.all([cargarLista(), cargarResumen()]);
	}

	function porcentaje(parte: number): string {
		return kpis.total ? `${Math.round((parte / kpis.total) * 100)}% del total` : '—';
	}

	function cambiarFiltro() {
		pageNum = 1;
		cargarLista();
	}

	function alBuscar(valor: string) {
		busqueda = valor;
		clearTimeout(busquedaTimer);
		busquedaTimer = setTimeout(cambiarFiltro, 400);
	}

	// ── Catálogos ───────────────────────────────────────────────────────────────────────────────────
	// A pedido del usuario: la lista de clientes es la misma del Directorio de Clientes (solo activos) y se
	// actualiza sola al cambiar — ver $lib/stores/clientes.svelte.ts.
	onDestroy(suscribirClientes());
	let referenciaOptions = $state<{ value: string; label: string }[]>([]);

	onMount(async () => {
		await refrescarTodo();
		try {
			referenciaOptions = await getComprobantesReferenciables(supabase);
		} catch (err) {
			console.warn('[Repositorio] No se pudieron cargar los catálogos:', err);
		}
	});

	// ── Panel derecho: borrador (archivo recién leído, sin guardar) o comprobante guardado ─────────────
	interface Borrador {
		file: File;
		archivoTipo: ArchivoTipoComprobante;
		previewUrl: string | null;
		fuente: FuenteDatosComprobante;
		textoOcr: string | null;
		leidos: DatosComprobanteLeido;
	}
	let borrador = $state<Borrador | null>(null);
	let seleccionado = $state<ComprobanteIngresoDetalle | null>(null);
	let panelTab = $state<'vista' | 'datos' | 'relaciones'>('vista');
	let editando = $state(false);
	let guardando = $state(false);
	let procesando = $state(false);
	let panelEl: HTMLDivElement | undefined = $state();

	type Form = Record<keyof CambiosComprobante, string>;
	function formVacio(): Form {
		return {
			tipo: '', serie: '', numero: '', fecha_emision: '', ruc_emisor: '', razon_social_emisor: '', doc_receptor: '', nombre_receptor: '',
			id_cliente: '', moneda: 'PEN', subtotal: '', igv: '', total: '', id_comprobante_referencia: ''
		};
	}
	let form = $state<Form>(formVacio());
	const clienteOptions = $derived(opcionesClientes([form.id_cliente]));

	const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
	function formDesde(c: Partial<ComprobanteIngreso>): Form {
		return {
			tipo: txt(c.tipo), serie: txt(c.serie), numero: txt(c.numero), fecha_emision: txt(c.fecha_emision), ruc_emisor: txt(c.ruc_emisor),
			razon_social_emisor: txt(c.razon_social_emisor), doc_receptor: txt(c.doc_receptor), nombre_receptor: txt(c.nombre_receptor),
			id_cliente: txt(c.id_cliente), moneda: txt(c.moneda) || 'PEN', subtotal: txt(c.subtotal), igv: txt(c.igv), total: txt(c.total),
			id_comprobante_referencia: txt(c.id_comprobante_referencia)
		};
	}
	function cambiosDesdeForm(f: Form): CambiosComprobante {
		const num = (v: string) => (v.trim() === '' ? null : Number(v));
		return {
			tipo: (f.tipo || null) as TipoComprobanteIngreso,
			serie: f.serie || null,
			numero: f.numero || null,
			fecha_emision: f.fecha_emision || null,
			ruc_emisor: f.ruc_emisor || null,
			razon_social_emisor: f.razon_social_emisor || null,
			doc_receptor: f.doc_receptor || null,
			nombre_receptor: f.nombre_receptor || null,
			id_cliente: f.id_cliente ? Number(f.id_cliente) : null,
			moneda: (f.moneda || 'PEN') as 'PEN' | 'USD',
			subtotal: num(f.subtotal),
			igv: num(f.igv),
			total: num(f.total),
			id_comprobante_referencia: f.id_comprobante_referencia ? Number(f.id_comprobante_referencia) : null
		};
	}

	const formEditable = $derived(!!borrador || editando);
	const esNota = $derived(form.tipo === 'nota_credito' || form.tipo === 'nota_debito');
	const avisos = $derived(advertenciasComprobante(cambiosDesdeForm(form) as Partial<ComprobanteIngreso>));

	function scrollAlPanel() {
		// En pantallas angostas el panel queda debajo de la lista: se lleva a la vista.
		if (typeof window !== 'undefined' && window.innerWidth < 1024) panelEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	// ── Carga de archivo + lectura ─────────────────────────────────────────────────────────────────
	let arrastrando = $state(false);
	let inputArchivo: HTMLInputElement | undefined = $state();
	let inputCamara: HTMLInputElement | undefined = $state();

	function tipoDeArchivo(file: File): ArchivoTipoComprobante | null {
		const nombre = file.name.toLowerCase();
		if (file.type === 'application/pdf' || nombre.endsWith('.pdf')) return 'pdf';
		if (file.type.includes('xml') || nombre.endsWith('.xml')) return 'xml';
		if (file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/.test(nombre)) return 'imagen';
		return null;
	}

	async function procesarArchivo(file: File | null | undefined) {
		if (!file || procesando) return;
		const archivoTipo = tipoDeArchivo(file);
		if (!archivoTipo) {
			toast.error('Formato no permitido. Usa PDF, JPG, PNG o XML.');
			return;
		}
		if (file.size > TAMANO_MAXIMO) {
			toast.error('El archivo supera el tamaño máximo de 20 MB.');
			return;
		}
		procesando = true;
		try {
			let leidos = datosVacios();
			let fuente: FuenteDatosComprobante = 'manual';
			let textoOcr: string | null = null;
			let previewUrl: string | null = null;

			if (archivoTipo === 'xml') {
				leidos = leerXmlSunat(await file.text());
				fuente = 'xml';
			} else {
				previewUrl = archivoTipo === 'pdf' ? await renderPdfFirstPageToDataUrl(file, 1000).catch(() => null) : URL.createObjectURL(file);
				try {
					textoOcr = await leerTextoComprobante(file);
					leidos = extraerDatosDeTexto(textoOcr);
					fuente = camposReconocidos(leidos).encontrados > 0 ? 'ocr' : 'manual';
				} catch (err) {
					console.warn('[Repositorio] Falló el OCR:', err);
					toast.info('No se pudo leer el comprobante automáticamente — completa los datos a mano.');
				}
			}

			const [idCliente, idReferencia] = await Promise.all([
				buscarClientePorDocumento(supabase, leidos.doc_receptor).catch(() => null),
				buscarComprobantePorSerieNumero(supabase, leidos.serie_numero_referencia).catch(() => null)
			]);

			seleccionado = null;
			editando = false;
			borrador = { file, archivoTipo, previewUrl, fuente, textoOcr, leidos };
			form = formDesde({ ...leidos, tipo: leidos.tipo ?? undefined, moneda: leidos.moneda ?? 'PEN', id_cliente: idCliente, id_comprobante_referencia: idReferencia } as Partial<ComprobanteIngreso>);
			panelTab = 'datos';
			const { encontrados, total: posibles } = camposReconocidos(leidos);
			if (fuente !== 'manual') toast.success(`Se reconocieron ${encontrados} de ${posibles} datos principales. Revísalos antes de guardar.`);
			await cargarTransaccionesCliente(true);
			scrollAlPanel();
		} catch (err) {
			toast.error(`No se pudo procesar el archivo. ${describeError(err)}`);
		} finally {
			procesando = false;
		}
	}

	function alSoltar(e: DragEvent) {
		e.preventDefault();
		arrastrando = false;
		procesarArchivo(e.dataTransfer?.files?.[0]);
	}

	function descartarBorrador() {
		if (borrador?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(borrador.previewUrl);
		borrador = null;
		form = formVacio();
		transaccionesCliente = [];
		seleccionTx = new Set();
	}

	async function guardarBorrador() {
		if (!borrador || guardando) return;
		if (!form.tipo) {
			toast.error('Indica el tipo de comprobante.');
			panelTab = 'datos';
			return;
		}
		guardando = true;
		try {
			const { url, fileName } = await uploadProjectDocument(borrador.file, { type: 'comprobante' });
			const cambios = cambiosDesdeForm(form);
			const result = await crearComprobanteIngreso(supabase, {
				datos: { ...datosVacios(), ...cambios, serie_numero_referencia: null, tipo: cambios.tipo!, moneda: cambios.moneda ?? 'PEN', id_cliente: cambios.id_cliente ?? null, id_comprobante_referencia: cambios.id_comprobante_referencia ?? null } as any,
				archivo_url: url,
				archivo_nombre: borrador.file.name || fileName,
				archivo_tipo: borrador.archivoTipo,
				fuente_datos: borrador.fuente,
				texto_ocr: borrador.textoOcr,
				idsTransacciones: [...seleccionTx],
				usuario: permisosState.userName || null
			});
			if (!result.success) {
				// No dejar el archivo huérfano en Drive si el registro no se pudo guardar.
				await deleteProjectDocumentFile(url);
				toast.error(result.message);
				return;
			}
			toast.success(result.message);
			const idNuevo = result.data!.id_comprobante;
			descartarBorrador();
			await refrescarTodo();
			referenciaOptions = await getComprobantesReferenciables(supabase).catch(() => referenciaOptions);
			await abrirComprobante(idNuevo);
		} catch (err) {
			toast.error(`No se pudo guardar el comprobante. ${describeError(err)}`);
		} finally {
			guardando = false;
		}
	}

	// ── Comprobante guardado ────────────────────────────────────────────────────────────────────────
	async function abrirComprobante(id: number) {
		try {
			const detalle = await getComprobanteIngresoDetalle(supabase, id);
			if (!detalle) return toast.error('No se encontró el comprobante.');
			descartarBorrador();
			seleccionado = detalle;
			form = formDesde(detalle);
			editando = false;
			panelTab = 'vista';
			motivoObservacion = '';
			observando = false;
			await cargarTransaccionesCliente(false);
			scrollAlPanel();
		} catch (err) {
			toast.error(`No se pudo abrir el comprobante. ${describeError(err)}`);
		}
	}

	async function guardarEdicion() {
		if (!seleccionado || guardando) return;
		guardando = true;
		try {
			const r = await actualizarComprobanteIngreso(supabase, seleccionado.id_comprobante, cambiosDesdeForm(form));
			if (!r.success) return toast.error(r.message);
			toast.success(r.message);
			await refrescarTodo();
			await abrirComprobante(seleccionado.id_comprobante);
		} finally {
			guardando = false;
		}
	}

	function cancelarEdicion() {
		editando = false;
		if (seleccionado) form = formDesde(seleccionado);
	}

	let observando = $state(false);
	let motivoObservacion = $state('');
	async function cambiarEstado(estado: EstadoComprobanteIngreso) {
		if (!seleccionado) return;
		const r = await cambiarEstadoComprobante(supabase, seleccionado.id_comprobante, estado, { esAdmin: isAdmin(), usuario: permisosState.userName || null, motivo: motivoObservacion });
		if (!r.success) return toast.error(r.message);
		toast.success(r.message);
		observando = false;
		motivoObservacion = '';
		await refrescarTodo();
		await abrirComprobante(seleccionado.id_comprobante);
	}

	// ── Relaciones con transacciones de ingreso ─────────────────────────────────────────────────────
	let transaccionesCliente = $state<TransaccionFacturable[]>([]);
	let cargandoTx = $state(false);
	let seleccionTx = $state<Set<number>>(new Set());

	/** Transacciones de ingreso del cliente elegido. Con `preseleccionar`, marca sola la que tenga el mismo
	 * monto que el total del comprobante (caso típico: una factura por un solo cobro). */
	async function cargarTransaccionesCliente(preseleccionar: boolean) {
		seleccionTx = new Set();
		transaccionesCliente = [];
		if (!form.id_cliente) return;
		cargandoTx = true;
		try {
			transaccionesCliente = await getTransaccionesDelCliente(supabase, Number(form.id_cliente));
			const totalComp = Number(form.total);
			if (preseleccionar && totalComp > 0) {
				const coincide = transaccionesCliente.find((t) => Math.abs(Number(t.monto_total) - totalComp) < 0.01);
				if (coincide) seleccionTx = new Set([coincide.id_transaccion]);
			}
		} catch (err) {
			console.warn('[Repositorio] No se pudieron cargar las transacciones del cliente:', err);
		} finally {
			cargandoTx = false;
		}
	}

	function alternarTx(id: number) {
		const s = new Set(seleccionTx);
		if (s.has(id)) s.delete(id);
		else s.add(id);
		seleccionTx = s;
	}

	const idsVinculados = $derived(new Set((seleccionado?.transacciones ?? []).map((t) => t.id_transaccion)));
	const transaccionesDisponibles = $derived(transaccionesCliente.filter((t) => !idsVinculados.has(t.id_transaccion)));
	const sumaVinculada = $derived(
		(borrador ? transaccionesCliente.filter((t) => seleccionTx.has(t.id_transaccion)) : (seleccionado?.transacciones ?? [])).reduce((s, t) => s + Number(t.monto_total), 0)
	);

	async function vincularSeleccion() {
		if (!seleccionado || seleccionTx.size === 0) return;
		const r = await vincularTransacciones(supabase, seleccionado.id_comprobante, [...seleccionTx]);
		if (!r.success) return toast.error(r.message);
		toast.success(r.message);
		await refrescarTodo();
		await abrirComprobante(seleccionado.id_comprobante);
		panelTab = 'relaciones';
	}

	async function quitarVinculo(idTransaccion: number) {
		if (!seleccionado) return;
		if (!(await confirmar({ title: 'Quitar transacción', message: `¿Desvincular la transacción #${idTransaccion} de este comprobante?`, confirmLabel: 'Quitar' }))) return;
		const r = await desvincularTransaccion(supabase, seleccionado.id_comprobante, idTransaccion);
		if (!r.success) return toast.error(r.message);
		toast.success(r.message);
		await refrescarTodo();
		await abrirComprobante(seleccionado.id_comprobante);
		panelTab = 'relaciones';
	}

	async function alCambiarCliente(valor: string) {
		form.id_cliente = valor;
		const nombre = clienteOptions.find((o) => o.value === valor)?.label;
		if (nombre && !form.nombre_receptor) form.nombre_receptor = nombre;
		await cargarTransaccionesCliente(!!borrador);
	}

	// ── Baja / restaurar / eliminar (patrón dar-de-baja) ────────────────────────────────────────────
	async function darDeBaja(c: ComprobanteIngreso) {
		if (!(await confirmar({ title: 'Dar de baja comprobante', message: `¿Dar de baja ${NOMBRE_TIPO_COMPROBANTE_INGRESO[c.tipo]} ${serieNumero(c)}? Podrá restaurarse desde "Ver eliminados".`, confirmLabel: 'Dar de baja' }))) return;
		const r = await darDeBajaComprobanteIngreso(supabase, c.id_comprobante);
		if (!r.success) return toast.error(r.message);
		toast.success(r.message);
		if (seleccionado?.id_comprobante === c.id_comprobante) seleccionado = null;
		await refrescarTodo();
	}

	async function restaurar(c: ComprobanteIngreso) {
		const r = await restaurarComprobanteIngreso(supabase, c.id_comprobante);
		if (!r.success) return toast.error(r.message);
		toast.success(r.message);
		await refrescarTodo();
	}

	let paraEliminar = $state<ComprobanteIngreso | null>(null);
	async function confirmarEliminar(email: string, password: string) {
		if (!paraEliminar) return;
		const verificacion = await verifyAdminCredentials(email, password);
		if (!verificacion.success) throw new Error(verificacion.message);
		const r = await eliminarComprobanteIngresoPermanente(supabase, paraEliminar.id_comprobante);
		if (!r.success) throw new Error(r.message);
		await deleteProjectDocumentFile(r.data?.archivo_url);
		toast.success(r.message);
		if (seleccionado?.id_comprobante === paraEliminar.id_comprobante) seleccionado = null;
		paraEliminar = null;
		await refrescarTodo();
	}

	function alternarEliminados() {
		verEliminados = !verEliminados;
		verTodos = verEliminados || verTodos;
		pageNum = 1;
		cargarLista();
	}

	// ── Vista previa ────────────────────────────────────────────────────────────────────────────────
	let zoom = $state(1);
	let rotacion = $state(0);
	let previewGrandeOpen = $state(false);
	$effect(() => {
		borrador;
		seleccionado;
		zoom = 1;
		rotacion = 0;
	});

	function iconoArchivo(tipo: ArchivoTipoComprobante) {
		return tipo === 'xml' ? FileCode : tipo === 'imagen' ? FileImage : FileText;
	}

	function formatFecha(iso: string | null | undefined): string {
		if (!iso) return '—';
		const [y, m, d] = iso.slice(0, 10).split('-');
		return y && m && d ? `${d}/${m}/${y}` : '—';
	}

	function montoConMoneda(monto: number | null | undefined, moneda: string | null | undefined): string {
		if (monto === null || monto === undefined) return '—';
		if (moneda === 'USD') return `US$ ${Number(monto).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
		return formatCurrency(monto);
	}

	const DATOS_EXTRAIDOS: { key: keyof DatosComprobanteLeido; label: string }[] = [
		{ key: 'tipo', label: 'Tipo' },
		{ key: 'serie', label: 'Serie' },
		{ key: 'numero', label: 'Número' },
		{ key: 'fecha_emision', label: 'Fecha de emisión' },
		{ key: 'ruc_emisor', label: 'RUC emisor' },
		{ key: 'razon_social_emisor', label: 'Razón social emisor' },
		{ key: 'doc_receptor', label: 'RUC/DNI cliente' },
		{ key: 'nombre_receptor', label: 'Cliente' },
		{ key: 'moneda', label: 'Moneda' },
		{ key: 'subtotal', label: 'Subtotal' },
		{ key: 'igv', label: 'IGV' },
		{ key: 'total', label: 'Total' },
		{ key: 'serie_numero_referencia', label: 'Documento que modifica' }
	];
	function valorLeido(d: DatosComprobanteLeido, key: keyof DatosComprobanteLeido): string {
		const v = d[key];
		if (v === null || v === undefined || v === '') return '';
		if (key === 'tipo') return NOMBRE_TIPO_COMPROBANTE_INGRESO[v as TipoComprobanteIngreso];
		if (key === 'fecha_emision') return formatFecha(String(v));
		if (key === 'subtotal' || key === 'igv' || key === 'total') return montoConMoneda(Number(v), d.moneda);
		return String(v);
	}
	/** Para un comprobante guardado, "Datos extraídos" muestra lo que quedó registrado (el texto OCR crudo
	 * se ve aparte). */
	const datosParaMostrar = $derived.by((): DatosComprobanteLeido | null => {
		if (borrador) return borrador.leidos;
		if (!seleccionado) return null;
		return { ...datosVacios(), ...seleccionado, serie_numero_referencia: seleccionado.referenciaSerieNumero } as DatosComprobanteLeido;
	});
	const fuenteActual = $derived(borrador?.fuente ?? seleccionado?.fuente_datos ?? 'manual');
	const textoOcrActual = $derived(borrador?.textoOcr ?? seleccionado?.texto_ocr ?? null);
</script>

<!-- KPIs -->
<div class="grid grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4 mb-4">
	{#each [
		{ label: 'Total documentos', valor: kpis.total, pie: kpis.variacionMes === null ? 'Este mes' : `${kpis.variacionMes >= 0 ? '+' : ''}${kpis.variacionMes}% este mes`, pieClase: kpis.variacionMes !== null && kpis.variacionMes < 0 ? 'text-red-600' : 'text-emerald-600', icono: Files, clase: 'bg-blue-100 text-blue-600' },
		{ label: 'Revisados', valor: kpis.revisados, pie: porcentaje(kpis.revisados), pieClase: 'text-emerald-600', icono: CheckCircle2, clase: 'bg-emerald-100 text-emerald-600' },
		{ label: 'Pendientes', valor: kpis.pendientes, pie: porcentaje(kpis.pendientes), pieClase: 'text-amber-600', icono: Clock, clase: 'bg-amber-100 text-amber-600' },
		{ label: 'Observados', valor: kpis.observados, pie: porcentaje(kpis.observados), pieClase: 'text-red-600', icono: AlertTriangle, clase: 'bg-red-100 text-red-600' }
	] as k (k.label)}
		<div class="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
			<div class={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${k.clase}`}><k.icono size={20} /></div>
			<div class="min-w-0">
				<p class="text-xs font-semibold text-slate-500">{k.label}</p>
				<p class="text-2xl font-bold text-slate-800 leading-tight">{k.valor.toLocaleString('es-PE')}</p>
				<p class={`text-[11px] font-medium ${k.pieClase}`}>{k.pie}</p>
			</div>
		</div>
	{/each}
</div>

<div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] gap-4 items-start">
	<!-- Columna izquierda -->
	<div class="space-y-4 min-w-0">
		<!-- Cargar nuevo comprobante -->
		{#if !verEliminados}
			<div class="bg-white rounded-xl border border-slate-200 p-4">
				<h3 class="text-sm font-bold text-[#0f3b5e] mb-3">Cargar nuevo comprobante</h3>
				<div class="flex flex-col md:flex-row gap-3">
					<div
						role="button"
						tabindex="0"
						class={`flex-1 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors cursor-pointer ${arrastrando ? 'border-blue-500 bg-blue-50' : 'border-blue-300 bg-blue-50/40 hover:bg-blue-50'}`}
						ondragover={(e) => { e.preventDefault(); arrastrando = true; }}
						ondragleave={() => (arrastrando = false)}
						ondrop={alSoltar}
						onclick={() => inputArchivo?.click()}
						onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && inputArchivo?.click()}
					>
						{#if procesando}
							<Loader2 size={36} class="mx-auto text-blue-500 animate-spin" />
							<p class="mt-2 text-sm font-medium text-slate-600">Leyendo el comprobante…</p>
						{:else}
							<UploadCloud size={40} class="mx-auto text-blue-500" />
							<p class="mt-2 text-sm font-semibold text-slate-700">Arrastra y suelta tu archivo aquí</p>
							<p class="text-xs text-blue-600">o selecciona un archivo</p>
						{/if}
						<p class="mt-3 text-[11px] text-slate-400">Formatos permitidos: PDF, JPG, PNG, XML · Tamaño máximo: 20 MB</p>
					</div>
					<div class="flex md:flex-col gap-2 md:w-48">
						<button type="button" disabled={procesando} onclick={() => inputArchivo?.click()} class="flex-1 md:flex-none flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-[#0f3b5e] text-white text-sm font-medium hover:bg-[#0c2f4c] disabled:opacity-60">
							<FolderOpen size={16} /> Seleccionar archivo
						</button>
						<button type="button" disabled={procesando} onclick={() => inputCamara?.click()} class="flex-1 md:flex-none flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-60">
							<Camera size={16} /> Tomar foto
						</button>
						<p class="hidden md:block text-[11px] text-slate-400 leading-snug">En el celular, "Tomar foto" abre la cámara.</p>
					</div>
				</div>
				<input bind:this={inputArchivo} type="file" accept={ACEPTA} class="hidden" onchange={(e) => { const i = e.target as HTMLInputElement; procesarArchivo(i.files?.[0]); i.value = ''; }} />
				<input bind:this={inputCamara} type="file" accept="image/*" capture="environment" class="hidden" onchange={(e) => { const i = e.target as HTMLInputElement; procesarArchivo(i.files?.[0]); i.value = ''; }} />
			</div>
		{/if}

		<!-- Documentos -->
		<div class="bg-white rounded-xl border border-slate-200">
			<div class="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-3">
				<h3 class="text-sm font-bold text-[#0f3b5e] flex items-center gap-2">
					{verEliminados ? 'Comprobantes eliminados' : verTodos ? 'Todos los comprobantes' : 'Documentos recientes'}
					{#if verEliminados}<span class="text-[10px] font-bold px-2 py-0.5 rounded-md bg-rose-50 text-rose-600 border border-rose-200 uppercase">Solo administradores</span>{/if}
				</h3>
				<div class="flex items-center gap-3">
					{#if isAdmin()}
						<button type="button" onclick={alternarEliminados} class="text-xs font-medium text-slate-500 hover:text-slate-700 flex items-center gap-1">
							{#if verEliminados}<ChevronLeft size={14} /> Volver{:else}<Trash2 size={14} /> Ver eliminados{/if}
						</button>
					{/if}
					{#if !verEliminados}
						<button type="button" onclick={() => { verTodos = !verTodos; pageNum = 1; cargarLista(); }} class="text-xs font-semibold text-blue-600 hover:text-blue-700">
							{verTodos ? 'Ver menos' : 'Ver todos'}
						</button>
					{/if}
				</div>
			</div>

			{#if verTodos}
				<div class="flex flex-wrap items-center gap-2 px-4 pb-3">
					<div class="relative flex-1 min-w-[180px]">
						<Search size={14} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
						<input type="text" value={busqueda} oninput={(e) => alBuscar((e.target as HTMLInputElement).value)} placeholder="Buscar serie, número o cliente..." class="w-full pl-8 pr-2 py-1.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
					</div>
					<div class="w-44">
						<SelectConSaldo value={filtroTipo} options={[{ value: '', label: 'Todos los tipos' }, ...TIPO_OPCIONES]} onchange={(v) => { filtroTipo = v as TipoComprobanteIngreso | ''; cambiarFiltro(); }} />
					</div>
					<div class="w-40">
						<SelectConSaldo value={filtroEstado} options={[{ value: '', label: 'Todos los estados' }, { value: 'pendiente', label: 'Pendiente' }, { value: 'revisado', label: 'Revisado' }, { value: 'observado', label: 'Observado' }]} onchange={(v) => { filtroEstado = v as EstadoComprobanteIngreso | ''; cambiarFiltro(); }} />
					</div>
				</div>
			{/if}

			{#if errorCarga}
				<p class="mx-4 mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{errorCarga}</p>
			{/if}

			<!-- Escritorio -->
			<div class="hidden md:block overflow-x-auto">
				<table class="w-full min-w-[640px] text-sm">
					<thead>
						<tr class="border-y border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-600">
							<th class="text-left px-4 py-2">Documento</th>
							<th class="text-left px-3 py-2">Cliente</th>
							<th class="text-left px-3 py-2">Tipo</th>
							<th class="text-left px-3 py-2">Fecha</th>
							<th class="text-right px-3 py-2">Total</th>
							<th class="text-left px-3 py-2">Estado</th>
							<th class="px-3 py-2"></th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each items as c (c.id_comprobante)}
							{@const Icono = iconoArchivo(c.archivo_tipo)}
							<tr class={`cursor-pointer hover:bg-slate-50 ${seleccionado?.id_comprobante === c.id_comprobante ? 'bg-blue-50 hover:bg-blue-50' : ''}`} onclick={() => abrirComprobante(c.id_comprobante)}>
								<td class="px-4 py-2.5">
									<div class="flex items-center gap-2.5">
										<Icono size={18} class={c.archivo_tipo === 'xml' ? 'text-emerald-600 shrink-0' : c.archivo_tipo === 'imagen' ? 'text-sky-600 shrink-0' : 'text-red-500 shrink-0'} />
										<div class="min-w-0">
											<p class="font-semibold text-slate-800 whitespace-nowrap">{serieNumero(c)}</p>
											<p class="text-[11px] text-slate-400 truncate max-w-[160px]" title={c.archivo_nombre ?? ''}>{c.archivo_nombre ?? ''}</p>
										</div>
									</div>
								</td>
								<td class="px-3 py-2.5">
									<p class="text-[13px] text-slate-700 leading-snug [overflow-wrap:break-word]">{c.cliente?.nombre ?? c.nombre_receptor ?? '—'}</p>
									<p class="text-[11px] text-slate-400">{c.doc_receptor ?? ''}</p>
								</td>
								<td class="px-3 py-2.5"><span class={`inline-block whitespace-nowrap px-2 py-0.5 rounded-md border text-[11px] font-medium ${TIPO_BADGE[c.tipo]}`}>{NOMBRE_TIPO_COMPROBANTE_INGRESO[c.tipo]}</span></td>
								<td class="px-3 py-2.5 whitespace-nowrap text-slate-600">{formatFecha(c.fecha_emision)}</td>
								<td class="px-3 py-2.5 whitespace-nowrap text-right font-semibold text-slate-800">{c.tipo === 'nota_credito' && c.total ? '-' : ''}{montoConMoneda(c.total, c.moneda)}</td>
								<td class="px-3 py-2.5"><span class={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-medium ${ESTADO_BADGE[c.estado]}`}>{ESTADO_TEXTO[c.estado]}</span></td>
								<td class="px-3 py-2.5 text-right whitespace-nowrap">
									{#if verEliminados}
										<button type="button" onclick={(e) => { e.stopPropagation(); restaurar(c); }} class="p-1.5 rounded-lg text-slate-500 hover:bg-emerald-50 hover:text-emerald-600" title="Restaurar"><RotateCcw size={15} /></button>
										<button type="button" onclick={(e) => { e.stopPropagation(); paraEliminar = c; }} class="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600" title="Eliminar permanentemente"><Trash size={15} /></button>
									{:else}
										<button type="button" onclick={(e) => { e.stopPropagation(); abrirComprobante(c.id_comprobante); }} class="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-[#0f3b5e]" title="Ver"><Eye size={15} /></button>
										<button type="button" onclick={(e) => { e.stopPropagation(); darDeBaja(c); }} class="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600" title="Dar de baja"><Trash2 size={15} /></button>
									{/if}
								</td>
							</tr>
						{:else}
							<tr><td colspan="7" class="px-4 py-8 text-center text-sm text-slate-400">{cargandoLista ? 'Cargando…' : verEliminados ? 'No hay comprobantes eliminados.' : 'Aún no hay comprobantes. Sube el primero arriba.'}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Celular -->
			<div class="md:hidden divide-y divide-slate-100 border-t border-slate-100">
				{#each items as c (c.id_comprobante)}
					<div role="button" tabindex="0" class={`px-4 py-3 ${seleccionado?.id_comprobante === c.id_comprobante ? 'bg-blue-50' : ''}`} onclick={() => abrirComprobante(c.id_comprobante)} onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && abrirComprobante(c.id_comprobante)}>
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="font-semibold text-slate-800">{serieNumero(c)}</p>
								<p class="text-[12px] text-slate-600 [overflow-wrap:break-word]">{c.cliente?.nombre ?? c.nombre_receptor ?? '—'}</p>
								<p class="text-[11px] text-slate-400">{formatFecha(c.fecha_emision)}</p>
							</div>
							<div class="text-right shrink-0">
								<p class="font-bold text-slate-800 text-sm">{montoConMoneda(c.total, c.moneda)}</p>
								<div class="mt-1 flex justify-end gap-1">
									<span class={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${TIPO_BADGE[c.tipo]}`}>{NOMBRE_TIPO_COMPROBANTE_INGRESO[c.tipo]}</span>
									<span class={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${ESTADO_BADGE[c.estado]}`}>{ESTADO_TEXTO[c.estado]}</span>
								</div>
							</div>
						</div>
						{#if verEliminados}
							<div class="mt-2 flex gap-2">
								<button type="button" onclick={(e) => { e.stopPropagation(); restaurar(c); }} class="flex-1 h-9 rounded-lg border border-slate-200 text-emerald-600 text-xs font-medium flex items-center justify-center gap-1.5"><RotateCcw size={13} /> Restaurar</button>
								<button type="button" onclick={(e) => { e.stopPropagation(); paraEliminar = c; }} class="flex-1 h-9 rounded-lg border border-slate-200 text-rose-600 text-xs font-medium flex items-center justify-center gap-1.5"><Trash size={13} /> Eliminar</button>
							</div>
						{/if}
					</div>
				{:else}
					<p class="px-4 py-8 text-center text-sm text-slate-400">{cargandoLista ? 'Cargando…' : 'Aún no hay comprobantes.'}</p>
				{/each}
			</div>

			{#if verTodos && totalPages > 1}
				<div class="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-xs text-slate-500">
					<span>{total} comprobante{total === 1 ? '' : 's'} · Página {pageNum} de {totalPages}</span>
					<div class="flex gap-1">
						<button type="button" disabled={pageNum <= 1} onclick={() => { pageNum -= 1; cargarLista(); }} class="p-1.5 rounded-lg border border-slate-300 disabled:opacity-40"><ChevronLeft size={14} /></button>
						<button type="button" disabled={pageNum >= totalPages} onclick={() => { pageNum += 1; cargarLista(); }} class="p-1.5 rounded-lg border border-slate-300 disabled:opacity-40"><ChevronRight size={14} /></button>
					</div>
				</div>
			{/if}
		</div>

		<!-- Estadísticas del mes -->
		{#if !verEliminados}
			<div class="bg-white rounded-xl border border-slate-200 p-4">
				<h3 class="text-sm font-bold text-[#0f3b5e] mb-3">Estadísticas del mes</h3>
				<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
					{#each estadisticas as e (e.tipo)}
						<div class={`rounded-lg border px-3 py-2.5 ${TIPO_BADGE[e.tipo]}`}>
							<p class="text-[11px] font-semibold">{NOMBRE_TIPO_COMPROBANTE_INGRESO[e.tipo]}</p>
							<p class="text-lg font-bold leading-tight">{e.cantidad}</p>
							<p class="text-[11px] opacity-80">{formatCurrency(e.monto)}</p>
						</div>
					{/each}
				</div>
				<p class="mt-2 text-[11px] text-slate-400">Por fecha de emisión del mes en curso. Las notas de crédito restan.</p>
			</div>
		{/if}
	</div>

	<!-- Panel derecho -->
	<div bind:this={panelEl} class="bg-white rounded-xl border border-slate-200 lg:sticky lg:top-20 min-w-0">
		{#if !borrador && !seleccionado}
			<div class="px-6 py-16 text-center text-slate-400">
				<FileText size={40} class="mx-auto mb-3 text-slate-300" />
				<p class="text-sm font-medium text-slate-500">Sube un comprobante o elige uno de la lista</p>
				<p class="text-xs mt-1">Aquí verás su vista previa, los datos leídos y las transacciones vinculadas.</p>
			</div>
		{:else}
			<!-- Pestañas -->
			<div class="flex border-b border-slate-200 px-2">
				{#each [{ k: 'vista', l: 'Vista previa' }, { k: 'datos', l: 'Datos extraídos' }, { k: 'relaciones', l: 'Relaciones' }] as t (t.k)}
					<button type="button" onclick={() => (panelTab = t.k as typeof panelTab)} class={`flex-1 px-2 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${panelTab === t.k ? 'border-[#0f3b5e] text-[#0f3b5e]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
						{t.l}{#if t.k === 'relaciones'} <span class="text-xs text-slate-400">({borrador ? seleccionTx.size : (seleccionado?.transacciones.length ?? 0)})</span>{/if}
					</button>
				{/each}
			</div>

			<div class="p-4 space-y-4">
				{#if borrador}
					<div class="flex items-center justify-between gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
						<span>Sin guardar · {borrador.fuente === 'xml' ? 'datos leídos del XML' : borrador.fuente === 'ocr' ? 'datos leídos con OCR' : 'completa los datos a mano'}</span>
					</div>
				{:else if seleccionado}
					<div class="flex items-center justify-between gap-2">
						<div class="min-w-0">
							<p class="font-bold text-slate-800">{NOMBRE_TIPO_COMPROBANTE_INGRESO[seleccionado.tipo]} {serieNumero(seleccionado)}</p>
							<p class="text-[11px] text-slate-400">Subido por {seleccionado.usuario_registro ?? '—'} · {formatFecha(seleccionado.created_at)}</p>
						</div>
						<span class={`shrink-0 px-2 py-0.5 rounded-md border text-[11px] font-medium ${ESTADO_BADGE[seleccionado.estado]}`}>{ESTADO_TEXTO[seleccionado.estado]}</span>
					</div>
					{#if seleccionado.estado === 'observado' && seleccionado.motivo_observacion}
						<p class="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700"><b>Observación:</b> {seleccionado.motivo_observacion}{seleccionado.revisado_por ? ` — ${seleccionado.revisado_por}` : ''}</p>
					{/if}
				{/if}

				{#if panelTab === 'vista'}
					{@const esXml = (borrador?.archivoTipo ?? seleccionado?.archivo_tipo) === 'xml'}
					<div class="rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
						{#if esXml}
							<div class="p-6 text-center">
								<FileCode size={40} class="mx-auto text-emerald-600" />
								<p class="mt-2 text-sm font-semibold text-slate-700">Comprobante electrónico (XML SUNAT)</p>
								<p class="text-xs text-slate-500">{borrador?.file.name ?? seleccionado?.archivo_nombre}</p>
								<p class="mt-2 text-xs text-slate-400">El XML no tiene vista previa: sus datos exactos están en "Datos extraídos".</p>
							</div>
						{:else if borrador?.previewUrl}
							<div class="h-[420px] overflow-auto flex items-start justify-center bg-white">
								<img src={borrador.previewUrl} alt="Vista previa del comprobante" class="max-w-none origin-top transition-transform" style={`width:${zoom * 100}%;transform:rotate(${rotacion}deg)`} />
							</div>
						{:else if seleccionado}
							<iframe src={toDrivePreviewUrl(seleccionado.archivo_url)} title="Vista previa del comprobante" class="w-full h-[420px] bg-white" allow="autoplay"></iframe>
						{:else}
							<p class="p-6 text-center text-sm text-slate-400">Sin vista previa.</p>
						{/if}
					</div>
					<div class="flex items-center justify-between text-slate-500">
						{#if borrador?.previewUrl}
							<div class="flex items-center gap-1">
								<button type="button" onclick={() => (zoom = Math.max(0.5, zoom - 0.25))} class="p-1.5 rounded-lg hover:bg-slate-100" title="Alejar"><ZoomOut size={16} /></button>
								<span class="text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
								<button type="button" onclick={() => (zoom = Math.min(3, zoom + 0.25))} class="p-1.5 rounded-lg hover:bg-slate-100" title="Acercar"><ZoomIn size={16} /></button>
							</div>
							<button type="button" onclick={() => (rotacion = (rotacion + 90) % 360)} class="p-1.5 rounded-lg hover:bg-slate-100" title="Girar"><RotateCw size={16} /></button>
						{:else}
							<span></span>
						{/if}
						{#if seleccionado}
							<button type="button" onclick={() => (previewGrandeOpen = true)} class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-100" title="Ver en grande / descargar"><Maximize2 size={15} /> Ver en grande</button>
						{/if}
					</div>
				{:else if panelTab === 'datos' && datosParaMostrar}
					{@const conteo = camposReconocidos(datosParaMostrar)}
					<div class="flex items-center justify-between text-xs">
						<span class="text-slate-500">Origen: <b class="text-slate-700">{fuenteActual === 'xml' ? 'XML (exacto)' : fuenteActual === 'ocr' ? 'OCR + regex' : 'Manual'}</b></span>
						<span class={conteo.encontrados >= 6 ? 'text-emerald-600' : conteo.encontrados >= 3 ? 'text-amber-600' : 'text-red-600'}>{conteo.encontrados} de {conteo.total} datos principales</span>
					</div>
					<div class="rounded-lg border border-slate-200 divide-y divide-slate-100">
						{#each DATOS_EXTRAIDOS as campo (campo.key)}
							{@const v = valorLeido(datosParaMostrar, campo.key)}
							<div class="flex items-start justify-between gap-3 px-3 py-1.5 text-sm">
								<span class="text-slate-500 shrink-0">{campo.label}</span>
								{#if v}<span class="text-right font-medium text-slate-800 [overflow-wrap:break-word] min-w-0">{v}</span>{:else}<span class="text-slate-300 text-xs">No reconocido</span>{/if}
							</div>
						{/each}
					</div>
					{#if textoOcrActual}
						<details class="text-xs">
							<summary class="cursor-pointer text-slate-500 hover:text-slate-700">Ver texto leído por OCR</summary>
							<pre class="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">{textoOcrActual}</pre>
						</details>
					{/if}
				{:else if panelTab === 'relaciones'}
					{#if !form.id_cliente}
						<p class="rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">Elige el <b>Cliente</b> en Información General para ver sus transacciones de ingreso.</p>
					{:else}
						{#if seleccionado}
							<div>
								<p class="text-xs font-semibold text-slate-500 mb-1.5">Transacciones vinculadas</p>
								{#each seleccionado.transacciones as t (t.id_transaccion)}
									<div class="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 mb-1.5 text-sm">
										<div class="min-w-0">
											<p class="font-medium text-slate-700">#{t.id_transaccion} · {formatFecha(t.fecha)} · {t.categoria ?? '—'}</p>
											<p class="text-[11px] text-slate-400 [overflow-wrap:break-word]">{t.destinoLabel}</p>
										</div>
										<span class="shrink-0 font-semibold text-slate-800">{formatCurrency(t.monto_total)}</span>
										<button type="button" onclick={() => quitarVinculo(t.id_transaccion)} class="shrink-0 p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600" title="Quitar"><Unlink size={14} /></button>
									</div>
								{:else}
									<p class="text-xs text-slate-400 mb-2">Ninguna todavía.</p>
								{/each}
							</div>
						{/if}
						<div>
							<p class="text-xs font-semibold text-slate-500 mb-1.5">{borrador ? 'Transacciones de ingreso del cliente' : 'Vincular más transacciones'}</p>
							{#if cargandoTx}
								<p class="text-xs text-slate-400">Cargando…</p>
							{:else}
								{#each borrador ? transaccionesCliente : transaccionesDisponibles as t (t.id_transaccion)}
									<label class="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2 mb-1.5 text-sm cursor-pointer hover:bg-slate-50">
										<input type="checkbox" checked={seleccionTx.has(t.id_transaccion)} onchange={() => alternarTx(t.id_transaccion)} class="shrink-0" />
										<div class="min-w-0 flex-1">
											<p class="font-medium text-slate-700">#{t.id_transaccion} · {formatFecha(t.fecha)} · {t.categoria ?? '—'}</p>
											<p class="text-[11px] text-slate-400 [overflow-wrap:break-word]">{t.destinoLabel}</p>
										</div>
										<span class="shrink-0 font-semibold text-slate-800">{formatCurrency(t.monto_total)}</span>
									</label>
								{:else}
									<p class="text-xs text-slate-400">No hay transacciones de ingreso {borrador ? '' : 'pendientes de vincular '}para este cliente.</p>
								{/each}
								{#if seleccionado && seleccionTx.size > 0}
									<button type="button" onclick={vincularSeleccion} class="mt-1 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-medium hover:bg-[#0c2f4c]"><Link2 size={15} /> Vincular {seleccionTx.size}</button>
								{/if}
							{/if}
						</div>
						{#if form.total}
							<p class={`text-xs ${Math.abs(sumaVinculada - Number(form.total)) < 0.01 ? 'text-emerald-600' : 'text-slate-500'}`}>
								Transacciones {borrador ? 'marcadas' : 'vinculadas'}: <b>{formatCurrency(sumaVinculada)}</b> de {formatCurrency(Number(form.total))} del comprobante.
							</p>
						{/if}
					{/if}
				{/if}
			</div>

			<!-- Información General -->
			<div class="border-t border-slate-200 p-4 space-y-3">
				<div class="flex items-center justify-between">
					<h3 class="text-sm font-bold text-[#0f3b5e]">Información general</h3>
					{#if seleccionado && !editando}
						<button type="button" onclick={() => (editando = true)} class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-300 text-xs font-medium text-slate-600 hover:bg-slate-50"><Pencil size={13} /> Editar</button>
					{/if}
				</div>

				{#if avisos.length}
					<ul class="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 space-y-0.5">
						{#each avisos as a}<li class="flex gap-1.5"><AlertTriangle size={13} class="shrink-0 mt-px" />{a}</li>{/each}
					</ul>
				{/if}

				<div class="grid grid-cols-2 gap-x-3 gap-y-2.5">
					<div class="col-span-2">
						<span class="block text-xs font-semibold text-slate-500 mb-1">Tipo de documento *</span>
						<SelectConSaldo value={form.tipo} options={TIPO_OPCIONES} disabled={!formEditable} placeholder="Selecciona el tipo" onchange={(v) => (form.tipo = v)} />
					</div>
					<label class="block">
						<span class="block text-xs font-semibold text-slate-500 mb-1">Serie</span>
						<input type="text" maxlength="4" value={form.serie} disabled={!formEditable} oninput={(e) => (form.serie = (e.target as HTMLInputElement).value.toUpperCase())} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-600" />
					</label>
					<label class="block">
						<span class="block text-xs font-semibold text-slate-500 mb-1">Número</span>
						<input type="text" inputmode="numeric" maxlength="8" value={form.numero} disabled={!formEditable} oninput={(e) => (form.numero = (e.target as HTMLInputElement).value.replace(/\D/g, ''))} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-600" />
					</label>
					<label class="block">
						<span class="block text-xs font-semibold text-slate-500 mb-1">Fecha de emisión</span>
						<input type="date" value={form.fecha_emision} disabled={!formEditable} oninput={(e) => (form.fecha_emision = (e.target as HTMLInputElement).value)} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-600" />
					</label>
					<div>
						<span class="block text-xs font-semibold text-slate-500 mb-1">Moneda</span>
						<SelectConSaldo value={form.moneda} options={[{ value: 'PEN', label: 'Soles (PEN)' }, { value: 'USD', label: 'Dólares (USD)' }]} disabled={!formEditable} onchange={(v) => (form.moneda = v)} />
					</div>
					<label class="block">
						<span class="block text-xs font-semibold text-slate-500 mb-1">RUC emisor</span>
						<input type="text" inputmode="numeric" maxlength="11" value={form.ruc_emisor} disabled={!formEditable} oninput={(e) => (form.ruc_emisor = (e.target as HTMLInputElement).value.replace(/\D/g, ''))} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-600" />
					</label>
					<label class="block">
						<span class="block text-xs font-semibold text-slate-500 mb-1">Razón social emisor</span>
						<input type="text" value={form.razon_social_emisor} disabled={!formEditable} oninput={(e) => (form.razon_social_emisor = (e.target as HTMLInputElement).value)} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-600" />
					</label>
					<div class="col-span-2">
						<span class="block text-xs font-semibold text-slate-500 mb-1">Cliente</span>
						<SelectConSaldo value={form.id_cliente} options={clienteOptions} disabled={!formEditable} placeholder="Selecciona el cliente" onchange={alCambiarCliente} />
					</div>
					<label class="block">
						<span class="block text-xs font-semibold text-slate-500 mb-1">RUC/DNI cliente</span>
						<input type="text" inputmode="numeric" maxlength="11" value={form.doc_receptor} disabled={!formEditable} oninput={(e) => (form.doc_receptor = (e.target as HTMLInputElement).value.replace(/\D/g, ''))} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-600" />
					</label>
					<label class="block">
						<span class="block text-xs font-semibold text-slate-500 mb-1">Nombre en el comprobante</span>
						<input type="text" value={form.nombre_receptor} disabled={!formEditable} oninput={(e) => (form.nombre_receptor = (e.target as HTMLInputElement).value)} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-600" />
					</label>
					{#each [{ k: 'subtotal', l: 'Subtotal' }, { k: 'igv', l: 'IGV' }] as m (m.k)}
						<label class="block">
							<span class="block text-xs font-semibold text-slate-500 mb-1">{m.l}</span>
							<input type="text" inputmode="decimal" value={form[m.k as 'subtotal' | 'igv']} disabled={!formEditable} oninput={(e) => (form[m.k as 'subtotal' | 'igv'] = currencyMask((e.target as HTMLInputElement).value))} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-right disabled:bg-slate-50 disabled:text-slate-600" />
						</label>
					{/each}
					<label class="block col-span-2">
						<span class="block text-xs font-semibold text-slate-500 mb-1">Total</span>
						<input type="text" inputmode="decimal" value={form.total} disabled={!formEditable} oninput={(e) => (form.total = currencyMask((e.target as HTMLInputElement).value))} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-right font-semibold disabled:bg-slate-50 disabled:text-slate-700" />
					</label>
					{#if esNota}
						<div class="col-span-2">
							<span class="block text-xs font-semibold text-slate-500 mb-1">Comprobante que modifica</span>
							<SelectConSaldo value={form.id_comprobante_referencia} options={referenciaOptions.filter((o) => o.value !== String(seleccionado?.id_comprobante ?? ''))} disabled={!formEditable} placeholder="Selecciona la factura o boleta" onchange={(v) => (form.id_comprobante_referencia = v)} />
							{#if borrador?.leidos.serie_numero_referencia && !form.id_comprobante_referencia}
								<p class="mt-1 text-[11px] text-amber-600">Se leyó {borrador.leidos.serie_numero_referencia}, pero no está registrado en el repositorio.</p>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Acciones -->
				{#if borrador}
					<div class="flex gap-2 pt-1">
						<button type="button" onclick={descartarBorrador} disabled={guardando} class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"><X size={15} /> Descartar</button>
						<button type="button" onclick={guardarBorrador} disabled={guardando} class="flex-[2] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-medium hover:bg-[#0c2f4c] disabled:opacity-60">
							{#if guardando}<Loader2 size={15} class="animate-spin" />{:else}<Save size={15} />{/if} Guardar comprobante
						</button>
					</div>
				{:else if editando}
					<div class="flex gap-2 pt-1">
						<button type="button" onclick={cancelarEdicion} disabled={guardando} class="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancelar</button>
						<button type="button" onclick={guardarEdicion} disabled={guardando} class="flex-[2] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-medium hover:bg-[#0c2f4c] disabled:opacity-60">
							{#if guardando}<Loader2 size={15} class="animate-spin" />{:else}<Save size={15} />{/if} Guardar cambios
						</button>
					</div>
				{:else if seleccionado && isAdmin() && seleccionado.activo}
					<div class="pt-1 space-y-2">
						{#if observando}
							<textarea bind:value={motivoObservacion} rows="2" placeholder="Motivo de la observación (obligatorio)" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"></textarea>
							<div class="flex gap-2">
								<button type="button" onclick={() => { observando = false; motivoObservacion = ''; }} class="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
								<button type="button" onclick={() => cambiarEstado('observado')} class="flex-1 px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700">Observar</button>
							</div>
						{:else}
							<div class="flex gap-2">
								{#if seleccionado.estado !== 'revisado'}
									<button type="button" onclick={() => cambiarEstado('revisado')} class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"><ShieldCheck size={15} /> Marcar revisado</button>
								{/if}
								{#if seleccionado.estado !== 'observado'}
									<button type="button" onclick={() => (observando = true)} class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-red-300 text-red-600 text-sm font-medium hover:bg-red-50"><AlertTriangle size={15} /> Observar</button>
								{/if}
								{#if seleccionado.estado !== 'pendiente'}
									<button type="button" onclick={() => cambiarEstado('pendiente')} class="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm hover:bg-slate-50" title="Volver a pendiente"><Undo2 size={15} /></button>
								{/if}
							</div>
						{/if}
					</div>
				{:else if seleccionado && !isAdmin()}
					<p class="text-[11px] text-slate-400">Solo un administrador puede marcarlo como Revisado u Observado.</p>
				{/if}
			</div>
		{/if}
	</div>
</div>

{#if seleccionado}
	<DocumentPreviewModal
		open={previewGrandeOpen}
		documents={[{ url: seleccionado.archivo_url, label: `${NOMBRE_TIPO_COMPROBANTE_INGRESO[seleccionado.tipo]} ${serieNumero(seleccionado)}`, filename: `${seleccionado.tipo}_${serieNumero(seleccionado)}` }]}
		title="Comprobante"
		onClose={() => (previewGrandeOpen = false)}
	/>
{/if}

<AdminConfirmModal
	open={!!paraEliminar}
	title="Eliminar comprobante permanentemente"
	message={paraEliminar ? `Vas a eliminar PERMANENTEMENTE ${NOMBRE_TIPO_COMPROBANTE_INGRESO[paraEliminar.tipo]} ${serieNumero(paraEliminar)} y su archivo. Esta acción no se puede deshacer. Ingresa el correo y la contraseña de un administrador para continuar.` : ''}
	confirmLabel="Eliminar permanentemente"
	onConfirm={confirmarEliminar}
	onClose={() => (paraEliminar = null)}
/>
