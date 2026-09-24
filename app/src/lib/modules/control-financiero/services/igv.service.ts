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
// "Control Mensual" (popup) — hoja de cálculo replicada: 12 meses (Ene-Dic) de un año, con estado
// REAL (datos ya registrados) o PROYECCIÓN (los meses restantes, con el PROMEDIO de los meses reales) y
// arrastre de Saldo a Favor mes a mes (crédito fiscal cuando Compras > Ventas). A diferencia de
// getResumenIgv/sumarVentasCompras (que usan la Tasa IGV fija del 18%), acá la Tasa IGV, la Tasa de pago
// a cuenta (Renta) y la cantidad de "meses reales cargados" son parámetros editables por el usuario, tal
// como en la hoja Excel de referencia — por eso se separan en dos pasos:
//   1) getDatosCrudosPorMes: trae de Supabase Ventas (factura.valor_venta, ya sin IGV) y Compras
//      (transaccion.monto_total, CON IGV) mes a mes — esto sí necesita ir a la base de datos.
//   2) calcularControlMensual: 100% cálculo en memoria (aplica la Tasa IGV para separar la base
//      imponible de Compras, promedia para proyectar, arrastra el saldo a favor) — se puede repetir sin
//      volver a consultar Supabase cada vez que el usuario cambia una tasa en el popup.
// ─────────────────────────────────────────────────────────────

export interface DatosCrudosMes {
	/** factura.valor_venta (ya excluye IGV, no depende de la Tasa IGV elegida). */
	ventasBase: number;
	/** transaccion.monto_total (INCLUYE IGV) — calcularControlMensual la separa según la Tasa IGV. */
	comprasTotal: number;
}

function rangoMesNum(anio: number, mes1a12: number): { desde: string; hasta: string } {
	const desde = `${anio}-${String(mes1a12).padStart(2, '0')}-01`;
	const hasta = new Date(anio, mes1a12, 0).toISOString().slice(0, 10);
	return { desde, hasta };
}

/** Trae Ventas/Compras crudas de los primeros `cantidadMeses` meses de `anio` (uno por uno, en paralelo) —
 * son los "meses reales cargados" del popup. */
export async function getDatosCrudosPorMes(client: SupabaseClient, anio: number, cantidadMeses: number): Promise<DatosCrudosMes[]> {
	const meses = Math.min(12, Math.max(0, Math.floor(cantidadMeses)));
	return Promise.all(
		Array.from({ length: meses }, (_, i) => i + 1).map(async (m) => {
			const { desde, hasta } = rangoMesNum(anio, m);
			const [{ data: facturas, error: errF }, { data: transacciones, error: errT }] = await Promise.all([
				client.from('factura').select('valor_venta').eq('estado', 'emitida').eq('activo', true).gte('fecha_emision', desde).lte('fecha_emision', hasta),
				client.from('transaccion').select('monto_total').eq('tipo', 'egreso').eq('estado', 'activo').eq('tipo_alcance', 'externa').gte('fecha', desde).lte('fecha', hasta)
			]);
			if (errF) throw errF;
			if (errT) throw errT;
			return {
				ventasBase: round2((facturas ?? []).reduce((s: number, f: any) => s + Number(f.valor_venta ?? 0), 0)),
				comprasTotal: round2((transacciones ?? []).reduce((s: number, t: any) => s + Number(t.monto_total ?? 0), 0))
			};
		})
	);
}

const NOMBRE_MES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SETIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

export interface FilaControlMensual {
	mes: number; // 1-12
	label: string; // 'ENERO', ...
	estado: 'REAL' | 'PROYECCION';
	ventas: number;
	igvVentas: number;
	compras: number;
	igvCompras: number;
	resultadoIgvMes: number;
	saldoAFavorAnterior: number;
	igvAPagar: number;
	saldoAFavorSiguiente: number;
	rentaMensual: number;
	tributosDelMes: number;
	etiquetaTributos: 'IGV por pagar' | 'Saldo a favor';
}

export interface ControlMensualResultado {
	filas: FilaControlMensual[];
	totales: {
		ventas: number;
		igvVentas: number;
		compras: number;
		igvCompras: number;
		resultadoIgvMes: number;
		igvAPagar: number;
		saldoAFavorFinal: number;
		rentaMensual: number;
		tributosDelMes: number;
	};
}

/** Cálculo puro (sin I/O) a partir de los datos crudos ya cargados — se puede volver a llamar cada vez
 * que el usuario cambia Tasa IGV/Tasa de pago a cuenta en el popup, sin golpear la base de datos de
 * nuevo. Los meses más allá de `crudos.length` se proyectan con el PROMEDIO de los meses reales (mismo
 * criterio que la hoja Excel de referencia: promedia Ventas y Compras, no el IGV ya calculado). El
 * Saldo a Favor se arrastra mes a mes: si el resultado del mes (IGV Ventas − IGV Compras) menos el saldo
 * a favor anterior es positivo, eso es lo que corresponde pagar; si es negativo, se acumula como nuevo
 * saldo a favor para el siguiente mes. */
export function calcularControlMensual(crudos: DatosCrudosMes[], mesesRealesCargados: number, tasaIgv: number, tasaPagoACuenta: number): ControlMensualResultado {
	// Acotado también por crudos.length: mientras getDatosCrudosPorMes todavía está en vuelo (recién
	// abierto el popup, o el usuario acaba de subir "Meses reales cargados"), mesesRealesCargados ya
	// cambió pero crudos aún no trae esa cantidad de meses — sin este tope se intentaba leer un mes
	// "real" inexistente y explotaba. Mientras carga, esos meses se muestran como PROYECCIÓN (0) hasta
	// que crudos llegue.
	const meses = Math.min(12, Math.max(0, Math.floor(mesesRealesCargados)), crudos.length);
	const basesReales = crudos.slice(0, meses).map((c) => ({ ventas: c.ventasBase, compras: round2(c.comprasTotal / (1 + tasaIgv)) }));
	const promedio = (arr: number[]) => (arr.length === 0 ? 0 : round2(arr.reduce((s, v) => s + v, 0) / arr.length));
	const ventasProm = promedio(basesReales.map((b) => b.ventas));
	const comprasProm = promedio(basesReales.map((b) => b.compras));

	const filas: FilaControlMensual[] = [];
	let saldoAnterior = 0;
	for (let m = 1; m <= 12; m++) {
		const esReal = m <= meses;
		const base = esReal ? basesReales[m - 1] : { ventas: ventasProm, compras: comprasProm };
		const igvVentas = round2(base.ventas * tasaIgv);
		const igvCompras = round2(base.compras * tasaIgv);
		const resultadoIgvMes = round2(igvVentas - igvCompras);
		const netoIgv = round2(resultadoIgvMes - saldoAnterior);
		const igvAPagar = netoIgv > 0 ? netoIgv : 0;
		const saldoSiguiente = netoIgv > 0 ? 0 : round2(-netoIgv);
		const rentaMensual = round2(base.ventas * tasaPagoACuenta);
		const tributosDelMes = round2(igvAPagar + rentaMensual);

		filas.push({
			mes: m,
			label: NOMBRE_MES[m - 1],
			estado: esReal ? 'REAL' : 'PROYECCION',
			ventas: base.ventas,
			igvVentas,
			compras: base.compras,
			igvCompras,
			resultadoIgvMes,
			saldoAFavorAnterior: saldoAnterior,
			igvAPagar,
			saldoAFavorSiguiente: saldoSiguiente,
			rentaMensual,
			tributosDelMes,
			etiquetaTributos: igvAPagar > 0 ? 'IGV por pagar' : 'Saldo a favor'
		});
		saldoAnterior = saldoSiguiente;
	}

	const suma = (sel: (f: FilaControlMensual) => number) => round2(filas.reduce((s, f) => s + sel(f), 0));
	return {
		filas,
		totales: {
			ventas: suma((f) => f.ventas),
			igvVentas: suma((f) => f.igvVentas),
			compras: suma((f) => f.compras),
			igvCompras: suma((f) => f.igvCompras),
			resultadoIgvMes: suma((f) => f.resultadoIgvMes),
			igvAPagar: suma((f) => f.igvAPagar),
			saldoAFavorFinal: filas[11].saldoAFavorSiguiente,
			rentaMensual: suma((f) => f.rentaMensual),
			tributosDelMes: suma((f) => f.tributosDelMes)
		}
	};
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
