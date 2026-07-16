import { describe, it, expect } from 'vitest';
import { buildTree } from '$lib/utils/tree';
import {
	computeRollup,
	computeProgress,
	computeBlockShift,
	resolveConstraints,
	diffDraft,
	type PlanningActividad,
	type ConstraintEdge,
} from './ganttPlanning.service';

function act(overrides: Partial<PlanningActividad> & { id_cronograma_actividad: number }): PlanningActividad {
	return {
		id_actividad_padre: null,
		fecha_inicio_plan: null,
		fecha_fin_plan: null,
		porcentaje_avance_real: 0,
		...overrides,
	};
}

// A group (id 1) with two leaf children (2, 3), plus an unrelated root leaf (4).
const sample: PlanningActividad[] = [
	act({ id_cronograma_actividad: 1, id_actividad_padre: null }),
	act({
		id_cronograma_actividad: 2,
		id_actividad_padre: 1,
		fecha_inicio_plan: '2024-01-01',
		fecha_fin_plan: '2024-01-05',
		porcentaje_avance_real: 100,
	}),
	act({
		id_cronograma_actividad: 3,
		id_actividad_padre: 1,
		fecha_inicio_plan: '2024-01-06',
		fecha_fin_plan: '2024-01-10',
		porcentaje_avance_real: 0,
	}),
	act({
		id_cronograma_actividad: 4,
		id_actividad_padre: null,
		fecha_inicio_plan: '2024-01-01',
		fecha_fin_plan: '2024-01-03',
	}),
];

describe('computeRollup', () => {
	it('reports a group node as the min/max of its descendant leaves', () => {
		const tree = buildTree(sample, 'id_cronograma_actividad', 'id_actividad_padre');
		const rollup = computeRollup(tree);
		expect(rollup.get(1)).toEqual({ inicio: '2024-01-01', fin: '2024-01-10' });
	});

	it('reports a leaf node as its own stored dates', () => {
		const tree = buildTree(sample, 'id_cronograma_actividad', 'id_actividad_padre');
		const rollup = computeRollup(tree);
		expect(rollup.get(2)).toEqual({ inicio: '2024-01-01', fin: '2024-01-05' });
		expect(rollup.get(4)).toEqual({ inicio: '2024-01-01', fin: '2024-01-03' });
	});

	it('ignores children with no dates when computing the parent range', () => {
		const withUndated: PlanningActividad[] = [
			...sample,
			act({ id_cronograma_actividad: 5, id_actividad_padre: 1 }), // no dates yet
		];
		const tree = buildTree(withUndated, 'id_cronograma_actividad', 'id_actividad_padre');
		const rollup = computeRollup(tree);
		expect(rollup.get(1)).toEqual({ inicio: '2024-01-01', fin: '2024-01-10' });
	});
});

describe('computeProgress', () => {
	it('duration-weights descendant leaves instead of averaging them flatly', () => {
		const tree = buildTree(sample, 'id_cronograma_actividad', 'id_actividad_padre');
		const progress = computeProgress(tree);
		// leaf 2: 5 days @ 100%, leaf 3: 5 days @ 0% → equal weight → 50%
		expect(progress.get(1)).toBe(50);
	});
});

describe('computeBlockShift', () => {
	it('shifts every dated descendant of the root by the same delta (rigid move)', () => {
		const shift = computeBlockShift(sample, 1, 3);
		expect(shift.get(2)).toEqual({ inicio: '2024-01-04', fin: '2024-01-08' });
		expect(shift.get(3)).toEqual({ inicio: '2024-01-09', fin: '2024-01-13' });
		expect(shift.has(4)).toBe(false); // outside the moved block
	});

	it('is a no-op for a zero delta', () => {
		expect(computeBlockShift(sample, 1, 0).size).toBe(0);
	});

	it('shifting a leaf only moves that leaf', () => {
		const shift = computeBlockShift(sample, 4, 2);
		expect(shift.size).toBe(1);
		expect(shift.get(4)).toEqual({ inicio: '2024-01-03', fin: '2024-01-05' });
	});
});

describe('resolveConstraints', () => {
	// Two independent leaves: A (10) already placed, B (11) currently overlaps
	// A's tail. A single FS edge with lag 0 should push B to start the day
	// right after A finishes.
	const twoLeaves: PlanningActividad[] = [
		act({ id_cronograma_actividad: 10, fecha_inicio_plan: '2024-01-01', fecha_fin_plan: '2024-01-05' }),
		act({ id_cronograma_actividad: 11, fecha_inicio_plan: '2024-01-01', fecha_fin_plan: '2024-01-03' }),
	];

	it('cascades a destino to start the day after its origen finishes (0d lag)', () => {
		const edges: ConstraintEdge[] = [{ origenId: 10, destinoId: 11, lagDias: 0, kind: 'dependencia' }];
		const seed = new Map([[10, { inicio: '2024-01-01', fin: '2024-01-05' }]]);
		const res = resolveConstraints(twoLeaves, edges, seed);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.shifted.get(11)).toEqual({ inicio: '2024-01-06', fin: '2024-01-08' });
		expect(res.shifted.has(10)).toBe(false); // origen has no incoming edges — never touched
	});

	it('honors a non-zero day offset (Nd lag)', () => {
		const edges: ConstraintEdge[] = [{ origenId: 10, destinoId: 11, lagDias: 3, kind: 'restriccion' }];
		const seed = new Map([[10, { inicio: '2024-01-01', fin: '2024-01-05' }]]);
		const res = resolveConstraints(twoLeaves, edges, seed);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.shifted.get(11)).toEqual({ inicio: '2024-01-09', fin: '2024-01-11' });
	});

	it('propagates transitively through a chain (A→B→C)', () => {
		const chain: PlanningActividad[] = [
			act({ id_cronograma_actividad: 10, fecha_inicio_plan: '2024-01-01', fecha_fin_plan: '2024-01-05' }),
			act({ id_cronograma_actividad: 11, fecha_inicio_plan: '2024-01-01', fecha_fin_plan: '2024-01-03' }),
			act({ id_cronograma_actividad: 12, fecha_inicio_plan: '2024-01-01', fecha_fin_plan: '2024-01-02' }),
		];
		const edges: ConstraintEdge[] = [
			{ origenId: 10, destinoId: 11, lagDias: 0, kind: 'dependencia' },
			{ origenId: 11, destinoId: 12, lagDias: 0, kind: 'dependencia' },
		];
		const seed = new Map([[10, { inicio: '2024-01-01', fin: '2024-01-05' }]]);
		const res = resolveConstraints(chain, edges, seed);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.shifted.get(11)).toEqual({ inicio: '2024-01-06', fin: '2024-01-08' });
		expect(res.shifted.get(12)).toEqual({ inicio: '2024-01-09', fin: '2024-01-10' });
	});

	it('takes the max of multiple predecessors (diamond)', () => {
		const diamond: PlanningActividad[] = [
			act({ id_cronograma_actividad: 10, fecha_inicio_plan: '2024-01-01', fecha_fin_plan: '2024-01-05' }),
			act({ id_cronograma_actividad: 11, fecha_inicio_plan: '2024-01-01', fecha_fin_plan: '2024-01-08' }),
			act({ id_cronograma_actividad: 12, fecha_inicio_plan: '2024-01-01', fecha_fin_plan: '2024-01-02' }),
		];
		const edges: ConstraintEdge[] = [
			{ origenId: 10, destinoId: 12, lagDias: 0, kind: 'dependencia' },
			{ origenId: 11, destinoId: 12, lagDias: 0, kind: 'dependencia' },
		];
		const seed = new Map([
			[10, { inicio: '2024-01-01', fin: '2024-01-05' }],
			[11, { inicio: '2024-01-01', fin: '2024-01-08' }],
		]);
		const res = resolveConstraints(diamond, edges, seed);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		// max(10.fin+1, 11.fin+1) = max(01-06, 01-09) = 01-09
		expect(res.shifted.get(12)).toEqual({ inicio: '2024-01-09', fin: '2024-01-10' });
	});

	it('rigidly shifts an entire group (and every leaf descendant) when the group is the destino', () => {
		const withGroup: PlanningActividad[] = [
			...sample, // group 1 with leaves 2 (01-01→05) and 3 (01-06→10)
			act({ id_cronograma_actividad: 20, fecha_inicio_plan: '2024-01-01', fecha_fin_plan: '2024-01-03' }),
		];
		const edges: ConstraintEdge[] = [{ origenId: 20, destinoId: 1, lagDias: 0, kind: 'dependencia' }];
		const seed = new Map([[20, { inicio: '2024-01-01', fin: '2024-01-03' }]]);
		const res = resolveConstraints(withGroup, edges, seed);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		// group's rollup inicio (01-01) must become 01-04 → delta of 3 days,
		// applied rigidly to every leaf descendant of the group.
		expect(res.shifted.get(2)).toEqual({ inicio: '2024-01-04', fin: '2024-01-08' });
		expect(res.shifted.get(3)).toEqual({ inicio: '2024-01-09', fin: '2024-01-13' });
	});

	it('reports an unsolvable cycle and applies nothing', () => {
		const cyclic: PlanningActividad[] = [
			act({ id_cronograma_actividad: 10, fecha_inicio_plan: '2024-01-01', fecha_fin_plan: '2024-01-05' }),
			act({ id_cronograma_actividad: 11, fecha_inicio_plan: '2024-01-06', fecha_fin_plan: '2024-01-10' }),
		];
		const edges: ConstraintEdge[] = [
			{ origenId: 10, destinoId: 11, lagDias: 0, kind: 'dependencia' },
			{ origenId: 11, destinoId: 10, lagDias: 0, kind: 'dependencia' },
		];
		const seed = new Map([[10, { inicio: '2024-01-01', fin: '2024-01-05' }]]);
		const res = resolveConstraints(cyclic, edges, seed);
		expect(res.ok).toBe(false);
		if (res.ok) return;
		expect(res.cycle).toEqual(expect.arrayContaining([10, 11]));
		expect(res.message.toLowerCase()).toContain('ciclo');
	});

	it('corrects an already-violated edge when validating a whole project on load', () => {
		const edges: ConstraintEdge[] = [{ origenId: 10, destinoId: 11, lagDias: 0, kind: 'dependencia' }];
		// Both activities seeded at their current (already-violating) stored
		// positions, as done when validating a whole project on load.
		const seed = new Map([
			[10, { inicio: '2024-01-01', fin: '2024-01-05' }],
			[11, { inicio: '2024-01-01', fin: '2024-01-03' }],
		]);
		const res = resolveConstraints(twoLeaves, edges, seed);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.shifted.get(11)).toEqual({ inicio: '2024-01-06', fin: '2024-01-08' });
	});

	it('pulls the destino BACKWARD when the origen moves earlier, shrinking the gap exactly (not just a minimum)', () => {
		// Baseline: 10 finishes 01-05, 11 already starts 01-10 — a much wider
		// gap than the 0d lag requires. Moving 10 earlier must pull 11 back to
		// sit exactly the day after 10's NEW finish, not leave it floating.
		const wideGap: PlanningActividad[] = [
			act({ id_cronograma_actividad: 10, fecha_inicio_plan: '2024-01-01', fecha_fin_plan: '2024-01-05' }),
			act({ id_cronograma_actividad: 11, fecha_inicio_plan: '2024-01-10', fecha_fin_plan: '2024-01-12' }),
		];
		const edges: ConstraintEdge[] = [{ origenId: 10, destinoId: 11, lagDias: 0, kind: 'dependencia' }];
		// Origen moves 3 days earlier: 2024-01-01→05 becomes 2023-12-29→2024-01-02.
		const seed = new Map([[10, { inicio: '2023-12-29', fin: '2024-01-02' }]]);
		const res = resolveConstraints(wideGap, edges, seed);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.shifted.get(11)).toEqual({ inicio: '2024-01-03', fin: '2024-01-05' });
	});

	it('overrides a direct drag of a constrained destino back onto its required position', () => {
		// The user drags 11 (which has an incoming 0d-lag edge from 10) further
		// into the future, trying to widen the gap by hand — the constraint is a
		// fixed distance, not a minimum, so that drag must be rejected/snapped
		// back to exactly 10.fin + 1, as if the drag never happened.
		const edges: ConstraintEdge[] = [{ origenId: 10, destinoId: 11, lagDias: 0, kind: 'dependencia' }];
		const seed = new Map([[11, { inicio: '2024-01-20', fin: '2024-01-22' }]]);
		const res = resolveConstraints(twoLeaves, edges, seed);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.shifted.get(11)).toEqual({ inicio: '2024-01-06', fin: '2024-01-08' });
	});
});

describe('diffDraft', () => {
	it('only reports activities whose dates actually changed', () => {
		const draft = sample.map((a) =>
			a.id_cronograma_actividad === 2 ? { ...a, fecha_inicio_plan: '2024-02-01', fecha_fin_plan: '2024-02-05' } : a
		);
		const diff = diffDraft(sample, draft);
		expect(diff).toHaveLength(1);
		expect(diff[0].id_cronograma_actividad).toBe(2);
	});

	it('returns an empty diff when nothing changed', () => {
		expect(diffDraft(sample, sample)).toHaveLength(0);
	});
});
