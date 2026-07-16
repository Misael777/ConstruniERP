// ganttPlanning.service.ts
//
// Pure planning functions for the custom Gantt (GanttTimeline.svelte +
// GanttTab.svelte). Kept free of Svelte/DOM concerns so they're unit-testable
// and, if this app ever grows a real backend layer, portable to it unchanged
// — this module IS the "API contract": every write to cronograma_actividad
// funnels through commitDraft(), every read-side computation is one of the
// pure functions below.
//
// Agent reconstruction checklist (if this file or GanttTimeline.svelte is
// ever lost and needs to be rebuilt from scratch):
//  1. cronograma_actividad has nivel/id_actividad_padre/orden — hierarchy is
//     native to the table, do NOT reintroduce a separate tree table.
//  2. Build the tree with `buildTree` from $lib/utils/tree.ts — do not
//     reimplement flat→tree conversion again (3 duplicates already existed
//     before this rewrite; that was the bug this rewrite fixes).
//  3. A node with children is a rollup/summary row: its bar span comes from
//     computeRollup(), not its own fecha_inicio_plan/fecha_fin_plan (those
//     columns stay on the row but become vestigial once it has children).
//  4. A leaf node (no children) behaves like the pre-rewrite model: its own
//     fecha_inicio_plan/fecha_fin_plan are the source of truth and are
//     directly user-editable.
//  5. Progress aggregates the same way (computeProgress): duration-weighted
//     average of leaf descendants, never a manually-set parent value.
//  6. Dragging a bar with children performs a rigid block move
//     (computeBlockShift): every descendant leaf shifts by the identical
//     delta in days. This is what "preserves the relative pattern" — it's a
//     property of applying one uniform delta, not a separate validation step.
//  7. cronograma_dependencia (FS/SS/FF/SF + lag_dias) has NO "siblings only"
//     restriction by design decision — do not add one without checking with
//     the user first (explicitly declined once already).
//  8. resolveConstraints is a HARD solver, not advisory (this replaced an
//     earlier advisory-only design — checkBlockShiftDependencyWarnings/
//     checkRestrictionWarnings, deliberately removed). Explicit user request:
//     behave like a CAD constraint solver (Inventor/SolidWorks/MATLAB) — a
//     dependency/restricción's offset is a fixed distance, not a minimum: a
//     destino is ALWAYS exactly origen.fin + lag + 1 day, enforced in both
//     directions (a predecessor moving earlier pulls the destino back too,
//     not just forward), and regardless of whether the destino itself was
//     the one just dragged — dragging a constrained bar away from its
//     required position gets silently overridden back onto it; the only way
//     to change that distance is editing the edge's lag. If the constraint
//     graph has a cycle, resolveConstraints returns `ok:false` naming the
//     cycle and NOTHING is applied — never silently partial-apply a
//     resolution.
//  9. All schedule edits (drag/resize/block-move) mutate a local draft copy
//     in GanttTab.svelte's `$state`, never write to Supabase directly. Only
//     an explicit "Guardar cambios" action calls diffDraft()+commitDraft().
// 10. Structural CRUD (create/delete actividad, restriccion, dependencia)
//     stays immediate-write, consistent with the rest of this app — do not
//     fold those into the draft.
// 11. Dates are plain 'YYYY-MM-DD' strings throughout this module (lexical
//     comparison == chronological comparison) — don't switch to Date objects
//     inside these pure functions, only at the DOM/pixel-mapping boundary in
//     GanttTimeline.svelte.
// 12. Every date-math / block-move / rollup / draft-commit operation logs
//     through console.debug with the prefixes below — keep them when editing
//     so issues are greppable in the browser console.
//
// Logging prefixes: [GANTT_DATE_CALC] [GANTT_ROLLUP] [GANTT_BLOCK_MOVE] [GANTT_DRAFT] [GANTT_CONSTRAINT_SOLVE]

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildTree, flattenSubtree, type WithChildren } from '$lib/utils/tree';

export interface PlanningActividad {
	id_cronograma_actividad: number;
	id_actividad_padre: number | null;
	fecha_inicio_plan: string | null;
	fecha_fin_plan: string | null;
	porcentaje_avance_real: number;
}

export interface PlanningDependencia {
	id_dependencia?: number;
	id_actividad_origen: number;
	id_actividad_destino: number;
	tipo_dependencia: string;
	lag_dias: number;
}

export interface DraftDiff {
	id_cronograma_actividad: number;
	fecha_inicio_plan: string | null;
	fecha_fin_plan: string | null;
}

function addDaysISO(iso: string, n: number): string {
	const d = new Date(iso + 'T00:00:00');
	d.setDate(d.getDate() + n);
	const result = d.toISOString().slice(0, 10);
	console.debug('[GANTT_DATE_CALC] addDays', { iso, n, result });
	return result;
}

function durationDays(inicio: string | null, fin: string | null): number {
	if (!inicio || !fin) return 0;
	return Math.max(1, Math.round((+new Date(fin) - +new Date(inicio)) / 864e5) + 1);
}

// ── ROLLUP (bottom-up date range) ───────────────────────────────────────────
// A node with children reports the min(inicio)/max(fin) of its descendant
// leaves; a leaf reports its own stored dates. Returns a flat map so callers
// don't need to re-walk the tree.
export function computeRollup<T extends PlanningActividad>(
	roots: WithChildren<T>[]
): Map<number, { inicio: string | null; fin: string | null }> {
	const result = new Map<number, { inicio: string | null; fin: string | null }>();

	function visit(node: WithChildren<T>): { inicio: string | null; fin: string | null } {
		let computed: { inicio: string | null; fin: string | null };
		if (node.children.length === 0) {
			computed = { inicio: node.fecha_inicio_plan, fin: node.fecha_fin_plan };
		} else {
			let inicio: string | null = null;
			let fin: string | null = null;
			for (const child of node.children) {
				const r = visit(child);
				if (r.inicio && (!inicio || r.inicio < inicio)) inicio = r.inicio;
				if (r.fin && (!fin || r.fin > fin)) fin = r.fin;
			}
			computed = { inicio, fin };
		}
		result.set(node.id_cronograma_actividad, computed);
		console.debug('[GANTT_ROLLUP]', node.id_cronograma_actividad, computed);
		return computed;
	}

	for (const root of roots) visit(root);
	return result;
}

// ── PROGRESS (duration-weighted rollup) ─────────────────────────────────────
export function computeProgress<T extends PlanningActividad>(
	roots: WithChildren<T>[]
): Map<number, number> {
	const result = new Map<number, number>();

	function visit(node: WithChildren<T>): { avance: number; dur: number } {
		if (node.children.length === 0) {
			const avance = node.porcentaje_avance_real ?? 0;
			const dur = durationDays(node.fecha_inicio_plan, node.fecha_fin_plan);
			result.set(node.id_cronograma_actividad, avance);
			return { avance, dur };
		}
		let sumWeighted = 0;
		let sumDur = 0;
		for (const child of node.children) {
			const r = visit(child);
			sumWeighted += r.avance * r.dur;
			sumDur += r.dur;
		}
		const avance = sumDur > 0 ? sumWeighted / sumDur : 0;
		result.set(node.id_cronograma_actividad, avance);
		return { avance, dur: sumDur };
	}

	for (const root of roots) visit(root);
	return result;
}

// ── RIGID BLOCK MOVE ─────────────────────────────────────────────────────────
// Shifts rootId and every descendant leaf by the same deltaDays. Only nodes
// carrying their own stored dates are shifted (group/parent rows become
// vestigial once they have children — see checklist item 3 above), so this
// naturally only ever touches leaves, which is what "rigid" means here: every
// leaf keeps its offset relative to every other leaf in the block.
export function computeBlockShift<T extends PlanningActividad>(
	all: T[],
	rootId: number,
	deltaDays: number
): Map<number, { inicio: string; fin: string }> {
	const result = new Map<number, { inicio: string; fin: string }>();
	if (deltaDays === 0) return result;

	const tree = buildTree(all, 'id_cronograma_actividad', 'id_actividad_padre');

	function findNode(nodes: WithChildren<T>[], id: number): WithChildren<T> | null {
		for (const n of nodes) {
			if (n.id_cronograma_actividad === id) return n;
			const found = findNode(n.children, id);
			if (found) return found;
		}
		return null;
	}

	const root = findNode(tree, rootId);
	if (!root) return result;

	for (const node of flattenSubtree(root)) {
		if (!node.fecha_inicio_plan || !node.fecha_fin_plan) continue;
		const inicio = addDaysISO(node.fecha_inicio_plan, deltaDays);
		const fin = addDaysISO(node.fecha_fin_plan, deltaDays);
		result.set(node.id_cronograma_actividad, { inicio, fin });
		console.debug('[GANTT_BLOCK_MOVE]', node.id_cronograma_actividad, { deltaDays, inicio, fin });
	}
	return result;
}

// ── CONSTRAINT SOLVER (CAD-style, hard enforcement) ─────────────────────────
// Unifies cronograma_dependencia (FS + lag_dias) and restricción wait-conditions
// (id_actividad_origen, implicit lag 0) into one graph: origen --(lag)--> destino
// means destino.inicio ≥ origen.fin + lag + 1 day. Given a seed of "these
// activities just moved (or are being validated)", propagates forward through
// the graph — exactly the forward pass of the Critical Path Method — using
// Kahn's algorithm for topological order so a cycle (A→B→C→A) is detected
// instead of looping forever or silently picking an arbitrary order.
export interface ConstraintEdge {
	origenId: number;
	destinoId: number;
	lagDias: number;
	kind: 'dependencia' | 'restriccion';
}

export type ConstraintResolution =
	| { ok: true; shifted: Map<number, { inicio: string; fin: string }> }
	| { ok: false; cycle: number[]; message: string };

function extractCycle(stuck: number[], outAdj: Map<number, number[]>): number[] {
	const stuckSet = new Set(stuck);
	const visited = new Set<number>();
	const onStack = new Set<number>();
	const stack: number[] = [];

	function dfs(id: number): number[] | null {
		visited.add(id);
		stack.push(id);
		onStack.add(id);
		for (const next of outAdj.get(id) ?? []) {
			if (!stuckSet.has(next)) continue;
			if (onStack.has(next)) {
				const idx = stack.indexOf(next);
				return [...stack.slice(idx), next];
			}
			if (!visited.has(next)) {
				const found = dfs(next);
				if (found) return found;
			}
		}
		stack.pop();
		onStack.delete(id);
		return null;
	}

	for (const id of stuck) {
		if (!visited.has(id)) {
			const found = dfs(id);
			if (found) return found;
		}
	}
	return stuck; // fallback — Kahn's already guarantees a cycle exists among `stuck`
}

/**
 * Shifts a node by deltaDays inside a working `effective` position map: a
 * leaf just moves itself; a group moves every leaf descendant (rigid block
 * shift, same rule as computeBlockShift) plus its own rollup entry, so a
 * later edge reading FROM this group as an origen sees its shifted fin.
 */
function applyShiftToEffective<T extends PlanningActividad>(
	nodeById: Map<number, WithChildren<T>>,
	effective: Map<number, { inicio: string | null; fin: string | null }>,
	id: number,
	deltaDays: number
): void {
	const node = nodeById.get(id);
	if (!node) return;
	if (node.children.length === 0) {
		const cur = effective.get(id);
		if (cur?.inicio && cur?.fin) {
			effective.set(id, { inicio: addDaysISO(cur.inicio, deltaDays), fin: addDaysISO(cur.fin, deltaDays) });
		}
		return;
	}
	for (const leaf of flattenSubtree(node)) {
		if (leaf.children.length > 0) continue;
		const cur = effective.get(leaf.id_cronograma_actividad);
		if (cur?.inicio && cur?.fin) {
			effective.set(leaf.id_cronograma_actividad, { inicio: addDaysISO(cur.inicio, deltaDays), fin: addDaysISO(cur.fin, deltaDays) });
		}
	}
	const curGroup = effective.get(id);
	if (curGroup?.inicio && curGroup?.fin) {
		effective.set(id, { inicio: addDaysISO(curGroup.inicio, deltaDays), fin: addDaysISO(curGroup.fin, deltaDays) });
	}
}

/**
 * Resolves the constraint graph starting from `seedChanges` (activities whose
 * position is now known — either just-edited by the user, or "their current
 * stored position" when validating a whole project on load).
 *
 * Any activity that is the destino of a constraint edge is DERIVED, not
 * free — its position is always exactly origen.fin + lag + 1 day (the max
 * across multiple incoming edges), enforced regardless of whether that
 * activity itself was in `seedChanges`. This is what makes it a real CAD-style
 * "distance" constraint instead of a one-directional minimum: if the origen
 * moves earlier (shrinking the gap) the destino is pulled back too, and a
 * direct drag of a constrained destino away from its required position is
 * silently overridden back onto it — the only legal way to change that
 * distance is editing the edge's lag (see cascadeFromOrigen in GanttTab).
 * A seeded activity only "sticks" at its given position when it has no
 * incoming edges of its own (it's a true root of its constraint chain).
 */
export function resolveConstraints<T extends PlanningActividad>(
	all: T[],
	edges: ConstraintEdge[],
	seedChanges: Map<number, { inicio: string; fin: string }>
): ConstraintResolution {
	console.debug('[GANTT_CONSTRAINT_SOLVE] start', { seeds: [...seedChanges.keys()], edges: edges.length });

	const tree = buildTree(all, 'id_cronograma_actividad', 'id_actividad_padre');
	const byId = new Map(all.map((a) => [a.id_cronograma_actividad, a]));
	const nodeById = new Map<number, WithChildren<T>>();
	(function index(nodes: WithChildren<T>[]) {
		for (const n of nodes) {
			nodeById.set(n.id_cronograma_actividad, n);
			index(n.children);
		}
	})(tree);

	const rollupBaseline = computeRollup(tree);
	const effective = new Map<number, { inicio: string | null; fin: string | null }>();
	for (const a of all) {
		const r = rollupBaseline.get(a.id_cronograma_actividad);
		effective.set(a.id_cronograma_actividad, r ?? { inicio: a.fecha_inicio_plan, fin: a.fecha_fin_plan });
	}
	for (const [id, dates] of seedChanges) effective.set(id, dates);

	const adjBoth = new Map<number, number[]>();
	for (const e of edges) {
		if (!adjBoth.has(e.origenId)) adjBoth.set(e.origenId, []);
		adjBoth.get(e.origenId)!.push(e.destinoId);
		if (!adjBoth.has(e.destinoId)) adjBoth.set(e.destinoId, []);
		adjBoth.get(e.destinoId)!.push(e.origenId);
	}

	// Connected component containing the seeds, walked in BOTH directions —
	// not just forward. A seeded node's own incoming edges must be found even
	// when its origen isn't forward-reachable FROM it (e.g. the user dragged
	// the destino of a constraint directly): otherwise that edge would never
	// be seen below and the drag would silently keep an invalid position.
	const reachable = new Set<number>(seedChanges.keys());
	const bfsQueue = [...seedChanges.keys()];
	while (bfsQueue.length) {
		const cur = bfsQueue.shift()!;
		for (const next of adjBoth.get(cur) ?? []) {
			if (!reachable.has(next)) {
				reachable.add(next);
				bfsQueue.push(next);
			}
		}
	}

	const subEdges = edges.filter((e) => reachable.has(e.origenId) && reachable.has(e.destinoId));
	const outAdj = new Map<number, number[]>();
	const incomingByDest = new Map<number, ConstraintEdge[]>();
	const indegree = new Map<number, number>();
	for (const id of reachable) indegree.set(id, 0);
	for (const e of subEdges) {
		if (!outAdj.has(e.origenId)) outAdj.set(e.origenId, []);
		outAdj.get(e.origenId)!.push(e.destinoId);
		if (!incomingByDest.has(e.destinoId)) incomingByDest.set(e.destinoId, []);
		incomingByDest.get(e.destinoId)!.push(e);
		indegree.set(e.destinoId, (indegree.get(e.destinoId) ?? 0) + 1);
	}

	// Kahn's algorithm — topological order, or proof a cycle exists.
	const topoQueue: number[] = [...reachable].filter((id) => (indegree.get(id) ?? 0) === 0);
	const topoOrder: number[] = [];
	while (topoQueue.length) {
		const n = topoQueue.shift()!;
		topoOrder.push(n);
		for (const m of outAdj.get(n) ?? []) {
			indegree.set(m, (indegree.get(m) ?? 0) - 1);
			if (indegree.get(m) === 0) topoQueue.push(m);
		}
	}

	if (topoOrder.length !== reachable.size) {
		const stuck = [...reachable].filter((id) => !topoOrder.includes(id));
		const cycle = extractCycle(stuck, outAdj);
		const message = `No se puede resolver: ciclo de dependencias/restricciones entre ${cycle.map((id) => `#${id}`).join(' → ')}. Elimina o edita una de estas conexiones para continuar.`;
		console.error('[GANTT_CONSTRAINT_SOLVE] cycle detected', cycle);
		return { ok: false, cycle, message };
	}

	// Forward pass in topological order — CPM-style, but EXACT, not a minimum:
	// any node with incoming edges is derived and always snapped to exactly
	// max(every predecessor's fin + lag + 1) — never left "at least" that far,
	// so widening the gap (moving the origen earlier, or dragging the destino
	// itself further away) gets pulled back onto the constraint just as surely
	// as narrowing it gets pushed forward. Nodes with no incoming edges are
	// never touched here — their seeded/baseline position is the source of
	// truth for everything downstream.
	for (const id of topoOrder) {
		const incoming = incomingByDest.get(id);
		if (!incoming || incoming.length === 0) continue;

		let requiredInicio: string | null = null;
		for (const e of incoming) {
			const originEff = effective.get(e.origenId);
			if (!originEff?.fin) continue;
			const min = addDaysISO(originEff.fin, e.lagDias + 1);
			if (!requiredInicio || min > requiredInicio) requiredInicio = min;
		}
		if (!requiredInicio) continue;

		const cur = effective.get(id);
		if (!cur?.inicio || !cur?.fin) continue;
		if (cur.inicio !== requiredInicio) {
			const deltaDays = Math.round(
				(+new Date(requiredInicio + 'T00:00:00') - +new Date(cur.inicio + 'T00:00:00')) / 864e5
			);
			applyShiftToEffective(nodeById, effective, id, deltaDays);
			console.debug('[GANTT_CONSTRAINT_SOLVE] shifted', id, { deltaDays, requiredInicio });
		}
	}

	// Only leaves carry real fecha_inicio_plan/fecha_fin_plan columns — group
	// rows are rollup-only (checklist item 3), so only report leaf changes.
	// Iterate every activity, not just `reachable`: a group destino's shift is
	// applied to its descendant leaves via applyShiftToEffective, but those
	// leaves aren't necessarily edge-BFS-reachable themselves — reachable is
	// derived from constraint-graph edges, not the actividad tree.
	const shifted = new Map<number, { inicio: string; fin: string }>();
	for (const a of all) {
		const id = a.id_cronograma_actividad;
		const node = nodeById.get(id);
		if (!node || node.children.length > 0) continue;
		const eff = effective.get(id);
		const base = { inicio: byId.get(id)?.fecha_inicio_plan ?? null, fin: byId.get(id)?.fecha_fin_plan ?? null };
		if (eff?.inicio && eff?.fin && (eff.inicio !== base.inicio || eff.fin !== base.fin)) {
			shifted.set(id, { inicio: eff.inicio, fin: eff.fin });
		}
	}

	console.debug('[GANTT_CONSTRAINT_SOLVE] resolved', { changed: shifted.size });
	return { ok: true, shifted };
}

// ── DRAFT DIFF / COMMIT ──────────────────────────────────────────────────────
export function diffDraft<T extends PlanningActividad>(original: T[], draft: T[]): DraftDiff[] {
	const origById = new Map(original.map((a) => [a.id_cronograma_actividad, a]));
	const changes: DraftDiff[] = [];
	for (const d of draft) {
		const o = origById.get(d.id_cronograma_actividad);
		if (!o) continue;
		if (o.fecha_inicio_plan !== d.fecha_inicio_plan || o.fecha_fin_plan !== d.fecha_fin_plan) {
			changes.push({
				id_cronograma_actividad: d.id_cronograma_actividad,
				fecha_inicio_plan: d.fecha_inicio_plan,
				fecha_fin_plan: d.fecha_fin_plan,
			});
		}
	}
	console.debug('[GANTT_DRAFT] diff', changes.length, 'actividad(es) cambiada(s)');
	return changes;
}

export async function commitDraft(
	client: SupabaseClient,
	diff: DraftDiff[]
): Promise<{ ok: boolean; error?: string }> {
	for (const change of diff) {
		const { error } = await client
			.from('cronograma_actividad')
			.update({ fecha_inicio_plan: change.fecha_inicio_plan, fecha_fin_plan: change.fecha_fin_plan })
			.eq('id_cronograma_actividad', change.id_cronograma_actividad);
		if (error) {
			console.error('[GANTT_DRAFT] commit failed', change.id_cronograma_actividad, error);
			return { ok: false, error: error.message };
		}
	}
	console.debug('[GANTT_DRAFT] commit ok —', diff.length, 'actividad(es) guardada(s)');
	return { ok: true };
}

// ── CHROMATIC DEPTH SCALE ────────────────────────────────────────────────────
// One base hue per root-level branch (stable across re-renders via id % N,
// not array index, so colors don't shuffle when activities are added/removed),
// stepped lightness per depth so children read as "part of" their parent.
const BRANCH_HUES = [24, 199, 262, 142, 330, 45, 173, 291]; // orange, sky, violet, green, pink, amber, teal, purple

export function colorForNode(rootId: number, depth: number): string {
	const hue = BRANCH_HUES[rootId % BRANCH_HUES.length];
	const lightness = Math.min(72, 42 + depth * 10);
	return `hsl(${hue}, 65%, ${lightness}%)`;
}
