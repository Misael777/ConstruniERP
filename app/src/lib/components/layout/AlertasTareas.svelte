<script lang="ts">
	// Ícono ⚠ "Alertas de tareas" de la cabecera (pedido de la clienta con imagen, 20/11/2026): lo que vence pronto o
	// ya venció en todo el ERP, agrupado por módulo, para no tener que revisar cada pantalla (p. ej. renovar el SCTR).
	// Las alertas se calculan de los datos de cada módulo (ver alertas.service.ts). Se recarga al abrir el panel y
	// cada 10 minutos.
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { TriangleAlert, Users, Layers, Database, ChevronRight, Loader2 } from '@lucide/svelte';
	import { supabase } from '$lib/supabaseClient';
	import { crearDetectorDeNovedades } from '$lib/shared/sonido';
	import { hasPermiso, permisosState } from '$lib/stores/permisos.svelte';
	import { getAlertasTareas, etiquetaVencimiento, type AlertaTarea, type ModuloAlerta, type PrioridadAlerta } from '$lib/modules/alertas/services/alertas.service';

	let alertas = $state<AlertaTarea[]>([]);
	let abierto = $state(false);
	let cargando = $state(false);
	let error = $state('');
	// Ticket #137: abre en "Mis tareas" y el número del ícono cuenta solo las propias.
	let pestana = $state<'todas' | 'mias' | 'delegadas'>('mias');
	let verTodo = $state(false);
	let timer: ReturnType<typeof setInterval> | null = null;

	const MAX_POR_GRUPO = 5;
	const GRUPOS: { modulo: ModuloAlerta; titulo: string; icono: typeof Users }[] = [
		{ modulo: 'rrhh', titulo: 'Recursos Humanos', icono: Users },
		{ modulo: 'proyectos', titulo: 'Proyectos', icono: Layers },
		{ modulo: 'finanzas', titulo: 'Finanzas', icono: Database }
	];
	const PRIORIDAD: Record<PrioridadAlerta, { texto: string; clase: string }> = {
		alta: { texto: 'Alta', clase: 'bg-rose-50 text-rose-600 border-rose-100' },
		media: { texto: 'Media', clase: 'bg-blue-50 text-blue-600 border-blue-100' },
		baja: { texto: 'Baja', clase: 'bg-slate-50 text-slate-500 border-slate-200' }
	};

	const yo = $derived((permisosState.userName || '').trim().toLowerCase());
	const esMia = (a: AlertaTarea) => !!yo && (a.responsable ?? '').trim().toLowerCase() === yo;
	const esDelegada = (a: AlertaTarea) => !!yo && !!a.responsable && !esMia(a) && (a.registradoPor ?? '').trim().toLowerCase() === yo;

	const visibles = $derived(pestana === 'mias' ? alertas.filter(esMia) : pestana === 'delegadas' ? alertas.filter(esDelegada) : alertas);
	const conteo = $derived({ todas: alertas.length, mias: alertas.filter(esMia).length, delegadas: alertas.filter(esDelegada).length });
	const mias = $derived(alertas.filter(esMia));
	const urgentes = $derived(mias.filter((a) => etiquetaVencimiento(a.fecha).urgente).length);

	// Ticket #130: suena cuando aparece una alerta nueva a mi cargo (no en la primera carga).
	let cargoUnaVez = $state(false);
	const detectarNovedad = crearDetectorDeNovedades('alerta');
	$effect(() => {
		if (cargoUnaVez) detectarNovedad(mias.length);
	});

	async function cargar() {
		if (!permisosState.loaded) return;
		cargando = true;
		error = '';
		try {
			// Ticket #125: el responsable de los vencimientos (SCTR, examen médico) ve los suyos aunque su rol no tenga
			// acceso a Personal; quien sí lo tiene ve todos.
			const verRrhh = hasPermiso('ver_rrhh_personal');
			const lista = await getAlertasTareas(supabase, {
				rrhh: true,
				proyectos: hasPermiso('ver_proyectos_gestion'),
				finanzas: hasPermiso('ver_finanzas_cuentas_pendientes')
			});
			alertas = lista.filter((a) => a.modulo !== 'rrhh' || verRrhh || esMia(a));
			cargoUnaVez = true;
		} catch (err: any) {
			error = err?.message ?? 'No se pudieron cargar las alertas.';
		} finally {
			cargando = false;
		}
	}

	function alternar() {
		abierto = !abierto;
		if (abierto) {
			verTodo = false;
			pestana = 'mias';
			cargar();
		}
	}

	function ir(a: AlertaTarea) {
		abierto = false;
		goto(a.href);
	}

	// Los permisos llegan después del montaje: carga en cuanto están listos.
	$effect(() => {
		if (permisosState.loaded) cargar();
	});
	onMount(() => {
		timer = setInterval(cargar, 10 * 60 * 1000);
	});
	onDestroy(() => {
		if (timer) clearInterval(timer);
	});
</script>

<div class="relative">
	<button
		type="button"
		onclick={alternar}
		class={`relative ${urgentes > 0 ? 'text-orange-500 hover:text-orange-600' : 'text-slate-400 hover:text-brand-orange'}`}
		aria-label="Alertas de tareas"
		title={`Alertas de tareas · ${mias.length} mía${mias.length === 1 ? '' : 's'} de ${alertas.length}`}
	>
		<TriangleAlert size={18} />
		{#if mias.length > 0}
			<span class="absolute -top-1.5 -right-1.5 min-w-[14px] h-3.5 px-0.5 bg-red-500 rounded-full border-2 border-white text-[8px] leading-none text-white font-bold flex items-center justify-center">
				{mias.length > 99 ? '99+' : mias.length}
			</span>
		{/if}
	</button>

	{#if abierto}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="fixed inset-0 z-30" role="presentation" onclick={() => (abierto = false)}></div>
		<div class="fixed left-3 right-3 top-16 sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[26rem] max-h-[75vh] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-slate-100 z-40">
			<div class="p-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl z-10">
				<div class="flex items-start gap-3">
					<TriangleAlert size={26} class="text-orange-500 shrink-0" />
					<div class="min-w-0">
						<h3 class="text-base font-bold text-slate-800">Alertas de tareas</h3>
						<p class="text-xs text-slate-400">Pendientes por vencer o vencidas</p>
					</div>
					{#if cargando}<Loader2 size={14} class="ml-auto animate-spin text-slate-400" />{/if}
				</div>
				<div class="mt-3 flex gap-2">
					{#each [['mias', `Mis tareas (${conteo.mias})`], ['delegadas', `Delegadas (${conteo.delegadas})`], ['todas', `Todas (${conteo.todas})`]] as [valor, texto] (valor)}
						<button
							type="button"
							onclick={() => (pestana = valor as typeof pestana)}
							class={`flex-1 px-2 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${pestana === valor ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
						>
							{texto}
						</button>
					{/each}
				</div>
			</div>

			{#if error}
				<p class="px-4 py-6 text-center text-xs text-rose-600">{error}</p>
			{:else if !visibles.length}
				<p class="px-4 py-8 text-center text-sm text-slate-400">
					{cargando ? 'Cargando…' : pestana === 'todas' ? 'No hay tareas por vencer. ¡Todo al día!' : pestana === 'mias' ? 'No tienes tareas a tu cargo por vencer.' : 'No hay tareas que hayas delegado por vencer.'}
				</p>
			{:else}
				{#each GRUPOS as grupo (grupo.modulo)}
					{@const items = visibles.filter((a) => a.modulo === grupo.modulo)}
					{#if items.length}
						{@const Icono = grupo.icono}
						<div class="flex items-center gap-2 px-4 py-2 bg-slate-50 border-y border-slate-100 text-xs font-bold uppercase tracking-wide text-slate-700">
							<Icono size={15} class="text-slate-500" />{grupo.titulo} ({items.length})
						</div>
						<ul>
							{#each verTodo ? items : items.slice(0, MAX_POR_GRUPO) as a (a.id)}
								{@const v = etiquetaVencimiento(a.fecha)}
								<li>
									<button type="button" onclick={() => ir(a)} class="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-slate-50" title={a.detalle ? `${a.titulo} — ${a.detalle}` : a.titulo}>
										<div class="flex-1 min-w-0">
											<p class="text-[13px] text-slate-800 truncate">{a.titulo}</p>
											{#if a.detalle}<p class="text-[11px] text-slate-400 truncate">{a.detalle}{a.responsable ? ` · ${a.responsable}` : ''}</p>{/if}
										</div>
										<span class={`shrink-0 px-2 py-0.5 rounded-md border text-[10px] font-semibold ${PRIORIDAD[a.prioridad].clase}`}>{PRIORIDAD[a.prioridad].texto}</span>
										<span class={`shrink-0 w-24 text-right text-[11px] ${v.urgente ? 'font-semibold text-rose-600' : 'text-slate-500'}`}>{v.texto}</span>
										<ChevronRight size={14} class="shrink-0 text-slate-400" />
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				{/each}
				{#if GRUPOS.some((g) => visibles.filter((a) => a.modulo === g.modulo).length > MAX_POR_GRUPO)}
					<div class="p-3 flex justify-center border-t border-slate-100">
						<button type="button" onclick={() => (verTodo = !verTodo)} class="px-4 py-1.5 rounded-lg border border-blue-200 text-xs font-semibold text-blue-700 hover:bg-blue-50">
							{verTodo ? 'Ver menos' : 'Ver todas las tareas'}
						</button>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>
