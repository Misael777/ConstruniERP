<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin } from '$lib/stores/permisos.svelte';
	import { crearSolicitud, deleteClienteCascade } from '$lib/modules/aprobaciones/services/aprobaciones.service';
	import ClientesTable from '$lib/components/comercial/clientes/ClientesTable.svelte';
	import ClienteModal from '$lib/components/comercial/clientes/ClienteModal.svelte';

	let clientes = $state<any[]>([]);
	let isModalOpen = $state(false);
	let clienteToEdit = $state<any>(null);
	let isLoading = $state(true);

	async function fetchClientes() {
		isLoading = true;
		try {
			const { data, error } = await supabase
				.from('cliente')
				.select('*')
				.order('id_cliente', { ascending: false });
				
			if (error) throw error;
			clientes = data || [];
		} catch (err) {
			console.error('Error fetching clientes:', err);
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		fetchClientes();
	});

	function openModal(cliente = null) {
		clienteToEdit = cliente;
		isModalOpen = true;
	}

	function closeModal() {
		isModalOpen = false;
		clienteToEdit = null;
	}

	function onSaveSuccess() {
		fetchClientes(); // Refresh list after saving
	}

	async function handleDelete(id: number) {
		const cliente = clientes.find((c) => c.id_cliente === id);
		const nombre = cliente?.nombre || `Cliente #${id}`;

		// A pedido del usuario: un no-administrador ya no puede eliminar un cliente directo — se
		// envía una solicitud de aprobación, visible para todos los admins en la campanita.
		if (!isAdmin()) {
			const result = await crearSolicitud(supabase, {
				tipoEntidad: 'cliente',
				idEntidad: id,
				tipoAccion: 'eliminar',
				descripcionEntidad: nombre
			});
			if (result.success) {
				alert('No tienes permisos de administrador. Se envió una solicitud de eliminación para que un administrador la apruebe.');
			} else {
				alert(`No se pudo enviar la solicitud. ${result.message ?? ''}`);
			}
			return;
		}

		if (confirm('¿Estás seguro de eliminar este cliente? Esta acción no se puede deshacer.')) {
			const result = await deleteClienteCascade(supabase, id);
			if (result.success) {
				await fetchClientes(); // Refresh
			} else {
				console.error('Error deleting cliente:', result.message);
				alert(`Ocurrió un error al eliminar el cliente. ${result.message ?? ''}`);
			}
		}
	}
</script>

<svelte:head>
	<title>Clientes | Comercial - Construni ERP</title>
</svelte:head>

<div class="flex flex-col md:h-[calc(100vh-80px)] md:overflow-hidden bg-slate-50/50">
	
	<!-- Header area -->
	<div class="flex-shrink-0 px-6 py-5 flex items-center justify-between border-b border-slate-100 bg-white">
		<div class="flex flex-col">
			<div class="flex items-center gap-2 text-slate-500 text-sm mb-1">
				<a href="/comercial" class="hover:text-blue-600 transition-colors"><i class="fas fa-arrow-left"></i></a>
				<span class="font-bold text-slate-800 text-2xl ml-2">Directorio de Clientes</span>
			</div>
			<p class="text-sm text-slate-500 ml-7">Gestiona la base de datos de tus clientes corporativos y personas naturales.</p>
		</div>
		
		<div class="flex items-center gap-3">
			<button class="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 font-medium text-sm transition-colors shadow-sm flex items-center gap-2">
				<i class="fas fa-download"></i> Exportar
			</button>
			<button onclick={() => openModal(null)} class="px-5 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm shadow-md shadow-blue-600/20 transition-all active:scale-[0.98] flex items-center gap-2">
				<i class="fas fa-plus"></i> Nuevo Cliente
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
						<span class="text-sm font-medium">Cargando clientes...</span>
					</div>
				</div>
			{:else}
				<ClientesTable 
					{clientes} 
					onEdit={openModal} 
					onDelete={handleDelete} 
				/>
			{/if}
		</div>
	</div>
</div>

<ClienteModal 
	isOpen={isModalOpen} 
	clienteEdit={clienteToEdit}
	onClose={closeModal} 
	onSave={onSaveSuccess}
/>
