<script lang="ts">
	import { createEventDispatcher, untrack } from 'svelte';
	import ResponsiveDataView from '$lib/shared/components/ResponsiveDataView.svelte';

	const dispatch = createEventDispatcher();

	const columns = [
		{ label: 'Proyecto' },
		{ label: 'Cliente' },
		{ label: 'Estado' },
		{ label: 'Valor venta' },
		{ label: 'Tipo proyecto' },
		{ label: 'Fecha' },
		{ label: 'Asesor' },
		{ label: 'Comisión' },
		{ label: 'Proforma', align: 'center' as const },
		{ label: 'Contrato', align: 'center' as const },
		{ label: 'Acciones', align: 'center' as const }
	];

	function getEstadoBadge(estado: string) {
		if (estado === 'baja') return 'bg-red-50 text-red-600 border-red-200';
		if (estado === 'venta_cerrada') return 'bg-emerald-50 text-emerald-600 border-emerald-200';
		return 'bg-amber-50 text-amber-600 border-amber-200';
	}

	function getEstadoLabel(estado: string) {
		if (estado === 'baja') return 'Dado de baja';
		// A pedido explícito del usuario: toda venta que aún no está cerrada se muestra como "En
		// borrador" (antes decía "En negociación").
		return estado === 'venta_cerrada' ? 'Venta Cerrada' : 'En borrador';
	}

	let { data = [
		{ id: 1, codigo: 'ONU3_0126_SJL_Grupo_Andino', clienteNombre: 'Grupo Andino', proyecto: 'Edificio Residencial Los Olivos', valor: 350000, tipo: 'Residencial', fecha: '05/01/2026', asesor: 'Andrea Martínez', asesorInitials: 'AM', comision: 35000, comisionPct: 10 },
		{ id: 2, codigo: 'ONC5_0126_SIS_Inversiones_Sur', clienteNombre: 'Inversiones Sur', proyecto: 'Centro Comercial San Isidro', valor: 820000, tipo: 'Comercial', fecha: '10/01/2026', asesor: 'Juan López', asesorInitials: 'JL', comision: 82000, comisionPct: 10 },
		{ id: 3, codigo: 'OAC8_0126_MIRA_Corp_Delta', clienteNombre: 'Corp Delta', proyecto: 'Oficinas Corporativas Miraflores', valor: 450000, tipo: 'Corporativo', fecha: '12/01/2026', asesor: 'Maria Condori', asesorInitials: 'MC', comision: 45000, comisionPct: 10 },
		{ id: 4, codigo: 'ONU4_0126_ATE_Familia_Rojas', clienteNombre: 'Familia Rojas', proyecto: 'Condominio Vista Azul', valor: 280000, tipo: 'Residencial', fecha: '15/01/2026', asesor: 'Andrea Martínez', asesorInitials: 'AM', comision: 28000, comisionPct: 10 },
		{ id: 5, codigo: 'OBRA-NAI2_0126_LURI_Textil_Peru', clienteNombre: 'Textil Perú', proyecto: 'Planta Industrial Lurín', valor: 950000, tipo: 'Industrial', fecha: '18/01/2026', asesor: 'Juan López', asesorInitials: 'JL', comision: 95000, comisionPct: 10 },
		{ id: 6, codigo: 'ONU6_0126_SURC_Constructora_Vega', clienteNombre: 'Constructora Vega', proyecto: 'Edificio Multifamiliar Surco', valor: 300000, tipo: 'Residencial', fecha: '20/01/2026', asesor: 'Maria Condori', asesorInitials: 'MC', comision: 30000, comisionPct: 10 },
		{ id: 7, codigo: 'ONC2_0126_MOLI_Retail_Andes', clienteNombre: 'Retail Andes', proyecto: 'Local Comercial La Molina', valor: 250000, tipo: 'Comercial', fecha: '22/01/2026', asesor: 'Andrea Martínez', asesorInitials: 'AM', comision: 25000, comisionPct: 10 }
	], modoEliminados = false } = $props<{ data?: any[]; modoEliminados?: boolean }>();

	/** La columna "Proyecto" muestra el CÓDIGO del proyecto (`codigo`, recalculado en la página — ver
	 * codigoProyecto.ts). `proyecto` (nombre_proyecto) queda solo como respaldo para ventas antiguas
	 * a las que les falten los campos con los que se arma el código. */
	function getCodigo(row: any) {
		return row.codigo || row.proyecto || '—';
	}

	function getCliente(row: any) {
		return row.clienteNombre || 'Sin cliente';
	}

	let filtroProyecto = $state('Todos');
	let filtroTipo     = $state('Todos');
	let filtroAsesor   = $state('Todos');
	let fechaDesde     = $state('');
	let fechaHasta     = $state('');

	function getProyectosDisponibles() {
		return Array.from(new Set(data.map((row: any) => getCodigo(row)))).sort();
	}

	// A pedido explícito del usuario: el filtro "Tipo proyecto" ya NO se arma dinámicamente desde
	// `row.tipo` (el tipo de edificación de Consultoría — "Proyecto de Obra"/"Mantenimiento"/etc, ver
	// mapProjectType en +page.svelte) — pasa a ser un catálogo fijo de 3 opciones sobre el TIPO DE
	// VENTA real de cada proyecto (`tipoVenta`/`tipoObra`, agregados a las filas en +page.svelte):
	// 'Consultoria' (tipoVenta='consultoria'), 'Obra' (tipoVenta='obra' y tipoObra≠'SUP', ejecución) y
	// 'Supervision' (tipoVenta='obra' y tipoObra='SUP').
	const TIPOS_PROYECTO_FILTRO = ['Consultoria', 'Obra', 'Supervision'];

	function tipoProyectoMatch(row: any, filtro: string) {
		if (filtro === 'Todos') return true;
		if (filtro === 'Consultoria') return row.tipoVenta === 'consultoria';
		if (filtro === 'Supervision') return row.tipoVenta === 'obra' && row.tipoObra === 'SUP';
		return row.tipoVenta === 'obra' && row.tipoObra !== 'SUP'; // 'Obra' (ejecución)
	}

	function getAsesoresDisponibles() {
		return Array.from(new Set(data.map((row: any) => row.asesor))).sort();
	}

	function formatMoney(amount: number) {
		return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(amount);
	}

	/** Columna "Tipo proyecto" de la tabla — a pedido explícito del usuario, muestra el TIPO DE VENTA
	 * real del proyecto (`row.tipoVenta`/`row.tipoObra`, agregados en +page.svelte), mismo criterio que
	 * ya usa el filtro "Tipo proyecto" (ver tipoProyectoMatch), no el tipo de edificación de Consultoría
	 * que mostraba antes (`row.tipo`). */
	function getTipoVentaLabel(row: any) {
		if (row.tipoVenta === 'consultoria') return 'Consultoria';
		if (row.tipoVenta === 'obra' && row.tipoObra === 'SUP') return 'Supervision';
		return 'Obra';
	}
	function getTipoVentaColor(label: string) {
		switch (label) {
			case 'Consultoria': return 'bg-purple-50 text-purple-600 border-purple-200';
			case 'Supervision': return 'bg-orange-50 text-orange-600 border-orange-200';
			default: return 'bg-blue-50 text-blue-600 border-blue-200'; // 'Obra'
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

	// A pedido del usuario: filtro (^) al costado de Proyecto, Cliente, Estado, Valor venta, Tipo proyecto,
	// Fecha y Asesor. Comparten estado con la barra de filtros de arriba (Proyecto/Tipo/Asesor/Fechas), así
	// que ambos lugares quedan siempre sincronizados.
	let filtroCliente = $state('Todos');
	let filtroEstado = $state('Todos');
	let valorMin = $state('');
	let valorMax = $state('');

	type ClaveFiltro = 'proyecto' | 'cliente' | 'estado' | 'valor' | 'tipo' | 'fecha' | 'asesor';
	const FILTROS_COLUMNA: { clave: ClaveFiltro; etiqueta: string }[] = [
		{ clave: 'proyecto', etiqueta: 'Proyecto' },
		{ clave: 'cliente', etiqueta: 'Cliente' },
		{ clave: 'estado', etiqueta: 'Estado' },
		{ clave: 'valor', etiqueta: 'Valor venta' },
		{ clave: 'tipo', etiqueta: 'Tipo proyecto' },
		{ clave: 'fecha', etiqueta: 'Fecha' },
		{ clave: 'asesor', etiqueta: 'Asesor' }
	];

	function opcionesFiltro(clave: ClaveFiltro): string[] {
		if (clave === 'proyecto') return getProyectosDisponibles() as string[];
		if (clave === 'cliente') return Array.from(new Set(data.map((row: any) => getCliente(row)))).sort() as string[];
		if (clave === 'asesor') return getAsesoresDisponibles() as string[];
		if (clave === 'tipo') return TIPOS_PROYECTO_FILTRO;
		if (clave === 'estado') return modoEliminados ? ['Dado de baja'] : ['En borrador', 'Venta Cerrada'];
		return [];
	}
	function valorFiltro(clave: ClaveFiltro): string {
		if (clave === 'proyecto') return filtroProyecto;
		if (clave === 'cliente') return filtroCliente;
		if (clave === 'asesor') return filtroAsesor;
		if (clave === 'tipo') return filtroTipo;
		if (clave === 'estado') return filtroEstado;
		return 'Todos';
	}
	function elegirFiltro(clave: ClaveFiltro, valor: string) {
		if (clave === 'proyecto') filtroProyecto = valor;
		else if (clave === 'cliente') filtroCliente = valor;
		else if (clave === 'asesor') filtroAsesor = valor;
		else if (clave === 'tipo') filtroTipo = valor;
		else if (clave === 'estado') filtroEstado = valor;
		cerrarFiltro();
	}
	function filtroActivo(clave: ClaveFiltro): boolean {
		if (clave === 'valor') return valorMin !== '' || valorMax !== '';
		if (clave === 'fecha') return !!fechaDesde || !!fechaHasta;
		return valorFiltro(clave) !== 'Todos';
	}
	function limpiarFiltro(clave: ClaveFiltro) {
		if (clave === 'valor') { valorMin = ''; valorMax = ''; }
		else if (clave === 'fecha') { fechaDesde = ''; fechaHasta = ''; }
		else elegirFiltro(clave, 'Todos');
	}

	// Ventana del filtro abierta: se posiciona con `fixed` según el botón (^), así no la recorta el
	// contenedor con scroll de la tabla. Se cierra con clic afuera (fondo transparente) o Escape.
	let filtroAbierto = $state<ClaveFiltro | null>(null);
	let posFiltro = $state({ top: 0, left: 0 });
	let busquedaFiltro = $state('');
	const ANCHO_FILTRO = 256;
	function abrirFiltro(clave: ClaveFiltro, event: MouseEvent) {
		if (filtroAbierto === clave) return cerrarFiltro();
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		posFiltro = {
			top: Math.min(rect.bottom + 6, window.innerHeight - 120),
			left: Math.max(8, Math.min(rect.left - 8, window.innerWidth - ANCHO_FILTRO - 8))
		};
		busquedaFiltro = '';
		filtroAbierto = clave;
	}
	function cerrarFiltro() {
		filtroAbierto = null;
	}
	function enfocar(node: HTMLElement) {
		node.focus();
	}
	const etiquetaFiltroAbierto = $derived(FILTROS_COLUMNA.find((f) => f.clave === filtroAbierto)?.etiqueta ?? '');

	function getFilteredData() {
		const min = valorMin === '' ? null : Number(valorMin);
		const max = valorMax === '' ? null : Number(valorMax);
		return data.filter((row: any) => {
			const proyectoMatch = filtroProyecto === 'Todos' || getCodigo(row) === filtroProyecto;
			const clienteMatch = filtroCliente === 'Todos' || getCliente(row) === filtroCliente;
			const estadoMatch = filtroEstado === 'Todos' || getEstadoLabel(row.estado_proyecto) === filtroEstado;
			const tipoMatch = tipoProyectoMatch(row, filtroTipo);
			const asesorMatch = filtroAsesor === 'Todos' || row.asesor === filtroAsesor;
			const valor = Number(row.valor) || 0;
			const valorMatch = (min === null || valor >= min) && (max === null || valor <= max);

			const rowDate = parseFechaRow(row.fecha);
			const desdeDate = parseFechaInput(fechaDesde);
			const hastaDate = parseFechaInput(fechaHasta);

			const desdeMatch = !desdeDate || (rowDate && rowDate >= desdeDate);
			const hastaMatch = !hastaDate || (rowDate && rowDate <= hastaDate);

			return proyectoMatch && clienteMatch && estadoMatch && tipoMatch && asesorMatch && valorMatch && desdeMatch && hastaMatch;
		});
	}

	// Ticket #75: paginación real (antes los botones 1-2-3, las flechas y "Filas por página" eran de adorno).
	const OPCIONES_FILAS = [10, 20, 50];
	let filasPorPagina = $state(20);
	let pagina = $state(1);
	let inicioLista = $state<HTMLElement | null>(null);
	const filtradas = $derived(getFilteredData());
	const totalPaginas = $derived(Math.max(1, Math.ceil(filtradas.length / filasPorPagina)));
	const paginaActual = $derived(Math.min(pagina, totalPaginas));
	const filasPagina = $derived(filtradas.slice((paginaActual - 1) * filasPorPagina, paginaActual * filasPorPagina));
	/** Hasta 5 números de página alrededor de la actual. */
	const numerosPagina = $derived.by(() => {
		const desde = Math.max(1, Math.min(paginaActual - 2, totalPaginas - 4));
		return Array.from({ length: Math.min(5, totalPaginas) }, (_, i) => desde + i);
	});
	// Al cambiar un filtro o la cantidad de filas se vuelve a la página 1 (no cuando la lista se refresca sola:
	// si se acorta, paginaActual ya se ajusta a la última página que exista).
	$effect(() => {
		[filtroProyecto, filtroCliente, filtroEstado, filtroTipo, filtroAsesor, valorMin, valorMax, fechaDesde, fechaHasta, filasPorPagina, modoEliminados];
		untrack(() => (pagina = 1));
	});
	function irAPagina(n: number) {
		const destino = Math.min(Math.max(n, 1), totalPaginas);
		if (destino === paginaActual) return;
		pagina = destino;
		// En celular la lista es larga: se sube al inicio para ver la página nueva desde arriba.
		inicioLista?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	}

	function limpiarFiltros() {
		filtroProyecto = 'Todos';
		filtroCliente = 'Todos';
		filtroEstado = 'Todos';
		filtroTipo = 'Todos';
		filtroAsesor = 'Todos';
		valorMin = '';
		valorMax = '';
		fechaDesde = '';
		fechaHasta = '';
	}
</script>

<div class="bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col md:h-full md:overflow-hidden">
	{#snippet botonFiltro(clave: ClaveFiltro, etiqueta: string)}
		<button
			type="button"
			onclick={(e) => abrirFiltro(clave, e)}
			class={`inline-flex items-center justify-center w-5 h-5 rounded transition-colors ${filtroActivo(clave) || filtroAbierto === clave ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-200 hover:text-blue-600'}`}
			title={`Filtrar por ${etiqueta}`}
			aria-label={`Filtrar por ${etiqueta}`}
			aria-expanded={filtroAbierto === clave}
		>
			<i class={`fas ${filtroAbierto === clave ? 'fa-chevron-up' : 'fa-chevron-down'} text-[9px]`}></i>
		</button>
	{/snippet}

	<!-- A pedido del usuario se quitó la barra de filtros (Proyecto/Tipo/Asesor/Fechas): se filtra solo con
	     los (^) de cada columna. En celular la lista se ve como tarjetas (sin encabezados), así que esos
	     mismos (^) se ofrecen acá como botones. -->
	<div class="px-4 py-2 border-b border-slate-100 flex flex-wrap items-center gap-2">
		{#each FILTROS_COLUMNA as f (f.clave)}
			<span class={`md:hidden inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full border text-xs font-medium ${filtroActivo(f.clave) ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}>
				{f.etiqueta}
				{@render botonFiltro(f.clave, f.etiqueta)}
			</span>
		{/each}
		<button onclick={limpiarFiltros} class="ml-auto text-sm font-semibold text-blue-600 flex items-center gap-2 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors">
			<i class="fas fa-undo"></i> Limpiar filtros
		</button>
	</div>

	<!-- Table / Cards -->
	<div bind:this={inicioLista} class="overflow-x-auto md:overflow-y-auto md:flex-1 scroll-mt-4">
		<ResponsiveDataView items={filasPagina} keyField="id" {columns} emptyMessage="No se encontraron ventas con esos filtros.">
			{#snippet header()}
				{#each columns as col}
					{@const filtro = FILTROS_COLUMNA.find((f) => f.etiqueta.toLowerCase() === col.label.toLowerCase())}
					<th class={`sticky top-0 z-10 bg-slate-50 px-5 py-4 whitespace-nowrap ${col.align === 'center' ? 'text-center' : 'text-left'}`}>
						{#if filtro}
							<span class="inline-flex items-center gap-1.5">
								{col.label}
								{@render botonFiltro(filtro.clave, filtro.etiqueta)}
							</span>
						{:else}
							{col.label}
						{/if}
					</th>
				{/each}
			{/snippet}
			{#snippet row(row)}
				<td class="px-5 py-4 font-medium text-slate-800">
					<div class="max-w-[220px] truncate" title={getCodigo(row)}>{getCodigo(row)}</div>
				</td>
				<td class="px-5 py-4 text-slate-600">
					<div class="max-w-[180px] truncate" title={getCliente(row)}>{getCliente(row)}</div>
				</td>
				<td class="px-5 py-4">
					<span class={`text-[10px] font-bold px-2.5 py-1 rounded-md border whitespace-nowrap ${getEstadoBadge(row.estado_proyecto)}`}>
						{getEstadoLabel(row.estado_proyecto)}
					</span>
				</td>
				<td class="px-5 py-4 font-semibold text-slate-700">{formatMoney(row.valor)}</td>
				<td class="px-5 py-4">
					<span class={`text-[10px] font-bold px-2.5 py-1 rounded-md border ${getTipoVentaColor(getTipoVentaLabel(row))}`}>
						{getTipoVentaLabel(row)}
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
					<button onclick={() => dispatch('gestionarProformas', { row })} class="text-rose-500 hover:bg-rose-50 p-1.5 rounded transition-colors" title="Proformas" aria-label="Proformas">
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
						<!-- A pedido del usuario: resumen de la venta (borrador o cerrada), ver ventasResumen.service.ts. -->
						<button onclick={() => dispatch('verResumen', { row })} class="text-blue-600 hover:bg-blue-50 p-1.5 rounded transition-colors w-8 h-8 flex items-center justify-center" title="Resumen de la venta" aria-label="Resumen de la venta">
							<i class="fas fa-circle-info"></i>
						</button>
						{#if modoEliminados}
							<button onclick={() => dispatch('restaurar', { row })} class="text-emerald-600 hover:bg-emerald-50 p-1.5 rounded transition-colors w-8 h-8 flex items-center justify-center" title="Restaurar" aria-label="Restaurar">
								<i class="fas fa-rotate-left"></i>
							</button>
							<button onclick={() => dispatch('eliminarPermanente', { row })} class="text-rose-500 hover:bg-rose-50 p-1.5 rounded transition-colors w-8 h-8 flex items-center justify-center" title="Eliminar permanentemente" aria-label="Eliminar permanentemente">
								<i class="fas fa-trash-alt"></i>
							</button>
						{:else}
							<button onclick={() => dispatch('editRow', { row })} class="text-slate-500 hover:bg-slate-100 hover:text-slate-600 p-1.5 rounded transition-colors w-8 h-8 flex items-center justify-center" aria-label="Editar">
								<i class="fas fa-pen"></i>
							</button>
							<button onclick={() => dispatch('darDeBaja', { row })} class="text-red-500 hover:bg-red-50 p-1.5 rounded transition-colors w-8 h-8 flex items-center justify-center" title="Dar de baja" aria-label="Dar de baja">
								<i class="fas fa-trash"></i>
							</button>
						{/if}
					</div>
				</td>
			{/snippet}
			{#snippet card(row)}
				<div class="flex items-start justify-between gap-3 mb-2">
					<div class="min-w-0">
						<div class="font-semibold text-slate-800 truncate">{getCodigo(row)}</div>
						<div class="text-xs text-slate-500 truncate mt-0.5">{getCliente(row)}</div>
						<div class="flex items-center gap-1.5 mt-1 flex-wrap">
							<span class={`inline-block text-[10px] font-bold px-2.5 py-1 rounded-md border ${getTipoVentaColor(getTipoVentaLabel(row))}`}>
								{getTipoVentaLabel(row)}
							</span>
							<span class={`inline-block text-[10px] font-bold px-2.5 py-1 rounded-md border whitespace-nowrap ${getEstadoBadge(row.estado_proyecto)}`}>
								{getEstadoLabel(row.estado_proyecto)}
							</span>
						</div>
					</div>
					<div class="text-right shrink-0">
						<div class="font-bold text-slate-800">{formatMoney(row.valor)}</div>
						<div class="text-[11px] text-slate-400">{row.fecha}</div>
					</div>
				</div>
				<div class="flex items-center gap-2 mb-2">
					<div class="w-6 h-6 rounded-full bg-slate-800 text-white flex items-center justify-center text-[9px] font-bold shrink-0">
						{row.asesorInitials}
					</div>
					<span class="text-sm text-slate-600 truncate">{row.asesor}</span>
				</div>
				<div class="flex items-center justify-between text-xs text-slate-500 mb-3">
					<span>Comisión</span>
					<span class="font-medium text-slate-700">{formatMoney(row.comision)} <span class="text-slate-400">({row.comisionPct}%)</span></span>
				</div>
				<!-- Ticket #75 (rechazo): en celular los 5 botones no cabían en una fila y el último quedaba fuera de la
				     tarjeta. Ahora van en dos filas que siempre caben: documentos arriba y acciones abajo. -->
				<div class="pt-2 border-t border-slate-100 flex flex-col gap-2">
					<div class="grid grid-cols-2 gap-2">
						<button onclick={() => dispatch('gestionarProformas', { row })} class="min-w-0 h-10 rounded-lg border border-slate-200 text-rose-500 flex items-center justify-center gap-2 text-xs font-medium active:bg-rose-50" aria-label="Proformas">
							<i class="far fa-file-pdf"></i> Proforma
						</button>
						<button onclick={() => dispatch('viewContrato', { row })} class="min-w-0 h-10 rounded-lg border border-slate-200 text-rose-500 flex items-center justify-center gap-2 text-xs font-medium active:bg-rose-50" aria-label="Ver Contrato">
							<i class="far fa-file-pdf"></i> Contrato
						</button>
					</div>
					<div class="grid grid-cols-3 gap-2">
						<button onclick={() => dispatch('verResumen', { row })} class="min-w-0 h-10 rounded-lg border border-slate-200 text-blue-600 flex items-center justify-center active:bg-blue-50" aria-label="Resumen de la venta" title="Resumen de la venta">
							<i class="fas fa-circle-info"></i>
						</button>
						{#if modoEliminados}
							<button onclick={() => dispatch('restaurar', { row })} class="min-w-0 h-10 rounded-lg border border-slate-200 text-emerald-600 flex items-center justify-center active:bg-emerald-50" aria-label="Restaurar" title="Restaurar">
								<i class="fas fa-rotate-left"></i>
							</button>
							<button onclick={() => dispatch('eliminarPermanente', { row })} class="min-w-0 h-10 rounded-lg border border-slate-200 text-rose-500 flex items-center justify-center active:bg-rose-50" aria-label="Eliminar permanentemente" title="Eliminar permanentemente">
								<i class="fas fa-trash-alt"></i>
							</button>
						{:else}
							<button onclick={() => dispatch('editRow', { row })} class="min-w-0 h-10 rounded-lg border border-slate-200 text-slate-500 flex items-center justify-center active:bg-slate-100" aria-label="Editar" title="Editar">
								<i class="fas fa-pen"></i>
							</button>
							<button onclick={() => dispatch('darDeBaja', { row })} class="min-w-0 h-10 rounded-lg border border-slate-200 text-red-500 flex items-center justify-center active:bg-red-50" aria-label="Dar de baja" title="Dar de baja">
								<i class="fas fa-trash"></i>
							</button>
						{/if}
					</div>
				</div>
			{/snippet}
		</ResponsiveDataView>
	</div>

	{#if filtroAbierto}
		<!-- Fondo transparente: clic afuera cierra la ventana del filtro. -->
		<div class="fixed inset-0 z-40" onclick={cerrarFiltro} aria-hidden="true"></div>
		<div
			class="fixed z-50 rounded-xl border border-slate-200 bg-white p-3 shadow-xl text-left"
			style={`top:${posFiltro.top}px;left:${posFiltro.left}px;width:${ANCHO_FILTRO}px`}
			role="dialog"
			aria-label={`Filtrar por ${etiquetaFiltroAbierto}`}
			tabindex="-1"
			onkeydown={(e) => { if (e.key === 'Escape') cerrarFiltro(); }}
		>
			<div class="flex items-center justify-between mb-2">
				<p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Filtrar por {etiquetaFiltroAbierto.toLowerCase()}</p>
				<button type="button" onclick={() => { if (filtroAbierto) limpiarFiltro(filtroAbierto); }} class="text-[11px] text-blue-600 hover:underline">Limpiar</button>
			</div>
			{#if filtroAbierto === 'valor'}
				<div class="grid grid-cols-2 gap-2">
					<label class="flex flex-col gap-1 text-[11px] text-slate-500">
						Mínimo (S/)
						<input type="number" min="0" step="0.01" inputmode="decimal" bind:value={valorMin} use:enfocar placeholder="0.00" class="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500" />
					</label>
					<label class="flex flex-col gap-1 text-[11px] text-slate-500">
						Máximo (S/)
						<input type="number" min="0" step="0.01" inputmode="decimal" bind:value={valorMax} placeholder="Sin tope" class="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500" />
					</label>
				</div>
			{:else if filtroAbierto === 'fecha'}
				<div class="grid grid-cols-1 gap-2">
					<label class="flex flex-col gap-1 text-[11px] text-slate-500">
						Desde
						<input type="date" bind:value={fechaDesde} class="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500" />
					</label>
					<label class="flex flex-col gap-1 text-[11px] text-slate-500">
						Hasta
						<input type="date" bind:value={fechaHasta} class="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500" />
					</label>
				</div>
			{:else}
				{@const clave = filtroAbierto}
				{@const opciones = opcionesFiltro(clave).filter((o) => o.toLowerCase().includes(busquedaFiltro.trim().toLowerCase()))}
				{#if opcionesFiltro(clave).length > 5}
					<input type="text" bind:value={busquedaFiltro} use:enfocar placeholder="Buscar..." class="w-full mb-2 px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500" />
				{/if}
				<div class="max-h-56 overflow-y-auto space-y-0.5">
					<button type="button" onclick={() => elegirFiltro(clave, 'Todos')} class={`block w-full rounded-lg px-2 py-1.5 text-left text-sm ${valorFiltro(clave) === 'Todos' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700 hover:bg-slate-50'}`}>Todos</button>
					{#each opciones as opcion (opcion)}
						<button type="button" onclick={() => elegirFiltro(clave, opcion)} class={`block w-full truncate rounded-lg px-2 py-1.5 text-left text-sm ${valorFiltro(clave) === opcion ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700 hover:bg-slate-50'}`} title={opcion}>{opcion}</button>
					{:else}
						<p class="px-2 py-1.5 text-xs text-slate-400">Sin coincidencias</p>
					{/each}
				</div>
			{/if}
			<!-- Ticket #86: botón "Aceptar" para cerrar el filtro al terminar de elegir (abajo a la izquierda). -->
			<div class="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
				<button type="button" onclick={cerrarFiltro} class="px-4 py-1.5 rounded-lg bg-[#0f3b5e] text-white text-sm font-semibold hover:bg-[#0c3150]">Aceptar</button>
			</div>
		</div>
	{/if}

	<!-- Pagination Footer (ticket #75) -->
	<div class="p-4 border-t border-slate-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mt-auto bg-slate-50/30">
		<span class="text-xs text-slate-500 font-medium">
			{#if filtradas.length === 0}
				Sin registros
			{:else}
				Mostrando {(paginaActual - 1) * filasPorPagina + 1}–{(paginaActual - 1) * filasPorPagina + filasPagina.length} de {filtradas.length} registros{filtradas.length < data.length ? ` (filtrados de ${data.length})` : ''}
			{/if}
		</span>

		<div class="flex flex-wrap items-center gap-3 sm:gap-4">
			<label class="flex items-center gap-2">
				<span class="text-xs text-slate-500 whitespace-nowrap">Filas por página</span>
				<select bind:value={filasPorPagina} class="text-xs border border-slate-200 rounded px-2 py-1 outline-none text-slate-700 bg-white">
					{#each OPCIONES_FILAS as n (n)}<option value={n}>{n}</option>{/each}
				</select>
			</label>

			<div class="flex items-center gap-1">
				<button type="button" onclick={() => irAPagina(1)} disabled={paginaActual === 1} class="hidden sm:flex w-7 h-7 rounded border border-slate-200 items-center justify-center text-slate-600 hover:bg-slate-50 transition-colors disabled:text-slate-300 disabled:hover:bg-transparent disabled:cursor-not-allowed" aria-label="Primera página">
					<i class="fas fa-step-backward text-[10px]"></i>
				</button>
				<button type="button" onclick={() => irAPagina(paginaActual - 1)} disabled={paginaActual === 1} class="w-8 h-8 sm:w-7 sm:h-7 rounded border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-colors disabled:text-slate-300 disabled:hover:bg-transparent disabled:cursor-not-allowed" aria-label="Página anterior">
					<i class="fas fa-chevron-left text-[10px]"></i>
				</button>

				{#each numerosPagina as n (n)}
					<button type="button" onclick={() => irAPagina(n)} aria-current={n === paginaActual ? 'page' : undefined} class={`w-8 h-8 sm:w-7 sm:h-7 rounded text-xs flex items-center justify-center transition-colors ${n === paginaActual ? 'bg-blue-600 text-white font-bold shadow-sm' : 'hover:bg-slate-100 text-slate-600 font-medium'}`}>{n}</button>
				{/each}

				<button type="button" onclick={() => irAPagina(paginaActual + 1)} disabled={paginaActual === totalPaginas} class="w-8 h-8 sm:w-7 sm:h-7 rounded border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 transition-colors disabled:text-slate-300 disabled:hover:bg-transparent disabled:cursor-not-allowed" aria-label="Página siguiente">
					<i class="fas fa-chevron-right text-[10px]"></i>
				</button>
				<button type="button" onclick={() => irAPagina(totalPaginas)} disabled={paginaActual === totalPaginas} class="hidden sm:flex w-7 h-7 rounded border border-slate-200 items-center justify-center text-slate-600 hover:bg-slate-50 transition-colors disabled:text-slate-300 disabled:hover:bg-transparent disabled:cursor-not-allowed" aria-label="Última página">
					<i class="fas fa-step-forward text-[10px]"></i>
				</button>
			</div>
		</div>
	</div>
</div>
