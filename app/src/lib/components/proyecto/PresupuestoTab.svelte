<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { buildTree, type WithChildren } from '$lib/utils/tree';
	import { instanciarPlantilla } from '$lib/stores/partidas';
	import { toast } from '$lib/stores/toast';

	const { projectId, proyecto } = $props<{
		projectId: number;
		proyecto: { nombre_proyecto: string };
	}>();

	// ── TYPES ──────────────────────────────────────────────────────────────────
	type Detalle = {
		id_presupuesto_detalle: number;
		id_partida: number;
		cantidad: number;
		precio_mo: number;
		precio_mat: number;
		precio_unitario: number;
		total: number;
		partida: {
			codigo: string;
			descripcion: string;
			nivel: number;
			id_partida_padre: number | null;
			unidad: string | null;
		} | null;
	};

	type PartidaCatalog = {
		id_partida: number;
		codigo: string;
		descripcion: string;
		nivel: number;
		id_partida_padre: number | null;
		unidad: string | null;
		precio_unitario: number | null;
	};

	type PlantillaResumen = {
		id_plantilla: number;
		nombre: string;
		descripcion: string | null;
		tipo: string | null;
		num_partidas: number;
	};

	// ── STATE ──────────────────────────────────────────────────────────────────
	let presupuestoId       = $state<number | null>(null);
	let detalles            = $state<Detalle[]>([]);
	let isLoading            = $state(true);
	let ganttIds             = $state(new Set<number>());
	let gastosGeneralesPct   = $state(0);
	let savingGastosGenerales = $state(false);

	let showModal   = $state(false);
	let modalTab    = $state<'partidas' | 'plantillas'>('partidas');
	let modalSearch = $state('');
	let catalog     = $state<PartidaCatalog[]>([]);
	let catLoaded   = $state(false);
	let adding      = $state<number | null>(null);
	let saving      = $state(new Set<number>());

	// Plantillas (catálogo maestro → "Plantillas" tab del modal)
	let plantillas         = $state<PlantillaResumen[]>([]);
	let plantillasLoaded   = $state(false);
	let usarCantidades     = $state(true);
	let applyingPlantillaId = $state<number | null>(null);

	// ── DERIVED ────────────────────────────────────────────────────────────────
	// Nested tree honoring the partida catalog's own nivel/id_partida_padre —
	// previously this was a flat codigo-sorted list, which is what dropped the
	// hierarchical structure the user relies on to read the budget.
	type DetalleNode = WithChildren<Detalle & { id_partida_padre: number | null }>;

	function sortNodes(nodes: DetalleNode[]): DetalleNode[] {
		return [...nodes]
			.sort((a, b) => (a.partida?.codigo ?? '').localeCompare(b.partida?.codigo ?? '', 'es', { numeric: true }))
			.map(n => ({ ...n, children: sortNodes(n.children as DetalleNode[]) }));
	}

	let budgetTree = $derived.by((): DetalleNode[] => {
		const mapped = detalles.map(d => ({ ...d, id_partida_padre: d.partida?.id_partida_padre ?? null }));
		return sortNodes(buildTree(mapped, 'id_partida', 'id_partida_padre'));
	});

	// A node with children is a rollup/summary row (its own cantidad/precio are
	// not directly editable here — the total is the sum of its descendants).
	function rollupTotal(node: DetalleNode): number {
		if (node.children.length === 0) return node.cantidad * (node.precio_mo + node.precio_mat);
		return node.children.reduce((s, c) => s + rollupTotal(c as DetalleNode), 0);
	}
	function rollupParcialMO(node: DetalleNode): number {
		if (node.children.length === 0) return node.cantidad * node.precio_mo;
		return node.children.reduce((s, c) => s + rollupParcialMO(c as DetalleNode), 0);
	}
	function rollupParcialMAT(node: DetalleNode): number {
		if (node.children.length === 0) return node.cantidad * node.precio_mat;
		return node.children.reduce((s, c) => s + rollupParcialMAT(c as DetalleNode), 0);
	}

	// Paleta tipo hoja de cálculo para las filas de categoría (nivel raíz) —
	// cíclica por posición, imitando las bandas de color de "Presupuesto de
	// Obra por Partidas".
	const CATEGORY_COLORS = ['#748546', '#c9722c', '#3f7a8c', '#7a4f7a', '#3f6f9c', '#8c6b3f'];

	let costoDirectoMO = $derived(detalles.reduce((s, d) => s + d.cantidad * d.precio_mo, 0));
	let costoDirectoMAT = $derived(detalles.reduce((s, d) => s + d.cantidad * d.precio_mat, 0));
	let grandTotal = $derived(costoDirectoMO + costoDirectoMAT);
	let gastosGeneralesMonto = $derived(grandTotal * (gastosGeneralesPct / 100));
	let presupuestoTotal = $derived(grandTotal + gastosGeneralesMonto);

	let ganttLinkedCount = $derived(
		detalles.filter(d => ganttIds.has(d.id_partida)).length
	);

	let existingIds = $derived(new Set(detalles.map(d => d.id_partida)));

	let filteredCatalog = $derived.by(() => {
		const q = modalSearch.trim().toLowerCase();
		const items = q
			? catalog.filter(p =>
					p.codigo.toLowerCase().includes(q) ||
					p.descripcion.toLowerCase().includes(q)
				)
			: catalog;
		return items.slice(0, 80);
	});

	// ── DATA ───────────────────────────────────────────────────────────────────
	async function load() {
		isLoading = true;
		try {
			const { data: pres } = await supabase
				.from('presupuesto')
				.select('id_presupuesto, gastos_generales_pct')
				.eq('id_proyecto', projectId)
				.order('created_at', { ascending: false })
				.limit(1)
				.maybeSingle();

			presupuestoId = pres?.id_presupuesto ?? null;
			gastosGeneralesPct = pres?.gastos_generales_pct ?? 0;

			if (presupuestoId) {
				const { data: rows } = await supabase
					.from('presupuesto_detalle')
					.select(
						'id_presupuesto_detalle, id_partida, cantidad, precio_mo, precio_mat, precio_unitario, total, partida:id_partida(codigo, descripcion, nivel, id_partida_padre, unidad)'
					)
					.eq('id_presupuesto', presupuestoId)
					.order('id_presupuesto_detalle');
				detalles = ((rows ?? []).filter((r: any) => r.partida)) as unknown as Detalle[];
			}

			// Which partidas are also in the Gantt?
			const { data: acts } = await supabase
				.from('cronograma_actividad')
				.select('id_partida')
				.eq('id_proyecto', projectId)
				.not('id_partida', 'is', null);
			ganttIds = new Set(
				(acts ?? []).map((a: any) => a.id_partida).filter(Boolean)
			);

			// Full catalog, loaded eagerly (not lazily on modal-open) so it's
			// available for backfillMissingAncestors below regardless of whether
			// the user ever opens the "Agregar del Catálogo" modal.
			const { data: cats } = await supabase.from('partida').select('*').order('codigo');
			catalog = (cats ?? []) as PartidaCatalog[];
			catLoaded = true;

			// Self-heal legacy rows: a presupuesto_detalle added before
			// addAncestorChain existed can have a leaf whose parent group was
			// never inserted, which renders as a stray root instead of nested
			// under its real parent — backfill those ancestors now.
			if (presupuestoId) await backfillMissingAncestors();
		} finally {
			isLoading = false;
		}
	}

	async function ensurePresupuesto(): Promise<number | null> {
		if (presupuestoId) return presupuestoId;
		const { data } = await supabase
			.from('presupuesto')
			.insert({ id_proyecto: projectId, nombre: `Presupuesto - ${proyecto.nombre_proyecto}`, tipo: 'obra' })
			.select('id_presupuesto')
			.single();
		presupuestoId = data?.id_presupuesto ?? null;
		return presupuestoId;
	}

	async function saveDetalle(det: Detalle) {
		saving = new Set([...saving, det.id_presupuesto_detalle]);
		const { data } = await supabase
			.from('presupuesto_detalle')
			.update({ cantidad: det.cantidad, precio_mo: det.precio_mo, precio_mat: det.precio_mat })
			.eq('id_presupuesto_detalle', det.id_presupuesto_detalle)
			.select('precio_unitario, total')
			.single();
		if (data) {
			detalles = detalles.map(d =>
				d.id_presupuesto_detalle === det.id_presupuesto_detalle
					? { ...d, precio_unitario: data.precio_unitario, total: data.total }
					: d
			);
		}
		saving = new Set([...saving].filter(id => id !== det.id_presupuesto_detalle));
	}

	async function saveGastosGenerales() {
		if (!presupuestoId) return;
		savingGastosGenerales = true;
		await supabase.from('presupuesto').update({ gastos_generales_pct: gastosGeneralesPct }).eq('id_presupuesto', presupuestoId);
		savingGastosGenerales = false;
	}

	async function deleteDetalle(id: number) {
		if (!confirm('¿Quitar esta partida del presupuesto?')) return;
		await supabase.from('presupuesto_detalle').delete().eq('id_presupuesto_detalle', id);
		detalles = detalles.filter(d => d.id_presupuesto_detalle !== id);
	}

	function openModal() {
		showModal = true;
		modalTab = 'partidas';
	}

	async function loadPlantillas() {
		if (plantillasLoaded) return;
		const { data, error } = await supabase
			.from('plantilla_presupuesto')
			.select('id_plantilla, nombre, descripcion, tipo, plantilla_detalle(id_plantilla_detalle)')
			.order('nombre');
		if (!error) {
			plantillas = (data ?? []).map((row: any) => ({
				id_plantilla: row.id_plantilla,
				nombre: row.nombre,
				descripcion: row.descripcion,
				tipo: row.tipo,
				num_partidas: Array.isArray(row.plantilla_detalle) ? row.plantilla_detalle.length : 0,
			}));
			plantillasLoaded = true;
		}
	}

	function selectModalTab(tab: 'partidas' | 'plantillas') {
		modalTab = tab;
		if (tab === 'plantillas') loadPlantillas();
	}

	// Instancia toda una plantilla (conjunto de partidas) de una sola vez en el
	// presupuesto del proyecto. instanciarPlantilla() inserta exactamente las
	// filas de plantilla_detalle, sin caminar ancestros — por eso recargamos
	// con load() al terminar, que corre backfillMissingAncestors() y repara
	// cualquier grupo padre que la plantilla no haya incluido.
	async function aplicarPlantilla(plantilla: PlantillaResumen) {
		if (applyingPlantillaId !== null) return;
		applyingPlantillaId = plantilla.id_plantilla;
		try {
			const { data: { session } } = await supabase.auth.getSession();
			const userId = session?.user?.id;
			if (!userId) {
				toast.error('No hay sesión activa. Recarga la página.');
				return;
			}
			const res = await instanciarPlantilla(plantilla.id_plantilla, projectId, usarCantidades, false, userId);
			if (res.success) {
				toast.success(res.message || `Plantilla "${plantilla.nombre}" aplicada`);
				await load();
			} else {
				toast.error(res.message || 'No se pudo aplicar la plantilla');
			}
		} finally {
			applyingPlantillaId = null;
		}
	}

	// Walks a partida's id_partida_padre chain up the catalog and inserts a
	// zero-cost "grupo" row for any ancestor not yet in the budget, so the
	// tree is always connected root→hoja instead of showing an orphaned leaf.
	async function addAncestorChain(startPadreId: number | null, pid: number) {
		const chain: PartidaCatalog[] = [];
		let currentParentId = startPadreId;
		let guard = 0;
		while (currentParentId != null && guard++ < 20) {
			const anc = catalog.find(c => c.id_partida === currentParentId);
			if (!anc) break;
			chain.unshift(anc);
			currentParentId = anc.id_partida_padre;
		}
		let known = existingIds;
		for (const anc of chain) {
			if (known.has(anc.id_partida)) continue;
			const { data } = await supabase
				.from('presupuesto_detalle')
				.insert({ id_presupuesto: pid, id_partida: anc.id_partida, cantidad: 0, precio_mo: 0, precio_mat: 0 })
				.select(
					'id_presupuesto_detalle, id_partida, cantidad, precio_mo, precio_mat, precio_unitario, total, partida:id_partida(codigo, descripcion, nivel, id_partida_padre, unidad)'
				)
				.single();
			if (data && (data as any).partida) {
				detalles = [...detalles, data as unknown as Detalle];
				known = new Set([...known, anc.id_partida]);
			}
		}
	}

	// Runs addAncestorChain for every already-loaded detalle — repairs gaps
	// left by rows that were inserted before this auto-ancestor behavior
	// existed (each call is idempotent: it skips ancestors already present,
	// including ones a previous iteration of this same pass just added).
	async function backfillMissingAncestors() {
		if (!presupuestoId) return;
		for (const d of [...detalles]) {
			if (d.partida?.id_partida_padre != null) {
				await addAncestorChain(d.partida.id_partida_padre, presupuestoId);
			}
		}
	}

	async function addFromCatalog(p: PartidaCatalog) {
		if (existingIds.has(p.id_partida) || adding !== null) return;
		const pid = await ensurePresupuesto();
		if (!pid) return;
		adding = p.id_partida;
		await addAncestorChain(p.id_partida_padre, pid);
		const { data } = await supabase
			.from('presupuesto_detalle')
			.insert({
				id_presupuesto: pid,
				id_partida: p.id_partida,
				cantidad: 1,
				precio_mo: p.precio_unitario ?? 0,
				precio_mat: 0,
			})
			.select(
				'id_presupuesto_detalle, id_partida, cantidad, precio_mo, precio_mat, precio_unitario, total, partida:id_partida(codigo, descripcion, nivel, id_partida_padre, unidad)'
			)
			.single();
		if (data && (data as any).partida) detalles = [...detalles, data as unknown as Detalle];
		adding = null;
	}

	function fmtN(n: number) {
		return n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}

	onMount(() => {
		load();
	});
</script>

{#if isLoading}
	<div class="flex items-center justify-center py-16 text-orange-500 text-3xl">
		<i class="fas fa-circle-notch fa-spin"></i>
	</div>
{:else}
	<!-- Header -->
	<div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-5">
		<div>
			<h3 class="text-lg font-bold text-slate-800">Presupuesto del Proyecto</h3>
			<p class="text-sm text-slate-500 mt-0.5">
				{detalles.length} partida{detalles.length !== 1 ? 's' : ''} instanciada{detalles.length !== 1 ? 's' : ''}
				{#if ganttLinkedCount > 0}
					· <span class="text-orange-600 font-medium">{ganttLinkedCount} en Gantt</span>
				{/if}
			</p>
		</div>
		<button
			onclick={openModal}
			class="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-sm font-medium shadow-md shadow-orange-600/10 transition-colors whitespace-nowrap"
		>
			<i class="fas fa-plus-circle"></i> Agregar del Catálogo
		</button>
	</div>

	<!-- Gantt-sync notice -->
	{#if ganttLinkedCount > 0}
		<div class="flex items-center gap-2 px-4 py-2.5 bg-orange-50 border border-orange-200 rounded-xl mb-4 text-sm text-orange-700">
			<i class="fas fa-link text-orange-500"></i>
			<span>
				<strong>{ganttLinkedCount}</strong> de las partidas del presupuesto están programadas en la Gestión de Obra.
				Las partidas que agregues en el Gantt aparecen aquí automáticamente.
			</span>
		</div>
	{:else if detalles.length === 0}
		<div class="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl mb-4 text-sm text-slate-500">
			<i class="fas fa-info-circle"></i>
			<span>Agrega partidas desde el catálogo o arrástralas desde el tab de <strong>Gestión de Obra</strong> para verlas aquí.</span>
		</div>
	{/if}

	{#if detalles.length === 0}
		<!-- Empty state -->
		<div class="border-2 border-dashed border-slate-200 rounded-2xl py-16 text-center">
			<i class="fas fa-file-invoice-dollar text-4xl text-slate-300 mb-3"></i>
			<p class="text-slate-500 font-medium mb-1">Sin partidas en el presupuesto</p>
			<p class="text-slate-400 text-sm mb-4">Agrega partidas del catálogo maestro o desde el Gantt.</p>
			<button
				onclick={openModal}
				class="px-5 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-sm font-medium transition-colors"
			>
				<i class="fas fa-plus mr-1.5"></i> Agregar del Catálogo
			</button>
		</div>
	{:else}
		<!-- Budget table -->
		<div class="border border-slate-200 rounded-xl overflow-x-auto">
			<table class="w-full text-sm text-left min-w-[1180px]">
				<thead class="text-xs text-slate-500 bg-slate-50 font-bold uppercase border-b border-slate-200">
					<tr>
						<th class="px-4 py-3 w-28">Item</th>
						<th class="px-4 py-3">Descripción de Partidas</th>
						<th class="px-3 py-3 text-center w-16">Und.</th>
						<th class="px-2 py-3 text-center w-8" title="Programado en Gantt">
							<i class="fas fa-chart-gantt text-slate-400"></i>
						</th>
						<th class="px-3 py-3 text-right w-24">Metrado</th>
						<th class="px-3 py-3 text-right w-24">Precio MO</th>
						<th class="px-3 py-3 text-right w-28">P. Parcial MO</th>
						<th class="px-3 py-3 text-right w-24">Precio Mat.</th>
						<th class="px-3 py-3 text-right w-28">P. Parcial Mat.</th>
						<th class="px-3 py-3 text-right w-24">P. Unitario</th>
						<th class="px-3 py-3 text-right w-28">P. Parcial</th>
						<th class="px-3 py-3 text-center w-16"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each budgetTree as node, i (node.id_presupuesto_detalle)}
						{@render DetalleRow(node, 0, i)}
					{/each}
				</tbody>
				<tfoot class="bg-slate-50 border-t-2 border-slate-200">
					<tr>
						<td colspan="6" class="px-4 py-2.5 text-right text-sm font-bold text-slate-700">Costo Directo:</td>
						<td class="px-3 py-2.5 text-right font-bold text-slate-700 text-sm tabular-nums">{fmtN(costoDirectoMO)}</td>
						<td></td>
						<td class="px-3 py-2.5 text-right font-bold text-slate-700 text-sm tabular-nums">{fmtN(costoDirectoMAT)}</td>
						<td></td>
						<td class="px-3 py-2.5 text-right font-bold text-slate-800 text-sm tabular-nums">{fmtN(grandTotal)}</td>
						<td></td>
					</tr>
					<tr class="border-t border-slate-200">
						<td colspan="10" class="px-4 py-2.5 text-right text-sm font-bold text-slate-700">
							<span class="inline-flex items-center gap-2">
								Gastos Generales
								<input
									type="number"
									min="0"
									step="0.01"
									bind:value={gastosGeneralesPct}
									onblur={saveGastosGenerales}
									disabled={savingGastosGenerales}
									class="w-16 px-1.5 py-0.5 text-right text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none font-medium disabled:bg-slate-50"
								/>
								%:
							</span>
						</td>
						<td class="px-3 py-2.5 text-right font-bold text-slate-700 text-sm tabular-nums">{fmtN(gastosGeneralesMonto)}</td>
						<td></td>
					</tr>
					<tr class="border-t-2 border-slate-300">
						<td colspan="10" class="px-4 py-3 text-right text-sm font-bold text-slate-800">Presupuesto Total (S/):</td>
						<td class="px-3 py-3 text-right font-bold text-orange-700 text-base tabular-nums">{fmtN(presupuestoTotal)}</td>
						<td></td>
					</tr>
				</tfoot>
			</table>
		</div>

		<p class="text-xs text-slate-400 mt-2 text-right">
			MO = mano de obra · Mat. = materiales · Los valores se guardan al salir del campo.
		</p>
	{/if}
{/if}

<!-- ── BUDGET ROW (recursive: renders a <tr> per node, then its children) ── -->
{#snippet DetalleRow(node: DetalleNode, depth: number, rootIndex: number)}
	{@const isGroup     = node.children.length > 0}
	{@const isCategoria = isGroup && depth === 0}
	{@const bandColor   = CATEGORY_COLORS[rootIndex % CATEGORY_COLORS.length]}
	{@const pUnit       = node.precio_mo + node.precio_mat}
	{@const parcialMO   = isGroup ? rollupParcialMO(node) : node.cantidad * node.precio_mo}
	{@const parcialMAT  = isGroup ? rollupParcialMAT(node) : node.cantidad * node.precio_mat}
	{@const rowTotal    = isGroup ? rollupTotal(node) : node.cantidad * pUnit}
	{@const isSaving    = saving.has(node.id_presupuesto_detalle)}
	{@const inGantt     = ganttIds.has(node.id_partida)}
	<tr
		class="transition-colors {isCategoria ? '' : 'hover:bg-slate-50/70'}"
		class:opacity-60={isSaving}
		class:bg-slate-50={isGroup && !isCategoria}
		style={isCategoria ? `background:${bandColor}` : ''}
	>
		<td class="px-4 py-2.5 font-mono text-xs font-medium {isCategoria ? 'text-white' : 'text-slate-500'}" style="padding-left:{16 + depth * 18}px">
			{node.partida?.codigo ?? '—'}
		</td>
		<td class="px-4 py-2.5 {isCategoria ? 'text-white font-bold' : 'text-slate-700'}" class:font-bold={isGroup && !isCategoria} class:font-medium={!isGroup}>
			{node.partida?.descripcion ?? '—'}
		</td>
		<td class="px-3 py-2.5 text-center text-xs {isCategoria ? 'text-white/80' : 'text-slate-500'}">
			{node.partida?.unidad ?? '—'}
		</td>
		<td class="px-2 py-2.5 text-center">
			{#if inGantt}
				<i class="fas fa-chart-gantt text-xs {isCategoria ? 'text-white' : 'text-orange-500'}" title="Programado en Gantt"></i>
			{/if}
		</td>
		{#if isGroup}
			<td class="px-3 py-2.5"></td>
			<td class="px-3 py-2.5"></td>
			<td class="px-3 py-2.5 text-right text-xs font-bold tabular-nums {isCategoria ? 'text-white' : 'text-slate-700'}">{fmtN(parcialMO)}</td>
			<td class="px-3 py-2.5"></td>
			<td class="px-3 py-2.5 text-right text-xs font-bold tabular-nums {isCategoria ? 'text-white' : 'text-slate-700'}">{fmtN(parcialMAT)}</td>
			<td class="px-3 py-2.5"></td>
		{:else}
			<td class="px-3 py-2.5 text-right">
				<input
					type="number"
					min="0"
					step="0.0001"
					bind:value={node.cantidad}
					onblur={() => saveDetalle(node)}
					disabled={isSaving}
					class="w-20 px-2 py-1 text-right text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none font-medium disabled:bg-slate-50"
				/>
			</td>
			<td class="px-3 py-2.5 text-right">
				<input
					type="number"
					min="0"
					step="0.01"
					bind:value={node.precio_mo}
					onblur={() => saveDetalle(node)}
					disabled={isSaving}
					class="w-20 px-2 py-1 text-right text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none font-medium disabled:bg-slate-50"
				/>
			</td>
			<td class="px-3 py-2.5 text-right text-xs text-slate-500 tabular-nums">{fmtN(parcialMO)}</td>
			<td class="px-3 py-2.5 text-right">
				<input
					type="number"
					min="0"
					step="0.01"
					bind:value={node.precio_mat}
					onblur={() => saveDetalle(node)}
					disabled={isSaving}
					class="w-20 px-2 py-1 text-right text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none font-medium disabled:bg-slate-50"
				/>
			</td>
			<td class="px-3 py-2.5 text-right text-xs text-slate-500 tabular-nums">{fmtN(parcialMAT)}</td>
		{/if}
		<td class="px-3 py-2.5 text-right text-xs font-semibold tabular-nums {isCategoria ? 'text-white' : 'text-slate-600'}">
			{isGroup ? '—' : fmtN(pUnit)}
		</td>
		<td class="px-3 py-2.5 text-right text-xs font-bold tabular-nums {isCategoria ? 'text-white' : 'text-slate-800'}">
			{fmtN(rowTotal)}
		</td>
		<td class="px-3 py-2.5 text-center">
			{#if isSaving}
				<i class="fas fa-circle-notch fa-spin text-orange-400 text-xs"></i>
			{:else}
				<button
					onclick={() => deleteDetalle(node.id_presupuesto_detalle)}
					class="w-7 h-7 rounded-lg bg-white border border-slate-200 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 transition-colors text-xs {isCategoria ? 'text-white/70' : 'text-slate-400'}"
					title="Quitar partida"
				>
					<i class="fas fa-trash-alt"></i>
				</button>
			{/if}
		</td>
	</tr>
	{#each node.children as child (child.id_presupuesto_detalle)}
		{@render DetalleRow(child as DetalleNode, depth + 1, rootIndex)}
	{/each}
{/snippet}

<!-- Add-from-catalog modal -->
{#if showModal}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
		onclick={(e) => { if (e.target === e.currentTarget) showModal = false; }}
	>
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[80vh]">
			<!-- Modal header -->
			<div class="flex items-center justify-between p-5 border-b border-slate-100">
				<div>
					<h4 class="text-base font-bold text-slate-800">Agregar al Presupuesto</h4>
					<p class="text-xs text-slate-500 mt-0.5">
						{modalTab === 'partidas' ? 'Selecciona las partidas a incluir en el presupuesto.' : 'Aplica una plantilla completa de partidas de una sola vez.'}
					</p>
				</div>
				<button
					onclick={() => showModal = false}
					class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors"
				>
					<i class="fas fa-times"></i>
				</button>
			</div>

			<!-- Tabs -->
			<div class="flex border-b border-slate-100">
				<button
					onclick={() => selectModalTab('partidas')}
					class="flex-1 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors
						{modalTab === 'partidas' ? 'text-orange-600 border-b-2 border-orange-500' : 'text-slate-400 hover:text-slate-600'}"
				>Partidas</button>
				<button
					onclick={() => selectModalTab('plantillas')}
					class="flex-1 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors
						{modalTab === 'plantillas' ? 'text-orange-600 border-b-2 border-orange-500' : 'text-slate-400 hover:text-slate-600'}"
				>Plantillas</button>
			</div>

			{#if modalTab === 'partidas'}
				<!-- Search -->
				<div class="p-4 border-b border-slate-100">
					<div class="relative">
						<i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
						<input
							type="text"
							bind:value={modalSearch}
							placeholder="Buscar por código o descripción…"
							class="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none"
						/>
					</div>
				</div>
				<!-- Catalog list -->
				<div class="overflow-y-auto flex-1">
					{#if !catLoaded}
						<div class="flex justify-center py-10 text-orange-500 text-2xl">
							<i class="fas fa-circle-notch fa-spin"></i>
						</div>
					{:else if filteredCatalog.length === 0}
						<p class="text-center text-slate-400 py-10 text-sm">Sin resultados</p>
					{:else}
						{#each filteredCatalog as p (p.id_partida)}
							{@const already = existingIds.has(p.id_partida)}
							{@const isAdding = adding === p.id_partida}
							<button
								onclick={() => addFromCatalog(p)}
								disabled={already || isAdding}
								class="w-full flex items-center gap-3 px-5 py-3 text-left border-b border-slate-50 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-default"
							>
								<span
									class="font-mono text-[10px] font-bold px-2 py-0.5 rounded"
									class:bg-orange-100={!already}
									class:text-orange-700={!already}
									class:bg-emerald-100={already}
									class:text-emerald-700={already}
								>
									{p.codigo}
								</span>
								<span class="flex-1 text-sm text-slate-700 font-medium truncate">{p.descripcion}</span>
								{#if p.unidad}
									<span class="text-xs text-slate-400 shrink-0">{p.unidad}</span>
								{/if}
								{#if isAdding}
									<i class="fas fa-circle-notch fa-spin text-orange-400 text-xs shrink-0"></i>
								{:else if already}
									<i class="fas fa-check text-emerald-500 text-xs shrink-0" title="Ya en presupuesto"></i>
								{:else}
									<i class="fas fa-plus text-slate-300 text-xs shrink-0"></i>
								{/if}
							</button>
						{/each}
					{/if}
				</div>
				<!-- Footer -->
				<div class="p-4 border-t border-slate-100 flex justify-between items-center">
					<span class="text-xs text-slate-400">
						{existingIds.size} en presupuesto · {filteredCatalog.length} mostradas
					</span>
					<button
						onclick={() => showModal = false}
						class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-medium transition-colors"
					>
						Listo
					</button>
				</div>
			{:else}
				<!-- Plantillas -->
				<div class="px-4 py-3 border-b border-slate-100">
					<label class="flex items-center gap-2 text-xs text-slate-600">
						<input type="checkbox" bind:checked={usarCantidades} class="rounded border-slate-300 text-orange-500 focus:ring-orange-400" />
						Usar las cantidades sugeridas de la plantilla
					</label>
				</div>
				<div class="overflow-y-auto flex-1">
					{#if !plantillasLoaded}
						<div class="flex justify-center py-10 text-orange-500 text-2xl">
							<i class="fas fa-circle-notch fa-spin"></i>
						</div>
					{:else if plantillas.length === 0}
						<div class="px-5 py-10 text-center text-slate-400 text-sm">
							<i class="fas fa-layer-group text-2xl mb-2 block text-slate-300"></i>
							Sin plantillas disponibles.
						</div>
					{:else}
						{#each plantillas as p (p.id_plantilla)}
							{@const isApplying = applyingPlantillaId === p.id_plantilla}
							<div class="flex items-center gap-3 px-5 py-3 border-b border-slate-50">
								<div class="flex-1 min-w-0">
									<p class="text-sm font-semibold text-slate-800 truncate">{p.nombre}</p>
									{#if p.descripcion}
										<p class="text-xs text-slate-400 truncate">{p.descripcion}</p>
									{/if}
									<p class="text-[10px] text-slate-400 mt-0.5">
										{p.num_partidas} partida{p.num_partidas !== 1 ? 's' : ''}
										{#if p.tipo}· <span class="text-orange-500">{p.tipo}</span>{/if}
									</p>
								</div>
								<button
									onclick={() => aplicarPlantilla(p)}
									disabled={applyingPlantillaId !== null}
									class="flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 hover:bg-orange-100 text-orange-600 border border-orange-200 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 shrink-0"
								>
									{#if isApplying}
										<i class="fas fa-circle-notch fa-spin"></i> Aplicando…
									{:else}
										<i class="fas fa-magic"></i> Aplicar
									{/if}
								</button>
							</div>
						{/each}
					{/if}
				</div>
				<!-- Footer -->
				<div class="p-4 border-t border-slate-100 flex justify-end">
					<button
						onclick={() => showModal = false}
						class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-medium transition-colors"
					>
						Listo
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
