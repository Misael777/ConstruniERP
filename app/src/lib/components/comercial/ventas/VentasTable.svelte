<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	const dispatch = createEventDispatcher();

	let { data = [
		{ proyecto: 'Edificio Residencial Los Olivos', valor: 350000, tipo: 'Residencial', fecha: '05/01/2026', asesor: 'Andrea Martínez', asesorInitials: 'AM', comision: 35000, comisionPct: 10 },
		{ proyecto: 'Centro Comercial San Isidro', valor: 820000, tipo: 'Comercial', fecha: '10/01/2026', asesor: 'Juan López', asesorInitials: 'JL', comision: 82000, comisionPct: 10 },
		{ proyecto: 'Oficinas Corporativas Miraflores', valor: 450000, tipo: 'Corporativo', fecha: '12/01/2026', asesor: 'Maria Condori', asesorInitials: 'MC', comision: 45000, comisionPct: 10 },
		{ proyecto: 'Condominio Vista Azul', valor: 280000, tipo: 'Residencial', fecha: '15/01/2026', asesor: 'Andrea Martínez', asesorInitials: 'AM', comision: 28000, comisionPct: 10 },
		{ proyecto: 'Planta Industrial Lurín', valor: 950000, tipo: 'Industrial', fecha: '18/01/2026', asesor: 'Juan López', asesorInitials: 'JL', comision: 95000, comisionPct: 10 },
		{ proyecto: 'Edificio Multifamiliar Surco', valor: 300000, tipo: 'Residencial', fecha: '20/01/2026', asesor: 'Maria Condori', asesorInitials: 'MC', comision: 30000, comisionPct: 10 },
		{ proyecto: 'Local Comercial La Molina', valor: 250000, tipo: 'Comercial', fecha: '22/01/2026', asesor: 'Andrea Martínez', asesorInitials: 'AM', comision: 25000, comisionPct: 10 }
	] } = $props<{ data?: any[] }>();

	let filtroProyecto = $state('Todos');
	let filtroTipo     = $state('Todos');
	let filtroAsesor   = $state('Todos');
	let fechaDesde     = $state('');
	let fechaHasta     = $state('');

	function getProyectosDisponibles() {
		return Array.from(new Set(data.map(row => row.proyecto))).sort();
	}

	function getTiposDisponibles() {
		return Array.from(new Set(data.map(row => row.tipo))).sort();
	}

	function getAsesoresDisponibles() {
		return Array.from(new Set(data.map(row => row.asesor))).sort();
	}

	function formatMoney(amount: number) {
		return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(amount);
	}

	function getTipoColor(tipo: string) {
		switch(tipo) {
			case 'Residencial': return 'bg-blue-50 text-blue-600 border-blue-200';
			case 'Comercial': return 'bg-emerald-50 text-emerald-600 border-emerald-200';
			case 'Corporativo': return 'bg-purple-50 text-purple-600 border-purple-200';
			case 'Industrial': return 'bg-orange-50 text-orange-600 border-orange-200';
			default: return 'bg-slate-50 text-slate-600 border-slate-200';
		}
	}

	function parseFechaRow(fecha: string) {
		const [day, month, year] = fecha.split('/').map(part => Number(part));
		if (!day || !month || !year) return null;
		return new Date(year, month - 1, day);
	}

	function parseFechaInput(value: string) {
		if (!value) return null;
		const [year, month, day] = value.split('-').map(part => Number(part));
		if (!year || !month || !day) return null;
		return new Date(year, month - 1, day);
	}

	function getFilteredData() {
		return data.filter(row => {
			const proyectoMatch = filtroProyecto === 'Todos' || row.proyecto === filtroProyecto;
			const tipoMatch = filtroTipo === 'Todos' || row.tipo === filtroTipo;
			const asesorMatch = filtroAsesor === 'Todos' || row.asesor === filtroAsesor;

			const rowDate = parseFechaRow(row.fecha);
			const desdeDate = parseFechaInput(fechaDesde);
			const hastaDate = parseFechaInput(fechaHasta);

			const desdeMatch = !desdeDate || (rowDate && rowDate >= desdeDate);
			const hastaMatch = !hastaDate || (rowDate && rowDate <= hastaDate);

			return proyectoMatch && tipoMatch && asesorMatch && desdeMatch && hastaMatch;
		});
	}

	function limpiarFiltros() {
		filtroProyecto = 'Todos';
		filtroTipo = 'Todos';
		filtroAsesor = 'Todos';
		fechaDesde = '';
		fechaHasta = '';
	}
</script>

<div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col h-full">
	<!-- Filters Bar -->
	<div class="p-4 border-b border-slate-100 flex flex-wrap items-center gap-4">
		<div class="flex flex-col gap-1 min-w-[140px] flex-1 md:flex-none">
			<label class="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Proyecto</label>
			<select bind:value={filtroProyecto} class="text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-slate-700">
				<option value="Todos">Todos los proyectos</option>
				{#each getProyectosDisponibles() as proyecto}
					<option value={proyecto}>{proyecto}</option>
				{/each}
			</select>
		</div>
		<div class="flex flex-col gap-1 min-w-[120px] flex-1 md:flex-none">
			<label class="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Tipo proyecto</label>
			<select bind:value={filtroTipo} class="text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-slate-700">
				<option value="Todos">Todos</option>
				{#each getTiposDisponibles() as tipo}
					<option value={tipo}>{tipo}</option>
				{/each}
			</select>
		</div>
		<div class="flex flex-col gap-1 min-w-[140px] flex-1 md:flex-none">
			<label class="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Asesor</label>
			<select bind:value={filtroAsesor} class="text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-slate-700">
				<option value="Todos">Todos</option>
				{#each getAsesoresDisponibles() as asesorOption}
					<option value={asesorOption}>{asesorOption}</option>
				{/each}
			</select>
		</div>
		<div class="flex flex-col gap-1 min-w-[130px] flex-1 md:flex-none">
			<label class="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Fecha desde</label>
			<input type="date" bind:value={fechaDesde} class="text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 w-full" />
		</div>
		<div class="flex flex-col gap-1 min-w-[130px] flex-1 md:flex-none">
			<label class="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Fecha hasta</label>
			<input type="date" bind:value={fechaHasta} class="text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 w-full" />
		</div>
		<div class="flex items-end flex-1 md:flex-none mt-5 md:mt-0 ml-auto">
			<button onclick={limpiarFiltros} class="text-sm font-semibold text-blue-600 flex items-center gap-2 hover:bg-blue-50 px-3 py-2 rounded-lg transition-colors">
				<i class="fas fa-undo"></i> Limpiar filtros
			</button>
		</div>
	</div>

	<!-- Table -->
	<div class="overflow-x-auto">
		<table class="w-full text-left text-sm whitespace-nowrap">
			<thead class="text-xs text-slate-500 bg-slate-50/50 font-semibold border-b border-slate-100">
				<tr>
					<th class="px-5 py-4">Proyecto</th>
					<th class="px-5 py-4">Valor venta</th>
					<th class="px-5 py-4">Tipo proyecto</th>
					<th class="px-5 py-4">Fecha</th>
					<th class="px-5 py-4">Asesor</th>
					<th class="px-5 py-4">Comisión</th>
					<th class="px-5 py-4 text-center">Proforma</th>
					<th class="px-5 py-4 text-center">Contrato</th>
					<th class="px-5 py-4 text-center">Acciones</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100">
				{#if getFilteredData().length === 0}
					<tr>
						<td colspan="9" class="px-5 py-10 text-center text-slate-500">
							No se encontraron ventas con esos filtros.
						</td>
					</tr>
				{:else}
					{#each getFilteredData() as row}
						<tr class="hover:bg-slate-50/80 transition-colors group">
						<td class="px-5 py-4 font-medium text-slate-800">
							<div class="max-w-[200px] truncate">{row.proyecto}</div>
						</td>
						<td class="px-5 py-4 font-semibold text-slate-700">{formatMoney(row.valor)}</td>
						<td class="px-5 py-4">
							<span class={`text-[10px] font-bold px-2.5 py-1 rounded-md border ${getTipoColor(row.tipo)}`}>
								{row.tipo}
							</span>
						</td>
						<td class="px-5 py-4 text-slate-600">{row.fecha}</td>
						<td class="px-5 py-4">
							<div class="flex items-center gap-2">
								<div class="w-6 h-6 rounded-full bg-slate-800 text-white flex items-center justify-center text-[9px] font-bold">
									{row.asesorInitials}
								</div>
								<span class="text-slate-700 text-sm">{row.asesor}</span>
							</div>
						</td>
						<td class="px-5 py-4">
							<div class="flex flex-col">
								<span class="font-medium text-slate-700">{formatMoney(row.comision)}</span>
								<span class="text-[10px] text-slate-400">({row.comisionPct}%)</span>
							</div>
						</td>
						<td class="px-5 py-4 text-center">
							<button onclick={() => {
								console.log('[VentasTable] Click en Proforma');
								console.log('[VentasTable] Row data:', row);
								console.log('[VentasTable] Descripción:', row?.descripcion);
								dispatch('viewProforma', { row });
							}} class="text-rose-500 hover:bg-rose-50 p-1.5 rounded transition-colors" title="Ver Proforma" aria-label="Ver Proforma">
								<i class="far fa-file-pdf"></i>
							</button>
						</td>
						<td class="px-5 py-4 text-center">
							<button onclick={() => {
								console.log('[VentasTable] Click en Contrato');
								console.log('[VentasTable] Row data:', row);
								console.log('[VentasTable] Contrato URL:', row?.contrato);
								dispatch('viewContrato', { row });
							}} class="text-rose-500 hover:bg-rose-50 p-1.5 rounded transition-colors" title="Ver Contrato" aria-label="Ver Contrato">
								<i class="far fa-file-pdf"></i>
							</button>
						</td>
						<td class="px-5 py-4 text-center">
							<div class="inline-flex gap-2 items-center justify-center">
								<button onclick={() => dispatch('editRow', { row })} class="text-slate-500 hover:bg-slate-100 hover:text-slate-600 p-1.5 rounded transition-colors w-8 h-8 flex items-center justify-center" aria-label="Editar">
									<i class="fas fa-pen"></i>
								</button>
								<button onclick={() => dispatch('deleteRow', { row })} class="text-rose-500 hover:bg-rose-50 p-1.5 rounded transition-colors w-8 h-8 flex items-center justify-center" aria-label="Eliminar">
									<i class="fas fa-trash"></i>
								</button>
							</div>
						</td>
					</tr>
				{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<!-- Pagination Footer -->
	<div class="p-4 border-t border-slate-100 flex items-center justify-between mt-auto bg-slate-50/30">
		<span class="text-xs text-slate-500 font-medium">Mostrando {getFilteredData().length} de {data.length} registros</span>
		
		<div class="flex items-center gap-4">
			<div class="flex items-center gap-2">
				<span class="text-xs text-slate-500">Filas por página</span>
				<select class="text-xs border border-slate-200 rounded px-2 py-1 outline-none text-slate-700 bg-white">
					<option>10</option>
					<option>20</option>
					<option>50</option>
				</select>
			</div>
			
			<div class="flex items-center gap-1">
				<button class="w-7 h-7 rounded border border-slate-200 flex items-center justify-center text-slate-400 hover:bg-slate-50 transition-colors" disabled aria-label="Primera página">
					<i class="fas fa-step-backward text-[10px]"></i>
				</button>
				<button class="w-7 h-7 rounded border border-slate-200 flex items-center justify-center text-slate-400 hover:bg-slate-50 transition-colors" disabled aria-label="Página anterior">
					<i class="fas fa-chevron-left text-[10px]"></i>
				</button>
				
				<button class="w-7 h-7 rounded bg-blue-600 text-white font-bold text-xs shadow-sm flex items-center justify-center">1</button>
				<button class="w-7 h-7 rounded hover:bg-slate-100 text-slate-600 font-medium text-xs flex items-center justify-center transition-colors">2</button>
				<button class="w-7 h-7 rounded hover:bg-slate-100 text-slate-600 font-medium text-xs flex items-center justify-center transition-colors">3</button>
				
				<button class="w-7 h-7 rounded border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-colors" aria-label="Página siguiente">
					<i class="fas fa-chevron-right text-[10px]"></i>
				</button>
				<button class="w-7 h-7 rounded border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-colors" aria-label="Última página">
					<i class="fas fa-step-forward text-[10px]"></i>
				</button>
			</div>
		</div>
	</div>
</div>
