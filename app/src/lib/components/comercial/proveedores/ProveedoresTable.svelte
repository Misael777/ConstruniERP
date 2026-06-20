<script lang="ts">
	let { proveedores = [], onEdit = (proveedor: any) => {}, onDelete = (id: number) => {} } = $props<{
		proveedores?: any[];
		onEdit?: (proveedor: any) => void;
		onDelete?: (id: number) => void;
	}>();
</script>

<div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col h-full">
	
	<!-- Filters Bar -->
	<div class="p-4 border-b border-slate-100 flex flex-wrap items-center gap-4">
		<div class="flex flex-col gap-1 flex-1 min-w-[200px]">
			<div class="relative">
				<input type="text" placeholder="Buscar por Razón Social o RUC..." class="text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 w-full pl-9">
				<i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
			</div>
		</div>
	</div>

	<!-- Table -->
	<div class="overflow-x-auto flex-1">
		{#if proveedores.length === 0}
			<div class="p-12 text-center flex flex-col items-center justify-center text-slate-500 h-full">
				<div class="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
					<i class="fas fa-truck text-2xl text-slate-300"></i>
				</div>
				<p class="font-medium">No hay proveedores registrados.</p>
				<p class="text-sm text-slate-400 mt-1">Haz clic en "Nuevo Proveedor" para empezar.</p>
			</div>
		{:else}
			<table class="w-full text-left text-sm whitespace-nowrap">
				<thead class="text-xs text-slate-500 bg-slate-50/50 font-semibold border-b border-slate-100">
					<tr>
						<th class="px-5 py-4">Razón Social</th>
						<th class="px-5 py-4">RUC</th>
						<th class="px-5 py-4">Contacto Principal</th>
						<th class="px-5 py-4">Vendedor Asignado</th>
						<th class="px-5 py-4 text-center">Acciones</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each proveedores as proveedor}
						<tr class="hover:bg-slate-50/80 transition-colors group">
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
									<span class="text-xs text-slate-400 italic">No asignado</span>
								{/if}
							</td>
							<td class="px-5 py-4 text-center">
								<div class="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
									<button onclick={() => onEdit(proveedor)} class="w-8 h-8 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 flex items-center justify-center transition-colors tooltip-wrapper" title="Editar">
										<i class="fas fa-pen text-xs"></i>
									</button>
									<button onclick={() => onDelete(proveedor.id_proveedor)} class="w-8 h-8 rounded bg-rose-50 text-rose-600 hover:bg-rose-100 flex items-center justify-center transition-colors tooltip-wrapper" title="Eliminar">
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
	{#if proveedores.length > 0}
		<div class="p-4 border-t border-slate-100 flex items-center justify-between mt-auto bg-slate-50/30">
			<span class="text-xs text-slate-500 font-medium">Mostrando {proveedores.length} registros</span>
		</div>
	{/if}
</div>
