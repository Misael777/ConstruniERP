<script lang="ts">
	/**
	 * "Tareas de hoy" (ticket #112, maqueta de la clienta para la app, 26/11/2026). Las tareas son las Alertas de tareas
	 * (ícono ⚠): lo que vence pronto o ya venció en Recursos Humanos, Proyectos y Finanzas. Pestañas Hoy / Aplazadas /
	 * Completadas, filtro por área, orden por urgencia o por fecha y agrupadas por área. Cada usuario puede aplazar una
	 * tarea hasta otra fecha o marcarla completada (se guarda solo para él, tabla tarea_estado); si la alerta cambia de
	 * fecha (otra cuota, otra póliza) vuelve a "Hoy".
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { describeError } from '$lib/shared/describeError';
	import { hasPermiso, permisosState } from '$lib/stores/permisos.svelte';
	import { hoyLima } from '$lib/modules/personal/services/personal.service';
	import {
		getAlertasTareas,
		getEstadosTareas,
		guardarEstadoTarea,
		pestanaTarea,
		etiquetaVencimiento,
		diasHasta,
		type AlertaTarea,
		type EstadoTarea,
		type ModuloAlerta,
		type PrioridadAlerta
	} from '$lib/modules/alertas/services/alertas.service';

	const hoy = hoyLima();
	const sumar = (f: string, d: number) => new Date(Date.parse(`${f}T12:00:00Z`) + d * 86400000).toISOString().slice(0, 10);
	const AREAS: { modulo: ModuloAlerta; titulo: string; icono: string; chip: string }[] = [
		{ modulo: 'rrhh', titulo: 'Recursos Humanos', icono: 'fa-users', chip: 'bg-blue-50 text-blue-700 border-blue-200' },
		{ modulo: 'proyectos', titulo: 'Proyectos', icono: 'fa-layer-group', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
		{ modulo: 'finanzas', titulo: 'Finanzas', icono: 'fa-coins', chip: 'bg-violet-50 text-violet-700 border-violet-200' }
	];
	const PRIORIDAD: Record<PrioridadAlerta, { texto: string; clase: string; orden: number }> = {
		alta: { texto: 'Alta', clase: 'bg-rose-50 text-rose-600 border-rose-200', orden: 0 },
		media: { texto: 'Media', clase: 'bg-amber-50 text-amber-700 border-amber-200', orden: 1 },
		baja: { texto: 'Baja', clase: 'bg-emerald-50 text-emerald-700 border-emerald-200', orden: 2 }
	};

	let alertas = $state<AlertaTarea[]>([]);
	let estados = $state<Map<string, EstadoTarea>>(new Map());
	let cargando = $state(true);
	let pestana = $state<'hoy' | 'aplazada' | 'completada'>('hoy');
	let area = $state<'' | ModuloAlerta>('');
	let quien = $state<'mias' | 'todas'>('mias');
	let orden = $state<'urgencia' | 'fecha'>('urgencia');
	let menuDe = $state<string | null>(null);
	let fechaAplazar = $state(sumar(hoy, 1));

	const yo = $derived((permisosState.userName || '').trim().toLowerCase());
	const esMia = (a: AlertaTarea) => !!yo && (a.responsable ?? '').trim().toLowerCase() === yo;
	const delegada = (a: AlertaTarea) => !!yo && (a.registradoPor ?? '').trim().toLowerCase() === yo;

	const base = $derived(alertas.filter((a) => (quien === 'todas' || esMia(a) || (!a.responsable && delegada(a))) && (!area || a.modulo === area)));
	const enPestana = (p: typeof pestana) => base.filter((a) => pestanaTarea(a, estados.get(a.id), hoy) === p);
	const visibles = $derived(
		[...enPestana(pestana)].sort((a, b) =>
			orden === 'urgencia'
				? PRIORIDAD[a.prioridad].orden - PRIORIDAD[b.prioridad].orden || a.fecha.localeCompare(b.fecha)
				: a.fecha.localeCompare(b.fecha) || PRIORIDAD[a.prioridad].orden - PRIORIDAD[b.prioridad].orden
		)
	);
	const conteo = $derived({ hoy: enPestana('hoy').length, aplazada: enPestana('aplazada').length, completada: enPestana('completada').length });
	const proximasAplazadas = $derived(
		enPestana('aplazada')
			.sort((a, b) => (estados.get(a.id)?.aplazada_hasta ?? '').localeCompare(estados.get(b.id)?.aplazada_hasta ?? ''))
			.slice(0, 3)
	);
	const fechaLarga = new Date(`${hoy}T12:00:00Z`).toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

	async function cargar() {
		cargando = true;
		try {
			const permiso = { rrhh: hasPermiso('ver_alertas_rrhh'), proyectos: hasPermiso('ver_alertas_proyectos'), finanzas: hasPermiso('ver_alertas_finanzas') };
			const [lista, est] = await Promise.all([getAlertasTareas(supabase, { rrhh: true, proyectos: true, finanzas: true }), getEstadosTareas(supabase)]);
			alertas = lista.filter((a) => permiso[a.modulo] || esMia(a));
			estados = est;
			if (!alertas.some(esMia) && quien === 'mias') quien = 'todas';
		} catch (err) {
			toast.error(`No se pudieron cargar las tareas. ${describeError(err)}`);
		} finally {
			cargando = false;
		}
	}
	$effect(() => {
		if (permisosState.loaded) void cargar();
	});
	onMount(() => {
		const cerrar = () => (menuDe = null);
		window.addEventListener('click', cerrar);
		return () => window.removeEventListener('click', cerrar);
	});

	async function cambiar(a: AlertaTarea, estado: 'aplazada' | 'completada' | null, hasta: string | null = null) {
		menuDe = null;
		try {
			await guardarEstadoTarea(supabase, a, estado, hasta);
			const m = new Map(estados);
			if (estado) m.set(a.id, { id_alerta: a.id, estado, aplazada_hasta: hasta, fecha_alerta: a.fecha });
			else m.delete(a.id);
			estados = m;
			toast.success(estado === 'completada' ? '¡Tarea completada!' : estado === 'aplazada' ? `Aplazada hasta el ${new Date(`${hasta}T12:00:00Z`).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', timeZone: 'UTC' })}.` : 'La tarea volvió a Hoy.');
		} catch (err) {
			toast.error(`No se pudo guardar. ${describeError(err)}`);
		}
	}
	const areaDe = (m: ModuloAlerta) => AREAS.find((x) => x.modulo === m)!;
</script>

<svelte:head><title>Tareas de hoy · Construni ERP</title></svelte:head>

<div class="h-full overflow-y-auto bg-slate-50">
	<div class="max-w-3xl mx-auto p-4 sm:p-6 flex flex-col gap-4">
		<div class="flex items-center gap-3 sm:gap-4 bg-white border border-slate-100 rounded-2xl shadow-sm p-4">
			<span class="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-orange-50 text-orange-500 flex items-center justify-center text-2xl shrink-0"><i class="fas fa-calendar-check"></i></span>
			<div class="flex-1 min-w-0">
				<h1 class="text-lg sm:text-2xl font-extrabold leading-tight text-[#0f2a4a]">Vamos paso a paso</h1>
				<p class="text-sm sm:text-base leading-snug text-slate-700">{conteo.hoy} tarea{conteo.hoy === 1 ? '' : 's'} pendiente{conteo.hoy === 1 ? '' : 's'} para hoy</p>
				<p class="text-sm text-slate-500 first-letter:uppercase">{fechaLarga}</p>
			</div>
			<!-- Ticket #135: el cartel ya no se monta sobre el texto; va encima de Snoopy, también en el celular. -->
			<div class="shrink-0 flex flex-col items-center gap-1">
				<span class="rotate-[-6deg] rounded-lg border-2 border-slate-700 bg-white px-1.5 py-0.5 text-[10px] font-bold leading-tight text-slate-700 text-center whitespace-nowrap">¡Ánimo!<br />Tú puedes</span>
				<img src="/snoopy-casco.webp" alt="" class="h-12 sm:h-16 w-auto select-none" draggable="false" />
			</div>
		</div>

		<div class="grid grid-cols-3 gap-1 rounded-2xl bg-white border border-slate-100 p-1 shadow-sm" role="tablist">
			{#each [['hoy', 'Hoy'], ['aplazada', 'Aplazadas'], ['completada', 'Completadas']] as [v, t] (v)}
				{@const n = conteo[v as keyof typeof conteo]}
				<button type="button" role="tab" aria-selected={pestana === v} onclick={() => (pestana = v as typeof pestana)} class={`py-2 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 ${pestana === v ? 'bg-orange-100 text-orange-600' : 'text-slate-600 hover:bg-slate-50'}`}>
					{t}
					{#if v !== 'completada' && n}<span class={`min-w-5 h-5 px-1.5 rounded-full text-xs flex items-center justify-center ${pestana === v ? 'bg-orange-500 text-white' : 'bg-slate-200 text-slate-700'}`}>{n}</span>{/if}
				</button>
			{/each}
		</div>

		<div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
			<select bind:value={area} class="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm" aria-label="Área">
				<option value="">Todas las áreas</option>
				{#each AREAS as a (a.modulo)}<option value={a.modulo}>{a.titulo}</option>{/each}
			</select>
			<select bind:value={quien} class="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm" aria-label="De quién">
				<option value="mias">Mis tareas</option>
				<option value="todas">Todas las de mis áreas</option>
			</select>
			<select bind:value={orden} class="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm" aria-label="Ordenar">
				<option value="urgencia">Ordenar por urgencia (Alta → Baja)</option>
				<option value="fecha">Ordenar por fecha de vencimiento</option>
			</select>
		</div>

		{#if cargando}
			<div class="py-12 text-center text-slate-400"><i class="fas fa-spinner fa-spin text-xl text-blue-500"></i></div>
		{:else if !visibles.length}
			<div class="bg-white border border-slate-100 rounded-2xl shadow-sm py-12 text-center text-sm text-slate-400">
				{pestana === 'hoy' ? '¡Todo al día! No tienes tareas pendientes.' : pestana === 'aplazada' ? 'No tienes tareas aplazadas.' : 'Aún no completas tareas.'}
			</div>
		{:else}
			{#each AREAS.filter((x) => visibles.some((a) => a.modulo === x.modulo)) as g (g.modulo)}
				{@const items = visibles.filter((a) => a.modulo === g.modulo)}
				<section class="flex flex-col gap-2">
					<h2 class="flex items-center gap-2 text-lg font-bold text-slate-800 px-1">
						<i class={`fas ${g.icono} text-orange-500`}></i>{g.titulo}
						<span class="min-w-6 h-6 px-2 rounded-full bg-slate-200 text-slate-700 text-xs flex items-center justify-center">{items.length}</span>
					</h2>
					{#each items as a (a.id)}
						{@const v = etiquetaVencimiento(a.fecha, hoy)}
						{@const e = estados.get(a.id)}
						<div class="relative flex items-start gap-3 bg-white border border-slate-100 rounded-2xl shadow-sm px-3 py-3">
							<button
								type="button"
								onclick={() => cambiar(a, pestana === 'completada' ? null : 'completada')}
								title={pestana === 'completada' ? 'Volver a pendiente' : 'Marcar como completada'}
								aria-label={pestana === 'completada' ? 'Volver a pendiente' : 'Marcar como completada'}
								class={`mt-0.5 w-7 h-7 rounded-full border-2 shrink-0 flex items-center justify-center ${pestana === 'completada' ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-400 hover:border-emerald-500 hover:text-emerald-500 text-transparent'}`}
							><i class="fas fa-check text-xs"></i></button>
							<button type="button" onclick={() => goto(a.href)} class="flex-1 min-w-0 text-left">
								<p class={`font-bold leading-snug break-words text-slate-800 ${pestana === 'completada' ? 'line-through text-slate-400' : ''}`}>{a.titulo}</p>
								<div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
									<span class={`rounded-md border px-1.5 py-0.5 font-semibold ${areaDe(a.modulo).chip}`}>{areaDe(a.modulo).titulo}</span>
									{#if a.detalle}<span class="min-w-0 text-slate-500 break-words">{a.detalle}</span>{/if}
								</div>
								<p class="mt-1 text-xs leading-snug text-slate-500"><i class="far fa-user mr-1"></i> {a.registradoPor ? (delegada(a) ? 'Registrada por ti' : `Registrada por ${a.registradoPor}`) : 'Alerta del ERP'}{a.responsable && !esMia(a) ? ` · a cargo de ${a.responsable}` : ''}</p>
							</button>
							<div class="w-[5.75rem] flex flex-col items-end gap-1 shrink-0 text-right">
								<span class={`rounded-full border px-2 py-0.5 text-xs font-semibold ${PRIORIDAD[a.prioridad].clase}`}>{PRIORIDAD[a.prioridad].texto}</span>
								{#if pestana === 'aplazada' && e?.aplazada_hasta}
									<span class="rounded-lg bg-orange-50 px-2 py-0.5 text-xs font-bold text-orange-600 uppercase">{new Date(`${e.aplazada_hasta}T12:00:00Z`).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</span>
								{:else}
									<span class={`text-xs leading-tight ${v.urgente ? 'font-semibold text-rose-600' : 'text-slate-500'}`}>{v.texto}</span>
								{/if}
							</div>
							<button type="button" onclick={(ev) => { ev.stopPropagation(); menuDe = menuDe === a.id ? null : a.id; fechaAplazar = sumar(hoy, 1); }} class="w-7 h-7 rounded-full text-slate-500 hover:bg-slate-100 shrink-0" aria-label="Más opciones"><i class="fas fa-ellipsis"></i></button>
							{#if menuDe === a.id}
								<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
								<div role="menu" tabindex="-1" onclick={(ev) => ev.stopPropagation()} class="absolute right-2 top-11 z-20 w-64 rounded-xl border border-slate-200 bg-white shadow-xl p-2 flex flex-col gap-1 text-sm">
									{#if pestana !== 'completada'}
										<span class="px-2 pt-1 text-xs font-semibold text-slate-500">Aplazar hasta</span>
										<div class="flex gap-1 px-1">
											<button type="button" onclick={() => cambiar(a, 'aplazada', sumar(hoy, 1))} class="flex-1 px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50">Mañana</button>
											<button type="button" onclick={() => cambiar(a, 'aplazada', sumar(hoy, 7))} class="flex-1 px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50">En 1 semana</button>
										</div>
										<div class="flex gap-1 px-1">
											<input type="date" bind:value={fechaAplazar} min={sumar(hoy, 1)} class="flex-1 px-2 py-1 rounded-lg border border-slate-200 text-sm" aria-label="Aplazar hasta" />
											<button type="button" onclick={() => fechaAplazar > hoy && cambiar(a, 'aplazada', fechaAplazar)} class="px-2 py-1 rounded-lg bg-orange-500 text-white font-semibold">OK</button>
										</div>
									{/if}
									{#if pestana !== 'hoy'}<button type="button" onclick={() => cambiar(a, null)} class="text-left px-2 py-1.5 rounded-lg hover:bg-slate-50"><i class="fas fa-rotate-left text-slate-400"></i> Volver a Hoy</button>{/if}
									<button type="button" onclick={() => goto(a.href)} class="text-left px-2 py-1.5 rounded-lg hover:bg-slate-50"><i class="fas fa-arrow-up-right-from-square text-slate-400"></i> Abrir en el ERP</button>
								</div>
							{/if}
						</div>
					{/each}
				</section>
			{/each}
		{/if}

		{#if pestana === 'hoy' && proximasAplazadas.length}
			<section class="bg-white border border-slate-100 rounded-2xl shadow-sm p-4 flex flex-col gap-3">
				<div class="flex items-center gap-2">
					<i class="fas fa-calendar text-orange-500"></i>
					<h2 class="text-lg font-bold text-slate-800">Próximas aplazadas</h2>
					<button type="button" onclick={() => (pestana = 'aplazada')} class="ml-auto text-sm font-semibold text-orange-600 hover:underline">Ver todas →</button>
				</div>
				{#each proximasAplazadas as a (a.id)}
					{@const hasta = estados.get(a.id)?.aplazada_hasta ?? ''}
					<div class="flex items-center gap-3 border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
						<div class="flex-1 min-w-0">
							<p class="font-semibold text-slate-800 truncate">{a.titulo}</p>
							<span class={`rounded-md border px-1.5 py-0.5 text-xs font-semibold ${areaDe(a.modulo).chip}`}>{areaDe(a.modulo).titulo}</span>
						</div>
						<span class={`rounded-full border px-2 py-0.5 text-xs font-semibold ${PRIORIDAD[a.prioridad].clase}`}>{PRIORIDAD[a.prioridad].texto}</span>
						<span class="rounded-lg bg-orange-50 px-2 py-1 text-xs font-bold text-orange-600 uppercase">{hasta ? `${diasHasta(hasta, hoy) === 1 ? 'Mañana' : new Date(`${hasta}T12:00:00Z`).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', timeZone: 'UTC' })}` : ''}</span>
					</div>
				{/each}
			</section>
		{/if}
	</div>
</div>
