<script lang="ts">
	/**
	 * "Tareas de hoy" (ticket #112, maqueta de la clienta para la app, 26/11/2026). Las tareas son las Alertas de tareas
	 * (ícono ⚠): lo que vence pronto o ya venció en Recursos Humanos, Proyectos y Finanzas. Pestañas Hoy / Aplazadas /
	 * Completadas, filtro por área, orden por urgencia o por fecha y agrupadas por área. Cada usuario puede aplazar una
	 * tarea hasta otra fecha o marcarla completada (se guarda solo para él, tabla tarea_estado); si la alerta cambia de
	 * fecha (otra cuota, otra póliza) vuelve a "Hoy".
	 *
	 * Pedido 27/11/2026 (maqueta de la clienta): buscador, filtro por urgencia, prioridad que se puede cambiar (para todos,
	 * ver guardarPrioridadTarea), orden manual arrastrando (asa ⋮⋮, personal, tabla tarea_orden) y vista calendario
	 * Semana / Mes donde se arrastra una tarea a otro día (CalendarioTareas.svelte).
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
		guardarPrioridadTarea,
		delegarTarea,
		getOrdenTareas,
		guardarOrdenTareas,
		pestanaTarea,
		etiquetaVencimiento,
		diasHasta,
		type AlertaTarea,
		type EstadoTarea,
		type ModuloAlerta,
		type PrioridadAlerta,
		mismoNombre
	} from '$lib/modules/alertas/services/alertas.service';
	import { AREAS_TAREA as AREAS, PRIORIDAD_TAREA as PRIORIDAD, areaTarea as areaDe, fechaCorta, normalizarBusqueda } from '$lib/modules/alertas/tareasUi';
	import { arrastrable } from '$lib/shared/arrastre';
	import PrioridadTarea from '$lib/modules/alertas/components/PrioridadTarea.svelte';
	import DelegarTarea from '$lib/modules/alertas/components/DelegarTarea.svelte';
	import CalendarioTareas from '$lib/modules/alertas/components/CalendarioTareas.svelte';

	const hoy = hoyLima();
	const sumar = (f: string, d: number) => new Date(Date.parse(`${f}T12:00:00Z`) + d * 86400000).toISOString().slice(0, 10);
	let alertas = $state<AlertaTarea[]>([]);
	let estados = $state<Map<string, EstadoTarea>>(new Map());
	let cargando = $state(true);
	let pestana = $state<'hoy' | 'aplazada' | 'completada'>('hoy');
	let area = $state<'' | ModuloAlerta>('');
	let quien = $state<'mias' | 'todas'>('mias');
	let orden = $state<'urgencia' | 'fecha' | 'manual'>('urgencia');
	let vista = $state<'lista' | 'semana' | 'mes'>('lista');
	let busqueda = $state('');
	let urgencia = $state<'' | PrioridadAlerta>('');
	let ordenManual = $state<Map<string, number>>(new Map());
	// Vista y orden elegidos: se recuerdan en este equipo (comodidad, no es un dato del ERP).
	const CLAVE_PREF = 'construni_mis_tareas_pref';
	try {
		const pref = JSON.parse(localStorage.getItem(CLAVE_PREF) ?? 'null');
		if (['lista', 'semana', 'mes'].includes(pref?.vista)) vista = pref.vista;
		if (['urgencia', 'fecha', 'manual'].includes(pref?.orden)) orden = pref.orden;
	} catch {
		/* sin almacenamiento */
	}
	$effect(() => {
		const v = JSON.stringify({ vista, orden });
		try {
			localStorage.setItem(CLAVE_PREF, v);
		} catch {
			/* sin almacenamiento */
		}
	});
	let menuDe = $state<string | null>(null);
	let fechaAplazar = $state(sumar(hoy, 1));

	const yo = $derived((permisosState.userName || '').trim().toLowerCase());
	const esMia = (a: AlertaTarea) => !!yo && mismoNombre(a.responsable, yo);
	// Ticket #128: también las que delegué con el botón "Delegar".
	const delegada = (a: AlertaTarea) => !!yo && (mismoNombre(a.delegadoPor, yo) || mismoNombre(a.registradoPor, yo));

	const coincide = (a: AlertaTarea, q: string) => !q || normalizarBusqueda([a.titulo, a.detalle, a.responsable, a.registradoPor].filter(Boolean).join(' ')).includes(q);
	const base = $derived.by(() => {
		const q = normalizarBusqueda(busqueda.trim());
		return alertas.filter(
			(a) => (quien === 'todas' || esMia(a) || (!a.responsable && delegada(a))) && (!area || a.modulo === area) && (!urgencia || a.prioridad === urgencia) && coincide(a, q)
		);
	});
	const porUrgencia = (a: AlertaTarea, b: AlertaTarea) => PRIORIDAD[a.prioridad].orden - PRIORIDAD[b.prioridad].orden || a.fecha.localeCompare(b.fecha);
	const SIN_ORDEN = Number.MAX_SAFE_INTEGER;
	const enPestana = (p: typeof pestana) => base.filter((a) => pestanaTarea(a, estados.get(a.id), hoy) === p);
	const visibles = $derived(
		[...enPestana(pestana)].sort((a, b) =>
			orden === 'manual'
				? (ordenManual.get(a.id) ?? SIN_ORDEN) - (ordenManual.get(b.id) ?? SIN_ORDEN) || porUrgencia(a, b)
				: orden === 'urgencia'
					? porUrgencia(a, b)
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

	async function cargar(conSpinner = true) {
		if (conSpinner) cargando = true;
		try {
			const permiso = { rrhh: hasPermiso('ver_alertas_rrhh'), proyectos: hasPermiso('ver_alertas_proyectos'), finanzas: hasPermiso('ver_alertas_finanzas') };
			const [lista, est, ord] = await Promise.all([
				getAlertasTareas(supabase, { rrhh: true, proyectos: true, finanzas: true }),
				getEstadosTareas(supabase),
				getOrdenTareas(supabase)
			]);
			alertas = lista.filter((a) => permiso[a.modulo] || esMia(a));
			estados = est;
			ordenManual = ord;
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

	async function cambiar(a: AlertaTarea, estado: 'aplazada' | 'completada' | null, hasta: string | null = null, mensaje: string | null = null) {
		menuDe = null;
		try {
			await guardarEstadoTarea(supabase, a, estado, hasta);
			const m = new Map(estados);
			if (estado) m.set(a.id, { id_alerta: a.id, estado, aplazada_hasta: hasta, fecha_alerta: a.fecha });
			else m.delete(a.id);
			estados = m;
			toast.success(mensaje ?? (estado === 'completada' ? '¡Tarea completada!' : estado === 'aplazada' ? `Aplazada hasta el ${new Date(`${hasta}T12:00:00Z`).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', timeZone: 'UTC' })}.` : 'La tarea volvió a Hoy.'));
		} catch (err) {
			toast.error(`No se pudo guardar. ${describeError(err)}`);
		}
	}

	/** Calendario: mover a otro día = aplazar hasta ese día (hoy incluido: queda para hoy). */
	const moverADia = (a: AlertaTarea, dia: string) => cambiar(a, 'aplazada', dia, dia === hoy ? 'La tarea quedó para hoy.' : `Tarea movida al ${fechaCorta(dia)}.`);

	async function delegar(a: AlertaTarea, persona: string | null) {
		try {
			await delegarTarea(supabase, a, persona, permisosState.userName || null);
			toast.success(persona ? `Tarea delegada a ${persona}.` : 'Se quitó la delegación.');
			await cargar(false);
		} catch (err) {
			toast.error(`No se pudo delegar la tarea. ${describeError(err)}`);
		}
	}

	async function cambiarPrioridad(a: AlertaTarea, p: PrioridadAlerta | null) {
		try {
			await guardarPrioridadTarea(supabase, a, p, permisosState.userName || null);
			if (p) alertas = alertas.map((x) => (x.id === a.id ? { ...x, prioridad: p, prioridadManual: true } : x));
			else await cargar(false);
			toast.success(p ? `Prioridad ${PRIORIDAD[p].texto} (la ven todos).` : 'La prioridad vuelve a ser automática, según la fecha.');
		} catch (err) {
			toast.error(`No se pudo cambiar la prioridad. ${describeError(err)}`);
		}
	}

	/** Lista: soltar una tarea sobre otra de la misma área la deja antes o después (según la mitad de la tarjeta). */
	function soltarEnLista(id: string, destino: HTMLElement | null, _x: number, y: number) {
		const objetivo = destino?.dataset.id;
		const a = visibles.find((x) => x.id === id);
		if (!a || !destino || !objetivo || objetivo === id) return;
		const grupo = visibles.filter((x) => x.modulo === a.modulo).map((x) => x.id);
		if (!grupo.includes(objetivo)) {
			toast.error('Solo se puede ordenar dentro de la misma área.');
			return;
		}
		const nuevo = grupo.filter((x) => x !== id);
		const r = destino.getBoundingClientRect();
		nuevo.splice(nuevo.indexOf(objetivo) + (y > r.top + r.height / 2 ? 1 : 0), 0, id);
		const m = new Map(ordenManual);
		nuevo.forEach((x, i) => m.set(x, i));
		ordenManual = m;
		orden = 'manual';
		guardarOrdenTareas(supabase, nuevo).catch((err) => toast.error(`No se pudo guardar el orden. ${describeError(err)}`));
	}
</script>

<svelte:head><title>{vista === 'lista' ? 'Tareas de hoy' : 'Calendario de tareas'} · Construni ERP</title></svelte:head>

<div class="h-full overflow-y-auto bg-slate-50">
	<div class={`${vista === 'lista' ? 'max-w-3xl' : 'max-w-7xl'} mx-auto p-4 sm:p-6 flex flex-col gap-4`}>
		<div class="flex items-center gap-3 sm:gap-4 bg-white border border-slate-100 rounded-2xl shadow-sm p-4">
			<span class="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-orange-50 text-orange-500 flex items-center justify-center text-2xl shrink-0"><i class="fas fa-calendar-check"></i></span>
			<div class="flex-1 min-w-0">
				<h1 class="text-lg sm:text-2xl font-extrabold leading-tight text-[#0f2a4a]">{vista === 'lista' ? 'Vamos paso a paso' : 'Calendario de tareas'}</h1>
				<p class="text-sm sm:text-base leading-snug text-slate-700">{conteo.hoy} tarea{conteo.hoy === 1 ? '' : 's'} pendiente{conteo.hoy === 1 ? '' : 's'} para hoy</p>
				<p class="text-sm text-slate-500 first-letter:uppercase">{fechaLarga}</p>
			</div>
			<!-- Ticket #135: el cartel ya no se monta sobre el texto; va encima de Snoopy, también en el celular. -->
			<div class="shrink-0 flex flex-col items-center gap-1">
				<span class="rotate-[-6deg] rounded-lg border-2 border-slate-700 bg-white px-1.5 py-0.5 text-[10px] font-bold leading-tight text-slate-700 text-center whitespace-nowrap">¡Ánimo!<br />Tú puedes</span>
				<img src="/snoopy-casco.webp" alt="" class="h-12 sm:h-16 w-auto select-none" draggable="false" />
			</div>
		</div>

		<div class="grid grid-cols-3 gap-1 rounded-2xl bg-white border border-slate-100 p-1 shadow-sm" role="tablist" aria-label="Vista">
			{#each [['lista', 'Lista', 'fa-list-check'], ['semana', 'Semana', 'fa-calendar-week'], ['mes', 'Mes', 'fa-calendar-days']] as [v, t, ic] (v)}
				<button type="button" role="tab" aria-selected={vista === v} onclick={() => (vista = v as typeof vista)} class={`py-2 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 ${vista === v ? 'bg-orange-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
					<i class={`fas ${ic}`}></i>{t}
				</button>
			{/each}
		</div>

		<div class="relative">
			<i class="fas fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
			<input type="search" bind:value={busqueda} placeholder="Buscar tarea, proyecto o responsable…" class="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-sm" aria-label="Buscar tarea" />
		</div>

		<div class={`grid grid-cols-2 gap-2 ${vista === 'lista' ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
			<select bind:value={area} class="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm" aria-label="Área">
				<option value="">Todas las áreas</option>
				{#each AREAS as a (a.modulo)}<option value={a.modulo}>{a.titulo}</option>{/each}
			</select>
			<select bind:value={quien} class="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm" aria-label="De quién">
				<option value="mias">Mis tareas</option>
				<option value="todas">Todas las de mis áreas</option>
			</select>
			<select bind:value={urgencia} class="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm" aria-label="Urgencia">
				<option value="">Todas las urgencias</option>
				<option value="alta">Alta</option>
				<option value="media">Media</option>
				<option value="baja">Baja</option>
			</select>
			{#if vista === 'lista'}
				<select bind:value={orden} class="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm" aria-label="Ordenar">
					<option value="urgencia">Por urgencia (Alta → Baja)</option>
					<option value="fecha">Por fecha de vencimiento</option>
					<option value="manual">Orden manual por área</option>
				</select>
			{/if}
		</div>

		{#if vista !== 'lista'}
			{#if cargando}
				<div class="py-12 text-center text-slate-400"><i class="fas fa-spinner fa-spin text-xl text-blue-500"></i></div>
			{:else}
				<CalendarioTareas alertas={base} {estados} {hoy} bind:vista={vista as 'semana' | 'mes'} onMover={moverADia} onPrioridad={cambiarPrioridad} onCompletar={(a) => cambiar(a, 'completada')} onAbrir={(a) => goto(a.href)} />
			{/if}
		{:else}
		<div class="grid grid-cols-3 gap-1 rounded-2xl bg-white border border-slate-100 p-1 shadow-sm" role="tablist">
			{#each [['hoy', 'Hoy'], ['aplazada', 'Aplazadas'], ['completada', 'Completadas']] as [v, t] (v)}
				{@const n = conteo[v as keyof typeof conteo]}
				<button type="button" role="tab" aria-selected={pestana === v} onclick={() => (pestana = v as typeof pestana)} class={`py-2 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 ${pestana === v ? 'bg-orange-100 text-orange-600' : 'text-slate-600 hover:bg-slate-50'}`}>
					{t}
					{#if v !== 'completada' && n}<span class={`min-w-5 h-5 px-1.5 rounded-full text-xs flex items-center justify-center ${pestana === v ? 'bg-orange-500 text-white' : 'bg-slate-200 text-slate-700'}`}>{n}</span>{/if}
				</button>
			{/each}
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
					{#each items as a, i (a.id)}
						{@const v = etiquetaVencimiento(a.fecha, hoy)}
						{@const e = estados.get(a.id)}
						<div data-arrastre-item data-soltar data-id={a.id} class="relative flex items-start gap-2 sm:gap-3 bg-white border border-slate-100 rounded-2xl shadow-sm px-2 sm:px-3 py-3">
							<button type="button" use:arrastrable={{ id: a.id, onSoltar: soltarEnLista }} class="mt-1 cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 px-1 shrink-0" title="Arrastrar para ordenar" aria-label="Arrastrar para ordenar"><i class="fas fa-grip-vertical"></i></button>
							{#if orden === 'manual'}<span class="mt-0.5 min-w-7 h-7 px-1 rounded-lg border border-slate-200 bg-slate-50 text-xs font-bold text-slate-600 flex items-center justify-center shrink-0">{i + 1}</span>{/if}
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
								<p class="mt-1 text-xs leading-snug text-slate-500"><i class="far fa-user mr-1"></i> {a.delegadoPor ? (mismoNombre(a.delegadoPor, yo) ? 'Delegada por ti' : `Delegada por ${a.delegadoPor}`) : a.registradoPor ? (mismoNombre(a.registradoPor, yo) ? 'Registrada por ti' : `Registrada por ${a.registradoPor}`) : 'Alerta del ERP'}{a.responsable && !esMia(a) ? ` · a cargo de ${a.responsable}` : ''}</p>
							</button>
							<div class="w-[6.75rem] flex flex-col items-end gap-1 shrink-0 text-right">
								<PrioridadTarea prioridad={a.prioridad} manual={a.prioridadManual} onCambiar={(p) => cambiarPrioridad(a, p)} />
								<DelegarTarea responsable={a.responsable} delegada={!!a.delegadoPor} onDelegar={(p) => delegar(a, p)} />
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
		{/if}
	</div>
</div>
