<script lang="ts">
	// "Mis Tickets" — a pedido explícito del usuario: reemplaza el reporte de reclamos/sugerencias/
	// incidencias/requerimientos por WhatsApp. Cualquier usuario (permiso 'ver_soporte_tickets',
	// otorgado a todos los roles) reporta acá y sigue el progreso de LO SUYO — la bandeja completa de
	// todos los tickets vive en /soporte/developer, solo para developer/admin.
	import { onMount } from 'svelte';
	import { Plus, LifeBuoy } from '@lucide/svelte';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { getMisTickets, type Ticket } from '$lib/modules/tickets/services/tickets.service';
	import TicketModal from '$lib/modules/tickets/components/TicketModal.svelte';
	import TicketDetalleModal from '$lib/modules/tickets/components/TicketDetalleModal.svelte';

	let tickets = $state<Ticket[]>([]);
	let loading = $state(true);
	let modalCrearOpen = $state(false);
	let idTicketSeleccionado = $state<number | null>(null);

	async function fetchList() {
		loading = true;
		try {
			tickets = await getMisTickets(supabase);
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar tus tickets');
		} finally {
			loading = false;
		}
	}

	onMount(fetchList);

	const ETIQUETA_ESTADO: Record<string, string> = {
		abierto: 'Abierto',
		en_progreso: 'En progreso',
		resuelto: 'Resuelto — esperando aprobación',
		aprobado: 'Aprobado — esperando release',
		rechazado: 'Rechazado',
		cerrado: 'Cerrado'
	};
	const CLASE_ESTADO: Record<string, string> = {
		abierto: 'bg-amber-50 text-amber-700 border-amber-200',
		en_progreso: 'bg-blue-50 text-blue-700 border-blue-200',
		resuelto: 'bg-violet-50 text-violet-700 border-violet-200',
		aprobado: 'bg-emerald-50 text-emerald-700 border-emerald-200',
		rechazado: 'bg-rose-50 text-rose-700 border-rose-200',
		cerrado: 'bg-slate-100 text-slate-600 border-slate-200'
	};
	function formatFecha(value: string) {
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
	}
</script>

<svelte:head>
	<title>Mis Tickets | Construni ERP</title>
</svelte:head>

<div class="mb-4 flex items-center justify-between flex-wrap gap-3">
	<div>
		<h1 class="text-2xl font-bold text-brand-marine flex items-center gap-2">
			<LifeBuoy size={24} class="text-blue-600" /> Mis Tickets
		</h1>
		<p class="text-sm text-slate-500 mt-1">Reporta un reclamo, sugerencia, incidencia o requerimiento y sigue su progreso.</p>
	</div>
	<button
		type="button"
		onclick={() => (modalCrearOpen = true)}
		class="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
	>
		<Plus size={16} /> Nuevo Ticket
	</button>
</div>

<div class="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
	{#if loading}
		<p class="px-4 py-10 text-center text-slate-400">Cargando...</p>
	{:else if tickets.length === 0}
		<p class="px-4 py-10 text-center text-slate-400">Todavía no has reportado ningún ticket.</p>
	{:else}
		{#each tickets as t (t.id_ticket)}
			<button
				type="button"
				onclick={() => (idTicketSeleccionado = t.id_ticket)}
				class="w-full text-left flex items-center justify-between gap-3 p-4 hover:bg-slate-50 transition-colors"
			>
				<div class="min-w-0">
					<p class="font-semibold text-slate-800 truncate">{t.titulo}</p>
					<p class="text-xs text-slate-400 mt-0.5">{formatFecha(t.created_at)}</p>
				</div>
				<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0 ${CLASE_ESTADO[t.estado] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
					{ETIQUETA_ESTADO[t.estado] ?? t.estado}
				</span>
			</button>
		{/each}
	{/if}
</div>

<TicketModal open={modalCrearOpen} onClose={() => (modalCrearOpen = false)} onCreated={fetchList} />
<TicketDetalleModal
	open={idTicketSeleccionado !== null}
	idTicket={idTicketSeleccionado}
	permitirAcciones={false}
	onClose={() => (idTicketSeleccionado = null)}
	onChanged={fetchList}
/>
