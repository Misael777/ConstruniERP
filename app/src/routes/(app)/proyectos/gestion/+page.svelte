<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { goto } from '$app/navigation';
	import { isAdmin } from '$lib/stores/permisos.svelte';
	import PresupuestoModule from '$lib/components/proyecto/PresupuestoModule.svelte';

	// A pedido explícito del usuario: Gestión ahora tiene dos pestañas — "Proyectos" (la lista de
	// siempre, sin tocar) y "Presupuesto" (el submódulo que antes vivía en su propia ruta del menú).
	let vistaGestion = $state<'proyectos' | 'presupuesto'>('proyectos');

	type Proyecto = {
		id_proyecto: number;
		nombre_proyecto: string;
		ubicacion: string;
		fecha_inicio_plan: string;
		fecha_fin_plan: string;
		estado_proyecto: string;
		costo_estima: number;
	};

	let proyectos = $state<Proyecto[]>([]);
	let isLoading = $state(true);
	let searchTerm = $state('');

	onMount(async () => {
		try {
			// Un usuario no-administrador solo debe ver (y poder entrar a) SUS PROPIOS proyectos, no
			// los de toda la cartera — mismo criterio ya usado en Ventas (ver comercial/ventas/
			// +page.svelte, fetchVentas). Se filtra por asesor_comercial_id (UUID de auth de quien
			// creó el proyecto/venta), no por `responsable` (texto libre, no confiable).
			// A pedido del usuario: acá solo deben verse las ventas YA CERRADAS (proyectos reales, con
			// Gantt/Presupuesto/Documentos) — las que siguen en negociación se gestionan en Ventas.
			let query = supabase.from('proyecto').select('*').eq('estado_proyecto', 'venta_cerrada');
			if (!isAdmin()) {
				const { data: userData } = await supabase.auth.getUser();
				const currentUserId = userData?.user?.id;
				query = currentUserId ? query.eq('asesor_comercial_id', currentUserId) : query.eq('asesor_comercial_id', '00000000-0000-0000-0000-000000000000');
			}

			const { data, error } = await query.order('created_at', { ascending: false });

			if (error) throw error;
			proyectos = data || [];
		} catch (error) {
			console.error("Error cargando proyectos:", error);
		} finally {
			isLoading = false;
		}
	});

	let filteredProyectos = $derived(
		proyectos.filter(p => p.nombre_proyecto.toLowerCase().includes(searchTerm.toLowerCase()))
	);

	function openProject(id: number) {
		goto(`/proyectos/gestion/${id}`);
	}

	function getStatusColor(estado: string) {
		switch(estado?.toLowerCase()) {
			case 'activo': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
			case 'pausado': return 'bg-amber-100 text-amber-700 border-amber-200';
			case 'completado': return 'bg-blue-100 text-blue-700 border-blue-200';
			case 'venta_cerrada': return 'bg-emerald-100 text-emerald-700 border-emerald-300';
			default: return 'bg-slate-100 text-slate-700 border-slate-200';
		}
	}

	function getStatusLabel(estado: string) {
		if (estado?.toLowerCase() === 'venta_cerrada') return 'Venta Cerrada';
		return estado || 'ACTIVO';
	}
</script>

<svelte:head>
	<title>Gestión de Proyectos | Construni ERP</title>
</svelte:head>

<div class="mb-6">
	<div class="text-xs text-slate-500 mb-2">Proyectos &nbsp;>&nbsp; Gestión</div>
	<div class="flex gap-1 border-b border-slate-200">
		<button
			type="button"
			onclick={() => (vistaGestion = 'proyectos')}
			class={`px-4 py-2.5 text-sm font-bold border-b-2 transition-colors ${vistaGestion === 'proyectos' ? 'text-orange-600 border-orange-600' : 'text-slate-500 border-transparent hover:text-slate-800'}`}
		>
			<i class="fas fa-building mr-1.5"></i> Proyectos
		</button>
		<button
			type="button"
			onclick={() => (vistaGestion = 'presupuesto')}
			class={`px-4 py-2.5 text-sm font-bold border-b-2 transition-colors ${vistaGestion === 'presupuesto' ? 'text-orange-600 border-orange-600' : 'text-slate-500 border-transparent hover:text-slate-800'}`}
		>
			<i class="fas fa-file-invoice-dollar mr-1.5"></i> Presupuesto
		</button>
	</div>
</div>

{#if vistaGestion === 'proyectos'}
	<div class="mb-8">
		<div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
			<div>
				<h2 class="text-2xl font-semibold text-slate-800">Proyectos Activos</h2>
				<p class="text-sm text-slate-500 mt-1">Selecciona un proyecto para ver sus detalles, presupuesto y herramientas de gestión.</p>
			</div>
			<div class="flex gap-3">
				<div class="relative">
					<i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
					<input type="text" bind:value={searchTerm} placeholder="Buscar proyecto..." class="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm w-64 shadow-sm" />
				</div>
				<button class="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-sm font-medium shadow-md shadow-orange-600/10 active:scale-[0.98] transition-all flex items-center gap-2">
					<i class="fas fa-plus"></i> Nuevo Proyecto
				</button>
			</div>
		</div>
	</div>

	{#if isLoading}
		<div class="flex justify-center text-orange-600 text-3xl py-12">
			<i class="fas fa-circle-notch fa-spin"></i>
		</div>
	{:else if filteredProyectos.length === 0}
		<div class="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
			<div class="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
				<i class="fas fa-folder-open text-2xl text-slate-400"></i>
			</div>
			<h3 class="text-lg font-bold text-slate-700 mb-2">No se encontraron proyectos</h3>
			<p class="text-slate-500 text-sm max-w-sm mx-auto">No hay proyectos que coincidan con tu búsqueda o aún no has creado ninguno.</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
			{#each filteredProyectos as proyecto}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:border-orange-200 transition-all cursor-pointer group overflow-hidden flex flex-col"
					onclick={() => openProject(proyecto.id_proyecto)}
				>
					<div class="h-2 w-full bg-gradient-to-r from-orange-400 to-amber-400"></div>
					<div class="p-6 flex-1 flex flex-col">
						<div class="flex justify-between items-start mb-4">
							<div class="w-12 h-12 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center shrink-0 border border-orange-100">
								<i class="fas fa-building text-xl"></i>
							</div>
							<span class={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase border tracking-wider ${getStatusColor(proyecto.estado_proyecto)}`}>
								{getStatusLabel(proyecto.estado_proyecto)}
							</span>
						</div>

						<h3 class="text-lg font-bold text-slate-800 mb-2 group-hover:text-orange-600 transition-colors line-clamp-2">
							{proyecto.nombre_proyecto}
						</h3>

						<div class="space-y-2.5 mt-auto pt-4">
							<div class="flex items-center gap-2 text-sm text-slate-500">
								<i class="fas fa-map-marker-alt w-4 text-center text-slate-400"></i>
								<span class="truncate">{proyecto.ubicacion || 'Ubicación no definida'}</span>
							</div>
							<div class="flex items-center gap-2 text-sm text-slate-500">
								<i class="fas fa-calendar-alt w-4 text-center text-slate-400"></i>
								<span>{proyecto.fecha_inicio_plan ? new Date(proyecto.fecha_inicio_plan).toLocaleDateString() : 'Sin fecha'}</span>
							</div>
							<div class="flex items-center gap-2 text-sm text-slate-500">
								<i class="fas fa-money-bill-wave w-4 text-center text-slate-400"></i>
								<span class="font-medium text-slate-700">
									{proyecto.costo_estima ? `S/ ${proyecto.costo_estima.toLocaleString()}` : 'Por definir'}
								</span>
							</div>
						</div>
					</div>
					<div class="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center group-hover:bg-orange-50 transition-colors">
						<span class="text-xs font-semibold text-slate-500 group-hover:text-orange-700">Ver Gestión Integral</span>
						<i class="fas fa-arrow-right text-slate-400 group-hover:text-orange-600 group-hover:translate-x-1 transition-all"></i>
					</div>
				</div>
			{/each}
		</div>
	{/if}
{:else}
	<PresupuestoModule />
{/if}
