<script lang="ts">
	// Vista alternativa (tab "Calendario") para /finanzas/tranzacciones — muestra las transacciones
	// YA REGISTRADAS (ingreso/egreso/financiamiento reales, tabla `transaccion`) distribuidas por
	// fecha, con el mismo look & feel y el mismo mecanismo de arrastre + confirmar que el calendario
	// de Panoramas de Cobro/Pago (ver PanoramaCalendarView.svelte): arrastrar una tarjeta a otro día
	// solo la reprograma localmente (staged) hasta que el usuario pulsa "Confirmar cambios" — recién
	// ahí se persiste la nueva `fecha` en la BD (ver onGuardarFechas).
	import { dndzone } from 'svelte-dnd-action';
	import { formatCurrency } from '$lib/shared/fieldConfig';
	import { ChevronLeft, ChevronRight, Loader2 } from '@lucide/svelte';
	import type { Transaccion } from '$lib/modules/transacciones/services/transacciones.service';

	const {
		transacciones,
		onVer,
		onGuardarFechas
	}: {
		transacciones: Transaccion[];
		onVer?: (t: Transaccion) => void;
		onGuardarFechas: (cambios: { id: number; fechaNueva: string }[]) => Promise<void>;
	} = $props();

	const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
	const FLIP_MS = 150;
	// Mismos colores que el calendario de Panoramas de Cobro/Pago (verde=ingreso, rojo=egreso) para
	// que ambas vistas se vean consistentes — financiamiento no existe ahí, se deja en violeta.
	const TIPO_BADGE_CLASS: Record<string, string> = {
		ingreso: 'bg-emerald-50 text-emerald-700 border-emerald-200',
		egreso: 'bg-rose-50 text-rose-700 border-rose-200',
		financiamiento: 'bg-violet-50 text-violet-700 border-violet-200'
	};
	const TIPO_TEXT_CLASS: Record<string, string> = {
		ingreso: 'text-emerald-700',
		egreso: 'text-rose-700',
		financiamiento: 'text-violet-700'
	};
	const TIPO_DOT_CLASS: Record<string, string> = {
		ingreso: 'bg-emerald-500',
		egreso: 'bg-rose-500',
		financiamiento: 'bg-violet-500'
	};
	const TIPO_LABEL: Record<string, string> = { ingreso: 'Ingreso', egreso: 'Egreso', financiamiento: 'Financiamiento' };

	/** Ingreso y financiamiento suman al saldo; egreso resta — mismo criterio que movimientosCaja.service.ts. */
	function signo(tipo: string | null, monto: number): number {
		return tipo === 'egreso' ? -monto : monto;
	}

	// Igual que en PanoramaCalendarView: no hay hora real registrada para una transacción (solo
	// fecha), así que se muestra una hora "pseudo" determinística por id, solo cosmética, para que
	// las tarjetas de la vista semana se vean como una agenda (mismo criterio visual que Panoramas).
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
		const day = d.getDay();
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
	let cursor = $state(hoyMedianoche());

	let weekStart = $derived(startOfWeek(cursor));
	let weekDays = $derived(Array.from({ length: 7 }, (_, i) => toISO(addDays(weekStart, i))));
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

	// Estado local (staged): grid[diaIndex] = transacciones clonadas de ese día. Se construye una vez
	// al montar y se reconstruye explícitamente solo al cambiar de semana/mes/vista o al descartar
	// cambios — nunca dentro de un $effect (ver nota extensa sobre esto en PanoramaCalendarView.svelte:
	// leer una prop que el padre recrea en cada render y escribir un $state en el mismo efecto entra
	// en un ciclo infinito).
	/** svelte-dnd-action exige que cada ítem tenga una propiedad `id` (no `id_transaccion`) — mismo
	 * alias que ya se usa en Panoramas (ver IngresoPendienteItem/PagoPendienteItem). */
	type TransaccionArrastrable = Transaccion & { id: number };

	function computeGrid(): TransaccionArrastrable[][] {
		const days = visibleDays;
		return days.map((day) =>
			transacciones
				.filter((t) => t.fecha === day)
				.map((t) => ({ ...t, id: t.id_transaccion }))
				.sort((a, b) => horaPseudo(a.id_transaccion) - horaPseudo(b.id_transaccion))
		);
	}

	let grid = $state<TransaccionArrastrable[][]>(computeGrid());
	let gridVersion = $state(0);
	/** id -> {item, fechaAnterior, fechaNueva}: cambios de fecha arrastrados pero aún sin confirmar. */
	let cambios = $state(new Map<number, { item: TransaccionArrastrable; fechaAnterior: string; fechaNueva: string }>());
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

	function handleConsider(dIdx: number, e: CustomEvent<{ items: TransaccionArrastrable[] }>) {
		grid[dIdx] = e.detail.items;
	}
	function handleFinalize(dIdx: number, e: CustomEvent<{ items: TransaccionArrastrable[] }>) {
		const dayISO = visibleDays[dIdx];
		const items = e.detail.items;
		for (const it of items) {
			if (it.fecha !== dayISO) {
				const previo = cambios.get(it.id_transaccion);
				cambios.set(it.id_transaccion, { item: it, fechaAnterior: previo ? previo.fechaAnterior : it.fecha, fechaNueva: dayISO });
				it.fecha = dayISO;
			}
		}
		grid[dIdx] = [...items].sort((a, b) => horaPseudo(a.id_transaccion) - horaPseudo(b.id_transaccion));
	}

	async function confirmarCambios() {
		guardando = true;
		errorGuardado = '';
		try {
			await onGuardarFechas(Array.from(cambios.values()).map((c) => ({ id: c.item.id_transaccion, fechaNueva: c.fechaNueva })));
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

	function totalPorTipo(lista: Transaccion[], tipo: string): number {
		return lista.filter((t) => t.tipo === tipo).reduce((s, t) => s + Number(t.monto_total), 0);
	}
	let visibles = $derived(grid.flat());
	let ingresosVisibles = $derived(totalPorTipo(visibles, 'ingreso'));
	let egresosVisibles = $derived(totalPorTipo(visibles, 'egreso'));
	let financiamientoVisible = $derived(totalPorTipo(visibles, 'financiamiento'));
	let saldoNetoVisible = $derived(visibles.reduce((s, t) => s + signo(t.tipo, Number(t.monto_total)), 0));
</script>

<div class="flex flex-col gap-4">
	<!-- KPIs + navegación -->
	<div class="flex flex-wrap items-center justify-between gap-3 bg-white rounded-xl border border-slate-200 p-4">
		<div class="flex flex-wrap items-center gap-6">
			<div class="flex items-center gap-2">
				<span class="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0"></span>
				<div>
					<p class="text-xs text-slate-400">Ingresos</p>
					<p class="text-sm font-bold text-slate-800">{formatCurrency(ingresosVisibles)}</p>
				</div>
			</div>
			<div class="flex items-center gap-2">
				<span class="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0"></span>
				<div>
					<p class="text-xs text-slate-400">Egresos</p>
					<p class="text-sm font-bold text-slate-800">{formatCurrency(egresosVisibles)}</p>
				</div>
			</div>
			<div class="flex items-center gap-2">
				<span class="w-2.5 h-2.5 rounded-full bg-violet-500 shrink-0"></span>
				<div>
					<p class="text-xs text-slate-400">Financiamiento</p>
					<p class="text-sm font-bold text-slate-800">{formatCurrency(financiamientoVisible)}</p>
				</div>
			</div>
			<div>
				<p class="text-xs text-slate-400">Saldo neto</p>
				<p class="text-base font-bold {saldoNetoVisible >= 0 ? 'text-emerald-700' : 'text-rose-700'}">{formatCurrency(saldoNetoVisible)}</p>
			</div>
		</div>

		<div class="flex items-center gap-2 text-sm">
			<button type="button" onclick={prev} class="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label={vista === 'mes' ? 'Mes anterior' : 'Semana anterior'}>
				<ChevronLeft size={16} />
			</button>
			<button type="button" onclick={next} class="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label={vista === 'mes' ? 'Mes siguiente' : 'Semana siguiente'}>
				<ChevronRight size={16} />
			</button>
			<button type="button" onclick={irAHoy} class="px-3 h-8 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50">Hoy</button>
			<span class="mx-1 text-slate-300">|</span>
			<div class="flex rounded-lg border border-slate-200 overflow-hidden">
				<button type="button" onclick={() => cambiarVista('semana')} class="px-3 h-8 font-medium {vista === 'semana' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}">Semana</button>
				<button type="button" onclick={() => cambiarVista('mes')} class="px-3 h-8 font-medium {vista === 'mes' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}">Mes</button>
			</div>
		</div>
	</div>

	{#if cambios.size > 0}
		<div class="flex items-center gap-2 text-sm bg-white rounded-xl border border-slate-200 px-4 py-2.5">
			<span class="text-amber-600 font-medium">{cambios.size} fecha{cambios.size === 1 ? '' : 's'} sin guardar</span>
			{#if errorGuardado}<span class="text-red-600 text-xs">{errorGuardado}</span>{/if}
			<div class="ml-auto flex items-center gap-2">
				<button type="button" onclick={descartarCambios} disabled={guardando} class="px-3 h-8 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 disabled:opacity-50">
					Descartar
				</button>
				<button type="button" onclick={confirmarCambios} disabled={guardando} class="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60">
					{#if guardando}<Loader2 size={14} class="animate-spin" />{/if} Confirmar cambios
				</button>
			</div>
		</div>
	{/if}

	<div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
		<div class="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
			<h3 class="font-bold text-slate-800 text-sm capitalize">{rangoLabel}</h3>
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
					{#key `${dIdx}-${gridVersion}-${vista}`}
						<div
							use:dndzone={{ items: grid[dIdx] ?? [], flipDurationMs: FLIP_MS, type: 'cal-transacciones' }}
							onconsider={(e) => handleConsider(dIdx, e)}
							onfinalize={(e) => handleFinalize(dIdx, e)}
							class={vista === 'semana' ? 'flex-1 flex flex-col gap-1.5 p-1.5 min-h-[130px]' : 'flex-1 flex flex-col gap-1 p-1 min-h-[64px] max-h-[130px] overflow-y-auto'}
						>
							{#each grid[dIdx] ?? [] as t (t.id_transaccion)}
								<button
									type="button"
									onclick={() => onVer?.(t)}
									class={`rounded-lg border cursor-grab active:cursor-grabbing shadow-sm text-left ${TIPO_BADGE_CLASS[t.tipo ?? ''] ?? 'bg-slate-50 border-slate-200'} ${vista === 'semana' ? 'px-2 py-1.5 text-[11px] leading-tight' : 'px-1.5 py-1 text-[9.5px] leading-tight'}`}
								>
									{#if vista === 'semana'}
										<p class={`font-bold ${TIPO_TEXT_CLASS[t.tipo ?? ''] ?? 'text-slate-600'}`}>{fmtHora(horaPseudo(t.id_transaccion))}</p>
									{/if}
									<p class="flex items-center gap-1 font-semibold text-slate-700 truncate">
										<span class={`w-1.5 h-1.5 rounded-full shrink-0 ${TIPO_DOT_CLASS[t.tipo ?? ''] ?? 'bg-slate-400'}`}></span>
										{t.descripcion || t.num_documento || `#${t.id_transaccion}`}
									</p>
									{#if vista === 'semana'}
										<p class="text-slate-400 truncate">{TIPO_LABEL[t.tipo ?? ''] ?? t.tipo}</p>
									{/if}
									<p class={`font-bold ${TIPO_TEXT_CLASS[t.tipo ?? ''] ?? 'text-slate-700'}`}>{formatCurrency(t.monto_total)}</p>
								</button>
							{/each}
						</div>
					{/key}
				</div>
			{/each}
		</div>
	</div>

	<p class="text-[11px] text-slate-400 px-1">
		Arrastra una transacción a otro día para reprogramarla y confirma los cambios para guardar la nueva fecha. Clic en una tarjeta abre esa transacción.
	</p>
</div>
