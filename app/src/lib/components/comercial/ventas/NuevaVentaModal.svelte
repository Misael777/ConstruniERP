<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { uploadProjectDocument, deleteProjectDocumentFile } from '$lib/shared/uploadProjectDocument';
	import { sanitizeFileSegment } from '$lib/shared/fileNaming';
	import { describeError } from '$lib/shared/describeError';
	import { getOrCrearCentroCostoParaEntidad, getOrCrearCentroCostoCompartido } from '$lib/modules/centro-costos/services/centroCostos.service';
	import { createTransaccion } from '$lib/modules/transacciones/services/transacciones.service';
	import { permisosState, isAdmin } from '$lib/stores/permisos.svelte';
	import { crearSolicitud, cerrarVentaAprobada } from '$lib/modules/aprobaciones/services/aprobaciones.service';
	import { getFechaLocalHoy } from '$lib/shared/dateUtils';
	import { DEPARTAMENTOS, PROVINCIAS_POR_DEPARTAMENTO, DISTRITOS_POR_PROVINCIA } from '$lib/data/peruUbigeo';
	import DocumentPreviewModal from '$lib/shared/components/DocumentPreviewModal.svelte';

	let {
		isOpen = false,
		mode = 'create',
		ventaId = null,
		onClose = () => {},
		onSaved = () => {}
	} = $props<{
		isOpen?: boolean;
		/** 'edit' reutiliza este mismo popup para editar una venta existente — a pedido del usuario,
		 * en vez de navegar a /proyectos/gestion/{id}. Trae además la gestión de proformas, contrato y
		 * cierre de venta (antes en ProformasVentaModal.svelte, ahora fusionada acá). */
		mode?: 'create' | 'edit';
		ventaId?: number | null;
		onClose?: () => void;
		onSaved?: () => void;
	}>();

	// Form State
	let proyectoNombre = $state('');
	// A pedido del usuario: la fecha de venta debe aparecer con la fecha de hoy por defecto (antes
	// quedaba una fecha de ejemplo vieja hardcodeada) — el $effect de reseteo más abajo también la
	// fija al abrir el popup, esto cubre el valor inicial antes de que ese efecto corra. Usa
	// getFechaLocalHoy(), NO toISOString() — ver dateUtils.ts, toISOString() da la fecha en UTC y en
	// Perú (UTC-5) eso muestra "mañana" desde ~7pm hora local en adelante.
	let fechaVenta = $state(getFechaLocalHoy());
	let asesor = $state('');
	let clientes = $state<any[]>([]);
	let selectedClienteId = $state<string>('');
	let nuevoClienteNombre = $state('');
	let valorVenta = $state('15000.00');
	let comisionPorcentaje = $state('10');
	let direccionPredio = $state('');

	let contratoFile = $state<File | null>(null);
	let proformaFiles = $state<File[]>([]);
	// A pedido del usuario: en modo creación también se puede elegir cuál de los PDFs recién
	// adjuntados será la proforma final, para poder crear y cerrar la venta en un solo paso (sin
	// tener que guardarla primero y reabrirla en edición). Es un índice sobre `proformaFiles` — recién
	// se traduce a un id_documento real de la BD dentro de crearVentaYSubirDocumentos.
	let selectedFinalFileIndex = $state<number | null>(null);
	// Adelanto inicial (opcional acá, solo en modo creación) — mismo criterio que en la sección de
	// gestión al cerrar la venta: el monto solo se habilita una vez adjuntado el comprobante. Si se
	// completa acá, no hace falta volver a pedirlo al cerrar la venta (ver checkAdelantoExistente).
	let adelantoFile = $state<File | null>(null);
	let adelantoMonto = $state('');

	// Generation fields
	let tipoProyecto = $state('');
	let estadoPredio = $state('');
	let tipoEdificacion = $state('');
	// Ya no tiene un <select> propio en Consultoría (se eliminó el dropdown duplicado "Tipo de
	// edificación (2)", a pedido del usuario) — se conserva como campo "de paso" para no perder el
	// dato de ventas ya guardadas con ese valor: loadVentaParaEditar lo carga y el guardado en modo
	// edición lo vuelve a mandar tal cual, pero nada en la UI lo vuelve a escribir.
	let tipoEdificacion2 = $state('');
	let numeroPisos = $state('');
	// Campos de la pestaña "Obra" (características del proyecto) — separados de los de Consultoría de
	// arriba: aunque comparten alguna etiqueta (ej. "Tipo de edificación"), sus catálogos de opciones
	// son distintos, y reusar la misma variable dejaría un valor inválido pegado al cambiar de pestaña.
	// AJUSTAR: todavía no se mandan en proyectoPayload (ver handleSubmit) — faltan confirmar las
	// columnas reales en la tabla `proyecto` para tipo_obra/tipo_tramite/tipo_intervencion antes de
	// guardarlos, para no romper el guardado completo con un nombre de columna inventado.
	let tipoObra = $state('');
	let tipoTramite = $state('');
	let tipoIntervencion = $state('');
	let tipoEdificacionObra = $state('');
	// Mes y Año propios de Obra (a diferencia de Consultoría, que los deriva solo de Fecha de venta
	// para el visualizador del código) — el usuario los pide como campos aparte para pedir directamente.
	let mesObra = $state('');
	let anioObra = $state('');
	let departamento = $state('Lima');
	let provincia = $state('Lima');
	let distrito = $state('');
	let clienteNombreGen = $state('');

	function getMesFromFecha() {
		const parsedDate = new Date(fechaVenta);
		return Number.isNaN(parsedDate.getTime()) ? '02' : String(parsedDate.getMonth() + 1).padStart(2, '0');
	}

	function getAnioFromFecha() {
		const parsedDate = new Date(fechaVenta);
		return Number.isNaN(parsedDate.getTime()) ? '2026' : String(parsedDate.getFullYear());
	}

	let mes = $derived(getMesFromFecha());
	let anio = $derived(getAnioFromFecha());

	let observaciones = $state('');
	let isSaving = $state(false);
	let saveError = $state('');
	let caracteristicasTab = $state<'consultoria' | 'obra'>('consultoria');
	// A pedido del usuario: "Información general" arranca colapsada cada vez que se abre el popup
	// (en edición) o desplegada (en creación) — ver el $effect de reseteo más abajo, que fija el
	// valor inicial correcto según `mode` cada vez que se abre.
	let infoGeneralExpanded = $state(false);
	let caracteristicasExpanded = $state(false);

	// ── Estado exclusivo del modo edición: carga inicial + gestión de proformas/contrato/cierre ──
	// (fusionado desde el antiguo ProformasVentaModal.svelte — mismo popup ahora, a pedido del usuario)
	let isLoadingVenta = $state(false);
	let proformas = $state<any[]>([]);
	let isLoadingProformas = $state(false);
	let selectedFinalId = $state<number | null>(null);
	let localContratoUrl = $state<string | null>(null);
	let localEstado = $state<string>('activo');
	let isUploadingProformaGestion = $state(false);
	let isUploadingContratoGestion = $state(false);
	let isClosing = $state(false);
	let montoFinalVenta = $state('');
	let adelantoYaRegistrado = $state(false);
	let isCheckingAdelanto = $state(false);
	let adelantoFecha = $state(getFechaLocalHoy());
	let previewOpen = $state(false);
	let previewUrl = $state('');
	let previewTitle = $state('');

	/** Las columnas distrito/provincia/departamento de `proyecto` son VARCHAR(4) — se guardan
	 * truncadas (ver payload más abajo). Al recargar para editar, se intenta reconstruir el valor
	 * completo buscando en el catálogo una opción que empiece con ese prefijo truncado, para que el
	 * <select> muestre algo razonable en vez de quedar vacío. */
	function resolveTruncatedOption(list: string[], truncated: string | null | undefined): string {
		if (!truncated) return '';
		const exact = list.find((v) => v === truncated);
		if (exact) return exact;
		const prefixMatch = list.find((v) => v.startsWith(truncated));
		return prefixMatch || truncated;
	}

	// Reset whenever the modal is opened — antes solo se limpiaba saveError, y el resto de los
	// campos quedaba con lo que se había escrito (o con datos de ejemplo hardcodeados: fecha vieja,
	// S/15000.00, 4 pisos, etc.) la última vez que se abrió el modal, en vez de partir en blanco
	// listo para ingresar una venta nueva. En modo edición, en vez de resetear, carga la venta.
	$effect(() => {
		if (isOpen) {
			saveError = '';
			// A pedido del usuario: en el pop up de NUEVA venta, "Información general" arranca
			// desplegada y "Características del proyecto nuevo" arranca colapsada (al revés que en
			// edición, donde "Información general" arranca colapsada — ya establecido antes).
			infoGeneralExpanded = mode !== 'edit';
			caracteristicasExpanded = mode === 'edit';
			if (mode === 'edit' && ventaId) {
				loadVentaParaEditar(ventaId);
			} else {
				proyectoNombre = '';
				fechaVenta = getFechaLocalHoy();
				loadCurrentAsesor();
				selectedClienteId = '';
				nuevoClienteNombre = '';
				valorVenta = '';
				comisionPorcentaje = '';
				direccionPredio = '';
				tipoProyecto = '';
				estadoPredio = '';
				tipoEdificacion = '';
				tipoEdificacion2 = '';
				numeroPisos = '';
				tipoObra = '';
				tipoTramite = '';
				tipoIntervencion = '';
				tipoEdificacionObra = '';
				mesObra = '';
				anioObra = '';
				departamento = 'Lima';
				provincia = 'Lima';
				distrito = '';
				contratoFile = null;
				proformaFiles = [];
				selectedFinalFileIndex = null;
				adelantoFile = null;
				adelantoMonto = '';
				adelantoFecha = getFechaLocalHoy();
				observaciones = '';
				caracteristicasTab = 'consultoria';
				proformas = [];
				selectedFinalId = null;
				localContratoUrl = null;
				localEstado = 'activo';
				montoFinalVenta = '';
				adelantoYaRegistrado = false;
			}
		}
	});

	async function loadVentaParaEditar(id: number) {
		isLoadingVenta = true;
		try {
			const { data, error } = await supabase
				.from('proyecto')
				.select('*, cliente:id_cliente(nombre)')
				.eq('id_proyecto', id)
				.single();
			if (error) throw error;

			proyectoNombre = data.nombre_proyecto || '';
			fechaVenta = data.fecha_inicio_plan || getFechaLocalHoy();
			selectedClienteId = data.id_cliente ? String(data.id_cliente) : '';
			nuevoClienteNombre = '';
			valorVenta = data.precio_venta != null ? String(data.precio_venta) : '';
			comisionPorcentaje = data.comision_asesor != null ? String(data.comision_asesor) : '';
			direccionPredio = data.direccion_predio || '';
			tipoProyecto = data.tip_proyecto || '';
			estadoPredio = data.estado_predio || '';
			tipoEdificacion = data.tipo_edifica || '';
			tipoEdificacion2 = data.tipo_edificacion2 || '';
			numeroPisos = data.nro_pisos != null ? String(data.nro_pisos) : '';
			departamento = resolveTruncatedOption(DEPARTAMENTOS, data.departamento) || 'Lima';
			provincia = resolveTruncatedOption(PROVINCIAS_POR_DEPARTAMENTO[departamento] ?? [], data.provincia) || 'Lima';
			// `ubicacion` guarda el distrito SIN truncar (ver payload de guardado) — se prefiere sobre
			// la columna `distrito` (VARCHAR(4)) que sí queda truncada.
			distrito = data.ubicacion || resolveTruncatedOption(DISTRITOS_POR_PROVINCIA[provincia] ?? [], data.distrito) || '';
			observaciones = data.descripcion || '';
			caracteristicasTab = data.tipo_venta === 'obra' ? 'obra' : 'consultoria';
			asesor = data.responsable || '';

			contratoFile = null;
			proformaFiles = [];
			adelantoFile = null;
			adelantoMonto = '';
			adelantoFecha = getFechaLocalHoy();

			localContratoUrl = data.contrato || null;
			localEstado = data.estado_proyecto || 'activo';
			montoFinalVenta = data.precio_venta != null ? String(data.precio_venta) : '';

			await loadProformas();
			await checkAdelantoExistente();
		} catch (err) {
			console.error('[NuevaVentaModal] Error cargando venta para editar:', err);
			saveError = `No se pudo cargar la venta. ${describeError(err)}`;
		} finally {
			isLoadingVenta = false;
		}
	}

	// A pedido del usuario: el campo Proyecto se autocompleta con el nombre del Cliente elegido en su
	// dropdown (o el que se está escribiendo para "+ Nuevo cliente") — el usuario puede seguir
	// editándolo a mano después si quiere personalizarlo, este efecto solo lo vuelve a llenar cuando
	// CAMBIA el cliente elegido. Solo aplica al crear — en edición no debe pisar el nombre ya guardado
	// apenas se precarga el cliente de la venta.
	$effect(() => {
		if (mode === 'edit') return;
		const nombreCliente = getClienteNombreActual();
		if (nombreCliente) proyectoNombre = nombreCliente;
	});

	// Auto-calculated code
	function getClienteNombreActual() {
		if (selectedClienteId && selectedClienteId !== '__new__') {
			const selected = clientes.find((c) => String(c.id_cliente) === String(selectedClienteId));
			return selected?.nombre?.trim() || '';
		}
		if (selectedClienteId === '__new__') {
			return nuevoClienteNombre.trim();
		}
		return clienteNombreGen.trim();
	}

// A pedido del usuario: el código de Obra sigue su propio esquema —
// {OBRA|SUP}-{tramite}{intervención}{edificación}{pisos}_{mes}{año}_{distrito}_{cliente} — usando el
// mes/año propios de esa pestaña (mesObra/anioObra), no los derivados de la fecha de venta como en
// Consultoría.
let codigoGenerado = $derived(
	caracteristicasTab === 'obra'
		? `${tipoObra}-${tipoTramite}${tipoIntervencion}${tipoEdificacionObra}${numeroPisos}_${mesObra}${String(anioObra).slice(-2)}_${sanitizeFileSegment(distrito)}_${sanitizeFileSegment(getClienteNombreActual() || 'Cliente')}`
		: `${tipoProyecto}${estadoPredio}${tipoEdificacion}${numeroPisos}_${mes}${anio.substring(2)}_${sanitizeFileSegment(distrito)}_${sanitizeFileSegment(getClienteNombreActual() || 'Cliente')}`
);

// El botón de copiar no tenía handler (0% funcional) — usa la Clipboard API con fallback manual
// para Tauri/navegadores viejos donde `navigator.clipboard` puede no estar disponible en un
// contexto no-seguro, y muestra un check breve como confirmación visual.
let codigoCopiado = $state(false);
async function copiarCodigoGenerado() {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(codigoGenerado);
		} else {
			const textarea = document.createElement('textarea');
			textarea.value = codigoGenerado;
			textarea.style.position = 'fixed';
			textarea.style.opacity = '0';
			document.body.appendChild(textarea);
			textarea.select();
			document.execCommand('copy');
			document.body.removeChild(textarea);
		}
		codigoCopiado = true;
		setTimeout(() => (codigoCopiado = false), 1500);
	} catch (err) {
		console.error('[NuevaVentaModal] No se pudo copiar el código generado:', err);
	}
}

	let comisionMonto = $derived((Number(valorVenta) || 0) * (Number(comisionPorcentaje) || 0) / 100);
	let contratoPresente = $derived(!!contratoFile || !!localContratoUrl);

	async function resolveCurrentAsesorName(): Promise<string> {
		try {
			const { data: { session }, error: sessionError } = await supabase.auth.getSession();

			if (sessionError) {
				console.warn('[NuevaVentaModal] No se pudo recuperar la sesión para asignar asesor:', sessionError);
			}

			if (!session?.user?.id) {
				return 'Usuario';
			}

			const { data: empleado, error: empleadoError } = await supabase
				.from('empleados')
				.select('nombre')
				.eq('auth_user_id', session.user.id)
				.maybeSingle();

			if (empleadoError) {
				console.warn('[NuevaVentaModal] No se pudo obtener el nombre del empleado para asignar asesor:', empleadoError);
			}

			const nombreEmpleado = empleado?.nombre?.trim();
			if (nombreEmpleado) {
				return nombreEmpleado;
			}

			return session.user.email?.trim() || 'Usuario';
		} catch (err) {
			console.error('[NuevaVentaModal] Error resolviendo el asesor actual:', err);
			return 'Usuario';
		}
	}

	async function uploadDocument(type: 'contrato' | 'proforma', file: File, projectId: number, projectName: string) {
		const { url } = await uploadProjectDocument(file, { type, projectId, projectName });
		return url;
	}

	async function ensureCliente(nombre: string) {
		console.log('[NuevaVentaModal] ensureCliente() iniciado con nombre:', nombre);
		const trimmed = String(nombre || '').trim();
		if (!trimmed) {
			console.log('[NuevaVentaModal] Nombre vacío, retornando null');
			return null;
		}

		console.log('[NuevaVentaModal] Buscando cliente existente con nombre ILIKE:', trimmed);
		const { data: existing, error: selectError } = await supabase
			.from('cliente')
			.select('id_cliente')
			.ilike('nombre', trimmed)
			.limit(1)
			.maybeSingle();

		if (selectError) {
			console.error('[NuevaVentaModal] ❌ Error consultando cliente:', selectError);
			return null;
		}

		if (existing?.id_cliente) {
			console.log('[NuevaVentaModal] ✓ Cliente existente encontrado con ID:', existing.id_cliente);
			return existing.id_cliente;
		}

		console.log('[NuevaVentaModal] Cliente no existe, creando nuevo...');
		const { data: inserted, error: insertError } = await supabase
			.from('cliente')
			.insert([{ nombre: trimmed }])
			.select('id_cliente')
			.single();

		if (insertError) {
			console.error('[NuevaVentaModal] ❌ Error creando cliente:', insertError);
			return null;
		}

		console.log('[NuevaVentaModal] ✓ Nuevo cliente creado con ID:', inserted?.id_cliente);
		return inserted?.id_cliente ?? null;
	}

	async function loadClientes() {
		console.log('[NuevaVentaModal] loadClientes() iniciado');
		try {
			console.log('[NuevaVentaModal] Consultando supabase.from("cliente")...');
			const { data, error } = await supabase.from('cliente').select('id_cliente,nombre').order('nombre', { ascending: true }).limit(200);
			if (error) throw error;
			clientes = data || [];
			console.log(`[NuevaVentaModal] ✓ ${clientes.length} clientes cargados`);
			console.log('[NuevaVentaModal] Lista de clientes:', clientes.map(c => ({ id: c.id_cliente, nombre: c.nombre })));
		} catch (err) {
			console.error('[NuevaVentaModal] ❌ Error cargando clientes:', err);
			clientes = [];
		}
	}

	async function loadCurrentAsesor() {
		const resolvedAsesor = await resolveCurrentAsesorName();
		asesor = resolvedAsesor;
		console.log('[NuevaVentaModal] Asesor inicial cargado:', asesor);
	}

	onMount(() => {
		console.log('[NuevaVentaModal] onMount() ejecutado, cargando clientes y asesor...');
		loadClientes();
		loadCurrentAsesor();
	});

	// ── Gestión de proformas / contrato / cierre de venta (solo modo edición) ──
	// Fusionado desde ProformasVentaModal.svelte — mismo popup ahora, a pedido del usuario.

	async function checkAdelantoExistente() {
		if (!ventaId) return;
		adelantoYaRegistrado = false;
		isCheckingAdelanto = true;
		try {
			const { data, error } = await supabase
				.from('transaccion')
				.select('id_transaccion')
				.eq('tipo', 'ingreso')
				.ilike('descripcion', `%(proyecto #${ventaId})%`)
				.limit(1)
				.maybeSingle();
			if (error) throw error;
			adelantoYaRegistrado = !!data;
		} catch (err) {
			console.error('[NuevaVentaModal] Error verificando adelanto existente:', err);
		} finally {
			isCheckingAdelanto = false;
		}
	}

	async function loadProformas() {
		if (!ventaId) return;
		isLoadingProformas = true;
		try {
			const { data, error } = await supabase
				.from('documento_proyecto')
				.select('id_documento,nombre,storage_url,file_size,created_at,es_proforma_final')
				.eq('id_proyecto', ventaId)
				.eq('tipo_documento', 'Proforma')
				.order('created_at', { ascending: false });

			if (error) throw error;
			proformas = (data || []) as any[];
			selectedFinalId = proformas.find((p) => p.es_proforma_final)?.id_documento ?? null;
		} catch (err) {
			console.error('[NuevaVentaModal] Error cargando proformas:', err);
			saveError = `No se pudieron cargar las proformas. ${describeError(err)}`;
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

	async function handleAddProformaFileGestion(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		(event.currentTarget as HTMLInputElement).value = '';
		if (!file || !ventaId) return;

		isUploadingProformaGestion = true;
		saveError = '';
		try {
			const { url } = await uploadProjectDocument(file, {
				type: 'proforma',
				projectId: ventaId,
				projectName: proyectoNombre
			});

			const { error } = await supabase.from('documento_proyecto').insert({
				id_proyecto: Number(ventaId),
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
			onSaved();
		} catch (err) {
			console.error('[NuevaVentaModal] Error subiendo proforma:', err);
			saveError = `No se pudo subir la proforma. ${describeError(err)}`;
		} finally {
			isUploadingProformaGestion = false;
		}
	}

	async function handleEliminarProformaGestion(doc: any) {
		if (!confirm(`¿Eliminar la proforma "${doc.nombre}"? Esta acción no se puede deshacer.`)) return;
		try {
			await deleteProjectDocumentFile(doc.storage_url);
			const { error } = await supabase.from('documento_proyecto').delete().eq('id_documento', doc.id_documento);
			if (error) throw error;
			if (selectedFinalId === doc.id_documento) selectedFinalId = null;
			await loadProformas();
			onSaved();
		} catch (err) {
			console.error('[NuevaVentaModal] Error eliminando proforma:', err);
			saveError = `No se pudo eliminar la proforma. ${describeError(err)}`;
		}
	}

	function handleVerProforma(doc: any) {
		if (!doc.storage_url) return;
		previewUrl = doc.storage_url;
		previewTitle = doc.nombre;
		previewOpen = true;
	}

	function handleVerContrato() {
		if (!localContratoUrl) return;
		previewUrl = localContratoUrl;
		previewTitle = `Contrato - ${proyectoNombre}`;
		previewOpen = true;
	}

	async function handleContratoFileGestion(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		(event.currentTarget as HTMLInputElement).value = '';
		if (!file || !ventaId) return;

		isUploadingContratoGestion = true;
		saveError = '';
		try {
			const { url } = await uploadProjectDocument(file, {
				type: 'contrato',
				projectId: ventaId,
				projectName: proyectoNombre
			});
			await supabase.from('proyecto').update({ contrato: url }).eq('id_proyecto', ventaId);
			localContratoUrl = url;
			onSaved();
		} catch (err) {
			console.error('[NuevaVentaModal] Error subiendo contrato:', err);
			saveError = `No se pudo subir el contrato. ${describeError(err)}`;
		} finally {
			isUploadingContratoGestion = false;
		}
	}

	// A pedido del usuario: "Cerrar venta" ya no depende solo de la sección de cierre (contrato,
	// proforma final, monto, adelanto) — también exige que TODOS los campos obligatorios (*) de
	// "Información general" y "Características del proyecto" estén completos. tipoEdificacion2 queda
	// fuera de este chequeo a propósito: ya no tiene un <select> en la UI (ver su declaración más
	// arriba), así que exigirlo dejaría el formulario imposible de completar para una venta nueva.
	// AJUSTAR: el sub-chequeo de Obra (tipoObra/tipoTramite/tipoIntervencion/tipoEdificacionObra) se
	// deja pendiente hasta que esos campos tengan columnas reales donde guardarse (ver su declaración).
	let infoGeneralCompleta = $derived(
		!!proyectoNombre.trim() &&
		!!fechaVenta &&
		!!selectedClienteId && selectedClienteId !== '__new__' &&
		!!departamento &&
		!!provincia &&
		!!distrito &&
		Number(valorVenta) > 0 &&
		comisionPorcentaje !== '' && !Number.isNaN(Number(comisionPorcentaje)) &&
		(caracteristicasTab !== 'consultoria' ||
			(!!tipoProyecto && !!estadoPredio && !!tipoEdificacion && Number(numeroPisos) > 0))
	);

	let canClose = $derived(
		mode === 'edit' &&
		localEstado !== 'venta_cerrada' &&
		infoGeneralCompleta &&
		!!localContratoUrl &&
		selectedFinalId !== null &&
		Number(montoFinalVenta) > 0 &&
		(adelantoYaRegistrado || (!!adelantoFile && Number(adelantoMonto) > 0 && Number(adelantoMonto) <= Number(montoFinalVenta) && !!adelantoFecha))
	);

	// A pedido del usuario: también se puede cerrar la venta de una sola vez desde el pop up de
	// CREACIÓN (registrar + cerrar en un solo clic), en vez de guardar primero y recién cerrar desde
	// "Editar" — mismo criterio de campos obligatorios que `canClose`, pero usando los archivos
	// sueltos que todavía no se subieron (`proformaFiles`/`selectedFinalFileIndex`) en vez de los ya
	// guardados en `documento_proyecto`.
	// A pedido del usuario: la sección "Características del proyecto nuevo" queda BLOQUEADA (todos sus
	// campos deshabilitados) hasta que estén el contrato, el comprobante del adelanto y la proforma
	// marcada como final — tanto en "Nueva venta" (usa los archivos sueltos todavía no subidos) como
	// en "Editar" (usa lo ya gestionado en la sección de Proformas/contrato/cierre, que aparece antes
	// en el formulario).
	let documentosCierreListos = $derived(
		mode === 'edit'
			? !!localContratoUrl && (adelantoYaRegistrado || !!adelantoFile) && selectedFinalId !== null
			: contratoPresente && !!adelantoFile && selectedFinalFileIndex !== null
	);

	let canCloseCreate = $derived(
		mode === 'create' &&
		infoGeneralCompleta &&
		contratoPresente &&
		proformaFiles.length > 0 &&
		selectedFinalFileIndex !== null &&
		Number(valorVenta) > 0 &&
		!!adelantoFile &&
		Number(adelantoMonto) > 0 &&
		Number(adelantoMonto) <= Number(valorVenta) &&
		!!adelantoFecha
	);

	function handleAdelantoFileGestion(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		(event.currentTarget as HTMLInputElement).value = '';
		if (file) adelantoFile = file;
	}

	async function handleCerrarVenta() {
		if (!canClose || !ventaId || selectedFinalId === null) return;
		if (!adelantoYaRegistrado && !adelantoFile) return;
		isClosing = true;
		saveError = '';
		try {
			// El adelanto puede haberse registrado ya al crear la venta — en ese caso no hace falta
			// pedirlo/crearlo de nuevo acá.
			let comprobanteUrl: string | undefined;
			if (!adelantoYaRegistrado && adelantoFile) {
				const uploaded = await uploadProjectDocument(adelantoFile, {
					type: 'comprobante',
					projectId: ventaId,
					projectName: proyectoNombre
				});
				comprobanteUrl = uploaded.url;
			}

			const cierreParams = {
				idProyecto: Number(ventaId),
				proyectoNombre,
				tipoVenta: caracteristicasTab,
				idCliente: Number(selectedClienteId),
				clienteNombre: getClienteNombreActual() || `Cliente #${selectedClienteId}`,
				selectedFinalId,
				montoFinalVenta: Number(montoFinalVenta),
				adelantoYaRegistrado,
				adelantoMonto: Number(adelantoMonto),
				adelantoFecha,
				comprobanteUrl
			};

			// A pedido del usuario: cerrar una venta ya NO requiere aprobación de un admin — cualquiera
			// puede hacerlo directo. Solo si quien cierra NO es admin, se deja un aviso informativo
			// (auto-resuelto, sin Aprobar/Rechazar) para que los admins se enteren igual, ver
			// getAvisosInformativos en aprobaciones.service.ts.
			const { data: userData } = await supabase.auth.getUser();
			const result = await cerrarVentaAprobada(supabase, cierreParams, userData?.user?.email ?? null, permisosState.userName || null);
			if (!result.success) throw new Error(result.message || 'No se pudo cerrar la venta.');

			if (!isAdmin()) {
				await crearSolicitud(supabase, {
					tipoEntidad: 'proyecto',
					idEntidad: Number(ventaId),
					tipoAccion: 'cerrar_venta',
					descripcionEntidad: proyectoNombre,
					autoResuelto: true
				});
			}

			localEstado = 'venta_cerrada';
			await loadProformas();
			onSaved();
		} catch (err) {
			console.error('[NuevaVentaModal] Error cerrando venta:', err);
			alert(`No se pudo cerrar la venta.\n${describeError(err)}`);
		} finally {
			isClosing = false;
		}
	}

	interface DatosBasicosVenta {
		clienteId: number;
		asesorFinal: string;
		asesorUserId: string | null;
		clienteNombreFinal: string;
		precioVenta: number;
		comision: number;
		numeroPisosValue: number | null;
		fechaInicio: string;
		sessionEmail: string | null;
	}

	/** Validaciones + resolución del cliente compartidas por "Guardar venta" y "Guardar y cerrar
	 * venta" (creación) — antes vivían inline al principio de handleGuardar. Devuelve null (con
	 * saveError ya seteado) si algo falta. */
	async function validarYResolverDatosBasicos(): Promise<DatosBasicosVenta | null> {
		saveError = '';

		if (!proyectoNombre.trim()) {
			saveError = 'Debes ingresar un nombre de proyecto.';
			return null;
		}
		if (!fechaVenta) {
			saveError = 'Debes seleccionar la fecha de venta.';
			return null;
		}

		let clienteId: number | null = null;
		if (selectedClienteId && selectedClienteId !== '__new__') {
			clienteId = Number(selectedClienteId);
		} else if (selectedClienteId === '__new__') {
			if (!nuevoClienteNombre.trim()) {
				saveError = 'Debes ingresar el nombre del cliente.';
				return null;
			}
			clienteId = await ensureCliente(nuevoClienteNombre);
		} else {
			const nombreClienteFallback = getClienteNombreActual().trim();
			if (!nombreClienteFallback) {
				saveError = 'Debes seleccionar o ingresar el nombre del cliente.';
				return null;
			}
			clienteId = await ensureCliente(nombreClienteFallback);
		}

		if (!clienteId) {
			saveError = 'No se pudo obtener o crear el cliente.';
			return null;
		}

		const precioVenta = Number(valorVenta) || 0;
		const comision = Number(comisionPorcentaje) || 0;
		const numeroPisosValue = Number(numeroPisos) || null;
		const fechaInicio = fechaVenta;
		const asesorFinal = (asesor || '').trim() || (await resolveCurrentAsesorName());
		const clienteNombreFinal = getClienteNombreActual().trim();
		const { data: { session } } = await supabase.auth.getSession();
		const asesorUserId = session?.user?.id ?? null;
		asesor = asesorFinal;

		return {
			clienteId,
			asesorFinal,
			asesorUserId,
			clienteNombreFinal,
			precioVenta,
			comision,
			numeroPisosValue,
			fechaInicio,
			sessionEmail: session?.user?.email ?? null
		};
	}

	/** INSERT del proyecto (modo creación) + centro de costo + subida de contrato/proformas/adelanto
	 * — antes era la segunda mitad de handleGuardar. Ahora reusable también por "Guardar y cerrar
	 * venta". Devuelve el id del proyecto recién creado y, en el mismo orden que `proformaFiles`, el
	 * id_documento de cada proforma ya insertada (para poder elegir "cuál es la final" sin haber
	 * tenido ids de antemano). Devuelve null (con saveError ya seteado) si algo falla. */
	async function crearVentaYSubirDocumentos(
		basicos: DatosBasicosVenta
	): Promise<{ proyectoId: number; idCentroCosto: number | string | null; proformaDocIds: (number | null)[] } | null> {
		const { clienteId, asesorFinal, asesorUserId, clienteNombreFinal, precioVenta, comision, numeroPisosValue, fechaInicio, sessionEmail } = basicos;

		const proyectoPayload = {
			id_cliente: clienteId,
			nombre_proyecto: proyectoNombre,
			fecha_inicio_plan: fechaInicio,
			precio_venta: precioVenta,
			comision_asesor: comision,
			responsable: asesorFinal,
			asesor_comercial_id: asesorUserId,
			tip_proyecto: tipoProyecto,
			estado_predio: estadoPredio,
			tipo_edifica: tipoEdificacion,
			nro_pisos: numeroPisosValue,
			distrito: distrito ? distrito.substring(0, 4).trim() : null,
			provincia: provincia ? provincia.substring(0, 4).trim() : null,
			departamento: departamento ? departamento.substring(0, 4).trim() : null,
			costo_estima: precioVenta,
			estado_proyecto: 'activo',
			tipo_venta: caracteristicasTab,
			ubicacion: distrito,
			direccion_predio: direccionPredio?.trim() ? direccionPredio.trim() : null,
			usuario_registro: asesorUserId,
			descripcion: observaciones?.trim() ? observaciones.trim() : null
		};

		const { data, error } = await supabase.from('proyecto').insert([proyectoPayload]).select('id_proyecto').single();
		if (error || !data?.id_proyecto) {
			console.error('[NuevaVentaModal] Error al insertar proyecto:', error);
			saveError = `Error guardando la venta: ${error?.message ?? 'Error desconocido.'}`;
			return null;
		}

		const nuevoProyectoId = data.id_proyecto;

		// Obra: cada venta tiene su PROPIO centro de costo (comportamiento de siempre). Consultoría:
		// TODAS las ventas de consultoría comparten UN ÚNICO centro de costo — a pedido explícito del
		// usuario (ver getOrCrearCentroCostoCompartido).
		const idCentroCosto = caracteristicasTab === 'consultoria'
			? await getOrCrearCentroCostoCompartido(supabase, 'consultoria')
			: await getOrCrearCentroCostoParaEntidad(supabase, 'proyecto', nuevoProyectoId, proyectoNombre);
		if (!idCentroCosto) {
			console.warn('[NuevaVentaModal] No se pudo crear el centro de costo del proyecto — la venta se guardó, pero las transacciones de sus cobros/pagos no van a poder generarse hasta que exista.');
		}

		const proformaDocIds: (number | null)[] = [];
		try {
			if (contratoFile) {
				const contratoUrl = await uploadDocument('contrato', contratoFile, nuevoProyectoId, proyectoNombre);
				await supabase.from('proyecto').update({ contrato: contratoUrl }).eq('id_proyecto', nuevoProyectoId);
			}

			// Cada proforma se registra como una fila propia en documento_proyecto — la venta puede
			// tener varias mientras sigue en negociación. Se captura el id_documento de cada una (en el
			// mismo orden que proformaFiles) para poder resolver "cuál es la final" si esto se llamó
			// desde "Guardar y cerrar venta".
			for (const file of proformaFiles) {
				const proformaUrl = await uploadDocument('proforma', file, nuevoProyectoId, proyectoNombre);
				const { data: docData, error: docError } = await supabase
					.from('documento_proyecto')
					.insert({
						id_proyecto: nuevoProyectoId,
						nombre: file.name.replace(/\.[^.]+$/, ''),
						tipo_documento: 'Proforma',
						estado: 'borrador',
						es_proforma_final: false,
						storage_url: proformaUrl,
						file_size: file.size,
						file_type: file.type,
						creado_por: asesorFinal,
						responsable: asesorFinal
					})
					.select('id_documento')
					.single();
				if (docError) throw docError;
				proformaDocIds.push(docData?.id_documento ?? null);
			}

			// Adelanto inicial — mismo mecanismo que "Cerrar venta": asegura el centro de costo del
			// cliente, sube el comprobante y crea la transacción (ingreso) de una vez. Requiere ambos
			// (archivo Y monto) — el campo de monto ya viene deshabilitado en el formulario mientras no
			// haya comprobante adjunto.
			if (adelantoFile && Number(adelantoMonto) > 0) {
				const idCentroCliente = await getOrCrearCentroCostoParaEntidad(supabase, 'cliente', clienteId, clienteNombreFinal || `Cliente #${clienteId}`);
				if (!idCentroCliente) throw new Error('No se pudo obtener el centro de costo del cliente para registrar el adelanto.');

				const { url: comprobanteUrl } = await uploadProjectDocument(adelantoFile, {
					type: 'comprobante',
					projectId: nuevoProyectoId,
					projectName: proyectoNombre
				});

				const transResult = await createTransaccion(
					supabase,
					{
						tipo_alcance: 'externa',
						id_centro_costo_origen: idCentroCliente,
						id_centro_costo_destino: idCentroCosto,
						fecha: fechaInicio,
						monto_total: Number(adelantoMonto),
						tipo: 'ingreso',
						estado: 'activo',
						comprobante_url: comprobanteUrl,
						descripcion: `Adelanto inicial - ${proyectoNombre} (proyecto #${nuevoProyectoId})`
					},
					sessionEmail,
					permisosState.userName || null
				);
				if (!transResult.success) throw new Error(transResult.message || 'No se pudo registrar la transacción del adelanto.');
			}
		} catch (uploadError) {
			console.error('[NuevaVentaModal] Error al subir documentos:', uploadError);
			saveError = String(uploadError instanceof Error ? uploadError.message : uploadError);
			return null;
		}

		return { proyectoId: nuevoProyectoId, idCentroCosto, proformaDocIds };
	}

	async function handleGuardar() {
		const basicos = await validarYResolverDatosBasicos();
		if (!basicos) return;

		isSaving = true;

		// === Modo edición: UPDATE de los campos generales, sin tocar estado_proyecto (solo "Cerrar
		// venta" lo cambia) ni asesor_comercial_id/usuario_registro (deben seguir apuntando al asesor
		// original — ventas/+page.svelte los usa para filtrar "mis ventas" de un no-administrador; si
		// un admin edita la venta de otro asesor, no debe reasignarse solo por guardar cambios). ===
		if (mode === 'edit' && ventaId) {
			const proyectoUpdatePayload = {
				id_cliente: basicos.clienteId,
				nombre_proyecto: proyectoNombre,
				fecha_inicio_plan: basicos.fechaInicio,
				precio_venta: basicos.precioVenta,
				comision_asesor: basicos.comision,
				responsable: basicos.asesorFinal,
				tip_proyecto: tipoProyecto,
				estado_predio: estadoPredio,
				tipo_edifica: tipoEdificacion,
				tipo_edificacion2: tipoEdificacion2 || null,
				nro_pisos: basicos.numeroPisosValue,
				distrito: distrito ? distrito.substring(0, 4).trim() : null,
				provincia: provincia ? provincia.substring(0, 4).trim() : null,
				departamento: departamento ? departamento.substring(0, 4).trim() : null,
				costo_estima: basicos.precioVenta,
				tipo_venta: caracteristicasTab,
				ubicacion: distrito,
				direccion_predio: direccionPredio?.trim() ? direccionPredio.trim() : null,
				descripcion: observaciones?.trim() ? observaciones.trim() : null
			};

			// A pedido del usuario: un no-administrador ya no guarda los cambios directo — se envía una
			// solicitud de aprobación con el payload propuesto, visible para todos los admins en la
			// campanita (ver aprobaciones.service.ts).
			if (!isAdmin()) {
				const result = await crearSolicitud(supabase, {
					tipoEntidad: 'proyecto',
					idEntidad: Number(ventaId),
					tipoAccion: 'editar',
					descripcionEntidad: proyectoNombre,
					payloadCambios: proyectoUpdatePayload
				});
				isSaving = false;
				if (!result.success) {
					saveError = `No se pudo enviar la solicitud. ${result.message ?? ''}`;
					return;
				}
				alert('No tienes permisos de administrador. Los cambios se enviaron para que un administrador los apruebe.');
				onSaved();
				return;
			}

			const { error } = await supabase.from('proyecto').update(proyectoUpdatePayload).eq('id_proyecto', ventaId);
			isSaving = false;
			if (error) {
				console.error('[NuevaVentaModal] Error al actualizar proyecto:', error);
				saveError = `Error guardando los cambios: ${error.message ?? 'Error desconocido.'}`;
				return;
			}
			onSaved();
			return;
		}

		const resultado = await crearVentaYSubirDocumentos(basicos);
		isSaving = false;
		if (!resultado) return;
		onSaved();
		onClose();
	}

	/** A pedido del usuario: registrar y cerrar la venta en un solo paso desde el pop up de
	 * CREACIÓN, sin necesidad de guardar primero y reabrir en "Editar". Reusa exactamente la misma
	 * lógica de cierre que el modo edición (cerrarVentaAprobada / crearSolicitud si no es admin) —
	 * solo cambia de dónde sale el id_documento de la proforma final: acá recién se conoce después de
	 * crearVentaYSubirDocumentos, porque el archivo todavía no existía en la BD. */
	async function handleGuardarYCerrarVenta() {
		if (!canCloseCreate || selectedFinalFileIndex === null) return;

		const basicos = await validarYResolverDatosBasicos();
		if (!basicos) return;

		isClosing = true;
		try {
			const resultado = await crearVentaYSubirDocumentos(basicos);
			if (!resultado) return; // saveError ya seteado por crearVentaYSubirDocumentos

			const idDocumentoFinal = resultado.proformaDocIds[selectedFinalFileIndex];
			if (!idDocumentoFinal) throw new Error('No se pudo determinar la proforma final recién subida.');

			const cierreParams = {
				idProyecto: resultado.proyectoId,
				proyectoNombre,
				tipoVenta: caracteristicasTab,
				idCliente: basicos.clienteId,
				clienteNombre: basicos.clienteNombreFinal || `Cliente #${basicos.clienteId}`,
				selectedFinalId: idDocumentoFinal,
				montoFinalVenta: basicos.precioVenta,
				// El adelanto ya se creó dentro de crearVentaYSubirDocumentos (la creación de una venta
				// nunca estuvo gateada por aprobación, a diferencia de cerrarla) — cerrarVentaAprobada no
				// debe volver a crear la transacción.
				adelantoYaRegistrado: true
			};

			// A pedido del usuario: cerrar una venta ya no requiere aprobación — se aplica directo, sin
			// importar el rol. Solo si quien cierra no es admin queda un aviso informativo para los
			// admins (auto-resuelto, sin Aprobar/Rechazar).
			const { data: userData } = await supabase.auth.getUser();
			const result = await cerrarVentaAprobada(supabase, cierreParams, userData?.user?.email ?? null, permisosState.userName || null);
			if (!result.success) throw new Error(result.message || 'No se pudo cerrar la venta.');

			if (!isAdmin()) {
				await crearSolicitud(supabase, {
					tipoEntidad: 'proyecto',
					idEntidad: resultado.proyectoId,
					tipoAccion: 'cerrar_venta',
					descripcionEntidad: proyectoNombre,
					autoResuelto: true
				});
			}

			onSaved();
			onClose();
		} catch (err) {
			console.error('[NuevaVentaModal] Error creando y cerrando la venta:', err);
			saveError = `No se pudo cerrar la venta.\n${describeError(err)}`;
		} finally {
			isClosing = false;
		}
	}
</script>

{#if isOpen}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4 overflow-y-auto" transition:fade={{duration: 200}}>
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-5xl my-8 relative" transition:scale={{duration: 300, start: 0.95}}>

			<!-- Header -->
			<div class="flex items-center justify-between p-6 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl z-10">
				<h2 class="text-xl font-bold text-slate-800">{mode === 'edit' ? 'Editar venta' : 'Nueva venta'}</h2>
				<button onclick={onClose} aria-label="Cerrar modal" class="text-slate-400 hover:text-slate-600 transition-colors p-2 rounded-full hover:bg-slate-100">
					<i class="fas fa-times text-lg"></i>
				</button>
			</div>

			<!-- Error banner -->
			{#if saveError}
				<div class="mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm flex items-start gap-2">
					<i class="fas fa-exclamation-circle mt-0.5 shrink-0"></i>
					<span>{saveError}</span>
				</div>
			{/if}

			{#if isLoadingVenta}
				<div class="p-16 text-center text-slate-400">
					<i class="fas fa-spinner fa-spin text-2xl"></i>
					<p class="text-sm mt-2">Cargando venta...</p>
				</div>
			{:else}
			<!-- Body -->
			<div class="p-6 md:p-8 overflow-y-auto max-h-[calc(100vh-200px)]">
				<div class="space-y-8">

					<!-- Información general (colapsable — a pedido del usuario, arranca cerrada) -->
					<section>
						<button
							type="button"
							onclick={() => (infoGeneralExpanded = !infoGeneralExpanded)}
							class="w-full flex items-center justify-between gap-2 mb-4 text-left"
							aria-expanded={infoGeneralExpanded}
						>
							<span class="text-sm font-bold text-slate-800 flex items-center gap-2">
								<div class="w-1.5 h-4 bg-blue-600 rounded-full"></div>
								Información general
							</span>
							<i class={`fas fa-chevron-down text-slate-400 text-xs transition-transform ${infoGeneralExpanded ? 'rotate-180' : ''}`}></i>
						</button>
						{#if infoGeneralExpanded}
						<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
							<div class="flex flex-col gap-1 md:col-span-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Clientes *</label>
								<select bind:value={selectedClienteId} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all appearance-none text-slate-700">
									<option value="">-- Selecciona cliente --</option>
									{#each clientes as c}
										<option value={String(c.id_cliente)}>{c.nombre}</option>
									{/each}
									<option value="__new__">+ Nuevo cliente</option>
								</select>
								{#if selectedClienteId === '__new__'}
									<input type="text" bind:value={nuevoClienteNombre} placeholder="Nombre del nuevo cliente" class="mt-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all text-slate-700" />
								{/if}
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Departamento *</label>
								<select
									value={departamento}
									onchange={(e) => {
										departamento = (e.currentTarget as HTMLSelectElement).value;
										provincia = (PROVINCIAS_POR_DEPARTAMENTO[departamento] ?? [])[0] ?? '';
										distrito = '';
									}}
									class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
								>
									{#each DEPARTAMENTOS as d}
										<option value={d}>{d}</option>
									{/each}
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Provincia *</label>
								<select
									value={provincia}
									onchange={(e) => { provincia = (e.currentTarget as HTMLSelectElement).value; distrito = ''; }}
									class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
								>
									{#each PROVINCIAS_POR_DEPARTAMENTO[departamento] ?? [] as p}
										<option value={p}>{p}</option>
									{/each}
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Distrito *</label>
								<select bind:value={distrito} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
									{#if (DISTRITOS_POR_PROVINCIA[provincia] ?? []).length === 0}
										<option value="" disabled>-- Sin distritos cargados para {provincia} --</option>
									{:else}
										<option value="">-- Selecciona --</option>
										{#each DISTRITOS_POR_PROVINCIA[provincia] as d}
											<option value={d}>{d}</option>
										{/each}
									{/if}
								</select>
							</div>
							<div class="flex flex-col gap-1 md:col-span-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Código de proyecto</label>
								<input type="text" readonly value={codigoGenerado} class="px-3 py-2 bg-slate-100 border border-slate-200 text-slate-500 rounded-lg text-sm outline-none cursor-not-allowed">
								<span class="text-[10px] text-slate-400 mt-0.5">Se generará automáticamente</span>
							</div>
							<div class="flex flex-col gap-1 md:col-span-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Fecha de venta *</label>
								<input type="date" bind:value={fechaVenta} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all text-slate-700">
							</div>
							<div class="flex flex-col gap-1 md:col-span-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Asesor *</label>
								<input type="text" readonly value={asesor || 'Cargando asesor...'} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none text-slate-700">
								<span class="text-[10px] text-slate-400 mt-0.5">Se asigna automáticamente con el usuario activo</span>
							</div>
							<div class="flex flex-col gap-1 md:col-span-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Valor venta (S/) *</label>
								<input
									type="text"
									bind:value={valorVenta}
									class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all text-slate-700"
								>
							</div>
							<div class="flex flex-col gap-1 md:col-span-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Dirección del predio</label>
								<input type="text" bind:value={direccionPredio} placeholder="Ej. Jr. Los Álamos 123" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all text-slate-700">
							</div>
							<div class="grid grid-cols-2 gap-2 md:col-span-1">
								<div class="flex flex-col gap-1">
									<label class="text-xs font-semibold text-[#0f3b5e]">Comisión (%) *</label>
									<input type="number" bind:value={comisionPorcentaje} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all text-slate-700">
								</div>
								<div class="flex flex-col gap-1">
									<label class="text-xs font-semibold text-[#0f3b5e]">Comisión (S/)</label>
									<input type="text" readonly value={comisionMonto} class="px-3 py-2 bg-slate-100 border border-slate-200 text-slate-500 rounded-lg text-sm outline-none cursor-not-allowed">
								</div>
							</div>
							{#if mode === 'create'}
							<div class="grid grid-cols-2 gap-2 md:col-span-1">
								<div class="flex flex-col gap-1">
									<label class="text-xs font-semibold text-[#0f3b5e]">Proformas</label>
									<label class="cursor-pointer px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-2 transition-colors">
										<i class="fas fa-file-pdf text-rose-500"></i>
										<input type="file" accept="application/pdf" onchange={(event) => {
											const input = event.currentTarget as HTMLInputElement;
											const file = input.files?.[0];
											if (file) proformaFiles = [...proformaFiles, file];
											input.value = '';
										}} class="hidden" />
										<span>Agregar PDF</span>
									</label>
									{#if proformaFiles.length > 0}
										<div class="flex flex-col gap-1 mt-1">
											<!-- A pedido del usuario: también se puede elegir la proforma final acá mismo,
											     al crear, para poder cerrar la venta de una vez con "Cerrar venta" abajo. -->
											{#each proformaFiles as file, i}
												<div class="flex items-center gap-2 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
													<input
														type="radio"
														name="proforma-final-create"
														checked={selectedFinalFileIndex === i}
														onchange={() => (selectedFinalFileIndex = i)}
														class="shrink-0 accent-blue-600"
														aria-label="Marcar como proforma final"
														title="Marcar como proforma final"
													/>
													<span class="truncate flex-1">{file.name}</span>
													<button
														type="button"
														onclick={() => {
															proformaFiles = proformaFiles.filter((_, idx) => idx !== i);
															if (selectedFinalFileIndex === i) selectedFinalFileIndex = null;
															else if (selectedFinalFileIndex !== null && selectedFinalFileIndex > i) selectedFinalFileIndex -= 1;
														}}
														class="text-slate-400 hover:text-rose-600 shrink-0"
														aria-label="Quitar proforma"
													>
														<i class="fas fa-times"></i>
													</button>
												</div>
											{/each}
											<span class="text-[10px] text-slate-400 mt-0.5">Marca el radio de la proforma final si vas a usar "Cerrar venta" abajo.</span>
										</div>
									{/if}
								</div>
								<div class="flex flex-col gap-1">
									<label class="text-xs font-semibold text-[#0f3b5e]">Contrato</label>
									<label class="cursor-pointer px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-2 transition-colors">
										<i class="fas fa-file-pdf text-rose-500"></i>
										<input type="file" accept="application/pdf" onchange={(event) => contratoFile = (event.currentTarget as HTMLInputElement).files?.[0] ?? null} class="hidden" />
										{#if contratoFile}
											<span class="text-xs text-slate-500 truncate max-w-[120px]">{contratoFile.name}</span>
										{:else}
											<span>Adjuntar PDF</span>
										{/if}
									</label>
								</div>
								<div class="flex flex-col gap-1">
									<label class="text-xs font-semibold text-[#0f3b5e]">Comprobante del adelanto</label>
									<label class="cursor-pointer px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-2 transition-colors">
										<i class="fas fa-file-pdf text-rose-500"></i>
										<input type="file" accept="image/*,application/pdf" onchange={(event) => adelantoFile = (event.currentTarget as HTMLInputElement).files?.[0] ?? null} class="hidden" />
										{#if adelantoFile}
											<span class="text-xs text-slate-500 truncate max-w-[120px]">{adelantoFile.name}</span>
										{:else}
											<span>Adjuntar comprobante</span>
										{/if}
									</label>
								</div>
								<div class="flex flex-col gap-1">
									<label class="text-xs font-semibold text-[#0f3b5e]">Monto del adelanto (S/)</label>
									<input
										type="number"
										min="0.01"
										step="0.01"
										bind:value={adelantoMonto}
										disabled={!adelantoFile}
										placeholder="0.00"
										title={!adelantoFile ? 'Adjunta el comprobante para poder ingresar el monto del adelanto' : ''}
										class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all text-slate-700 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
									>
									{#if !adelantoFile}
										<span class="text-[10px] text-slate-400 mt-0.5">Adjunta el comprobante para habilitar este campo</span>
									{/if}
								</div>
							</div>
							{/if}
						</div>
						{/if}
					</section>

					{#if mode === 'edit'}
					<!-- Gestión de proformas, contrato y cierre de venta -->
					<section class="border-t border-slate-100 pt-6">
						<h3 class="text-sm font-bold text-slate-800 mb-1 flex items-center gap-2">
							<div class="w-1.5 h-4 bg-emerald-500 rounded-full"></div>
							Proformas, contrato y cierre de venta
						</h3>

						{#if localEstado === 'venta_cerrada'}
							<div class="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm flex items-center gap-2">
								<i class="fas fa-check-circle"></i>
								<span class="font-semibold">Venta cerrada</span>
							</div>
						{/if}

						<!-- Proformas -->
						<div class="mt-4">
							<div class="flex items-center justify-between mb-3">
								<h4 class="text-xs font-bold text-slate-600 uppercase tracking-wide">Proformas</h4>
								{#if localEstado !== 'venta_cerrada'}
									<label class="cursor-pointer px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 transition-colors">
										<input type="file" accept="application/pdf" class="hidden" onchange={handleAddProformaFileGestion} disabled={isUploadingProformaGestion} />
										{#if isUploadingProformaGestion}
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
												<button onclick={() => handleEliminarProformaGestion(doc)} class="shrink-0 text-slate-400 hover:text-rose-600 p-1.5 rounded transition-colors" title="Eliminar" aria-label="Eliminar proforma">
													<i class="fas fa-trash-alt"></i>
												</button>
											{/if}
										</div>
									{/each}
								</div>
							{/if}
						</div>

						<!-- Contrato -->
						<div class="mt-6 border-t border-slate-100 pt-5">
							<h4 class="text-xs font-bold text-slate-600 uppercase tracking-wide mb-3">Contrato</h4>
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
									<input type="file" accept="application/pdf" class="hidden" onchange={handleContratoFileGestion} disabled={isUploadingContratoGestion} />
									{#if isUploadingContratoGestion}
										<i class="fas fa-spinner fa-spin"></i> Subiendo contrato...
									{:else}
										<i class="fas fa-cloud-upload-alt"></i> Adjuntar contrato
									{/if}
								</label>
							{/if}
						</div>

						<!-- Cierre financiero: monto final de la venta + adelanto inicial -->
						{#if localEstado !== 'venta_cerrada'}
							<div class="mt-6 border-t border-slate-100 pt-5">
								<h4 class="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">Monto final de la venta</h4>
								<p class="text-xs text-slate-400 mb-3">Confirma el valor definitivo de la venta — obligatorio para cerrarla.</p>
								<div class="flex flex-col gap-1 mb-1 max-w-xs">
									<label class="text-xs font-semibold text-[#0f3b5e]">Valor final (S/)</label>
									<input type="number" min="0.01" step="0.01" bind:value={montoFinalVenta} placeholder="0.00" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all text-slate-700">
								</div>
							</div>

							<div class="mt-6 border-t border-slate-100 pt-5">
								<h4 class="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">Adelanto inicial</h4>
								{#if isCheckingAdelanto}
									<p class="text-xs text-slate-400">Verificando si ya se registró un adelanto...</p>
								{:else if adelantoYaRegistrado}
									<div class="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 text-sm flex items-center gap-2">
										<i class="fas fa-check-circle"></i>
										<span>El adelanto ya se registró (al crear la venta o antes). No hace falta volver a subirlo.</span>
									</div>
								{:else}
									<p class="text-xs text-slate-400 mb-3">Comprobante del pago inicial que confirma la venta — obligatorio para cerrarla.</p>
									<div class="grid grid-cols-2 gap-3 mb-1 max-w-md">
										<div class="flex flex-col gap-1">
											<label class="text-xs font-semibold text-[#0f3b5e]">Monto (S/)</label>
											<input type="number" min="0.01" step="0.01" bind:value={adelantoMonto} placeholder="0.00" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all text-slate-700">
										</div>
										<div class="flex flex-col gap-1">
											<label class="text-xs font-semibold text-[#0f3b5e]">Fecha</label>
											<input type="date" bind:value={adelantoFecha} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all text-slate-700">
										</div>
									</div>
									{#if Number(adelantoMonto) > 0 && Number(montoFinalVenta) > 0 && Number(adelantoMonto) > Number(montoFinalVenta)}
										<p class="text-xs text-rose-500 mb-2">El adelanto no puede ser mayor al monto final de la venta.</p>
									{/if}
									<label class="cursor-pointer px-3 py-2 border border-dashed border-slate-300 rounded-xl text-sm text-slate-500 hover:bg-slate-50 flex items-center justify-center gap-2 transition-colors mt-2 max-w-md">
										<input type="file" accept="image/*,application/pdf" class="hidden" onchange={handleAdelantoFileGestion} />
										{#if adelantoFile}
											<i class="far fa-file-pdf text-rose-500"></i> <span class="truncate">{adelantoFile.name}</span>
										{:else}
											<i class="fas fa-cloud-upload-alt"></i> Adjuntar comprobante del adelanto
										{/if}
									</label>
								{/if}
							</div>
						{/if}
					</section>
					{/if}

					<!-- Características del proyecto nuevo (colapsable — a pedido del usuario: arranca
					     desplegada en edición y colapsada al crear una venta nueva, ver el $effect de
					     reseteo más arriba) -->
					<section class="border-t border-slate-100 pt-6">
						<button
							type="button"
							onclick={() => (caracteristicasExpanded = !caracteristicasExpanded)}
							class="w-full flex items-center justify-between gap-2 mb-4 text-left"
							aria-expanded={caracteristicasExpanded}
						>
							<span class="text-sm font-bold text-slate-800 flex items-center gap-2">
								<div class="w-1.5 h-4 bg-orange-500 rounded-full"></div>
								Características del proyecto nuevo
							</span>
							<i class={`fas fa-chevron-down text-slate-400 text-xs transition-transform ${caracteristicasExpanded ? 'rotate-180' : ''}`}></i>
						</button>
						{#if caracteristicasExpanded}
						{#if !documentosCierreListos}
							<div class="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-xs flex items-start gap-2">
								<i class="fas fa-lock mt-0.5 shrink-0"></i>
								<span>Sube el contrato, el comprobante del adelanto y marca la proforma final {mode === 'edit' ? 'en la sección de arriba' : ''} para poder completar las características del proyecto.</span>
							</div>
						{/if}
						<div class="flex gap-1 mb-4 border-b border-slate-200">
							<button
								type="button"
								onclick={() => (caracteristicasTab = 'consultoria')}
								class={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${caracteristicasTab === 'consultoria' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
							>
								Consultoría
							</button>
							<button
								type="button"
								onclick={() => (caracteristicasTab = 'obra')}
								class={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${caracteristicasTab === 'obra' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
							>
								Obra
							</button>
						</div>

						{#if caracteristicasTab === 'consultoria'}
						<div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Tipo de proyecto *</label>
								<select bind:value={tipoProyecto} disabled={!documentosCierreListos} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed">
									<option value="">-- Selecciona --</option>
									<option value="L">Licencia (L)</option>
									<option value="O">Proyecto de obra (O)</option>
									<option value="DF">Declaración de fábrica (DF)</option>
									<option value="I">Independización (I)</option>
									<option value="DF + I">Declaratoria de fábrica + Independización (DF + I)</option>
									<option value="EMS">Estudio de mecánica de suelos (EMS)</option>
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Estado del predio *</label>
								<select bind:value={estadoPredio} disabled={!documentosCierreListos} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed">
									<option value="">-- Selecciona --</option>
									<option value="A">Ampliación (A)</option>
									<option value="N">Nuevo (N)</option>
									<option value="R">Reforzamiento (R)</option>
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Tipo de edificación *</label>
								<select bind:value={tipoEdificacion} disabled={!documentosCierreListos} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed">
									<option value="">-- Selecciona --</option>
									<option value="M">Viv. Multifamiliar (M)</option>
									<option value="U">Viv. Unifamiliar (U)</option>
									<option value="C">Comercio (C)</option>
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Número de pisos *</label>
								<input type="number" bind:value={numeroPisos} disabled={!documentosCierreListos} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed">
							</div>

						</div>

						<!-- Generador de Código visual -->
						<div class="bg-blue-50/50 border border-blue-100 rounded-xl p-5 mb-2">
							<div class="flex items-start gap-3 mb-4">
								<i class="fas fa-info-circle text-blue-500 mt-0.5"></i>
								<div>
									<h4 class="text-sm font-semibold text-blue-900">Generación automática del código del proyecto</h4>
									<p class="text-xs text-blue-700/80 mt-0.5">El código se genera según los parámetros seleccionados. Verifica la información antes de guardar.</p>
								</div>
							</div>

							<!-- Visualizer -->
							<div class="flex flex-wrap items-center gap-2 text-xs font-bold justify-center md:justify-start">
								<div class="flex flex-col items-center">
									<span class="text-emerald-500 text-sm mb-1">{tipoProyecto}</span>
									<span class="text-[9px] text-slate-500 font-normal">Tipo de proyecto</span>
									<span class="text-[9px] text-slate-400 font-normal">(Obra)</span>
								</div>
								<span class="text-slate-300">-</span>
								<div class="flex flex-col items-center">
									<span class="text-blue-500 text-sm mb-1">{estadoPredio}</span>
									<span class="text-[9px] text-slate-500 font-normal">Estado del predio</span>
									<span class="text-[9px] text-slate-400 font-normal">(Ampliación)</span>
								</div>
								<span class="text-slate-300">-</span>
								<div class="flex flex-col items-center">
									<span class="text-purple-500 text-sm mb-1">{tipoEdificacion}</span>
									<span class="text-[9px] text-slate-500 font-normal">Tipo de edificación</span>
									<span class="text-[9px] text-slate-400 font-normal">(Multifamiliar)</span>
								</div>
								<span class="text-slate-300">-</span>
								<div class="flex flex-col items-center">
									<span class="text-orange-500 text-sm mb-1">{numeroPisos}</span>
									<span class="text-[9px] text-slate-500 font-normal">Nº de pisos</span>
								</div>
								<span class="text-slate-300">-</span>
								<div class="flex flex-col items-center">
									<span class="text-rose-500 text-sm mb-1">{mes}</span>
									<span class="text-[9px] text-slate-500 font-normal">Mes</span>
									<span class="text-[9px] text-slate-400 font-normal">(Febrero)</span>
								</div>
								<span class="text-slate-300">-</span>
								<div class="flex flex-col items-center">
									<span class="text-blue-600 text-sm mb-1">{anio.substring(2)}</span>
									<span class="text-[9px] text-slate-500 font-normal">Año</span>
									<span class="text-[9px] text-slate-400 font-normal">({anio})</span>
								</div>
								<span class="text-slate-300">-</span>
								<div class="flex flex-col items-center">
									<span class="text-slate-800 text-sm mb-1 px-2">{distrito}</span>
									<span class="text-[9px] text-slate-500 font-normal">Distrito</span>
								</div>
								<span class="text-slate-300">-</span>
								<div class="flex flex-col items-center">
									<span class="text-slate-800 text-sm mb-1 px-2">{clienteNombreGen}</span>
									<span class="text-[9px] text-slate-500 font-normal">Cliente</span>
								</div>
							</div>

							<div class="mt-6 flex items-center gap-4 bg-white px-4 py-3 rounded-lg border border-slate-200">
								<span class="text-sm font-bold text-slate-800">Código generado:</span>
								<div class="bg-blue-50 text-blue-700 px-4 py-1.5 rounded text-sm font-bold tracking-wide flex-1 md:flex-none flex items-center justify-between">
									{codigoGenerado}
									<button
										type="button"
										onclick={copiarCodigoGenerado}
										class="ml-4 text-blue-400 hover:text-blue-600"
										aria-label="Copiar código generado"
										title={codigoCopiado ? 'Copiado' : 'Copiar código'}
									>
										<i class={codigoCopiado ? 'fas fa-check text-emerald-500' : 'far fa-copy'}></i>
									</button>
								</div>
							</div>
						</div>
						{:else}
						<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Tipo de obra *</label>
								<!-- A pedido del usuario: EXP (Expediente Técnico) es exclusivo de la pestaña
								     Consultoría — acá solo se elige entre OBRA (ejecución) y SUP (supervisión), ese
								     valor es el prefijo del código generado y también decide el centro de costo:
								     solo OBRA y SUP crean uno propio por proyecto (igual que Consultoría ya
								     comparte uno único — ver caracteristicasTab en getOrCrearCentroCosto...). -->
								<select bind:value={tipoObra} disabled={!documentosCierreListos} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed">
									<option value="">-- Selecciona --</option>
									<option value="OBRA">Ejecución de Obra (OBRA)</option>
									<option value="SUP">Supervisión (SUP)</option>
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Tipo de trámite *</label>
								<select bind:value={tipoTramite} disabled={!documentosCierreListos} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed">
									<option value="">-- Selecciona --</option>
									<option value="L">Con licencia de edificación (L)</option>
									<option value="O">Obra Sin licencia (O)</option>
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Tipo de Intervención *</label>
								<select bind:value={tipoIntervencion} disabled={!documentosCierreListos} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed">
									<option value="">-- Selecciona --</option>
									<option value="N">Obra nueva (N)</option>
									<option value="A">Ampliación (A)</option>
									<option value="R">Reforzamiento (R)</option>
									<option value="AR">Ampliación + reforzamiento (AR)</option>
									<option value="DP">Demolición parcial (DP)</option>
									<option value="DT">Demolición total (DT)</option>
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Tipo de edificación *</label>
								<select bind:value={tipoEdificacionObra} disabled={!documentosCierreListos} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed">
									<option value="">-- Selecciona --</option>
									<option value="M">Vivienda multifamiliar (M)</option>
									<option value="U">Vivienda unifamiliar (U)</option>
									<option value="X">Comercio (X)</option>
									<option value="I">Industrial (I)</option>
									<option value="OF">Oficinas (OF)</option>
									<option value="E">Educativo (E)</option>
									<option value="S">Salud (S)</option>
									<option value="MX">Uso mixto (MX)</option>
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Número de pisos *</label>
								<input type="number" bind:value={numeroPisos} disabled={!documentosCierreListos} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed">
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Mes *</label>
								<select bind:value={mesObra} disabled={!documentosCierreListos} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed">
									<option value="">-- Selecciona --</option>
									<option value="01">Enero</option>
									<option value="02">Febrero</option>
									<option value="03">Marzo</option>
									<option value="04">Abril</option>
									<option value="05">Mayo</option>
									<option value="06">Junio</option>
									<option value="07">Julio</option>
									<option value="08">Agosto</option>
									<option value="09">Septiembre</option>
									<option value="10">Octubre</option>
									<option value="11">Noviembre</option>
									<option value="12">Diciembre</option>
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Año *</label>
								<input type="number" bind:value={anioObra} disabled={!documentosCierreListos} placeholder="Ej. 2026" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed">
							</div>
						</div>

						<div class="mt-6 flex items-center gap-4 bg-white px-4 py-3 rounded-lg border border-slate-200">
							<span class="text-sm font-bold text-slate-800">Código generado:</span>
							<div class="bg-blue-50 text-blue-700 px-4 py-1.5 rounded text-sm font-bold tracking-wide flex-1 md:flex-none flex items-center justify-between">
								{codigoGenerado}
								<button
									type="button"
									onclick={copiarCodigoGenerado}
									class="ml-4 text-blue-400 hover:text-blue-600"
									aria-label="Copiar código generado"
									title={codigoCopiado ? 'Copiado' : 'Copiar código'}
								>
									<i class={codigoCopiado ? 'fas fa-check text-emerald-500' : 'far fa-copy'}></i>
								</button>
							</div>
						</div>
						{/if}
						{/if}
					</section>

					<!-- Observaciones -->
					<section class="border-t border-slate-100 pt-6">
						<h3 class="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
							<div class="w-1.5 h-4 bg-purple-500 rounded-full"></div>
							Observaciones
						</h3>
						<div class="relative">
							<textarea bind:value={observaciones} placeholder="Ingresa observaciones adicionales sobre la venta (opcional)" rows="3" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all resize-none"></textarea>
							<div class="absolute bottom-3 right-3 text-[10px] text-slate-400">
								{observaciones.length}/500
							</div>
						</div>
					</section>
				</div>
			</div>
			{/if}

			<!-- Footer -->
			<div class="p-6 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex justify-end gap-3">
				<button onclick={onClose} class="px-5 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 hover:text-slate-800 font-medium text-sm transition-colors shadow-sm">
					Cancelar
				</button>
				<button onclick={() => !isSaving && handleGuardar()} disabled={isSaving} aria-busy={isSaving} class="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-medium text-sm shadow-md shadow-blue-600/20 active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
					{#if isSaving}
						<i class="fas fa-spinner fa-spin"></i> Guardando...
					{:else}
						<i class="fas fa-save"></i> {mode === 'edit' ? 'Guardar cambios' : 'Guardar venta'}
					{/if}
				</button>
				{#if mode === 'edit' && localEstado !== 'venta_cerrada'}
					<button
						onclick={handleCerrarVenta}
						disabled={!canClose || isClosing}
						title={!canClose ? 'Completa todos los campos obligatorios (*) de Información general y Características, sube el contrato, marca una proforma como final, confirma el monto final de la venta y adjunta el comprobante del adelanto (monto ≤ monto final, con fecha) para poder cerrar la venta' : ''}
						class="px-6 py-2.5 bg-emerald-600 text-white rounded-xl font-medium text-sm shadow-md shadow-emerald-600/20 active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{#if isClosing}
							<i class="fas fa-spinner fa-spin"></i> Cerrando...
						{:else}
							<i class="fas fa-lock"></i> Cerrar venta
						{/if}
					</button>
				{/if}
				{#if mode === 'create'}
					<button
						onclick={handleGuardarYCerrarVenta}
						disabled={!canCloseCreate || isClosing || isSaving}
						title={!canCloseCreate ? 'Completa todos los campos obligatorios (*) de Información general y Características, adjunta el contrato, agrega al menos una proforma y márcala como final, y adjunta el comprobante del adelanto (monto ≤ valor de venta, con fecha) para registrar y cerrar la venta de una vez' : ''}
						class="px-6 py-2.5 bg-emerald-600 text-white rounded-xl font-medium text-sm shadow-md shadow-emerald-600/20 active:scale-[0.98] transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
