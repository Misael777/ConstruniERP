/**
 * Servicio de "Control de IGV" (Control Financiero) — estima cuánto IGV corresponde pagar en el mes
 * cruzando el IGV de Ventas ya facturado (factura.monto_igv, comprobantes emitidos) contra el Crédito
 * Fiscal de Compras. `transaccion` no trae un desglose de IGV propio (a diferencia de `factura`, que sí
 * separa valor_venta/monto_igv) — se deriva asumiendo que `monto_total` de un egreso YA INCLUYE IGV,
 * misma fórmula que valorSinIgv en facturacion.service.ts (no se importa de ahí a propósito: este
 * servicio queda independiente del módulo de Facturación, que conceptualmente no le pertenece).
 *
 * 100% cliente vía Supabase (anon key): sin agregación SQL (PostgREST no la ofrece), cada función trae
 * las filas del rango de fechas necesario y reduce en JS — mismo criterio que el resto de Control
 * Financiero y de Facturación. El objetivo mensual (techo de IGV a pagar) es el único dato que se
 * persiste (tabla `igv_objetivo`, ver control_igv_migration.sql); todo lo demás se recalcula en vivo en
 * cada visita, nunca se guarda.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ServiceResult<T = undefined> {
	success: boolean;
	message: string;
	data?: T;
}

const IGV_TASA = 0.18;

function round2(v: number): number {
	return Math.round(v * 100) / 100;
}

/** A partir de un monto que YA INCLUYE IGV (transaccion.monto_total), separa la base imponible. */
function baseImponible(montoConIgv: number): number {
	return round2(montoConIgv / (1 + IGV_TASA));
}

export interface ResumenMesIgv {
	ventasBase: number;
	igvVentas: number;
	comprasBase: number;
	creditoFiscalCompras: number;
	igvEstimado: number;
}

export interface ResumenIgv extends ResumenMesIgv {
	mesAnterior: ResumenMesIgv;
	/** null = no hay base de comparación (mes anterior en 0) — se muestra "—" en vez de un % engañoso. */
	variacionVentasPct: number | null;
	variacionComprasPct: number | null;
	variacionIgvPct: number | null;
}

export interface PuntoEvolucionIgv {
	mes: string; // 'YYYY-MM'
	label: string; // 'Ene', 'Feb', ...
	igvEstimado: number;
}

export interface ComprobanteVenta {
	folio: string;
	fecha_emision: string;
	cliente_nombre: string | null;
	valor_venta: number;
	monto_igv: number;
	monto_total: number;
}

export interface MovimientoCompra {
	id_transaccion: number;
	fecha: string;
	categoria: string | null;
	descripcion: string | null;
	monto_total: number;
	base_imponible: number;
	credito_fiscal: number;
}

function rangoMes(mes: Date): { desde: string; hasta: string } {
	const inicio = new Date(mes.getFullYear(), mes.getMonth(), 1);
	const fin = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
	return { desde: inicio.toISOString().slice(0, 10), hasta: fin.toISOString().slice(0, 10) };
}

async function sumarVentasCompras(client: SupabaseClient, desde: string, hasta: string): Promise<ResumenMesIgv> {
	const [{ data: facturas, error: errF }, { data: transacciones, error: errT }] = await Promise.all([
		client.from('factura').select('valor_venta, monto_igv').eq('estado', 'emitida').eq('activo', true).gte('fecha_emision', desde).lte('fecha_emision', hasta),
		client.from('transaccion').select('monto_total').eq('tipo', 'egreso').eq('estado', 'activo').eq('tipo_alcance', 'externa').gte('fecha', desde).lte('fecha', hasta)
	]);
	if (errF) throw errF;
	if (errT) throw errT;

	const ventasBase = (facturas ?? []).reduce((s: number, f: any) => s + Number(f.valor_venta ?? 0), 0);
	const igvVentas = (facturas ?? []).reduce((s: number, f: any) => s + Number(f.monto_igv ?? 0), 0);
	const comprasBase = (transacciones ?? []).reduce((s: number, t: any) => s + baseImponible(Number(t.monto_total ?? 0)), 0);
	const creditoFiscalCompras = round2(comprasBase * IGV_TASA);
	const igvEstimado = round2(igvVentas - creditoFiscalCompras);

	return { ventasBase: round2(ventasBase), igvVentas: round2(igvVentas), comprasBase, creditoFiscalCompras, igvEstimado };
}

function variacionPct(actual: number, anterior: number): number | null {
	if (anterior === 0) return actual === 0 ? 0 : null;
	return Math.round(((actual - anterior) / anterior) * 1000) / 10;
}

/** Resumen del mes indicado (Ventas/Compras/IGV) + comparación contra el mes anterior — para las 4
 * tarjetas superiores de la pestaña ("Control de IGV", "IGV estimado a pagar", flechas +X%). */
export async function getResumenIgv(client: SupabaseClient, mes: Date): Promise<ResumenIgv> {
	const rangoActual = rangoMes(mes);
	const mesAnteriorDate = new Date(mes.getFullYear(), mes.getMonth() - 1, 1);
	const rangoAnterior = rangoMes(mesAnteriorDate);

	const [actual, anterior] = await Promise.all([sumarVentasCompras(client, rangoActual.desde, rangoActual.hasta), sumarVentasCompras(client, rangoAnterior.desde, rangoAnterior.hasta)]);

	return {
		...actual,
		mesAnterior: anterior,
		variacionVentasPct: variacionPct(actual.ventasBase, anterior.ventasBase),
		variacionComprasPct: variacionPct(actual.comprasBase, anterior.comprasBase),
		variacionIgvPct: variacionPct(actual.igvEstimado, anterior.igvEstimado)
	};
}

const MESES_LABEL = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];

/** Últimos `cantidad` meses (incluido `mesReferencia`) para el gráfico "Evolución del IGV por pagar". */
export async function getEvolucionIgv(client: SupabaseClient, mesReferencia: Date, cantidad = 6): Promise<PuntoEvolucionIgv[]> {
	const meses: Date[] = [];
	for (let i = cantidad - 1; i >= 0; i--) {
		meses.push(new Date(mesReferencia.getFullYear(), mesReferencia.getMonth() - i, 1));
	}
	return Promise.all(
		meses.map(async (m) => {
			const { desde, hasta } = rangoMes(m);
			const r = await sumarVentasCompras(client, desde, hasta);
			return { mes: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`, label: MESES_LABEL[m.getMonth()], igvEstimado: r.igvEstimado };
		})
	);
}

/** Detalle de comprobantes (Ventas = facturas emitidas, Compras = transacciones de egreso) dentro de un
 * rango de fechas libre — para la sección colapsable "Detalle de facturas (Ventas y Compras)". */
export async function getComprobantesDelPeriodo(client: SupabaseClient, desde: string, hasta: string): Promise<{ ventas: ComprobanteVenta[]; compras: MovimientoCompra[] }> {
	const [{ data: facturas, error: errF }, { data: transacciones, error: errT }] = await Promise.all([
		client
			.from('factura')
			.select('folio, fecha_emision, cliente_nombre, valor_venta, monto_igv, monto_total')
			.eq('estado', 'emitida')
			.eq('activo', true)
			.gte('fecha_emision', desde)
			.lte('fecha_emision', hasta)
			.order('fecha_emision', { ascending: false }),
		client
			.from('transaccion')
			.select('id_transaccion, fecha, categoria, descripcion, monto_total')
			.eq('tipo', 'egreso')
			.eq('estado', 'activo')
			.eq('tipo_alcance', 'externa')
			.gte('fecha', desde)
			.lte('fecha', hasta)
			.order('fecha', { ascending: false })
	]);
	if (errF) throw errF;
	if (errT) throw errT;

	const ventas: ComprobanteVenta[] = (facturas ?? []).map((f: any) => ({
		folio: f.folio,
		fecha_emision: f.fecha_emision,
		cliente_nombre: f.cliente_nombre,
		valor_venta: Number(f.valor_venta ?? 0),
		monto_igv: Number(f.monto_igv ?? 0),
		monto_total: Number(f.monto_total ?? 0)
	}));
	const compras: MovimientoCompra[] = (transacciones ?? []).map((t: any) => {
		const montoTotal = Number(t.monto_total ?? 0);
		const base = baseImponible(montoTotal);
		return {
			id_transaccion: t.id_transaccion,
			fecha: t.fecha,
			categoria: t.categoria,
			descripcion: t.descripcion,
			monto_total: montoTotal,
			base_imponible: base,
			credito_fiscal: round2(base * IGV_TASA)
		};
	});

	return { ventas, compras };
}

// ─────────────────────────────────────────────────────────────
// Objetivo mensual (IGV máximo a pagar) — único valor persistido, ver migración.
// ─────────────────────────────────────────────────────────────

const OBJETIVO_POR_DEFECTO = 5000;

export async function getObjetivoIgv(client: SupabaseClient): Promise<number> {
	const { data, error } = await client.from('igv_objetivo').select('objetivo_mensual').eq('id', 1).maybeSingle();
	if (error) throw error;
	return data ? Number(data.objetivo_mensual) : OBJETIVO_POR_DEFECTO;
}

export async function setObjetivoIgv(client: SupabaseClient, valor: number, usuario: string | null): Promise<ServiceResult> {
	if (!(valor > 0)) return { success: false, message: 'El objetivo debe ser mayor a 0' };
	const { error } = await client.from('igv_objetivo').upsert({ id: 1, objetivo_mensual: valor, usuario_registro: usuario, updated_at: new Date().toISOString() });
	if (error) return { success: false, message: `No se pudo guardar el objetivo: ${error.message}` };
	return { success: true, message: 'Objetivo actualizado correctamente' };
}

// ─────────────────────────────────────────────────────────────
// Semáforo — mismos 3 umbrales que la tarjeta "Leyenda del semáforo" describe en la pestaña.
// ─────────────────────────────────────────────────────────────

export type EstadoSemaforoIgv = 'ok' | 'alerta' | 'error';

export function estadoSemaforoIgv(igvEstimado: number, objetivo: number): EstadoSemaforoIgv {
	if (objetivo <= 0) return 'error';
	const pct = (igvEstimado / objetivo) * 100;
	if (pct >= 100) return 'error';
	if (pct >= 80) return 'alerta';
	return 'ok';
}
