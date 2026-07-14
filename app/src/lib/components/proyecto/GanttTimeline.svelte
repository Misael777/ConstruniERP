<script lang="ts">
	// Custom Gantt timeline — replaces the svelte-gantt library. See the
	// reconstruction checklist at the top of ganttPlanning.service.ts before
	// changing hierarchy/rollup/block-move behavior here.
	import { buildTree, type WithChildren } from '$lib/utils/tree';
	import {
		computeRollup,
		computeProgress,
		colorForNode,
		type PlanningActividad,
		type PlanningDependencia,
	} from '$lib/modules/gantt-planning/services/ganttPlanning.service';

	type TimelineActividad = PlanningActividad & {
		nombre_actividad: string;
		orden: number | null;
		color: string | null;
		partida?: { codigo: string } | null;
	};

	let {
		actividades,
		dependencias,
		restriccionesAbiertasPorActividad,
		timelineStart,
		timelineEnd,
		showAvanceReal = true,
		showDeps = true,
		tolerancia = 0,
		selectedId = $bindable<number | null>(null),
		onLeafChange,
		onBlockMove,
		onWarning,
	}: {
		actividades: TimelineActividad[];
		dependencias: PlanningDependencia[];
		restriccionesAbiertasPorActividad: Map<number, any[]>;
		timelineStart: Date;
		timelineEnd: Date;
		showAvanceReal?: boolean;
		showDeps?: boolean;
		tolerancia?: number;
		selectedId?: number | null;
		onLeafChange: (id: number, inicio: string, fin: string) => void;
		onBlockMove: (rootId: number, deltaDays: number) => void;
		onWarning?: (messages: string[]) => void;
	} = $props();

	const DAY_MS = 864e5;
	const ROW_H = 34;
	const HEADER_H = 46;

	// Zoom/scroll are local, un-derived state — they must NOT reset when
	// `actividades` changes (draft edits, reloads). This is what satisfies
	// "view-state preservation across re-renders" without extra plumbing:
	// as long as this component stays mounted and rows are keyed, the
	// browser keeps scroll position for free.
	let pixelsPerDay = $state(28);
	let scrollEl: HTMLDivElement | null = $state(null);

	function zoomIn() { pixelsPerDay = Math.min(80, pixelsPerDay + 6); }
	function zoomOut() { pixelsPerDay = Math.max(10, pixelsPerDay - 6); }

	function addDaysISO(iso: string, n: number): string {
		const d = new Date(iso + 'T00:00:00');
		d.setDate(d.getDate() + n);
		return d.toISOString().slice(0, 10);
	}

	let totalDays = $derived(Math.max(1, Math.round((+timelineEnd - +timelineStart) / DAY_MS)));
	let totalWidth = $derived(totalDays * pixelsPerDay);

	function dateToX(iso: string): number {
		const days = (+new Date(iso + 'T00:00:00') - +timelineStart) / DAY_MS;
		return days * pixelsPerDay;
	}

	function xToDateISO(x: number): string {
		const days = Math.round(x / pixelsPerDay);
		const d = new Date(+timelineStart + days * DAY_MS);
		return d.toISOString().slice(0, 10);
	}

	// The scrollable timeline canvas — pointer x is measured relative to this
	// element (not clientX directly) so create-drag math stays correct
	// regardless of horizontal scroll position.
	let canvasEl: HTMLDivElement | null = $state(null);
	function clientXToCanvasX(clientX: number): number {
		if (!canvasEl) return 0;
		return clientX - canvasEl.getBoundingClientRect().left;
	}

	let tree = $derived(buildTree(actividades, 'id_cronograma_actividad', 'id_actividad_padre'));
	let rollup = $derived(computeRollup(tree));
	let progress = $derived(computeProgress(tree));

	type FlatRow = {
		node: WithChildren<TimelineActividad>;
		depth: number;
		rootId: number;
		isGroup: boolean;
		bar: { inicio: string; fin: string; avance: number } | null;
	};

	let flatRows = $derived.by((): FlatRow[] => {
		const out: FlatRow[] = [];
		function visit(nodes: WithChildren<TimelineActividad>[], depth: number, rootId: number) {
			const sorted = [...nodes].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
			for (const n of sorted) {
				const isGroup = n.children.length > 0;
				const r = rollup.get(n.id_cronograma_actividad) ?? {
					inicio: n.fecha_inicio_plan,
					fin: n.fecha_fin_plan,
				};
				const avance = progress.get(n.id_cronograma_actividad) ?? n.porcentaje_avance_real ?? 0;
				const thisRoot = depth === 0 ? n.id_cronograma_actividad : rootId;
				out.push({
					node: n,
					depth,
					rootId: thisRoot,
					isGroup,
					bar: r.inicio && r.fin ? { inicio: r.inicio, fin: r.fin, avance } : null,
				});
				visit(n.children, depth + 1, thisRoot);
			}
		}
		visit(tree, 0, 0);
		return out;
	});

	let rowIndexById = $derived(new Map(flatRows.map((r, i) => [r.node.id_cronograma_actividad, i])));

	// ── TODAY MARKER (recomputed at local midnight) ─────────────────────────
	let now = $state(new Date());
	$effect(() => {
		function scheduleMidnight(): ReturnType<typeof setTimeout> {
			const next = new Date();
			next.setHours(24, 0, 5, 0);
			return setTimeout(() => {
				now = new Date();
				scheduleMidnight();
			}, +next - Date.now());
		}
		const t = scheduleMidnight();
		return () => clearTimeout(t);
	});
	let todayX = $derived.by(() => {
		const d = new Date(now);
		d.setHours(0, 0, 0, 0);
		return ((+d - +timelineStart) / DAY_MS) * pixelsPerDay;
	});

	function isAtrasada(bar: { inicio: string; fin: string; avance: number }): boolean {
		const today = new Date(now);
		today.setHours(0, 0, 0, 0);
		if (bar.avance >= 100) return false;
		return new Date(bar.fin) < today && bar.avance < 100 - tolerancia;
	}

	// ── DEPENDENCY ARROWS (render-only — creation stays on the existing
	//    "Depende de…" dropdown in GanttTab, see plan) ─────────────────────
	let depLines = $derived.by(() => {
		if (!showDeps) return [] as { id: number; d: string }[];
		const lines: { id: number; d: string }[] = [];
		for (const dep of dependencias) {
			const oi = rowIndexById.get(dep.id_actividad_origen);
			const di = rowIndexById.get(dep.id_actividad_destino);
			if (oi === undefined || di === undefined) continue;
			const oRow = flatRows[oi];
			const dRow = flatRows[di];
			if (!oRow.bar || !dRow.bar) continue;
			const x1 = dateToX(oRow.bar.fin) + pixelsPerDay;
			const y1 = HEADER_H + oi * ROW_H + ROW_H / 2;
			const x2 = dateToX(dRow.bar.inicio);
			const y2 = HEADER_H + di * ROW_H + ROW_H / 2;
			const midX = x1 + Math.max(10, (x2 - x1) / 2);
			const path = `M ${x1},${y1} H ${midX} V ${y2} H ${x2}`;
			lines.push({ id: dep.id_dependencia ?? oi * 100000 + di, d: path });
		}
		return lines;
	});

	// ── HEADER (month + day columns) ─────────────────────────────────────────
	let dayHeaders = $derived.by(() => {
		const out: { x: number; label: string; isWeekend: boolean }[] = [];
		for (let i = 0; i < totalDays; i++) {
			const d = new Date(+timelineStart + i * DAY_MS);
			out.push({ x: i * pixelsPerDay, label: String(d.getDate()), isWeekend: d.getDay() === 0 || d.getDay() === 6 });
		}
		return out;
	});
	let monthHeaders = $derived.by(() => {
		const out: { x: number; width: number; label: string }[] = [];
		let cursor = new Date(timelineStart);
		let x = 0;
		while (x < totalWidth) {
			const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
			const nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
			const daysInView = Math.min(
				(+nextMonth - Math.max(+monthStart, +timelineStart)) / DAY_MS,
				totalDays - x / pixelsPerDay
			);
			const width = Math.max(0, daysInView) * pixelsPerDay;
			out.push({
				x,
				width,
				label: cursor.toLocaleDateString('es-PE', { month: 'long', year: 'numeric' }),
			});
			x += width;
			cursor = nextMonth;
			if (width <= 0) break;
		}
		return out;
	});

	// ── DRAG: move whole bar (block move if it has children) ────────────────
	type DragState = { id: number; isGroup: boolean; pointerId: number; startX: number; deltaDays: number };
	let drag = $state<DragState | null>(null);

	function onBarPointerDown(e: PointerEvent, row: FlatRow) {
		if (e.button !== 0) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		drag = { id: row.node.id_cronograma_actividad, isGroup: row.isGroup, pointerId: e.pointerId, startX: e.clientX, deltaDays: 0 };
		e.stopPropagation();
	}
	function onBarPointerMove(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointerId) return;
		drag.deltaDays = Math.round((e.clientX - drag.startX) / pixelsPerDay);
	}
	function onBarPointerUp(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointerId) return;
		const { id, isGroup, deltaDays } = drag;
		drag = null;
		if (deltaDays === 0) {
			selectedId = id;
			return;
		}
		if (isGroup) {
			onBlockMove(id, deltaDays);
		} else {
			const row = flatRows[rowIndexById.get(id) ?? -1];
			if (row?.bar) onLeafChange(id, addDaysISO(row.bar.inicio, deltaDays), addDaysISO(row.bar.fin, deltaDays));
		}
		selectedId = id;
	}

	// ── DRAG: resize leaf edges ───────────────────────────────────────────────
	type ResizeState = { id: number; edge: 'left' | 'right'; pointerId: number; startX: number; deltaDays: number; origInicio: string; origFin: string };
	let resize = $state<ResizeState | null>(null);

	function onResizePointerDown(e: PointerEvent, row: FlatRow, edge: 'left' | 'right') {
		if (e.button !== 0 || !row.bar) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		resize = { id: row.node.id_cronograma_actividad, edge, pointerId: e.pointerId, startX: e.clientX, deltaDays: 0, origInicio: row.bar.inicio, origFin: row.bar.fin };
		e.stopPropagation();
	}
	function onResizePointerMove(e: PointerEvent) {
		if (!resize || e.pointerId !== resize.pointerId) return;
		resize.deltaDays = Math.round((e.clientX - resize.startX) / pixelsPerDay);
	}
	function onResizePointerUp(e: PointerEvent) {
		if (!resize || e.pointerId !== resize.pointerId) return;
		const { id, edge, deltaDays, origInicio, origFin } = resize;
		resize = null;
		if (deltaDays === 0) return;
		let inicio = origInicio;
		let fin = origFin;
		if (edge === 'left') inicio = addDaysISO(origInicio, deltaDays);
		else fin = addDaysISO(origFin, deltaDays);
		if (new Date(fin) < new Date(inicio)) return; // ignore invalid ranges, matches setFechas guard
		onLeafChange(id, inicio, fin);
	}

	// ── DRAG-TO-CREATE: define fecha_inicio/fecha_fin for a leaf that doesn't
	//    have dates yet by dragging across its (empty) row ─────────────────────
	type CreateDragState = { id: number; pointerId: number; startX: number; currentX: number };
	let createDrag = $state<CreateDragState | null>(null);

	function onRowPointerDown(e: PointerEvent, row: FlatRow) {
		if (row.bar || row.isGroup) return; // only empty leaves are draggable-to-create
		if (e.button !== 0) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		const x = clientXToCanvasX(e.clientX);
		createDrag = { id: row.node.id_cronograma_actividad, pointerId: e.pointerId, startX: x, currentX: x };
	}
	function onRowPointerMove(e: PointerEvent) {
		if (!createDrag || e.pointerId !== createDrag.pointerId) return;
		createDrag.currentX = clientXToCanvasX(e.clientX);
	}
	function onRowPointerUp(e: PointerEvent) {
		if (!createDrag || e.pointerId !== createDrag.pointerId) return;
		const { id, startX, currentX } = createDrag;
		createDrag = null;
		const x1 = Math.min(startX, currentX);
		const x2 = Math.max(startX, currentX);
		if (x2 - x1 < pixelsPerDay * 0.4) {
			selectedId = id; // treat as a plain click, not a drag
			return;
		}
		const inicio = xToDateISO(x1);
		const fin = addDaysISO(xToDateISO(x2), -1); // x2 lands on the exclusive-end day boundary
		if (new Date(fin) < new Date(inicio)) return;
		onLeafChange(id, inicio, fin);
		selectedId = id;
	}

	function barVisualOffset(row: FlatRow): number {
		if (drag && drag.id === row.rootId) return drag.deltaDays * pixelsPerDay;
		if (drag && drag.isGroup) {
			// dragging a group root also visually previews all its descendants
			// (rigid block move) — check ancestry via rootId, computed above.
			const draggedRow = flatRows[rowIndexById.get(drag.id) ?? -1];
			if (draggedRow && row.rootId === draggedRow.rootId && drag.id !== row.node.id_cronograma_actividad) {
				return drag.deltaDays * pixelsPerDay;
			}
		}
		return 0;
	}
</script>

<div class="flex flex-col border border-slate-200 rounded-xl overflow-hidden bg-white">
	<!-- Zoom controls -->
	<div class="flex items-center gap-1.5 px-2 py-1 bg-slate-50 border-b border-slate-100 text-[10px]">
		<button class="w-5 h-5 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-500" onclick={zoomOut} title="Alejar">
			<i class="fas fa-minus"></i>
		</button>
		<button class="w-5 h-5 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-500" onclick={zoomIn} title="Acercar">
			<i class="fas fa-plus"></i>
		</button>
		<span class="text-slate-300">|</span>
		<button
			class="px-2 h-5 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-500 font-medium"
			onclick={() => { if (scrollEl) scrollEl.scrollLeft = Math.max(0, todayX - 150); }}
		>Hoy</button>
	</div>

	<div class="flex overflow-y-auto" style="max-height:calc(100vh - 330px)">
		<!-- LEFT: label column (scrolls vertically together with the timeline, see class on parent) -->
		<div class="border-r border-slate-200 bg-white" style="width:280px;flex-shrink:0">
			<div class="border-b border-slate-100 bg-slate-50" style="height:{HEADER_H}px"></div>
			{#each flatRows as row (row.node.id_cronograma_actividad)}
				{@const tieneRestriccion = restriccionesAbiertasPorActividad.has(row.node.id_cronograma_actividad)}
				<button
					class="w-full flex items-center gap-1 border-b border-slate-50 text-left text-xs hover:bg-slate-50 transition-colors"
					class:bg-orange-50={selectedId === row.node.id_cronograma_actividad}
					style="height:{ROW_H}px;padding-left:{10 + row.depth * 14}px"
					onclick={() => (selectedId = row.node.id_cronograma_actividad)}
				>
					{#if tieneRestriccion}<span class="text-amber-500 shrink-0">⚠</span>{/if}
					<span class="truncate {row.isGroup ? 'font-bold text-slate-700' : 'text-slate-600'}">
						{row.node.partida?.codigo ? `${row.node.partida.codigo} · ` : ''}{row.node.nombre_actividad}
					</span>
				</button>
			{/each}
		</div>

		<!-- RIGHT: scrollable timeline canvas -->
		<div class="flex-1 overflow-x-auto" bind:this={scrollEl}>
			<div class="relative" bind:this={canvasEl} style="width:{totalWidth}px;height:{HEADER_H + flatRows.length * ROW_H}px;min-width:100%">
				<!-- Month header -->
				<div class="sticky top-0 z-10 bg-slate-50 border-b border-slate-100" style="height:{HEADER_H / 2}px">
					{#each monthHeaders as m}
						<div class="absolute top-0 text-[10px] font-bold text-slate-500 capitalize px-1.5 border-l border-slate-100" style="left:{m.x}px;width:{m.width}px;line-height:{HEADER_H / 2}px">
							{m.label}
						</div>
					{/each}
				</div>
				<!-- Day header -->
				<div class="sticky bg-white border-b border-slate-200" style="top:{HEADER_H / 2}px;height:{HEADER_H / 2}px">
					{#each dayHeaders as d}
						<div
							class="absolute top-0 text-center text-[9px] {d.isWeekend ? 'text-slate-300 bg-slate-50' : 'text-slate-400'}"
							style="left:{d.x}px;width:{pixelsPerDay}px;line-height:{HEADER_H / 2}px"
						>{d.label}</div>
					{/each}
				</div>

				<!-- Row backgrounds — empty leaf rows (no dates yet) are drag-to-create
				     targets: drag across the row to set fecha_inicio/fecha_fin. -->
				{#each flatRows as row, i (row.node.id_cronograma_actividad)}
					{@const emptyLeaf = !row.bar && !row.isGroup}
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<div
						role={emptyLeaf ? 'button' : undefined}
						tabindex={emptyLeaf ? 0 : undefined}
						class="absolute left-0 border-b border-slate-50"
						class:bg-orange-50={selectedId === row.node.id_cronograma_actividad}
						class:bg-slate-50={row.isGroup && selectedId !== row.node.id_cronograma_actividad}
						class:cursor-crosshair={emptyLeaf}
						style="top:{HEADER_H + i * ROW_H}px;height:{ROW_H}px;width:{totalWidth}px"
						onpointerdown={emptyLeaf ? (e) => onRowPointerDown(e, row) : undefined}
						onpointermove={emptyLeaf ? onRowPointerMove : undefined}
						onpointerup={emptyLeaf ? onRowPointerUp : undefined}
					>
						{#if emptyLeaf}
							<div class="absolute inset-y-1 left-2 right-2 rounded border border-dashed border-slate-300 pointer-events-none"></div>
						{/if}
					</div>
				{/each}

				<!-- Create-drag live preview -->
				{#if createDrag}
					{@const ri = rowIndexById.get(createDrag.id) ?? 0}
					{@const cx1 = Math.min(createDrag.startX, createDrag.currentX)}
					{@const cx2 = Math.max(createDrag.startX, createDrag.currentX)}
					<div
						class="absolute rounded-md border-2 border-dashed border-orange-500 bg-orange-400/25 pointer-events-none z-10"
						style="top:{HEADER_H + ri * ROW_H + 4}px;left:{cx1}px;width:{Math.max(2, cx2 - cx1)}px;height:{ROW_H - 8}px"
					></div>
				{/if}

				<!-- Today marker -->
				{#if todayX >= 0 && todayX <= totalWidth}
					<div class="absolute top-0 bottom-0 w-px bg-rose-500 z-20 pointer-events-none" style="left:{todayX}px">
						<div class="absolute -top-0.5 -left-1 w-2.5 h-2.5 rounded-full bg-rose-500"></div>
					</div>
				{/if}

				<!-- Dependency arrows -->
				{#if showDeps}
					<svg class="absolute top-0 left-0 pointer-events-none" style="width:{totalWidth}px;height:{HEADER_H + flatRows.length * ROW_H}px">
						<defs>
							<marker id="gantt-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
								<path d="M0,0 L6,3 L0,6 Z" fill="#94a3b8" />
							</marker>
						</defs>
						{#each depLines as line (line.id)}
							<path d={line.d} fill="none" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#gantt-arrow)" />
						{/each}
					</svg>
				{/if}

				<!-- Bars -->
				{#each flatRows as row, i (row.node.id_cronograma_actividad)}
					{#if row.bar}
						{@const x = dateToX(row.bar.inicio) + barVisualOffset(row)}
						{@const w = Math.max(pixelsPerDay * 0.5, dateToX(addDaysISO(row.bar.fin, 1)) - dateToX(row.bar.inicio))}
						{@const atrasada = isAtrasada(row.bar)}
						{@const completada = row.bar.avance >= 100}
						{@const baseColor = row.node.color ?? colorForNode(row.rootId, row.depth)}
						<div
							role="button"
							tabindex="0"
							class="absolute rounded-md shadow-sm cursor-grab active:cursor-grabbing select-none flex items-center overflow-visible"
							class:ring-2={selectedId === row.node.id_cronograma_actividad}
							class:ring-slate-800={selectedId === row.node.id_cronograma_actividad}
							class:opacity-55={completada}
							style="top:{HEADER_H + i * ROW_H + 4}px;left:{x}px;width:{w}px;height:{ROW_H - 8}px;background:{atrasada ? '#e11d48' : baseColor}"
							title={restriccionesAbiertasPorActividad.get(row.node.id_cronograma_actividad)?.map((r: any) => r.descripcion || r.tipo_restriccion || 'Restricción').join(' · ') ?? ''}
							onpointerdown={(e) => onBarPointerDown(e, row)}
							onpointermove={onBarPointerMove}
							onpointerup={onBarPointerUp}
						>
							{#if showAvanceReal && row.bar.avance > 0}
								<div class="absolute inset-y-0 left-0 bg-black/25 rounded-l-md" style="width:{Math.min(100, row.bar.avance)}%"></div>
							{/if}
							{#if restriccionesAbiertasPorActividad.has(row.node.id_cronograma_actividad)}
								<span class="absolute -top-2 -right-2 w-3.5 h-3.5 rounded-full bg-amber-500 text-white text-[8px] flex items-center justify-center z-10">⚠</span>
							{/if}
							{#if !row.isGroup}
								<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
								<div
									class="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize"
									onpointerdown={(e) => onResizePointerDown(e, row, 'left')}
									onpointermove={onResizePointerMove}
									onpointerup={onResizePointerUp}
								></div>
								<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
								<div
									class="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize"
									onpointerdown={(e) => onResizePointerDown(e, row, 'right')}
									onpointermove={onResizePointerMove}
									onpointerup={onResizePointerUp}
								></div>
							{/if}
						</div>
					{/if}
				{/each}
			</div>
		</div>
	</div>
</div>
