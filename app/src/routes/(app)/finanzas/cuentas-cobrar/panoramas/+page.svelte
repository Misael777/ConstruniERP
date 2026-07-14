<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { dndzone } from 'svelte-dnd-action';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { formatCurrency, type FieldOption } from '$lib/shared/fieldConfig';
	import { ArrowLeft, Receipt, GripVertical, Download, Plus, Info, Lightbulb, DollarSign, TrendingUp, CreditCard, Wallet, Target, Clock, AlertTriangle, Users } from '@lucide/svelte';
	import {
		getCobrosPendientes,
		getProyeccionPagos,
		getCobradoEnRango,
		getResumenCobros,
		getProyectoOptions,
		type IngresoPendienteItem,
		type PrioridadCobro,
		type ResumenCobros
	} from '$lib/modules/panoramas/services/panoramas.service';
	import { getClienteOptions, getCobros, sincronizarCuotasProgramadas } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';
	import { getCentroCostoOptions } from '$lib/modules/transacciones/services/transacciones.service';
	import { getMovimientosCaja } from '$lib/modules/transacciones/services/movimientosCaja.service';
	import CuentaCobrarModal from '$lib/modules/cuentas-cobrar/components/CuentaCobrarModal.svelte';
	import FraccionamientoModal, { type Fraccion } from '$lib/shared/components/FraccionamientoModal.svelte';

	// Tablero de planeación de flujo de cobro: contraparte de /finanzas/cuentas-pagar/panoramas,
	// mismo patrón (bandeja + 2 panoramas fijos, 100% de la sesión actual, NO se persiste el orden
	// en la BD — ver panoramas.service.ts). Reutiliza cuentas_cobrar (con su columna real `prioridad`)
	// en vez de crear una tabla de "proyecciones" nueva.
	//
	// Drag-and-drop con svelte-dnd-action (funciona con mouse Y touch), igual que en cuentas_pagar.

	const PANORAMAS = [
		{ id: 1 as const, nombre: 'Panorama 1', subtitulo: 'Escenario base' },
		{ id: 2 as const, nombre: 'Panorama 2', subtitulo: 'Escenario optimista' }
	];

	const panoramaBadgeClass: Record<1 | 2, string> = {
		1: 'bg-blue-100 text-blue-700',
		2: 'bg-emerald-100 text-emerald-700'
	};
	const panoramaCardClass: Record<1 | 2, string> = {
		1: 'bg-red-50/60 border-red-100',
		2: 'bg-green-50/60 border-green-100'
	};

	const prioridadBadgeClass: Record<PrioridadCobro, string> = {
		alto: 'bg-red-100 text-red-700',
		medio: 'bg-amber-100 text-amber-700',
		bajo: 'bg-green-100 text-green-700'
	};
	const prioridadLabel: Record<PrioridadCobro, string> = { alto: 'Alto', medio: 'Medio', bajo: 'Bajo' };

	const estadoVencBadgeClass = { vencido: 'bg-red-100 text-red-700', por_vencer: 'bg-amber-100 text-amber-700' };
	const estadoVencLabel = { vencido: 'Vencido', por_vencer: 'Por vencer' };

	function diasHasta(fecha: string | null): number | null {
		if (!fecha) return null;
		const hoy = new Date();
		hoy.setHours(0, 0, 0, 0);
		const d = new Date(fecha);
		if (Number.isNaN(d.getTime())) return null;
		return Math.round((d.getTime() - hoy.getTime()) / (24 * 60 * 60 * 1000));
	}
	function estadoVencimiento(fecha: string | null): 'vencido' | 'por_vencer' {
		const dias = diasHasta(fecha);
		return dias !== null && dias < 0 ? 'vencido' : 'por_vencer';
	}

	function primerYUltimoDiaMes(base: Date): { desde: string; hasta: string } {
		const desde = new Date(base.getFullYear(), base.getMonth(), 1);
		const hasta = new Date(base.getFullYear(), base.getMonth() + 1, 0);
		const toISO = (d: Date) => d.toISOString().slice(0, 10);
		return { desde: toISO(desde), hasta: toISO(hasta) };
	}

	const hoy = new Date();
	const { desde: mesDesde, hasta: mesHasta } = primerYUltimoDiaMes(hoy);
	const mesAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
	const { desde: mesAntDesde, hasta: mesAntHasta } = primerYUltimoDiaMes(mesAnterior);
	const nombreMesActual = hoy.toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });

	let loading = $state(true);
	let loadError = $state('');

	let bandeja = $state<IngresoPendienteItem[]>([]);
	let panorama1 = $state<IngresoPendienteItem[]>([]);
	let panorama2 = $state<IngresoPendienteItem[]>([]);

	let proyectoOptions = $state<FieldOption[]>([]);
	let clienteOptions = $state<FieldOption[]>([]);
	let centroCostoOptions = $state<FieldOption[]>([]);

	let filtroObra = $state('');
	let filtroCliente = $state('');
	let filtroPrioridad = $state<'' | PrioridadCobro>('');
	let filtroEstado = $state<'' | 'pendiente' | 'vencido'>('');

	let proyeccionPagos = $state(0);
	let saldoActual = $state(0);
	let cobradoDelMes = $state(0);
	let cobradoMesAnterior = $state(0);
	let resumen = $state<ResumenCobros>({ totalPendiente: 0, vencidoTotal: 0, vencidoCount: 0, clientesConVentas: 0 });

	let cuentaModalOpen = $state(false);

	// Popup de cuotas: se abre haciendo clic en el icono de arrastrar (⋮⋮) de cualquier tarjeta —
	// de la Bandeja o de un Panorama — para ver/editar el calendario de cuotas 'programado' de esa
	// cuenta puntual, sin salir de este tablero. Reutiliza el mismo componente que usa Editar Cuenta
	// por Cobrar (ver CuentaCobrarModal.svelte), pero acá se guarda directo con
	// sincronizarCuotasProgramadas (no hay un formulario completo de cuenta alrededor).
	let cuotasModalOpen = $state(false);
	let cuotasCargando = $state(false);
	let cuotasCuentaActual = $state<{ id: number; monto: number; fechaEmision: string; fechaVencimiento: string | null } | null>(null);
	let cuotasFraccionesIniciales = $state<Fraccion[]>([]);

	async function abrirCuotasDe(item: IngresoPendienteItem) {
		cuotasCargando = true;
		try {
			const { data: cuenta, error } = await supabase
				.from('cuentas_cobrar')
				.select('monto, fecha_emision, fecha_vencimiento')
				.eq('id_cuenta_cobrar', item.id_cuenta_cobrar)
				.single();
			if (error || !cuenta) throw error ?? new Error('Cuenta no encontrada');

			const cobros = await getCobros(supabase, item.id_cuenta_cobrar);
			cuotasFraccionesIniciales = cobros
				.filter((c) => c.estado_cobro === 'programado')
				.map((c) => ({ fecha: c.fecha_cobro, monto: Number(c.monto) }))
				.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
			cuotasCuentaActual = { id: item.id_cuenta_cobrar, monto: Number(cuenta.monto), fechaEmision: cuenta.fecha_emision, fechaVencimiento: cuenta.fecha_vencimiento };
			cuotasModalOpen = true;
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar las cuotas de esta cuenta');
		} finally {
			cuotasCargando = false;
		}
	}

	async function handleCuotasConfirmadas(fracciones: Fraccion[]) {
		if (!cuotasCuentaActual) return;
		await sincronizarCuotasProgramadas(supabase, cuotasCuentaActual.id, fracciones);
		toast.success('Cuotas actualizadas');
		cuotasCuentaActual = null;
	}

	async function handleCuotasEliminadas() {
		if (!cuotasCuentaActual) return;
		await sincronizarCuotasProgramadas(supabase, cuotasCuentaActual.id, []);
		toast.success('Cuotas eliminadas');
		cuotasCuentaActual = null;
	}

	// svelte-dnd-action a veces no refleja bien un reemplazo de `items` que viene de FUERA de un
	// arrastre real (ej. un botón que vacía/copia un panorama de un tirón) — su estado interno de
	// "shadow items" puede quedar desincronizado. Envolver cada zona en {#key ...} con estos
	// contadores fuerza a Svelte a destruir y recrear esa zona entera cuando la tocamos por fuera
	// del drag-and-drop, así siempre arranca limpia con el arreglo nuevo.
	let bandejaVersion = $state(0);
	let panorama1Version = $state(0);
	let panorama2Version = $state(0);

	function panoramaItems(id: 1 | 2) {
		return id === 1 ? panorama1 : panorama2;
	}
	function setPanoramaItems(id: 1 | 2, items: IngresoPendienteItem[]) {
		if (id === 1) panorama1 = items;
		else panorama2 = items;
	}

	/** Trae la bandeja desde la BD, excluyendo lo que YA está en un panorama en esta sesión (si no,
	 * al cambiar un filtro reaparecería en la bandeja una cuenta que el usuario ya arrastró). */
	async function fetchBandeja() {
		loading = true;
		try {
			const data = await getCobrosPendientes(supabase, {
				idProyecto: filtroObra ? Number(filtroObra) : null,
				idCliente: filtroCliente ? Number(filtroCliente) : null,
				prioridad: filtroPrioridad || null,
				estado: filtroEstado || null
			});
			const idsAsignados = new Set([...panorama1, ...panorama2].map((i) => i.id));
			bandeja = data.filter((i) => !idsAsignados.has(i.id));
			bandejaVersion++;
			loadError = '';
		} catch (err: any) {
			loadError = err.message || 'No se pudo cargar el tablero de panoramas';
		} finally {
			loading = false;
		}
	}

	async function fetchResumenYCaja() {
		try {
			const [pagos, resumenData, cobradoMes, cobradoAnt, caja] = await Promise.all([
				getProyeccionPagos(supabase, mesDesde, mesHasta),
				getResumenCobros(supabase),
				getCobradoEnRango(supabase, mesDesde, mesHasta),
				getCobradoEnRango(supabase, mesAntDesde, mesAntHasta),
				getMovimientosCaja(supabase, { desde: mesDesde, hasta: mesHasta })
			]);
			proyeccionPagos = pagos;
			resumen = resumenData;
			cobradoDelMes = cobradoMes;
			cobradoMesAnterior = cobradoAnt;
			saldoActual = caja.saldoActual;
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudo cargar el resumen de caja');
		}
	}

	onMount(async () => {
		try {
			[proyectoOptions, clienteOptions, centroCostoOptions] = await Promise.all([
				getProyectoOptions(supabase),
				getClienteOptions(supabase),
				getCentroCostoOptions(supabase)
			]);
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar obras/clientes');
		}
		await Promise.all([fetchBandeja(), fetchResumenYCaja()]);
	});

	function refetchOnFilterChange() {
		fetchBandeja();
	}

	// --- Cálculos por panorama (100% derivados de los arreglos locales, ver nota de sesión arriba) ---
	function totalProyeccion(id: 1 | 2) {
		return panoramaItems(id).reduce((sum, i) => sum + i.monto, 0);
	}
	/** Parte del panorama cuya fecha de vencimiento cae dentro del mes en vista (Mes actual). */
	function cobradoEstimado(id: 1 | 2) {
		return panoramaItems(id)
			.filter((i) => i.fechaVencimiento && i.fechaVencimiento >= mesDesde && i.fechaVencimiento <= mesHasta)
			.reduce((sum, i) => sum + i.monto, 0);
	}
	function porCobrar(id: 1 | 2) {
		return totalProyeccion(id) - cobradoEstimado(id);
	}
	function disponibleEnCaja(id: 1 | 2) {
		return saldoActual + cobradoEstimado(id);
	}
	/** "Cuántas veces" la caja disponible proyectada (de ESTE mes) cubre los pagos que VENCEN este mismo
	 * mes (no toda la deuda pendiente, para comparar el mismo período en ambos lados). Umbral heurístico
	 * (AJUSTAR si el ERP define un criterio formal): ≥1.5 Saludable, ≥1 Ajustado, si no Crítico. */
	function cobertura(id: 1 | 2): number | null {
		return proyeccionPagos > 0 ? disponibleEnCaja(id) / proyeccionPagos : null;
	}
	function estadoFlujo(id: 1 | 2): 'saludable' | 'ajustado' | 'critico' {
		const c = cobertura(id);
		if (c === null) return 'saludable';
		if (c >= 1.5) return 'saludable';
		if (c >= 1) return 'ajustado';
		return 'critico';
	}
	const estadoFlujoBadge = { saludable: 'bg-emerald-100 text-emerald-700', ajustado: 'bg-amber-100 text-amber-700', critico: 'bg-red-100 text-red-700' };
	const estadoFlujoLabel = { saludable: 'Saludable', ajustado: 'Ajustado', critico: 'Crítico' };

	const deltaCobradoMes = $derived(cobradoMesAnterior > 0 ? ((cobradoDelMes - cobradoMesAnterior) / cobradoMesAnterior) * 100 : null);

	// --- Drag and drop: 100% local, no toca la BD (ver nota de sesión arriba) ---
	const FLIP_MS = 150;

	function handleBandejaConsider(e: CustomEvent<{ items: IngresoPendienteItem[] }>) {
		bandeja = e.detail.items;
	}
	function handleBandejaFinalize(e: CustomEvent<{ items: IngresoPendienteItem[] }>) {
		bandeja = e.detail.items;
	}
	function handlePanoramaConsider(id: 1 | 2, e: CustomEvent<{ items: IngresoPendienteItem[] }>) {
		setPanoramaItems(id, e.detail.items);
	}
	function handlePanoramaFinalize(id: 1 | 2, e: CustomEvent<{ items: IngresoPendienteItem[] }>) {
		setPanoramaItems(id, e.detail.items);
	}

	// --- Acciones rápidas ---
	function vaciarPanorama(id: 1 | 2) {
		const items = panoramaItems(id);
		if (items.length === 0) return;
		bandeja = [...bandeja, ...items];
		setPanoramaItems(id, []);
		bandejaVersion++;
		if (id === 1) panorama1Version++;
		else panorama2Version++;
		toast.success(`${PANORAMAS[id - 1].nombre} vaciado`);
	}
	function copiarPanorama1a2() {
		if (panorama1.length === 0) {
			toast.error('Panorama 1 está vacío');
			return;
		}
		panorama2 = panorama1.map((i) => ({ ...i }));
		panorama2Version++;
		toast.success('Panorama 1 copiado a Panorama 2');
	}


	function exportarCSV() {
		const filas: string[] = ['Ubicación,Título,Cliente,Proyecto,Monto,Vencimiento,Prioridad'];
		const agregar = (ubicacion: string, items: IngresoPendienteItem[]) => {
			for (const i of items) {
				const cols = [ubicacion, i.titulo, i.clienteNombre, i.proyectoNombre ?? '', i.monto.toFixed(2), i.fechaVencimiento ?? '', prioridadLabel[i.prioridad]];
				filas.push(cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
			}
		};
		agregar('Bandeja', bandeja);
		agregar('Panorama 1', panorama1);
		agregar('Panorama 2', panorama2);

		const blob = new Blob([filas.join('\n')], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `panoramas-cobro-${mesDesde}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function handleCuentaGuardada() {
		await Promise.all([fetchBandeja(), fetchResumenYCaja()]);
	}
</script>

<div class="max-w-[1700px] mx-auto">
	<div class="flex items-center justify-between mb-6 flex-wrap gap-3">
		<div class="flex items-center gap-3">
			<button type="button" onclick={() => goto('/finanzas/cuentas-cobrar')} class="p-2 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Volver a Cuentas por Cobrar">
				<ArrowLeft size={18} />
			</button>
			<div>
				<h1 class="text-xl font-bold text-[#0f3b5e]">Panoramas de Cobro</h1>
				<p class="text-sm text-slate-500">Gestiona y planifica los cobros proyectados por obra y cliente. Arrastra y ordena los ingresos para simular tu flujo de caja.</p>
			</div>
		</div>
		<div class="flex items-center gap-2">
			<button type="button" onclick={exportarCSV} class="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50">
				<Download size={16} /> Exportar
			</button>
			<button type="button" onclick={() => (cuentaModalOpen = true)} class="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-medium hover:bg-[#0c2f4c]">
				<Plus size={16} /> Nueva Cuenta por Cobrar
			</button>
		</div>
	</div>

	{#if loadError}
		<div class="mb-4 bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm">{loadError}</div>
	{/if}

	<!-- KPIs -->
	<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0"><DollarSign size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Proyección de ingreso total (Panorama 1)</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(totalProyeccion(1))}</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center shrink-0"><TrendingUp size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Proyección de ingreso total (Panorama 2)</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(totalProyeccion(2))}</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center shrink-0"><CreditCard size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Ingresos vendidos (no cobrados)</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(resumen.totalPendiente)}</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0"><Wallet size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Cobrado del mes</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(cobradoDelMes)}</p>
			{#if deltaCobradoMes !== null}
				<p class={`text-xs mt-1 ${deltaCobradoMes >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{deltaCobradoMes >= 0 ? '+' : ''}{deltaCobradoMes.toFixed(1)}% vs mes anterior</p>
			{/if}
		</div>
	</div>

	<div class="grid grid-cols-1 xl:grid-cols-[280px_1fr_1fr_300px] gap-4 items-start">
		<!-- Bandeja -->
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-1">
				<h2 class="font-bold text-slate-800 text-sm uppercase tracking-wide">Bandeja por Proyectar</h2>
				<span class="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{bandeja.length}</span>
			</div>
			<p class="text-xs text-slate-400 mb-3">Arrastra los ingresos pendientes para asignarlos a un panorama.</p>

			<div class="flex flex-col gap-2 mb-3">
				<select value={filtroObra} onchange={(e) => { filtroObra = (e.target as HTMLSelectElement).value; refetchOnFilterChange(); }} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
					<option value="">Todas las obras</option>
					{#each proyectoOptions as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
				<select value={filtroCliente} onchange={(e) => { filtroCliente = (e.target as HTMLSelectElement).value; refetchOnFilterChange(); }} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
					<option value="">Todos los clientes</option>
					{#each clienteOptions as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
				<select value={filtroPrioridad} onchange={(e) => { filtroPrioridad = (e.target as HTMLSelectElement).value as any; refetchOnFilterChange(); }} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
					<option value="">Prioridad: Todas</option>
					<option value="alto">Prioridad: Alto</option>
					<option value="medio">Prioridad: Medio</option>
					<option value="bajo">Prioridad: Bajo</option>
				</select>
				<select value={filtroEstado} onchange={(e) => { filtroEstado = (e.target as HTMLSelectElement).value as any; refetchOnFilterChange(); }} class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
					<option value="">Estado: Todas</option>
					<option value="pendiente">Estado: Pendiente</option>
					<option value="vencido">Estado: Vencido</option>
				</select>
			</div>

			{#key bandejaVersion}
				<div
					use:dndzone={{ items: bandeja, flipDurationMs: FLIP_MS }}
					onconsider={handleBandejaConsider}
					onfinalize={handleBandejaFinalize}
					class="flex flex-col gap-2 min-h-[100px]"
				>
					{#each bandeja as item (item.id)}
						<div class="flex items-start gap-2 p-3 rounded-lg border border-slate-200 bg-white cursor-grab active:cursor-grabbing">
							<button
								type="button"
								onclick={(e) => { e.stopPropagation(); abrirCuotasDe(item); }}
								class="p-1 -m-1 mt-0.5 rounded-md text-slate-300 hover:bg-slate-100 hover:text-slate-600 shrink-0"
								title="Ver/editar cuotas de esta cuenta"
								aria-label="Ver/editar cuotas de esta cuenta"
							>
								<GripVertical size={14} />
							</button>
							<div class="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
								<Receipt size={16} />
							</div>
							<div class="flex-1 min-w-0">
								<p class="text-sm font-semibold text-slate-800 truncate">{item.titulo}</p>
								<p class="text-xs text-slate-500 truncate">Proyecto: {item.proyectoNombre ?? 'Sin proyecto'}</p>
								<p class="text-xs text-slate-500 truncate">Cliente: {item.clienteNombre}</p>
								<p class="text-[11px] text-slate-400">Vencimiento: {item.fechaVencimiento ?? '—'}</p>
								<div class="flex items-center justify-between mt-1">
									<span class="text-sm font-bold text-slate-800">{formatCurrency(item.monto)}</span>
									<span class={`px-2 py-0.5 rounded-full text-[10px] font-medium ${prioridadBadgeClass[item.prioridad]}`}>{prioridadLabel[item.prioridad]}</span>
								</div>
							</div>
						</div>
					{:else}
						<p class="text-xs text-slate-400 text-center py-6">{loading ? 'Cargando...' : 'Sin ingresos pendientes por asignar.'}</p>
					{/each}
				</div>
			{/key}
		</div>

		<!-- Panoramas -->
		{#each PANORAMAS as panorama (panorama.id)}
			<div class={`rounded-xl border p-4 ${panoramaCardClass[panorama.id]}`}>
				<div class="flex items-center justify-between mb-4">
					<div class="flex items-center gap-2">
						<h2 class="font-bold text-slate-800">{panorama.nombre}</h2>
						<span class={`text-[10px] font-medium px-2 py-0.5 rounded-full ${panoramaBadgeClass[panorama.id]}`}>{panorama.subtitulo}</span>
					</div>
				</div>

				<p class="text-xs text-slate-400 mb-2">Orden de cobros (arrastra para reordenar)</p>

				{#key panorama.id === 1 ? panorama1Version : panorama2Version}
					<div
						use:dndzone={{ items: panoramaItems(panorama.id), flipDurationMs: FLIP_MS }}
						onconsider={(e) => handlePanoramaConsider(panorama.id, e)}
						onfinalize={(e) => handlePanoramaFinalize(panorama.id, e)}
						class="flex flex-col gap-2 min-h-[100px] mb-4"
					>
						{#each panoramaItems(panorama.id) as item, index (item.id)}
							{@const venc = estadoVencimiento(item.fechaVencimiento)}
							<div class={`flex items-center gap-2 p-3 rounded-lg border cursor-grab active:cursor-grabbing ${venc === 'vencido' ? 'bg-red-50/60 border-red-100' : 'border-slate-200 bg-white'}`}>
								<button
									type="button"
									onclick={(e) => { e.stopPropagation(); abrirCuotasDe(item); }}
									class="p-1 -m-1 rounded-md text-slate-300 hover:bg-slate-100 hover:text-slate-600 shrink-0"
									title="Ver/editar cuotas de esta cuenta"
									aria-label="Ver/editar cuotas de esta cuenta"
								>
									<GripVertical size={14} />
								</button>
								<span class={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${panoramaBadgeClass[panorama.id]}`}>{index + 1}</span>
								<div class="flex-1 min-w-0">
									<p class="text-sm font-semibold text-slate-800 truncate">{item.titulo}</p>
									<p class="text-xs text-slate-500 truncate">Proyecto: {item.proyectoNombre ?? 'Sin proyecto'}</p>
									<p class="text-xs text-slate-500 truncate">Cliente: {item.clienteNombre}</p>
								</div>
								<div class="text-right shrink-0">
									<p class="text-sm font-bold text-slate-800">{formatCurrency(item.monto)}</p>
									<span class={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${estadoVencBadgeClass[venc]}`}>{estadoVencLabel[venc]}</span>
									<p class="text-[11px] text-slate-400 mt-0.5">{item.fechaVencimiento ?? '—'}</p>
								</div>
							</div>
						{:else}
							<p class="text-xs text-slate-400 text-center py-6">Suelta aquí un ingreso de la bandeja.</p>
						{/each}
					</div>
				{/key}

				<div class="grid grid-cols-3 gap-2 text-center border-t border-slate-100 pt-3">
					<div>
						<p class="text-[10px] text-slate-400 uppercase">Total proyección</p>
						<p class="text-sm font-bold text-slate-800">{formatCurrency(totalProyeccion(panorama.id))}</p>
					</div>
					<div>
						<p class="text-[10px] text-slate-400 uppercase">Cobrado estimado</p>
						<p class="text-sm font-bold text-emerald-600">{formatCurrency(cobradoEstimado(panorama.id))}</p>
					</div>
					<div>
						<p class="text-[10px] text-slate-400 uppercase">Por cobrar</p>
						<p class="text-sm font-bold text-amber-600">{formatCurrency(porCobrar(panorama.id))}</p>
					</div>
				</div>
				<div class="grid grid-cols-3 gap-2 text-center border-t border-slate-100 mt-3 pt-3">
					<div>
						<p class="text-[10px] text-slate-400 uppercase">Caja proyectada</p>
						<p class="text-sm font-bold text-slate-800">{formatCurrency(disponibleEnCaja(panorama.id))}</p>
					</div>
					<div>
						<p class="text-[10px] text-slate-400 uppercase">Estado de flujo</p>
						<span class={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${estadoFlujoBadge[estadoFlujo(panorama.id)]}`}>{estadoFlujoLabel[estadoFlujo(panorama.id)]}</span>
					</div>
					<div>
						<p class="text-[10px] text-slate-400 uppercase">Cobertura</p>
						<p class="text-sm font-bold text-slate-800">{cobertura(panorama.id) !== null ? `${cobertura(panorama.id)!.toFixed(1)}x` : '—'}</p>
					</div>
				</div>
			</div>
		{/each}

		<!-- Resumen / acciones / ayuda -->
		<div class="flex flex-col gap-4">
			<div class="bg-white rounded-xl border border-slate-200 p-4">
				<h2 class="font-bold text-slate-800 text-sm uppercase tracking-wide mb-1">Resumen General</h2>
				<p class="text-xs text-slate-400 mb-3 capitalize">{nombreMesActual}</p>
				<div class="space-y-2 text-sm">
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-1.5 text-slate-500"><Target size={14} class="text-blue-500 shrink-0" /> Ingresos proyectados totales</span>
						<span class="font-bold text-slate-800">{formatCurrency(totalProyeccion(1) + totalProyeccion(2))}</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-1.5 text-slate-500"><Wallet size={14} class="text-emerald-500 shrink-0" /> Cobrado estimado total</span>
						<span class="font-bold text-slate-800">{formatCurrency(cobradoEstimado(1) + cobradoEstimado(2))}</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-1.5 text-slate-500"><Clock size={14} class="text-amber-500 shrink-0" /> Por cobrar total</span>
						<span class="font-bold text-slate-800">{formatCurrency(porCobrar(1) + porCobrar(2))}</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-1.5 text-red-600"><AlertTriangle size={14} class="text-red-500 shrink-0" /> Ingresos vencidos</span>
						<span class="font-bold text-red-600">{formatCurrency(resumen.vencidoTotal)}</span>
					</div>
					<p class="text-[11px] text-slate-400 text-right -mt-1">{resumen.vencidoCount} documento{resumen.vencidoCount === 1 ? '' : 's'}</p>
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-1.5 text-slate-500"><Users size={14} class="text-purple-500 shrink-0" /> Clientes con ventas</span>
						<span class="font-bold text-slate-800">{resumen.clientesConVentas}</span>
					</div>
				</div>
			</div>

			<div class="bg-white rounded-xl border border-slate-200 p-4">
				<h2 class="font-bold text-slate-800 text-sm uppercase tracking-wide mb-3">Acciones Rápidas</h2>
				<div class="space-y-2">
					<button type="button" onclick={() => (cuentaModalOpen = true)} class="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm">
						<p class="font-medium text-slate-800">Nueva Cuenta por Cobrar</p>
						<p class="text-xs text-slate-400">Registra un ingreso pendiente por obra</p>
					</button>
					<button type="button" onclick={copiarPanorama1a2} class="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm">
						<p class="font-medium text-slate-800">Copiar Panorama 1 → Panorama 2</p>
						<p class="text-xs text-slate-400">Parte del mismo orden para comparar variantes</p>
					</button>
					<button type="button" onclick={() => vaciarPanorama(1)} class="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm">
						<p class="font-medium text-slate-800">Vaciar Panorama 1</p>
						<p class="text-xs text-slate-400">Regresa sus ingresos a la bandeja</p>
					</button>
					<button type="button" onclick={() => vaciarPanorama(2)} class="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm">
						<p class="font-medium text-slate-800">Vaciar Panorama 2</p>
						<p class="text-xs text-slate-400">Regresa sus ingresos a la bandeja</p>
					</button>
				</div>
			</div>

			<div class="bg-white rounded-xl border border-slate-200 p-4">
				<h2 class="font-bold text-slate-800 text-sm uppercase tracking-wide mb-3 flex items-center gap-1.5">
					<Lightbulb size={14} class="text-amber-500" /> ¿Cómo Funciona?
				</h2>
				<ul class="space-y-2 text-xs text-slate-500">
					<li><span class="font-medium text-slate-700">Arrastra los ingresos pendientes</span> — desde la bandeja izquierda hacia cada panorama.</li>
					<li><span class="font-medium text-slate-700">Ordena por prioridad</span> — arrastra y ajusta libremente el orden de cobro dentro de cada panorama.</li>
					<li><span class="font-medium text-slate-700">Compara escenarios</span> — revisa lado a lado el flujo proyectado de cada panorama.</li>
				</ul>
			</div>
		</div>
	</div>

	<div class="mt-4 flex items-start gap-2 bg-blue-50 text-blue-700 px-4 py-3 rounded-lg text-xs">
		<Info size={16} class="shrink-0 mt-0.5" />
		<p>Las proyecciones te permiten simular escenarios de cobro, ordenar prioridades y optimizar tu flujo de caja antes de que se ejecuten los ingresos. El orden de cada panorama no se guarda: se reinicia al recargar la página.</p>
	</div>
</div>

<CuentaCobrarModal
	open={cuentaModalOpen}
	mode="create"
	cuenta={null}
	dynamicOptions={{ id_cliente: clienteOptions, id_proyecto: proyectoOptions, id_centro_costo: centroCostoOptions }}
	onClose={() => (cuentaModalOpen = false)}
	onSaved={handleCuentaGuardada}
/>

<FraccionamientoModal
	open={cuotasModalOpen}
	titulo="Fraccionar Cobros"
	montoTotal={cuotasCuentaActual?.monto ?? 0}
	fechaEmision={cuotasCuentaActual?.fechaEmision ?? ''}
	fechaVencimiento={cuotasCuentaActual?.fechaVencimiento ?? null}
	fraccionesIniciales={cuotasFraccionesIniciales}
	onClose={() => (cuotasModalOpen = false)}
	onConfirm={handleCuotasConfirmadas}
	onEliminar={handleCuotasEliminadas}
/>
