<script lang="ts">
import { onMount } from 'svelte';
import { goto } from '$app/navigation';
import { supabase } from '$lib/supabaseClient';
import VentasKPIs from '$lib/components/comercial/ventas/VentasKPIs.svelte';
import VentasTable from '$lib/components/comercial/ventas/VentasTable.svelte';
import VentasCharts from '$lib/components/comercial/ventas/VentasCharts.svelte';
import VentasSummarySidebar from '$lib/components/comercial/ventas/VentasSummarySidebar.svelte';
import NuevaVentaModal from '$lib/components/comercial/ventas/NuevaVentaModal.svelte';

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

	async function fetchVentas() {
		isLoading = true;
		errorMessage = null;

		try {
			const { data, error } = await supabase
				.from('proyecto')
				.select('id_proyecto,nombre_proyecto,precio_venta,tip_proyecto,tipo_edifica,fecha_inicio_plan,created_at,comision_asesor,responsable,descripcion,contrato')
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
				const tipo = String(project.tip_proyecto || project.tipo_edifica || 'Otros');
				const fechaRaw = project.fecha_inicio_plan || project.created_at;
				const fecha = formatDate(fechaRaw);
				const date = fechaRaw ? new Date(fechaRaw) : null;

				if (date && !Number.isNaN(date.getTime())) {
					ventasPorMes[date.getMonth()] += valor;
					comisionesPorMes[date.getMonth()] += valor * (comisionPct / 100);
				}

				tipoCounts[tipo] = (tipoCounts[tipo] || 0) + 1;

				const asesor = String((project.asesor_comercial_id ?? project.responsable) || 'Sin asignar');
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
					contrato: project.contrato || ''
				};
			});

			const ventasCerradas = ventas.length;
			const valorTotal = ventas.reduce((sum, row) => sum + row.valor, 0);
			const comisionTotal = ventas.reduce((sum, row) => sum + row.comision, 0);
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
	});

	function openModal() {
		isModalOpen = true;
	}

	let confirmRow: any = $state(null);
	let isDeleting = $state(false);

	function closeModal() {
		isModalOpen = false;
	}

	function handleEditEvent(e: CustomEvent) {
		const id = e.detail.row?.id;
		if (!id) return;
		goto(`/proyectos/gestion?id=${id}`);
	}

	function handleDeleteEvent(e: CustomEvent) {
		confirmRow = e.detail.row;
		if (!confirmRow) return;

		const message = `¿Estás seguro de eliminar el proyecto "${confirmRow.proyecto}"?`;
		if (!confirm(message)) {
			return;
		}

		performDelete();
	}

	async function performDelete() {
		if (!confirmRow) return;
		isDeleting = true;

		try {
			const { error } = await supabase.from('proyecto').delete().eq('id_proyecto', confirmRow.id);
			if (error) throw error;
			confirmRow = null;
			fetchVentas();
		} catch (err) {
			console.error('[Ventas] Error deleting project:', err);
			alert('No se pudo eliminar el proyecto. Revisa la consola.');
		} finally {
			isDeleting = false;
		}
	}

	// PDF preview state and helpers
	let isPdfPreviewOpen = $state(false);
	let pdfPreviewUrl = $state('');
	let pdfPreviewTitle = $state('');

	function ensurePreviewUrl(url: string) {
		console.log('[ensurePreviewUrl] URL original:', url);
		if (!url) {
			console.log('[ensurePreviewUrl] URL vacía');
			return '';
		}
		try {
			const u = new URL(url);
			console.log('[ensurePreviewUrl] URL parseada correctamente');
			console.log('[ensurePreviewUrl] Hostname:', u.hostname);
			if (u.hostname.includes('drive.google.com')) {
				console.log('[ensurePreviewUrl] Detectado Google Drive');
				const id = u.searchParams.get('id');
				if (id) {
					const previewUrl = `https://drive.google.com/file/d/${id}/preview`;
					console.log('[ensurePreviewUrl] ID encontrado en searchParams:', id);
					console.log('[ensurePreviewUrl] URL de preview:', previewUrl);
					return previewUrl;
				}
				const m = u.pathname.match(/\/file\/d\/([^\/]+)/);
				if (m) {
					const previewUrl = `https://drive.google.com/file/d/${m[1]}/preview`;
					console.log('[ensurePreviewUrl] ID encontrado en pathname:', m[1]);
					console.log('[ensurePreviewUrl] URL de preview:', previewUrl);
					return previewUrl;
				}
			}
			console.log('[ensurePreviewUrl] Devolviendo URL sin cambios');
			return url;
		} catch (err) {
			console.error('[ensurePreviewUrl] Error parseando URL:', err);
			console.log('[ensurePreviewUrl] URL problemática:', url);
			return url;
		}
	}

	function extractProformaUrl(description: string) {
		console.log('[extractProformaUrl] Description recibida:', description);
		if (!description) {
			console.log('[extractProformaUrl] Description vacía');
			return null;
		}
		const match = description.match(/https?:\/\/[\w\-._%~:\/\?#[\]@!$&'()*+,;=%]+/);
		if (match) {
			console.log('[extractProformaUrl] URL encontrada:', match[0]);
			return match[0];
		}
		console.log('[extractProformaUrl] No se encontró URL en la descripción');
		return null;
	}

	function closePdfPreview() {
		isPdfPreviewOpen = false;
		pdfPreviewUrl = '';
		pdfPreviewTitle = '';
	}

	function handleViewContrato(e: CustomEvent) {
		console.log('[handleViewContrato] Evento recibido');
		const row = e.detail.row;
		console.log('[handleViewContrato] Row:', row);
		console.log('[handleViewContrato] Contrato URL:', row?.contrato);
		
		if (!row?.contrato) {
			console.error('[handleViewContrato] No hay contrato para este proyecto');
			alert('No se encontró el contrato para este proyecto.');
			return;
		}
		
		console.log('[handleViewContrato] Procesando URL del contrato');
		const urlProcessada = ensurePreviewUrl(String(row.contrato));
		console.log('[handleViewContrato] URL procesada:', urlProcessada);
		
		pdfPreviewUrl = urlProcessada;
		pdfPreviewTitle = `Contrato - ${row.proyecto}`;
		isPdfPreviewOpen = true;
		
		console.log('[handleViewContrato] Preview abierto');
		console.log('[handleViewContrato] pdfPreviewUrl:', pdfPreviewUrl);
		console.log('[handleViewContrato] pdfPreviewTitle:', pdfPreviewTitle);
	}

	function handleViewProforma(e: CustomEvent) {
		console.log('[handleViewProforma] Evento recibido');
		const row = e.detail.row;
		console.log('[handleViewProforma] Row:', row);
		console.log('[handleViewProforma] Descripción:', row?.descripcion);
		
		const url = extractProformaUrl(String(row?.descripcion || ''));
		console.log('[handleViewProforma] URL extraída:', url);
		
		if (!url) {
			console.error('[handleViewProforma] No se encontró URL en la descripción');
			alert('No se encontró la proforma para este proyecto.');
			return;
		}
		
		console.log('[handleViewProforma] Procesando URL');
		const urlProcessada = ensurePreviewUrl(url);
		console.log('[handleViewProforma] URL procesada:', urlProcessada);
		
		pdfPreviewUrl = urlProcessada;
		pdfPreviewTitle = `Proforma - ${row.proyecto}`;
		isPdfPreviewOpen = true;
		
		console.log('[handleViewProforma] Preview abierto');
		console.log('[handleViewProforma] pdfPreviewUrl:', pdfPreviewUrl);
		console.log('[handleViewProforma] pdfPreviewTitle:', pdfPreviewTitle);
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
				<a href="/comercial" aria-label="Regresar a Comercial" class="hover:text-blue-600 transition-colors"><i class="fas fa-arrow-left"></i></a>
				<span class="font-bold text-slate-800 text-2xl ml-2">Venta cerrada</span>
			</div>
			<p class="text-sm text-slate-500 ml-7">Consulta y administra todas tus ventas cerradas.</p>
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
						<div class="h-[500px]">
						<VentasTable data={ventas} on:editRow={handleEditEvent} on:deleteRow={handleDeleteEvent} on:viewProforma={handleViewProforma} on:viewContrato={handleViewContrato} />					</div>
						<!-- Charts Area -->
						<VentasCharts ventasPorMes={charts.ventasPorMes} ventasVsPropuestas={{ ventas: charts.ventasPorMes, propuestas: charts.propuestasPorMes }} comisionesPorMes={charts.comisionesPorMes} />
					{/if}
				</div>

				<!-- Right Area (Summary Sidebar) -->
				<div class="xl:col-span-1">
					<VentasSummarySidebar labels={summary.tipoLabels} tipoData={summary.tipoData} topAsesores={summary.topAsesores} valorTotal={kpis.valorTotal} comisionTotal={kpis.comisionTotal} ventasCount={kpis.ventasCerradas} asesorCount={summary.asesorCount} />
				</div>
			</div>
		</div>
	</div>
</div>

<!-- Modal Overlay -->
<NuevaVentaModal isOpen={isModalOpen} onClose={closeModal} />

<!-- PDF Preview Modal -->
{#if isPdfPreviewOpen}
	<div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden">
			<!-- Modal Header -->
			<div class="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
				<h2 class="text-lg font-semibold text-slate-800">{pdfPreviewTitle}</h2>
				<button 
					onclick={closePdfPreview}
					class="text-slate-400 hover:text-slate-600 transition-colors w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded-lg"
					aria-label="Cerrar"
				>
					<i class="fas fa-times text-lg"></i>
				</button>
			</div>

			<!-- Modal Content with iframe -->
			<div class="flex-1 overflow-hidden bg-slate-100">
				{#if pdfPreviewUrl}
					<iframe 
						src={pdfPreviewUrl}
						title={pdfPreviewTitle}
						class="w-full h-full border-none"
						allowfullscreen
					></iframe>
				{:else}
					<div class="w-full h-full flex items-center justify-center">
						<div class="text-center text-slate-500">
							<i class="fas fa-exclamation-circle text-4xl mb-3"></i>
							<p class="font-medium">No se pudo cargar la vista previa</p>
							<p class="text-sm mt-1">URL no disponible</p>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
