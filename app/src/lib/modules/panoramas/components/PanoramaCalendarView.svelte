<script module lang="ts">
	export interface CalendarPanorama<T> {
		id: 0 | 1 | 2;
		nombre: string;
		subtitulo: string;
		items: T[];
		/** 'actual' (Panorama 0): arrastrar reprograma DE INMEDIATO al confirmar, igual que antes.
		 * 'escenario' (P1/P2): arrastrar solo propone un cambio local (de sesión, no se guarda solo) —
		 * recién se escribe en la BD cuando el usuario pulsa "Establecer como panorama actual". */
		modo: 'actual' | 'escenario';
	}
</script>

<script lang="ts" generics="T extends { id: number; titulo: string; monto: number; fechaVencimiento: string | null; pagado?: boolean }">
	// Vista "Calendario" (tab alterno al tablero Kanban) para los tableros de Panoramas de
	// Pago/Cobro. Muestra Panorama Actual (0), Panorama 1 y Panorama 2 como calendarios semanales
	// de "todo el día" (sin franja horaria: este ERP no registra hora de vencimiento, solo fecha) y
	// permite arrastrar una cuota a otro día DENTRO del mismo panorama para reprogramarla.
	//
	// Panorama Actual (modo 'actual') es el espejo del estado real: arrastrar + "Confirmar cambios"
	// escribe de inmediato en la BD (ver onGuardarFechas), igual que el comportamiento original de
	// este componente. Panorama 1/2 (modo 'escenario') son propuestas de sesión — arrastrar solo
	// mueve la tarjeta LOCALMENTE, nunca se guarda solo; recién al pulsar "Establecer como panorama
	// actual" (su versión de "confirmar", ver confirmarCambios) esas fechas propuestas se escriben
	// en la BD, y por lo tanto pasan a reflejarse en Panorama Actual. Los cambios pendientes se
	// llevan POR PANORAMA (cambiosPorPanorama, indexado como `grid` por pIdx) — nunca en un solo
	// Map compartido, para que confirmar/descartar en un panorama no toque a los otros dos.
	import { dndzone } from 'svelte-dnd-action';
	import { ChevronLeft, ChevronRight, GripVertical, Loader2, Lock, Copy } from '@lucide/svelte';
	import { formatCurrency } from '$lib/shared/fieldConfig';

	const {
		panoramas,
		tipo,
		subtituloDe,
		detalleDe,
		onAbrirCuotas,
		cuotasCargandoId = null,
		onGuardarFechas,
		onItemBloqueado,
		onCopiarAPanorama
	}: {
		panoramas: CalendarPanorama<T>[];
		tipo: 'ingreso' | 'egreso';
		subtituloDe: (item: T) => string;
		detalleDe?: (item: T) => string | null;
		onAbrirCuotas: (item: T) => void;
		cuotasCargandoId?: number | null;
		onGuardarFechas: (panoramaId: 0 | 1 | 2, cambios: { id: number; fechaNueva: string }[]) => Promise<void>;
		/** Se llama cuando el usuario intenta arrastrar un ítem con `pagado=true` a otra fecha — a
		 * pedido explícito del usuario, esas cuentas ya se ejecutaron (transacción de egreso real) y no
		 * se pueden reprogramar. El padre decide cómo avisar (ver toast.error en +page.svelte). */
		onItemBloqueado?: () => void;
		/** A pedido explícito del usuario: cada tarjeta del calendario ofrece "copiar" (no mover) a
		 * Panorama 1 o 2 — mismo mecanismo 100% de sesión que ya usa el Tablero Kanban
		 * (copiarItemAOtroPanorama en +page.svelte, nunca escribe en BD por sí solo). Se pasa el
		 * panorama DESTINO explícito (no "el otro") porque Panorama Actual (id 0) no tiene un único
		 * "otro" — puede copiarse a cualquiera de los dos. Si no se pasa, no se muestra el botón. */
		onCopiarAPanorama?: (item: T, destino: 1 | 2) => void;
	} = $props();

	const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
	const FLIP_MS = 150;

	// A pedido explícito del usuario: cada tarjeta debe mostrar nombre, fecha y monto — antes, en vez
	// de la fecha real, se mostraba (solo en vista semana) una hora "pseudo" inventada por id, puramente
	// cosmética (este ERP no registra hora de vencimiento, solo fecha) y sin ninguna relación con el
	// orden real de las cuentas, lo que hacía parecer que las tarjetas estaban "desordenadas". Se
	// reemplaza por la fecha real (fmtFechaCorta) en ambas vistas, y el orden pasa a ser alfabético por
	// nombre (ver el .sort() de computeGrid/handleFinalize) — estable y predecible, a diferencia de la
	// hora pseudo.
	function fmtFechaCorta(iso: string | null): string {
		if (!iso) return '—';
		const d = new Date(iso + 'T00:00:00');
		if (Number.isNaN(d.getTime())) return '—';
		return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
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
					.sort((a, b) => a.titulo.localeCompare(b.titulo))
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
	/** Un Map de cambios pendientes POR PANORAMA (índice = pIdx, igual que `grid`): id -> {item,
	 * fechaAnterior, fechaNueva}. Separado por panorama para que confirmar/descartar en uno no
	 * afecte a los otros dos — ver nota de arriba del archivo. */
	let cambiosPorPanorama = $state<Map<number, { item: T; fechaAnterior: string | null; fechaNueva: string }>[]>(
		panoramas.map(() => new Map())
	);
	let guardando = $state<boolean[]>(panoramas.map(() => false));
	let errorGuardado = $state<string[]>(panoramas.map(() => ''));

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
		const cambios = cambiosPorPanorama[pIdx];
		const permitidos: T[] = [];
		let huboBloqueo = false;
		for (const it of items) {
			if (it.fechaVencimiento === dayISO) {
				permitidos.push(it);
				continue;
			}
			// A pedido explícito del usuario: un pago ya ejecutado (con su transacción de egreso real)
			// no se puede reprogramar — se rechaza el drop y la tarjeta vuelve a su día original en vez
			// de aplicar el cambio de fecha.
			if (it.pagado) {
				huboBloqueo = true;
				const dOriginal = visibleDays.indexOf(it.fechaVencimiento ?? '');
				if (dOriginal !== -1) grid[pIdx][dOriginal] = [...(grid[pIdx][dOriginal] ?? []), it];
				continue;
			}
			const previo = cambios.get(it.id);
			cambios.set(it.id, { item: it, fechaAnterior: previo ? previo.fechaAnterior : it.fechaVencimiento, fechaNueva: dayISO });
			it.fechaVencimiento = dayISO;
			permitidos.push(it);
		}
		if (huboBloqueo) onItemBloqueado?.();
		// Reordena alfabéticamente por nombre (ver nota arriba) para que la columna del día quede en un
		// orden estable y predecible, sin importar en qué orden exacto soltó el usuario la tarjeta.
		grid[pIdx][dIdx] = [...permitidos].sort((a, b) => a.titulo.localeCompare(b.titulo));
	}

	async function confirmarCambios(pIdx: number) {
		guardando[pIdx] = true;
		errorGuardado[pIdx] = '';
		try {
			const panorama = panoramas[pIdx];
			const cambios = cambiosPorPanorama[pIdx];
			await onGuardarFechas(panorama.id, Array.from(cambios.values()).map((c) => ({ id: c.item.id, fechaNueva: c.fechaNueva })));
			cambios.clear();
		} catch (err: any) {
			errorGuardado[pIdx] = err?.message ?? 'No se pudieron guardar los cambios de fecha';
		} finally {
			guardando[pIdx] = false;
		}
	}
	function descartarCambios(pIdx: number) {
		cambiosPorPanorama[pIdx].clear();
		errorGuardado[pIdx] = '';
		grid[pIdx] = computeGrid()[pIdx];
		gridVersion++;
	}

	function totalPanorama(p: CalendarPanorama<T>): number {
		return p.items.reduce((sum, i) => sum + i.monto, 0);
	}

	let colorCard = $derived(tipo === 'ingreso' ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200');
	let colorTexto = $derived(tipo === 'ingreso' ? 'text-emerald-700' : 'text-rose-700');
</script>

<div class="flex flex-col gap-4">
	<div class="flex flex-wrap items-center gap-3 bg-white rounded-xl border border-slate-200 p-3">
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
	</div>

	{#each panoramas as panorama, pIdx (panorama.id)}
		{@const cambios = cambiosPorPanorama[pIdx]}
		<div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
			<div class="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-100">
				<h3 class="font-bold text-slate-800 text-sm">{panorama.nombre} – {panorama.subtitulo}</h3>
				<span class="text-xs text-slate-400">{formatCurrency(totalPanorama(panorama))} · {panorama.items.length} cuota{panorama.items.length === 1 ? '' : 's'}</span>

				{#if cambios?.size > 0}
					<div class="ml-auto flex items-center gap-2 text-sm">
						<span class="text-amber-600 font-medium">
							{cambios.size} {panorama.modo === 'actual' ? 'fecha' : 'cambio propuesto'}{cambios.size === 1 ? '' : 's'}{panorama.modo === 'actual' ? ' sin guardar' : ''}
						</span>
						{#if errorGuardado[pIdx]}<span class="text-red-600 text-xs">{errorGuardado[pIdx]}</span>{/if}
						<button type="button" onclick={() => descartarCambios(pIdx)} disabled={guardando[pIdx]} class="px-3 h-8 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 disabled:opacity-50">
							{panorama.modo === 'actual' ? 'Descartar' : 'Descartar propuesta'}
						</button>
						<button
							type="button"
							onclick={() => confirmarCambios(pIdx)}
							disabled={guardando[pIdx]}
							class={`flex items-center gap-1.5 px-3 h-8 rounded-lg text-white font-medium disabled:opacity-60 ${panorama.modo === 'actual' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-amber-500 hover:bg-amber-600'}`}
						>
							{#if guardando[pIdx]}<Loader2 size={14} class="animate-spin" />{/if}
							{panorama.modo === 'actual' ? 'Confirmar cambios' : 'Establecer como panorama actual'}
						</button>
					</div>
				{/if}
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
									<div
										class={`rounded-lg border shadow-sm ${item.pagado ? 'bg-slate-100 border-slate-200 opacity-70 cursor-not-allowed' : `cursor-grab active:cursor-grabbing ${colorCard}`} ${vista === 'semana' ? 'px-2 py-1.5 text-[11px] leading-tight' : 'px-1.5 py-1 text-[9.5px] leading-tight'}`}
										title={item.pagado ? 'Este pago ya se realizó — no se puede reprogramar.' : ''}
									>
										<p class={`font-bold flex items-center gap-1 ${item.pagado ? 'text-slate-400' : colorTexto}`}>
											{#if item.pagado}<Lock size={10} />{/if}
											{fmtFechaCorta(item.fechaVencimiento)}
										</p>
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
											{#if onCopiarAPanorama && !item.pagado}
												{#if panorama.id === 0}
													<div class="flex gap-0.5 shrink-0">
														<button type="button" onclick={(e) => { e.stopPropagation(); onCopiarAPanorama(item, 1); }} title="Copiar a Panorama 1" aria-label="Copiar a Panorama 1" class="px-1 rounded text-[8px] font-bold bg-blue-50 text-blue-600 hover:bg-blue-100">P1</button>
														<button type="button" onclick={(e) => { e.stopPropagation(); onCopiarAPanorama(item, 2); }} title="Copiar a Panorama 2" aria-label="Copiar a Panorama 2" class="px-1 rounded text-[8px] font-bold bg-emerald-50 text-emerald-600 hover:bg-emerald-100">P2</button>
													</div>
												{:else}
													<button
														type="button"
														onclick={(e) => { e.stopPropagation(); onCopiarAPanorama(item, panorama.id === 1 ? 2 : 1); }}
														class="shrink-0 p-0.5 -m-0.5 text-slate-400 hover:text-slate-700"
														title={`Copiar a Panorama ${panorama.id === 1 ? 2 : 1}`}
														aria-label={`Copiar a Panorama ${panorama.id === 1 ? 2 : 1}`}
													>
														<Copy size={vista === 'semana' ? 11 : 9} />
													</button>
												{/if}
											{/if}
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
		Mostrando cuotas programadas entre {rangoLabel}. <strong>Panorama Actual</strong> es el estado real de la cartera — arrastra y confirma para reprogramar de inmediato.
		En <strong>Panorama 1</strong> y <strong>Panorama 2</strong>, arrastrar solo propone un cambio (no se guarda solo) — usa "Establecer como panorama actual" para volverlo real.
	</p>
</div>
