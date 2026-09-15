<script lang="ts">
	// Panel Developer — bandeja completa de tickets (developer/admin, permiso 'ver_soporte_developer'),
	// a pedido explícito del usuario: "para mí y el administrador... verificar que falta y ver que se
	// ha avanzado o corregido, y ver el progreso, aprobación o rechazo de cada ticket". Solo Admin
	// aprueba/rechaza (ver isAdmin() dentro de TicketDetalleModal.svelte) — el developer marca en
	// progreso/resuelto. Un ticket 'aprobado' queda esperando al script de deploy (fuera de la app, ver
	// Documentacion/MecanismoCICD.md), que lo agrupa en el próximo release y lo cierra automáticamente.
	import { onMount } from 'svelte';
	import { Code2 } from '@lucide/svelte';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { getTicketsDeveloper, type Ticket, type EstadoTicket } from '$lib/modules/tickets/services/tickets.service';
	import TicketDetalleModal from '$lib/modules/tickets/components/TicketDetalleModal.svelte';

	let tickets = $state<Ticket[]>([]);
	let loading = $state(true);
	let filtroEstado = $state<EstadoTicket | ''>('');
	let idTicketSeleccionado = $state<number | null>(null);

	async function fetchList() {
		loading = true;
		try {
			tickets = await getTicketsDeveloper(supabase, filtroEstado ? { estado: filtroEstado } : {});
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar los tickets');
		} finally {
			loading = false;
		}
	}

	onMount(fetchList);

	const ETIQUETA_ESTADO: Record<string, string> = {
		abierto: 'Abierto',
		en_progreso: 'En progreso',
		resuelto: 'Resuelto',
		aprobado: 'Aprobado',
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
	const ETIQUETA_TIPO: Record<string, string> = {
		reclamo: 'Reclamo',
		sugerencia: 'Sugerencia',
		incidencia: 'Incidencia',
		requerimiento: 'Requerimiento'
	};
	const CLASE_PRIORIDAD: Record<string, string> = {
		baja: 'text-slate-400',
		media: 'text-blue-500',
		alta: 'text-amber-600',
		critica: 'text-red-600 font-bold'
	};
	function formatFecha(value: string) {
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
	}
</script>

<svelte:head>
	<title>Panel Developer | Construni ERP</title>
</svelte:head>

<div class="mb-4">
	<h1 class="text-2xl font-bold text-brand-marine flex items-center gap-2">
		<Code2 size={24} class="text-blue-600" /> Panel Developer
	</h1>
	<p class="text-sm text-slate-500 mt-1">Todos los tickets reportados — progreso, aprobación/rechazo y releases.</p>
</div>

<div class="mb-4 flex items-center gap-2">
	<label for="filtro-estado" class="text-sm text-slate-500">Filtrar por estado:</label>
	<select
		id="filtro-estado"
		value={filtroEstado}
		onchange={(e) => {
			filtroEstado = (e.target as HTMLSelectElement).value as EstadoTicket | '';
			fetchList();
		}}
		class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
	>
		<option value="">Todos</option>
		{#each Object.entries(ETIQUETA_ESTADO) as [value, label]}<option {value}>{label}</option>{/each}
	</select>
</div>

<div class="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
	{#if loading}
		<p class="px-4 py-10 text-center text-slate-400">Cargando...</p>
	{:else if tickets.length === 0}
		<p class="px-4 py-10 text-center text-slate-400">No hay tickets con ese filtro.</p>
	{:else}
		{#each tickets as t (t.id_ticket)}
			<button
				type="button"
				onclick={() => (idTicketSeleccionado = t.id_ticket)}
				class="w-full text-left flex items-center justify-between gap-3 p-4 hover:bg-slate-50 transition-colors"
			>
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-1.5 flex-wrap">
						<span class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{ETIQUETA_TIPO[t.tipo] ?? t.tipo}</span>
						{#if t.modulo}<span class="text-[11px] text-slate-300">· {t.modulo}</span>{/if}
						<span class={`text-[11px] ${CLASE_PRIORIDAD[t.prioridad] ?? ''}`}>· {t.prioridad}</span>
					</div>
					<p class="font-semibold text-slate-800 truncate">{t.titulo}</p>
					<p class="text-xs text-slate-400 mt-0.5">{t.creado_por ?? 'Usuario'} · {formatFecha(t.created_at)}</p>
				</div>
				<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0 ${CLASE_ESTADO[t.estado] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
					{ETIQUETA_ESTADO[t.estado] ?? t.estado}
				</span>
			</button>
		{/each}
	{/if}
</div>

<TicketDetalleModal
	open={idTicketSeleccionado !== null}
	idTicket={idTicketSeleccionado}
	permitirAcciones={true}
	onClose={() => (idTicketSeleccionado = null)}
	onChanged={fetchList}
/>
