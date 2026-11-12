<script lang="ts">
	/**
	 * Historial de obras o áreas, huelleros y referentes de un trabajador (personal_historial_asignacion, solo
	 * lectura: lo llenan triggers en la base). Se muestra en la ficha (Vínculo laboral) y en el resumen ⓘ.
	 */
	import { supabase } from '$lib/supabaseClient';
	import { describeError } from '$lib/shared/describeError';
	import { getHistorialAsignaciones, type Asignacion } from '$lib/modules/personal/services/personal.service';

	let { idPersonal }: { idPersonal: number } = $props();

	type Filtro = 'todo' | Asignacion['tipo'];
	const FILTROS: { id: Filtro; texto: string }[] = [
		{ id: 'todo', texto: 'Todo' },
		{ id: 'obra', texto: 'Obras o áreas' },
		{ id: 'huellero', texto: 'Huelleros' },
		{ id: 'referente', texto: 'Referentes' }
	];
	const TIPOS: Record<Asignacion['tipo'], { texto: string; icono: string; clase: string }> = {
		obra: { texto: 'Obra o área', icono: 'fa-helmet-safety', clase: 'bg-blue-50 text-blue-700' },
		huellero: { texto: 'Huellero', icono: 'fa-fingerprint', clase: 'bg-violet-50 text-violet-700' },
		referente: { texto: 'Referente', icono: 'fa-user-tie', clase: 'bg-amber-50 text-amber-700' }
	};

	let lista = $state<Asignacion[]>([]);
	let cargando = $state(true);
	let error = $state('');
	let filtro = $state<Filtro>('todo');

	$effect(() => {
		const id = idPersonal;
		cargando = true;
		error = '';
		getHistorialAsignaciones(supabase, id)
			.then((l) => {
				if (id === idPersonal) lista = l;
			})
			.catch((e) => (error = describeError(e)))
			.finally(() => (cargando = false));
	});

	const visibles = $derived(filtro === 'todo' ? lista : lista.filter((a) => a.tipo === filtro));
	const conteo = (f: Filtro) => (f === 'todo' ? lista.length : lista.filter((a) => a.tipo === f).length);
	const fecha = (f: string | null) => (f ? new Date(f).toLocaleDateString('es-PE', { timeZone: 'America/Lima' }) : null);
	const texto = (a: Asignacion) => (a.tipo === 'referente' ? [a.referente_nombre, a.referente_cargo].filter(Boolean).join(' · ') : a.detalle) || '—';
</script>

<div class="flex flex-col gap-2">
	<div class="flex flex-wrap gap-1.5">
		{#each FILTROS as f (f.id)}
			<button
				type="button"
				onclick={() => (filtro = f.id)}
				class={`px-2.5 py-1 rounded-full border text-xs font-medium ${filtro === f.id ? 'bg-orange-50 border-orange-300 text-orange-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
			>
				{f.texto} <span class="text-slate-400">{conteo(f.id)}</span>
			</button>
		{/each}
	</div>

	{#if cargando}
		<span class="text-xs text-slate-400"><i class="fas fa-spinner fa-spin"></i> Cargando historial…</span>
	{:else if error}
		<span class="text-xs text-rose-600">No se pudo leer el historial. {error}</span>
	{:else if !visibles.length}
		<span class="text-xs text-slate-400 italic">Sin registros.</span>
	{:else}
		<div class="border border-slate-200 rounded-xl overflow-hidden">
			<div class="hidden sm:grid grid-cols-[8.5rem_minmax(0,1fr)_6rem_6rem_5.5rem] gap-2 px-3 py-2 bg-slate-100 text-xs font-semibold text-slate-600">
				<span>Tipo</span><span>Asignación</span><span>Desde</span><span>Hasta</span><span>Estado</span>
			</div>
			{#each visibles as a (a.id_historial)}
				<div class="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[8.5rem_minmax(0,1fr)_6rem_6rem_5.5rem] items-center gap-x-2 gap-y-1 px-3 py-2 border-t border-slate-100 first:border-t-0 text-sm">
					<span><span class={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded ${TIPOS[a.tipo].clase}`}><i class={`fas ${TIPOS[a.tipo].icono}`}></i> {TIPOS[a.tipo].texto}</span></span>
					<span class="sm:order-none order-3 col-span-2 sm:col-span-1 text-slate-800 [overflow-wrap:anywhere]">{texto(a)}</span>
					<span class="order-4 sm:order-none text-xs text-slate-600"><span class="sm:hidden text-slate-400">Desde </span>{fecha(a.fecha_inicio)}</span>
					<span class="order-5 sm:order-none text-xs text-slate-600"><span class="sm:hidden text-slate-400">Hasta </span>{fecha(a.fecha_fin) ?? '—'}</span>
					<span class="order-2 sm:order-none justify-self-end sm:justify-self-start">
						<span class={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${a.fecha_fin ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>{a.fecha_fin ? 'Cerrado' : 'Vigente'}</span>
					</span>
				</div>
			{/each}
		</div>
	{/if}
	<span class="text-xs text-slate-400">Se registra solo cada vez que cambian la obra o área, los huelleros o el referente.</span>
</div>
