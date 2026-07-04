<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';

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

	// ── STATE ──────────────────────────────────────────────────────────────────
	let presupuestoId = $state<number | null>(null);
	let detalles      = $state<Detalle[]>([]);
	let isLoading     = $state(true);
	let ganttIds      = $state(new Set<number>());

	let showModal   = $state(false);
	let modalSearch = $state('');
	let catalog     = $state<PartidaCatalog[]>([]);
	let catLoaded   = $state(false);
	let adding      = $state<number | null>(null);
	let saving      = $state(new Set<number>());

	// ── DERIVED ────────────────────────────────────────────────────────────────
	let sorted = $derived(
		[...detalles].sort((a, b) =>
			(a.partida?.codigo ?? '').localeCompare(b.partida?.codigo ?? '', 'es', { numeric: true })
		)
	);

	let grandTotal = $derived(
		detalles.reduce((s, d) => s + d.cantidad * (d.precio_mo + d.precio_mat), 0)
	);

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
				.select('id_presupuesto')
				.eq('id_proyecto', projectId)
				.order('created_at', { ascending: false })
				.limit(1)
				.maybeSingle();

			presupuestoId = pres?.id_presupuesto ?? null;

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

	async function deleteDetalle(id: number) {
		if (!confirm('¿Quitar esta partida del presupuesto?')) return;
		await supabase.from('presupuesto_detalle').delete().eq('id_presupuesto_detalle', id);
		detalles = detalles.filter(d => d.id_presupuesto_detalle !== id);
	}

	async function openModal() {
		showModal = true;
		if (!catLoaded) {
			const { data } = await supabase.from('partida').select('*').order('codigo');
			catalog = (data ?? []) as PartidaCatalog[];
			catLoaded = true;
		}
	}

	async function addFromCatalog(p: PartidaCatalog) {
		if (existingIds.has(p.id_partida) || adding !== null) return;
		const pid = await ensurePresupuesto();
		if (!pid) return;
		adding = p.id_partida;
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
			<table class="w-full text-sm text-left min-w-[900px]">
				<thead class="text-xs text-slate-500 bg-slate-50 font-bold uppercase border-b border-slate-200">
					<tr>
						<th class="px-4 py-3 w-28">Item</th>
						<th class="px-4 py-3">Descripción</th>
						<th class="px-3 py-3 text-center w-16">Und.</th>
						<th class="px-2 py-3 text-center w-8" title="Programado en Gantt">
							<i class="fas fa-chart-gantt text-slate-400"></i>
						</th>
						<th class="px-3 py-3 text-right w-28">Metrado</th>
						<th class="px-3 py-3 text-right w-28">P. MO (S/)</th>
						<th class="px-3 py-3 text-right w-28">P. Mat. (S/)</th>
						<th class="px-3 py-3 text-right w-28">P. Unit.</th>
						<th class="px-3 py-3 text-right w-32">Total (S/)</th>
						<th class="px-3 py-3 text-center w-16"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each sorted as det (det.id_presupuesto_detalle)}
						{@const pUnit = det.precio_mo + det.precio_mat}
						{@const rowTotal = det.cantidad * pUnit}
						{@const isSaving = saving.has(det.id_presupuesto_detalle)}
						{@const inGantt  = ganttIds.has(det.id_partida)}
						<tr
							class="hover:bg-slate-50/70 transition-colors"
							class:opacity-60={isSaving}
						>
							<td class="px-4 py-2.5 font-mono text-xs text-slate-500 font-medium">
								{det.partida?.codigo ?? '—'}
							</td>
							<td class="px-4 py-2.5 text-slate-700 font-medium">
								{det.partida?.descripcion ?? '—'}
							</td>
							<td class="px-3 py-2.5 text-center text-slate-500 text-xs">
								{det.partida?.unidad ?? '—'}
							</td>
							<td class="px-2 py-2.5 text-center">
								{#if inGantt}
									<i class="fas fa-chart-gantt text-orange-500 text-xs" title="Programado en Gantt"></i>
								{/if}
							</td>
							<td class="px-3 py-2.5 text-right">
								<input
									type="number"
									min="0"
									step="0.0001"
									bind:value={det.cantidad}
									onblur={() => saveDetalle(det)}
									disabled={isSaving}
									class="w-24 px-2 py-1 text-right text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none font-medium disabled:bg-slate-50"
								/>
							</td>
							<td class="px-3 py-2.5 text-right">
								<input
									type="number"
									min="0"
									step="0.01"
									bind:value={det.precio_mo}
									onblur={() => saveDetalle(det)}
									disabled={isSaving}
									class="w-24 px-2 py-1 text-right text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none font-medium disabled:bg-slate-50"
								/>
							</td>
							<td class="px-3 py-2.5 text-right">
								<input
									type="number"
									min="0"
									step="0.01"
									bind:value={det.precio_mat}
									onblur={() => saveDetalle(det)}
									disabled={isSaving}
									class="w-24 px-2 py-1 text-right text-xs bg-white border border-slate-200 rounded-lg focus:border-orange-400 focus:ring-1 focus:ring-orange-400 outline-none font-medium disabled:bg-slate-50"
								/>
							</td>
							<td class="px-3 py-2.5 text-right text-xs text-slate-600 font-semibold tabular-nums">
								{fmtN(pUnit)}
							</td>
							<td class="px-3 py-2.5 text-right text-xs font-bold text-slate-800 tabular-nums">
								{fmtN(rowTotal)}
							</td>
							<td class="px-3 py-2.5 text-center">
								{#if isSaving}
									<i class="fas fa-circle-notch fa-spin text-orange-400 text-xs"></i>
								{:else}
									<button
										onclick={() => deleteDetalle(det.id_presupuesto_detalle)}
										class="w-7 h-7 rounded-lg bg-white border border-slate-200 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 text-slate-400 transition-colors text-xs"
										title="Quitar partida"
									>
										<i class="fas fa-trash-alt"></i>
									</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
				<tfoot class="bg-slate-50 border-t-2 border-slate-200">
					<tr>
						<td colspan="8" class="px-4 py-3 text-right text-sm font-bold text-slate-700">
							Costo Directo Total (S/):
						</td>
						<td class="px-3 py-3 text-right font-bold text-orange-700 text-base tabular-nums">
							{fmtN(grandTotal)}
						</td>
						<td></td>
					</tr>
				</tfoot>
			</table>
		</div>

		<p class="text-xs text-slate-400 mt-2 text-right">
			P. MO = mano de obra · P. Mat. = materiales · Los valores se guardan al salir del campo.
		</p>
	{/if}
{/if}

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
					<h4 class="text-base font-bold text-slate-800">Catálogo Maestro de Partidas</h4>
					<p class="text-xs text-slate-500 mt-0.5">Selecciona las partidas a incluir en el presupuesto.</p>
				</div>
				<button
					onclick={() => showModal = false}
					class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors"
				>
					<i class="fas fa-times"></i>
				</button>
			</div>
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
		</div>
	</div>
{/if}
