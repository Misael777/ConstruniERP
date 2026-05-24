<script lang="ts">
	import { goto } from '$app/navigation';
	import { hasPermiso } from '$lib/stores/permisos.svelte';
</script>

<svelte:head>
	<title>Módulo de Proyectos | Construni ERP</title>
</svelte:head>

<div class="mb-8">
	<div class="text-xs text-slate-500 mb-2">Inicio &nbsp;>&nbsp; Proyectos</div>
	<h2 class="text-2xl font-bold text-brand-marine">Módulo de Proyectos (Catálogos)</h2>
	<p class="text-sm text-slate-500 mt-1">Selecciona uno de los submódulos para administrar las actividades de Consultoría u Obra civil.</p>
</div>

<div class="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
	<!-- Card 1: Consultorías -->
	<button 
		onclick={() => goto('/proyectos/consultorias')}
		class="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-md hover:border-blue-200/50 transition-all text-left flex items-start gap-4 cursor-pointer group"
	>
		<div class="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center text-2xl group-hover:scale-105 transition-transform flex-shrink-0">
			<i class="fas fa-brain"></i>
		</div>
		<div>
			<h3 class="text-base font-bold text-slate-800 group-hover:text-blue-600 transition-colors">Servicios de Consultoría</h3>
			<p class="text-xs text-slate-500 mt-2 leading-relaxed">
				Administra y cotiza los servicios de consultoría profesional y técnica de la constructora. Controla las tarifas por hora, precios sugeridos y links a expedientes/proformas.
			</p>
			<span class="text-xs font-semibold text-blue-600 flex items-center gap-1 mt-4">
				Ingresar al catálogo <i class="fas fa-arrow-right text-[10px] group-hover:translate-x-1 transition-transform"></i>
			</span>
		</div>
	</button>

	<!-- Card 2: Obras -->
	<button 
		onclick={() => goto('/proyectos/obras')}
		class="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-md hover:border-emerald-200/50 transition-all text-left flex items-start gap-4 cursor-pointer group"
	>
		<div class="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-2xl group-hover:scale-105 transition-transform flex-shrink-0">
			<i class="fas fa-hammer"></i>
		</div>
		<div>
			<h3 class="text-base font-bold text-slate-800 group-hover:text-emerald-600 transition-colors">Proyectos de Obra</h3>
			<p class="text-xs text-slate-500 mt-2 leading-relaxed">
				Administra los proyectos de construcción civil y edificaciones. Controla las valorizaciones, presupuestos iniciales, existencias físicas de materiales y links a carpetas compartidas.
			</p>
			<span class="text-xs font-semibold text-emerald-600 flex items-center gap-1 mt-4">
				Ingresar al catálogo <i class="fas fa-arrow-right text-[10px] group-hover:translate-x-1 transition-transform"></i>
			</span>
		</div>
	</button>
</div>
