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
				.select('id_proyecto,nombre_proyecto,precio_venta,tip_proyecto,tipo_edifica,fecha_inicio_plan,created_at,comision_asesor,responsable')
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
					comision: Math.round(valor * (comisionPct / 100))
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
						<VentasTable data={ventas} on:editRow={handleEditEvent} on:deleteRow={handleDeleteEvent} />					</div>
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
