<script lang="ts">
	// Checklist de partidas al instanciar una Plantilla en el presupuesto de un proyecto — a pedido
	// explícito del usuario: antes se insertaban TODAS las filas de la plantilla sin excepción
	// (instanciarPlantilla, ahora reemplazada por instanciarPlantillaSeleccion). Compartido por los dos
	// puntos de entrada: el botón "Instanciar en proyecto" de PlantillaDetail.svelte (sin proyecto
	// todavía elegido, trae su propio selector) y la pestaña "Plantillas" de "Agregar del Catálogo" en
	// PresupuestoTab.svelte (el proyecto ya se conoce, ver `idProyectoInicial`).
	import { supabase } from '$lib/supabaseClient';
	import { X, Folder, FileText, Loader2 } from '@lucide/svelte';
	import { fetchPlantillaDetalleData, instanciarPlantillaSeleccion, proyectosList, fetchProyectos } from '$lib/stores/partidas';
	import type { PlantillaDetalle } from '$lib/stores/partidas';
	import { buildTree, flattenSubtree, type WithChildren } from '$lib/utils/tree';

	let {
		open = false,
		idPlantilla,
		nombrePlantilla,
		idProyectoInicial = null,
		onClose,
		onConfirmed
	}: {
		open: boolean;
		idPlantilla: number;
		nombrePlantilla: string;
		/** Si viene seteado (ej. desde PresupuestoTab.svelte, donde el proyecto ya se conoce), se oculta
		 * el selector de proyecto y se usa este directamente. */
		idProyectoInicial?: number | null;
		onClose: () => void;
		onConfirmed: (info: { idProyecto: number; count: number }) => void;
	} = $props();

	let loading = $state(false);
	let confirming = $state(false);
	let errorMsg = $state('');
	let detalle = $state<PlantillaDetalle[]>([]);
	let checkedIds = $state<Set<number>>(new Set());
	let usarCantidades = $state(true);
	let idProyectoSeleccionado = $state<number | null>(null);

	const tree = $derived(buildTree(detalle, 'id_partida', 'id_partida_padre') as WithChildren<PlantillaDetalle>[]);

	// Arranca con TODO marcado (a pedido del usuario, es más "quita lo que no aplica" que "elige desde
	// cero" — menos sorpresa frente al comportamiento anterior de instanciar la plantilla completa).
	$effect(() => {
		if (!open) return;
		idProyectoSeleccionado = idProyectoInicial ?? null;
		errorMsg = '';
		usarCantidades = true;
		loading = true;
		(async () => {
			try {
				const rows = await fetchPlantillaDetalleData(idPlantilla);
				detalle = rows;
				checkedIds = new Set(rows.map((r) => r.id_partida));
				if (!idProyectoInicial) await fetchProyectos();
			} catch (err: any) {
				errorMsg = err.message ?? String(err);
			} finally {
				loading = false;
			}
		})();
	});

	/** 'marcado' si TODO el subárbol (el nodo + sus descendientes) está marcado, 'vacio' si nada lo
	 * está, 'indeterminado' si solo una parte — controla el checkbox del nodo (incluyendo su estado
	 * `indeterminate`, que no tiene equivalente en HTML puro, ver template). */
	function estadoNodo(node: WithChildren<PlantillaDetalle>): 'marcado' | 'indeterminado' | 'vacio' {
		const ids = flattenSubtree(node).map((n) => n.id_partida);
		const marcados = ids.filter((id) => checkedIds.has(id)).length;
		if (marcados === 0) return 'vacio';
		if (marcados === ids.length) return 'marcado';
		return 'indeterminado';
	}

	// Marcar/desmarcar un nodo marca/desmarca todo su subárbol (descendientes) — nunca sus ancestros:
	// eso mantiene el cálculo de estadoNodo simple (solo mira hacia abajo). Los ancestros que hagan
	// falta para que el árbol quede conectado se completan solos al confirmar, en el servicio.
	function toggleNodo(node: WithChildren<PlantillaDetalle>) {
		const ids = flattenSubtree(node).map((n) => n.id_partida);
		const marcarTodo = estadoNodo(node) !== 'marcado';
		const nuevo = new Set(checkedIds);
		for (const id of ids) {
			if (marcarTodo) nuevo.add(id);
			else nuevo.delete(id);
		}
		checkedIds = nuevo;
	}

	async function confirmar() {
		if (!idProyectoSeleccionado) {
			errorMsg = 'Elige el proyecto destino.';
			return;
		}
		if (checkedIds.size === 0) {
			errorMsg = 'Marca al menos una partida.';
			return;
		}
		confirming = true;
		errorMsg = '';
		try {
			const {
				data: { session }
			} = await supabase.auth.getSession();
			const userId = session?.user?.id;
			if (!userId) {
				errorMsg = 'No hay sesión activa. Recarga la página.';
				return;
			}
			const res = await instanciarPlantillaSeleccion(idPlantilla, idProyectoSeleccionado, [...checkedIds], usarCantidades, userId);
			if (!res.success) {
				errorMsg = res.message;
				return;
			}
			onConfirmed({ idProyecto: idProyectoSeleccionado, count: (res as any).count ?? 0 });
			onClose();
		} finally {
			confirming = false;
		}
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
			<div class="flex items-center justify-between bg-white px-6 py-4 border-b border-slate-200 shrink-0">
				<div class="min-w-0">
					<h2 class="text-lg font-semibold text-[#0f3b5e]">Instanciar plantilla</h2>
					<p class="text-xs text-slate-500 mt-0.5 truncate">{nombrePlantilla}</p>
				</div>
				<button type="button" onclick={onClose} class="p-1 hover:bg-slate-100 rounded-full text-slate-500 shrink-0" aria-label="Cerrar">
					<X size={20} />
				</button>
			</div>

			<div class="p-6 flex flex-col gap-4 overflow-y-auto min-h-0">
				{#if !idProyectoInicial}
					<div>
						<label for="ipm-proyecto" class="block text-sm font-medium text-[#0f3b5e] mb-1"> Proyecto destino * </label>
						<select
							id="ipm-proyecto"
							bind:value={idProyectoSeleccionado}
							class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
						>
							<option value={null}>— Elige un proyecto —</option>
							{#each $proyectosList as p}
								<option value={p.id_proyecto}>{p.nombre_proyecto}</option>
							{/each}
						</select>
					</div>
				{/if}

				<label class="flex items-center gap-2 text-sm text-slate-600">
					<input type="checkbox" bind:checked={usarCantidades} class="rounded border-slate-300 text-blue-600 focus:ring-blue-400" />
					Usar las cantidades sugeridas
				</label>

				<div class="min-h-0">
					<p class="text-sm font-medium text-[#0f3b5e] mb-1">Elige qué partidas aplican a este presupuesto</p>
					<p class="text-xs text-slate-400 mb-2">Lo que no marques no se agregará al presupuesto del proyecto.</p>
					<div class="rounded-lg border border-slate-200 max-h-[42vh] overflow-y-auto">
						{#if loading}
							<div class="text-sm text-slate-400 text-center py-6">Cargando partidas...</div>
						{:else if tree.length === 0}
							<div class="text-sm text-slate-400 text-center py-6 italic">Esta plantilla no tiene partidas.</div>
						{:else}
							{#each tree as node (node.id_partida)}
								{@render fila(node, 0)}
							{/each}
						{/if}
					</div>
				</div>

				{#if errorMsg}
					<p class="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{errorMsg}</p>
				{/if}
			</div>

			<div class="flex gap-2 justify-end bg-white px-6 py-4 border-t border-slate-200 shrink-0">
				<button
					type="button"
					onclick={onClose}
					disabled={confirming}
					class="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
				>
					Cancelar
				</button>
				<button
					type="button"
					onclick={confirmar}
					disabled={confirming || loading}
					class="px-4 py-2 text-sm font-medium rounded-lg bg-[#0f3b5e] text-white hover:bg-[#0c2f4c] disabled:opacity-50 flex items-center gap-2"
				>
					{#if confirming}<Loader2 size={16} class="animate-spin" />{/if}
					Instanciar en el presupuesto
				</button>
			</div>
		</div>
	</div>
{/if}

{#snippet fila(node: WithChildren<PlantillaDetalle>, indent: number)}
	{@const estado = estadoNodo(node)}
	{@const esGrupo = node.children.length > 0}
	<div
		class="flex items-center gap-2 py-1.5 border-b border-slate-100 last:border-0 text-sm"
		style={`padding-left:${indent * 16 + 12}px; padding-right:12px`}
	>
		<input
			type="checkbox"
			checked={estado === 'marcado'}
			indeterminate={estado === 'indeterminado'}
			onchange={() => toggleNodo(node)}
			class="rounded border-slate-300 text-blue-600 focus:ring-blue-400 shrink-0"
		/>
		<span class="shrink-0 {esGrupo ? 'text-amber-500' : 'text-slate-300'}">
			{#if esGrupo}
				<Folder size={13} fill="currentColor" />
			{:else}
				<FileText size={13} />
			{/if}
		</span>
		<span class="font-mono text-[11px] font-bold shrink-0 {esGrupo ? 'text-amber-600' : 'text-slate-400'}">{node.codigo}</span>
		<span class="flex-1 truncate {esGrupo ? 'font-semibold text-[#1e293b]' : 'text-[#475569]'}">{node.nombre_partida}</span>
	</div>
	{#each node.children as child (child.id_partida)}
		{@render fila(child, indent + 1)}
	{/each}
{/snippet}
