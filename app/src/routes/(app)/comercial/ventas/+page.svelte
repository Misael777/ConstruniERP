<script lang="ts">
import { onMount, onDestroy } from 'svelte';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '$lib/supabaseClient';
import { isAdmin } from '$lib/stores/permisos.svelte';
import VentasKPIs from '$lib/components/comercial/ventas/VentasKPIs.svelte';
import VentasTable from '$lib/components/comercial/ventas/VentasTable.svelte';
import VentasCharts from '$lib/components/comercial/ventas/VentasCharts.svelte';
import VentasSummarySidebar from '$lib/components/comercial/ventas/VentasSummarySidebar.svelte';
import NuevaVentaModal from '$lib/components/comercial/ventas/NuevaVentaModal.svelte';
import DocumentPreviewModal from '$lib/shared/components/DocumentPreviewModal.svelte';
import TransaccionModal from '$lib/modules/transacciones/components/TransaccionModal.svelte';
import type { Transaccion } from '$lib/modules/transacciones/services/transacciones.service';
import { getCentroCostoOptions } from '$lib/modules/transacciones/services/transacciones.service';
import { getCuentaBancoOptions } from '$lib/modules/cuentas-bancarias/services/cuentaBanco.service';
import type { FieldOption } from '$lib/shared/fieldConfig';
import { describeError } from '$lib/shared/describeError';
import { crearSolicitud, eliminarVentaCascade, darDeBajaVenta, restaurarVenta } from '$lib/modules/aprobaciones/services/aprobaciones.service';
import { exportarVentasXLSX } from '$lib/modules/ventas/services/ventasExport.service';
import { toast } from '$lib/stores/toast';
import { verifyAdminCredentials } from '$lib/shared/adminAuth';
import ConfirmModal from '$lib/shared/components/ConfirmModal.svelte';
import AdminConfirmModal from '$lib/shared/components/AdminConfirmModal.svelte';
import { sanitizeFileSegment } from '$lib/shared/fileNaming';
import { generarCodigoProyecto } from '$lib/shared/codigoProyecto';

	const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

	function formatDate(value: string | Date | null | undefined) {
		if (!value) return '';
		// Fechas "solo día" (YYYY-MM-DD, ej. fecha_inicio_plan) se parsean directo del string en vez de
		// pasar por `new Date()` — `new Date('YYYY-MM-DD')` las interpreta como medianoche UTC, y
		// leerlas de vuelta con getDate()/getMonth() (hora LOCAL) las corría un día atrás en husos
		// horarios detrás de UTC (Perú, UTC-5) — por eso esta fecha no coincidía con la que muestra el
		// popup de Editar Venta (que usa un <input type="date"> nativo, sin este problema).
		if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
			const [year, month, day] = value.split('-');
			return `${day}/${month}/${year}`;
		}
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';
		const day = String(date.getDate()).padStart(2, '0');
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const year = date.getFullYear();
		return `${day}/${month}/${year}`;
	}

	/** Cómo se identifica una venta en los textos de la pantalla (confirmaciones, solicitudes de
	 * aprobación, títulos del visor de PDF): por su CÓDIGO, igual que la columna "Proyecto" de la
	 * tabla. `proyecto` (nombre_proyecto) queda de respaldo para ventas viejas sin código armable. */
	function etiquetaVenta(row: any) {
		return row?.codigo || row?.proyecto || 'Venta';
	}

	function getInitials(name: string) {
		return name
			.split(' ')
			.filter(Boolean)
			.slice(0, 2)
			.map(part => part[0]?.toUpperCase() || '')
			.join('') || 'NA';
	}

	function mapProjectType(code: string) {
		switch (code) {
			case 'O': return 'Proyecto de Obra';
			case 'M': return 'Mantenimiento';
			case 'A': return 'Ampliación';
			case 'N': return 'Nuevo';
			case 'U': return 'Viv. Unifamiliar';
			case 'C': return 'Comercial';
			default: return code || 'Otros';
		}
	}

	/** Orden de la tabla, a pedido del usuario: primero "En negociación", luego "Venta Cerrada", y
	 * "Dado de baja" siempre al final — dentro de cada grupo, por fecha de creación (más reciente
	 * primero, mismo criterio que el orden por defecto que ya tenía la tabla). */
	function prioridadEstado(estado: string): number {
		if (estado === 'baja') return 2;
		if (estado === 'venta_cerrada') return 1;
		return 0; // 'activo' u otro valor -> "En negociación"
	}
	function compararVentasParaTabla(a: any, b: any): number {
		const diffPrioridad = prioridadEstado(a.estado_proyecto) - prioridadEstado(b.estado_proyecto);
		if (diffPrioridad !== 0) return diffPrioridad;
		return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
	}

	let ventas = $state<any[]>([]);
	let isLoading = $state(true);
	let errorMessage = $state<string | null>(null);

	// A pedido del usuario: las ventas dadas de baja dejan de aparecer en el listado normal — solo un
	// admin puede activar "Ver eliminados" (mismo patrón que Clientes/Proveedores/Centro de Costos,
	// ver skill dar-de-baja-pattern).
	let verEliminados = $state(false);
	function toggleVerEliminados() {
		verEliminados = !verEliminados;
		fetchVentas();
	}

	let kpis = $state({
		ventasCerradas: 0,
		valorTotal: 0,
		comisionTotal: 0,
		ticketPromedio: 0,
		tasaCierre: 0
	});

	let summary = $state({
		tipoLabels: [] as string[],
		tipoData: [] as number[],
		topAsesores: [] as any[],
		asesorCount: 0
	});

	let charts = $state({
		labels: MONTH_NAMES,
		ventasPorMes: Array(12).fill(0),
		propuestasPorMes: Array(12).fill(0),
		comisionesPorMes: Array(12).fill(0)
	});

	// Un solo popup (NuevaVentaModal.svelte) para crear Y editar/gestionar una venta — a pedido del
	// usuario: antes "Editar" navegaba a /proyectos/gestion/{id} y el botón de Proforma abría un
	// popup aparte (ProformasVentaModal.svelte, ahora fusionado ahí mismo); ambos confluyen acá.
	let isModalOpen = $state(false);
	let modalMode = $state<'create' | 'edit'>('create');
	let editingVentaId = $state<number | null>(null);

	// A pedido del usuario: al cerrar una venta, la transacción (ingreso) del adelanto se abre en el
	// popup de Transacciones para completar ahí los datos que el cierre de venta no pide (tipo de
	// documento, N° de documento, forma/medio de pago, categoría) — mismo patrón "onTransaccionSugerida"
	// que ya usan CobroModal.svelte/PagoModal.svelte en Cuentas por Cobrar/Pagar. Como la transacción ya
	// quedó creada de verdad (no es un pago/cobro pendiente por confirmar), se abre en modo edición
	// simple, sin onConfirm ni lockedFields.
	let transaccionModalOpen = $state(false);
	// 'edit': el adelanto ya existe de verdad en la BD (handleTransaccionSugerida), solo se completa.
	// 'create': el egreso de devolución al dar de baja una venta (handleTransaccionBajaSugerida) todavía
	// NO se guardó — createTransaccion exige comprobante_url, que acá todavía no existe — el usuario
	// debe adjuntarlo y confirmar antes de que se inserte de verdad.
	let transaccionModalMode = $state<'create' | 'edit'>('edit');
	let transaccionParaCompletar = $state<Transaccion | null>(null);
	let transaccionDynamicOptions = $state<Record<string, FieldOption[]>>({ id_centro_costo_origen: [], id_centro_costo_destino: [] });

	/** A pedido del usuario: en el <select> de Origen debe verse el centro de costo + nombre del
	 * CLIENTE, y en el de Destino el centro de costo + código del PROYECTO de esta misma venta cerrada
	 * — no lo que sea que diga `centro_costo.nombre` (la lista genérica de transaccionDynamicOptions),
	 * que puede haber quedado desactualizado (ej. antes nombre_proyecto guardaba el nombre del cliente,
	 * no el código, ver historial de codigoProyecto.ts). Se resuelve el código propio de cada centro
	 * (columna `centro_costo.codigo`, ej. "CLI-5"/"PROY-12") y se arma la etiqueta fresca con el
	 * nombre/código que NuevaVentaModal ya resolvió en el momento del cierre — sin tocar el resto de la
	 * lista, para que el usuario pueda seguir eligiendo cualquier otro centro si hiciera falta.
	 *
	 * OJO con la clave de Destino: el adelanto SIEMPRE se crea con tipo_alcance:'externa' y
	 * tipo:'ingreso' — con esa combinación, TransaccionModal.svelte (ver su función `optionsFor`) NO
	 * usa `dynamicOptions.id_centro_costo_destino` para el <select> de Destino, usa
	 * `dynamicOptions.id_centro_costo_destino_externo` (el sufijo "_externo" es la lista mezclada de
	 * cuentas externas). Origen sí usa la clave plana en este caso puntual (Ingreso tiene una excepción
	 * para Origen, no para Destino) — por eso hay que escribir en las DOS claves de destino para que
	 * quede bien sin importar cuál lea el formulario. */
	async function handleTransaccionSugerida(transaccion: Transaccion, contexto: { clienteNombre: string; proyectoCodigo: string }) {
		transaccionParaCompletar = transaccion;
		transaccionModalMode = 'edit';
		transaccionModalOpen = true;

		const origenId = transaccion.id_centro_costo_origen;
		const destinoId = transaccion.id_centro_costo_destino;
		const { data: centros, error } = await supabase
			.from('centro_costo')
			.select('id_centro_costo, codigo')
			.in('id_centro_costo', [origenId, destinoId]);
		if (error) {
			console.error('[Ventas] Error resolviendo códigos de centro de costo para el popup de Transacciones:', error);
			return;
		}

		const codigoOrigen = centros?.find((c) => c.id_centro_costo === origenId)?.codigo ?? '';
		const codigoDestino = centros?.find((c) => c.id_centro_costo === destinoId)?.codigo ?? '';

		function conEtiquetaFresca(opciones: FieldOption[], id: number, label: string): FieldOption[] {
			const idStr = String(id);
			return [...opciones.filter((o) => o.value !== idStr), { value: idStr, label }];
		}

		const destinoLabel = `${codigoDestino} - ${contexto.proyectoCodigo}`;
		transaccionDynamicOptions = {
			...transaccionDynamicOptions,
			id_centro_costo_origen: conEtiquetaFresca(transaccionDynamicOptions.id_centro_costo_origen ?? [], origenId, `${codigoOrigen} - ${contexto.clienteNombre}`),
			id_centro_costo_destino: conEtiquetaFresca(transaccionDynamicOptions.id_centro_costo_destino ?? [], destinoId, destinoLabel),
			id_centro_costo_destino_externo: conEtiquetaFresca(transaccionDynamicOptions.id_centro_costo_destino_externo ?? [], destinoId, destinoLabel)
		};
	}

	/** A pedido explícito del usuario: dar de baja una venta CERRADA no da de baja sus transacciones —
	 * en vez de eso, si el proyecto llegó a recibir algo, se sugiere un EGRESO de devolución
	 * (proyecto -> cliente, ver darDeBajaVenta en aprobaciones.service.ts) que TODAVÍA NO existe en la
	 * BD — a diferencia de handleTransaccionSugerida (adelanto, ya guardado, se abre en modo 'edit'),
	 * este abre el popup en modo 'create' para que el usuario adjunte el comprobante (obligatorio,
	 * createTransaccion lo exige) y confirme antes de que se inserte de verdad.
	 *
	 * Claves de dynamicOptions distintas a las del adelanto: TransaccionModal.svelte (optionsFor) resuelve
	 * Origen/Destino según Tipo+Alcance — para Egreso/Externa, Origen lee `..._externo` (igual que
	 * cualquier otro campo) pero Destino tiene una excepción propia y lee `..._destino_solo_centros`
	 * (la lista "Centro de Costos" en sentido estricto, ver esDestinoEgresoExterna en optionsFor) — por
	 * eso se escribe en esas dos claves, no en las que usa el adelanto (ingreso). */
	async function handleTransaccionBajaSugerida(sugerida: {
		idCentroCostoOrigen: number;
		idCentroCostoDestino: number;
		montoTotal: number;
		descripcion: string;
		clienteNombre: string;
		proyectoNombre: string;
	}) {
		const hoy = new Date().toISOString().slice(0, 10);
		transaccionParaCompletar = {
			id_transaccion: 0,
			id_centro_costo_origen: sugerida.idCentroCostoOrigen,
			id_centro_costo_destino: sugerida.idCentroCostoDestino,
			fecha: hoy,
			id_nombre: null,
			tipo_documento: null,
			num_documento: null,
			tipo_transaccion: null,
			forma_pago: null,
			descripcion: sugerida.descripcion,
			tipo: 'egreso',
			monto_total: sugerida.montoTotal,
			medio_pago: null,
			cuente_origen: null,
			cuente_destino: null,
			estado: 'activo',
			usuario_registro: null,
			created_at: hoy,
			comprobante_url: null,
			factura_url: null,
			aprobado: false,
			aprobado_por: null,
			aprobado_en: null,
			tipo_alcance: 'externa'
		};
		transaccionModalMode = 'create';
		transaccionModalOpen = true;

		const { idCentroCostoOrigen: origenId, idCentroCostoDestino: destinoId } = sugerida;
		const { data: centros, error } = await supabase
			.from('centro_costo')
			.select('id_centro_costo, codigo')
			.in('id_centro_costo', [origenId, destinoId]);
		if (error) {
			console.error('[Ventas] Error resolviendo códigos de centro de costo para el popup de Transacciones:', error);
			return;
		}

		const codigoOrigen = centros?.find((c) => c.id_centro_costo === origenId)?.codigo ?? '';
		const codigoDestino = centros?.find((c) => c.id_centro_costo === destinoId)?.codigo ?? '';

		function conEtiquetaFresca(opciones: FieldOption[], id: number, label: string): FieldOption[] {
			const idStr = String(id);
			return [...opciones.filter((o) => o.value !== idStr), { value: idStr, label }];
		}

		transaccionDynamicOptions = {
			...transaccionDynamicOptions,
			id_centro_costo_origen_externo: conEtiquetaFresca(transaccionDynamicOptions.id_centro_costo_origen_externo ?? [], origenId, `${codigoOrigen} - ${sugerida.proyectoNombre}`),
			id_centro_costo_destino_solo_centros: conEtiquetaFresca(transaccionDynamicOptions.id_centro_costo_destino_solo_centros ?? [], destinoId, `${codigoDestino} - ${sugerida.clienteNombre}`)
		};
	}

	function closeTransaccionModal() {
		transaccionModalOpen = false;
		transaccionParaCompletar = null;
		transaccionModalMode = 'edit';
	}

	// Filtro de fecha del cuadro "Resumen de ventas" (sidebar) — independiente de la tabla/gráficos
	// de abajo, a pedido del usuario. Por defecto: el año en curso. Se recalcula con una consulta
	// PROPIA (no reutiliza `ventas`, que viene limitada a 100 filas) para que el resumen sea exacto
	// sin importar cuántas ventas cerradas haya en el rango elegido.
	function primerDiaDelAnio() {
		const hoy = new Date();
		return `${hoy.getFullYear()}-01-01`;
	}
	function hoyISO() {
		return new Date().toISOString().slice(0, 10);
	}

	let resumenDesde = $state(primerDiaDelAnio());
	let resumenHasta = $state(hoyISO());
	let resumenLoading = $state(false);
	let resumenKpis = $state({ valorTotal: 0, comisionTotal: 0, ventasCount: 0, asesorCount: 0 });

	/** Solo ventas CERRADAS (estado_proyecto='venta_cerrada') cuya fecha caiga en [resumenDesde,
	 * resumenHasta] — mismo filtro de permisos que fetchVentas: un asesor no-admin solo ve las suyas
	 * (asesor_comercial_id = su propio id), un admin ve todas. */
	async function fetchResumenVentas() {
		resumenLoading = true;
		try {
			let query = supabase
				.from('proyecto')
				.select('precio_venta,comision_asesor,responsable,asesor_comercial_id,fecha_inicio_plan,estado_proyecto')
				.eq('estado_proyecto', 'venta_cerrada');

			if (resumenDesde) query = query.gte('fecha_inicio_plan', resumenDesde);
			if (resumenHasta) query = query.lte('fecha_inicio_plan', resumenHasta);

			if (!isAdmin()) {
				const { data: userData } = await supabase.auth.getUser();
				const currentUserId = userData?.user?.id;
				query = currentUserId ? query.eq('asesor_comercial_id', currentUserId) : query.eq('asesor_comercial_id', '00000000-0000-0000-0000-000000000000');
			}

			const { data, error } = await query;
			if (error) throw error;

			const filas = data || [];
			const asesores = new Set<string>();
			let valorTotal = 0;
			let comisionTotal = 0;
			for (const row of filas as any[]) {
				const valor = Number(row.precio_venta) || 0;
				const comisionPct = Number(row.comision_asesor) || 10;
				valorTotal += valor;
				comisionTotal += valor * (comisionPct / 100);
				asesores.add(String(row.asesor_comercial_id || row.responsable || 'Sin asignar'));
			}

			resumenKpis = { valorTotal, comisionTotal: Math.round(comisionTotal), ventasCount: filas.length, asesorCount: asesores.size };
		} catch (err) {
			console.error('[Ventas] Error cargando el resumen de ventas:', err);
		} finally {
			resumenLoading = false;
		}
	}

	function handleResumenDesdeChange(value: string) {
		resumenDesde = value;
		fetchResumenVentas();
	}
	function handleResumenHastaChange(value: string) {
		resumenHasta = value;
		fetchResumenVentas();
	}

	async function fetchVentas() {
		isLoading = true;
		errorMessage = null;

		try {
			// Un asesor/vendedor (cualquier rol que no sea administrador) solo debe ver SUS PROPIAS
			// ventas cerradas, no las de toda la cartera — pedido explícito del usuario. Se filtra por
			// asesor_comercial_id (el UUID de auth de quien la cerró, ver NuevaVentaModal.svelte donde
			// se guarda como session.user.id al crear la venta) en vez de `responsable` (nombre de
			// texto libre, no confiable para filtrar: puede tener errores de tipeo o coincidir entre
			// dos personas distintas).
			let query = supabase
				.from('proyecto')
				.select('id_proyecto,id_cliente,nombre_proyecto,precio_venta,tip_proyecto,tipo_edifica,estado_predio,nro_pisos,ubicacion,distrito,tipo_obra,tipo_tramite,tipo_intervencion,tipo_edificacion_obra,mes_obra,anio_obra,fecha_inicio_plan,created_at,comision_asesor,responsable,asesor_comercial_id,descripcion,contrato,estado_proyecto,tipo_venta,cliente:id_cliente(nombre)');

			if (!isAdmin()) {
				const { data: userData } = await supabase.auth.getUser();
				const currentUserId = userData?.user?.id;
				query = currentUserId ? query.eq('asesor_comercial_id', currentUserId) : query.eq('asesor_comercial_id', '00000000-0000-0000-0000-000000000000');
			}

			// A pedido del usuario: las ventas dadas de baja dejan de listarse por defecto — solo un
			// admin puede activar "Ver eliminados" para verlas (ver toggleVerEliminados más abajo).
			query = verEliminados ? query.eq('estado_proyecto', 'baja') : query.neq('estado_proyecto', 'baja');

			const { data, error } = await query
				.order('fecha_inicio_plan', { ascending: false })
				.limit(100);

			if (error) throw error;

			const proyectos = data || [];
			const tipoCounts: Record<string, number> = {};
			const asesorMap = new Map<string, { ventas: number; count: number }>();
			const ventasPorMes = Array(12).fill(0);
			const comisionesPorMes = Array(12).fill(0);

			ventas = proyectos.map((project: any) => {
				const valor = Number(project.precio_venta) || 0;
				const comisionPct = Number(project.comision_asesor) || 10;
				const tipoRaw = String(project.tip_proyecto || project.tipo_edifica || 'Otros');
				const tipo = mapProjectType(tipoRaw);
				const fechaRaw = project.fecha_inicio_plan || project.created_at;
				const fecha = formatDate(fechaRaw);
				const date = fechaRaw ? new Date(fechaRaw) : null;

				if (date && !Number.isNaN(date.getTime())) {
					ventasPorMes[date.getMonth()] += valor;
					comisionesPorMes[date.getMonth()] += valor * (comisionPct / 100);
				}

				tipoCounts[tipo] = (tipoCounts[tipo] || 0) + 1;

				// `responsable` es el nombre para MOSTRAR (texto libre) — asesor_comercial_id ahora
				// también viene en el select (se usa arriba para filtrar), pero es el UUID de auth, no
				// un nombre, así que no debe usarse aquí para no mostrar un UUID en pantalla.
				const asesor = String(project.responsable || 'Sin asignar');
				const asesorData = asesorMap.get(asesor) || { ventas: 0, count: 0 };
				asesorData.ventas += valor;
				asesorData.count += 1;
				asesorMap.set(asesor, asesorData);

				// A pedido del usuario, la columna "Proyecto" del listado muestra el CÓDIGO del proyecto
				// (el mismo "Código generado" de Nueva Venta) y no el nombre del cliente — que hasta
				// ahora era lo que terminaba ahí, porque `nombre_proyecto` se autocompleta con el nombre
				// del cliente al crear la venta. El nombre del cliente pasó a su propia columna.
				// El código no está guardado en ninguna columna, se recalcula (ver codigoProyecto.ts).
				const codigo = generarCodigoProyecto(project);

				return {
					id: project.id_proyecto,
					id_cliente: project.id_cliente ?? null,
					clienteNombre: project.cliente?.nombre || null,
					codigo,
					proyecto: project.nombre_proyecto || 'Proyecto sin nombre',
					valor,
					tipo,
					fecha,
					asesor,
					asesorInitials: getInitials(asesor),
					comisionPct,
					comision: Math.round(valor * (comisionPct / 100)),
					descripcion: project.descripcion || '',
					contrato: project.contrato || '',
					estado_proyecto: project.estado_proyecto || 'activo',
					tipoVenta: project.tipo_venta || 'obra',
					createdAt: project.created_at
				};
			}).sort(compararVentasParaTabla);

			// Los KPIs de arriba ("Ventas cerradas", "Valor total", etc.) reflejan solo las ventas ya
			// CERRADAS (estado_proyecto='venta_cerrada' — ver ProformasVentaModal.svelte). La tabla y
			// los gráficos de más abajo siguen mostrando TODAS las ventas del asesor (abiertas y
			// cerradas), pedido explícito del usuario para no ocultar las que siguen en negociación.
			const cerradas = ventas.filter((row) => row.estado_proyecto === 'venta_cerrada');
			const ventasCerradas = cerradas.length;
			const valorTotal = cerradas.reduce((sum, row) => sum + row.valor, 0);
			const comisionTotal = cerradas.reduce((sum, row) => sum + row.comision, 0);
			const ticketPromedio = ventasCerradas ? Math.round(valorTotal / ventasCerradas) : 0;

			kpis = {
				ventasCerradas,
				valorTotal,
				comisionTotal,
				ticketPromedio,
				tasaCierre: 0
			};

			summary = {
				tipoLabels: Object.keys(tipoCounts),
				tipoData: Object.values(tipoCounts),
				topAsesores: Array.from(asesorMap.entries())
					.sort(([, a], [, b]) => b.ventas - a.ventas)
					.slice(0, 5)
					.map(([nombre, stats]) => ({
						nombre,
						ventas: stats.ventas,
						max: stats.ventas,
						color: 'bg-blue-500'
					})),
				asesorCount: asesorMap.size
			};

			charts = {
				labels: MONTH_NAMES,
				ventasPorMes,
				propuestasPorMes: ventasPorMes.map(value => Math.round(value * 1.25)),
				comisionesPorMes
			};
		} catch (err) {
			console.error('[Ventas] Error cargando datos de ventas:', err);
			errorMessage = 'No se pudo cargar la información. Verifica la conexión y vuelve a intentarlo.';
		} finally {
			isLoading = false;
		}
	}

	// Tabla/KPIs en tiempo real (mismo mecanismo que la campanita de notificaciones): apenas cambia
	// algo en `proyecto` — otro usuario crea, edita o cierra una venta — este canal se entera al
	// instante y vuelve a pedir los datos, sin que haga falta recargar la página. Requiere
	// ventas_clientes_realtime_migration.sql aplicada en Supabase.
	let realtimeChannel: RealtimeChannel | null = null;

	async function fetchTransaccionDynamicOptions() {
		try {
			const [centroCostoOptions, cuentaBancoOptions] = await Promise.all([
				getCentroCostoOptions(supabase),
				getCuentaBancoOptions(supabase)
			]);
			transaccionDynamicOptions = {
				id_centro_costo_origen: centroCostoOptions,
				id_centro_costo_destino: centroCostoOptions,
				cuenta_banco: cuentaBancoOptions
			};
		} catch (err) {
			console.error('[Ventas] Error cargando centros de costo para el popup de Transacciones:', err);
		}
	}

	onMount(() => {
		fetchVentas();
		fetchResumenVentas();
		fetchTransaccionDynamicOptions();

		realtimeChannel = supabase
			.channel('ventas_proyecto_changes')
			.on('postgres_changes', { event: '*', schema: 'public', table: 'proyecto' }, () => {
				fetchVentas();
				fetchResumenVentas();
			})
			.subscribe();
	});

	onDestroy(() => {
		if (realtimeChannel) supabase.removeChannel(realtimeChannel);
	});

	/** Al guardar o cerrar una venta desde el popup (NuevaVentaModal onSaved) — antes solo refrescaba
	 * la tabla/gráficos (fetchVentas), y el panel "Resumen de ventas" (que tiene su propio filtro de
	 * fechas y su propia consulta, ver fetchResumenVentas) se quedaba con los datos de antes de cerrar
	 * la venta hasta que el usuario tocara a mano el filtro de fechas del panel. */
	function handleVentaGuardada() {
		fetchVentas();
		fetchResumenVentas();
	}

	function openModal() {
		modalMode = 'create';
		editingVentaId = null;
		isModalOpen = true;
	}

	/** Abre el mismo popup en modo edición — usado tanto por "Editar" (lápiz) como por "Proforma"
	 * (pdf), que antes llevaban a lugares distintos. */
	function openEditModal(row: any) {
		const id = row?.id ?? row?.id_proyecto;
		if (!id) {
			console.warn('[Ventas] Editar falló: id no encontrado en row', row);
			return;
		}
		modalMode = 'edit';
		editingVentaId = Number(id);
		isModalOpen = true;
	}

	let isExporting = $state(false);

	/** A pedido del usuario: el botón "Exportar" (antes 100% decorativo) ahora genera un .xlsx real
	 * (antes CSV). Igual criterio que editar/eliminar: un admin exporta directo, un no-admin manda una
	 * solicitud de aprobación (ver crearSolicitud/aprobarSolicitud en aprobaciones.service.ts — al
	 * aprobarla, el admin es quien termina generando y descargando el archivo, en nombre de quien lo
	 * pidió). `modulo: 'ventas'` en payloadCambios es lo que le permite a aprobarSolicitud distinguir
	 * esta exportación de la de Clientes, que comparte el mismo tipo_accion 'exportar'. */
	async function handleExportar() {
		if (!isAdmin()) {
			const result = await crearSolicitud(supabase, {
				tipoEntidad: 'exportacion',
				idEntidad: null,
				tipoAccion: 'exportar',
				descripcionEntidad: 'Exportación de ventas',
				payloadCambios: { modulo: 'ventas' }
			});
			if (result.success) {
				alert('No tienes permisos de administrador. Se envió una solicitud de exportación para que un administrador la apruebe.');
			} else {
				alert(`No se pudo enviar la solicitud. ${result.message ?? ''}`);
			}
			return;
		}

		isExporting = true;
		try {
			const result = await exportarVentasXLSX(supabase);
			if (!result.success) alert(`No se pudo exportar. ${result.message ?? ''}`);
		} finally {
			isExporting = false;
		}
	}

	function closeModal() {
		isModalOpen = false;
		editingVentaId = null;
	}

	function handleEditEvent(e: CustomEvent) {
		openEditModal(e.detail.row);
	}

	let isDandoDeBaja = $state(false);

	/** A pedido del usuario: "Eliminar" (una venta abierta) y "Dar de baja" (una venta cerrada) se
	 * unifican en UNA sola acción reversible, sin importar el estado previo — darDeBajaVenta ya
	 * soporta cualquier estado_proyecto de entrada. Ya no pasa por el flujo de solicitud de aprobación
	 * (no es un borrado, mismo criterio que Clientes/Proveedores — cualquiera puede dar de baja SU
	 * propia venta directo). ConfirmModal en vez de window.confirm nativo (puede fallar por ACL en
	 * Tauri). Si el proyecto llegó a recibir algún ingreso, darDeBajaVenta devuelve en `data` la
	 * sugerencia de un egreso de devolución (proyecto -> cliente) — se abre el popup de Transacciones
	 * para completarla (ver handleTransaccionBajaSugerida), igual que el adelanto inicial al cerrar
	 * una venta. El borrado PERMANENTE (eliminarVentaCascade) se movió a la sección "Eliminados"
	 * (solo-admin, ver handleEliminarPermanente más abajo), siempre con contraseña. */
	let confirmDarDeBajaOpen = $state(false);
	let ventaParaDarDeBaja = $state<{ id: number; nombre: string } | null>(null);

	function handleDarDeBajaEvent(e: CustomEvent) {
		const row = e.detail.row;
		if (!row?.id) return;
		ventaParaDarDeBaja = { id: row.id, nombre: etiquetaVenta(row) };
		confirmDarDeBajaOpen = true;
	}

	function closeConfirmDarDeBaja() {
		confirmDarDeBajaOpen = false;
		ventaParaDarDeBaja = null;
	}

	async function confirmarDarDeBaja() {
		if (!ventaParaDarDeBaja) return;
		isDandoDeBaja = true;
		try {
			const result = await darDeBajaVenta(supabase, ventaParaDarDeBaja.id);
			if (!result.success) throw new Error(result.message);
			toast.success(`Venta "${ventaParaDarDeBaja.nombre}" dada de baja correctamente.`);
			await fetchVentas();
			if (result.data) await handleTransaccionBajaSugerida(result.data);
		} catch (err) {
			console.error('[Ventas] Error dando de baja la venta:', err);
			toast.error(`No se pudo dar de baja la venta. ${describeError(err)}`);
		} finally {
			isDandoDeBaja = false;
			closeConfirmDarDeBaja();
		}
	}

	// ── Sección "Eliminados" (solo-admin): restaurar (sin contraseña) y borrado permanente (SIEMPRE
	// con contraseña de admin, sin excepción). ──

	let confirmRestaurarOpen = $state(false);
	let ventaParaRestaurar = $state<{ id: number; nombre: string } | null>(null);

	function handleRestaurarEvent(e: CustomEvent) {
		const row = e.detail.row;
		if (!row?.id) return;
		ventaParaRestaurar = { id: row.id, nombre: etiquetaVenta(row) };
		confirmRestaurarOpen = true;
	}
	function closeConfirmRestaurar() {
		confirmRestaurarOpen = false;
		ventaParaRestaurar = null;
	}
	async function confirmarRestaurar() {
		if (!ventaParaRestaurar) return;
		try {
			const result = await restaurarVenta(supabase, ventaParaRestaurar.id);
			if (result.success) {
				toast.success(`Venta "${ventaParaRestaurar.nombre}" restaurada correctamente.`);
				await fetchVentas();
			} else {
				toast.error(`No se pudo restaurar la venta. ${result.message ?? ''}`);
			}
		} catch (err) {
			toast.error(`No se pudo restaurar la venta. ${describeError(err)}`);
		} finally {
			closeConfirmRestaurar();
		}
	}

	let confirmEliminarPermanenteOpen = $state(false);
	let ventaParaEliminarPermanente = $state<{ id: number; nombre: string } | null>(null);
	let eliminandoPermanente = $state(false);

	function handleEliminarPermanenteEvent(e: CustomEvent) {
		const row = e.detail.row;
		if (!row?.id) return;
		ventaParaEliminarPermanente = { id: row.id, nombre: etiquetaVenta(row) };
		confirmEliminarPermanenteOpen = true;
	}
	function closeConfirmEliminarPermanente() {
		if (eliminandoPermanente) return;
		confirmEliminarPermanenteOpen = false;
		ventaParaEliminarPermanente = null;
	}

	/** Igual patrón que el borrado masivo de Transacciones: verifyAdminCredentials re-autentica de
	 * verdad contra Supabase Auth antes de ejecutar eliminarVentaCascade (el mismo borrado real de
	 * siempre — presupuesto, cronograma, documentos, adelantos, etc.). */
	async function confirmarEliminarPermanente(email: string, password: string) {
		if (!ventaParaEliminarPermanente) return;
		const verificacion = await verifyAdminCredentials(email, password);
		if (!verificacion.success) throw new Error(verificacion.message);

		eliminandoPermanente = true;
		try {
			const result = await eliminarVentaCascade(supabase, ventaParaEliminarPermanente.id);
			if (result.success) {
				toast.success(`Venta "${ventaParaEliminarPermanente.nombre}" eliminada permanentemente.`);
				confirmEliminarPermanenteOpen = false;
				ventaParaEliminarPermanente = null;
				await fetchVentas();
			} else {
				throw new Error(result.message || 'No se pudo eliminar la venta.');
			}
		} finally {
			eliminandoPermanente = false;
		}
	}

	// Preview de documentos (contrato/proforma) — el modal en sí (conversión de URL de Drive,
	// descarga, iframe) vive en el componente compartido DocumentPreviewModal.svelte, reusado
	// también en Transacciones para el comprobante.
	let isPdfPreviewOpen = $state(false);
	let pdfPreviewUrl = $state('');
	let pdfPreviewTitle = $state('');
	let pdfPreviewDocuments = $state<{ url: string; label: string }[]>([]);
	let pdfPreviewInitialIndex = $state(0);

	function closePreview() {
		isPdfPreviewOpen = false;
		pdfPreviewUrl = '';
		pdfPreviewTitle = '';
		pdfPreviewDocuments = [];
		pdfPreviewInitialIndex = 0;
	}

	function handleViewContrato(e: CustomEvent) {
		const row = e.detail.row;
		if (!row?.contrato) {
			alert('No se encontró el contrato para este proyecto.');
			return;
		}
		pdfPreviewDocuments = [];
		pdfPreviewUrl = String(row.contrato);
		pdfPreviewTitle = `Contrato - ${etiquetaVenta(row)}`;
		isPdfPreviewOpen = true;
	}

	// El botón "Proforma" (pdf) de VentasTable es solo una vista rápida — a pedido del usuario, NO
	// abre el popup completo de edición; para gestionar todas las proformas (agregar, elegir la
	// final, cerrar la venta) hay que usar "Editar" (lápiz). Trae TODAS las proformas del proyecto
	// (antes solo la final/última) para que, si hay más de una, el popup muestre el selector de
	// DocumentPreviewModal y se pueda elegir cuál ver — la selección inicial sigue el mismo criterio
	// de antes: si la venta YA está cerrada, la marcada como FINAL; si sigue en negociación (todavía
	// no hay ninguna final elegida), la ÚLTIMA subida.
	async function handleViewProforma(e: CustomEvent) {
		const row = e.detail.row;
		const id = row?.id ?? row?.id_proyecto;
		if (!id) return;
		try {
			const { data, error } = await supabase
				.from('documento_proyecto')
				.select('storage_url, nombre, created_at, es_proforma_final')
				.eq('id_proyecto', id)
				.eq('tipo_documento', 'Proforma')
				.order('created_at', { ascending: true });
			if (error) throw error;

			const proformas = (data ?? []).filter((p) => p.storage_url);
			if (proformas.length === 0) {
				alert('No se encontró ninguna proforma para este proyecto.');
				return;
			}

			pdfPreviewDocuments = proformas.map((p, i) => ({
				url: p.storage_url as string,
				label: `${p.nombre || `Proforma ${i + 1}`}${p.es_proforma_final ? ' · Final' : ''}`
			}));
			const indiceFinal = proformas.findIndex((p) => p.es_proforma_final);
			pdfPreviewInitialIndex = row?.estado_proyecto === 'venta_cerrada' && indiceFinal !== -1 ? indiceFinal : proformas.length - 1;
			pdfPreviewTitle = `Proforma - ${etiquetaVenta(row)}`;
			isPdfPreviewOpen = true;
		} catch (err) {
			console.error('[Ventas] Error cargando la proforma:', err);
			alert(`No se pudo cargar la proforma. ${describeError(err)}`);
		}
	}
</script>

<svelte:head>
	<title>Venta cerrada | Comercial - Construni ERP</title>
</svelte:head>

<div class="flex flex-col h-[calc(100vh-80px)] overflow-hidden bg-slate-50/50">
	
	<!-- Header area -->
	<div class="flex-shrink-0 px-6 py-5 flex items-center justify-between border-b border-slate-100 bg-white">
		<div class="flex flex-col">
			<div class="flex items-center gap-2 text-slate-500 text-sm mb-1">
				<span class="font-bold text-slate-800 text-2xl">{verEliminados ? 'Ventas eliminadas' : 'Venta cerrada'}</span>
				{#if verEliminados}
					<span class="text-[10px] font-bold px-2 py-0.5 rounded-md bg-rose-50 text-rose-600 border border-rose-200 uppercase tracking-wide">Solo administradores</span>
				{/if}
			</div>
			<p class="text-sm text-slate-500">
				{verEliminados
					? 'Ventas dadas de baja — restauralas o elimínalas de la base de datos permanentemente.'
					: 'Consulta y administra todas tus ventas cerradas.'}
			</p>
		</div>

		<div class="flex items-center gap-3">
			{#if isAdmin()}
				<button onclick={toggleVerEliminados} class={`px-4 py-2 rounded-xl font-medium text-sm transition-colors shadow-sm flex items-center gap-2 ${verEliminados ? 'bg-slate-800 text-white hover:bg-slate-900' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
					<i class={`fas ${verEliminados ? 'fa-arrow-left' : 'fa-trash-can'}`}></i>
					{verEliminados ? 'Volver a Ventas' : 'Ver eliminados'}
				</button>
			{/if}
			{#if !verEliminados}
				<button onclick={handleExportar} disabled={isExporting} class="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors shadow-sm flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
					{#if isExporting}
						<i class="fas fa-spinner fa-spin"></i> Exportando...
					{:else}
						<i class="fas fa-download"></i> Exportar
					{/if}
				</button>
				<button onclick={openModal} class="px-5 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm shadow-md shadow-blue-600/20 transition-all active:scale-[0.98] flex items-center gap-2">
					<i class="fas fa-plus"></i> Nueva venta
				</button>
			{/if}
		</div>
	</div>

	<!-- Scrollable content -->
	<div class="flex-1 overflow-y-auto p-6">
		<div class="flex flex-col gap-6 max-w-[1600px] mx-auto">
			<!-- Top KPIs -->
				<VentasKPIs ventasCerradas={kpis.ventasCerradas} valorTotal={kpis.valorTotal} comisionTotal={kpis.comisionTotal} ticketPromedio={kpis.ticketPromedio} tasaCierre={kpis.tasaCierre} />
			<!-- Main Content Grid -->
			<div class="grid grid-cols-1 xl:grid-cols-4 gap-6">
				<!-- Left Area (Table + Charts) -->
				<div class="xl:col-span-3 flex flex-col gap-6">
					{#if isLoading}
						<div class="rounded-3xl border border-slate-200 bg-white p-10 text-center text-slate-500">
							<i class="fas fa-spinner fa-spin text-2xl mb-4"></i>
							<p class="text-sm font-medium">Cargando ventas...</p>
						</div>
					{:else if errorMessage}
						<div class="rounded-3xl border border-rose-200 bg-rose-50 p-10 text-center text-rose-700">
							<p class="text-sm font-semibold">{errorMessage}</p>
						</div>
					{:else}
						<!-- Data Table -->
						<div class="md:h-[500px]">
							<VentasTable data={ventas} modoEliminados={verEliminados} on:editRow={handleEditEvent} on:darDeBaja={handleDarDeBajaEvent} on:restaurar={handleRestaurarEvent} on:eliminarPermanente={handleEliminarPermanenteEvent} on:gestionarProformas={handleViewProforma} on:viewContrato={handleViewContrato} />
						</div>
						<!-- Charts Area -->
						<VentasCharts ventasPorMes={charts.ventasPorMes} ventasVsPropuestas={{ ventas: charts.ventasPorMes, propuestas: charts.propuestasPorMes }} comisionesPorMes={charts.comisionesPorMes} />
					{/if}
				</div>

				<!-- Right Area (Summary Sidebar) -->
				<div class="xl:col-span-1">
					<VentasSummarySidebar
					labels={summary.tipoLabels}
					tipoData={summary.tipoData}
					topAsesores={summary.topAsesores}
					valorTotal={resumenKpis.valorTotal}
					comisionTotal={resumenKpis.comisionTotal}
					ventasCount={resumenKpis.ventasCount}
					asesorCount={resumenKpis.asesorCount}
					desde={resumenDesde}
					hasta={resumenHasta}
					onDesdeChange={handleResumenDesdeChange}
					onHastaChange={handleResumenHastaChange}
				/>
				</div>
			</div>
		</div>
	</div>
</div>

<!-- Modal Overlay: crea Y edita/gestiona (proformas, contrato, cierre) la venta -->
<NuevaVentaModal
	isOpen={isModalOpen}
	mode={modalMode}
	ventaId={editingVentaId}
	onClose={closeModal}
	onSaved={handleVentaGuardada}
	onTransaccionSugerida={handleTransaccionSugerida}
/>

<!-- Preview de contrato/proforma -->
<DocumentPreviewModal
	open={isPdfPreviewOpen}
	url={pdfPreviewUrl}
	documents={pdfPreviewDocuments}
	initialIndex={pdfPreviewInitialIndex}
	title={pdfPreviewTitle}
	onClose={closePreview}
/>

<!-- Transacción del adelanto (a pedido del usuario: al cerrar una venta, se abre para completar los
     datos que el cierre de venta no pide) -->
<TransaccionModal
	open={transaccionModalOpen}
	mode={transaccionModalMode}
	transaccion={transaccionParaCompletar}
	dynamicOptions={transaccionDynamicOptions}
	onClose={closeTransaccionModal}
	onSaved={closeTransaccionModal}
/>

<ConfirmModal
	open={confirmDarDeBajaOpen}
	title="Dar de baja la venta"
	message={ventaParaDarDeBaja ? `¿Dar de baja la venta "${ventaParaDarDeBaja.nombre}"? Quedará marcada como inactiva.` : ''}
	confirmLabel="Dar de baja"
	onConfirm={confirmarDarDeBaja}
	onClose={closeConfirmDarDeBaja}
/>

<ConfirmModal
	open={confirmRestaurarOpen}
	title="Restaurar venta"
	danger={false}
	message={ventaParaRestaurar ? `¿Restaurar la venta "${ventaParaRestaurar.nombre}"? Volverá a aparecer en el listado.` : ''}
	confirmLabel="Restaurar"
	onConfirm={confirmarRestaurar}
	onClose={closeConfirmRestaurar}
/>

<AdminConfirmModal
	open={confirmEliminarPermanenteOpen}
	title="Eliminar venta permanentemente"
	message={ventaParaEliminarPermanente ? `Vas a eliminar PERMANENTEMENTE la venta "${ventaParaEliminarPermanente.nombre}" y todo su proyecto asociado (presupuesto, cronograma, documentos, adelantos, etc.) de la base de datos. Esta acción no se puede deshacer. Ingresa el correo y la contraseña de un administrador para continuar.` : ''}
	confirmLabel="Eliminar permanentemente"
	onConfirm={confirmarEliminarPermanente}
	onClose={closeConfirmEliminarPermanente}
/>
