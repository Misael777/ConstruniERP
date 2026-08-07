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
import { describeError } from '$lib/shared/describeError';
import { crearSolicitud, eliminarVentaCascade } from '$lib/modules/aprobaciones/services/aprobaciones.service';
import { exportarVentasXLSX } from '$lib/modules/ventas/services/ventasExport.service';
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

	let ventas = $state<any[]>([]);
	let isLoading = $state(true);
	let errorMessage = $state<string | null>(null);

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
					tipoVenta: project.tipo_venta || 'obra'
				};
			});

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

	onMount(() => {
		fetchVentas();
		fetchResumenVentas();

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

	let isDeleting = $state(false);
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

	/** A pedido del usuario: un no-administrador ya no puede eliminar una venta directo — se envía
	 * una solicitud de aprobación (reemplaza al viejo ConfirmDeleteVentaModal de contraseña de
	 * admin). Un admin sigue eliminando directo, con el mismo cascade de siempre
	 * (eliminarVentaCascade en aprobaciones.service.ts). */
	async function handleDeleteEvent(e: CustomEvent) {
		const row = e.detail.row;
		if (!row?.id) return;

		if (!isAdmin()) {
			const result = await crearSolicitud(supabase, {
				tipoEntidad: 'proyecto',
				idEntidad: row.id,
				tipoAccion: 'eliminar',
				descripcionEntidad: etiquetaVenta(row)
			});
			if (result.success) {
				alert('No tienes permisos de administrador. Se envió una solicitud de eliminación para que un administrador la apruebe.');
			} else {
				alert(`No se pudo enviar la solicitud. ${result.message ?? ''}`);
			}
			return;
		}

		if (!confirm(`¿Eliminar la venta "${etiquetaVenta(row)}"? Esto borra en cascada su proyecto asociado (presupuesto, cronograma, documentos, adelantos, etc.). Esta acción no se puede deshacer.`)) return;

		isDeleting = true;
		try {
			const result = await eliminarVentaCascade(supabase, row.id);
			if (!result.success) throw new Error(result.message);
			fetchVentas();
		} catch (err) {
			console.error('[Ventas] Error eliminando venta:', err);
			alert(`No se pudo eliminar el proyecto.\n${describeError(err)}`);
		} finally {
			isDeleting = false;
		}
	}

	// Preview de documentos (contrato/proforma) — el modal en sí (conversión de URL de Drive,
	// descarga, iframe) vive en el componente compartido DocumentPreviewModal.svelte, reusado
	// también en Transacciones para el comprobante.
	let isPdfPreviewOpen = $state(false);
	let pdfPreviewUrl = $state('');
	let pdfPreviewTitle = $state('');

	function closePreview() {
		isPdfPreviewOpen = false;
		pdfPreviewUrl = '';
		pdfPreviewTitle = '';
	}

	function handleViewContrato(e: CustomEvent) {
		const row = e.detail.row;
		if (!row?.contrato) {
			alert('No se encontró el contrato para este proyecto.');
			return;
		}
		pdfPreviewUrl = String(row.contrato);
		pdfPreviewTitle = `Contrato - ${etiquetaVenta(row)}`;
		isPdfPreviewOpen = true;
	}

	// El botón "Proforma" (pdf) de VentasTable es solo una vista rápida — a pedido del usuario, NO
	// abre el popup completo de edición; para gestionar todas las proformas (agregar, elegir la
	// final, cerrar la venta) hay que usar "Editar" (lápiz). Si la venta YA está cerrada, muestra la
	// proforma marcada como FINAL (la que realmente aplica); si sigue en negociación, no hay una
	// final elegida todavía, así que muestra la ÚLTIMA subida.
	async function handleViewProforma(e: CustomEvent) {
		const row = e.detail.row;
		const id = row?.id ?? row?.id_proyecto;
		if (!id) return;
		try {
			let query = supabase
				.from('documento_proyecto')
				.select('storage_url, nombre')
				.eq('id_proyecto', id)
				.eq('tipo_documento', 'Proforma');

			query = row?.estado_proyecto === 'venta_cerrada'
				? query.eq('es_proforma_final', true)
				: query.order('created_at', { ascending: false });

			const { data, error } = await query.limit(1).maybeSingle();
			if (error) throw error;
			if (!data?.storage_url) {
				alert('No se encontró ninguna proforma para este proyecto.');
				return;
			}
			pdfPreviewUrl = data.storage_url;
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
				<span class="font-bold text-slate-800 text-2xl">Venta cerrada</span>
			</div>
			<p class="text-sm text-slate-500">Consulta y administra todas tus ventas cerradas.</p>
		</div>
		
		<div class="flex items-center gap-3">
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
							<VentasTable data={ventas} on:editRow={handleEditEvent} on:deleteRow={handleDeleteEvent} on:gestionarProformas={handleViewProforma} on:viewContrato={handleViewContrato} />
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
<NuevaVentaModal isOpen={isModalOpen} mode={modalMode} ventaId={editingVentaId} onClose={closeModal} onSaved={handleVentaGuardada} />

<!-- Preview de contrato/proforma -->
<DocumentPreviewModal open={isPdfPreviewOpen} url={pdfPreviewUrl} title={pdfPreviewTitle} onClose={closePreview} />
