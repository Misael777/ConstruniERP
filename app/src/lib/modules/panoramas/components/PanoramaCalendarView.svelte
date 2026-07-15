<script module lang="ts">
	export interface CalendarPanorama<T> {
		id: 1 | 2;
		nombre: string;
		subtitulo: string;
		items: T[];
	}
</script>

<script lang="ts" generics="T extends { id: number; titulo: string; monto: number; fechaVencimiento: string | null }">
	// Vista "Calendario" (tab alterno al tablero Kanban) para los tableros de Panoramas de
	// Pago/Cobro. Muestra Panorama 1 y Panorama 2 como calendarios semanales de "todo el día"
	// (sin franja horaria: este ERP no registra hora de vencimiento, solo fecha) y permite
	// arrastrar una cuota a otro día DENTRO del mismo panorama para reprogramarla. El cambio de
	// fecha queda en un estado local (staged) hasta que el usuario pulsa "Confirmar cambios" —
	// recién ahí se persiste en la BD (ver onGuardarFechas), igual que el tablero Kanban no
	// persiste el orden hasta una acción explícita.
	import { dndzone } from 'svelte-dnd-action';
	import { ChevronLeft, ChevronRight, GripVertical, Loader2 } from '@lucide/svelte';
	import { formatCurrency } from '$lib/shared/fieldConfig';

	const {
		panoramas,
		tipo,
		subtituloDe,
		detalleDe,
		onAbrirCuotas,
		cuotasCargandoId = null,
		onGuardarFechas
	}: {
		panoramas: CalendarPanorama<T>[];
		tipo: 'ingreso' | 'egreso';
		subtituloDe: (item: T) => string;
		detalleDe?: (item: T) => string | null;
		onAbrirCuotas: (item: T) => void;
		cuotasCargandoId?: number | null;
		onGuardarFechas: (cambios: { id: number; fechaNueva: string }[]) => Promise<void>;
	} = $props();

	const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
	const FLIP_MS = 150;

	// Este ERP no registra una hora real de vencimiento (solo fecha) — para que cada tarjeta se vea
	// como en el mockup (con una hora tipo agenda arriba) se le asigna una hora "pseudo", determinística
	// por id (mismo ítem siempre cae en la misma hora, no cambia en cada render). Es 100% cosmético:
	// no se persiste ni se usa para nada funcional, solo para ordenar y mostrar las tarjetas del día.
	const HORAS_PSEUDO = [8.5, 9, 9.5, 10, 11, 14, 15, 16.5];
	function horaPseudo(id: number): number {
		return HORAS_PSEUDO[Math.abs(id) % HORAS_PSEUDO.length];
	}
	function fmtHora(h: number): string {
		const hh = Math.floor(h);
		const mm = h % 1 === 0 ? '00' : '30';
		return `${String(hh).padStart(2, '0')}:${mm}`;
	}

	function startOfWeek(d: Date): Date {
		const day = d.getDay(); // 0=Dom
		const diff = day === 0 ? -6 : 1 - day;
		const monday = new Date(d);
		monday.setDate(d.getDate() + diff);
		monday.setHours(0, 0, 0, 0);
		return monday;
	}
	function addDays(d: Date, n: number): Date {
		const r = new Date(d);
		r.setDate(r.getDate() + n);
		return r;
	}
	function toISO(d: Date): string {
		return d.toISOString().slice(0, 10);
	}
	function hoyMedianoche(): Date {
		const d = new Date();
		d.setHours(0, 0, 0, 0);
		return d;
	}

	let vista = $state<'semana' | 'mes'>('semana');
	/** Fecha ancla de navegación: en vista semana se usa para ubicar la semana (lunes...domingo);
	 * en vista mes, su año/mes definen el mes mostrado. Se guarda como el día real (no el lunes de
	 * su semana) para no "saltar" de mes al abrir en un día cercano al inicio/fin de semana. */
	let cursor = $state(hoyMedianoche());

	let weekStart = $derived(startOfWeek(cursor));
	let weekDays = $derived(Array.from({ length: 7 }, (_, i) => toISO(addDays(weekStart, i))));
	/** Semanas completas (lunes a domingo) que cubren el mes de `cursor`, incluyendo días de relleno
	 * del mes anterior/siguiente para completar cada semana — igual que cualquier calendario mensual. */
	let monthDays = $derived.by(() => {
		const primerDiaMes = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
		const ultimoDiaMes = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
		const inicio = startOfWeek(primerDiaMes);
		const finSemana = startOfWeek(ultimoDiaMes);
		const dias: string[] = [];
		let semana = inicio;
		while (semana <= finSemana) {
			for (let i = 0; i < 7; i++) dias.push(toISO(addDays(semana, i)));
			semana = addDays(semana, 7);
		}
		return dias;
	});
	let visibleDays = $derived(vista === 'semana' ? weekDays : monthDays);

	let rangoLabel = $derived.by(() => {
		if (vista === 'mes') return cursor.toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
		const inicio = new Date(weekStart);
		const fin = addDays(weekStart, 6);
		const fmt = (d: Date, withYear: boolean) =>
			d.toLocaleDateString('es-PE', { day: 'numeric', month: withYear ? 'long' : undefined, year: withYear ? 'numeric' : undefined });
		if (inicio.getMonth() === fin.getMonth()) return `${inicio.getDate()} – ${fmt(fin, true)}`;
		return `${fmt(inicio, false)} ${inicio.toLocaleDateString('es-PE', { month: 'short' })} – ${fmt(fin, true)}`;
	});

	// Estado local (staged): grid[panoramaIndex][diaIndex] = ítems clonados de ese día. Se construye
	// UNA VEZ al montar (este componente vive dentro de un {#if vistaActiva === 'calendario'}, así
	// que se remonta fresco cada vez que se abre esa pestaña) y se reconstruye explícitamente solo
	// al cambiar de semana o al descartar cambios — nunca dentro de un $effect: leer `panoramas`
	// (prop) y escribir `grid` (state) dentro del mismo efecto reactivo entra en un ciclo infinito,
	// porque el padre recrea el array `panoramas` en cada uno de sus propios re-renders.
	function computeGrid(): T[][][] {
		const days = visibleDays;
		console.log(
			'[PanoramaCalendarView] panoramas recibidos:',
			panoramas.map((p) => ({ id: p.id, nombre: p.nombre, subtitulo: p.subtitulo, totalItems: p.items.length }))
		);
		const nuevoGrid = panoramas.map((p) =>
			days.map((day) =>
				p.items
					.filter((i) => i.fechaVencimiento === day)
					.map((i) => ({ ...i }))
					.sort((a, b) => horaPseudo(a.id) - horaPseudo(b.id))
			)
		);
		nuevoGrid.forEach((diasDelPanorama, pIdx) => {
			const totalVisible = diasDelPanorama.reduce((sum, d) => sum + d.length, 0);
			console.log(
				`[PanoramaCalendarView] Panorama ${panoramas[pIdx]?.id} ("${panoramas[pIdx]?.nombre}"): ${totalVisible} cuota(s) en el rango ${days[0]}–${days[days.length - 1]} (vista ${vista})`,
				diasDelPanorama
			);
		});
		return nuevoGrid;
	}

	let grid = $state<T[][][]>(computeGrid());
	let gridVersion = $state(0);
	/** id -> {item, fechaAnterior, fechaNueva}: cambios de fecha arrastrados pero aún sin confirmar. */
	let cambios = $state(new Map<number, { item: T; fechaAnterior: string | null; fechaNueva: string }>());
	let guardando = $state(false);
	let errorGuardado = $state('');

	function prev() {
		cursor = vista === 'semana' ? addDays(cursor, -7) : new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
		grid = computeGrid();
		gridVersion++;
	}
	function next() {
		cursor = vista === 'semana' ? addDays(cursor, 7) : new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
		grid = computeGrid();
		gridVersion++;
	}
	function irAHoy() { cursor = hoyMedianoche(); grid = computeGrid(); gridVersion++; }
	function cambiarVista(v: 'semana' | 'mes') {
		vista = v;
		grid = computeGrid();
		gridVersion++;
	}

	function handleConsider(pIdx: number, dIdx: number, e: CustomEvent<{ items: T[] }>) {
		grid[pIdx][dIdx] = e.detail.items;
	}
	function handleFinalize(pIdx: number, dIdx: number, e: CustomEvent<{ items: T[] }>) {
		const dayISO = visibleDays[dIdx];
		const items = e.detail.items;
		for (const it of items) {
			if (it.fechaVencimiento !== dayISO) {
				const previo = cambios.get(it.id);
				cambios.set(it.id, { item: it, fechaAnterior: previo ? previo.fechaAnterior : it.fechaVencimiento, fechaNueva: dayISO });
				it.fechaVencimiento = dayISO;
			}
		}
		// Reordena por hora pseudo (ver nota arriba) para que la columna del día se vea como una
		// agenda cronológica, sin importar en qué orden exacto soltó el usuario la tarjeta.
		grid[pIdx][dIdx] = [...items].sort((a, b) => horaPseudo(a.id) - horaPseudo(b.id));
	}

	async function confirmarCambios() {
		guardando = true;
		errorGuardado = '';
		try {
			await onGuardarFechas(Array.from(cambios.values()).map((c) => ({ id: c.item.id, fechaNueva: c.fechaNueva })));
			cambios.clear();
		} catch (err: any) {
			errorGuardado = err?.message ?? 'No se pudieron guardar los cambios de fecha';
		} finally {
			guardando = false;
		}
	}
	function descartarCambios() {
		cambios.clear();
		errorGuardado = '';
		grid = computeGrid();
		gridVersion++;
	}

	function totalPanorama(p: CalendarPanorama<T>): number {
		return p.items.reduce((sum, i) => sum + i.monto, 0);
	}

	let colorCard = $derived(tipo === 'ingreso' ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200');
	let colorTexto = $derived(tipo === 'ingreso' ? 'text-emerald-700' : 'text-rose-700');
</script>

<div class="flex flex-col gap-4">
	<div class="flex flex-wrap items-center justify-between gap-3 bg-white rounded-xl border border-slate-200 p-3">
		<div class="flex items-center gap-2 text-sm">
			<button type="button" onclick={prev} class="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label={vista === 'semana' ? 'Semana anterior' : 'Mes anterior'}>
				<ChevronLeft size={16} />
			</button>
			<button type="button" onclick={next} class="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label={vista === 'semana' ? 'Semana siguiente' : 'Mes siguiente'}>
				<ChevronRight size={16} />
			</button>
			<button type="button" onclick={irAHoy} class="px-3 h-8 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50">Hoy</button>
			<span class="font-semibold text-slate-700 ml-2 capitalize">{rangoLabel}</span>
			<div class="flex rounded-lg border border-slate-200 overflow-hidden ml-1">
				<button type="button" onclick={() => cambiarVista('semana')} class={`px-3 h-8 text-xs font-medium ${vista === 'semana' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
					Semana
				</button>
				<button type="button" onclick={() => cambiarVista('mes')} class={`px-3 h-8 text-xs font-medium ${vista === 'mes' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
					Mes
				</button>
			</div>
		</div>

		{#if cambios.size > 0}
			<div class="flex items-center gap-2 text-sm">
				<span class="text-amber-600 font-medium">{cambios.size} fecha{cambios.size === 1 ? '' : 's'} sin guardar</span>
				{#if errorGuardado}<span class="text-red-600 text-xs">{errorGuardado}</span>{/if}
				<button type="button" onclick={descartarCambios} disabled={guardando} class="px-3 h-8 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 disabled:opacity-50">
					Descartar
				</button>
				<button type="button" onclick={confirmarCambios} disabled={guardando} class="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60">
					{#if guardando}<Loader2 size={14} class="animate-spin" />{/if} Confirmar cambios
				</button>
			</div>
		{/if}
	</div>

	{#each panoramas as panorama, pIdx (panorama.id)}
		<div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
			<div class="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
				<h3 class="font-bold text-slate-800 text-sm">{panorama.nombre} – {panorama.subtitulo}</h3>
				<span class="ml-auto text-xs text-slate-400">{formatCurrency(totalPanorama(panorama))} · {panorama.items.length} cuota{panorama.items.length === 1 ? '' : 's'}</span>
			</div>

			{#if vista === 'mes'}
				<div class="grid grid-cols-7 divide-x divide-slate-100 border-b border-slate-100">
					{#each DIAS as d}
						<div class="px-2 py-1.5 text-center"><p class="text-[10px] font-bold text-slate-400 uppercase">{d}</p></div>
					{/each}
				</div>
			{/if}

			<div class={vista === 'semana' ? 'grid grid-cols-7 divide-x divide-slate-100' : 'grid grid-cols-7 divide-x divide-y divide-slate-100'}>
				{#each visibleDays as day, dIdx}
					{@const esHoy = day === toISO(new Date())}
					{@const enMesActual = vista === 'semana' || new Date(day).getMonth() === cursor.getMonth()}
					<div class={`flex flex-col ${vista === 'mes' && !enMesActual ? 'opacity-40' : ''}`}>
						{#if vista === 'semana'}
							<div class={`px-2 py-2 text-center border-b border-slate-100 ${esHoy ? 'bg-blue-50' : ''}`}>
								<p class="text-[11px] font-bold text-slate-500 uppercase">{DIAS[dIdx]} {Number(day.slice(8, 10))}</p>
							</div>
						{:else}
							<div class={`px-1.5 pt-1 ${esHoy ? 'bg-blue-50' : ''}`}>
								<p class="text-[10px] font-semibold text-slate-500">{Number(day.slice(8, 10))}</p>
							</div>
						{/if}
						{#key `${panorama.id}-${dIdx}-${gridVersion}-${vista}`}
							<div
								use:dndzone={{ items: grid[pIdx]?.[dIdx] ?? [], flipDurationMs: FLIP_MS, type: `cal-panorama-${panorama.id}` }}
								onconsider={(e) => handleConsider(pIdx, dIdx, e)}
								onfinalize={(e) => handleFinalize(pIdx, dIdx, e)}
								class={vista === 'semana' ? 'flex-1 flex flex-col gap-1.5 p-1.5 min-h-[130px]' : 'flex-1 flex flex-col gap-1 p-1 min-h-[64px] max-h-[130px] overflow-y-auto'}
							>
								{#each grid[pIdx]?.[dIdx] ?? [] as item (item.id)}
									<div class={`rounded-lg border cursor-grab active:cursor-grabbing shadow-sm ${colorCard} ${vista === 'semana' ? 'px-2 py-1.5 text-[11px] leading-tight' : 'px-1.5 py-1 text-[9.5px] leading-tight'}`}>
										{#if vista === 'semana'}
											<p class={`font-bold ${colorTexto}`}>{fmtHora(horaPseudo(item.id))}</p>
										{/if}
										<div class="flex items-start gap-1">
											<button
												type="button"
												onclick={(e) => { e.stopPropagation(); onAbrirCuotas(item); }}
												class="shrink-0 p-0.5 -m-0.5 text-slate-400 hover:text-slate-700"
												title="Ver/editar cuotas de esta cuenta"
												aria-label="Ver/editar cuotas de esta cuenta"
											>
												{#if cuotasCargandoId === item.id}
													<Loader2 size={vista === 'semana' ? 11 : 9} class="animate-spin" />
												{:else}
													<GripVertical size={vista === 'semana' ? 11 : 9} />
												{/if}
											</button>
											<p class="font-semibold text-slate-700 truncate flex-1">{item.titulo}</p>
										</div>
										{#if vista === 'semana'}
											<p class="text-slate-400 truncate">{subtituloDe(item)}</p>
											{#if detalleDe?.(item)}<p class="text-slate-400 truncate">{detalleDe(item)}</p>{/if}
										{/if}
										<p class={`font-bold ${colorTexto}`}>{formatCurrency(item.monto)}</p>
									</div>
								{/each}
							</div>
						{/key}
					</div>
				{/each}
			</div>
		</div>
	{/each}

	<p class="text-[11px] text-slate-400 px-1">
		Mostrando cuotas con vencimiento entre {rangoLabel}. Arrastra una cuota a otro día dentro de su mismo panorama para reprogramarla y confirma para guardar.
	</p>
</div>
