/**
 * Servicio de agregación para el Dashboard financiero unificado — rendimiento por Centro de Costo
 * (CdC), grafo de flujo de dinero entre centros, serie mensual de flujo de caja y proyección futura
 * a partir de Cuentas por Pagar/Cobrar pendientes. 100% client-side (Supabase anon key), igual que el
 * resto de módulos de finanzas, para funcionar también en el build de Tauri (adapter-static, sin
 * +server.ts — un +page.server.ts en este proyecto solo corre en tiempo de PRERENDER/build, nunca en
 * tiempo real dentro del empaquetado de escritorio/Android, así que cualquier dato que dependiera de
 * uno quedaría congelado). No hay una capa de agregación en BD (PostgREST no da GROUP BY arbitrario),
 * así que se trae todo lo necesario en pocas queries masivas y se agrega en JS — mismo criterio que
 * recalcularCuentaCobrar/recalcularCuentaPagar.
 *
 * SUPUESTOS DE MODELO DE DATOS (documentados porque no hay una fuente única de verdad en el schema):
 * - `centro_costo.tipo` cubre: 'obra' | 'consultoria' | 'bolsa general' | 'area' | 'otro' (creados a
 *   mano) y 'proyecto' | 'cliente' | 'proveedor' | 'empleado' | 'subcontratista' (auto-creados 1:1 con
 *   una entidad, ver getOrCrearCentroCostoParaEntidad en centroCostos.service.ts). El dashboard cubre
 *   TODOS estos tipos — a pedido del usuario: "no son solo obras sino por cada centro de costo donde
 *   hayan transacciones".
 * - Se excluyen los centros de costo dados de baja (`estado = 'baja'`) y los antiguos placeholders
 *   "EXT-PROV"/"EXT-CLI" que puedan quedar de antes de la migración de vinculación real por FK.
 * - Ingresos de un CdC = transacciones tipo='ingreso' donde ese CdC es el destino (dinero que entra).
 *   Egresos de un CdC = transacciones tipo='egreso' donde ese CdC es el origen (dinero que sale).
 *   Mismo criterio que getSaldosPorCentroCosto en centroCostos.service.ts.
 * - "Presupuesto asignado" de un CdC de proyecto = suma de presupuesto_detalle.total de TODOS los
 *   presupuestos de ese proyecto (presupuesto no tiene columna de monto total propia). Para CdC que no
 *   son de proyecto (cliente/proveedor/empleado/etc.) el presupuesto queda en 0 — no aplica el
 *   concepto, la UI ya maneja ese caso como "Sin presupuesto asignado".
 * - "Gastos fijos corporativos globales" (para Margen de Contribución) = egresos de centros de costo
 *   que NO son de proyecto/cliente/proveedor — se asume que esos representan la operación/estructura
 *   fija de la empresa, no un proyecto ni una cuenta con una entidad externa específica.
 * - Categoría de gasto (para "Concentración de Salidas de Caja") no vive en `transaccion`, solo en
 *   `cuentas_pagar.categoria_gasto` (catálogo PCGE clase 6) — se resuelve vía `pagos` (que sí tiene
 *   FK real a ambas: id_transaccion y id_cuenta_pagar).
 * - `transaccion.fecha` es DATE (sin hora) — se parsea manualmente por componentes (parseFechaLocal)
 *   en vez de `new Date(str)` directo, porque este último interpreta la fecha como medianoche UTC y
 *   con offsets negativos (ej. Perú, UTC-5) el .getMonth()/.getFullYear() en hora LOCAL puede devolver
 *   el mes anterior — un corrimiento de un día que rompe el agrupado mensual.
 * - Proyección futura = saldo_pendiente de cuentas_cobrar/cuentas_pagar con estado IN
 *   ('pendiente','vencido') y activo=true, agrupado por mes de su fecha esperada de movimiento
 *   (fecha_vencimiento para cobrar; fecha_pago_programada ?? fecha_vencimiento para pagar, mismo
 *   fallback que usa computeEstadoCuentaPagar). Las cuentas ya vencidas (fecha en el pasado) se
 *   proyectan en el mes ACTUAL, no se pierden — están vencidas, no dejan de deberse.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FieldOption } from '$lib/shared/fieldConfig';

export interface ConcentracionCategoria {
	categoria: string;
	monto: number;
	pct: number;
}

export interface CentroCostoRendimiento {
	id_centro_costo: number;
	codigo: string;
	nombre: string;
	tipo: string;
	id_proyecto: number | null;
	nombre_proyecto: string | null;
	tip_proyecto: string | null; // 'O' = Obra, 'M' = Mantenimiento — solo aplica si tipo === 'proyecto'
	estado_proyecto: string | null;
	fecha_inicio_plan: string | null;
	fecha_fin_plan: string | null;

	// 1. Viabilidad
	ingresos: number;
	egresos: number;
	flujoCajaNeto: number;
	/** (Ingresos / Egresos) × 100 — null si no hay egresos (no se puede dividir). */
	autosuficiencia: number | null;

	// 2. Control presupuestario
	presupuesto: number;
	/** Egresos reales - Presupuesto asignado (positivo = sobregasto). */
	desviacion: number;
	desviacionPct: number | null;
	mesesTranscurridos: number;
	/** Egresos ÷ meses transcurridos — S/ que consume el CdC por mes. */
	burnRate: number;
	/** % del presupuesto total que se consume por mes, al ritmo actual. */
	burnRatePct: number | null;

	// 3. Eficiencia operativa
	/** Flujo de Caja Neto ÷ Presupuesto asignado × 100 — retorno del capital invertido en el CdC. */
	roc: number | null;
	concentracion: ConcentracionCategoria[];
}

export interface FiltrosFinanzas {
	/** Uno de los valores reales de centro_costo.tipo (ver TIPO_CENTRO_COSTO_OPTIONS), o undefined = todos. */
	tipo?: string;
	/** id_centro_costo puntual (el selector de "código de proyecto") */
	idCentroCosto?: number | null;
}

export const TIPO_CENTRO_COSTO_OPTIONS: FieldOption[] = [
	{ value: 'obra', label: 'Obra' },
	{ value: 'consultoria', label: 'Consultoría' },
	{ value: 'bolsa general', label: 'Corporativo' }, // Ticket #24: renombrado a pedido del cliente — el valor de BD ('bolsa general') no cambia, solo la etiqueta.
	{ value: 'area', label: 'Área' },
	{ value: 'otro', label: 'Otro' },
	{ value: 'proyecto', label: 'Proyecto' },
	{ value: 'cliente', label: 'Cliente' },
	{ value: 'proveedor', label: 'Proveedor' },
	{ value: 'empleado', label: 'Empleado' },
	{ value: 'subcontratista', label: 'Subcontratista' }
];

export const TIPO_CENTRO_COSTO_LABELS: Record<string, string> = Object.fromEntries(
	TIPO_CENTRO_COSTO_OPTIONS.map((o) => [o.value, o.label])
);

/** Catálogo PCGE clase 6 — mismo que cuentaPagar.config.ts (categoria_gasto). */
const CATEGORIA_GASTO_LABELS: Record<string, string> = {
	'60': 'Compras',
	'61': 'Variación de Inventarios',
	'62': 'Personal y Directores',
	'63': 'Servicios de Terceros',
	'64': 'Tributos',
	'65': 'Otros Gastos de Gestión',
	'66': 'Deterioro de Activos',
	'67': 'Gastos Financieros',
	'68': 'Valuación y Deterioro',
	'69': 'Costos de Producción'
};

const esCentroExterno = (codigo: string | null | undefined) => (codigo ?? '').startsWith('EXT-');

function mesesEntre(inicio: Date, fin: Date): number {
	return Math.max(1, (fin.getFullYear() - inicio.getFullYear()) * 12 + (fin.getMonth() - inicio.getMonth()) + 1);
}

/** Parsea una fecha 'YYYY-MM-DD' por componentes, en hora LOCAL — ver nota de cabecera del archivo. */
function parseFechaLocal(fechaStr: string): Date {
	const [y, m, d] = fechaStr.split('-').map(Number);
	return new Date(y, (m ?? 1) - 1, d ?? 1);
}

const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function claveAnioMes(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function etiquetaAnioMes(clave: string): string {
	const [anio, mes] = clave.split('-');
	return `${MESES_CORTOS[Number(mes) - 1]} ${anio.slice(2)}`;
}

/** Opciones para el selector "Código de Proyecto / Centro de Costo" — cualquier tipo, no solo proyecto. */
export async function getCentrosCostoOptions(client: SupabaseClient): Promise<FieldOption[]> {
	const { data, error } = await client
		.from('centro_costo')
		.select('id_centro_costo, codigo, nombre')
		.eq('estado', 'activo')
		.order('codigo');
	if (error) throw error;
	return (data ?? [])
		.filter((c: any) => !esCentroExterno(c.codigo))
		.map((c: any) => ({ value: String(c.id_centro_costo), label: `${c.codigo} — ${c.nombre}` }));
}

/**
 * Trae y agrega todo el rendimiento por Centro de Costo (de cualquier tipo), aplicando los filtros.
 * Ver notas de modelo de datos arriba del archivo para las definiciones exactas de cada métrica.
 */
export async function getRendimientoPorCentroCosto(
	client: SupabaseClient,
	filtros: FiltrosFinanzas = {}
): Promise<CentroCostoRendimiento[]> {
	// 1. Centros de costo (cualquier tipo) + filtros directos por CdC puntual y/o tipo
	let ccQuery = client
		.from('centro_costo')
		.select('id_centro_costo, codigo, nombre, tipo, id_proyecto')
		.eq('estado', 'activo');
	if (filtros.idCentroCosto) ccQuery = ccQuery.eq('id_centro_costo', filtros.idCentroCosto);
	if (filtros.tipo) ccQuery = ccQuery.eq('tipo', filtros.tipo);
	const { data: centrosRaw, error: ccError } = await ccQuery;
	if (ccError) throw ccError;
	const centrosFinal = (centrosRaw ?? []).filter((c: any) => !esCentroExterno(c.codigo));
	if (centrosFinal.length === 0) return [];

	// 2. Proyectos vinculados (join en JS por simplicidad/consistencia, aunque id_proyecto ya es FK real)
	const idsProyectoFinal = centrosFinal.map((c: any) => c.id_proyecto).filter((v: unknown): v is number => v !== null);
	const { data: proyectos } =
		idsProyectoFinal.length > 0
			? await client
					.from('proyecto')
					.select('id_proyecto, nombre_proyecto, tip_proyecto, estado_proyecto, fecha_inicio_plan, fecha_fin_plan')
					.in('id_proyecto', idsProyectoFinal)
			: { data: [] as any[] };
	const proyectoPorId = new Map((proyectos ?? []).map((p: any) => [p.id_proyecto, p]));

	const idsCentroFinal = centrosFinal.map((c: any) => c.id_centro_costo);

	// 3. Transacciones activas vinculadas a estos CdC (como origen o como destino)
	const cols = 'id_transaccion, id_centro_costo_origen, id_centro_costo_destino, tipo, monto_total, fecha, estado';
	const [{ data: transOrigen }, { data: transDestino }] = await Promise.all([
		client.from('transaccion').select(cols).in('id_centro_costo_origen', idsCentroFinal).eq('estado', 'activo'),
		client.from('transaccion').select(cols).in('id_centro_costo_destino', idsCentroFinal).eq('estado', 'activo')
	]);
	const transMap = new Map<number, any>();
	for (const t of [...(transOrigen ?? []), ...(transDestino ?? [])]) transMap.set(t.id_transaccion, t);
	const transacciones = [...transMap.values()];

	// 4. Presupuesto asignado por proyecto (presupuesto_detalle.total sumado, sin columna total propia)
	const { data: presupuestos } =
		idsProyectoFinal.length > 0
			? await client.from('presupuesto').select('id_presupuesto, id_proyecto').in('id_proyecto', idsProyectoFinal)
			: { data: [] as any[] };
	const idsPresupuesto = (presupuestos ?? []).map((p: any) => p.id_presupuesto);
	const { data: detalles } =
		idsPresupuesto.length > 0
			? await client.from('presupuesto_detalle').select('id_presupuesto, total').in('id_presupuesto', idsPresupuesto)
			: { data: [] as any[] };
	const totalPorPresupuesto = new Map<number, number>();
	for (const d of detalles ?? []) {
		totalPorPresupuesto.set(d.id_presupuesto, (totalPorPresupuesto.get(d.id_presupuesto) ?? 0) + Number(d.total ?? 0));
	}
	const presupuestoPorProyecto = new Map<number, number>();
	for (const p of presupuestos ?? []) {
		const total = totalPorPresupuesto.get(p.id_presupuesto) ?? 0;
		presupuestoPorProyecto.set(p.id_proyecto, (presupuestoPorProyecto.get(p.id_proyecto) ?? 0) + total);
	}

	// 5. Categoría de gasto por transacción de egreso, vía pagos -> cuentas_pagar (FKs reales)
	const idsTransEgreso = transacciones.filter((t) => t.tipo === 'egreso').map((t) => t.id_transaccion);
	const { data: pagosCat } =
		idsTransEgreso.length > 0
			? await client.from('pagos').select('id_transaccion, cuentas_pagar:id_cuenta_pagar(categoria_gasto)').in('id_transaccion', idsTransEgreso)
			: { data: [] as any[] };
	const categoriaPorTransaccion = new Map<number, string | null>();
	for (const p of pagosCat ?? []) {
		const catRaw = (p as any).cuentas_pagar?.categoria_gasto;
		categoriaPorTransaccion.set(p.id_transaccion, catRaw !== null && catRaw !== undefined ? String(catRaw) : null);
	}

	const hoy = new Date();

	return centrosFinal.map((c: any) => {
		const proyecto = c.id_proyecto ? proyectoPorId.get(c.id_proyecto) : null;
		const transDelCentro = transacciones.filter(
			(t) => t.id_centro_costo_origen === c.id_centro_costo || t.id_centro_costo_destino === c.id_centro_costo
		);
		const ingresos = transDelCentro
			.filter((t) => t.tipo === 'ingreso' && t.id_centro_costo_destino === c.id_centro_costo)
			.reduce((s, t) => s + Number(t.monto_total), 0);
		const egresosTx = transDelCentro.filter((t) => t.tipo === 'egreso' && t.id_centro_costo_origen === c.id_centro_costo);
		const egresos = egresosTx.reduce((s, t) => s + Number(t.monto_total), 0);
		const flujoCajaNeto = ingresos - egresos;
		const autosuficiencia = egresos > 0 ? (ingresos / egresos) * 100 : null;

		const presupuesto = c.id_proyecto ? (presupuestoPorProyecto.get(c.id_proyecto) ?? 0) : 0;
		const desviacion = egresos - presupuesto;
		const desviacionPct = presupuesto > 0 ? (desviacion / presupuesto) * 100 : null;

		const fechaInicio = proyecto?.fecha_inicio_plan ? new Date(proyecto.fecha_inicio_plan) : null;
		let mesesTranscurridos = 1;
		if (fechaInicio && !Number.isNaN(fechaInicio.getTime())) {
			const fechaFin = proyecto?.fecha_fin_plan ? new Date(proyecto.fecha_fin_plan) : hoy;
			const finReal = fechaFin < hoy ? fechaFin : hoy;
			mesesTranscurridos = mesesEntre(fechaInicio, finReal);
		}
		const burnRate = egresos / mesesTranscurridos;
		const burnRatePct = presupuesto > 0 ? (burnRate / presupuesto) * 100 : null;
		const roc = presupuesto > 0 ? (flujoCajaNeto / presupuesto) * 100 : null;

		const montoPorCategoria = new Map<string, number>();
		for (const t of egresosTx) {
			const cat = categoriaPorTransaccion.get(t.id_transaccion);
			const label = cat ? (CATEGORIA_GASTO_LABELS[cat] ?? `Categoría ${cat}`) : 'Sin categorizar';
			montoPorCategoria.set(label, (montoPorCategoria.get(label) ?? 0) + Number(t.monto_total));
		}
		const concentracion: ConcentracionCategoria[] = [...montoPorCategoria.entries()]
			.map(([categoria, monto]) => ({ categoria, monto, pct: egresos > 0 ? (monto / egresos) * 100 : 0 }))
			.sort((a, b) => b.monto - a.monto);

		return {
			id_centro_costo: c.id_centro_costo,
			codigo: c.codigo,
			nombre: c.nombre,
			tipo: c.tipo,
			id_proyecto: c.id_proyecto,
			nombre_proyecto: proyecto?.nombre_proyecto ?? null,
			tip_proyecto: proyecto?.tip_proyecto ?? null,
			estado_proyecto: proyecto?.estado_proyecto ?? null,
			fecha_inicio_plan: proyecto?.fecha_inicio_plan ?? null,
			fecha_fin_plan: proyecto?.fecha_fin_plan ?? null,
			ingresos,
			egresos,
			flujoCajaNeto,
			autosuficiencia,
			presupuesto,
			desviacion,
			desviacionPct,
			mesesTranscurridos,
			burnRate,
			burnRatePct,
			roc,
			concentracion
		};
	});
}

/**
 * Egresos activos de centros de costo "de estructura" (obra/consultoria/area/otro/bolsa general — ni
 * de proyecto, ni de cliente/proveedor) — la base contra la que se mide el Margen de Contribución
 * Financiera: cuánto de lo que aportan los CdC de proyecto alcanza para cubrir esta estructura fija
 * corporativa.
 */
export async function getGastosCorporativosGlobales(client: SupabaseClient): Promise<number> {
	const { data: centros } = await client
		.from('centro_costo')
		.select('id_centro_costo, codigo, tipo')
		.not('tipo', 'in', '(proyecto,cliente,proveedor)');
	const ids = (centros ?? []).filter((c: any) => !esCentroExterno(c.codigo)).map((c: any) => c.id_centro_costo);
	if (ids.length === 0) return 0;
	const { data: trans } = await client
		.from('transaccion')
		.select('monto_total')
		.in('id_centro_costo_origen', ids)
		.eq('tipo', 'egreso')
		.eq('estado', 'activo');
	return (trans ?? []).reduce((s: number, t: any) => s + Number(t.monto_total), 0);
}

export interface NodoFlujo {
	id: number;
	codigo: string;
	nombre: string;
	tipo: string;
	saldo: number;
}

export interface AristaFlujo {
	origen: number;
	destino: number;
	monto: number;
	cantidad: number;
}

export interface FlujoDeNodos {
	nodos: NodoFlujo[];
	aristas: AristaFlujo[];
}

/**
 * Grafo de flujo de dinero entre TODOS los centros de costo activos con movimiento — nodos con saldo
 * (ingresos - egresos, mismo criterio que getSaldosPorCentroCosto) y aristas agregadas por par
 * origen->destino (varias transacciones entre el mismo par se colapsan en una sola arista, sumando
 * monto). Solo incluye centros que realmente tuvieron al menos una transacción activa — a pedido del
 * usuario: "por cada centro de costo donde hayan transacciones".
 */
export async function getFlujoDeNodos(client: SupabaseClient): Promise<FlujoDeNodos> {
	const { data: centrosRaw, error: ccError } = await client
		.from('centro_costo')
		.select('id_centro_costo, codigo, nombre, tipo')
		.eq('estado', 'activo');
	if (ccError) throw ccError;
	const centros = (centrosRaw ?? []).filter((c: any) => !esCentroExterno(c.codigo));
	if (centros.length === 0) return { nodos: [], aristas: [] };
	const ids = centros.map((c: any) => c.id_centro_costo);
	const idsSet = new Set(ids);

	const { data: trans, error: tError } = await client
		.from('transaccion')
		.select('id_centro_costo_origen, id_centro_costo_destino, monto_total')
		.eq('estado', 'activo')
		.or(`id_centro_costo_origen.in.(${ids.join(',')}),id_centro_costo_destino.in.(${ids.join(',')})`);
	if (tError) throw tError;

	const saldos = new Map<number, number>(ids.map((id: number) => [id, 0]));
	const aristaMap = new Map<string, AristaFlujo>();
	const nodosConMovimiento = new Set<number>();

	for (const t of (trans ?? []) as any[]) {
		const monto = Number(t.monto_total) || 0;
		const origen = t.id_centro_costo_origen;
		const destino = t.id_centro_costo_destino;
		if (idsSet.has(destino)) {
			saldos.set(destino, (saldos.get(destino) ?? 0) + monto);
			nodosConMovimiento.add(destino);
		}
		if (idsSet.has(origen)) {
			saldos.set(origen, (saldos.get(origen) ?? 0) - monto);
			nodosConMovimiento.add(origen);
		}
		if (idsSet.has(origen) && idsSet.has(destino) && origen !== destino) {
			const key = `${origen}->${destino}`;
			const existente = aristaMap.get(key);
			if (existente) {
				existente.monto += monto;
				existente.cantidad += 1;
			} else {
				aristaMap.set(key, { origen, destino, monto, cantidad: 1 });
			}
		}
	}

	const nodos: NodoFlujo[] = centros
		.filter((c: any) => nodosConMovimiento.has(c.id_centro_costo))
		.map((c: any) => ({
			id: c.id_centro_costo,
			codigo: c.codigo,
			nombre: c.nombre,
			tipo: c.tipo,
			saldo: saldos.get(c.id_centro_costo) ?? 0
		}));

	return { nodos, aristas: [...aristaMap.values()] };
}

export interface ResumenGeneralDashboard {
	totalIngresos: number;
	totalEgresos: number;
	saldoNeto: number;
	centrosConMovimiento: number;
	empleadosActivos: number;
	centrosPorTipo: Record<string, number>;
}

/** KPIs generales del dashboard, 100% desde `transaccion`/`centro_costo`/`empleados` reales — reemplaza
 * los que antes venían de las tablas legacy `ventas`/`gastos`/`obras`/`consultorias`. */
export async function getResumenGeneral(client: SupabaseClient): Promise<ResumenGeneralDashboard> {
	const [{ data: trans, error: tError }, { count: empleadosActivos }, { data: centrosData, error: cError }] = await Promise.all([
		client.from('transaccion').select('id_centro_costo_origen, id_centro_costo_destino, tipo, monto_total').eq('estado', 'activo'),
		client.from('empleados').select('id', { count: 'exact', head: true }).neq('estado', 'baja'),
		client.from('centro_costo').select('id_centro_costo, codigo, tipo').eq('estado', 'activo')
	]);
	if (tError) throw tError;
	if (cError) throw cError;

	const totalIngresos = (trans ?? []).filter((t: any) => t.tipo === 'ingreso').reduce((s: number, t: any) => s + Number(t.monto_total), 0);
	const totalEgresos = (trans ?? []).filter((t: any) => t.tipo === 'egreso').reduce((s: number, t: any) => s + Number(t.monto_total), 0);

	const centrosValidos = (centrosData ?? []).filter((c: any) => !esCentroExterno(c.codigo));
	const idsValidos = new Set(centrosValidos.map((c: any) => c.id_centro_costo));
	const centrosPorTipo: Record<string, number> = {};
	for (const c of centrosValidos) centrosPorTipo[c.tipo] = (centrosPorTipo[c.tipo] ?? 0) + 1;

	const idsConMovimiento = new Set<number>();
	for (const t of (trans ?? []) as any[]) {
		if (idsValidos.has(t.id_centro_costo_origen)) idsConMovimiento.add(t.id_centro_costo_origen);
		if (idsValidos.has(t.id_centro_costo_destino)) idsConMovimiento.add(t.id_centro_costo_destino);
	}

	return {
		totalIngresos,
		totalEgresos,
		saldoNeto: totalIngresos - totalEgresos,
		centrosConMovimiento: idsConMovimiento.size,
		empleadosActivos: empleadosActivos ?? 0,
		centrosPorTipo
	};
}

export interface SerieMensualFlujoCaja {
	labels: string[];
	ingresos: number[];
	egresos: number[];
}

/** Serie histórica de ingresos/egresos activos, agrupada por mes calendario, últimos `meses` meses
 * (incluyendo el actual). Reemplaza el ventasPorMes/gastosPorMes legacy del antiguo tab General. */
export async function getSerieMensualFlujoCaja(client: SupabaseClient, meses = 12): Promise<SerieMensualFlujoCaja> {
	const hoy = new Date();
	const inicio = new Date(hoy.getFullYear(), hoy.getMonth() - (meses - 1), 1);
	const inicioIso = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}-01`;

	const { data, error } = await client
		.from('transaccion')
		.select('fecha, tipo, monto_total')
		.eq('estado', 'activo')
		.in('tipo', ['ingreso', 'egreso'])
		.gte('fecha', inicioIso);
	if (error) throw error;

	const claves: string[] = [];
	for (let i = 0; i < meses; i++) claves.push(claveAnioMes(new Date(hoy.getFullYear(), hoy.getMonth() - (meses - 1) + i, 1)));
	const clavesSet = new Set(claves);
	const ingresosPorMes = new Map(claves.map((c) => [c, 0]));
	const egresosPorMes = new Map(claves.map((c) => [c, 0]));

	for (const t of (data ?? []) as any[]) {
		if (!t.fecha) continue;
		const clave = claveAnioMes(parseFechaLocal(t.fecha));
		if (!clavesSet.has(clave)) continue;
		const monto = Number(t.monto_total) || 0;
		if (t.tipo === 'ingreso') ingresosPorMes.set(clave, (ingresosPorMes.get(clave) ?? 0) + monto);
		if (t.tipo === 'egreso') egresosPorMes.set(clave, (egresosPorMes.get(clave) ?? 0) + monto);
	}

	return {
		labels: claves.map(etiquetaAnioMes),
		ingresos: claves.map((c) => ingresosPorMes.get(c) ?? 0),
		egresos: claves.map((c) => egresosPorMes.get(c) ?? 0)
	};
}

export interface ProyeccionFutura {
	labels: string[];
	ingresosProyectados: number[];
	egresosProyectados: number[];
}

/** Proyección de flujo de caja futuro, a partir de Cuentas por Cobrar/Pagar pendientes o vencidas
 * (activo=true, estado IN pendiente/vencido), agrupada por mes de su fecha esperada. Las ya vencidas
 * se proyectan en el mes ACTUAL (siguen debiéndose, no desaparecen del panorama). */
export async function getProyeccionFutura(client: SupabaseClient, meses = 6): Promise<ProyeccionFutura> {
	const hoy = new Date();
	const inicioActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

	const [{ data: cobrar, error: cobrarError }, { data: pagar, error: pagarError }] = await Promise.all([
		client.from('cuentas_cobrar').select('saldo_pendiente, fecha_vencimiento').eq('activo', true).in('estado', ['pendiente', 'vencido']),
		client.from('cuentas_pagar').select('saldo_pendiente, fecha_vencimiento, fecha_pago_programada').eq('activo', true).in('estado', ['pendiente', 'vencido'])
	]);
	if (cobrarError) throw cobrarError;
	if (pagarError) throw pagarError;

	const claves: string[] = [];
	for (let i = 0; i < meses; i++) claves.push(claveAnioMes(new Date(hoy.getFullYear(), hoy.getMonth() + i, 1)));
	const clavesSet = new Set(claves);
	const ingresosPorMes = new Map(claves.map((c) => [c, 0]));
	const egresosPorMes = new Map(claves.map((c) => [c, 0]));

	const clavePeriodo = (fechaStr: string) => {
		const fecha = parseFechaLocal(fechaStr);
		return claveAnioMes(fecha < inicioActual ? inicioActual : fecha);
	};

	for (const c of (cobrar ?? []) as any[]) {
		if (!c.fecha_vencimiento) continue;
		const clave = clavePeriodo(c.fecha_vencimiento);
		if (clavesSet.has(clave)) ingresosPorMes.set(clave, (ingresosPorMes.get(clave) ?? 0) + Number(c.saldo_pendiente || 0));
	}
	for (const p of (pagar ?? []) as any[]) {
		const fecha = p.fecha_pago_programada ?? p.fecha_vencimiento;
		if (!fecha) continue;
		const clave = clavePeriodo(fecha);
		if (clavesSet.has(clave)) egresosPorMes.set(clave, (egresosPorMes.get(clave) ?? 0) + Number(p.saldo_pendiente || 0));
	}

	return {
		labels: claves.map(etiquetaAnioMes),
		ingresosProyectados: claves.map((c) => ingresosPorMes.get(c) ?? 0),
		egresosProyectados: claves.map((c) => egresosPorMes.get(c) ?? 0)
	};
}
