<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { uploadProjectDocument, deleteProjectDocumentFile } from '$lib/shared/uploadProjectDocument';
	import { sanitizeFileSegment } from '$lib/shared/fileNaming';
	import { describeError } from '$lib/shared/describeError';
	import { getOrCrearCentroCostoParaEntidad, getOrCrearCentroCostoCompartido } from '$lib/modules/centro-costos/services/centroCostos.service';
	import { createTransaccion, type Transaccion } from '$lib/modules/transacciones/services/transacciones.service';
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
		onSaved = () => {},
		onTransaccionSugerida = () => {}
	} = $props<{
		isOpen?: boolean;
		/** 'edit' reutiliza este mismo popup para editar una venta existente — a pedido del usuario,
		 * en vez de navegar a /proyectos/gestion/{id}. Trae además la gestión de proformas, contrato y
		 * cierre de venta (antes en ProformasVentaModal.svelte, ahora fusionada acá). */
		mode?: 'create' | 'edit';
		ventaId?: number | null;
		onClose?: () => void;
		onSaved?: () => void;
		/** A pedido del usuario: al cerrar una venta, la transacción (ingreso) del adelanto recién
		 * creada se pasa hacia arriba para que el padre (comercial/ventas/+page.svelte) abra el popup de
		 * Transacciones ya prellenado con ella, para completar ahí los datos que el cierre de venta no
		 * pide (tipo de documento, N° de documento, forma/medio de pago, categoría) — mismo patrón que
		 * `onTransaccionSugerida` en CobroModal.svelte/PagoModal.svelte. Solo se llama cuando el cierre
		 * SÍ generó una transacción nueva (si el adelanto ya estaba registrado de antes, no hay nada que
		 * completar). El segundo argumento trae el nombre del cliente y el código del proyecto YA
		 * resueltos acá (frescos, no lo que haya quedado guardado en `centro_costo.nombre`, que puede
		 * estar desactualizado) — a pedido del usuario, el padre los usa para que el <select> de Origen
		 * muestre el centro de costo + nombre del CLIENTE, y el de Destino el centro de costo + código
		 * del PROYECTO de esta misma venta, en vez de lo que sea que diga la etiqueta genérica. */
		onTransaccionSugerida?: (transaccion: Transaccion, contexto: { clienteNombre: string; proyectoCodigo: string }) => void;
	}>();

	// Opciones de "Tipo de proyecto", "Estado del predio" y "Tipo de edificación" (Consultoría) — a
	// pedido del usuario, dropdowns de selección ÚNICA (sin checkboxes: se probó selección múltiple con
	// checkboxes en una iteración anterior, pero el usuario pidió volver a un dropdown simple). "DF + I"
	// queda como una opción fija propia de Tipo de proyecto (no se arma combinando dos checkboxes).
	const TIPO_PROYECTO_OPTIONS = [
		{ value: 'L', label: 'Licencia' },
		{ value: 'O', label: 'Proyecto de obra' },
		{ value: 'DF', label: 'Declaración de fábrica' },
		{ value: 'I', label: 'Independización' },
		{ value: 'DF + I', label: 'Declaratoria de fábrica + Independización' },
		{ value: 'EMS', label: 'Estudio de mecánica de suelos' }
	];
	const ESTADO_PREDIO_OPTIONS = [
		{ value: 'A', label: 'Ampliación' },
		{ value: 'N', label: 'Nuevo' },
		{ value: 'R', label: 'Reforzamiento' },
		{ value: 'DP', label: 'Demolición Parcial' },
		{ value: 'DT', label: 'Demolición total' }
	];
	const TIPO_EDIFICACION_OPTIONS = [
		{ value: 'M', label: 'Viv. Multifamiliar' },
		{ value: 'U', label: 'Viv. Unifamiliar' },
		{ value: 'C', label: 'Comercio' },
		{ value: 'I', label: 'Industrial' },
		{ value: 'OF', label: 'Oficinas' },
		{ value: 'E', label: 'Educativo' },
		{ value: 'S', label: 'Salud' },
		{ value: 'MX', label: 'Uso Mixto' }
	];

	// Campos de "Obra" (a pedido del usuario) — reemplazan por completo al esquema anterior (Tipo de
	// trámite/Tipo de Intervención/Tipo de edificación), siguiendo el esquema de 4 códigos:
	// {Tipo de Servicio}-{Permiso Municipal}{Alcance de Obra}{Tipo de Contratación} — todos de
	// selección ÚNICA (no admiten combinar varias letras, por eso son <select>, no checkboxes).
	// "Tipo de Servicio" reusa tipoObra (OBRA/SUP, sin cambios). "Permiso Municipal" reusa tipoTramite
	// (antes L/O, ahora L/S). "Alcance de Obra" y "Tipo de Contratación" reusan las columnas
	// tipo_intervencion/tipo_edificacion_obra (antes multi-selección con checkboxes, ver historial de
	// este archivo) — vuelven a ser selección única porque el nuevo esquema no combina letras.
	const PERMISO_MUNICIPAL_OPTIONS = [
		{ value: 'L', label: 'Con permiso' },
		{ value: 'S', label: 'Sin permiso' }
	];
	const ALCANCE_OBRA_OPTIONS = [
		{ value: 'R', label: 'Casco rojo' },
		{ value: 'G', label: 'Casco gris' },
		{ value: 'A', label: 'Acabados' },
		{ value: 'L', label: 'Llave en mano' }
	];
	const TIPO_CONTRATACION_OPTIONS = [
		{ value: 'A', label: 'Administración' },
		{ value: 'C', label: 'Contrata' },
		{ value: 'S', label: 'Subcontrata' },
		{ value: 'P', label: 'Por partidas' }
	];

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
	// "Tipo de proyecto"/"Estado del predio"/"Tipo de edificación" (Consultoría) — dropdowns de
	// selección ÚNICA (a pedido del usuario, sin checkboxes — ver TIPO_PROYECTO_OPTIONS más arriba).
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
	// arriba. Se guardan en tipo_obra/tipo_tramite/alcance_obra/tipo_contratacion/mes_obra/anio_obra
	// (ver proyectoPayload/proyectoUpdatePayload) — columnas agregadas por
	// proyecto_caracteristicas_obra_migration.sql y proyecto_codigo_obra_migration.sql, hay que correr
	// esas migraciones antes de usar esta pestaña o el guardado falla con "column does not exist".
	let tipoObra = $state('');
	// "Permiso Municipal" (antes "Tipo de trámite") — reusa esta misma variable/columna.
	let tipoTramite = $state('');
	// "Alcance de Obra" / "Tipo de Contratación" — selección ÚNICA (ver nota más arriba, junto a
	// ALCANCE_OBRA_OPTIONS/TIPO_CONTRATACION_OPTIONS), reusan tipo_intervencion/tipo_edificacion_obra.
	let tipoIntervencion = $state('');
	let tipoEdificacionObra = $state('');
	// Mes y Año propios de Obra (a diferencia de Consultoría, que los deriva solo de Fecha de venta
	// para el visualizador del código) — el usuario los pide como campos aparte para pedir directamente.
	let mesObra = $state('');
	let anioObra = $state('');
	let departamento = $state('Lima');
	let provincia = $state('Lima');
	let distrito = $state('');
	// Solo Obra (a pedido del usuario): número consecutivo que distingue proyectos que caen en el
	// mismo distrito — se guarda en `ubicacion` como "{distrito}_{N}" (ej. "Breña_1", "Breña_2"), ver
	// resolverNumeroDistrito/distritoParaGuardar más abajo. null mientras no aplica (Consultoría, o
	// Obra sin distrito elegido todavía).
	let distritoNumero = $state<number | null>(null);
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
	// A pedido explícito del usuario: ya NO arranca con 'consultoria' por defecto — el nuevo dropdown
	// "Tipo de Proyecto" (junto a "Código de proyecto", ver más abajo) obliga a elegir explícitamente
	// antes de generar el código y de habilitar "Características del proyecto nuevo". null = todavía
	// sin elegir (solo posible en modo creación; loadVentaParaEditar siempre lo fija a un valor real).
	let caracteristicasTab = $state<'consultoria' | 'obra' | null>(null);
	// A pedido del usuario: "Información general" arranca colapsada cada vez que se abre el popup
	// (en edición) o desplegada (en creación) — ver el $effect de reseteo más abajo, que fija el
	// valor inicial correcto según `mode` cada vez que se abre.
	let infoGeneralExpanded = $state(false);
	let caracteristicasExpanded = $state(false);

	// ── Estado exclusivo del modo edición: carga inicial + gestión de proformas/contrato/cierre ──
	// (fusionado desde el antiguo ProformasVentaModal.svelte — mismo popup ahora, a pedido del usuario)
	let isLoadingVenta = $state(false);
	// Fila cruda de `proyecto` tal como vino de loadVentaParaEditar — se conserva para poder armar un
	// snapshot "anterior" al enviar una solicitud de edición (ver payloadAnterior en handleGuardar),
	// sin tener que repetir el fetch. Null en modo creación.
	let ventaOriginalRaw = $state<any>(null);
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
				distritoNumero = null;
				contratoFile = null;
				proformaFiles = [];
				selectedFinalFileIndex = null;
				adelantoFile = null;
				adelantoMonto = '';
				adelantoFecha = getFechaLocalHoy();
				observaciones = '';
				// A pedido explícito del usuario: arranca sin elegir, obliga a elegir en el nuevo dropdown
				// "Tipo de Proyecto" (ver su declaración más arriba).
				caracteristicasTab = null;
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

			ventaOriginalRaw = data;
			proyectoNombre = data.nombre_proyecto || '';
			// Mismo criterio y mismo orden de respaldo que la columna "Fecha" del listado de Ventas (ver
			// fechaRaw en comercial/ventas/+page.svelte: fecha_inicio_plan, y si no hay, created_at) —
			// antes esto solo miraba fecha_inicio_plan y caía directo a "hoy" si estaba vacía, lo que
			// podía mostrar una fecha distinta a la que el listado ya mostraba para la misma venta.
			// El .slice(0, 10) corta cualquier timestamp completo a solo la fecha (YYYY-MM-DD): sin esto,
			// un valor con hora/zona horaria (ej. created_at) podía desplazar el día mostrado en el
			// <input type="date"> por la diferencia de huso horario.
			fechaVenta = ((data.fecha_inicio_plan || data.created_at) as string | null)?.slice(0, 10) || getFechaLocalHoy();
			selectedClienteId = data.id_cliente ? String(data.id_cliente) : '';
			// Blindaje: el cliente de ESTA venta puede no estar (todavía, o nunca) en `clientes` — la
			// carga general (loadClientes) es asíncrona y puede no haber terminado, además de haber
			// tenido antes un tope de 200 registros (ver loadClientes). Sin su propia opción en la
			// lista, el <select> de "Clientes" se ve vacío aunque selectedClienteId sí tenga el id
			// correcto. `data.cliente` ya viene con el nombre por el JOIN de este mismo select.
			if (data.id_cliente && !clientes.some((c) => String(c.id_cliente) === String(data.id_cliente))) {
				clientes = [...clientes, { id_cliente: data.id_cliente, nombre: (data as any).cliente?.nombre || `Cliente #${data.id_cliente}` }];
			}
			nuevoClienteNombre = '';
			valorVenta = data.precio_venta != null ? String(data.precio_venta) : '';
			comisionPorcentaje = data.comision_asesor != null ? String(data.comision_asesor) : '';
			direccionPredio = data.direccion_predio || '';
			// tip_proyecto/estado_predio se guardan como letras unidas por "+" (ej. "L+O") cuando el
			// usuario marcó varios checkboxes — se separan de vuelta acá para precargar la selección.
			tipoProyecto = data.tip_proyecto || '';
			estadoPredio = data.estado_predio || '';
			tipoEdificacion = data.tipo_edifica || '';
			tipoEdificacion2 = data.tipo_edificacion2 || '';
			numeroPisos = data.nro_pisos != null ? String(data.nro_pisos) : '';
			tipoObra = data.tipo_obra || '';
			tipoTramite = data.tipo_tramite || '';
			tipoIntervencion = data.tipo_intervencion || '';
			tipoEdificacionObra = data.tipo_edificacion_obra || '';
			mesObra = data.mes_obra || '';
			anioObra = data.anio_obra != null ? String(data.anio_obra) : '';
			departamento = resolveTruncatedOption(DEPARTAMENTOS, data.departamento) || 'Lima';
			provincia = resolveTruncatedOption(PROVINCIAS_POR_DEPARTAMENTO[departamento] ?? [], data.provincia) || 'Lima';
			// `ubicacion` guarda el distrito SIN truncar (ver payload de guardado) — se prefiere sobre
			// la columna `distrito` (VARCHAR(4)) que sí queda truncada. En Obra, `ubicacion` trae el
			// número consecutivo PEGADO sin separador (ej. "Breña1", ver distritoParaGuardar/
			// resolverNumeroDistrito) — se separa acá para no romper el <select> de Distrito (sus
			// <option> son nombres planos) y para NO reasignar un número nuevo al reabrir para editar.
			const ubicacionGuardada = data.ubicacion || resolveTruncatedOption(DISTRITOS_POR_PROVINCIA[provincia] ?? [], data.distrito) || '';
			if (data.tipo_venta === 'obra') {
				const match = /^(\D+)(\d+)$/.exec(ubicacionGuardada);
				distrito = match ? match[1] : ubicacionGuardada;
				distritoNumero = match ? Number(match[2]) : null;
			} else {
				distrito = ubicacionGuardada;
				distritoNumero = null;
			}
			observaciones = data.descripcion || '';
			caracteristicasTab = data.tipo_venta === 'obra' ? 'obra' : 'consultoria';
			asesor = data.responsable || '';

			contratoFile = null;
			proformaFiles = [];
			adelantoFile = null;
			adelantoMonto = '';
			// A pedido del usuario: en Editar Venta, el Adelanto inicial arranca con la Fecha de venta
			// del registro (no la fecha de hoy) — fechaVenta ya quedó fijada un par de líneas arriba.
			adelantoFecha = fechaVenta;

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

	/** Solo Obra, a pedido del usuario: siguiente número consecutivo para un distrito que se repite en
	 * otro proyecto de Obra — cuenta contra `ubicacion` (guarda el distrito sin truncar) de proyectos
	 * YA guardados con tipo_venta='obra', toma el número más alto entre los que coincidan con `base`
	 * (sin distinguir mayúsculas) y devuelve ese máximo + 1 — no un simple conteo, para no repetir un
	 * número si algún proyecto intermedio se borró. El número va PEGADO al distrito, sin separador (ej.
	 * "Breña1", "Breña2" — a pedido del usuario, siguiendo el formato de la imagen: dentro de cada
	 * grupo del código no hay separador, solo "_" ENTRE grupos, ver codigoGenerado). Los nombres de
	 * distrito de DISTRITOS_POR_PROVINCIA nunca terminan en dígito, así que separar "letras" de
	 * "números finales" con una regex simple es inambiguo. `excludeProyectoId` deja fuera a la propia
	 * venta que se está editando (si no, se contaría a sí misma). Nunca lanza: si falla, cae a 1 en vez
	 * de bloquear el formulario por un problema secundario. */
	async function resolverNumeroDistrito(base: string, excludeProyectoId: number | null): Promise<number> {
		if (!base.trim()) return 1;
		try {
			let query = supabase.from('proyecto').select('id_proyecto, ubicacion').eq('tipo_venta', 'obra');
			if (excludeProyectoId) query = query.neq('id_proyecto', excludeProyectoId);
			const { data, error } = await query;
			if (error) throw error;

			const baseNormalizada = base.trim().toLowerCase();
			let max = 0;
			for (const row of (data ?? []) as any[]) {
				const match = /^(\D+)(\d+)$/.exec(String(row.ubicacion || ''));
				if (match && match[1].trim().toLowerCase() === baseNormalizada) {
					max = Math.max(max, Number(match[2]));
				}
			}
			return max + 1;
		} catch (err) {
			console.error('[NuevaVentaModal] Error resolviendo el número de distrito:', err);
			return 1;
		}
	}

	/** Dispara resolverNumeroDistrito para el distrito ACTUAL — llamarse solo desde interacción real del
	 * usuario (elegir/cambiar distrito, o cambiar a la pestaña Obra), nunca durante la carga de una
	 * venta existente (esa ya trae su número asignado, parseado en loadVentaParaEditar). Descarta el
	 * resultado si `distrito` cambió de nuevo mientras la consulta estaba en vuelo. */
	async function actualizarNumeroDistrito() {
		if (caracteristicasTab !== 'obra' || !distrito) {
			distritoNumero = null;
			return;
		}
		const base = distrito;
		const excludeId = mode === 'edit' ? ventaId : null;
		const numero = await resolverNumeroDistrito(base, excludeId);
		if (distrito === base && caracteristicasTab === 'obra') distritoNumero = numero;
	}

	/** Valor a guardar/mostrar para el distrito — con el número consecutivo PEGADO (sin separador, a
	 * pedido del usuario) SOLO en Obra, ej. "Breña1" (Consultoría queda igual que siempre, sin
	 * sufijo). Ver distritoNumero/resolverNumeroDistrito. */
	let distritoParaGuardar = $derived(
		caracteristicasTab === 'obra' && distrito && distritoNumero != null ? `${distrito}${distritoNumero}` : distrito
	);

// A pedido del usuario: el código de Obra sigue el esquema (todo separado por "_", reestructurado
// según la imagen de referencia que compartió, con "número de pisos" agregado al segundo grupo):
// {Tipo de Servicio}_{Permiso Municipal}{Alcance de Obra}{Tipo de Contratación}{pisos}_{distrito+Nº
// secuencial}_{mes}{año}_{cliente} — ej. "OBRA_LGC5_Ate1_0525_ClienteSAC". Usa el mes/año propios de
// esa pestaña (mesObra/anioObra), no los derivados de la fecha de venta como en Consultoría. Los 4
// primeros campos son de selección ÚNICA (no checkboxes, ver PERMISO_MUNICIPAL_OPTIONS/
// ALCANCE_OBRA_OPTIONS/TIPO_CONTRATACION_OPTIONS más arriba).
// A pedido explícito del usuario: sin elegir Tipo de Proyecto todavía (caracteristicasTab null), no
// hay código que mostrar — el dropdown nuevo junto a "Código de proyecto" es lo que decide el prefijo.
let codigoGenerado = $derived(
	caracteristicasTab === null
		? ''
		: caracteristicasTab === 'obra'
			? `${tipoObra}_${tipoTramite}${tipoIntervencion}${tipoEdificacionObra}${numeroPisos}_${sanitizeFileSegment(distritoParaGuardar)}_${mesObra}${String(anioObra).slice(-2)}_${sanitizeFileSegment(getClienteNombreActual() || 'Cliente')}`
			// A pedido explícito del usuario: en Consultoría el código va SIN prefijo (ya no lleva
			// "CONS_" ni ningún otro).
			: `${tipoProyecto}${estadoPredio}${tipoEdificacion}${numeroPisos}_${mes}${anio.substring(2)}_${sanitizeFileSegment(distrito)}_${sanitizeFileSegment(getClienteNombreActual() || 'Cliente')}`
);

// A pedido del usuario: `nombre_proyecto` debe almacenar el CÓDIGO del proyecto, no el nombre del
// cliente — antes un efecto copiaba ahí el nombre del cliente elegido (arrastraba ese nombre hasta la
// tabla `proyecto`, pisando lo que en realidad debía ser un código, ver historial de este archivo).
// Corre en ambos modos (crear/editar) para que quede siempre sincronizado con las Características
// vigentes, incluso si se editan después de cargar la venta. Debe ir DESPUÉS de codigoGenerado (usa su
// valor) — el orden de declaración sí importa acá porque `let` no se "hoistea" como una función.
$effect(() => {
	proyectoNombre = codigoGenerado;
});

// A pedido del usuario: el ícono de copiar junto al Código generado no hacía nada — ahora copia el
// código al portapapeles para poder pegarlo (Ctrl+V) en otro lado. navigator.clipboard requiere un
// contexto seguro (ok en el navegador y en el webview de Tauri) y un gesto directo del usuario (este
// clic lo es); execCommand queda como respaldo por si el navegador/webview bloquea la API moderna.
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
			textarea.remove();
		}
		codigoCopiado = true;
		setTimeout(() => (codigoCopiado = false), 1500);
	} catch (err) {
		console.error('[NuevaVentaModal] No se pudo copiar el código generado:', err);
	}
}

	let comisionMonto = $derived((Number(valorVenta) || 0) * (Number(comisionPorcentaje) || 0) / 100);
	let contratoPresente = $derived(!!contratoFile || !!localContratoUrl);

	// A pedido del usuario: con el campo "Valor venta (S/)" de Información general oculto en edición
	// (ver el {#if} sobre ese campo, más abajo en el template), "Valor final (S/)" de la sección Cierre
	// pasa a ser la ÚNICA fuente editable del precio mientras la venta sigue abierta — este efecto
	// mantiene `valorVenta` sincronizado con `montoFinalVenta` para que "Guardar cambios" (que persiste
	// `precio_venta` a partir de `valorVenta`) y el cálculo de comisión de arriba sigan reflejando el
	// valor que el usuario realmente ve y edita.
	$effect(() => {
		if (mode === 'edit' && !ventaFinalizada && montoFinalVenta !== '') {
			valorVenta = montoFinalVenta;
		}
	});

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
			// Sin .limit(): con un tope fijo, un cliente que quedara fuera de los primeros N (orden
			// alfabético) hacía que el <select> de "Clientes" no tuviera ninguna opción que calzara con
			// el id_cliente ya guardado de la venta — se veía vacío en Editar Venta aunque el dato sí
			// estuviera ahí.
			const { data, error } = await supabase.from('cliente').select('id_cliente,nombre').order('nombre', { ascending: true });
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
		// timeZone: 'UTC' evita el corrimiento de un día que 'new Date("YYYY-MM-DD")' produce en husos
		// horarios detrás de UTC (Perú, UTC-5) al leerse de vuelta en hora local — ver mismo fix en
		// comercial/ventas/+page.svelte (formatDate).
		return new Date(d).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
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

	/** Sube un contrato y lo fija como el vigente — sirve tanto para adjuntar el primero como para
	 * REEMPLAZAR uno ya existente (a pedido del usuario, ver el botón "Reemplazar" junto a "Ver" en la
	 * sección Contrato). Si ya había uno, el archivo anterior se borra de Drive best-effort (mismo
	 * criterio que al eliminar una proforma, ver deleteProjectDocumentFile) — no bloquea el reemplazo
	 * si ese borrado falla. */
	async function handleContratoFileGestion(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		(event.currentTarget as HTMLInputElement).value = '';
		if (!file || !ventaId) return;

		const contratoAnteriorUrl = localContratoUrl;
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
			if (contratoAnteriorUrl) await deleteProjectDocumentFile(contratoAnteriorUrl);
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
		caracteristicasTab !== null &&
		(caracteristicasTab !== 'consultoria' ||
			(!!tipoProyecto && !!estadoPredio && !!tipoEdificacion && Number(numeroPisos) > 0))
	);

	// Una venta dada de baja ('baja') quedó cerrada primero (solo se puede dar de baja una venta ya
	// cerrada, ver darDeBajaVenta en aprobaciones.service.ts — se dispara desde la tabla de ventas, ver
	// handleDarDeBajaEvent en comercial/ventas/+page.svelte) y es un estado igual de definitivo — todos
	// los bloqueos de "venta ya cerrada" (tabs, edición de proformas/cierre, botón "Cerrar venta")
	// aplican igual para ambos.
	let ventaFinalizada = $derived(localEstado === 'venta_cerrada' || localEstado === 'baja');

	// A pedido del usuario: una vez cerrada la venta, ya no se puede cambiar de Consultoría a Obra (ni
	// al revés) — el tipo de proyecto queda fijo. Solo en modo edición, y solo aplica una vez cerrada
	// (mientras la venta sigue abierta, se puede seguir ajustando la pestaña con normalidad).
	let tabsBloqueadosPorCierre = $derived(mode === 'edit' && ventaFinalizada);

	// A pedido del usuario: cerrar una venta ya NO exige tener el contrato adjunto (antes sí) — solo
	// necesita el Adelanto inicial completo (monto + comprobante, ya sea recién adjuntado o ya
	// registrado antes) además de la proforma final y el monto final ya confirmados. El contrato se
	// puede seguir adjuntando después, desde la misma sección de Editar venta.
	let canClose = $derived(
		mode === 'edit' &&
		!ventaFinalizada &&
		infoGeneralCompleta &&
		selectedFinalId !== null &&
		Number(montoFinalVenta) > 0 &&
		(adelantoYaRegistrado || (!!adelantoFile && Number(adelantoMonto) > 0 && Number(adelantoMonto) <= Number(montoFinalVenta) && !!adelantoFecha))
	);

	// A pedido del usuario: también se puede cerrar la venta de una sola vez desde el pop up de
	// CREACIÓN (registrar + cerrar en un solo clic), en vez de guardar primero y recién cerrar desde
	// "Editar" — mismo criterio de campos obligatorios que `canClose`, pero usando los archivos
	// sueltos que todavía no se subieron (`proformaFiles`/`selectedFinalFileIndex`) en vez de los ya
	// guardados en `documento_proyecto`.

	// A pedido del usuario: la sección "Características del proyecto nuevo" queda BLOQUEADA hasta que
	// estén completos el Adelanto inicial (monto + comprobante, ya sea recién adjuntado o ya registrado
	// antes) Y la proforma marcada como final — ya NO exige contrato (pedido explícito de una iteración
	// anterior). Si la venta YA está cerrada, ese requisito ya se cumplió para poder cerrarla (ver
	// `canClose`) — editar una venta cerrada debe poder tocar sus características SIEMPRE, sin volver a
	// exigir estos 3 puntos (que en ventas antiguas podrían no haber quedado registrados tal cual lo
	// espera este chequeo, dejando la sección bloqueada sin salida).
	let documentosCierreListos = $derived(
		mode === 'edit'
			? ventaFinalizada ||
				((adelantoYaRegistrado || (!!adelantoFile && Number(adelantoMonto) > 0)) && selectedFinalId !== null)
			: !!adelantoFile && Number(adelantoMonto) > 0 && selectedFinalFileIndex !== null
	);

	// Mismo criterio que `canClose`: registrar + cerrar de una vez tampoco exige contrato.
	let canCloseCreate = $derived(
		mode === 'create' &&
		infoGeneralCompleta &&
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

		// A pedido del usuario: "Cerrar venta" ahora graba TODOS los datos recopilados del formulario
		// (Información general + Características), no solo el estado y el monto final — antes, si se
		// cerraba directo sin pasar antes por "Guardar cambios", esos campos se perdían. Se reusa
		// validarYResolverDatosBasicos (mismo que usa "Guardar cambios") para resolver el cliente —
		// cubre también el caso "+ Nuevo cliente" elegido recién, sin guardar antes.
		const basicos = await validarYResolverDatosBasicos();
		if (!basicos) return;

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
				// No-null: canClose ya exige infoGeneralCompleta, que exige caracteristicasTab elegido.
				tipoVenta: caracteristicasTab!,
				idCliente: basicos.clienteId,
				clienteNombre: basicos.clienteNombreFinal || `Cliente #${basicos.clienteId}`,
				selectedFinalId,
				montoFinalVenta: Number(montoFinalVenta),
				adelantoYaRegistrado,
				adelantoMonto: Number(adelantoMonto),
				adelantoFecha,
				comprobanteUrl,
				// Mismas columnas que actualiza "Guardar cambios" (ver proyectoUpdatePayload en
				// handleGuardar) — precio_venta/costo_estima/estado_proyecto quedan fuera, esos ya los
				// fija cerrarVentaAprobada a partir de montoFinalVenta.
				datosProyecto: {
					id_cliente: basicos.clienteId,
					nombre_proyecto: proyectoNombre,
					fecha_inicio_plan: basicos.fechaInicio,
					comision_asesor: basicos.comision,
					responsable: basicos.asesorFinal,
					tip_proyecto: tipoProyecto,
					estado_predio: estadoPredio,
					tipo_edifica: tipoEdificacion,
					tipo_edificacion2: tipoEdificacion2 || null,
					nro_pisos: basicos.numeroPisosValue,
					tipo_obra: tipoObra || null,
					tipo_tramite: tipoTramite || null,
					tipo_intervencion: tipoIntervencion || null,
					tipo_edificacion_obra: tipoEdificacionObra || null,
					mes_obra: mesObra || null,
					anio_obra: anioObra ? Number(anioObra) : null,
					distrito: distrito ? distrito.substring(0, 4).trim() : null,
					provincia: provincia ? provincia.substring(0, 4).trim() : null,
					departamento: departamento ? departamento.substring(0, 4).trim() : null,
					tipo_venta: caracteristicasTab,
					ubicacion: distritoParaGuardar,
					direccion_predio: direccionPredio?.trim() ? direccionPredio.trim() : null,
					descripcion: observaciones?.trim() ? observaciones.trim() : null
				}
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
			onClose();
			// A pedido del usuario: el adelanto de la venta recién cerrada debe generar la transacción de
			// ingreso Y abrir el popup de Transacciones para completar la información que el cierre de
			// venta no pide — solo si esta llamada creó una transacción nueva (result.data viene undefined
			// si el adelanto ya estaba registrado de antes, ver cerrarVentaAprobada).
			if (result.data) onTransaccionSugerida(result.data, { clienteNombre: basicos.clienteNombreFinal || `Cliente #${basicos.clienteId}`, proyectoCodigo: proyectoNombre });
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
			// A pedido explícito del usuario: proyectoNombre (= codigoGenerado, ver su declaración) solo
			// queda vacío cuando todavía no se eligió "Tipo de Proyecto" — con Consultoría/Obra elegido
			// siempre arma algo (aunque sea con campos vacíos), así que este chequeo es en la práctica
			// exactamente "falta elegir Tipo de Proyecto".
			saveError = 'Debes elegir el Tipo de Proyecto (Consultoría/Obra) antes de guardar.';
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
	): Promise<{ proyectoId: number; idCentroCosto: number | string | null; proformaDocIds: (number | null)[]; transaccionAdelanto: Transaccion | null } | null> {
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
			tipo_obra: tipoObra || null,
			tipo_tramite: tipoTramite || null,
			tipo_intervencion: tipoIntervencion || null,
			tipo_edificacion_obra: tipoEdificacionObra || null,
			mes_obra: mesObra || null,
			anio_obra: anioObra ? Number(anioObra) : null,
			distrito: distrito ? distrito.substring(0, 4).trim() : null,
			provincia: provincia ? provincia.substring(0, 4).trim() : null,
			departamento: departamento ? departamento.substring(0, 4).trim() : null,
			costo_estima: precioVenta,
			estado_proyecto: 'activo',
			tipo_venta: caracteristicasTab,
			ubicacion: distritoParaGuardar,
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

		// A pedido explícito del usuario: el centro de costo del proyecto ya NO se genera al crear la
		// venta — solo cuando se cierra (ver cerrarVentaAprobada), salvo la excepción de abajo. Se deja
		// en null acá; solo se crea dentro del bloque de adelanto si hace falta como destino de esa
		// transacción (una venta puede recibir un adelanto antes de cerrarse).
		let idCentroCosto: number | string | null = null;

		const proformaDocIds: (number | null)[] = [];
		let transaccionAdelanto: Transaccion | null = null;
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
			// proyecto y del cliente, sube el comprobante y crea la transacción (ingreso) de una vez.
			// Requiere ambos (archivo Y monto) — el campo de monto ya viene deshabilitado en el formulario
			// mientras no haya comprobante adjunto. Único caso en que el centro de costo del proyecto se
			// crea ANTES de cerrar la venta (a pedido explícito del usuario, ver arriba): hace falta como
			// destino de esta transacción.
			if (adelantoFile && Number(adelantoMonto) > 0) {
				// Obra: cada venta tiene su PROPIO centro de costo (comportamiento de siempre). Consultoría:
				// TODAS las ventas de consultoría comparten UN ÚNICO centro de costo — a pedido explícito del
				// usuario (ver getOrCrearCentroCostoCompartido).
				idCentroCosto = caracteristicasTab === 'consultoria'
					? await getOrCrearCentroCostoCompartido(supabase, 'consultoria', nuevoProyectoId, proyectoNombre)
					: await getOrCrearCentroCostoParaEntidad(supabase, 'proyecto', nuevoProyectoId, proyectoNombre);
				if (!idCentroCosto) throw new Error('No se pudo obtener el centro de costo del proyecto para registrar el adelanto.');

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
				transaccionAdelanto = transResult.data ?? null;
			}
		} catch (uploadError) {
			console.error('[NuevaVentaModal] Error al subir documentos:', uploadError);
			saveError = String(uploadError instanceof Error ? uploadError.message : uploadError);
			return null;
		}

		return { proyectoId: nuevoProyectoId, idCentroCosto, proformaDocIds, transaccionAdelanto };
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
				tipo_obra: tipoObra || null,
				tipo_tramite: tipoTramite || null,
				tipo_intervencion: tipoIntervencion || null,
				tipo_edificacion_obra: tipoEdificacionObra || null,
				mes_obra: mesObra || null,
				anio_obra: anioObra ? Number(anioObra) : null,
				distrito: distrito ? distrito.substring(0, 4).trim() : null,
				provincia: provincia ? provincia.substring(0, 4).trim() : null,
				departamento: departamento ? departamento.substring(0, 4).trim() : null,
				costo_estima: basicos.precioVenta,
				tipo_venta: caracteristicasTab,
				ubicacion: distritoParaGuardar,
				direccion_predio: direccionPredio?.trim() ? direccionPredio.trim() : null,
				descripcion: observaciones?.trim() ? observaciones.trim() : null
			};

			// A pedido del usuario: un no-administrador ya no guarda los cambios directo — se envía una
			// solicitud de aprobación con el payload propuesto, visible para todos los admins en la
			// campanita (ver aprobaciones.service.ts).
			if (!isAdmin()) {
				// Snapshot del valor ANTERIOR de cada campo (mismas claves que proyectoUpdatePayload) — a
				// pedido del usuario: la campanita del admin debe resaltar cuáles campos realmente cambian.
				// ventaOriginalRaw es la fila cruda que cargó loadVentaParaEditar, previa a cualquier edición
				// hecha acá en el formulario.
				const payloadAnterior = ventaOriginalRaw
					? Object.fromEntries(Object.keys(proyectoUpdatePayload).map((k) => [k, ventaOriginalRaw[k] ?? null]))
					: null;
				const result = await crearSolicitud(supabase, {
					tipoEntidad: 'proyecto',
					idEntidad: Number(ventaId),
					tipoAccion: 'editar',
					descripcionEntidad: proyectoNombre,
					payloadCambios: proyectoUpdatePayload,
					payloadAnterior
				});
				isSaving = false;
				if (!result.success) {
					saveError = `No se pudo enviar la solicitud. ${result.message ?? ''}`;
					return;
				}
				alert('No tienes permisos de administrador. Los cambios se enviaron para que un administrador los apruebe.');
				onSaved();
				onClose();
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
			onClose();
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
				// No-null: canCloseCreate ya exige infoGeneralCompleta, que exige caracteristicasTab elegido.
				tipoVenta: caracteristicasTab!,
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
			// A pedido del usuario: mismo criterio que handleCerrarVenta — la transacción del adelanto se
			// crea acá DENTRO de crearVentaYSubirDocumentos (no en cerrarVentaAprobada, que en este flujo
			// recibe adelantoYaRegistrado:true y no vuelve a crearla), así que se toma de `resultado`, no
			// de `result.data`.
			if (resultado.transaccionAdelanto) onTransaccionSugerida(resultado.transaccionAdelanto, { clienteNombre: basicos.clienteNombreFinal || `Cliente #${basicos.clienteId}`, proyectoCodigo: proyectoNombre });
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
								{#if mode === 'edit'}
									<!-- A pedido del usuario: en Editar Venta el cliente ya quedó fijado al crear la
									     venta — se muestra como texto de solo lectura en vez de un <select> editable. -->
									<input type="text" readonly value={getClienteNombreActual() || `Cliente #${selectedClienteId}`} class="px-3 py-2 bg-slate-100 border border-slate-200 text-slate-500 rounded-lg text-sm outline-none cursor-not-allowed">
								{:else}
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
										distritoNumero = null;
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
									onchange={(e) => { provincia = (e.currentTarget as HTMLSelectElement).value; distrito = ''; distritoNumero = null; }}
									class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
								>
									{#each PROVINCIAS_POR_DEPARTAMENTO[departamento] ?? [] as p}
										<option value={p}>{p}</option>
									{/each}
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Distrito *</label>
								<!-- A pedido del usuario: en Obra, elegir un distrito ya usado en otro proyecto le
								     agrega un número consecutivo al guardar (ej. "Breña_1", "Breña_2" — ver
								     actualizarNumeroDistrito/distritoParaGuardar). No usa bind:value porque hace
								     falta interceptar el cambio para disparar esa resolución. -->
								<select
									value={distrito}
									onchange={(e) => {
										distrito = (e.currentTarget as HTMLSelectElement).value;
										distritoNumero = null;
										actualizarNumeroDistrito();
									}}
									class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
								>
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
								<label class="text-xs font-semibold text-[#0f3b5e]">Tipo de Proyecto *</label>
								<!-- A pedido explícito del usuario: define el prefijo del "Código de proyecto" de al
								     lado (Consultoría -> sin prefijo, Obra -> el propio tipo_obra elegido, ver
								     codigoGenerado) y, mientras no se elija, bloquea la generación del código y
								     "Características del proyecto nuevo" (ver infoGeneralCompleta/documentosCierreListos,
								     que exigen proyectoNombre no vacío). Sincronizado en ambos sentidos con las pestañas
								     de esa sección — cambiar cualquiera de los dos actualiza el otro. -->
								<select
									value={caracteristicasTab ?? ''}
									disabled={tabsBloqueadosPorCierre}
									title={tabsBloqueadosPorCierre ? 'La venta ya está cerrada — el tipo de proyecto ya no se puede cambiar.' : ''}
									onchange={(e) => {
										const value = (e.currentTarget as HTMLSelectElement).value;
										caracteristicasTab = value === 'obra' || value === 'consultoria' ? value : null;
										if (caracteristicasTab === 'obra' && !tipoObra) tipoObra = 'OBRA';
										if (caracteristicasTab === 'obra' && distrito && distritoNumero === null) actualizarNumeroDistrito();
									}}
									class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all appearance-none text-slate-700 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
								>
									<option value="" disabled>-- Selecciona --</option>
									<option value="consultoria">Consultoria</option>
									<option value="obra">Obra (Obra)</option>
								</select>
							</div>
							<div class="flex flex-col gap-1 md:col-span-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Código de proyecto</label>
								<input type="text" readonly value={codigoGenerado} class="px-3 py-2 bg-slate-100 border border-slate-200 text-slate-500 rounded-lg text-sm outline-none cursor-not-allowed">
								<span class="text-[10px] text-slate-400 mt-0.5">
									{caracteristicasTab === null ? 'Elige el Tipo de Proyecto para generarlo' : 'Se generará automáticamente'}
								</span>
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
							<!-- A pedido del usuario: la sección "Cierre" (más abajo, solo modo edición) ya tiene su
							     propio campo editable "Valor final (S/)" para este mismo dato — mostrar otro acá
							     era redundante y confuso (dos precios de venta editables a la vez). Se sigue
							     mostrando en modo creación (todavía no existe la sección de cierre) y en una
							     venta ya cerrada (la sección de cierre desaparece del todo, así que este vuelve
							     a ser el único lugar donde se ve el precio final). -->
							{#if !(mode === 'edit' && !ventaFinalizada)}
							<div class="flex flex-col gap-1 md:col-span-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Valor venta (S/) *</label>
								<input
									type="text"
									bind:value={valorVenta}
									class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all text-slate-700"
								>
							</div>
							{/if}
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

						{#if localEstado === 'baja'}
							<div class="mt-3 p-3 bg-red-50 border border-red-300 rounded-lg text-red-700 text-sm flex items-center gap-2">
								<i class="fas fa-ban"></i>
								<span class="font-semibold">Venta dada de baja</span>
							</div>
						{/if}

						<!-- Proformas -->
						<div class="mt-4">
							<div class="flex items-center justify-between mb-3">
								<h4 class="text-xs font-bold text-slate-600 uppercase tracking-wide">Proformas</h4>
								{#if !ventaFinalizada}
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
											{#if !ventaFinalizada}
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
											{#if !ventaFinalizada}
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
									<p class="text-sm font-medium text-slate-700 flex-1">
										{isUploadingContratoGestion ? 'Subiendo nuevo contrato...' : 'Contrato adjunto'}
									</p>
									<button onclick={handleVerContrato} disabled={isUploadingContratoGestion} class="shrink-0 text-slate-400 hover:text-blue-600 p-1.5 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed" title="Ver" aria-label="Ver contrato">
										<i class="fas fa-eye"></i>
									</button>
									<label class="shrink-0 cursor-pointer text-slate-400 hover:text-blue-600 p-1.5 rounded transition-colors" title="Reemplazar contrato" aria-label="Reemplazar contrato">
										<input type="file" accept="application/pdf" class="hidden" onchange={handleContratoFileGestion} disabled={isUploadingContratoGestion} />
										{#if isUploadingContratoGestion}
											<i class="fas fa-spinner fa-spin"></i>
										{:else}
											<i class="fas fa-rotate"></i>
										{/if}
									</label>
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
						{#if !ventaFinalizada}
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
					     reseteo más arriba). Bloqueada hasta completar el Adelanto (monto + comprobante)
					     y marcar la proforma final — ver documentosCierreListos más arriba. -->
					<section class="border-t border-slate-100 pt-6">
						<button
							type="button"
							onclick={() => { if (documentosCierreListos) caracteristicasExpanded = !caracteristicasExpanded; }}
							disabled={!documentosCierreListos}
							class={`w-full flex items-center justify-between gap-2 mb-1 text-left ${!documentosCierreListos ? 'opacity-50 cursor-not-allowed' : ''}`}
							aria-expanded={caracteristicasExpanded}
							title={!documentosCierreListos ? 'Completa el monto y el comprobante del adelanto inicial, y marca una proforma como final, para poder completar las características del proyecto' : ''}
						>
							<span class="text-sm font-bold text-slate-800 flex items-center gap-2">
								<div class="w-1.5 h-4 bg-orange-500 rounded-full"></div>
								Características del proyecto nuevo
								{#if !documentosCierreListos}<i class="fas fa-lock text-[10px] text-slate-400"></i>{/if}
							</span>
							<i class={`fas fa-chevron-down text-slate-400 text-xs transition-transform ${caracteristicasExpanded ? 'rotate-180' : ''}`}></i>
						</button>
						{#if !documentosCierreListos}
							<p class="text-[11px] text-slate-400 mb-4">Completa el monto y el comprobante del adelanto inicial, y marca una proforma como final, para poder completar esta sección.</p>
						{:else}
							<div class="mb-4"></div>
						{/if}
						{#if caracteristicasExpanded && documentosCierreListos}
						<div class="flex gap-1 mb-1 border-b border-slate-200">
							<button
								type="button"
								onclick={() => (caracteristicasTab = 'consultoria')}
								disabled={tabsBloqueadosPorCierre && caracteristicasTab !== 'consultoria'}
								title={tabsBloqueadosPorCierre && caracteristicasTab !== 'consultoria' ? 'La venta ya está cerrada como Obra — no se puede cambiar a Consultoría' : ''}
								class={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${caracteristicasTab === 'consultoria' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'} ${tabsBloqueadosPorCierre && caracteristicasTab !== 'consultoria' ? 'opacity-50 cursor-not-allowed hover:text-slate-500' : ''}`}
							>
								Consultoría
								{#if tabsBloqueadosPorCierre && caracteristicasTab !== 'consultoria'}<i class="fas fa-lock text-[10px]"></i>{/if}
							</button>
							<button
								type="button"
								onclick={() => { caracteristicasTab = 'obra'; if (distrito && distritoNumero === null) actualizarNumeroDistrito(); }}
								disabled={tabsBloqueadosPorCierre && caracteristicasTab !== 'obra'}
								title={tabsBloqueadosPorCierre && caracteristicasTab !== 'obra' ? 'La venta ya está cerrada como Consultoría — no se puede cambiar a Obra' : ''}
								class={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${caracteristicasTab === 'obra' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'} ${tabsBloqueadosPorCierre && caracteristicasTab !== 'obra' ? 'opacity-50 cursor-not-allowed hover:text-slate-500' : ''}`}
							>
								Obra
								{#if tabsBloqueadosPorCierre && caracteristicasTab !== 'obra'}<i class="fas fa-lock text-[10px]"></i>{/if}
							</button>
						</div>
						{#if tabsBloqueadosPorCierre}
							<p class="text-[11px] text-slate-400 mb-3">La venta ya está cerrada — el tipo de proyecto ({caracteristicasTab === 'obra' ? 'Obra' : 'Consultoría'}) ya no se puede cambiar.</p>
						{:else}
							<div class="mb-3"></div>
						{/if}

						{#if caracteristicasTab === null}
							<!-- A pedido explícito del usuario: sin Tipo de Proyecto elegido (dropdown junto a
							     "Código de proyecto"), no hay campos de Consultoría/Obra que mostrar todavía —
							     antes de este cambio, `caracteristicasTab` nunca era null (arrancaba en
							     'consultoria'), así que este caso no existía. -->
							<p class="text-sm text-slate-400 text-center py-6 border border-dashed border-slate-200 rounded-lg mb-6">
								Elige el Tipo de Proyecto (Consultoría/Obra) en "Información general" para completar esta sección.
							</p>
						{:else if caracteristicasTab === 'consultoria'}
						<div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Tipo de proyecto *</label>
								<select bind:value={tipoProyecto} disabled={!documentosCierreListos} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed">
									<option value="">-- Selecciona --</option>
									{#each TIPO_PROYECTO_OPTIONS as opt}
										<option value={opt.value}>{opt.label} ({opt.value})</option>
									{/each}
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Estado del predio *</label>
								<select bind:value={estadoPredio} disabled={!documentosCierreListos} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed">
									<option value="">-- Selecciona --</option>
									{#each ESTADO_PREDIO_OPTIONS as opt}
										<option value={opt.value}>{opt.label} ({opt.value})</option>
									{/each}
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Tipo de edificación *</label>
								<select bind:value={tipoEdificacion} disabled={!documentosCierreListos} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed">
									<option value="">-- Selecciona --</option>
									{#each TIPO_EDIFICACION_OPTIONS as opt}
										<option value={opt.value}>{opt.label} ({opt.value})</option>
									{/each}
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

							<!-- Responsive: en celular se apila (label arriba, código abajo) y el texto se
							     envuelve con break-all en vez de desbordarse horizontalmente — antes, con
							     todo en una sola fila y sin min-w-0, el código largo se salía del cuadro y
							     quedaba cortado (el flex item no se achicaba para envolver el texto). -->
							<div class="mt-6 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 bg-white px-4 py-3 rounded-lg border border-slate-200">
								<span class="text-sm font-bold text-slate-800 shrink-0">Código generado:</span>
								<div class="bg-blue-50 text-blue-700 px-4 py-1.5 rounded text-sm font-bold tracking-wide flex items-center justify-between gap-3 min-w-0 w-full sm:w-auto">
									<span class="break-all">{codigoGenerado}</span>
									<button
										type="button"
										onclick={copiarCodigoGenerado}
										class={`shrink-0 ${codigoCopiado ? 'text-emerald-500' : 'text-blue-400 hover:text-blue-600'}`}
										title={codigoCopiado ? 'Copiado' : 'Copiar código'}
										aria-label="Copiar código generado"
									>
										<i class={codigoCopiado ? 'fas fa-check' : 'far fa-copy'}></i>
									</button>
								</div>
							</div>
						</div>
						{:else}
						<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Tipo de Servicio *</label>
								<!-- A pedido del usuario: EXP (Expediente Técnico) es exclusivo de la pestaña
								     Consultoría — acá solo se elige entre OBRA (ejecución) y SUP (supervisión), ese
								     valor es el prefijo del código generado y también decide el centro de costo:
								     solo OBRA y SUP crean uno propio por proyecto (igual que Consultoría ya
								     comparte uno único — ver caracteristicasTab en getOrCrearCentroCosto...). -->
								<select bind:value={tipoObra} disabled={!documentosCierreListos} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed">
									<option value="">-- Selecciona --</option>
									<option value="OBRA">Ejecución de obra (OBRA)</option>
									<option value="SUP">Supervisión de obra (SUP)</option>
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Permiso Municipal *</label>
								<select bind:value={tipoTramite} disabled={!documentosCierreListos} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed">
									<option value="">-- Selecciona --</option>
									{#each PERMISO_MUNICIPAL_OPTIONS as opt}
										<option value={opt.value}>{opt.label} ({opt.value})</option>
									{/each}
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Alcance de Obra *</label>
								<select bind:value={tipoIntervencion} disabled={!documentosCierreListos} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed">
									<option value="">-- Selecciona --</option>
									{#each ALCANCE_OBRA_OPTIONS as opt}
										<option value={opt.value}>{opt.label} ({opt.value})</option>
									{/each}
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">Tipo de Contratación *</label>
								<select bind:value={tipoEdificacionObra} disabled={!documentosCierreListos} class="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed">
									<option value="">-- Selecciona --</option>
									{#each TIPO_CONTRATACION_OPTIONS as opt}
										<option value={opt.value}>{opt.label} ({opt.value})</option>
									{/each}
								</select>
							</div>
							<div class="flex flex-col gap-1">
								<label class="text-xs font-semibold text-[#0f3b5e]">N° de proyecto en el distrito</label>
								<!-- A pedido del usuario: se calcula solo (ver resolverNumeroDistrito/
								     actualizarNumeroDistrito) contando las ventas de Obra ya registradas en el
								     distrito elegido arriba — no es un campo que el usuario llene, solo
								     informativo/de solo lectura. -->
								<input type="text" readonly value={distritoNumero ?? '—'} class="px-3 py-2 bg-slate-100 border border-slate-200 text-slate-500 rounded-lg text-sm outline-none cursor-not-allowed">
								<span class="text-[10px] text-slate-400 mt-0.5">Se calcula solo según el distrito elegido.</span>
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

						<!-- Responsive: mismo criterio que la versión de Consultoría — se apila en celular y
						     el texto se envuelve (break-all + min-w-0) en vez de desbordarse. -->
						<div class="mt-6 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 bg-white px-4 py-3 rounded-lg border border-slate-200">
							<span class="text-sm font-bold text-slate-800 shrink-0">Código generado:</span>
							<div class="bg-blue-50 text-blue-700 px-4 py-1.5 rounded text-sm font-bold tracking-wide flex items-center justify-between gap-3 min-w-0 w-full sm:w-auto">
								<span class="break-all">{codigoGenerado}</span>
								<button
									type="button"
									onclick={copiarCodigoGenerado}
									class="shrink-0 text-blue-400 hover:text-blue-600"
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
				{#if mode === 'edit' && !ventaFinalizada}
					<button
						onclick={handleCerrarVenta}
						disabled={!canClose || isClosing}
						title={!canClose ? 'Completa todos los campos obligatorios (*) de Información general y Características, marca una proforma como final, confirma el monto final de la venta y adjunta el comprobante del adelanto (monto ≤ monto final, con fecha) para poder cerrar la venta' : ''}
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
						title={!canCloseCreate ? 'Completa todos los campos obligatorios (*) de Información general y Características, agrega al menos una proforma y márcala como final, y adjunta el comprobante del adelanto (monto ≤ valor de venta, con fecha) para registrar y cerrar la venta de una vez' : ''}
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
