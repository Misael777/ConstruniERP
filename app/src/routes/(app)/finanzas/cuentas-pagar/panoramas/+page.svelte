<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { dndzone } from 'svelte-dnd-action';
	import { supabase } from '$lib/supabaseClient';
	import { isAdmin } from '$lib/stores/permisos.svelte';
	import { toast } from '$lib/stores/toast';
	import { formatCurrency, type FieldOption } from '$lib/shared/fieldConfig';
	import { ArrowLeft, Package, GripVertical, MoreVertical, Loader2, Download, Plus, Info, Lightbulb, DollarSign, TrendingDown, CreditCard, Wallet, Target, Clock, AlertTriangle, Users, LayoutGrid, CalendarDays, Layers } from '@lucide/svelte';
	import {
		getPagosPendientes,
		getPanoramaItems,
		getProyeccionIngresos,
		getProyeccionPagos,
		getPagadoEnRango,
		getResumenPagos,
		getProyectoOptions,
		computeEstadoVencimiento,
		actualizarFechasVencimientoPago,
		reorderPanorama,
		assignFraccionesToPanorama,
		moverFraccionAPanorama,
		type PagoPendienteItem,
		type PanoramaEntry,
		type Prioridad,
		type ResumenPagos
	} from '$lib/modules/panoramas/services/panoramas.service';
	import { getProveedorOptions, getPagos, sincronizarCuotasProgramadas } from '$lib/modules/cuentas-pagar/services/cuentasPagar.service';
	import { getClienteOptions } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';
	import { getCentroCostoOptions } from '$lib/modules/transacciones/services/transacciones.service';
	import { getMovimientosCaja } from '$lib/modules/transacciones/services/movimientosCaja.service';
	import CuentaPagarModal from '$lib/modules/cuentas-pagar/components/CuentaPagarModal.svelte';
	import CuentaCobrarModal from '$lib/modules/cuentas-cobrar/components/CuentaCobrarModal.svelte';
	import FraccionamientoModal, { type Fraccion } from '$lib/shared/components/FraccionamientoModal.svelte';
	import PanoramaCalendarView from '$lib/modules/panoramas/components/PanoramaCalendarView.svelte';

	// Tablero de planeación de flujo de caja: reutiliza cuentas_pagar (y pagos, para cuentas
	// fraccionadas) para leer los pagos pendientes. La organización en Bandeja / Panorama 1 /
	// Panorama 2 SÍ se persiste en la BD (panorama_id/panorama_orden — ver panoramas.service.ts,
	// panorama_persistencia_migration.sql) — sobrevive a recargar la página. Drag-and-drop con
	// svelte-dnd-action (funciona con mouse Y touch).
	//
	// FRACCIONAMIENTO: una cuenta con 2+ cuotas 'programado' se dibuja como CLUSTER — su tarjeta
	// muestra una fila por cuota. Arrastrar la tarjeta del cluster completa mueve todas sus cuotas
	// visibles juntas ("en bloque"). Cada fila de cuota individual tiene sus propios botones rápidos
	// para moverla ELLA SOLA a otra columna, independiente de sus hermanas (ver moverFraccion).

	const PANORAMAS = [
		{ id: 1 as const, nombre: 'Panorama 1', subtitulo: 'Escenario base' },
		{ id: 2 as const, nombre: 'Panorama 2', subtitulo: 'Escenario optimizado' }
	];

	const panoramaBadgeClass: Record<1 | 2, string> = {
		1: 'bg-blue-100 text-blue-700',
		2: 'bg-emerald-100 text-emerald-700'
	};
	const panoramaCardClass: Record<1 | 2, string> = {
		1: 'bg-red-50/60 border-red-100',
		2: 'bg-green-50/60 border-green-100'
	};

	const prioridadBadgeClass: Record<Prioridad, string> = {
		alto: 'bg-red-100 text-red-700',
		media: 'bg-amber-100 text-amber-700',
		bajo: 'bg-green-100 text-green-700'
	};
	const prioridadLabel: Record<Prioridad, string> = { alto: 'Alto', media: 'Media', bajo: 'Bajo' };

	const estadoVencBadgeClass = { vencido: 'bg-red-100 text-red-700', por_vencer: 'bg-amber-100 text-amber-700' };
	const estadoVencLabel = { vencido: 'Vencido', por_vencer: 'Por vencer' };

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

	let bandeja = $state<PagoPendienteItem[]>([]);
	let panorama1 = $state<PagoPendienteItem[]>([]);
	let panorama2 = $state<PagoPendienteItem[]>([]);
	let proyeccionIngresos = $state(0);
	let proyectoOptions = $state<FieldOption[]>([]);
	let proveedorOptions = $state<FieldOption[]>([]);
	let clienteOptions = $state<FieldOption[]>([]);
	let centroCostoOptions = $state<FieldOption[]>([]);

	let filtroObra = $state('');
	let filtroPrioridad = $state<'' | Prioridad>('');

	let ingresosEsteMes = $state(0);
	let saldoActual = $state(0);
	let pagadoDelMes = $state(0);
	let pagadoMesAnterior = $state(0);
	let resumen = $state<ResumenPagos>({ totalPendiente: 0, vencidoTotal: 0, vencidoCount: 0, proveedoresConCompras: 0 });

	let pagoModalOpen = $state(false);
	let cuentaCobrarModalOpen = $state(false);
	let vistaActiva = $state<'tablero' | 'calendario'>('tablero');

	function panoramaItems(id: 1 | 2) {
		return id === 1 ? panorama1 : panorama2;
	}
	function setPanoramaItems(id: 1 | 2, items: PagoPendienteItem[]) {
		if (id === 1) panorama1 = items;
		else panorama2 = items;
	}

	/** Trae la bandeja desde la BD — ya viene filtrada server-side (panorama_id null a nivel de
	 * cuenta, o al menos una cuota sin panorama_id si está fraccionada), no hace falta excluir nada
	 * a mano en el cliente. */
	async function fetchBandeja() {
		loading = true;
		try {
			const data = await getPagosPendientes(supabase, {
				idProyecto: filtroObra ? Number(filtroObra) : null,
				prioridad: filtroPrioridad || null
			});
			bandeja = data;
			bandejaVersion++;
			loadError = '';
		} catch (err: any) {
			loadError = err.message || 'No se pudo cargar el tablero de panoramas';
		} finally {
			loading = false;
		}
	}

	/** Trae Panorama 1 y 2 desde la BD (ya persisten, ver nota de arriba). */
	async function fetchPanoramas() {
		try {
			const [p1, p2] = await Promise.all([getPanoramaItems(supabase, 1), getPanoramaItems(supabase, 2)]);
			panorama1 = p1;
			panorama2 = p2;
			panorama1Version++;
			panorama2Version++;
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar los panoramas');
		}
	}

	/** Convierte una lista de tarjetas (mezcla de cuentas simples y clusters) a PanoramaEntry[] para
	 * persistir con reorderPanorama — un cluster escribe el mismo orden en TODAS sus cuotas visibles
	 * en esa tarjeta (se mueven en bloque). */
	function aEntradas(items: PagoPendienteItem[]): PanoramaEntry[] {
		return items.map((item) =>
			item.fracciones.length > 0 ? { tipo: 'cluster' as const, idsFraccion: item.fracciones.map((f) => f.id) } : { tipo: 'cuenta' as const, id: item.id_cuenta_pagar }
		);
	}

	/** Mueve UNA cuota individual (fila dentro de un cluster) a otra columna, sin tocar sus
	 * hermanas — botones rápidos dentro de cada tarjeta de cluster (ver render). Siempre disponible,
	 * es el equivalente funcional a "arrastrar un fraccionamiento individualmente". */
	async function moverFraccion(idPago: number, destino: 1 | 2 | null) {
		const result = await moverFraccionAPanorama(supabase, idPago, destino);
		if (!result.success) {
			toast.error(result.message);
			return;
		}
		await Promise.all([fetchBandeja(), fetchPanoramas()]);
		toast.success(result.message);
	}

	async function fetchResumenYCaja() {
		try {
			const [ingresos, ingresosMes, resumenData, pagadoMes, pagadoAnt, caja] = await Promise.all([
				getProyeccionIngresos(supabase),
				getProyeccionIngresos(supabase, mesDesde, mesHasta),
				getResumenPagos(supabase),
				getPagadoEnRango(supabase, mesDesde, mesHasta),
				getPagadoEnRango(supabase, mesAntDesde, mesAntHasta),
				getMovimientosCaja(supabase, { desde: mesDesde, hasta: mesHasta })
			]);
			proyeccionIngresos = ingresos;
			ingresosEsteMes = ingresosMes;
			resumen = resumenData;
			pagadoDelMes = pagadoMes;
			pagadoMesAnterior = pagadoAnt;
			saldoActual = caja.saldoActual;
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudo cargar el resumen de caja');
		}
	}

	onMount(async () => {
		if (!isAdmin()) {
			goto('/dashboard');
			return;
		}
		try {
			[proyectoOptions, proveedorOptions, clienteOptions, centroCostoOptions] = await Promise.all([
				getProyectoOptions(supabase),
				getProveedorOptions(supabase),
				getClienteOptions(supabase),
				getCentroCostoOptions(supabase)
			]);
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar obras/proveedores');
		}
		await Promise.all([fetchBandeja(), fetchPanoramas(), fetchResumenYCaja()]);
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
	/** Parte del panorama cuya fecha de vencimiento cae dentro del mes en vista (Mes actual). */
	function pagosEsteMes(id: 1 | 2) {
		return panoramaItems(id)
			.filter((i) => i.fechaVencimiento && i.fechaVencimiento >= mesDesde && i.fechaVencimiento <= mesHasta)
			.reduce((sum, i) => sum + i.monto, 0);
	}
	function disponibleEnCaja(id: 1 | 2) {
		return saldoActual + ingresosEsteMes - pagosEsteMes(id);
	}
	/** "Cuántas veces" la caja de este mes (actual + cobros esperados) cubre los pagos que VENCEN
	 * este mismo mes en este panorama. Umbral heurístico (AJUSTAR si el ERP define un criterio
	 * formal): ≥1.5 Saludable, ≥1 Ajustado, si no Crítico. */
	function cobertura(id: 1 | 2): number | null {
		const pagos = pagosEsteMes(id);
		return pagos > 0 ? (saldoActual + ingresosEsteMes) / pagos : null;
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

	const deltaPagadoMes = $derived(pagadoMesAnterior > 0 ? ((pagadoDelMes - pagadoMesAnterior) / pagadoMesAnterior) * 100 : null);
	const coberturaPromedio = $derived.by(() => {
		const c1 = cobertura(1);
		const c2 = cobertura(2);
		const valores = [c1, c2].filter((c): c is number => c !== null);
		return valores.length > 0 ? valores.reduce((s, v) => s + v, 0) / valores.length : null;
	});

	// --- Drag and drop: 100% local, no toca la BD (ver nota arriba) ---
	const FLIP_MS = 150;

	// svelte-dnd-action a veces no refleja bien un reemplazo de `items` que viene de FUERA de un
	// arrastre real (ej. un botón que vacía/copia un panorama de un tirón) — envolver cada zona en
	// {#key ...} con estos contadores fuerza a Svelte a reconstruirla limpia cuando eso pasa.
	let bandejaVersion = $state(0);
	let panorama1Version = $state(0);
	let panorama2Version = $state(0);

	function handleBandejaConsider(e: CustomEvent<{ items: PagoPendienteItem[] }>) {
		bandeja = e.detail.items;
	}
	async function handleBandejaFinalize(e: CustomEvent<{ items: PagoPendienteItem[] }>) {
		bandeja = e.detail.items;
		const result = await reorderPanorama(supabase, null, aEntradas(bandeja));
		if (!result.success) toast.error(result.message);
	}
	function handlePanoramaConsider(id: 1 | 2, e: CustomEvent<{ items: PagoPendienteItem[] }>) {
		setPanoramaItems(id, e.detail.items);
	}
	async function handlePanoramaFinalize(id: 1 | 2, e: CustomEvent<{ items: PagoPendienteItem[] }>) {
		setPanoramaItems(id, e.detail.items);
		const result = await reorderPanorama(supabase, id, aEntradas(panoramaItems(id)));
		if (!result.success) toast.error(result.message);
	}

	// --- Acciones rápidas ---
	/** "Vaciar" es un movimiento real (destino = bandeja) -> se persiste igual que un arrastre. */
	async function vaciarPanorama(id: 1 | 2) {
		const items = panoramaItems(id);
		if (items.length === 0) return;
		bandeja = [...bandeja, ...items];
		setPanoramaItems(id, []);
		bandejaVersion++;
		if (id === 1) panorama1Version++;
		else panorama2Version++;
		const result = await reorderPanorama(supabase, null, aEntradas(bandeja));
		if (!result.success) {
			toast.error(result.message);
			return;
		}
		toast.success(`${PANORAMAS[id - 1].nombre} vaciado`);
	}
	/** "Copiar" (a diferencia de "vaciar") es a propósito solo visual/de la sesión actual, NO se
	 * persiste: una fila de cuentas_pagar/pagos solo puede tener UN panorama_id a la vez, así que
	 * "estar en los dos panoramas simultáneamente" no es representable en la BD — es una herramienta
	 * de comparación de escenarios ("qué pasaría si"), no un movimiento real. Se pierde al recargar,
	 * a propósito. */
	function copiarPanorama1a2() {
		if (panorama1.length === 0) {
			toast.error('Panorama 1 está vacío');
			return;
		}
		panorama2 = panorama1.map((i) => ({ ...i }));
		panorama2Version++;
		toast.success('Panorama 1 copiado a Panorama 2 (solo en esta sesión — no se guarda)');
	}

	/** Atajo para la vista Calendario: si el usuario todavía no arrastró nada desde la Bandeja al
	 * Tablero, Panorama 1 y 2 se ven vacíos ahí — este botón carga TODOS los pagos pendientes en
	 * ambos panoramas de una vez (Panorama 2 arranca como copia de Panorama 1, mismo criterio que
	 * copiarPanorama1a2) para poder empezar a comparar escenarios arrastrando fechas de inmediato.
	 * Igual que copiarPanorama1a2: solo visual/de la sesión, no se persiste (ver esa nota). */
	function sembrarPanoramasDesdeBandeja() {
		if (bandeja.length === 0) return;
		panorama1 = bandeja.map((i) => ({ ...i }));
		panorama2 = bandeja.map((i) => ({ ...i }));
		bandeja = [];
		bandejaVersion++;
		panorama1Version++;
		panorama2Version++;
		toast.success('Pagos pendientes cargados en Panorama 1 y Panorama 2 (solo en esta sesión — no se guarda)');
	}

	/** Botón de puntos (⋮) junto al número de cada cuota: copia (no mueve, se queda también en el
	 * actual) esa cuenta puntual al otro panorama — como solo hay 2, "el siguiente" siempre es el otro.
	 * Solo visual/de la sesión, no se persiste (mismo motivo que copiarPanorama1a2). */
	function copiarItemAOtroPanorama(item: PagoPendienteItem, panoramaActual: 1 | 2) {
		const destino: 1 | 2 = panoramaActual === 1 ? 2 : 1;
		if (panoramaItems(destino).some((i) => i.id === item.id)) {
			toast.error(`Ya está en ${PANORAMAS[destino - 1].nombre}`);
			return;
		}
		setPanoramaItems(destino, [...panoramaItems(destino), { ...item }]);
		if (destino === 1) panorama1Version++;
		else panorama2Version++;
		toast.success(`Copiado a ${PANORAMAS[destino - 1].nombre}`);
	}

	function exportarCSV() {
		const filas: string[] = ['Ubicación,Título,Proveedor,Monto,Vencimiento,Prioridad'];
		const agregar = (ubicacion: string, items: PagoPendienteItem[]) => {
			for (const i of items) {
				const cols = [ubicacion, i.titulo, i.proveedorNombre, i.monto.toFixed(2), i.fechaVencimiento ?? '', prioridadLabel[i.prioridad]];
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
		a.download = `panoramas-pago-${mesDesde}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function handlePagoGuardado() {
		await Promise.all([fetchBandeja(), fetchResumenYCaja()]);
	}
	async function handleCobroGuardado() {
		await fetchResumenYCaja();
	}

	// Popup de cuotas: se abre haciendo clic en el icono de arrastrar (⋮⋮) de cualquier tarjeta —
	// de la Bandeja o de un Panorama — para ver/editar el calendario de cuotas 'programado' de esa
	// cuenta puntual, sin salir de este tablero.
	let cuotasModalOpen = $state(false);
	/** id_cuenta_pagar del ítem cuyo botón de cuotas está cargando (o null) — muestra un spinner justo
	 * en ese botón para que el clic se sienta inmediato aunque la consulta tarde un poco. */
	let cuotasCargandoId = $state<number | null>(null);
	let cuotasCuentaActual = $state<{ id: number; monto: number; fechaEmision: string; fechaVencimiento: string | null } | null>(null);
	let cuotasFraccionesIniciales = $state<Fraccion[]>([]);

	// item.montoTotal/fechaEmision ya vienen del select('*') que ya se hizo al cargar la bandeja/panorama
	// (ver panoramas.service.ts) — evita una consulta extra a cuentas_pagar, solo falta traer los pagos
	// 'programado' reales.
	async function abrirCuotasDe(item: PagoPendienteItem) {
		cuotasCargandoId = item.id;
		try {
			const pagos = await getPagos(supabase, item.id_cuenta_pagar);
			cuotasFraccionesIniciales = pagos
				.filter((p) => p.estado_pago === 'programado')
				.map((p) => ({ fecha: p.fecha_pago, monto: Number(p.monto) }))
				.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
			cuotasCuentaActual = { id: item.id_cuenta_pagar, monto: item.montoTotal, fechaEmision: item.fechaEmision, fechaVencimiento: item.fechaVencimiento };
			cuotasModalOpen = true;
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar las cuotas de esta cuenta');
		} finally {
			cuotasCargandoId = null;
		}
	}

	// Lanza si falla para que FraccionamientoModal (ver handleGuardar) NO cierre la ventana y muestre
	// el error — antes esto se tragaba en silencio y el popup se cerraba como si hubiera guardado.
	async function handleCuotasConfirmadas(fracciones: Fraccion[]) {
		if (!cuotasCuentaActual) return;
		const result = await sincronizarCuotasProgramadas(supabase, cuotasCuentaActual.id, fracciones);
		if (!result.success) throw new Error(result.message);
		toast.success('Cuotas actualizadas');
		cuotasCuentaActual = null;
	}
	async function handleCuotasEliminadas() {
		if (!cuotasCuentaActual) return;
		const result = await sincronizarCuotasProgramadas(supabase, cuotasCuentaActual.id, []);
		if (!result.success) throw new Error(result.message);
		toast.success('Cuotas eliminadas');
		cuotasCuentaActual = null;
	}

	/** Persiste las fechas reprogramadas por drag-and-drop en la vista Calendario y actualiza los
	 * arreglos locales para que el tablero Kanban y el propio calendario queden en sincro sin recargar. */
	async function handleGuardarFechasCalendario(cambios: { id: number; fechaNueva: string }[]) {
		const result = await actualizarFechasVencimientoPago(supabase, cambios.map((c) => ({ id: c.id, fecha: c.fechaNueva })));
		if (!result.success) throw new Error(result.message);
		const mapa = new Map(cambios.map((c) => [c.id, c.fechaNueva]));
		panorama1 = panorama1.map((i) => (mapa.has(i.id) ? { ...i, fechaVencimiento: mapa.get(i.id)! } : i));
		panorama2 = panorama2.map((i) => (mapa.has(i.id) ? { ...i, fechaVencimiento: mapa.get(i.id)! } : i));
		panorama1Version++;
		panorama2Version++;
		toast.success('Fechas actualizadas');
	}
</script>

<div class="max-w-[1700px] mx-auto">
	<div class="flex items-center justify-between mb-6 flex-wrap gap-3">
		<div class="flex items-center gap-3">
			<button type="button" onclick={() => goto('/finanzas/cuentas-pagar')} class="p-2 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Volver a Cuentas por Pagar">
				<ArrowLeft size={18} />
			</button>
			<div>
				<h1 class="text-xl font-bold text-[#0f3b5e]">Panoramas de Pago</h1>
				<p class="text-sm text-slate-500">Crea y compara proyecciones de pagos arrastrando tus pagos pendientes a cada panorama.</p>
			</div>
		</div>
		<div class="flex items-center gap-2">
			<div class="flex rounded-lg border border-slate-200 overflow-hidden">
				<button
					type="button"
					onclick={() => (vistaActiva = 'tablero')}
					class={`flex items-center gap-1.5 px-3 h-9 text-sm font-medium ${vistaActiva === 'tablero' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
				>
					<LayoutGrid size={15} /> Tablero
				</button>
				<button
					type="button"
					onclick={() => {
						console.log('[Panoramas de Pago] abriendo Calendario — panorama1:', panorama1.length, 'ítem(s):', panorama1);
						console.log('[Panoramas de Pago] abriendo Calendario — panorama2:', panorama2.length, 'ítem(s):', panorama2);
						console.log('[Panoramas de Pago] abriendo Calendario — bandeja (sin asignar):', bandeja.length, 'ítem(s)');
						vistaActiva = 'calendario';
					}}
					class={`flex items-center gap-1.5 px-3 h-9 text-sm font-medium ${vistaActiva === 'calendario' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
				>
					<CalendarDays size={15} /> Calendario
				</button>
			</div>
			<button type="button" onclick={exportarCSV} class="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50">
				<Download size={16} /> Exportar
			</button>
			<button type="button" onclick={() => (pagoModalOpen = true)} class="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-medium hover:bg-[#0c2f4c]">
				<Plus size={16} /> Nuevo Pago
			</button>
		</div>
	</div>

	{#if loadError}
		<div class="mb-4 bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm">{loadError}</div>
	{/if}

	{#if vistaActiva === 'calendario'}
		{#if panorama1.length === 0 && panorama2.length === 0}
			<div class="mb-4 flex items-center justify-between gap-3 bg-blue-50 text-blue-700 px-4 py-3 rounded-lg text-sm">
				<p>{bandeja.length > 0 ? 'Panorama 1 y Panorama 2 todavía no tienen pagos asignados.' : 'No hay pagos pendientes por mostrar.'}</p>
				{#if bandeja.length > 0}
					<button type="button" onclick={sembrarPanoramasDesdeBandeja} class="shrink-0 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700">
						Cargar pendientes en ambos panoramas
					</button>
				{/if}
			</div>
		{/if}
		{#key panorama1Version + panorama2Version}
			<PanoramaCalendarView
				panoramas={PANORAMAS.map((p) => ({ id: p.id, nombre: p.nombre, subtitulo: p.subtitulo, items: panoramaItems(p.id) }))}
				tipo="egreso"
				subtituloDe={(i: PagoPendienteItem) => `Proveedor: ${i.proveedorNombre}`}
				onAbrirCuotas={abrirCuotasDe}
				{cuotasCargandoId}
				onGuardarFechas={handleGuardarFechasCalendario}
			/>
		{/key}
	{:else}
	<!-- KPIs -->
	<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0"><DollarSign size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Proyección de pago total (Panorama 1)</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(proyeccionPagos(1))}</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center shrink-0"><TrendingDown size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Proyección de pago total (Panorama 2)</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(proyeccionPagos(2))}</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center shrink-0"><CreditCard size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Pagos pendientes totales</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(resumen.totalPendiente)}</p>
		</div>
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-2">
				<div class="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0"><Wallet size={16} /></div>
				<span class="text-xs font-medium text-slate-500">Pagado del mes</span>
			</div>
			<p class="text-xl font-bold text-slate-800">{formatCurrency(pagadoDelMes)}</p>
			{#if deltaPagadoMes !== null}
				<p class={`text-xs mt-1 ${deltaPagadoMes <= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{deltaPagadoMes >= 0 ? '+' : ''}{deltaPagadoMes.toFixed(1)}% vs mes anterior</p>
			{/if}
		</div>
	</div>

	<div class="grid grid-cols-1 xl:grid-cols-[280px_1fr_1fr_300px] gap-4 items-start">
		<!-- Bandeja -->
		<div class="bg-white rounded-xl border border-slate-200 p-4">
			<div class="flex items-center gap-2 mb-1">
				<h2 class="font-bold text-slate-800 text-sm uppercase tracking-wide">Bandeja de Pagos Pendientes</h2>
				<span class="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{bandeja.length}</span>
			</div>
			<p class="text-xs text-slate-400 mb-3">Arrastra los pagos para asignarlos a un panorama.</p>

			<button type="button" onclick={() => (pagoModalOpen = true)} class="w-full mb-3 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-blue-200 text-blue-600 text-sm font-medium hover:bg-blue-50">
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
					<option value="alto">Prioridad: Alto</option>
					<option value="media">Prioridad: Media</option>
					<option value="bajo">Prioridad: Bajo</option>
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
								{#if cuotasCargandoId === item.id}
									<Loader2 size={14} class="animate-spin" />
								{:else}
									<GripVertical size={14} />
								{/if}
							</button>
							<div class="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
								<Package size={16} />
							</div>
							<div class="flex-1 min-w-0">
								<p class="text-sm font-semibold text-slate-800 truncate">{item.titulo}</p>
								<p class="text-xs text-slate-500 truncate">Proveedor: {item.proveedorNombre}</p>
								<p class="text-[11px] text-slate-400">Vencimiento: {item.fechaVencimiento ?? '—'}</p>

								{#if item.fracciones.length > 0}
									<div class="mt-1.5 flex items-center gap-1 text-[10px] text-blue-600 font-semibold">
										<Layers size={11} /> Fraccionada · {item.fracciones.length} cuota{item.fracciones.length === 1 ? '' : 's'} aquí
									</div>
									<div class="mt-1 space-y-1 border-t border-slate-100 pt-1.5">
										{#each item.fracciones as fraccion (fraccion.id)}
											<div class="flex items-center justify-between gap-1.5 text-[11px]">
												<span class="text-slate-500 truncate">Cuota {fraccion.numeroCuota}/{fraccion.totalCuotas} · {fraccion.fecha}</span>
												<div class="flex items-center gap-1 shrink-0">
													<span class="font-semibold text-slate-700">{formatCurrency(fraccion.monto)}</span>
													<button type="button" onclick={(e) => { e.stopPropagation(); moverFraccion(fraccion.id, 1); }} title="Mover solo esta cuota a Panorama 1" class="px-1 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-600 hover:bg-blue-100">P1</button>
													<button type="button" onclick={(e) => { e.stopPropagation(); moverFraccion(fraccion.id, 2); }} title="Mover solo esta cuota a Panorama 2" class="px-1 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-600 hover:bg-emerald-100">P2</button>
												</div>
											</div>
										{/each}
									</div>
									<div class="flex items-center justify-between mt-1.5 pt-1.5 border-t border-slate-100">
										<span class="text-[10px] text-slate-400">Total de estas cuotas</span>
										<span class="text-sm font-bold text-slate-800">{formatCurrency(item.monto)}</span>
									</div>
								{:else}
									<div class="flex items-center justify-between mt-1">
										<span class="text-sm font-bold text-slate-800">{formatCurrency(item.monto)}</span>
										<span class={`px-2 py-0.5 rounded-full text-[10px] font-medium ${prioridadBadgeClass[item.prioridad]}`}>{prioridadLabel[item.prioridad]}</span>
									</div>
								{/if}
							</div>
						</div>
					{:else}
						<p class="text-xs text-slate-400 text-center py-6">{loading ? 'Cargando...' : 'Sin pagos pendientes por asignar.'}</p>
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

				{#key panorama.id === 1 ? panorama1Version : panorama2Version}
					<div
						use:dndzone={{ items: panoramaItems(panorama.id), flipDurationMs: FLIP_MS }}
						onconsider={(e) => handlePanoramaConsider(panorama.id, e)}
						onfinalize={(e) => handlePanoramaFinalize(panorama.id, e)}
						class="flex flex-col gap-2 min-h-[100px] mb-4"
					>
						{#each panoramaItems(panorama.id) as item, index (item.id)}
							{@const estado = computeEstadoVencimiento(item.fechaVencimiento)}
							{@const otroPanorama = panorama.id === 1 ? 2 : 1}
							<div class={`p-3 rounded-lg border cursor-grab active:cursor-grabbing ${estado === 'vencido' ? 'bg-red-50/60 border-red-100' : 'border-slate-200 bg-white'}`}>
								<div class="flex items-center gap-2">
									<button
										type="button"
										onclick={(e) => { e.stopPropagation(); abrirCuotasDe(item); }}
										class="p-1 -m-1 rounded-md text-slate-300 hover:bg-slate-100 hover:text-slate-600 shrink-0"
										title="Ver/editar cuotas de esta cuenta"
										aria-label="Ver/editar cuotas de esta cuenta"
									>
										{#if cuotasCargandoId === item.id}
											<Loader2 size={14} class="animate-spin" />
										{:else}
											<GripVertical size={14} />
										{/if}
									</button>
									<span class={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${panoramaBadgeClass[panorama.id]}`}>{index + 1}</span>
									<button
										type="button"
										onclick={(e) => { e.stopPropagation(); copiarItemAOtroPanorama(item, panorama.id); }}
										class="p-1 -m-1 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 shrink-0"
										title={`Copiar a ${panorama.id === 1 ? 'Panorama 2' : 'Panorama 1'}`}
										aria-label={`Copiar a ${panorama.id === 1 ? 'Panorama 2' : 'Panorama 1'}`}
									>
										<MoreVertical size={14} />
									</button>
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

								{#if item.fracciones.length > 0}
									<div class="mt-1.5 flex items-center gap-1 text-[10px] text-blue-600 font-semibold">
										<Layers size={11} /> Fraccionada · {item.fracciones.length} cuota{item.fracciones.length === 1 ? '' : 's'} aquí
									</div>
									<div class="mt-1 space-y-1 border-t border-slate-100 pt-1.5">
										{#each item.fracciones as fraccion (fraccion.id)}
											<div class="flex items-center justify-between gap-1.5 text-[11px]">
												<span class="text-slate-500 truncate">Cuota {fraccion.numeroCuota}/{fraccion.totalCuotas} · {fraccion.fecha}</span>
												<div class="flex items-center gap-1 shrink-0">
													<span class="font-semibold text-slate-700">{formatCurrency(fraccion.monto)}</span>
													<button type="button" onclick={(e) => { e.stopPropagation(); moverFraccion(fraccion.id, null); }} title="Regresar solo esta cuota a la Bandeja" class="px-1 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-500 hover:bg-slate-200">Bandeja</button>
													<button type="button" onclick={(e) => { e.stopPropagation(); moverFraccion(fraccion.id, otroPanorama); }} title={`Mover solo esta cuota a Panorama ${otroPanorama}`} class="px-1 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-600 hover:bg-blue-100">P{otroPanorama}</button>
												</div>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{:else}
							<p class="text-xs text-slate-400 text-center py-6">Suelta aquí un pago de la bandeja.</p>
						{/each}
					</div>
				{/key}

				<div class="grid grid-cols-1 gap-2 text-center border-t border-slate-100 pt-3">
					<p class="text-[10px] text-slate-400 uppercase">Total proyección de pagos</p>
					<p class="text-sm font-bold text-slate-800">{formatCurrency(proyeccionPagos(panorama.id))}</p>
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
						<span class="font-bold text-slate-800">{formatCurrency(proyeccionIngresos)}</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-1.5 text-slate-500"><Wallet size={14} class="text-red-500 shrink-0" /> Pagos proyectados totales</span>
						<span class="font-bold text-slate-800">{formatCurrency(proyeccionPagos(1) + proyeccionPagos(2))}</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-1.5 text-slate-500"><Clock size={14} class="text-amber-500 shrink-0" /> Flujo proyectado combinado</span>
						<span class="font-bold text-slate-800">{formatCurrency(proyeccionIngresos - proyeccionPagos(1) - proyeccionPagos(2))}</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-1.5 text-red-600"><AlertTriangle size={14} class="text-red-500 shrink-0" /> Pagos vencidos</span>
						<span class="font-bold text-red-600">{formatCurrency(resumen.vencidoTotal)}</span>
					</div>
					<p class="text-[11px] text-slate-400 text-right -mt-1">{resumen.vencidoCount} documento{resumen.vencidoCount === 1 ? '' : 's'}</p>
					<div class="flex items-center justify-between">
						<span class="flex items-center gap-1.5 text-slate-500"><Users size={14} class="text-purple-500 shrink-0" /> Proveedores con compras</span>
						<span class="font-bold text-slate-800">{resumen.proveedoresConCompras}</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="text-slate-500">Cobertura promedio</span>
						<span class="font-bold text-slate-800">{coberturaPromedio !== null ? `${coberturaPromedio.toFixed(1)}x` : '—'}</span>
					</div>
				</div>
			</div>

			<div class="bg-white rounded-xl border border-slate-200 p-4">
				<h2 class="font-bold text-slate-800 text-sm uppercase tracking-wide mb-3">Acciones Rápidas</h2>
				<div class="space-y-2">
					<button type="button" onclick={() => (cuentaCobrarModalOpen = true)} class="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm">
						<p class="font-medium text-slate-800">Nueva proyección de ingresos</p>
						<p class="text-xs text-slate-400">Registra un ingreso que aún no ha ocurrido</p>
					</button>
					<button type="button" onclick={() => (pagoModalOpen = true)} class="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm">
						<p class="font-medium text-slate-800">Nueva proyección de pagos</p>
						<p class="text-xs text-slate-400">Registra pagos que aún no has hecho</p>
					</button>
					<button type="button" onclick={copiarPanorama1a2} class="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm">
						<p class="font-medium text-slate-800">Copiar Panorama 1 → Panorama 2</p>
						<p class="text-xs text-slate-400">Parte del mismo orden para comparar variantes</p>
					</button>
					<button type="button" onclick={() => vaciarPanorama(1)} class="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm">
						<p class="font-medium text-slate-800">Vaciar Panorama 1</p>
						<p class="text-xs text-slate-400">Regresa sus pagos a la bandeja</p>
					</button>
					<button type="button" onclick={() => vaciarPanorama(2)} class="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm">
						<p class="font-medium text-slate-800">Vaciar Panorama 2</p>
						<p class="text-xs text-slate-400">Regresa sus pagos a la bandeja</p>
					</button>
				</div>
			</div>

			<div class="bg-white rounded-xl border border-slate-200 p-4">
				<h2 class="font-bold text-slate-800 text-sm uppercase tracking-wide mb-3 flex items-center gap-1.5">
					<Lightbulb size={14} class="text-amber-500" /> ¿Cómo Funciona?
				</h2>
				<ul class="space-y-2 text-xs text-slate-500">
					<li><span class="font-medium text-slate-700">Agrega pagos pendientes</span> — crea o registra pagos que aún no ejecutas.</li>
					<li><span class="font-medium text-slate-700">Arrastra y ordena</span> — organiza tus pagos en el orden de prioridad para cada panorama.</li>
					<li><span class="font-medium text-slate-700">Compara escenarios</span> — revisa cuál panorama es el más eficiente para tu flujo de caja.</li>
				</ul>
			</div>
		</div>
	</div>

	<div class="mt-4 flex items-start gap-2 bg-blue-50 text-blue-700 px-4 py-3 rounded-lg text-xs">
		<Info size={16} class="shrink-0 mt-0.5" />
		<p>Las proyecciones te permiten simular escenarios de pago, ordenar prioridades y optimizar tu flujo de caja antes de ejecutar los pagos. El orden de cada panorama no se guarda: se reinicia al recargar la página.</p>
	</div>
	{/if}
</div>

<CuentaPagarModal
	open={pagoModalOpen}
	mode="create"
	cuenta={null}
	dynamicOptions={{ id_proveedor: proveedorOptions, id_centro_costo: centroCostoOptions }}
	onClose={() => (pagoModalOpen = false)}
	onSaved={handlePagoGuardado}
/>

<CuentaCobrarModal
	open={cuentaCobrarModalOpen}
	mode="create"
	cuenta={null}
	dynamicOptions={{ id_cliente: clienteOptions, id_proyecto: proyectoOptions, id_centro_costo: centroCostoOptions }}
	onClose={() => (cuentaCobrarModalOpen = false)}
	onSaved={handleCobroGuardado}
/>

<FraccionamientoModal
	open={cuotasModalOpen}
	titulo="Fraccionar Pagos"
	montoTotal={cuotasCuentaActual?.monto ?? 0}
	fechaEmision={cuotasCuentaActual?.fechaEmision ?? ''}
	fechaVencimiento={cuotasCuentaActual?.fechaVencimiento ?? null}
	fraccionesIniciales={cuotasFraccionesIniciales}
	onClose={() => (cuotasModalOpen = false)}
	onConfirm={handleCuotasConfirmadas}
	onEliminar={handleCuotasEliminadas}
/>
