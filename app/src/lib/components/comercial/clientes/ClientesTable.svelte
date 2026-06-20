<script lang="ts">
	let { clientes = [], onEdit = (cliente: any) => {}, onDelete = (id: number) => {} } = $props<{
		clientes?: any[];
		onEdit?: (cliente: any) => void;
		onDelete?: (id: number) => void;
	}>();

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
</script>

<div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col h-full">
	
	<!-- Filters Bar -->
	<div class="p-4 border-b border-slate-100 flex flex-wrap items-center gap-4">
		<div class="flex flex-col gap-1 flex-1 min-w-[200px]">
			<div class="relative">
				<input type="text" placeholder="Buscar por Razón Social, RUC o Nombre..." class="text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 w-full pl-9">
				<i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
			</div>
		</div>
		<div class="flex flex-col gap-1 min-w-[140px]">
			<select class="text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-slate-700">
				<option>Tipo (Todos)</option>
				<option>Empresa (J)</option>
				<option>Persona (N)</option>
			</select>
		</div>
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
						<th class="px-5 py-4">Razón Social / Nombre</th>
						<th class="px-5 py-4">Tipo</th>
						<th class="px-5 py-4">Documento</th>
						<th class="px-5 py-4">Contacto</th>
						<th class="px-5 py-4 text-center">Acciones</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each clientes as cliente}
						<tr class="hover:bg-slate-50/80 transition-colors group">
							<td class="px-5 py-4 font-medium text-slate-800">
								<div class="max-w-[250px] truncate">{cliente.nombre}</div>
							</td>
							<td class="px-5 py-4">
								<span class={`text-[10px] font-bold px-2.5 py-1 rounded-md border ${getTipoBadgeColor(cliente.tip_persona)}`}>
									{getTipoLabel(cliente.tip_persona)}
								</span>
							</td>
							<td class="px-5 py-4">
								<div class="flex flex-col">
									<span class="font-semibold text-slate-700">{cliente.num_documento}</span>
									<span class="text-[10px] text-slate-400 font-medium">{cliente.tipo_doc}</span>
								</div>
							</td>
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
			<span class="text-xs text-slate-500 font-medium">Mostrando {clientes.length} registros</span>
		</div>
	{/if}
</div>
