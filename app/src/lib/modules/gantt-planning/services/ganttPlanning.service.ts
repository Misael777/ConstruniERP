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
//  8. checkBlockShiftDependencyWarnings is advisory only (returns strings to
//     show the user) — it must never block a save, mirroring how
//     restricciones are cosmetic-only elsewhere in this module.
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
// Logging prefixes: [GANTT_DATE_CALC] [GANTT_ROLLUP] [GANTT_BLOCK_MOVE] [GANTT_DRAFT]

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

// ── ADVISORY DEPENDENCY WARNINGS ────────────────────────────────────────────
// Cross-branch FS dependencies aren't enforced (see checklist item 7) — this
// only surfaces a warning string when a block move would push the shifted
// end of the relationship earlier than its lag_dias allows. Never blocks.
export function checkBlockShiftDependencyWarnings<T extends PlanningActividad>(
	all: T[],
	deps: PlanningDependencia[],
	shift: Map<number, { inicio: string; fin: string }>
): string[] {
	const warnings: string[] = [];
	const byId = new Map(all.map((a) => [a.id_cronograma_actividad, a]));

	const effective = (id: number): { inicio: string | null; fin: string | null } =>
		shift.get(id) ?? {
			inicio: byId.get(id)?.fecha_inicio_plan ?? null,
			fin: byId.get(id)?.fecha_fin_plan ?? null,
		};

	for (const dep of deps) {
		if (dep.tipo_dependencia !== 'FS') continue; // only FS is reachable from the UI today
		const movedOrigin = shift.has(dep.id_actividad_origen);
		const movedDest = shift.has(dep.id_actividad_destino);
		if (movedOrigin === movedDest) continue; // both or neither moved together → relative offset intact

		const origen = effective(dep.id_actividad_origen);
		const destino = effective(dep.id_actividad_destino);
		if (!origen.fin || !destino.inicio) continue;

		const minInicio = addDaysISO(origen.fin, dep.lag_dias + 1);
		if (destino.inicio < minInicio) {
			warnings.push(
				`La actividad #${dep.id_actividad_destino} debería iniciar después de #${dep.id_actividad_origen} (dependencia FS, lag ${dep.lag_dias}d) — este movimiento la deja antes.`
			);
		}
	}
	return warnings;
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
