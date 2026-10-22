<script lang="ts">
	/**
	 * Proyectos → Catálogo (a pedido del usuario, con imágenes de referencia): "Catálogos generales CONSTRUNI" con
	 * seis pestañas — Recursos (catálogo general para los APU), Partidas (consulta), Unidades, Gastos generales,
	 * Procesos constructivos y Seguridad y SST. Las tres últimas tienen por ahora la estructura base (sin datos)
	 * hasta definir su diseño. La pestaña activa va en naranja, como en la imagen.
	 */
	import CatalogoRecursos from '$lib/modules/catalogo/components/CatalogoRecursos.svelte';
	import CatalogoPartidas from '$lib/modules/catalogo/components/CatalogoPartidas.svelte';
	import CatalogoUnidades from '$lib/modules/catalogo/components/CatalogoUnidades.svelte';
	import SubmoduloEnPreparacion from '$lib/modules/proyectos/components/SubmoduloEnPreparacion.svelte';
	import { Boxes, ListChecks, DraftingCompass, Cog, Network, ShieldCheck } from '@lucide/svelte';

	type Pestana = 'recursos' | 'partidas' | 'unidades' | 'gastos' | 'procesos' | 'sst';
	let pestana = $state<Pestana>('recursos');
	const PESTANAS = [
		{ v: 'recursos' as const, l: 'Recursos', icono: Boxes },
		{ v: 'partidas' as const, l: 'Partidas', icono: ListChecks },
		{ v: 'unidades' as const, l: 'Unidades', icono: DraftingCompass },
		{ v: 'gastos' as const, l: 'Gastos generales', icono: Cog },
		{ v: 'procesos' as const, l: 'Procesos constructivos', icono: Network },
		{ v: 'sst' as const, l: 'Seguridad y SST', icono: ShieldCheck }
	];
</script>

<div class="w-full">
	<p class="mb-2 text-base font-bold text-[#0f3b5e]">Catálogos generales CONSTRUNI</p>
	<div class="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
		{#each PESTANAS as p (p.v)}
			{@const activa = pestana === p.v}
			<button
				type="button"
				onclick={() => (pestana = p.v)}
				aria-current={activa ? 'page' : undefined}
				class={`flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors ${activa ? 'border-orange-500 text-orange-600 font-semibold' : 'border-transparent font-medium text-slate-600 hover:text-slate-800'}`}
			>
				<span class={`flex h-7 w-7 items-center justify-center rounded-md ${activa ? 'border border-orange-400 text-orange-500' : 'text-blue-700'}`}><p.icono size={17} /></span>
				{p.l}
			</button>
		{/each}
	</div>

	{#if pestana === 'recursos'}
		<CatalogoRecursos />
	{:else if pestana === 'partidas'}
		<CatalogoPartidas />
	{:else if pestana === 'unidades'}
		<CatalogoUnidades />
	{:else if pestana === 'gastos'}
		<SubmoduloEnPreparacion
			titulo="Gastos generales"
			descripcion="Catálogo de gastos generales fijos y variables para el presupuesto de obra."
			columnas={['Código', 'Concepto', 'Tipo (fijo / variable)', 'Unidad', 'Monto de referencia (S/)']}
			textoBuscador="Buscar por código o concepto..."
			textoVacio="Todavía no hay gastos generales en el catálogo."
		/>
	{:else if pestana === 'procesos'}
		<SubmoduloEnPreparacion
			titulo="Procesos constructivos"
			descripcion="Procesos constructivos estándar y las partidas que involucran."
			columnas={['Código', 'Proceso', 'Etapa', 'Partidas relacionadas', 'Descripción']}
			textoBuscador="Buscar por código, proceso o etapa..."
			textoVacio="Todavía no hay procesos constructivos en el catálogo."
		/>
	{:else}
		<SubmoduloEnPreparacion
			titulo="Seguridad y SST"
			descripcion="Elementos de seguridad y salud en el trabajo: EPP, señalización y medidas de protección."
			columnas={['Código', 'Elemento', 'Categoría', 'Unidad', 'Precio de referencia (S/)', 'Norma / referencia']}
			textoBuscador="Buscar por código, elemento o categoría..."
			textoVacio="Todavía no hay elementos de seguridad y SST en el catálogo."
		/>
	{/if}
</div>
