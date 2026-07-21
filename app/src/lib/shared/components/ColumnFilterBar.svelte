<script lang="ts">
	/**
	 * Barra de filtros por columna, estilo autofiltro de Excel — genérica, dirigida por FIELDS_CONFIG
	 * (ver fieldConfig.ts: columnFilterKind/applyColumnFilters). Un control por campo `showInTable`:
	 * texto -> "contiene", select -> multi-selección nativa, number/currency -> rango min/max,
	 * date -> rango desde/hasta. Todos los filtros activos se combinan con AND al aplicarse
	 * (ver applyColumnFilters), igual que elegir varios filtros de columna en una hoja de Excel.
	 *
	 * `filters` es bindable: el padre lo pasa con bind:filters y sigue siendo dueño del estado (para
	 * poder leerlo también al armar la query de "Total de Filtrado"). Cambiar cualquier control llama
	 * a onChange para que el padre reconsulte — con debounce solo en los inputs de texto/rango
	 * (mismo criterio que la búsqueda general), select/fecha disparan de inmediato (son elecciones
	 * discretas, no texto que se sigue escribiendo).
	 *
	 * Los campos 'select' (Cliente, Proveedor, Estado, Prioridad, ...) se muestran como dropdown
	 * multi-selección (checkbox por opción) en vez de una fila de botones: escala igual de bien con
	 * 3 opciones (Estado) que con decenas (Cliente/Proveedor), a diferencia de los botones, que con
	 * una lista larga desbordaban la fila. Un solo dropdown abierto a la vez (openDropdown), se cierra
	 * con un backdrop transparente al hacer clic afuera.
	 */
	import { ChevronDown, ChevronUp, X } from '@lucide/svelte';
	import {
		columnFilterKind,
		hasActiveColumnFilters,
		isColumnFilterActive,
		emptyColumnFilters,
		type FieldConfig,
		type FieldOption,
		type ColumnFilters
	} from '$lib/shared/fieldConfig';

	let {
		fields,
		filters = $bindable(),
		dynamicOptions = {},
		onChange
	}: {
		fields: FieldConfig[];
		filters: ColumnFilters;
		dynamicOptions?: Record<string, FieldOption[]>;
		onChange: () => void;
	} = $props();

	let expanded = $state(false);
	let openDropdown = $state<string | null>(null);
	let debounceTimer: ReturnType<typeof setTimeout>;

	const filterableFields = $derived(fields.filter((f) => f.showInTable));
	const activeCount = $derived(Object.values(filters).filter(isColumnFilterActive).length);

	function optionsFor(field: FieldConfig): FieldOption[] {
		return (field.optionsSource && dynamicOptions[field.key]) || field.options || [];
	}

	function triggerDebounced() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(onChange, 400);
	}

	function setText(key: string, value: string) {
		filters = { ...filters, [key]: { kind: 'text', contains: value } };
		triggerDebounced();
	}

	function setRange(key: string, part: 'min' | 'max', value: string) {
		const current = filters[key];
		const base = current && current.kind === 'range' ? current : { kind: 'range' as const, min: '', max: '' };
		filters = { ...filters, [key]: { ...base, [part]: value } };
		triggerDebounced();
	}

	function setDateRange(key: string, part: 'from' | 'to', value: string) {
		const current = filters[key];
		const base = current && current.kind === 'daterange' ? current : { kind: 'daterange' as const, from: '', to: '' };
		filters = { ...filters, [key]: { ...base, [part]: value } };
		onChange(); // fecha es una elección discreta, sin debounce
	}

	function toggleSelectValue(key: string, optionValue: string) {
		const current = filters[key];
		const values = current && current.kind === 'select' ? current.values : [];
		const next = values.includes(optionValue) ? values.filter((v) => v !== optionValue) : [...values, optionValue];
		filters = { ...filters, [key]: { kind: 'select', values: next } };
		onChange();
	}

	function clearAll() {
		filters = emptyColumnFilters(fields);
		onChange();
	}
</script>

<div class="mb-4">
	<button
		type="button"
		onclick={() => (expanded = !expanded)}
		class="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50"
	>
		{#if expanded}<ChevronUp size={16} />{:else}<ChevronDown size={16} />{/if}
		Filtros
		{#if activeCount > 0}
			<span class="text-xs font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">{activeCount}</span>
		{/if}
	</button>

	{#if expanded}
		<div class="mt-2 p-4 bg-white rounded-xl border border-slate-200">
			<div class="flex flex-col gap-4 max-w-md">
				{#each filterableFields as field (field.key)}
					{@const kind = columnFilterKind(field)}
					{@const raw = filters[field.key]}
					<div>
						<span class="block text-xs font-semibold text-slate-500 mb-1">{field.label}</span>

						{#if kind === 'text'}
							<input
								type="text"
								value={raw?.kind === 'text' ? raw.contains : ''}
								oninput={(e) => setText(field.key, (e.target as HTMLInputElement).value)}
								placeholder="Contiene..."
								class="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
							/>
						{:else if kind === 'select'}
							{@const options = optionsFor(field)}
							{@const selected = raw?.kind === 'select' ? raw.values : []}
							{@const isOpen = openDropdown === field.key}
							<div class="relative">
								<button
									type="button"
									onclick={() => (openDropdown = isOpen ? null : field.key)}
									class={`w-full min-w-0 flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-sm text-left focus:outline-none focus:ring-2 focus:ring-blue-200 ${
										selected.length > 0 ? 'border-blue-300 bg-blue-50' : 'border-slate-300 hover:bg-slate-50'
									}`}
								>
									<span class="min-w-0 flex-1 truncate text-slate-700">
										{#if selected.length === 0}
											Todos
										{:else if selected.length === 1}
											{options.find((o) => o.value === selected[0])?.label ?? selected[0]}
										{:else}
											{selected.length} seleccionados
										{/if}
									</span>
									<ChevronDown size={14} class="text-slate-400 shrink-0" />
								</button>

								{#if isOpen}
									<div class="fixed inset-0 z-10" onclick={() => (openDropdown = null)}></div>
									<div class="absolute left-0 right-0 top-full mt-1 z-20 bg-white rounded-lg border border-slate-200 shadow-lg max-h-56 overflow-y-auto py-1">
										{#each options as opt (opt.value)}
											<label class="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">
												<input
													type="checkbox"
													checked={selected.includes(opt.value)}
													onchange={() => toggleSelectValue(field.key, opt.value)}
													class="rounded border-slate-300 text-blue-600 focus:ring-blue-200 shrink-0"
												/>
												<span class="min-w-0 flex-1 truncate text-slate-700">{opt.label}</span>
											</label>
										{:else}
											<p class="px-3 py-2 text-xs text-slate-400">Sin opciones</p>
										{/each}
									</div>
								{/if}
							</div>
						{:else if kind === 'range'}
							{@const rangeVal = raw?.kind === 'range' ? raw : { min: '', max: '' }}
							<!-- Apilado (no lado a lado): los inputs nativos number/date tienen un ancho mínimo
							     que el navegador impone y no se puede encoger — dos uno junto al otro en una
							     columna angosta se desbordaban sobre la celda vecina. Apilados, cada uno vive
							     en su propia línea de ancho completo, sin ese problema sin importar cuán
							     angosta sea la columna. -->
							<div class="space-y-1.5">
								<input
									type="number"
									value={rangeVal.min}
									oninput={(e) => setRange(field.key, 'min', (e.target as HTMLInputElement).value)}
									placeholder="Mín"
									class="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
								/>
								<input
									type="number"
									value={rangeVal.max}
									oninput={(e) => setRange(field.key, 'max', (e.target as HTMLInputElement).value)}
									placeholder="Máx"
									class="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
								/>
							</div>
						{:else}
							{@const dateVal = raw?.kind === 'daterange' ? raw : { from: '', to: '' }}
							<!-- type="date" ignora el atributo placeholder (el navegador siempre muestra
							     mm/dd/yyyy) -> se necesita una etiqueta aparte para distinguir desde/hasta. -->
							<div class="space-y-1.5">
								<div>
									<span class="block text-[10px] text-slate-400 mb-0.5">Desde</span>
									<input
										type="date"
										value={dateVal.from}
										onchange={(e) => setDateRange(field.key, 'from', (e.target as HTMLInputElement).value)}
										class="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
									/>
								</div>
								<div>
									<span class="block text-[10px] text-slate-400 mb-0.5">Hasta</span>
									<input
										type="date"
										value={dateVal.to}
										onchange={(e) => setDateRange(field.key, 'to', (e.target as HTMLInputElement).value)}
										class="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
									/>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>

			{#if activeCount > 0}
				<div class="mt-3 pt-3 border-t border-slate-100 flex justify-end">
					<button type="button" onclick={clearAll} class="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-red-600">
						<X size={14} /> Limpiar filtros
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>
