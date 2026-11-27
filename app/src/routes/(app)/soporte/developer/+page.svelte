<script lang="ts">
	import SelectConSaldo from '$lib/shared/components/SelectConSaldo.svelte';
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
	import { getUltimoRelease, getVersionesInstaladas, type VersionUsuario } from '$lib/modules/tickets/services/releases.service';
	import { esVersionMasNueva } from '$lib/shared/appVersion';

	// "Versiones instaladas" — qué versión de la app tiene cada persona (la registra la propia app al
	// abrir sesión, ver app_version_usuario_migration.sql), comparada contra la última release publicada,
	// para asegurarse de que las correcciones realmente les llegaron.
	let versiones = $state<VersionUsuario[]>([]);
	let ultimaVersion = $state<string | null>(null);
	let versionesError = $state('');
	// Colapsable, colapsada por defecto (a pedido de la clienta).
	let versionesAbierto = $state(false);
	const desactualizadas = $derived(ultimaVersion ? versiones.filter((v) => esVersionMasNueva(ultimaVersion!, v.version)).length : 0);

	async function fetchVersiones() {
		versionesError = '';
		try {
			const [lista, ultimo] = await Promise.all([getVersionesInstaladas(supabase), getUltimoRelease(supabase)]);
			versiones = lista;
			ultimaVersion = ultimo?.version ?? null;
		} catch (err: any) {
			versionesError = err?.message ?? 'No se pudieron cargar las versiones instaladas.';
		}
	}

	function formatFechaHora(value: string) {
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
	}

	let tickets = $state<Ticket[]>([]);
	let loading = $state(true);
	let filtroEstado = $state<EstadoTicket | ''>('');
	let filtroPlataforma = $state<'' | 'web' | 'app'>('');
	let idTicketSeleccionado = $state<number | null>(null);

	async function fetchList() {
		loading = true;
		try {
			tickets = await getTicketsDeveloper(supabase, { ...(filtroEstado ? { estado: filtroEstado } : {}), ...(filtroPlataforma ? { plataforma: filtroPlataforma } : {}) });
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar los tickets');
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		fetchList();
		fetchVersiones();
	});

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

	// A pedido explícito del usuario: con el filtro en "Todos", la lista mezclaba pendientes/resueltos/
	// aprobados/rechazados/cerrados en un solo bloque largo, sin distinguir qué necesita acción de qué
	// no — "parece una megalista". Se agrupa en secciones con encabezado (mismo patrón que
	// NotificacionesBell.svelte: "Pendientes de aprobar"/"Resueltas recientemente"), ordenadas por qué
	// tan urgente es cada grupo: primero lo que el developer todavía tiene que trabajar, después lo que
	// espera al admin, y al final lo ya cerrado. Con un filtro puntual elegido (no "Todos") no tiene
	// sentido agrupar una lista que ya es de un solo estado — ahí se sigue mostrando plana, como antes.
	const GRUPOS_ESTADO: { titulo: string; estados: EstadoTicket[] }[] = [
		{ titulo: 'Pendientes', estados: ['abierto', 'en_progreso'] },
		{ titulo: 'Resueltos — esperando aprobación', estados: ['resuelto'] },
		{ titulo: 'Rechazados', estados: ['rechazado'] },
		{ titulo: 'Aprobados — esperando release', estados: ['aprobado'] },
		{ titulo: 'Cerrados', estados: ['cerrado'] }
	];
	const ticketsAgrupados = $derived(
		filtroEstado
			? null
			: GRUPOS_ESTADO.map((g) => ({ ...g, tickets: tickets.filter((t) => g.estados.includes(t.estado)) })).filter((g) => g.tickets.length > 0)
	);
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

<div class="mb-5 bg-white rounded-2xl border border-slate-200">
	<button
		type="button"
		onclick={() => (versionesAbierto = !versionesAbierto)}
		class="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
		aria-expanded={versionesAbierto}
	>
		<span class="text-sm font-bold text-slate-700">
			Versiones instaladas
			{#if ultimaVersion}
				<span class="font-normal text-slate-400">· última publicada v{ultimaVersion}</span>
			{/if}
		</span>
		<span class="text-xs text-slate-500 shrink-0">
			{#if versionesError}
				sin datos
			{:else if versiones.length === 0}
				nadie registrado todavía
			{:else if desactualizadas > 0}
				<span class="font-semibold text-amber-600">{desactualizadas} de {versiones.length} desactualizada{desactualizadas === 1 ? '' : 's'}</span>
			{:else}
				<span class="font-semibold text-emerald-600">todas al día</span>
			{/if}
			· {versionesAbierto ? 'ocultar' : 'ver'}
		</span>
	</button>
	{#if versionesAbierto}
		<div class="border-t border-slate-100">
			{#if versionesError}
				<p class="px-4 py-4 text-sm text-slate-500">
					No se pudo leer la tabla de versiones ({versionesError}). Si es la primera vez, falta correr <code class="text-xs">app_version_usuario_migration.sql</code> en Supabase.
				</p>
			{:else if versiones.length === 0}
				<p class="px-4 py-4 text-sm text-slate-500">Todavía nadie registró su versión — cada persona aparece acá la próxima vez que abra sesión en una app con esta función.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-sm min-w-[520px]">
						<thead>
							<tr class="text-[11px] uppercase tracking-wide text-slate-400">
								<th class="text-left px-4 py-2 font-semibold">Usuario</th>
								<th class="text-left px-4 py-2 font-semibold">Plataforma</th>
								<th class="text-left px-4 py-2 font-semibold">Versión</th>
								<th class="text-left px-4 py-2 font-semibold">Última conexión</th>
								<th class="text-left px-4 py-2 font-semibold">Estado</th>
							</tr>
						</thead>
						<tbody>
							{#each versiones as v (v.id_registro)}
								{@const vieja = !!ultimaVersion && esVersionMasNueva(ultimaVersion, v.version)}
								<tr class="border-t border-slate-100">
									<td class="px-4 py-2 text-slate-800">{v.usuario ?? 'Usuario'}</td>
									<td class="px-4 py-2 text-slate-600 capitalize">{v.plataforma}</td>
									<td class="px-4 py-2 font-mono text-slate-800">v{v.version}</td>
									<td class="px-4 py-2 text-slate-500">{formatFechaHora(v.ultima_conexion)}</td>
									<td class="px-4 py-2">
										<span class={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${vieja ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
											{vieja ? 'Desactualizada' : 'Al día'}
										</span>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	{/if}
</div>

<div class="mb-4 flex items-center gap-2">
	<label for="filtro-estado" class="text-sm text-slate-500">Filtrar por estado:</label>
	<SelectConSaldo
		id="filtro-estado"
		value={filtroEstado}
		options={[{ value: '', label: 'Todos' }, ...Object.entries(ETIQUETA_ESTADO).map(([value, label]) => ({ value: String(value), label: `${label}` }))]}
		placeholder="Todos"
		onchange={(v) => {
			filtroEstado = v as EstadoTicket | '';
			fetchList();
		}}
	/>
	<label for="filtro-plataforma" class="text-sm text-slate-500 ml-2">Dónde:</label>
	<div class="w-44">
		<SelectConSaldo
			id="filtro-plataforma"
			value={filtroPlataforma}
			options={[{ value: '', label: 'Todos' }, { value: 'web', label: 'Web / Escritorio' }, { value: 'app', label: 'App del celular' }]}
			placeholder="Todos"
			onchange={(v) => {
				filtroPlataforma = v as typeof filtroPlataforma;
				fetchList();
			}}
		/>
	</div>
</div>

{#snippet filaTicket(t: Ticket)}
	<button
		type="button"
		onclick={() => (idTicketSeleccionado = t.id_ticket)}
		class="w-full text-left flex items-center justify-between gap-3 p-4 hover:bg-slate-50 transition-colors"
	>
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-1.5 flex-wrap">
				<span class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{ETIQUETA_TIPO[t.tipo] ?? t.tipo}</span>
				{#if t.plataforma === 'app'}<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200">App</span>{/if}
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
{/snippet}

{#if loading}
	<div class="bg-white rounded-2xl border border-slate-200">
		<p class="px-4 py-10 text-center text-slate-400">Cargando...</p>
	</div>
{:else if tickets.length === 0}
	<div class="bg-white rounded-2xl border border-slate-200">
		<p class="px-4 py-10 text-center text-slate-400">No hay tickets con ese filtro.</p>
	</div>
{:else if ticketsAgrupados}
	<!-- "Todos" — agrupado por sección (ver ticketsAgrupados), en vez de una sola lista larga. -->
	<div class="flex flex-col gap-5">
		{#each ticketsAgrupados as grupo (grupo.titulo)}
			<div>
				<p class="px-1 pb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{grupo.titulo} ({grupo.tickets.length})</p>
				<div class="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
					{#each grupo.tickets as t (t.id_ticket)}
						{@render filaTicket(t)}
					{/each}
				</div>
			</div>
		{/each}
	</div>
{:else}
	<!-- Filtro puntual elegido (no "Todos") — ya es un solo estado, no hace falta agrupar. -->
	<div class="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
		{#each tickets as t (t.id_ticket)}
			{@render filaTicket(t)}
		{/each}
	</div>
{/if}

<TicketDetalleModal
	open={idTicketSeleccionado !== null}
	idTicket={idTicketSeleccionado}
	permitirAcciones={true}
	onClose={() => (idTicketSeleccionado = null)}
	onChanged={fetchList}
/>
