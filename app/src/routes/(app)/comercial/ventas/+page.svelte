<script lang="ts">
	import VentasKPIs from '$lib/components/comercial/ventas/VentasKPIs.svelte';
	import VentasTable from '$lib/components/comercial/ventas/VentasTable.svelte';
	import VentasCharts from '$lib/components/comercial/ventas/VentasCharts.svelte';
	import VentasSummarySidebar from '$lib/components/comercial/ventas/VentasSummarySidebar.svelte';
	import NuevaVentaModal from '$lib/components/comercial/ventas/NuevaVentaModal.svelte';

	let isModalOpen = $state(false);

	function openModal() {
		isModalOpen = true;
	}

	function closeModal() {
		isModalOpen = false;
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
				<a href="/comercial" class="hover:text-blue-600 transition-colors"><i class="fas fa-arrow-left"></i></a>
				<span class="font-bold text-slate-800 text-2xl ml-2">Venta cerrada</span>
			</div>
			<p class="text-sm text-slate-500 ml-7">Consulta y administra todas tus ventas cerradas.</p>
		</div>
		
		<div class="flex items-center gap-3">
			<button class="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors shadow-sm flex items-center gap-2">
				<i class="fas fa-download"></i> Exportar
			</button>
			<button on:click={openModal} class="px-5 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm shadow-md shadow-blue-600/20 transition-all active:scale-[0.98] flex items-center gap-2">
				<i class="fas fa-plus"></i> Nueva venta
			</button>
		</div>
	</div>

	<!-- Scrollable content -->
	<div class="flex-1 overflow-y-auto p-6">
		<div class="flex flex-col gap-6 max-w-[1600px] mx-auto">
			<!-- Top KPIs -->
			<VentasKPIs />

			<!-- Main Content Grid -->
			<div class="grid grid-cols-1 xl:grid-cols-4 gap-6">
				<!-- Left Area (Table + Charts) -->
				<div class="xl:col-span-3 flex flex-col gap-6">
					
					<!-- Data Table -->
					<div class="h-[500px]">
						<VentasTable />
					</div>

					<!-- Charts Area -->
					<VentasCharts />
				</div>

				<!-- Right Area (Summary Sidebar) -->
				<div class="xl:col-span-1">
					<VentasSummarySidebar />
				</div>
			</div>
		</div>
	</div>
</div>

<!-- Modal Overlay -->
<NuevaVentaModal isOpen={isModalOpen} onClose={closeModal} />
