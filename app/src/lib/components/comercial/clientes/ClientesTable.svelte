<script lang="ts">
	let { clientes = [], onEdit = (cliente: any) => {}, onDelete = (id: number) => {} } = $props<{
		clientes?: any[];
		onEdit?: (cliente: any) => void;
		onDelete?: (id: number) => void;
	}>();

	let searchTerm = '';
	let tipoFilter = 'Todos';
	let activeFilterColumn: string | null = null;
	let showColumnPanel = false;
	let visibleColumns = {
		nombre: true,
		tipo: true,
		documento: true,
		contacto: true
	};
	let columnFilters = {
		nombre: 'Todos',
		tipo: 'Todos',
		documento: 'Todos',
		contacto: 'Todos'
	};

	function getTipoBadgeColor(tipo: string) {
		if (tipo === 'J') return 'bg-blue-50 text-blue-600 border-blue-200';
		if (tipo === 'N') return 'bg-emerald-50 text-emerald-600 border-emerald-200';
		return 'bg-slate-50 text-slate-600 border-slate-200';
	}

	function getTipoLabel(tipo: string) {
		if (tipo === 'J') return 'Empresa';
		if (tipo === 'N') return 'Persona';
		return tipo;
	}

	function normalizeValue(value: string | number | null | undefined) {
		return String(value ?? '').trim().toLowerCase();
	}

	function getColumnValues(column: string): string[] {
		switch (column) {
			case 'nombre': {
				const values = Array.from(new Set(clientes.map((cliente: any) => String(cliente.nombre || '').trim()).filter(Boolean))) as string[];
				return values.sort((a, b) => a.localeCompare(b));
			}
			case 'tipo':
				return ['Empresa', 'Persona'];
			case 'documento': {
				const values = Array.from(new Set(clientes.map((cliente: any) => String(cliente.num_documento || '').trim()).filter(Boolean))) as string[];
				return values.sort((a, b) => a.localeCompare(b));
			}
			case 'contacto':
				return ['Con email', 'Con teléfono', 'Con email y teléfono', 'Sin contacto'];
			default:
				return [];
		}
	}

	function getContactoLabel(cliente: any) {
		const hasEmail = Boolean(cliente.email);
		const hasTelefono = Boolean(cliente.telefono);
		if (hasEmail && hasTelefono) return 'Con email y teléfono';
		if (hasEmail) return 'Con email';
		if (hasTelefono) return 'Con teléfono';
		return 'Sin contacto';
	}

	function toggleColumnFilter(column: string) {
		activeFilterColumn = activeFilterColumn === column ? null : column;
	}

	function applyColumnFilter(column: string, value: string) {
		columnFilters = { ...columnFilters, [column]: value };
		activeFilterColumn = null;
	}

	function clearColumnFilter(column: string) {
		columnFilters = { ...columnFilters, [column]: 'Todos' };
	}

	function clearAllFilters() {
		searchTerm = '';
		tipoFilter = 'Todos';
		columnFilters = {
			nombre: 'Todos',
			tipo: 'Todos',
			documento: 'Todos',
			contacto: 'Todos'
		};
		activeFilterColumn = null;
	}

	let filteredClientes = $derived.by(() =>
		clientes.filter((cliente: any) => {
			const term = searchTerm.trim().toLowerCase();
			const searchMatch = !term || [cliente.nombre, cliente.num_documento, cliente.tipo_doc, cliente.email, cliente.telefono]
				.join(' ')
				.toLowerCase()
				.includes(term);

			const tipoMatch = tipoFilter === 'Todos' || String(cliente.tip_persona) === (tipoFilter === 'Empresa' ? 'J' : 'N');

			const nombreMatch = columnFilters.nombre === 'Todos' || normalizeValue(cliente.nombre) === normalizeValue(columnFilters.nombre);
			const tipoColumnMatch = columnFilters.tipo === 'Todos' || getTipoLabel(cliente.tip_persona) === columnFilters.tipo;
			const documentoMatch = columnFilters.documento === 'Todos' || normalizeValue(cliente.num_documento) === normalizeValue(columnFilters.documento);
			const contactoMatch = columnFilters.contacto === 'Todos' || getContactoLabel(cliente) === columnFilters.contacto;

			return searchMatch && tipoMatch && nombreMatch && tipoColumnMatch && documentoMatch && contactoMatch;
		})
	);
</script>

<div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col h-full">
	
	<!-- Filters Bar -->
	<div class="p-4 border-b border-slate-100 flex flex-wrap items-center gap-4">
		<div class="flex flex-col gap-1 flex-1 min-w-[200px]">
			<div class="relative">
				<input bind:value={searchTerm} type="text" placeholder="Buscar por Razón Social, RUC o Nombre..." class="text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 w-full pl-9">
				<i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
			</div>
		</div>
		<div class="flex flex-col gap-1 min-w-[140px]">
			<select bind:value={tipoFilter} class="text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-slate-700">
				<option value="Todos">Tipo (Todos)</option>
				<option value="Empresa">Empresa (J)</option>
				<option value="Persona">Persona (N)</option>
			</select>
		</div>
		<div class="relative">
			<button onclick={() => (showColumnPanel = !showColumnPanel)} class="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2">
				<i class="fas fa-columns"></i> Columnas
			</button>
			{#if showColumnPanel}
				<div class="absolute right-0 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-xl z-20">
					<p class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Mostrar columnas</p>
					<div class="space-y-2 text-sm text-slate-600">
						<label class="flex items-center gap-2">
							<input type="checkbox" bind:checked={visibleColumns.nombre} />
							<span>Razón Social / Nombre</span>
						</label>
						<label class="flex items-center gap-2">
							<input type="checkbox" bind:checked={visibleColumns.tipo} />
							<span>Tipo</span>
						</label>
						<label class="flex items-center gap-2">
							<input type="checkbox" bind:checked={visibleColumns.documento} />
							<span>Documento</span>
						</label>
						<label class="flex items-center gap-2">
							<input type="checkbox" bind:checked={visibleColumns.contacto} />
							<span>Contacto</span>
						</label>
					</div>
				</div>
			{/if}
		</div>
		<button onclick={clearAllFilters} class="text-sm font-semibold text-blue-600 hover:bg-blue-50 px-3 py-2 rounded-lg transition-colors">
			<i class="fas fa-undo"></i> Limpiar
		</button>
	</div>

	<!-- Table -->
	<div class="overflow-x-auto flex-1">
		{#if clientes.length === 0}
			<div class="p-12 text-center flex flex-col items-center justify-center text-slate-500 h-full">
				<div class="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
					<i class="fas fa-users text-2xl text-slate-300"></i>
				</div>
				<p class="font-medium">No hay clientes registrados.</p>
				<p class="text-sm text-slate-400 mt-1">Haz clic en "Nuevo Cliente" para empezar.</p>
			</div>
		{:else}
			<table class="w-full text-left text-sm whitespace-nowrap">
				<thead class="text-xs text-slate-500 bg-slate-50/50 font-semibold border-b border-slate-100">
					<tr>
						{#if visibleColumns.nombre}
							<th class="px-5 py-4 relative">
								<div class="relative flex items-center gap-2">
									<span>Razón Social / Nombre</span>
									<button onclick={() => toggleColumnFilter('nombre')} class="text-slate-400 hover:text-blue-600 transition-colors">
										<i class="fas fa-filter"></i>
									</button>
								</div>
								{#if activeFilterColumn === 'nombre'}
									<div class="absolute mt-2 w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-xl z-20 text-left">
										<div class="flex items-center justify-between mb-2">
											<p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Filtrar por nombre</p>
											<button onclick={() => clearColumnFilter('nombre')} class="text-[11px] text-blue-600">Limpiar</button>
										</div>
										<div class="max-h-48 overflow-y-auto space-y-1">
											<button onclick={() => applyColumnFilter('nombre', 'Todos')} class="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50">Todos</button>
											{#each getColumnValues('nombre') as value}
												<button onclick={() => applyColumnFilter('nombre', value)} class="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50">{value}</button>
											{/each}
										</div>
									</div>
								{/if}
							</th>
						{/if}
						{#if visibleColumns.tipo}
							<th class="px-5 py-4 relative">
								<div class="relative flex items-center gap-2">
									<span>Tipo</span>
									<button onclick={() => toggleColumnFilter('tipo')} class="text-slate-400 hover:text-blue-600 transition-colors">
										<i class="fas fa-filter"></i>
									</button>
								</div>
								{#if activeFilterColumn === 'tipo'}
									<div class="absolute mt-2 w-44 rounded-xl border border-slate-200 bg-white p-3 shadow-xl z-20 text-left">
										<div class="flex items-center justify-between mb-2">
											<p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Filtrar por tipo</p>
											<button onclick={() => clearColumnFilter('tipo')} class="text-[11px] text-blue-600">Limpiar</button>
										</div>
										<div class="space-y-1">
											<button onclick={() => applyColumnFilter('tipo', 'Todos')} class="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50">Todos</button>
											{#each getColumnValues('tipo') as value}
												<button onclick={() => applyColumnFilter('tipo', value)} class="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50">{value}</button>
											{/each}
										</div>
									</div>
								{/if}
							</th>
						{/if}
						{#if visibleColumns.documento}
							<th class="px-5 py-4 relative">
								<div class="relative flex items-center gap-2">
									<span>Documento</span>
									<button onclick={() => toggleColumnFilter('documento')} class="text-slate-400 hover:text-blue-600 transition-colors">
										<i class="fas fa-filter"></i>
									</button>
								</div>
								{#if activeFilterColumn === 'documento'}
									<div class="absolute mt-2 w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-xl z-20 text-left">
										<div class="flex items-center justify-between mb-2">
											<p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Filtrar por documento</p>
											<button onclick={() => clearColumnFilter('documento')} class="text-[11px] text-blue-600">Limpiar</button>
										</div>
										<div class="max-h-48 overflow-y-auto space-y-1">
											<button onclick={() => applyColumnFilter('documento', 'Todos')} class="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50">Todos</button>
											{#each getColumnValues('documento') as value}
												<button onclick={() => applyColumnFilter('documento', value)} class="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50">{value}</button>
											{/each}
										</div>
									</div>
								{/if}
							</th>
						{/if}
						{#if visibleColumns.contacto}
							<th class="px-5 py-4 relative">
								<div class="relative flex items-center gap-2">
									<span>Contacto</span>
									<button onclick={() => toggleColumnFilter('contacto')} class="text-slate-400 hover:text-blue-600 transition-colors">
										<i class="fas fa-filter"></i>
									</button>
								</div>
								{#if activeFilterColumn === 'contacto'}
									<div class="absolute mt-2 w-48 rounded-xl border border-slate-200 bg-white p-3 shadow-xl z-20 text-left">
										<div class="flex items-center justify-between mb-2">
											<p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Filtrar por contacto</p>
											<button onclick={() => clearColumnFilter('contacto')} class="text-[11px] text-blue-600">Limpiar</button>
										</div>
										<div class="space-y-1">
											<button onclick={() => applyColumnFilter('contacto', 'Todos')} class="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50">Todos</button>
											{#each getColumnValues('contacto') as value}
												<button onclick={() => applyColumnFilter('contacto', value)} class="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50">{value}</button>
											{/each}
										</div>
									</div>
								{/if}
							</th>
						{/if}
						<th class="px-5 py-4 text-center">Acciones</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each filteredClientes as cliente}
						<tr class="hover:bg-slate-50/80 transition-colors group">
							{#if visibleColumns.nombre}
								<td class="px-5 py-4 font-medium text-slate-800">
									<div class="max-w-[250px] truncate">{cliente.nombre}</div>
								</td>
							{/if}
							{#if visibleColumns.tipo}
								<td class="px-5 py-4">
									<span class={`text-[10px] font-bold px-2.5 py-1 rounded-md border ${getTipoBadgeColor(cliente.tip_persona)}`}>
										{getTipoLabel(cliente.tip_persona)}
									</span>
								</td>
							{/if}
							{#if visibleColumns.documento}
								<td class="px-5 py-4">
									<div class="flex flex-col">
										<span class="font-semibold text-slate-700">{cliente.num_documento}</span>
										<span class="text-[10px] text-slate-400 font-medium">{cliente.tipo_doc}</span>
									</div>
								</td>
							{/if}
							{#if visibleColumns.contacto}
								<td class="px-5 py-4">
									<div class="flex flex-col gap-1 text-slate-600">
										{#if cliente.email}
											<div class="flex items-center gap-2 text-xs">
												<i class="fas fa-envelope text-slate-400 w-3 text-center"></i>
												<span>{cliente.email}</span>
											</div>
										{/if}
										{#if cliente.telefono}
											<div class="flex items-center gap-2 text-xs">
												<i class="fas fa-phone-alt text-slate-400 w-3 text-center"></i>
												<span>{cliente.telefono}</span>
											</div>
										{/if}
										{#if !cliente.email && !cliente.telefono}
											<span class="text-xs text-slate-400 italic">Sin contacto</span>
										{/if}
									</div>
								</td>
							{/if}
							<td class="px-5 py-4 text-center">
								<div class="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
									<button onclick={() => onEdit(cliente)} class="w-8 h-8 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 flex items-center justify-center transition-colors tooltip-wrapper" title="Editar">
										<i class="fas fa-pen text-xs"></i>
									</button>
									<button onclick={() => onDelete(cliente.id_cliente)} class="w-8 h-8 rounded bg-rose-50 text-rose-600 hover:bg-rose-100 flex items-center justify-center transition-colors tooltip-wrapper" title="Eliminar">
										<i class="fas fa-trash text-xs"></i>
									</button>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
	
	<!-- Pagination Footer -->
	{#if clientes.length > 0}
		<div class="p-4 border-t border-slate-100 flex items-center justify-between mt-auto bg-slate-50/30">
			<span class="text-xs text-slate-500 font-medium">Mostrando {filteredClientes.length} de {clientes.length} registros</span>
		</div>
	{/if}
</div>
