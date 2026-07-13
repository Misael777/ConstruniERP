import { describe, it, expect } from 'vitest';
import { buildTree } from '$lib/utils/tree';
import {
	computeRollup,
	computeProgress,
	computeBlockShift,
	checkBlockShiftDependencyWarnings,
	diffDraft,
	type PlanningActividad,
	type PlanningDependencia,
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

describe('checkBlockShiftDependencyWarnings', () => {
	it('warns when a block move pushes the dependent activity before its required lag', () => {
		const deps: PlanningDependencia[] = [
			{ id_actividad_origen: 3, id_actividad_destino: 4, tipo_dependencia: 'FS', lag_dias: 0 },
		];
		const shift = computeBlockShift(sample, 1, 3); // moves 2 & 3, leaves 4 in place
		const warnings = checkBlockShiftDependencyWarnings(sample, deps, shift);
		expect(warnings).toHaveLength(1);
	});

	it('does not warn when both ends of the dependency move together', () => {
		const deps: PlanningDependencia[] = [
			{ id_actividad_origen: 2, id_actividad_destino: 3, tipo_dependencia: 'FS', lag_dias: 0 },
		];
		const shift = computeBlockShift(sample, 1, 3); // moves both 2 and 3
		const warnings = checkBlockShiftDependencyWarnings(sample, deps, shift);
		expect(warnings).toHaveLength(0);
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
