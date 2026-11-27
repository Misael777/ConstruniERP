<script lang="ts">
	/**
	 * Calendario de "Tareas de hoy" (maqueta de la clienta, 27/11/2026): vista Semana y Mes. Cada tarea pendiente va en su
	 * día (diaPlanTarea: el día al que se movió o su fecha; lo vencido va en hoy, marcado). Arrastrando la tarjeta (asa ⋮⋮)
	 * a otro día se mueve a ese día: se guarda como "aplazada hasta" ese día en tarea_estado (personal), no cambia la
	 * fecha real de la cuota, contrato o actividad. No se puede mover a un día pasado.
	 */
	import { untrack } from 'svelte';
	import { toast } from '$lib/stores/toast';
	import { arrastrable } from '$lib/shared/arrastre';
	import PrioridadTarea from './PrioridadTarea.svelte';
	import { diaPlanTarea, pestanaTarea, type AlertaTarea, type EstadoTarea, type PrioridadAlerta } from '../services/alertas.service';
	import { PRIORIDAD_TAREA, areaTarea, fechaCorta, sumarDiasTarea } from '../tareasUi';

	let {
		alertas,
		estados,
		hoy,
		vista = $bindable(),
		onMover,
		onPrioridad,
		onCompletar,
		onAbrir
	}: {
		alertas: AlertaTarea[];
		estados: Map<string, EstadoTarea>;
		hoy: string;
		vista: 'semana' | 'mes';
		onMover: (a: AlertaTarea, dia: string) => void;
		onPrioridad: (a: AlertaTarea, p: PrioridadAlerta | null) => void;
		onCompletar: (a: AlertaTarea) => void;
		onAbrir: (a: AlertaTarea) => void;
	} = $props();

	const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
	const MAX_MES = 3;

	let ancla = $state(untrack(() => hoy));

	const lunesDe = (f: string) => sumarDiasTarea(f, -((new Date(`${f}T12:00:00Z`).getUTCDay() + 6) % 7));
	const diaMes = (f: string) => Number(f.slice(8, 10));

	const pendientes = $derived(alertas.filter((a) => pestanaTarea(a, estados.get(a.id), hoy) !== 'completada'));
	const stats = $derived({
		pendientes: pendientes.length,
		vencidas: pendientes.filter((a) => a.fecha < hoy).length,
		completadas: alertas.length - pendientes.length
	});
	const porDia = $derived.by(() => {
		const m = new Map<string, AlertaTarea[]>();
		for (const a of pendientes) {
			const d = diaPlanTarea(a, estados.get(a.id), hoy);
			m.set(d, [...(m.get(d) ?? []), a]);
		}
		for (const l of m.values()) l.sort((x, y) => PRIORIDAD_TAREA[x.prioridad].orden - PRIORIDAD_TAREA[y.prioridad].orden || x.fecha.localeCompare(y.fecha));
		return m;
	});

	const semana = $derived(Array.from({ length: 7 }, (_, i) => sumarDiasTarea(lunesDe(ancla), i)));
	const mes = $derived.by(() => {
		const primero = `${ancla.slice(0, 7)}-01`;
		const ultimo = sumarDiasTarea(`${sumarDiasTarea(primero, 32).slice(0, 7)}-01`, -1);
		const dias: string[] = [];
		for (let d = lunesDe(primero); d <= ultimo || dias.length % 7; d = sumarDiasTarea(d, 1)) dias.push(d);
		return dias;
	});
	const titulo = $derived.by(() => {
		if (vista === 'mes') return new Date(`${ancla.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString('es-PE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
		const [a, b] = [semana[0], semana[6]];
		const anio = b.slice(0, 4);
		return a.slice(5, 7) === b.slice(5, 7) ? `${diaMes(a)} – ${fechaCorta(b)} ${anio}` : `${fechaCorta(a)} – ${fechaCorta(b)} ${anio}`;
	});

	function navegar(paso: number) {
		if (vista === 'semana') ancla = sumarDiasTarea(ancla, 7 * paso);
		else {
			const [y, m] = ancla.split('-').map(Number);
			const d = new Date(Date.UTC(y, m - 1 + paso, 1, 12));
			ancla = d.toISOString().slice(0, 10);
		}
	}

	function soltar(id: string, destino: HTMLElement | null) {
		const dia = destino?.dataset.dia;
		const a = pendientes.find((x) => x.id === id);
		if (!dia || !a) return;
		if (dia < hoy) {
			toast.error('No se puede mover una tarea a un día que ya pasó.');
			return;
		}
		if (dia === diaPlanTarea(a, estados.get(a.id), hoy)) return;
		onMover(a, dia);
	}
</script>

<div class="flex flex-col gap-3">
	<div class="grid grid-cols-3 gap-2">
		<div class="flex items-center gap-2 sm:gap-3 rounded-2xl border border-slate-100 bg-white shadow-sm px-3 py-2">
			<i class="fas fa-clipboard-list text-orange-500 text-lg sm:text-xl"></i>
			<div><p class="text-xs sm:text-sm text-slate-600">Pendientes</p><p class="text-lg sm:text-2xl font-extrabold text-orange-500 leading-tight">{stats.pendientes}</p></div>
		</div>
		<div class="flex items-center gap-2 sm:gap-3 rounded-2xl border border-slate-100 bg-white shadow-sm px-3 py-2">
			<i class="fas fa-triangle-exclamation text-rose-500 text-lg sm:text-xl"></i>
			<div><p class="text-xs sm:text-sm text-slate-600">Vencidas</p><p class="text-lg sm:text-2xl font-extrabold text-rose-600 leading-tight">{stats.vencidas}</p></div>
		</div>
		<div class="flex items-center gap-2 sm:gap-3 rounded-2xl border border-slate-100 bg-white shadow-sm px-3 py-2">
			<i class="fas fa-circle-check text-emerald-500 text-lg sm:text-xl"></i>
			<div><p class="text-xs sm:text-sm text-slate-600">Completadas</p><p class="text-lg sm:text-2xl font-extrabold text-emerald-600 leading-tight">{stats.completadas}</p></div>
		</div>
	</div>

	<div class="flex items-center gap-2">
		<button type="button" onclick={() => navegar(-1)} class="w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" aria-label="Anterior"><i class="fas fa-chevron-left"></i></button>
		<button type="button" onclick={() => (ancla = hoy)} class="px-3 h-9 rounded-xl bg-orange-100 text-orange-600 font-semibold text-sm">Hoy</button>
		<button type="button" onclick={() => navegar(1)} class="w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" aria-label="Siguiente"><i class="fas fa-chevron-right"></i></button>
		<h2 class="ml-1 text-base sm:text-xl font-bold text-[#0f2a4a] first-letter:uppercase">{titulo}</h2>
	</div>
	<p class="text-xs text-slate-500 -mt-1"><i class="fas fa-grip-vertical mr-1"></i>Arrastra una tarea desde <i class="fas fa-grip-vertical"></i> a otro día para moverla. Las vencidas aparecen en hoy.</p>

	{#if vista === 'semana'}
		<div class="overflow-x-auto pb-1">
			<div class="grid grid-cols-7 gap-2 min-w-[980px]">
				{#each semana as dia, i (dia)}
					{@const lista = porDia.get(dia) ?? []}
					{@const esHoy = dia === hoy}
					<div data-soltar data-dia={dia} class={`flex flex-col gap-2 rounded-2xl border p-2 min-h-[16rem] transition-colors ${esHoy ? 'border-orange-400 bg-orange-50/60' : dia < hoy ? 'border-slate-100 bg-slate-50' : 'border-slate-100 bg-white'}`}>
						<div class={`rounded-xl text-center py-1.5 ${esHoy ? 'bg-orange-500 text-white' : ''}`}>
							<p class="font-bold">{DIAS[i]} {diaMes(dia)}</p>
							<span class={`inline-block mt-0.5 rounded-full px-2 text-xs ${esHoy ? 'bg-white text-orange-600' : 'bg-slate-100 text-slate-600'}`}>{lista.length} tarea{lista.length === 1 ? '' : 's'}</span>
						</div>
						{#each lista as a (a.id)}
							{@const area = areaTarea(a.modulo)}
							<div data-arrastre-item class="rounded-xl border border-slate-200 bg-white shadow-sm p-2 flex flex-col gap-1.5">
								<div class="flex items-start gap-1">
									<button type="button" use:arrastrable={{ id: a.id, onSoltar: soltar }} class="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 px-0.5 pt-0.5" aria-label="Arrastrar a otro día" title="Arrastrar a otro día"><i class="fas fa-grip-vertical"></i></button>
									<button type="button" onclick={() => onAbrir(a)} class="flex-1 min-w-0 text-left text-sm font-bold leading-snug text-slate-800 break-words line-clamp-3" title={a.titulo}>{a.titulo}</button>
								</div>
								<span class={`self-start rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${area.chip}`}><i class={`fas ${area.icono} mr-1`}></i>{area.titulo}</span>
								{#if a.fecha < hoy}<span class="text-[11px] font-semibold text-rose-600">Vencida el {fechaCorta(a.fecha)}</span>{/if}
								<div class="flex items-center gap-1">
									<PrioridadTarea prioridad={a.prioridad} manual={a.prioridadManual} compacto onCambiar={(p) => onPrioridad(a, p)} />
									<button type="button" onclick={() => onCompletar(a)} class="ml-auto w-6 h-6 rounded-full border-2 border-slate-300 text-transparent hover:border-emerald-500 hover:text-emerald-500 flex items-center justify-center" title="Marcar como completada" aria-label="Marcar como completada"><i class="fas fa-check text-[10px]"></i></button>
								</div>
							</div>
						{/each}
					</div>
				{/each}
			</div>
		</div>
	{:else}
		<div class="overflow-x-auto pb-1">
			<div class="min-w-[700px]">
				<div class="grid grid-cols-7 gap-1 mb-1">
					{#each DIAS as d (d)}<p class="text-center text-xs font-semibold text-slate-500">{d.slice(0, 3)}</p>{/each}
				</div>
				<div class="grid grid-cols-7 gap-1">
					{#each mes as dia (dia)}
						{@const lista = porDia.get(dia) ?? []}
						{@const fuera = dia.slice(0, 7) !== ancla.slice(0, 7)}
						<div data-soltar data-dia={dia} class={`flex flex-col gap-1 rounded-xl border p-1.5 min-h-[6.5rem] ${dia === hoy ? 'border-orange-400 bg-orange-50/60' : fuera || dia < hoy ? 'border-slate-100 bg-slate-50' : 'border-slate-100 bg-white'}`}>
							<p class={`text-xs font-bold ${dia === hoy ? 'text-orange-600' : fuera ? 'text-slate-300' : 'text-slate-600'}`}>{diaMes(dia)}</p>
							{#each lista.slice(0, MAX_MES) as a (a.id)}
								<div data-arrastre-item class="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1 py-0.5">
									<button type="button" use:arrastrable={{ id: a.id, onSoltar: soltar }} class="cursor-grab text-slate-400 text-[10px] px-0.5" aria-label="Arrastrar a otro día"><i class="fas fa-grip-vertical"></i></button>
									<span class={`w-2 h-2 rounded-full shrink-0 ${PRIORIDAD_TAREA[a.prioridad].punto}`} title={`Prioridad ${PRIORIDAD_TAREA[a.prioridad].texto}`}></span>
									<button type="button" onclick={() => onAbrir(a)} class={`flex-1 min-w-0 text-left text-[11px] leading-tight truncate ${a.fecha < hoy ? 'text-rose-600 font-semibold' : 'text-slate-700'}`} title={a.titulo}>{a.titulo}</button>
								</div>
							{/each}
							{#if lista.length > MAX_MES}
								<button type="button" onclick={() => { ancla = dia; vista = 'semana'; }} class="text-[11px] font-semibold text-orange-600 text-left hover:underline">+{lista.length - MAX_MES} más</button>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</div>
