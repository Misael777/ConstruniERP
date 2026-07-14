// Generic flat-list → tree builder, shared by partidas (stores/partidas.ts),
// PresupuestoTab and GanttTab so hierarchy construction isn't reimplemented
// per-caller. Orphans (parent id set but parent not present in the list)
// are placed at root instead of being dropped.

export type WithChildren<T> = T & { children: WithChildren<T>[] };

export function buildTree<T extends Record<string, any>>(
	items: T[],
	idKey: keyof T,
	parentKey: keyof T
): WithChildren<T>[] {
	const map = new Map<any, WithChildren<T>>();
	for (const item of items) {
		map.set(item[idKey], { ...item, children: [] });
	}

	const roots: WithChildren<T>[] = [];
	for (const item of items) {
		const node = map.get(item[idKey])!;
		const parentId = item[parentKey];
		const parent = parentId != null ? map.get(parentId) : undefined;
		if (parent) {
			parent.children.push(node);
		} else {
			roots.push(node);
		}
	}
	return roots;
}

// Returns [root, ...all descendants] in depth-first order.
export function flattenSubtree<T extends { children: T[] }>(node: T): T[] {
	const out: T[] = [node];
	for (const child of node.children) out.push(...flattenSubtree(child));
	return out;
}

// Merges in any ancestor missing from `items` (found via `fullCatalog`) so
// buildTree never has to fall back to treating a scoped subset's orphans as
// roots. This is what makes a partial/legacy selection (e.g. a
// presupuesto_detalle that only has a leaf partida but not its parent group,
// added before this auto-ancestor behavior existed) self-heal into a
// correctly nested tree instead of showing the leaf floating at root level.
export function fillMissingAncestors<T extends Record<string, any>>(
	items: T[],
	fullCatalog: T[],
	idKey: keyof T,
	parentKey: keyof T
): T[] {
	const present = new Map<any, T>();
	for (const item of items) present.set(item[idKey], item);
	const catalogById = new Map<any, T>();
	for (const item of fullCatalog) catalogById.set(item[idKey], item);

	const result = [...items];
	for (const item of items) {
		let parentId = item[parentKey];
		let guard = 0;
		while (parentId != null && !present.has(parentId) && guard++ < 50) {
			const ancestor = catalogById.get(parentId);
			if (!ancestor) break;
			present.set(parentId, ancestor);
			result.push(ancestor);
			parentId = ancestor[parentKey];
		}
	}
	return result;
}
