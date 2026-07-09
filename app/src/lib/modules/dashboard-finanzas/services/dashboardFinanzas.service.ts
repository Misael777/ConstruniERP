/**
 * Servicio de agregación para el tab "Finanzas" del Dashboard — rendimiento por Centro de Costo (CdC).
 * 100% client-side (Supabase anon key), igual que el resto de módulos de finanzas, para funcionar
 * también en el build de Tauri (adapter-static, sin +server.ts). No hay una capa de agregación en BD
 * (PostgREST no da GROUP BY arbitrario), así que se trae todo lo necesario en pocas queries masivas y
 * se agrega en JS — mismo criterio que recalcularCuentaCobrar/recalcularCuentaPagar.
 *
 * SUPUESTOS DE MODELO DE DATOS (documentados porque no hay una fuente única de verdad en el schema):
 * - "Centro de Costo de un proyecto" = fila de `centro_costo` con tipo='proyecto' e `id_proyecto`
 *   apuntando a `proyecto.id_proyecto` (FK real, ver centro_costo_vinculacion_migration.sql — antes
 *   se intentaba con una columna "id_referencia" que nunca existió de verdad en la BD). Se resuelve
 *   igual con una segunda query y join en JS en vez de embed de PostgREST, para no depender de que
 *   el embed esté habilitado.
 * - Se excluyen los centros de costo de clientes/proveedores (tipo='cliente'/'proveedor', o los
 *   antiguos placeholders "EXT-PROV"/"EXT-CLI" que puedan quedar de antes de esta migración) — no
 *   son proyectos reales, así que no aportan al rendimiento por CdC de proyecto.
 * - No existe una columna de "código de proyecto" en `proyecto` (el código que arma NuevaVentaModal.svelte
 *   es un string calculado solo para mostrar en el formulario, nunca se guarda) — el filtro "código de
 *   proyecto" de este dashboard usa `centro_costo.codigo` (ej. "PROY-42"), que sí es el identificador
 *   corto real y persistido de cada proyecto.
 * - Ingresos de un CdC = transacciones tipo='ingreso' donde ese CdC es el destino (dinero que entra).
 *   Egresos de un CdC = transacciones tipo='egreso' donde ese CdC es el origen (dinero que sale).
 *   Coincide con cómo construirPayloadTransaccionPorCobro/Pago arman origen/destino.
 * - "Presupuesto asignado" de un CdC de proyecto = suma de presupuesto_detalle.total de TODOS los
 *   presupuestos de ese proyecto (presupuesto no tiene columna de monto total propia).
 * - "Gastos fijos corporativos globales" (para Margen de Contribución) = egresos de centros de costo
 *   que NO son de proyecto (tipo IN obra/consultoria/area/otro, reales, sin contar EXT-*) — se asume
 *   que esos representan la operación/estructura fija de la empresa, no un proyecto específico.
 * - Categoría de gasto (para "Concentración de Salidas de Caja") no vive en `transaccion`, solo en
 *   `cuentas_pagar.categoria_gasto` (catálogo PCGE clase 6) — se resuelve vía `pagos` (que sí tiene
 *   FK real a ambas: id_transaccion y id_cuenta_pagar).
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
	id_proyecto: number | null;
	nombre_proyecto: string | null;
	tip_proyecto: string | null; // 'O' = Obra, 'M' = Mantenimiento
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
	/** 'O' | 'M' | undefined (todos) */
	tipoProyecto?: string;
	/** id_centro_costo puntual (el selector de "código de proyecto") */
	idCentroCosto?: number | null;
}

export const TIPO_PROYECTO_OPTIONS: FieldOption[] = [
	{ value: 'O', label: 'Obra' },
	{ value: 'M', label: 'Mantenimiento' }
];

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

/** Opciones para el selector "Código de Proyecto" (en realidad, código de Centro de Costo). */
export async function getCentrosCostoProyectoOptions(client: SupabaseClient): Promise<FieldOption[]> {
	const { data, error } = await client
		.from('centro_costo')
		.select('id_centro_costo, codigo, nombre')
		.eq('tipo', 'proyecto')
		.order('codigo');
	if (error) throw error;
	return (data ?? [])
		.filter((c: any) => !esCentroExterno(c.codigo))
		.map((c: any) => ({ value: String(c.id_centro_costo), label: `${c.codigo} — ${c.nombre}` }));
}

/**
 * Trae y agrega todo el rendimiento por Centro de Costo (uno por proyecto), aplicando los filtros.
 * Ver notas de modelo de datos arriba del archivo para las definiciones exactas de cada métrica.
 */
export async function getRendimientoPorCentroCosto(
	client: SupabaseClient,
	filtros: FiltrosFinanzas = {}
): Promise<CentroCostoRendimiento[]> {
	// 1. Centros de costo de proyecto (+ filtro directo por CdC puntual si aplica)
	let ccQuery = client.from('centro_costo').select('id_centro_costo, codigo, nombre, id_proyecto').eq('tipo', 'proyecto');
	if (filtros.idCentroCosto) ccQuery = ccQuery.eq('id_centro_costo', filtros.idCentroCosto);
	const { data: centrosRaw, error: ccError } = await ccQuery;
	if (ccError) throw ccError;
	const centros = (centrosRaw ?? []).filter((c: any) => !esCentroExterno(c.codigo));
	if (centros.length === 0) return [];

	// 2. Proyectos vinculados (join en JS por simplicidad/consistencia, aunque id_proyecto ya es FK real)
	const idsProyecto = centros.map((c: any) => c.id_proyecto).filter((v: unknown): v is number => v !== null);
	const { data: proyectos } =
		idsProyecto.length > 0
			? await client
					.from('proyecto')
					.select('id_proyecto, nombre_proyecto, tip_proyecto, estado_proyecto, fecha_inicio_plan, fecha_fin_plan')
					.in('id_proyecto', idsProyecto)
			: { data: [] as any[] };
	const proyectoPorId = new Map((proyectos ?? []).map((p: any) => [p.id_proyecto, p]));

	// Filtro por tipo de proyecto — se aplica recién ahora, ya con tip_proyecto resuelto.
	const centrosFinal = filtros.tipoProyecto
		? centros.filter((c: any) => proyectoPorId.get(c.id_proyecto)?.tip_proyecto === filtros.tipoProyecto)
		: centros;
	if (centrosFinal.length === 0) return [];

	const idsCentroFinal = centrosFinal.map((c: any) => c.id_centro_costo);
	const idsProyectoFinal = centrosFinal.map((c: any) => c.id_proyecto).filter((v: unknown): v is number => v !== null);

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
 * Egresos activos de centros de costo "de estructura" (obra/consultoria/area/otro — ni de proyecto,
 * ni de cliente/proveedor) — la base contra la que se mide el Margen de Contribución Financiera:
 * cuánto de lo que aportan los CdC de proyecto alcanza para cubrir esta estructura fija corporativa.
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
