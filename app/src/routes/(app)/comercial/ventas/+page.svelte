<script lang="ts">
import { onMount } from 'svelte';
import { goto } from '$app/navigation';
import { supabase } from '$lib/supabaseClient';
import { isAdmin } from '$lib/stores/permisos.svelte';
import VentasKPIs from '$lib/components/comercial/ventas/VentasKPIs.svelte';
import VentasTable from '$lib/components/comercial/ventas/VentasTable.svelte';
import VentasCharts from '$lib/components/comercial/ventas/VentasCharts.svelte';
import VentasSummarySidebar from '$lib/components/comercial/ventas/VentasSummarySidebar.svelte';
import NuevaVentaModal from '$lib/components/comercial/ventas/NuevaVentaModal.svelte';
import ConfirmDeleteVentaModal from '$lib/components/comercial/ventas/ConfirmDeleteVentaModal.svelte';
import ProformasVentaModal from '$lib/components/comercial/ventas/ProformasVentaModal.svelte';
import DocumentPreviewModal from '$lib/shared/components/DocumentPreviewModal.svelte';
import { describeError } from '$lib/shared/describeError';

	const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

	function formatDate(value: string | Date | null | undefined) {
		if (!value) return '';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';
		const day = String(date.getDate()).padStart(2, '0');
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const year = date.getFullYear();
		return `${day}/${month}/${year}`;
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

	let isModalOpen = $state(false);

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
				.select('id_proyecto,nombre_proyecto,precio_venta,tip_proyecto,tipo_edifica,fecha_inicio_plan,created_at,comision_asesor,responsable,asesor_comercial_id,descripcion,contrato,estado_proyecto');

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

				return {
					id: project.id_proyecto,
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
					estado_proyecto: project.estado_proyecto || 'activo'
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

	onMount(() => {
		fetchVentas();
		fetchResumenVentas();
	});

	function openModal() {
		isModalOpen = true;
	}

	let confirmRow: any = $state(null);
	let isDeleting = $state(false);
	/** true = el modal de advertencia + contraseña de admin ya se muestra para `confirmRow`. La
	 * eliminación real (performDelete) solo se dispara desde el callback onConfirmed de ese modal,
	 * nunca directo desde el click en el botón — ver handleDeleteEvent. */
	let showDeleteConfirm = $state(false);

	function closeModal() {
		isModalOpen = false;
	}

	function handleEditEvent(e: CustomEvent) {
		const row = e.detail.row;
		const id = row?.id ?? row?.id_proyecto;
		const url = `/proyectos/gestion/${id}`;
		console.log('[Ventas] Editar proyecto', { row, id, url });
		if (!id) {
			console.warn('[Ventas] Editar falló: id no encontrado en row', row);
			return;
		}
		const serializableRow = {
			id: row?.id ?? row?.id_proyecto ?? null,
			id_proyecto: row?.id_proyecto ?? row?.id ?? null,
			nombre_proyecto: row?.proyecto ?? row?.nombre_proyecto ?? '',
			precio_venta: row?.valor ?? row?.precio_venta ?? null,
			tip_proyecto: row?.tipo ?? row?.tip_proyecto ?? '',
			fecha_inicio_plan: row?.fecha ?? null,
			responsable: row?.asesor ?? row?.responsable ?? '',
			descripcion: row?.descripcion ?? '',
			contrato: row?.contrato ?? ''
		};
		goto(url, { state: { row: serializableRow } });
	}

	function handleDeleteEvent(e: CustomEvent) {
		confirmRow = e.detail.row;
		if (!confirmRow) return;
		showDeleteConfirm = true;
	}

	function cancelDelete() {
		showDeleteConfirm = false;
		confirmRow = null;
	}

	function handleDeleteConfirmed() {
		showDeleteConfirm = false;
		performDelete();
	}

	async function performDelete() {
		if (!confirmRow) return;
		isDeleting = true;
		let step = 'inicio';

		try {
			const id = confirmRow.id;
			console.log('[Ventas] performDelete: iniciando borrado de proyecto id=', id);

			// Delete tables that reference proyecto WITHOUT ON DELETE CASCADE
			// presupuesto_detalle cascades from presupuesto, so deleting presupuesto covers it
			step = 'borrar presupuesto';
			const { error: e1 } = await supabase.from('presupuesto').delete().eq('id_proyecto', id);
			console.log(`[Ventas] performDelete: ${step} ->`, e1 ?? 'OK');
			if (e1) throw e1;

			step = 'borrar adelanto';
			const { error: e2 } = await supabase.from('adelanto').delete().eq('id_proyecto', id);
			console.log(`[Ventas] performDelete: ${step} ->`, e2 ?? 'OK');
			if (e2) throw e2;

			step = 'borrar contrato_proyecto';
			const { error: e3 } = await supabase.from('contrato_proyecto').delete().eq('id_proyecto', id);
			console.log(`[Ventas] performDelete: ${step} ->`, e3 ?? 'OK');
			if (e3) throw e3;

			// cuentas_cobrar has a nullable FK — nullify to preserve payment records
			step = 'desvincular cuentas_cobrar';
			const { error: e4 } = await supabase.from('cuentas_cobrar').update({ id_proyecto: null }).eq('id_proyecto', id);
			console.log(`[Ventas] performDelete: ${step} ->`, e4 ?? 'OK');
			if (e4) throw e4;

			// All other FK references have ON DELETE CASCADE and will auto-delete
			step = 'borrar proyecto';
			const { error } = await supabase.from('proyecto').delete().eq('id_proyecto', id);
			console.log(`[Ventas] performDelete: ${step} ->`, error ?? 'OK');
			if (error) throw error;

			confirmRow = null;
			fetchVentas();
		} catch (err) {
			console.error(`[Ventas] Error deleting project en paso "${step}":`, err);
			alert(`No se pudo eliminar el proyecto.\nPaso: ${step}\n${describeError(err)}`);
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
		pdfPreviewTitle = `Contrato - ${row.proyecto}`;
		isPdfPreviewOpen = true;
	}

	// Gestión de proformas (múltiples por venta) + cierre formal de la venta — ver
	// ProformasVentaModal.svelte. Reemplaza al viejo handleViewProforma de un solo archivo.
	let proformasModalOpen = $state(false);
	let proformasModalProyecto: { id_proyecto: number; nombre_proyecto: string; contrato: string; estado_proyecto: string } | null = $state(null);

	function handleGestionarProformas(e: CustomEvent) {
		const row = e.detail.row;
		if (!row?.id) return;
		proformasModalProyecto = {
			id_proyecto: row.id,
			nombre_proyecto: row.proyecto,
			contrato: row.contrato || '',
			estado_proyecto: row.estado_proyecto || 'activo'
		};
		proformasModalOpen = true;
	}

	function closeProformasModal() {
		proformasModalOpen = false;
		proformasModalProyecto = null;
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
			<button class="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors shadow-sm flex items-center gap-2">
				<i class="fas fa-download"></i> Exportar
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
							<VentasTable data={ventas} on:editRow={handleEditEvent} on:deleteRow={handleDeleteEvent} on:gestionarProformas={handleGestionarProformas} on:viewContrato={handleViewContrato} />
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

<!-- Modal Overlay -->
<NuevaVentaModal isOpen={isModalOpen} onClose={closeModal} onSaved={fetchVentas} />

<!-- Confirmación de eliminación (advertencia + contraseña de admin) -->
<ConfirmDeleteVentaModal
	open={showDeleteConfirm}
	ventaNombre={confirmRow?.proyecto ?? ''}
	onCancel={cancelDelete}
	onConfirmed={handleDeleteConfirmed}
/>

<!-- Preview de contrato/proforma -->
<DocumentPreviewModal open={isPdfPreviewOpen} url={pdfPreviewUrl} title={pdfPreviewTitle} onClose={closePreview} />

<!-- Gestión de proformas (múltiples) + cierre formal de venta -->
<ProformasVentaModal
	open={proformasModalOpen}
	proyecto={proformasModalProyecto}
	onClose={closeProformasModal}
	onUpdated={fetchVentas}
/>
