<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Network, DataSet } from 'vis-network/standalone';
	import 'vis-network/styles/vis-network.css';
	import { formatCurrency } from '$lib/shared/fieldConfig';
	import { TIPO_CENTRO_COSTO_LABELS, type NodoFlujo, type AristaFlujo } from '$lib/modules/dashboard-finanzas/services/dashboardFinanzas.service';
	import { Waypoints } from '@lucide/svelte';

	let { nodos = [], aristas = [], onNodeClick }: { nodos: NodoFlujo[]; aristas: AristaFlujo[]; onNodeClick?: (id: number) => void } = $props();

	let containerEl: HTMLDivElement | undefined = $state();
	let network: Network | null = null;

	// Paleta fija por tipo de centro de costo — se usa como color de borde del nodo, independiente del
	// color de relleno (que codifica el signo del saldo: verde = superávit, rojo = déficit). Así un
	// nodo comunica dos cosas a la vez: de qué tipo es (borde) y si está en positivo o negativo (relleno).
	const PALETA_TIPO: Record<string, string> = {
		obra: '#f59e0b',
		consultoria: '#8b5cf6',
		'bolsa general': '#0ea5e9',
		area: '#64748b',
		otro: '#94a3b8',
		proyecto: '#3b82f6',
		cliente: '#10b981',
		proveedor: '#ef4444',
		empleado: '#ec4899',
		subcontratista: '#f97316'
	};

	function construirGrafo() {
		if (!containerEl) return;

		const nodesData = new DataSet(
			nodos.map((n) => ({
				id: n.id,
				label: `${n.codigo}\n${formatCurrency(n.saldo)}`,
				title: `${n.nombre} (${TIPO_CENTRO_COSTO_LABELS[n.tipo] ?? n.tipo})\nSaldo: ${formatCurrency(n.saldo)}`,
				value: Math.max(Math.abs(n.saldo), 1),
				color: {
					background: n.saldo >= 0 ? '#d1fae5' : '#fee2e2',
					border: PALETA_TIPO[n.tipo] ?? '#94a3b8',
					highlight: { background: n.saldo >= 0 ? '#a7f3d0' : '#fecaca', border: PALETA_TIPO[n.tipo] ?? '#94a3b8' }
				},
				font: { color: n.saldo >= 0 ? '#065f46' : '#991b1b', size: 12, face: 'inherit', multi: false, align: 'center' }
			}))
		);

		const edgesData = new DataSet(
			aristas.map((a, i) => ({
				id: i,
				from: a.origen,
				to: a.destino,
				value: a.monto,
				title: `${formatCurrency(a.monto)}${a.cantidad > 1 ? ` (${a.cantidad} movimientos)` : ''}`,
				color: { color: '#94a3b8', highlight: '#3b82f6' },
				arrows: { to: { enabled: true, scaleFactor: 0.6 } },
				smooth: { enabled: true, type: 'dynamic', roundness: 0.5 }
			}))
		);

		if (network) {
			network.setData({ nodes: nodesData as any, edges: edgesData as any });
			return;
		}

		network = new Network(
			containerEl,
			{ nodes: nodesData as any, edges: edgesData as any },
			{
				nodes: {
					shape: 'dot',
					scaling: { min: 16, max: 46, label: { enabled: false } },
					borderWidth: 3,
					shadow: true
				},
				edges: {
					scaling: { min: 1, max: 9 },
					shadow: false
				},
				physics: {
					barnesHut: { gravitationalConstant: -12000, springLength: 140, springConstant: 0.03 },
					stabilization: { iterations: 250 }
				},
				interaction: { hover: true, tooltipDelay: 150 }
			}
		);

		network.once('stabilizationIterationsDone', () => {
			network?.setOptions({ physics: false });
		});

		network.on('click', (params) => {
			if (params.nodes.length > 0 && onNodeClick) onNodeClick(params.nodes[0] as number);
		});
	}

	$effect(() => {
		// Se re-lee `nodos`/`aristas` acá adentro (no solo en construirGrafo) para que $effect las
		// registre como dependencias y reconstruya el grafo cuando cambian los filtros.
		void nodos;
		void aristas;
		construirGrafo();
	});

	onDestroy(() => {
		network?.destroy();
		network = null;
	});
</script>

{#if nodos.length === 0}
	<div class="flex flex-col items-center justify-center h-full text-slate-400 py-16">
		<Waypoints size={40} class="mb-3 text-slate-300" />
		<p class="text-sm">Sin movimientos entre centros de costo todavía.</p>
	</div>
{:else}
	<div bind:this={containerEl} class="w-full h-full min-h-[420px]"></div>
	<div class="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 pt-3 border-t border-slate-100">
		{#each Object.entries(PALETA_TIPO) as [tipo, color]}
			<span class="inline-flex items-center gap-1.5 text-[10px] text-slate-500 font-medium">
				<span class="w-2.5 h-2.5 rounded-full" style={`background:${color}`}></span>
				{TIPO_CENTRO_COSTO_LABELS[tipo] ?? tipo}
			</span>
		{/each}
	</div>
{/if}
