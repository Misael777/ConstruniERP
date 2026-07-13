import { describe, it, expect } from 'vitest';
import { buildTree, flattenSubtree, fillMissingAncestors } from './tree';

interface Item {
	id: number;
	parentId: number | null;
	name: string;
}

describe('buildTree', () => {
	it('nests children under their parent', () => {
		const items: Item[] = [
			{ id: 1, parentId: null, name: 'root' },
			{ id: 2, parentId: 1, name: 'child' },
			{ id: 3, parentId: 2, name: 'grandchild' },
		];
		const tree = buildTree(items, 'id', 'parentId');
		expect(tree).toHaveLength(1);
		expect(tree[0].children).toHaveLength(1);
		expect(tree[0].children[0].children).toHaveLength(1);
		expect(tree[0].children[0].children[0].name).toBe('grandchild');
	});

	it('places orphans (parent id not present in the list) at root instead of dropping them', () => {
		const items: Item[] = [{ id: 5, parentId: 999, name: 'orphan' }];
		const tree = buildTree(items, 'id', 'parentId');
		expect(tree).toHaveLength(1);
		expect(tree[0].name).toBe('orphan');
	});

	it('supports multiple root branches and multiple children per node', () => {
		const items: Item[] = [
			{ id: 1, parentId: null, name: 'root A' },
			{ id: 2, parentId: null, name: 'root B' },
			{ id: 3, parentId: 1, name: 'A.1' },
			{ id: 4, parentId: 1, name: 'A.2' },
		];
		const tree = buildTree(items, 'id', 'parentId');
		expect(tree).toHaveLength(2);
		const rootA = tree.find((n) => n.name === 'root A')!;
		expect(rootA.children).toHaveLength(2);
	});
});

describe('fillMissingAncestors', () => {
	const fullCatalog: Item[] = [
		{ id: 8, parentId: null, name: '1 PISO' },
		{ id: 9, parentId: 8, name: 'OBR. CON' },
		{ id: 10, parentId: 8, name: 'OBR. CON AR' },
		{ id: 11, parentId: null, name: '2 PISO' },
		{ id: 12, parentId: 11, name: 'OBR. Con' },
	];

	it('pulls in a missing parent so a scoped subset does not orphan a leaf at root', () => {
		// Simulates a presupuesto_detalle that has the leaf (12) but never got
		// its parent group (11) added — the exact bug reported: the leaf
		// would otherwise render as a stray root instead of nested under 2 PISO.
		const scoped: Item[] = [
			{ id: 8, parentId: null, name: '1 PISO' },
			{ id: 9, parentId: 8, name: 'OBR. CON' },
			{ id: 10, parentId: 8, name: 'OBR. CON AR' },
			{ id: 12, parentId: 11, name: 'OBR. Con' },
		];
		const filled = fillMissingAncestors(scoped, fullCatalog, 'id', 'parentId');
		const tree = buildTree(filled, 'id', 'parentId');

		expect(tree).toHaveLength(2); // "1 PISO" and "2 PISO", not 3 roots
		const piso2 = tree.find((n) => n.name === '2 PISO')!;
		expect(piso2).toBeDefined();
		expect(piso2.children.map((c) => c.name)).toEqual(['OBR. Con']);
	});

	it('walks multiple missing ancestor levels, not just the direct parent', () => {
		const deepCatalog: Item[] = [
			{ id: 1, parentId: null, name: 'root' },
			{ id: 2, parentId: 1, name: 'mid' },
			{ id: 3, parentId: 2, name: 'leaf' },
		];
		const scoped: Item[] = [{ id: 3, parentId: 2, name: 'leaf' }];
		const filled = fillMissingAncestors(scoped, deepCatalog, 'id', 'parentId');
		const tree = buildTree(filled, 'id', 'parentId');

		expect(tree).toHaveLength(1);
		expect(tree[0].name).toBe('root');
		expect(tree[0].children[0].name).toBe('mid');
		expect(tree[0].children[0].children[0].name).toBe('leaf');
	});

	it('is a no-op when nothing is missing', () => {
		const filled = fillMissingAncestors(fullCatalog, fullCatalog, 'id', 'parentId');
		expect(filled).toHaveLength(fullCatalog.length);
	});
});

describe('flattenSubtree', () => {
	it('returns the root followed by all descendants depth-first', () => {
		const items: Item[] = [
			{ id: 1, parentId: null, name: 'root' },
			{ id: 2, parentId: 1, name: 'a' },
			{ id: 3, parentId: 1, name: 'b' },
			{ id: 4, parentId: 2, name: 'a.1' },
		];
		const tree = buildTree(items, 'id', 'parentId');
		const flat = flattenSubtree(tree[0]);
		expect(flat.map((n) => n.name)).toEqual(['root', 'a', 'a.1', 'b']);
	});
});
