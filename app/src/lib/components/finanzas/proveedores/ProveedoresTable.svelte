<script lang="ts">
	import ResponsiveDataView from '$lib/shared/components/ResponsiveDataView.svelte';

	let {
		proveedores = [],
		modoEliminados = false,
		onEdit = (proveedor: any) => {},
		onDarDeBaja = (id: number) => {},
		onRestaurar = (id: number) => {},
		onEliminarPermanente = (id: number) => {}
	} = $props<{
		proveedores?: any[];
		modoEliminados?: boolean;
		onEdit?: (proveedor: any) => void;
		onDarDeBaja?: (id: number) => void;
		onRestaurar?: (id: number) => void;
		onEliminarPermanente?: (id: number) => void;
	}>();

	let searchTerm = $state('');
	/** null = sin ordenar (orden de llegada); si no, alfabético A-Z por razón social o por producto. */
	let sortBy = $state<'razon_social' | 'vendedor' | null>(null);

	const filteredProveedores = $derived.by(() => {
		const term = searchTerm.trim().toLowerCase();
		let result = term
			? proveedores.filter((p: any) =>
					String(p.razon_social ?? '').toLowerCase().includes(term) ||
					String(p.ruc ?? '').toLowerCase().includes(term) ||
					String(p.contacto ?? '').toLowerCase().includes(term) ||
					String(p.email ?? '').toLowerCase().includes(term) ||
					String(p.vendedor ?? '').toLowerCase().includes(term)
				)
			: proveedores;

		const activeSortBy = sortBy;
		if (activeSortBy) {
			result = [...result].sort((a: any, b: any) =>
				String(a[activeSortBy] ?? '').localeCompare(String(b[activeSortBy] ?? ''), 'es', { sensitivity: 'base' })
			);
		}
		return result;
	});

	const columns = [
		{ label: 'Razón Social' },
		{ label: 'RUC / DNI' },
		{ label: 'Contacto Principal' },
		{ label: 'Producto o Servicio' },
		{ label: 'Acciones', align: 'center' as const }
	];
</script>

<div class="bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col md:h-full md:overflow-hidden">

	<!-- Filters Bar -->
	<div class="p-4 border-b border-slate-100 flex flex-wrap items-center gap-4">
		<div class="flex flex-col gap-1 flex-1 min-w-[200px]">
			<div class="relative">
				<input bind:value={searchTerm} type="text" placeholder="Buscar por Razón Social, RUC, Contacto o Producto..." class="text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 w-full pl-9">
				<i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
			</div>
		</div>
		<div class="flex items-center gap-2">
			<button
				type="button"
				onclick={() => (sortBy = sortBy === 'razon_social' ? null : 'razon_social')}
				class={`px-3 py-2 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors ${sortBy === 'razon_social' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
			>
				<i class="fas fa-arrow-down-a-z"></i> Razón Social (A-Z)
			</button>
			<button
				type="button"
				onclick={() => (sortBy = sortBy === 'vendedor' ? null : 'vendedor')}
				class={`px-3 py-2 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors ${sortBy === 'vendedor' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
			>
				<i class="fas fa-arrow-down-a-z"></i> Producto (A-Z)
			</button>
		</div>
	</div>

	<!-- Table / Cards -->
	<div class="overflow-x-auto md:overflow-y-auto md:flex-1">
		{#if proveedores.length === 0}
			<div class="p-12 text-center flex flex-col items-center justify-center text-slate-500">
				<div class="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
					<i class="fas fa-truck text-2xl text-slate-300"></i>
				</div>
				<p class="font-medium">{modoEliminados ? 'No hay proveedores eliminados.' : 'No hay proveedores registrados.'}</p>
				<p class="text-sm text-slate-400 mt-1">{modoEliminados ? 'Los proveedores dados de baja aparecerán acá.' : 'Haz clic en "Nuevo Proveedor" para empezar.'}</p>
			</div>
		{:else}
			<ResponsiveDataView items={filteredProveedores} keyField="id_proveedor" {columns} emptyMessage="Ningún proveedor coincide con esa búsqueda.">
				{#snippet row(proveedor)}
					<td class="px-5 py-4 font-medium text-slate-800">
						<div class="max-w-[250px] truncate">{proveedor.razon_social}</div>
					</td>
					<td class="px-5 py-4">
						<span class="font-semibold text-slate-700">{proveedor.ruc}</span>
					</td>
					<td class="px-5 py-4">
						<div class="flex flex-col gap-1 text-slate-600">
							{#if proveedor.contacto}
								<div class="font-medium text-slate-800 text-xs mb-0.5">{proveedor.contacto}</div>
							{/if}
							{#if proveedor.email}
								<div class="flex items-center gap-2 text-xs">
									<i class="fas fa-envelope text-slate-400 w-3 text-center"></i>
									<span>{proveedor.email}</span>
								</div>
							{/if}
							{#if proveedor.telefono}
								<div class="flex items-center gap-2 text-xs">
									<i class="fas fa-phone-alt text-slate-400 w-3 text-center"></i>
									<span>{proveedor.telefono}</span>
								</div>
							{/if}
							{#if !proveedor.email && !proveedor.telefono && !proveedor.contacto}
								<span class="text-xs text-slate-400 italic">Sin datos</span>
							{/if}
						</div>
					</td>
					<td class="px-5 py-4 text-slate-600">
						{#if proveedor.vendedor}
							<span class="px-2.5 py-1 bg-slate-100 rounded text-xs font-medium border border-slate-200">{proveedor.vendedor}</span>
						{:else}
							<span class="text-xs text-slate-400 italic">Sin producto</span>
						{/if}
					</td>
					<td class="px-5 py-4 text-center">
						<div class="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
							{#if modoEliminados}
								<button onclick={() => onRestaurar(proveedor.id_proveedor)} class="w-8 h-8 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 flex items-center justify-center transition-colors tooltip-wrapper" title="Restaurar">
									<i class="fas fa-rotate-left text-xs"></i>
								</button>
								<button onclick={() => onEliminarPermanente(proveedor.id_proveedor)} class="w-8 h-8 rounded bg-rose-50 text-rose-600 hover:bg-rose-100 flex items-center justify-center transition-colors tooltip-wrapper" title="Eliminar permanentemente">
									<i class="fas fa-trash-alt text-xs"></i>
								</button>
							{:else}
								<button onclick={() => onEdit(proveedor)} class="w-8 h-8 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 flex items-center justify-center transition-colors tooltip-wrapper" title="Editar">
									<i class="fas fa-pen text-xs"></i>
								</button>
								<button onclick={() => onDarDeBaja(proveedor.id_proveedor)} class="w-8 h-8 rounded bg-rose-50 text-rose-600 hover:bg-rose-100 flex items-center justify-center transition-colors tooltip-wrapper" title="Dar de baja">
									<i class="fas fa-trash text-xs"></i>
								</button>
							{/if}
						</div>
					</td>
				{/snippet}
				{#snippet card(proveedor)}
					<div class="flex items-start justify-between gap-3 mb-2">
						<div class="min-w-0">
							<div class="font-semibold text-slate-800 truncate">{proveedor.razon_social}</div>
							<div class="text-xs text-slate-500 mt-0.5">RUC {proveedor.ruc}</div>
						</div>
						{#if proveedor.vendedor}
							<span class="shrink-0 px-2.5 py-1 bg-slate-100 rounded text-[11px] font-medium border border-slate-200">{proveedor.vendedor}</span>
						{:else}
							<span class="shrink-0 text-[11px] text-slate-400 italic">Sin producto</span>
						{/if}
					</div>
					<div class="flex flex-col gap-1 text-slate-600 mb-3">
						{#if proveedor.contacto}
							<div class="font-medium text-slate-800 text-xs">{proveedor.contacto}</div>
						{/if}
						{#if proveedor.email}
							<div class="flex items-center gap-2 text-xs">
								<i class="fas fa-envelope text-slate-400 w-3 text-center"></i>
								<span class="truncate">{proveedor.email}</span>
							</div>
						{/if}
						{#if proveedor.telefono}
							<div class="flex items-center gap-2 text-xs">
								<i class="fas fa-phone-alt text-slate-400 w-3 text-center"></i>
								<span>{proveedor.telefono}</span>
							</div>
						{/if}
						{#if !proveedor.email && !proveedor.telefono && !proveedor.contacto}
							<span class="text-xs text-slate-400 italic">Sin datos</span>
						{/if}
					</div>
					<div class="flex items-center gap-2 pt-2 border-t border-slate-100">
						{#if modoEliminados}
							<button onclick={() => onRestaurar(proveedor.id_proveedor)} class="flex-1 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center gap-2 text-xs font-medium active:bg-emerald-100" aria-label="Restaurar">
								<i class="fas fa-rotate-left text-xs"></i> Restaurar
							</button>
							<button onclick={() => onEliminarPermanente(proveedor.id_proveedor)} class="flex-1 h-10 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center gap-2 text-xs font-medium active:bg-rose-100" aria-label="Eliminar permanentemente">
								<i class="fas fa-trash-alt text-xs"></i> Eliminar
							</button>
						{:else}
							<button onclick={() => onEdit(proveedor)} class="flex-1 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center gap-2 text-xs font-medium active:bg-blue-100" aria-label="Editar">
								<i class="fas fa-pen text-xs"></i> Editar
							</button>
							<button onclick={() => onDarDeBaja(proveedor.id_proveedor)} class="flex-1 h-10 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center gap-2 text-xs font-medium active:bg-rose-100" aria-label="Dar de baja">
								<i class="fas fa-trash text-xs"></i> Dar de baja
							</button>
						{/if}
					</div>
				{/snippet}
			</ResponsiveDataView>
		{/if}
	</div>

	<!-- Pagination Footer -->
	{#if proveedores.length > 0}
		<div class="p-4 border-t border-slate-100 flex items-center justify-between mt-auto bg-slate-50/30">
			<span class="text-xs text-slate-500 font-medium">
				Mostrando {filteredProveedores.length}{filteredProveedores.length !== proveedores.length ? ` de ${proveedores.length}` : ''} registros
			</span>
		</div>
	{/if}
</div>
