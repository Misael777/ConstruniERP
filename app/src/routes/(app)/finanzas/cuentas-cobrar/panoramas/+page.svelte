<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { dndzone } from 'svelte-dnd-action';
	import { supabase } from '$lib/supabaseClient';
	import { toast } from '$lib/stores/toast';
	import { formatCurrency, type FieldOption } from '$lib/shared/fieldConfig';
	import { ArrowLeft, Receipt, GripVertical, MoreVertical, Loader2, Download, Plus, Info, Lightbulb, DollarSign, TrendingUp, CreditCard, Wallet, Target, Clock, AlertTriangle, Users, LayoutGrid, CalendarDays, Layers, Search, X, ChevronDown, ChevronUp } from '@lucide/svelte';
	import {
		getCobrosPendientes,
		getPanoramaItemsCobro,
		getProyeccionPagos,
		getCobradoEnRango,
		getResumenCobros,
		getProyectoOptions,
		actualizarFechasVencimientoCobro,
		getTodasLasCuentasPorCobrarPendientes,
		reorderPanoramaCobro,
		moverFraccionAPanoramaCobro,
		type IngresoPendienteItem,
		type PanoramaEntry,
		type PrioridadCobro,
		type ResumenCobros,
		type BandejaSortBy
	} from '$lib/modules/panoramas/services/panoramas.service';
	import { getClienteOptions, getCobros, sincronizarCuotasProgramadas } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';
	import { getCentroCostoOptions } from '$lib/modules/transacciones/services/transacciones.service';
	import { getMovimientosCaja } from '$lib/modules/transacciones/services/movimientosCaja.service';
	import CuentaCobrarModal from '$lib/modules/cuentas-cobrar/components/CuentaCobrarModal.svelte';
	import FraccionamientoModal, { type Fraccion } from '$lib/shared/components/FraccionamientoModal.svelte';
	import PanoramaCalendarView from '$lib/modules/panoramas/components/PanoramaCalendarView.svelte';

	// Tablero de planeación de flujo de cobro: contraparte de /finanzas/cuentas-pagar/panoramas,
	// mismo patrón (bandeja + 2 panoramas fijos) y AHORA TAMBIÉN persiste en la BD
	// (panorama_id/panorama_orden — ver panoramas.service.ts, panorama_persistencia_migration.sql),
	// antes era 100% de la sesión. Reutiliza cuentas_cobrar (con su columna real `prioridad`) en vez
	// de crear una tabla de "proyecciones" nueva.
	//
	// FRACCIONAMIENTO: una cuenta con 2+ cuotas 'programado' se dibuja como CLUSTER — ver la nota
	// equivalente en cuentas-pagar/panoramas/+page.svelte, mismo criterio sobre "cobros".
	//
	// Drag-and-drop con svelte-dnd-action (funciona con mouse Y touch), igual que en cuentas_pagar.

	const PANORAMAS = [
		{ id: 1 as const, nombre: 'Panorama 1', subtitulo: 'Escenario base' },
		{ id: 2 as const, nombre: 'Panorama 2', subtitulo: 'Escenario optimista' }
	];

	// A pedido del usuario: un poco más de intensidad que antes (bg-*-100/text-*-700 y bg-*-50/60 con
	// borde -100 quedaban muy desteñidos) — mismo criterio de color por panorama (1 = azul/rojo,
	// 2 = verde), solo un escalón más saturado.
	const panoramaBadgeClass: Record<1 | 2, string> = {
		1: 'bg-blue-200 text-blue-800',
		2: 'bg-emerald-200 text-emerald-800'
	};
	const panoramaCardClass: Record<1 | 2, string> = {
		1: 'bg-red-50 border-red-200',
		2: 'bg-green-50 border-green-200'
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
	/** Panorama 0 ("Panorama Actual") — TODAS las cuentas de la cartera, sin filtrar por
	 * panorama_id, espejo del estado real de fecha_vencimiento (ver PanoramaCalendarView). */
	let panorama0Items = $state<IngresoPendienteItem[]>([]);

	let proyectoOptions = $state<FieldOption[]>([]);
	let clienteOptions = $state<FieldOption[]>([]);
	let centroCostoOptions = $state<FieldOption[]>([]);

	let filtroObra = $state('');
	let filtroCliente = $state('');
	let filtroPrioridad = $state<'' | PrioridadCobro>('');
	let filtroEstado = $state<'' | 'pendiente' | 'vencido'>('');
	let bandejaSearch = $state('');
	let bandejaSearchInput = $state('');
	let bandejaSortBy = $state<BandejaSortBy>('fechaVencimiento');
	let bandejaSortDir = $state<'asc' | 'desc'>('asc');
	let bandejaPage = $state(1);
	let bandejaTotal = $state(0);
	let bandejaTotalPages = $state(1);
	const BANDEJA_PAGE_SIZE = 5;
	let bandejaSearchDebounce: ReturnType<typeof setTimeout>;
	let filtrosExpanded = $state(false);
	const filtrosActivos = $derived([filtroObra, filtroCliente, filtroPrioridad, filtroEstado].filter(Boolean).length);

	let proyeccionPagos = $state(0);
	let saldoActual = $state(0);
	let cobradoDelMes = $state(0);
	let cobradoMesAnterior = $state(0);
	let resumen = $state<ResumenCobros>({ totalPendiente: 0, vencidoTotal: 0, vencidoCount: 0, clientesConVentas: 0 });

	let cuentaModalOpen = $state(false);
	let vistaActiva = $state<'tablero' | 'calendario'>('tablero');

	// Popup de cuotas: se abre haciendo clic en el icono de arrastrar (⋮⋮) de cualquier tarjeta —
	// de la Bandeja o de un Panorama — para ver/editar el calendario de cuotas 'programado' de esa
	// cuenta puntual, sin salir de este tablero. Reutiliza el mismo componente que usa Editar Cuenta
	// por Cobrar (ver CuentaCobrarModal.svelte), pero acá se guarda directo con
	// sincronizarCuotasProgramadas (no hay un formulario completo de cuenta alrededor).
	let cuotasModalOpen = $state(false);
	/** id_cuenta_cobrar del ítem cuyo botón de cuotas está cargando (o null) — muestra un spinner justo
	 * en ese botón para que el clic se sienta inmediato aunque la consulta tarde un poco. */
	let cuotasCargandoId = $state<number | null>(null);
	let cuotasCuentaActual = $state<{ id: number; monto: number; fechaEmision: string; fechaVencimiento: string | null } | null>(null);
	let cuotasFraccionesIniciales = $state<Fraccion[]>([]);

	// item.montoTotal/fechaEmision ya vienen del select('*') que ya se hizo al cargar la bandeja/panorama
	// (ver panoramas.service.ts) — evita una consulta extra a cuentas_cobrar, solo falta traer las
	// cuotas 'programado' reales.
	async function abrirCuotasDe(item: IngresoPendienteItem) {
		cuotasCargandoId = item.id;
		try {
			const cobros = await getCobros(supabase, item.id_cuenta_cobrar);
			cuotasFraccionesIniciales = cobros
				.filter((c) => c.estado_cobro === 'programado')
				.map((c) => ({ fecha: c.fecha_cobro, monto: Number(c.monto) }))
				.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
			// FraccionamientoModal solo debe repartir lo que TODAVÍA falta cobrar (saldoPendiente), no el
			// monto total de la cuenta (item.montoTotal) — mismo fix que en cuentas-pagar/panoramas.
			cuotasCuentaActual = { id: item.id_cuenta_cobrar, monto: item.saldoPendiente, fechaEmision: item.fechaEmision, fechaVencimiento: item.fechaVencimiento };
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

	// svelte-dnd-action a veces no refleja bien un reemplazo de `items` que viene de FUERA de un
	// arrastre real (ej. un botón que vacía/copia un panorama de un tirón) — su estado interno de
	// "shadow items" puede quedar desincronizado. Envolver cada zona en {#key ...} con estos
	// contadores fuerza a Svelte a destruir y recrear esa zona entera cuando la tocamos por fuera
	// del drag-and-drop, así siempre arranca limpia con el arreglo nuevo.
	let bandejaVersion = $state(0);
	let panorama1Version = $state(0);
	let panorama2Version = $state(0);
	let panorama0Version = $state(0);

	function panoramaItems(id: 1 | 2) {
		return id === 1 ? panorama1 : panorama2;
	}
	function setPanoramaItems(id: 1 | 2, items: IngresoPendienteItem[]) {
		if (id === 1) panorama1 = items;
		else panorama2 = items;
	}

	/** Trae la bandeja desde la BD — ya viene filtrada/buscada/ordenada/paginada server-side (ver
	 * nota equivalente en cuentas-pagar/panoramas/+page.svelte). Paginada a propósito, para no tener
	 * una bandeja infinita con toda la cartera de cuentas por cobrar pendientes. */
	async function fetchBandeja() {
		loading = true;
		try {
			const result = await getCobrosPendientes(supabase, {
				idProyecto: filtroObra ? Number(filtroObra) : null,
				idCliente: filtroCliente ? Number(filtroCliente) : null,
				prioridad: filtroPrioridad || null,
				estado: filtroEstado || null,
				search: bandejaSearch,
				sortBy: bandejaSortBy,
				sortDir: bandejaSortDir,
				page: bandejaPage,
				pageSize: BANDEJA_PAGE_SIZE
			});
			bandeja = result.items;
			bandejaTotal = result.total;
			bandejaTotalPages = result.totalPages;
			bandejaVersion++;
			loadError = '';
		} catch (err: any) {
			loadError = err.message || 'No se pudo cargar el tablero de panoramas';
		} finally {
			loading = false;
		}
	}

	function onBandejaSearchInput(value: string) {
		bandejaSearchInput = value;
		clearTimeout(bandejaSearchDebounce);
		bandejaSearchDebounce = setTimeout(() => {
			bandejaSearch = value;
			bandejaPage = 1;
			fetchBandeja();
		}, 400);
	}
	function onBandejaSortChange(value: BandejaSortBy) {
		bandejaSortBy = value;
		fetchBandeja();
	}
	function toggleBandejaSortDir() {
		bandejaSortDir = bandejaSortDir === 'asc' ? 'desc' : 'asc';
		fetchBandeja();
	}
	function goToBandejaPage(p: number) {
		if (p < 1 || p > bandejaTotalPages) return;
		bandejaPage = p;
		fetchBandeja();
	}

	/** Trae Panorama 1, 2 y "Panorama Actual" (todas las cuentas, sin filtrar) desde la BD. */
	async function fetchPanoramas() {
		try {
			const [p1, p2, p0] = await Promise.all([getPanoramaItemsCobro(supabase, 1), getPanoramaItemsCobro(supabase, 2), getTodasLasCuentasPorCobrarPendientes(supabase)]);
			panorama1 = p1;
			panorama2 = p2;
			panorama0Items = p0;
			panorama1Version++;
			panorama2Version++;
			panorama0Version++;
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar los panoramas');
		}
	}

	/** Ver nota equivalente en cuentas-pagar/panoramas/+page.svelte (aEntradas). */
	function aEntradas(items: IngresoPendienteItem[]): PanoramaEntry[] {
		return items.map((item) =>
			item.fracciones.length > 0 ? { tipo: 'cluster' as const, idsFraccion: item.fracciones.map((f) => f.id) } : { tipo: 'cuenta' as const, id: item.id_cuenta_cobrar }
		);
	}

	/** Ver nota equivalente en cuentas-pagar/panoramas/+page.svelte (moverFraccion). */
	async function moverFraccion(idCobro: number, destino: 1 | 2 | null) {
		const result = await moverFraccionAPanoramaCobro(supabase, idCobro, destino);
		if (!result.success) {
			toast.error(result.message);
			return;
		}
		await Promise.all([fetchBandeja(), fetchPanoramas()]);
		toast.success(result.message);
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
		await Promise.all([fetchBandeja(), fetchPanoramas(), fetchResumenYCaja()]);
	});

	function refetchOnFilterChange() {
		bandejaPage = 1;
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

	const FLIP_MS = 150;

	function handleBandejaConsider(e: CustomEvent<{ items: IngresoPendienteItem[] }>) {
		bandeja = e.detail.items;
	}
	// Tras SOLTAR (no durante el arrastre, ver handleBandejaConsider) hay que recargar de la BD en
	// vez de confiar en e.detail.items — ver nota equivalente en cuentas-pagar/panoramas/+page.svelte:
	// si la cuenta arrastrada ya tenía otra tarjeta en esta columna (sus demás cuotas), ambas
	// quedarían con el mismo `id` en el mismo arreglo y una "desaparecía" visualmente.
	async function handleBandejaFinalize(e: CustomEvent<{ items: IngresoPendienteItem[] }>) {
		bandeja = e.detail.items; // feedback visual inmediato mientras se persiste
		const result = await reorderPanoramaCobro(supabase, null, aEntradas(e.detail.items));
		if (!result.success) toast.error(result.message);
		await Promise.all([fetchBandeja(), fetchPanoramas()]);
	}
	function handlePanoramaConsider(id: 1 | 2, e: CustomEvent<{ items: IngresoPendienteItem[] }>) {
		setPanoramaItems(id, e.detail.items);
	}
	async function handlePanoramaFinalize(id: 1 | 2, e: CustomEvent<{ items: IngresoPendienteItem[] }>) {
		setPanoramaItems(id, e.detail.items); // feedback visual inmediato mientras se persiste
		const result = await reorderPanoramaCobro(supabase, id, aEntradas(e.detail.items));
		if (!result.success) toast.error(result.message);
		await Promise.all([fetchBandeja(), fetchPanoramas()]);
	}

	// --- Acciones rápidas ---
	/** "Vaciar" es un movimiento real (destino = bandeja) -> se persiste igual que un arrastre. Ver
	 * nota equivalente en cuentas-pagar/panoramas/+page.svelte (persiste solo `items` y recarga
	 * después, para evitar tarjetas duplicadas). */
	async function vaciarPanorama(id: 1 | 2) {
		const items = panoramaItems(id);
		if (items.length === 0) return;
		bandeja = [...bandeja, ...items]; // feedback visual inmediato mientras se persiste
		setPanoramaItems(id, []);
		bandejaVersion++;
		if (id === 1) panorama1Version++;
		else panorama2Version++;
		const result = await reorderPanoramaCobro(supabase, null, aEntradas(items));
		if (!result.success) {
			toast.error(result.message);
			return;
		}
		await Promise.all([fetchBandeja(), fetchPanoramas()]);
		toast.success(`${PANORAMAS[id - 1].nombre} vaciado`);
	}
	/** "Copiar" es a propósito solo visual/de la sesión, NO se persiste — ver nota equivalente en
	 * cuentas-pagar/panoramas/+page.svelte (copiarPanorama1a2). */
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
	 * Tablero, Panorama 1 y 2 se ven vacíos ahí — este botón carga TODOS los ingresos pendientes en
	 * ambos panoramas de una vez (Panorama 2 arranca como copia de Panorama 1, mismo criterio que
	 * copiarPanorama1a2) para poder empezar a comparar escenarios arrastrando fechas de inmediato.
	 * Igual que copiarPanorama1a2: solo visual/de la sesión, no se persiste.
	 * OJO: no usa el arreglo local `bandeja` (esa es solo la página actual, ver paginación) — trae
	 * TODOS los pendientes con una consulta aparte de pageSize grande, ver nota equivalente en
	 * cuentas-pagar/panoramas/+page.svelte. */
	async function sembrarPanoramasDesdeBandeja() {
		if (bandejaTotal === 0) return;
		try {
			const todos = await getCobrosPendientes(supabase, { pageSize: Math.max(bandejaTotal, 1000) });
			panorama1 = todos.items.map((i) => ({ ...i }));
			panorama2 = todos.items.map((i) => ({ ...i }));
			panorama1Version++;
			panorama2Version++;
			await fetchBandeja();
			toast.success('Ingresos pendientes cargados en Panorama 1 y Panorama 2 (solo en esta sesión — no se guarda)');
		} catch (err: any) {
			toast.error(err?.message ?? 'No se pudieron cargar los ingresos pendientes');
		}
	}

	/** Botón de puntos (⋮) junto al número de cada cuota: copia (no mueve, se queda también en el
	 * actual) esa cuenta puntual al otro panorama — como solo hay 2, "el siguiente" siempre es el otro.
	 * Solo visual/de la sesión, no se persiste (mismo motivo que copiarPanorama1a2). */
	function copiarItemAOtroPanorama(item: IngresoPendienteItem, panoramaActual: 1 | 2) {
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

	/** Persiste fecha_vencimiento reprogramada por drag-and-drop en la vista Calendario y actualiza
	 * los 4 arreglos locales (bandeja/panorama1/panorama2/panorama0Items) para que el tablero Kanban
	 * y el propio calendario — incluido Panorama Actual, venga el cambio de él mismo o de un
	 * "Establecer como panorama actual" en P1/P2 — queden en sincro sin recargar. */
	async function handleGuardarFechasCalendario(panoramaId: 0 | 1 | 2, cambios: { id: number; fechaNueva: string }[]) {
		const result = await actualizarFechasVencimientoCobro(supabase, cambios.map((c) => ({ id: c.id, fecha: c.fechaNueva })));
		if (!result.success) throw new Error(result.message);
		const mapa = new Map(cambios.map((c) => [c.id, c.fechaNueva]));
		const parchear = (items: IngresoPendienteItem[]) => items.map((i) => (mapa.has(i.id) ? { ...i, fechaVencimiento: mapa.get(i.id)! } : i));
		bandeja = parchear(bandeja);
		panorama1 = parchear(panorama1);
		panorama2 = parchear(panorama2);
		panorama0Items = parchear(panorama0Items);
		bandejaVersion++;
		panorama1Version++;
		panorama2Version++;
		panorama0Version++;
		toast.success(panoramaId === 0 ? 'Fechas actualizadas' : 'Panorama establecido como actual');
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
						console.log('[Panoramas de Cobro] abriendo Calendario — panorama1:', panorama1.length, 'ítem(s):', panorama1);
						console.log('[Panoramas de Cobro] abriendo Calendario — panorama2:', panorama2.length, 'ítem(s):', panorama2);
						console.log('[Panoramas de Cobro] abriendo Calendario — bandeja (sin asignar):', bandeja.length, 'ítem(s)');
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
			<button type="button" onclick={() => (cuentaModalOpen = true)} class="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0f3b5e] text-white text-sm font-medium hover:bg-[#0c2f4c]">
				<Plus size={16} /> Nueva Cuenta por Cobrar
			</button>
		</div>
	</div>

	{#if loadError}
		<div class="mb-4 bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm">{loadError}</div>
	{/if}

	{#if vistaActiva === 'calendario'}
		{#if panorama1.length === 0 && panorama2.length === 0}
			<div class="mb-4 flex items-center justify-between gap-3 bg-blue-50 text-blue-700 px-4 py-3 rounded-lg text-sm">
				<p>{bandeja.length > 0 ? 'Panorama 1 y Panorama 2 todavía no tienen ingresos asignados.' : 'No hay ingresos pendientes por mostrar.'}</p>
				{#if bandeja.length > 0}
					<button type="button" onclick={sembrarPanoramasDesdeBandeja} class="shrink-0 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700">
						Cargar pendientes en ambos panoramas
					</button>
				{/if}
			</div>
		{/if}
		{#key panorama0Version + panorama1Version + panorama2Version}
			<PanoramaCalendarView
				panoramas={[
					{ id: 0, nombre: 'Panorama Actual', subtitulo: 'Estado real de la cartera', modo: 'actual', items: panorama0Items },
					...PANORAMAS.map((p) => ({ id: p.id, nombre: p.nombre, subtitulo: p.subtitulo, modo: 'escenario' as const, items: panoramaItems(p.id) }))
				]}
				tipo="ingreso"
				subtituloDe={(i: IngresoPendienteItem) => `Cliente: ${i.clienteNombre}`}
				detalleDe={(i: IngresoPendienteItem) => (i.proyectoNombre ? `Proyecto: ${i.proyectoNombre}` : null)}
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
				<span class="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{bandejaTotal}</span>
			</div>
			<p class="text-xs text-slate-400 mb-3">Arrastra los ingresos pendientes para asignarlos a un panorama.</p>

			<div class="relative mb-2">
				<Search size={14} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
				<input
					type="text"
					value={bandejaSearchInput}
					oninput={(e) => onBandejaSearchInput((e.target as HTMLInputElement).value)}
					placeholder="Buscar cliente, proyecto o título..."
					class="w-full pl-8 pr-7 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
				/>
				{#if bandejaSearchInput}
					<button type="button" onclick={() => onBandejaSearchInput('')} class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Limpiar búsqueda">
						<X size={13} />
					</button>
				{/if}
			</div>

			<button
				type="button"
				onclick={() => (filtrosExpanded = !filtrosExpanded)}
				class="w-full flex items-center gap-1.5 px-2.5 py-1.5 mb-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
			>
				{#if filtrosExpanded}<ChevronUp size={13} />{:else}<ChevronDown size={13} />{/if}
				Filtros
				{#if filtrosActivos > 0}
					<span class="text-[10px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">{filtrosActivos}</span>
				{/if}
			</button>

			{#if filtrosExpanded}
				<div class="flex flex-col gap-2 mb-2">
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
			{/if}

			<div class="flex items-center gap-1 mb-3">
				<select value={bandejaSortBy} onchange={(e) => onBandejaSortChange((e.target as HTMLSelectElement).value as BandejaSortBy)} class="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm">
					<option value="fechaVencimiento">Ordenar: Vencimiento</option>
					<option value="monto">Ordenar: Monto</option>
					<option value="nombre">Ordenar: Cliente</option>
					<option value="prioridad">Ordenar: Prioridad</option>
				</select>
				<button type="button" onclick={toggleBandejaSortDir} class="p-2 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50 shrink-0" title={bandejaSortDir === 'asc' ? 'Ascendente' : 'Descendente'} aria-label="Cambiar dirección de orden">
					{bandejaSortDir === 'asc' ? '↑' : '↓'}
				</button>
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
								<Receipt size={16} />
							</div>
							<div class="flex-1 min-w-0">
								<p class="text-sm font-semibold text-slate-800 truncate">{item.titulo}</p>
								<p class="text-xs text-slate-500 truncate">Proyecto: {item.proyectoNombre ?? 'Sin proyecto'}</p>
								<p class="text-xs text-slate-500 truncate">Cliente: {item.clienteNombre}</p>
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
						<p class="text-xs text-slate-400 text-center py-6">{loading ? 'Cargando...' : 'Sin ingresos pendientes por asignar.'}</p>
					{/each}
				</div>
			{/key}

			{#if bandejaTotalPages > 1}
				<div class="flex items-center justify-between mt-3 text-xs text-slate-500">
					<span>{bandejaTotal} resultado{bandejaTotal === 1 ? '' : 's'} · Página {bandejaPage} de {bandejaTotalPages}</span>
					<div class="flex items-center gap-1">
						<button type="button" onclick={() => goToBandejaPage(bandejaPage - 1)} disabled={bandejaPage <= 1} class="px-2 py-1 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50">Anterior</button>
						<button type="button" onclick={() => goToBandejaPage(bandejaPage + 1)} disabled={bandejaPage >= bandejaTotalPages} class="px-2 py-1 rounded-lg border border-slate-300 disabled:opacity-40 hover:bg-slate-50">Siguiente</button>
					</div>
				</div>
			{/if}
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

				<!-- A pedido del usuario (mismo arreglo en cuentas-pagar/panoramas): Panorama 1 y 2 deben
				     verse siempre del mismo tamaño — se acota la única sección de altura variable de la
				     tarjeta a una altura relativa a la ventana (vh) en vez de crecer sin límite, con
				     scroll interno si hay más ítems de los que entran. Mismo tope en ambos = misma altura
				     total siempre. -->
				{#key panorama.id === 1 ? panorama1Version : panorama2Version}
					<div
						use:dndzone={{ items: panoramaItems(panorama.id), flipDurationMs: FLIP_MS }}
						onconsider={(e) => handlePanoramaConsider(panorama.id, e)}
						onfinalize={(e) => handlePanoramaFinalize(panorama.id, e)}
						class="flex flex-col gap-2 min-h-[100px] max-h-[42vh] overflow-y-auto pr-1 mb-4"
					>
						{#each panoramaItems(panorama.id) as item, index (item.id)}
							{@const venc = estadoVencimiento(item.fechaVencimiento)}
							{@const otroPanorama = panorama.id === 1 ? 2 : 1}
							<div class={`p-3 rounded-lg border cursor-grab active:cursor-grabbing ${venc === 'vencido' ? 'bg-red-50/60 border-red-100' : 'border-slate-200 bg-white'}`}>
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
										<p class="text-xs text-slate-500 truncate">Proyecto: {item.proyectoNombre ?? 'Sin proyecto'}</p>
										<p class="text-xs text-slate-500 truncate">Cliente: {item.clienteNombre}</p>
									</div>
									<div class="text-right shrink-0">
										<p class="text-sm font-bold text-slate-800">{formatCurrency(item.monto)}</p>
										<span class={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${estadoVencBadgeClass[venc]}`}>{estadoVencLabel[venc]}</span>
										<p class="text-[11px] text-slate-400 mt-0.5">{item.fechaVencimiento ?? '—'}</p>
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
							<p class="text-xs text-slate-400 text-center py-6">Suelta aquí un ingreso de la bandeja.</p>
						{/each}
					</div>
				{/key}

				<!-- A pedido del usuario (mismo arreglo aplicado en cuentas-pagar/panoramas): en columnas
				     angostas este grid de 3 estadísticas se traslapaba porque el contenedor de cada
				     columna no tenía min-w-0 (el texto sin cortar forzaba la columna más ancha que su
				     espacio real, empujando/superponiendo a las vecinas). Se mantiene el mismo formato de
				     3 columnas, solo con letra más chica, min-w-0 para que el truncate/wrap funcione de
				     verdad, y el monto en una sola línea con "..." + title (tooltip) si no entra completo. -->
				<div class="grid grid-cols-3 gap-1.5 text-center border-t border-slate-100 pt-3">
					<div class="min-w-0">
						<p class="text-[9px] leading-snug text-slate-400 uppercase break-words">Total proyección</p>
						<p class="text-xs font-bold text-slate-800 truncate" title={formatCurrency(totalProyeccion(panorama.id))}>{formatCurrency(totalProyeccion(panorama.id))}</p>
					</div>
					<div class="min-w-0">
						<p class="text-[9px] leading-snug text-slate-400 uppercase break-words">Cobrado estimado</p>
						<p class="text-xs font-bold text-emerald-600 truncate" title={formatCurrency(cobradoEstimado(panorama.id))}>{formatCurrency(cobradoEstimado(panorama.id))}</p>
					</div>
					<div class="min-w-0">
						<p class="text-[9px] leading-snug text-slate-400 uppercase break-words">Por cobrar</p>
						<p class="text-xs font-bold text-amber-600 truncate" title={formatCurrency(porCobrar(panorama.id))}>{formatCurrency(porCobrar(panorama.id))}</p>
					</div>
				</div>
				<div class="grid grid-cols-3 gap-1.5 text-center border-t border-slate-100 mt-3 pt-3">
					<div class="min-w-0">
						<p class="text-[9px] leading-snug text-slate-400 uppercase break-words">Caja proyectada</p>
						<p class="text-xs font-bold text-slate-800 truncate" title={formatCurrency(disponibleEnCaja(panorama.id))}>{formatCurrency(disponibleEnCaja(panorama.id))}</p>
					</div>
					<div class="min-w-0">
						<p class="text-[9px] leading-snug text-slate-400 uppercase break-words">Estado de flujo</p>
						<span class={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${estadoFlujoBadge[estadoFlujo(panorama.id)]}`}>{estadoFlujoLabel[estadoFlujo(panorama.id)]}</span>
					</div>
					<div class="min-w-0">
						<p class="text-[9px] leading-snug text-slate-400 uppercase break-words">Cobertura</p>
						<p class="text-xs font-bold text-slate-800 truncate">{cobertura(panorama.id) !== null ? `${cobertura(panorama.id)!.toFixed(1)}x` : '—'}</p>
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
		<p>Las proyecciones te permiten simular escenarios de cobro, ordenar prioridades y optimizar tu flujo de caja antes de que se ejecuten los ingresos. Arrastrar entre Bandeja/Panorama 1/Panorama 2 se guarda — sobrevive a recargar la página. Los botones "Copiar" y "Cargar pendientes en ambos" son la excepción: son solo para comparar escenarios y no se guardan.</p>
	</div>
	{/if}
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
