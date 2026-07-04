<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { dndzone } from 'svelte-dnd-action';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin } from '$lib/stores/permisos.svelte';
	import { toast } from '$lib/stores/toast';
	import { formatCurrency, type FieldOption } from '$lib/shared/fieldConfig';
	import { ArrowLeft, Package, GripVertical } from '@lucide/svelte';
	import {
		getPagosPendientes,
		getProyeccionIngresos,
		getProyectoOptions,
		computePrioridad,
		computeEstadoVencimiento,
		type PagoPendienteItem,
		type Prioridad
	} from '$lib/modules/panoramas/services/panoramas.service';

	// Tablero de planeación de flujo de caja: reutiliza cuentas_pagar para leer los pagos pendientes,
	// pero la organización en Panorama 1 / Panorama 2 es 100% de la sesión actual — NO se guarda en
	// la BD (decisión explícita: "esto solo es para ordenar cómo se harán los pagos"). Las columnas
	// panorama_id/panorama_orden quedaron creadas en cuentas_pagar y las funciones assignToPanorama/
	// getPanoramaItems siguen en panoramas.service.ts por si más adelante se decide persistir esto;
	// hoy no se usan. Si recargas la página, los panoramas vuelven a quedar vacíos.
	//
	// Drag-and-drop con svelte-dnd-action (funciona con mouse Y touch) para que arrastrar tarjetas
	// funcione igual en Windows y en Android/Tauri, no solo en escritorio.
	//
	// OJO: el {#each} de cada zona usa (item.id) como clave, NO (item.id_cuenta_pagar) — la librería
	// inserta temporalmente un ítem "fantasma" (con `id` pero sin `id_cuenta_pagar`) mientras se
	// arrastra; si la clave del {#each} no coincide con la que usa la librería, Svelte se confunde
	// reconciliando la lista y la tarjeta arrastrada puede "desaparecer" visualmente.

	const PANORAMAS = [
		{ id: 1 as const, nombre: 'Panorama 1', subtitulo: 'Escenario base' },
		{ id: 2 as const, nombre: 'Panorama 2', subtitulo: 'Escenario optimizado' }
	];

	// Clases Tailwind LITERALES por panorama (no se puede interpolar `bg-${color}-100`: el
	// compilador de Tailwind no detecta clases armadas en runtime y las omitiría del CSS final).
	const panoramaBadgeClass: Record<1 | 2, string> = {
		1: 'bg-blue-100 text-blue-700',
		2: 'bg-emerald-100 text-emerald-700'
	};

	const prioridadBadgeClass: Record<Prioridad, string> = {
		alta: 'bg-red-100 text-red-700',
		media: 'bg-amber-100 text-amber-700',
		baja: 'bg-emerald-100 text-emerald-700'
	};
	const prioridadLabel: Record<Prioridad, string> = { alta: 'Alta', media: 'Media', baja: 'Baja' };

	const estadoVencBadgeClass = { vencido: 'bg-red-100 text-red-700', por_vencer: 'bg-amber-100 text-amber-700' };
	const estadoVencLabel = { vencido: 'Vencido', por_vencer: 'Por vencer' };

	let loading = $state(true);
	let loadError = $state('');

	let bandeja = $state<PagoPendienteItem[]>([]);
	let panorama1 = $state<PagoPendienteItem[]>([]);
	let panorama2 = $state<PagoPendienteItem[]>([]);
	let proyeccionIngresos = $state(0);
	let proyectoOptions = $state<FieldOption[]>([]);

	let filtroObra = $state('');
	let filtroPrioridad = $state<'' | Prioridad>('');

	function panoramaItems(id: 1 | 2) {
		return id === 1 ? panorama1 : panorama2;
	}
	function setPanoramaItems(id: 1 | 2, items: PagoPendienteItem[]) {
		if (id === 1) panorama1 = items;
		else panorama2 = items;
	}

	/** Trae la bandeja desde la BD, excluyendo lo que YA está en un panorama en esta sesión (si no,
	 * al cambiar un filtro reaparecería en la bandeja un pago que el usuario ya arrastró a un panorama). */
	async function fetchBandeja() {
		loading = true;
		try {
			const data = await getPagosPendientes(supabase, {
				idProyecto: filtroObra ? Number(filtroObra) : null,
				prioridad: filtroPrioridad || null
			});
			const idsAsignados = new Set([...panorama1, ...panorama2].map((i) => i.id));
			bandeja = data.filter((i) => !idsAsignados.has(i.id));
			loadError = '';
		} catch (err: any) {
			loadError = err.message || 'No se pudo cargar el tablero de panoramas';
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		if (!isAdmin()) {
			goto('/dashboard');
			return;
		}
		try {
			[proyectoOptions, proyeccionIngresos] = await Promise.all([getProyectoOptions(supabase), getProyeccionIngresos(supabase)]);
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar las obras/proyección de ingresos');
		}
		await fetchBandeja();
	});

	function refetchOnFilterChange() {
		fetchBandeja();
	}

	function proyeccionPagos(id: 1 | 2) {
		return panoramaItems(id).reduce((sum, i) => sum + i.monto, 0);
	}
	function flujoProyectado(id: 1 | 2) {
		return proyeccionIngresos - proyeccionPagos(id);
	}

	// --- Drag and drop: 100% local, no toca la BD (ver nota arriba) ---
	const FLIP_MS = 150;

	function handleBandejaConsider(e: CustomEvent<{ items: PagoPendienteItem[] }>) {
		bandeja = e.detail.items;
	}
	function handleBandejaFinalize(e: CustomEvent<{ items: PagoPendienteItem[] }>) {
		bandeja = e.detail.items;
	}

	function handlePanoramaConsider(id: 1 | 2, e: CustomEvent<{ items: PagoPendienteItem[] }>) {
		setPanoramaItems(id, e.detail.items);
	}
	function handlePanoramaFinalize(id: 1 | 2, e: CustomEvent<{ items: PagoPendienteItem[] }>) {
		setPanoramaItems(id, e.detail.items);
	}
</script>

<div class="max-w-[1600px] mx-auto">
	<div class="flex items-center gap-3 mb-6">
		<button type="button" onclick={() => goto('/finanzas/cuentas-pagar')} class="p-2 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Volver a Cuentas por Pagar">
			<ArrowLeft size={18} />
		</button>
		<div>
			<h1 class="text-xl font-bold text-[#0f3b5e]">Panoramas de Pago</h1>
			<p class="text-sm text-slate-500">Organiza cómo se harán los pagos (solo en esta sesión, no se guarda en la base de datos)</p>
		</div>
	</div>

	{#if loadError}
		<div class="mb-4 bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm">{loadError}</div>
	{/if}

	<div class="grid grid-cols-1 lg:grid-cols-[320px_1fr_1fr] gap-4 items-start">
		<!-- Bandeja -->
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-1">
				<h2 class="font-bold text-slate-800 text-sm uppercase tracking-wide">Bandeja de Pagos Pendientes</h2>
				<span class="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{bandeja.length}</span>
			</div>
			<p class="text-xs text-slate-400 mb-3">Arrastra los pagos para asignarlos a un panorama.</p>

			<button type="button" onclick={() => goto('/finanzas/cuentas-pagar')} class="w-full mb-3 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-blue-200 text-blue-600 text-sm font-medium hover:bg-blue-50">
				+ Nuevo pago pendiente
			</button>

			<div class="flex flex-col gap-2 mb-3">
				<select value={filtroObra} onchange={(e) => { filtroObra = (e.target as HTMLSelectElement).value; refetchOnFilterChange(); }} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
					<option value="">Todas las obras</option>
					{#each proyectoOptions as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
				<select value={filtroPrioridad} onchange={(e) => { filtroPrioridad = (e.target as HTMLSelectElement).value as any; refetchOnFilterChange(); }} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
					<option value="">Prioridad: Todas</option>
					<option value="alta">Prioridad: Alta</option>
					<option value="media">Prioridad: Media</option>
					<option value="baja">Prioridad: Baja</option>
				</select>
			</div>

			<div
				use:dndzone={{ items: bandeja, flipDurationMs: FLIP_MS }}
				onconsider={handleBandejaConsider}
				onfinalize={handleBandejaFinalize}
				class="flex flex-col gap-2 min-h-[100px]"
			>
				{#each bandeja as item (item.id)}
					{@const prioridad = computePrioridad(item.fechaVencimiento)}
					<div class="flex items-start gap-2 p-3 rounded-lg border border-slate-200 bg-white cursor-grab active:cursor-grabbing">
						<GripVertical size={14} class="text-slate-300 mt-1 shrink-0" />
						<div class="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
							<Package size={16} />
						</div>
						<div class="flex-1 min-w-0">
							<p class="text-sm font-semibold text-slate-800 truncate">{item.titulo}</p>
							<p class="text-xs text-slate-500 truncate">Proveedor: {item.proveedorNombre}</p>
							<p class="text-[11px] text-slate-400">Vencimiento: {item.fechaVencimiento ?? '—'}</p>
							<div class="flex items-center justify-between mt-1">
								<span class="text-sm font-bold text-slate-800">{formatCurrency(item.monto)}</span>
								<span class={`px-2 py-0.5 rounded-full text-[10px] font-medium ${prioridadBadgeClass[prioridad]}`}>{prioridadLabel[prioridad]}</span>
							</div>
						</div>
					</div>
				{:else}
					<p class="text-xs text-slate-400 text-center py-6">{loading ? 'Cargando...' : 'Sin pagos pendientes por asignar.'}</p>
				{/each}
			</div>
		</div>

		<!-- Panoramas -->
		{#each PANORAMAS as panorama (panorama.id)}
			<div class="bg-white rounded-xl border border-slate-200 p-4">
				<div class="flex items-center justify-between mb-4">
					<div class="flex items-center gap-2">
						<h2 class="font-bold text-slate-800">{panorama.nombre}</h2>
						<span class={`text-[10px] font-medium px-2 py-0.5 rounded-full ${panoramaBadgeClass[panorama.id]}`}>{panorama.subtitulo}</span>
					</div>
				</div>

				<div class="grid grid-cols-3 gap-2 mb-4 text-center">
					<div>
						<p class="text-[10px] text-slate-400 uppercase">Proyección de ingresos</p>
						<p class="text-sm font-bold text-emerald-600">{formatCurrency(proyeccionIngresos)}</p>
					</div>
					<div>
						<p class="text-[10px] text-slate-400 uppercase">Proyección de pagos</p>
						<p class="text-sm font-bold text-red-600">{formatCurrency(proyeccionPagos(panorama.id))}</p>
					</div>
					<div>
						<p class="text-[10px] text-slate-400 uppercase">Flujo proyectado</p>
						<p class={`text-sm font-bold ${flujoProyectado(panorama.id) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(flujoProyectado(panorama.id))}</p>
					</div>
				</div>

				<p class="text-xs text-slate-400 mb-2">Orden de prioridad (arrastra para reordenar)</p>

				<div
					use:dndzone={{ items: panoramaItems(panorama.id), flipDurationMs: FLIP_MS }}
					onconsider={(e) => handlePanoramaConsider(panorama.id, e)}
					onfinalize={(e) => handlePanoramaFinalize(panorama.id, e)}
					class="flex flex-col gap-2 min-h-[100px]"
				>
					{#each panoramaItems(panorama.id) as item, index (item.id)}
						{@const estado = computeEstadoVencimiento(item.fechaVencimiento)}
						<div class={`flex items-center gap-2 p-3 rounded-lg border cursor-grab active:cursor-grabbing ${estado === 'vencido' ? 'bg-red-50/60 border-red-100' : 'border-slate-200 bg-white'}`}>
							<GripVertical size={14} class="text-slate-300 shrink-0" />
							<span class={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${panoramaBadgeClass[panorama.id]}`}>{index + 1}</span>
							<div class="flex-1 min-w-0">
								<p class="text-sm font-semibold text-slate-800 truncate">{item.titulo}</p>
								<p class="text-xs text-slate-500 truncate">Proveedor: {item.proveedorNombre}</p>
								<p class="text-[11px] text-slate-400">Vencimiento: {item.fechaVencimiento ?? '—'}</p>
							</div>
							<div class="text-right shrink-0">
								<p class="text-sm font-bold text-slate-800">{formatCurrency(item.monto)}</p>
								<span class={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${estadoVencBadgeClass[estado]}`}>{estadoVencLabel[estado]}</span>
							</div>
						</div>
					{:else}
						<p class="text-xs text-slate-400 text-center py-6">Suelta aquí un pago de la bandeja.</p>
					{/each}
				</div>
			</div>
		{/each}
	</div>
</div>
