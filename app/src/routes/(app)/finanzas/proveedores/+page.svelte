<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import ProveedoresTable from '$lib/components/finanzas/proveedores/ProveedoresTable.svelte';
	import ProveedorModal from '$lib/components/finanzas/proveedores/ProveedorModal.svelte';

	let proveedores = $state<any[]>([]);
	let isModalOpen = $state(false);
	let proveedorToEdit = $state<any>(null);
	let isLoading = $state(true);

	async function fetchProveedores() {
		isLoading = true;
		try {
			const { data, error } = await supabase
				.from('proveedor')
				.select('*')
				.order('id_proveedor', { ascending: false });
				
			if (error) throw error;
			proveedores = data || [];
		} catch (err) {
			console.error('Error fetching proveedores:', err);
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		fetchProveedores();
	});

	function openModal(proveedor = null) {
		proveedorToEdit = proveedor;
		isModalOpen = true;
	}

	function closeModal() {
		isModalOpen = false;
		proveedorToEdit = null;
	}

	function onSaveSuccess() {
		fetchProveedores(); // Refresh list after saving
	}

	async function handleDelete(id: number) {
		if (confirm('¿Estás seguro de eliminar este proveedor? Esta acción no se puede deshacer.')) {
			try {
				const { error } = await supabase
					.from('proveedor')
					.delete()
					.eq('id_proveedor', id);
				
				if (error) throw error;
				await fetchProveedores(); // Refresh
			} catch (err) {
				console.error('Error deleting proveedor:', err);
				alert('Ocurrió un error al eliminar el proveedor.');
			}
		}
	}
</script>

<svelte:head>
	<title>Proveedores | Finanzas - Construni ERP</title>
</svelte:head>

<div class="flex flex-col md:h-[calc(100vh-80px)] md:overflow-hidden bg-slate-50/50">
	
	<!-- Header area -->
	<div class="flex-shrink-0 px-6 py-5 flex items-center justify-between border-b border-slate-100 bg-white">
		<div class="flex flex-col">
			<div class="flex items-center gap-2 text-slate-500 text-sm mb-1">
				<a href="/finanzas" class="hover:text-blue-600 transition-colors"><i class="fas fa-arrow-left"></i></a>
				<span class="font-bold text-slate-800 text-2xl ml-2">Directorio de Proveedores</span>
			</div>
			<p class="text-sm text-slate-500 ml-7">Administra los proveedores de materiales, servicios y equipos.</p>
		</div>
		
		<div class="flex items-center gap-3">
			<button class="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors shadow-sm flex items-center gap-2">
				<i class="fas fa-download"></i> Exportar
			</button>
			<button onclick={() => openModal(null)} class="px-5 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm shadow-md shadow-blue-600/20 transition-all active:scale-[0.98] flex items-center gap-2">
				<i class="fas fa-plus"></i> Nuevo Proveedor
			</button>
		</div>
	</div>

	<!-- Scrollable content -->
	<div class="flex-1 overflow-y-auto md:overflow-hidden p-6">
		<div class="md:h-full max-w-[1200px] mx-auto flex flex-col">
			{#if isLoading}
				<div class="flex-1 flex items-center justify-center">
					<div class="flex flex-col items-center gap-3 text-slate-400">
						<i class="fas fa-spinner fa-spin text-2xl text-blue-500"></i>
						<span class="text-sm font-medium">Cargando proveedores...</span>
					</div>
				</div>
			{:else}
				<ProveedoresTable 
					{proveedores} 
					onEdit={openModal} 
					onDelete={handleDelete} 
				/>
			{/if}
		</div>
	</div>
</div>

<ProveedorModal 
	isOpen={isModalOpen} 
	proveedorEdit={proveedorToEdit}
	onClose={closeModal} 
	onSave={onSaveSuccess}
/>
