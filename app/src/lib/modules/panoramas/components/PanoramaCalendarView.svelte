<script lang="ts">
	// Vista alternativa (tab "Calendario") para los tableros de Panoramas de
	// Pago/Cobro — misma info que el tablero Kanban (título, monto, fecha de
	// vencimiento) pero organizada como calendario semanal en vez de columnas
	// arrastrables. Puramente de presentación: no hay drag-and-drop aquí ni se
	// persiste nada; navegar entre semanas es solo aritmética de fechas local.
	//
	// La hora de cada tarjeta es un valor cosmético (determinístico por id,
	// ver horaPseudo) — este ERP no registra una hora real para vencimientos
	// de cuentas por pagar/cobrar, así que no había ninguna hora "real" que
	// mostrar; se posicionan en una franja horaria fija solo para lograr el
	// layout tipo agenda. La fecha y el monto sí son datos reales.
	import { formatCurrency } from '$lib/shared/fieldConfig';
	import { ChevronLeft, ChevronRight, Info } from '@lucide/svelte';

	export interface CalendarEvento {
		id: number | string;
		titulo: string;
		subtitulo: string;
		monto: number;
		fecha: string; // YYYY-MM-DD
		tipo: 'ingreso' | 'egreso';
	}

	export interface CalendarPanorama {
		id: 1 | 2;
		nombre: string;
		subtitulo: string;
		eventos: CalendarEvento[];
	}

	const { panoramas, ingresosProyectados = 0, egresosProyectados = 0 }: {
		panoramas: CalendarPanorama[];
		ingresosProyectados?: number;
		egresosProyectados?: number;
	} = $props();

	const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
	const HORA_INICIO = 8;
	const HORA_FIN = 18;
	const HORAS = [8, 10, 12, 14, 16, 18];
	const PX_POR_HORA = 52;
	const GRID_H = (HORA_FIN - HORA_INICIO) * PX_POR_HORA;
	// Franjas horarias fijas para repartir tarjetas visualmente (ver nota arriba) — no representan horas reales.
	const HORAS_PSEUDO = [9, 10, 11.5, 14, 15, 16.5];

	function startOfWeek(d: Date): Date {
		const day = d.getDay(); // 0=Dom
		const diff = day === 0 ? -6 : 1 - day; // retrocede hasta el lunes
		const monday = new Date(d);
		monday.setDate(d.getDate() + diff);
		monday.setHours(0, 0, 0, 0);
		return monday;
	}

	let weekStart = $state(startOfWeek(new Date()));
	let vista = $state<'semana' | 'mes'>('semana');

	function addDays(d: Date, n: number): Date {
		const r = new Date(d);
		r.setDate(r.getDate() + n);
		return r;
	}
	function toISO(d: Date): string {
		return d.toISOString().slice(0, 10);
	}

	let weekDays = $derived(Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)));
	let rangoLabel = $derived.by(() => {
		const fin = addDays(weekStart, 6);
		const fmt = (d: Date, withYear: boolean) =>
			d.toLocaleDateString('es-PE', { day: 'numeric', month: withYear ? 'long' : undefined, year: withYear ? 'numeric' : undefined });
		if (weekStart.getMonth() === fin.getMonth()) {
			return `${weekStart.getDate()} – ${fmt(fin, true)}`;
		}
		return `${fmt(weekStart, false)} ${weekStart.toLocaleDateString('es-PE', { month: 'short' })} – ${fmt(fin, true)}`;
	});

	function prevWeek() { weekStart = addDays(weekStart, -7); }
	function nextWeek() { weekStart = addDays(weekStart, 7); }
	function irAHoy() { weekStart = startOfWeek(new Date()); }

	function horaPseudo(id: number | string): number {
		const n = typeof id === 'number' ? id : String(id).split('').reduce((s, c) => s + c.charCodeAt(0), 0);
		return HORAS_PSEUDO[n % HORAS_PSEUDO.length];
	}

	function eventosDelDia(eventos: CalendarEvento[], fechaISO: string): (CalendarEvento & { hora: number })[] {
		return eventos
			.filter((e) => e.fecha === fechaISO)
			.map((e) => ({ ...e, hora: horaPseudo(e.id) }))
			.sort((a, b) => a.hora - b.hora);
	}

	function fmtHora(h: number): string {
		const hh = Math.floor(h);
		const mm = h % 1 === 0 ? '00' : '30';
		return `${String(hh).padStart(2, '0')}:${mm}`;
	}

	// Totales de la semana visible, sumando todos los panoramas — mismo par de
	// KPIs (ingresos/egresos/saldo) que ya se muestra arriba del tablero Kanban.
	let eventosSemana = $derived(panoramas.flatMap((p) => p.eventos).filter((e) => weekDays.some((d) => toISO(d) === e.fecha)));
	let ingresosSemana = $derived(eventosSemana.filter((e) => e.tipo === 'ingreso'));
	let egresosSemana = $derived(eventosSemana.filter((e) => e.tipo === 'egreso'));
	let totalTransacciones = $derived(eventosSemana.length);
</script>

<div class="flex flex-col gap-4">
	<!-- KPIs + navegación -->
	<div class="flex flex-wrap items-center justify-between gap-3 bg-white rounded-xl border border-slate-200 p-4">
		<div class="flex flex-wrap items-center gap-6">
			<div class="flex items-center gap-2">
				<span class="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0"></span>
				<div>
					<p class="text-xs text-slate-400">Ingresos proyectados</p>
					<p class="text-sm font-bold text-slate-800">{formatCurrency(ingresosProyectados || ingresosSemana.reduce((s, e) => s + e.monto, 0))}</p>
					{#if ingresosSemana.length > 0}<p class="text-[10px] text-slate-400">{ingresosSemana.length} transacciones</p>{/if}
				</div>
			</div>
			<div class="flex items-center gap-2">
				<span class="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0"></span>
				<div>
					<p class="text-xs text-slate-400">Egresos proyectados</p>
					<p class="text-sm font-bold text-slate-800">{formatCurrency(egresosProyectados || egresosSemana.reduce((s, e) => s + e.monto, 0))}</p>
					{#if egresosSemana.length > 0}<p class="text-[10px] text-slate-400">{egresosSemana.length} transacciones</p>{/if}
				</div>
			</div>
			<div>
				<p class="text-xs text-slate-400">Saldo neto proyectado</p>
				<p class="text-base font-bold text-blue-700">
					{formatCurrency((ingresosProyectados || ingresosSemana.reduce((s, e) => s + e.monto, 0)) - (egresosProyectados || egresosSemana.reduce((s, e) => s + e.monto, 0)))}
				</p>
			</div>
		</div>

		<div class="flex items-center gap-2 text-sm">
			<button type="button" onclick={prevWeek} class="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Semana anterior">
				<ChevronLeft size={16} />
			</button>
			<button type="button" onclick={nextWeek} class="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Semana siguiente">
				<ChevronRight size={16} />
			</button>
			<button type="button" onclick={irAHoy} class="px-3 h-8 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50">Hoy</button>
			<span class="mx-1 text-slate-300">|</span>
			<div class="flex rounded-lg border border-slate-200 overflow-hidden">
				<button
					type="button"
					onclick={() => (vista = 'semana')}
					class="px-3 h-8 font-medium {vista === 'semana' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}"
				>Semana</button>
				<button
					type="button"
					onclick={() => (vista = 'mes')}
					class="px-3 h-8 font-medium {vista === 'mes' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}"
				>Mes</button>
			</div>
		</div>
	</div>

	{#if vista === 'mes'}
		<div class="bg-white rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-400">
			Vista mensual en desarrollo — usa "Semana" por ahora.
		</div>
	{:else}
		{#each panoramas as panorama (panorama.id)}
			<div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
				<div class="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
					<h3 class="font-bold text-slate-800 text-sm">{panorama.nombre} – {panorama.subtitulo}</h3>
					<span title="Fechas reales; la hora dentro del día es solo de ubicación visual."><Info size={13} class="text-slate-300" /></span>
					<span class="ml-auto text-xs text-slate-400">{rangoLabel}</span>
				</div>

				<!-- Encabezado de días -->
				<div class="grid" style="grid-template-columns: 70px repeat(7, 1fr)">
					<div class="border-b border-r border-slate-100"></div>
					{#each weekDays as d, i}
						{@const esHoy = toISO(d) === toISO(new Date())}
						<div class="px-2 py-2 text-center border-b border-slate-100 {i < 6 ? 'border-r' : ''} {esHoy ? 'bg-blue-50' : ''}">
							<p class="text-[11px] font-bold text-slate-500 uppercase">{DIAS[i]} {d.getDate()}</p>
						</div>
					{/each}
				</div>

				<!-- Grilla horaria -->
				<div class="grid" style="grid-template-columns: 70px repeat(7, 1fr)">
					<!-- Eje de horas -->
					<div class="relative border-r border-slate-100" style="height:{GRID_H}px">
						{#each HORAS as h}
							<div class="absolute right-2 -translate-y-1/2 text-[10px] text-slate-400" style="top:{(h - HORA_INICIO) * PX_POR_HORA}px">{h}:00</div>
						{/each}
					</div>

					{#each weekDays as d, i}
						{@const fechaISO = toISO(d)}
						{@const eventos = eventosDelDia(panorama.eventos, fechaISO)}
						<div class="relative {i < 6 ? 'border-r' : ''} border-slate-100" style="height:{GRID_H}px">
							<!-- líneas guía por hora -->
							{#each HORAS as h}
								<div class="absolute left-0 right-0 border-t border-slate-50" style="top:{(h - HORA_INICIO) * PX_POR_HORA}px"></div>
							{/each}

							{#each eventos as ev, idx (ev.id)}
								<div
									class="absolute left-1 right-1 rounded-lg border px-2 py-1 text-[10px] leading-tight shadow-sm {ev.tipo === 'ingreso' ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}"
									style="top:{(ev.hora - HORA_INICIO) * PX_POR_HORA + idx * 4}px"
								>
									<p class="font-bold {ev.tipo === 'ingreso' ? 'text-emerald-700' : 'text-rose-700'}">{fmtHora(ev.hora)}</p>
									<p class="font-semibold text-slate-700 truncate">{ev.titulo}</p>
									<p class="text-slate-400 truncate">{ev.subtitulo}</p>
									<p class="font-bold {ev.tipo === 'ingreso' ? 'text-emerald-700' : 'text-rose-700'}">{formatCurrency(ev.monto)}</p>
								</div>
							{/each}
						</div>
					{/each}
				</div>
			</div>
		{/each}
	{/if}
</div>
