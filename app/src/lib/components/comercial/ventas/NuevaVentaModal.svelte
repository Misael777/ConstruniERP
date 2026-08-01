<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { uploadProjectDocument, deleteProjectDocumentFile } from '$lib/shared/uploadProjectDocument';
	import { sanitizeFileSegment } from '$lib/shared/fileNaming';
	import { describeError } from '$lib/shared/describeError';
	import { getOrCrearCentroCostoParaEntidad, getOrCrearCentroCostoCompartido } from '$lib/modules/centro-costos/services/centroCostos.service';
	import { createTransaccion } from '$lib/modules/transacciones/services/transacciones.service';
	import { permisosState } from '$lib/stores/permisos.svelte';
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
	let fechaVenta = $state('2026-05-20');
	let asesor = $state('');
	let clientes = $state<any[]>([]);
	let selectedClienteId = $state<string>('');
	let nuevoClienteNombre = $state('');
	let valorVenta = $state('15000.00');
	let comisionPorcentaje = $state('10');
	let direccionPredio = $state('');

	let contratoFile = $state<File | null>(null);
	let proformaFiles = $state<File[]>([]);
	// Adelanto inicial (opcional acá, solo en modo creación) — mismo criterio que en la sección de
	// gestión al cerrar la venta: el monto solo se habilita una vez adjuntado el comprobante. Si se
	// completa acá, no hace falta volver a pedirlo al cerrar la venta (ver checkAdelantoExistente).
	let adelantoFile = $state<File | null>(null);
	let adelantoMonto = $state('');

	// Generation fields
	let tipoProyecto = $state('');
	let estadoPredio = $state('');
	let tipoEdificacion = $state('');
	let tipoEdificacion2 = $state('');
	let numeroPisos = $state('');
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
	// A pedido del usuario: "Información general" arranca colapsada cada vez que se abre el popup.
	let infoGeneralExpanded = $state(false);

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
	let adelantoFecha = $state(new Date().toISOString().slice(0, 10));
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
			infoGeneralExpanded = false;
			if (mode === 'edit' && ventaId) {
				loadVentaParaEditar(ventaId);
			} else {
				proyectoNombre = '';
				fechaVenta = new Date().toISOString().slice(0, 10);
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
				departamento = 'Lima';
				provincia = 'Lima';
				distrito = '';
				contratoFile = null;
				proformaFiles = [];
				adelantoFile = null;
				adelantoMonto = '';
				adelantoFecha = new Date().toISOString().slice(0, 10);
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
			fechaVenta = data.fecha_inicio_plan || new Date().toISOString().slice(0, 10);
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
			adelantoFecha = new Date().toISOString().slice(0, 10);

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

let codigoGenerado = $derived(
	`${tipoProyecto}${estadoPredio}${tipoEdificacion}${numeroPisos}_${mes}${anio.substring(2)}_${sanitizeFileSegment(distrito)}_${sanitizeFileSegment(getClienteNombreActual() || 'Cliente')}`
);

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

	let canClose = $derived(
		mode === 'edit' &&
		localEstado !== 'venta_cerrada' &&
		!!localContratoUrl &&
		selectedFinalId !== null &&
		Number(montoFinalVenta) > 0 &&
		(adelantoYaRegistrado || (!!adelantoFile && Number(adelantoMonto) > 0 && Number(adelantoMonto) <= Number(montoFinalVenta) && !!adelantoFecha))
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
			if (!adelantoYaRegistrado && adelantoFile) {
				// 1. Centro de costo del proyecto y del cliente (idempotente — ya existen en casi todos
				// los casos; se re-consultan aquí como respaldo). Obra: centro de costo propio del
				// proyecto. Consultoría: el único compartido entre todas las ventas de ese tipo.
				const idCentroProyecto = caracteristicasTab === 'consultoria'
					? await getOrCrearCentroCostoCompartido(supabase, 'consultoria')
					: await getOrCrearCentroCostoParaEntidad(supabase, 'proyecto', Number(ventaId), proyectoNombre);
				if (!idCentroProyecto) throw new Error('No se pudo obtener el centro de costo del proyecto.');

				if (!selectedClienteId || selectedClienteId === '__new__') throw new Error('El proyecto no tiene un cliente asociado — no se puede registrar el adelanto.');
				const idCentroCliente = await getOrCrearCentroCostoParaEntidad(
					supabase, 'cliente', Number(selectedClienteId), getClienteNombreActual() || `Cliente #${selectedClienteId}`
				);
				if (!idCentroCliente) throw new Error('No se pudo obtener el centro de costo del cliente.');

				// 2. Comprobante del adelanto.
				const { url: comprobanteUrl } = await uploadProjectDocument(adelantoFile, {
					type: 'comprobante',
					projectId: ventaId,
					projectName: proyectoNombre
				});

				// 3. Transacción del adelanto — origen = centro de costo del cliente (de donde sale el
				// dinero), destino = centro de costo del proyecto (donde entra). Solo si esto tiene
				// éxito se procede a cerrar la venta — si falla, la venta queda como estaba.
				const { data: userData } = await supabase.auth.getUser();
				const transResult = await createTransaccion(
					supabase,
					{
						tipo_alcance: 'externa',
						id_centro_costo_origen: idCentroCliente,
						id_centro_costo_destino: idCentroProyecto,
						fecha: adelantoFecha,
						monto_total: Number(adelantoMonto),
						tipo: 'ingreso',
						estado: 'activo',
						comprobante_url: comprobanteUrl,
						descripcion: `Adelanto inicial - ${proyectoNombre} (proyecto #${ventaId})`
					},
					userData?.user?.email ?? null,
					permisosState.userName || null
				);
				if (!transResult.success) throw new Error(transResult.message || 'No se pudo registrar la transacción del adelanto.');
			}

			// 4. Recién con el adelanto confirmado: fijar la proforma final y cerrar la venta.
			const { error: clearError } = await supabase
				.from('documento_proyecto')
				.update({ es_proforma_final: false })
				.eq('id_proyecto', ventaId)
				.eq('es_proforma_final', true);
			if (clearError) throw clearError;

			const { error: setError } = await supabase
				.from('documento_proyecto')
				.update({ es_proforma_final: true })
				.eq('id_documento', selectedFinalId);
			if (setError) throw setError;

			const { error: closeError } = await supabase
				.from('proyecto')
				.update({ estado_proyecto: 'venta_cerrada', precio_venta: Number(montoFinalVenta) })
				.eq('id_proyecto', ventaId);
			if (closeError) throw closeError;

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

	async function handleGuardar() {
		console.log('[NuevaVentaModal] === INICIO handleGuardar ===');
	try {
		console.log('[NuevaVentaModal] Estado inicial:', {
			mode,
			proyectoNombre,
			fechaVenta,
			asesor,
			selectedClienteId,
			nuevoClienteNombre,
			valorVenta,
			comisionPorcentaje,
			contratoFile: contratoFile?.name || null,
			proformaFiles: proformaFiles.map((f) => f.name)
		});

		saveError = '';

		// === Validación 1: Nombre del proyecto ===
		console.log('[NuevaVentaModal] Validando nombre del proyecto...');
		if (!proyectoNombre.trim()) {
			saveError = 'Debes ingresar un nombre de proyecto.';
			console.warn('[NuevaVentaModal] ❌ ERROR: Nombre del proyecto vacío');
			return;
		}
		console.log('[NuevaVentaModal] ✓ Nombre del proyecto OK:', proyectoNombre);

		// === Validación 2: Fecha de venta ===
		console.log('[NuevaVentaModal] Validando fecha de venta...');
		if (!fechaVenta) {
			saveError = 'Debes seleccionar la fecha de venta.';
			console.warn('[NuevaVentaModal] ❌ ERROR: Fecha de venta vacía');
			return;
		}
		console.log('[NuevaVentaModal] ✓ Fecha de venta OK:', fechaVenta);

		// === Determinación del Cliente ID ===
		console.log('[NuevaVentaModal] Determinando cliente ID...');
		console.log('[NuevaVentaModal]   selectedClienteId:', selectedClienteId);
		console.log('[NuevaVentaModal]   nuevoClienteNombre:', nuevoClienteNombre);
		console.log('[NuevaVentaModal]   clienteNombreGen:', clienteNombreGen);

		let clienteId: number | null = null;

		if (selectedClienteId && selectedClienteId !== '__new__') {
			// Cliente seleccionado del dropdown
			clienteId = Number(selectedClienteId);
			console.log('[NuevaVentaModal] ✓ Cliente seleccionado del dropdown, ID:', clienteId);
		} else if (selectedClienteId === '__new__') {
			// Crear nuevo cliente
			console.log('[NuevaVentaModal] Opción "Nuevo cliente" seleccionada');
			if (!nuevoClienteNombre.trim()) {
				saveError = 'Debes ingresar el nombre del cliente.';
				console.warn('[NuevaVentaModal] ❌ ERROR: Nombre del nuevo cliente vacío');
				return;
			}
			console.log('[NuevaVentaModal] Creando nuevo cliente:', nuevoClienteNombre);
			clienteId = await ensureCliente(nuevoClienteNombre);
			console.log('[NuevaVentaModal] Nuevo cliente creado con ID:', clienteId);
		} else {
			const nombreClienteFallback = getClienteNombreActual().trim();
			if (!nombreClienteFallback) {
				saveError = 'Debes seleccionar o ingresar el nombre del cliente.';
				console.warn('[NuevaVentaModal] ❌ ERROR: Cliente fallback vacío');
				return;
			}
			console.log('[NuevaVentaModal] Buscando o creando cliente:', nombreClienteFallback);
			clienteId = await ensureCliente(nombreClienteFallback);
			console.log('[NuevaVentaModal] Cliente obtenido/creado con ID:', clienteId);
		}

		if (!clienteId) {
			saveError = 'No se pudo obtener o crear el cliente.';
			console.error('[NuevaVentaModal] ❌ ERROR: No se pudo obtener clienteId');
			return;
		}
		console.log('[NuevaVentaModal] ✓ clienteId final:', clienteId);

		// === Preparación de datos ===
		console.log('[NuevaVentaModal] Preparando datos para inserción...');
		const precioVenta = Number(valorVenta) || 0;
		const comision = Number(comisionPorcentaje) || 0;
		const numeroPisosValue = Number(numeroPisos) || null;
		const fechaInicio = fechaVenta;
		const asesorFinal = (asesor || '').trim() || await resolveCurrentAsesorName();
		const clienteNombreFinal = getClienteNombreActual().trim();
		const { data: { session } } = await supabase.auth.getSession();
		const asesorUserId = session?.user?.id ?? null;
		asesor = asesorFinal;

		console.log('[NuevaVentaModal] Datos calculados:', {
			precioVenta,
			comision,
			numeroPisosValue,
			fechaInicio,
			clienteNombreFinal
		});

		isSaving = true;
		console.log('[NuevaVentaModal] isSaving = true');

		// === Modo edición: UPDATE de los campos generales, sin tocar estado_proyecto (solo "Cerrar
		// venta" lo cambia) ni asesor_comercial_id/usuario_registro (deben seguir apuntando al asesor
		// original — ventas/+page.svelte los usa para filtrar "mis ventas" de un no-administrador; si
		// un admin edita la venta de otro asesor, no debe reasignarse solo por guardar cambios). ===
		if (mode === 'edit' && ventaId) {
			const proyectoUpdatePayload = {
				id_cliente: clienteId,
				nombre_proyecto: proyectoNombre,
				fecha_inicio_plan: fechaInicio,
				precio_venta: precioVenta,
				comision_asesor: comision,
				responsable: asesorFinal,
				tip_proyecto: tipoProyecto,
				estado_predio: estadoPredio,
				tipo_edifica: tipoEdificacion,
				tipo_edificacion2: tipoEdificacion2 || null,
				nro_pisos: numeroPisosValue,
				distrito: distrito ? distrito.substring(0, 4).trim() : null,
				provincia: provincia ? provincia.substring(0, 4).trim() : null,
				departamento: departamento ? departamento.substring(0, 4).trim() : null,
				costo_estima: precioVenta,
				tipo_venta: caracteristicasTab,
				ubicacion: distrito,
				direccion_predio: direccionPredio?.trim() ? direccionPredio.trim() : null,
				descripcion: observaciones?.trim() ? observaciones.trim() : null
			};

			console.log('[NuevaVentaModal] Payload de edición para proyecto:', proyectoUpdatePayload);
			const { error } = await supabase.from('proyecto').update(proyectoUpdatePayload).eq('id_proyecto', ventaId);

			isSaving = false;
			if (error) {
				console.error('[NuevaVentaModal] Error al actualizar proyecto:', error);
				saveError = `Error guardando los cambios: ${error.message ?? 'Error desconocido.'}`;
				return;
			}

			console.log('[NuevaVentaModal] ✓ Cambios guardados. Permanece abierto para seguir gestionando la venta.');
			onSaved();
			return;
		}

		// === Construcción del Payload (modo creación) ===
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
			tipo_edificacion2: tipoEdificacion2 || null,
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

		console.log('[NuevaVentaModal] Payload para proyecto:', proyectoPayload);

		// === INSERT proyecto ===
		console.log('[NuevaVentaModal] Insertando proyecto en Supabase...');
		console.log('[NuevaVentaModal] Llamando a supabase.from("proyecto").insert()...');

		const { data, error } = await supabase
			.from('proyecto')
			.insert([proyectoPayload])
			.select('id_proyecto')
			.single();

		if (error) {
			console.error('[NuevaVentaModal] Error al insertar proyecto:', error);
			saveError = `Error guardando la venta: ${error.message ?? 'Error desconocido.'}`;
			isSaving = false;
			return;
		}

		console.log('[NuevaVentaModal] ✓ Proyecto insertado exitosamente');
		console.log('[NuevaVentaModal] Datos retornados:', data);

		if (data?.id_proyecto) {
			const nuevoProyectoId = data.id_proyecto;
			console.log('[NuevaVentaModal] Nuevo ID_PROYECTO:', nuevoProyectoId);

			// === Centro de costo del proyecto (getOrCrear — idempotente, ver centroCostos.service.ts) ===
			// Obra: cada venta tiene su PROPIO centro de costo (comportamiento de siempre). Consultoría:
			// TODAS las ventas de consultoría comparten UN ÚNICO centro de costo — a pedido explícito
			// del usuario (ver getOrCrearCentroCostoCompartido).
			console.log('[NuevaVentaModal] Asegurando centro de costo del proyecto...', caracteristicasTab);
			const idCentroCosto = caracteristicasTab === 'consultoria'
				? await getOrCrearCentroCostoCompartido(supabase, 'consultoria')
				: await getOrCrearCentroCostoParaEntidad(supabase, 'proyecto', nuevoProyectoId, proyectoNombre);
			if (!idCentroCosto) {
				console.warn('[NuevaVentaModal] No se pudo crear el centro de costo del proyecto — la venta se guardó, pero las transacciones de sus cobros/pagos no van a poder generarse hasta que exista.');
			} else {
				console.log('[NuevaVentaModal] ✓ Centro de costo del proyecto listo, id:', idCentroCosto);
			}

			// === UPLOAD documentos ===
			try {
				console.log('[NuevaVentaModal] Verificando documentos para subir...');
				console.log('[NuevaVentaModal]   contratoFile:', contratoFile ? `${contratoFile.name} (${contratoFile.size} bytes)` : 'null');
				console.log('[NuevaVentaModal]   proformaFiles:', proformaFiles.map((f) => `${f.name} (${f.size} bytes)`));

				if (contratoFile) {
					console.log('[NuevaVentaModal] Subiendo contrato...');
					const contratoUrl = await uploadDocument('contrato', contratoFile, nuevoProyectoId, proyectoNombre);
					console.log('[NuevaVentaModal] ✓ Contrato subido exitosamente. URL:', contratoUrl);
					await supabase.from('proyecto').update({ contrato: contratoUrl }).eq('id_proyecto', nuevoProyectoId);
				}

				// Cada proforma se registra como una fila propia en documento_proyecto — la venta
				// puede tener varias mientras sigue en negociación (ver la sección de gestión de este
				// mismo modal en modo edición, donde luego se elige cuál es la final para cerrar).
				for (const file of proformaFiles) {
					console.log('[NuevaVentaModal] Subiendo proforma:', file.name);
					const proformaUrl = await uploadDocument('proforma', file, nuevoProyectoId, proyectoNombre);
					console.log('[NuevaVentaModal] ✓ Proforma subida exitosamente. URL:', proformaUrl);

					const { error: docError } = await supabase.from('documento_proyecto').insert({
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
					});
					if (docError) throw docError;
				}

				// Adelanto inicial — mismo mecanismo que "Cerrar venta": asegura el centro de costo del
				// cliente, sube el comprobante y crea la transacción (ingreso) de una vez. Requiere
				// ambos (archivo Y monto) — el campo de monto ya viene deshabilitado en el formulario
				// mientras no haya comprobante adjunto.
				if (adelantoFile && Number(adelantoMonto) > 0) {
					console.log('[NuevaVentaModal] Registrando adelanto inicial...');
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
						session?.user?.email ?? null,
						permisosState.userName || null
					);
					if (!transResult.success) throw new Error(transResult.message || 'No se pudo registrar la transacción del adelanto.');
					console.log('[NuevaVentaModal] ✓ Adelanto inicial registrado');
				}

				console.log('[NuevaVentaModal] ✓ Todos los documentos procesados');
			} catch (uploadError) {
				console.error('[NuevaVentaModal] Error al subir documentos:', uploadError);
				saveError = String(uploadError instanceof Error ? uploadError.message : uploadError);
				isSaving = false;
				return;
			}
		} else {
			console.warn('[NuevaVentaModal] ⚠️ Advertencia: data no contiene id_proyecto');
		}

		// === Finalización ===
		isSaving = false;
		console.log('[NuevaVentaModal] isSaving = false');
		console.log('[NuevaVentaModal] Llamando onSaved()...');
		onSaved();
		console.log('[NuevaVentaModal] Llamando onClose()...');
		onClose();
		console.log('[NuevaVentaModal] === FIN handleGuardar (exitoso) ===');
	} catch (fatal: unknown) {
		console.error('[NuevaVentaModal] Error inesperado:', fatal);
		saveError = `Error inesperado: ${fatal instanceof Error ? fatal.message : String(fatal)}`;
		isSaving = false;
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
										<option value={c.id_cliente}>{c.nombre}</option>
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
									disabled={!contratoPresente}
									title={!contratoPresente ? 'Adjunta el contrato para poder ingresar el valor de venta' : ''}
									class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all text-slate-700 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
								>
								{#if !contratoPresente}
									<span class="text-[10px] text-slate-400 mt-0.5">Adjunta el contrato para habilitar este campo</span>
								{/if}
							</div>
							<div class="flex flex-col gap-1 md:col-span-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Dirección del predio</label>
								<input type="text" bind:value={direccionPredio} placeholder="Ej. Jr. Los Álamos 123" class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all text-slate-700">
							</div>
							<div class="flex flex-col gap-1 md:col-span-1 grid grid-cols-2 gap-2">
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
							<div class="flex flex-col gap-1 md:col-span-1 grid grid-cols-2 gap-2">
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
											{#each proformaFiles as file, i}
												<div class="flex items-center justify-between gap-2 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
													<span class="truncate">{file.name}</span>
													<button type="button" onclick={() => proformaFiles = proformaFiles.filter((_, idx) => idx !== i)} class="text-slate-400 hover:text-rose-600 shrink-0" aria-label="Quitar proforma">
														<i class="fas fa-times"></i>
													</button>
												</div>
											{/each}
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

					<!-- Características del proyecto nuevo -->
					<section class="border-t border-slate-100 pt-6">
						<h3 class="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
							<div class="w-1.5 h-4 bg-orange-500 rounded-full"></div>
							Características del proyecto nuevo
						</h3>

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
								<select bind:value={tipoProyecto} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
									<option value="">-- Selecciona --</option>
									<option value="O">Proyecto de Obra (O)</option>
									<option value="M">Mantenimiento (M)</option>
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Estado del predio *</label>
								<select bind:value={estadoPredio} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
									<option value="">-- Selecciona --</option>
									<option value="A">Ampliación (A)</option>
									<option value="N">Nuevo (N)</option>
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Tipo de edificación *</label>
								<select bind:value={tipoEdificacion} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
									<option value="">-- Selecciona --</option>
									<option value="M">Viv. Multifamiliar (M)</option>
									<option value="U">Viv. Unifamiliar (U)</option>
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Tipo de edificación (2) *</label>
								<select bind:value={tipoEdificacion2} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
									<option value="">-- Selecciona --</option>
									<option value="F">Familiar (F)</option>
									<option value="C">Comercial (C)</option>
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Número de pisos *</label>
								<input type="number" bind:value={numeroPisos} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all">
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
									<button class="ml-4 text-blue-400 hover:text-blue-600"><i class="far fa-copy"></i></button>
								</div>
							</div>
						</div>
						{:else}
						<p class="text-sm text-slate-400 text-center py-10">Todavía no hay campos configurados para Obra.</p>
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
						title={!canClose ? 'Sube el contrato, marca una proforma como final, confirma el monto final de la venta y adjunta el comprobante del adelanto (monto ≤ monto final, con fecha) para poder cerrar la venta' : ''}
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
