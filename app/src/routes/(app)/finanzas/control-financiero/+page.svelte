<script lang="ts">
	// Orquestador delgado de las 4 pestañas de Control Financiero (evolución de la antigua "Dashboard
	// Finanzas" — a pedido explícito del usuario: pasa de solo MOSTRAR información financiera a
	// verificar → detectar → conciliar → generar incidencia → resolver → auditar → volver a verificar).
	// Mismo patrón de tabs que finanzas/centros-de-costos/+page.svelte. Cada pestaña es su propio
	// componente con su propio fetch/estado — no se precargan las 4 de una, solo la que está visible.
	import DashboardTab from '$lib/modules/control-financiero/components/DashboardTab.svelte';
	import IgvTab from '$lib/modules/control-financiero/components/IgvTab.svelte';
	import ConsistenciaTab from '$lib/modules/control-financiero/components/ConsistenciaTab.svelte';
	import ConciliacionTab from '$lib/modules/control-financiero/components/ConciliacionTab.svelte';
	import IncidenciasTab from '$lib/modules/control-financiero/components/IncidenciasTab.svelte';
	import { Shield } from '@lucide/svelte';

	let activeTab = $state<'dashboard' | 'igv' | 'consistencia' | 'conciliacion' | 'incidencias'>('dashboard');
</script>

<svelte:head>
	<title>Control Financiero | Construni ERP</title>
</svelte:head>

<div class="mb-4">
	<h1 class="text-2xl font-bold text-brand-marine flex items-center gap-2">
		<Shield size={24} class="text-blue-600" /> Control Financiero
	</h1>
	<p class="text-sm text-slate-500 mt-1">Capa de supervisión del módulo financiero: verificar, conciliar, detectar diferencias y dar seguimiento a su resolución.</p>
</div>

<!-- Tabs -->
<div class="mb-6 flex gap-1 border-b border-slate-200">
	<button
		type="button"
		onclick={() => (activeTab = 'dashboard')}
		class={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
			activeTab === 'dashboard' ? 'border-[#0f3b5e] text-[#0f3b5e]' : 'border-transparent text-slate-500 hover:text-slate-700'
		}`}
	>
		Dashboard
	</button>
	<button
		type="button"
		onclick={() => (activeTab = 'igv')}
		class={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
			activeTab === 'igv' ? 'border-[#0f3b5e] text-[#0f3b5e]' : 'border-transparent text-slate-500 hover:text-slate-700'
		}`}
	>
		Control de IGV
	</button>
	<button
		type="button"
		onclick={() => (activeTab = 'consistencia')}
		class={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
			activeTab === 'consistencia' ? 'border-[#0f3b5e] text-[#0f3b5e]' : 'border-transparent text-slate-500 hover:text-slate-700'
		}`}
	>
		Consistencia
	</button>
	<button
		type="button"
		onclick={() => (activeTab = 'conciliacion')}
		class={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
			activeTab === 'conciliacion' ? 'border-[#0f3b5e] text-[#0f3b5e]' : 'border-transparent text-slate-500 hover:text-slate-700'
		}`}
	>
		Conciliación
	</button>
	<button
		type="button"
		onclick={() => (activeTab = 'incidencias')}
		class={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
			activeTab === 'incidencias' ? 'border-[#0f3b5e] text-[#0f3b5e]' : 'border-transparent text-slate-500 hover:text-slate-700'
		}`}
	>
		Incidencias
	</button>
</div>

{#if activeTab === 'dashboard'}
	<DashboardTab />
{:else if activeTab === 'igv'}
	<IgvTab />
{:else if activeTab === 'consistencia'}
	<ConsistenciaTab />
{:else if activeTab === 'conciliacion'}
	<ConciliacionTab />
{:else if activeTab === 'incidencias'}
	<IncidenciasTab />
{/if}
