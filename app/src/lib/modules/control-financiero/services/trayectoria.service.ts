/**
 * Trayectoria de saldo en el tiempo — Control Financiero (a pedido explícito del usuario). Reconstruye
 * la evolución histórica del saldo de cada centro de costo (fondos propios) y de cada cuenta bancaria,
 * caminando cronológicamente sus transacciones reales — no es un total agregado como el resto de este
 * módulo, es la SERIE completa (fecha, saldo acumulado) por entidad, para graficar una línea por
 * centro/cuenta. 100% client-side, mismo criterio "traer todo y agregar en JS" que el resto de Control
 * Financiero.
 *
 * Punto de partida de cada serie: su última Apertura Financiera (fecha_corte fija en la línea de
 * tiempo + su monto declarado), si tiene una — mismo criterio que getSaldoTotalCentrosCosto en
 * conciliacion.service.ts. Sin apertura, la serie arranca en su primera transacción real (saldo 0
 * antes de esa fecha). Para cuenta bancaria, el punto de partida es simplemente su `saldo_inicial`
 * (esa columna ya funciona como un "corte" desde siempre, sin necesidad de fecha_corte — ver
 * cuentaBanco.service.ts).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getCentroCostoOptionsSoloCentros } from '$lib/modules/transacciones/services/transacciones.service';
import { getUltimasAperturasPorCentroCosto, getUltimasAperturasPorCuentaBanco } from './conciliacion.service';
import { COLUMNAS_MONEDA, montoSoles, montoEnMonedaCuenta } from '$lib/shared/moneda';

export interface PuntoTrayectoria {
	fecha: string;
	saldo: number;
}

/** Una transacción que movió el saldo de la cuenta (para las gráficas de flechas y velas, y su panel). */
export interface MovimientoTrayectoria {
	id_transaccion: number;
	fecha: string;
	tipo: string | null;
	descripcion: string | null;
	num_operacion: string | null;
	/** + entra a la cuenta, − sale (en la moneda de la cuenta). */
	delta: number;
	saldoAntes: number;
	saldoDespues: number;
}

export interface SerieTrayectoria {
	id: string;
	label: string;
	puntos: PuntoTrayectoria[];
	/** Solo cuentas bancarias: punto de partida, saldo al final y cada movimiento. */
	saldoInicial?: number;
	fechaInicial?: string;
	/** true si el punto de partida es un punto de corte de Control Financiero (no el saldo inicial de la cuenta). */
	desdeCorte?: boolean;
	/** Fecha de apertura registrada en la cuenta (fecha_autorizacion), aunque el gráfico arranque antes. */
	fechaApertura?: string | null;
	/** Transacciones con fecha ANTERIOR a la fecha de apertura (sí cuentan en el saldo: la fecha está mal puesta). */
	movsAntesApertura?: number;
	saldoActual?: number;
	moneda?: string;
	movimientos?: MovimientoTrayectoria[];
}

export interface TrayectoriaResultado {
	/** Unión ordenada de TODAS las fechas en las que algo se movió, en cualquiera de las series —
	 * el eje de tiempo compartido para graficar todas las líneas juntas. */
	fechas: string[];
	series: SerieTrayectoria[];
}

/** Centro de costo: mismo criterio tipo-gated que getSaldosPorCentroCosto (centroCostos.service.ts —
 * egreso/transferencia debitan el origen, ingreso/financiamiento/transferencia acreditan el destino),
 * pero acumulando cronológicamente en vez de solo sumar el total. */
export async function getTrayectoriaCentrosCosto(client: SupabaseClient): Promise<TrayectoriaResultado> {
	const [opciones, aperturas, { data: transacciones, error }] = await Promise.all([
		getCentroCostoOptionsSoloCentros(client),
		getUltimasAperturasPorCentroCosto(client),
		client
			.from('transaccion')
			.select(`id_centro_costo_origen, id_centro_costo_destino, tipo, monto_total, ${COLUMNAS_MONEDA}, fecha`)
			.eq('estado', 'activo')
			.order('fecha', { ascending: true })
	]);
	if (error) throw error;

	const ids = opciones.map((o) => Number(o.value));
	const idsSet = new Set(ids);
	const eventosPorCentro = new Map<number, { fecha: string; delta: number }[]>();
	for (const id of ids) eventosPorCentro.set(id, []);

	for (const t of (transacciones ?? []) as any[]) {
		const monto = montoSoles(t); // el centro de costo se lleva en soles
		const origen = t.id_centro_costo_origen;
		const destino = t.id_centro_costo_destino;
		if (origen != null && idsSet.has(origen) && (t.tipo === 'egreso' || t.tipo === 'transferencia')) {
			const corte = aperturas[origen]?.fecha_corte;
			if (!corte || t.fecha > corte) eventosPorCentro.get(origen)!.push({ fecha: t.fecha, delta: -monto });
		}
		if (destino != null && idsSet.has(destino) && (t.tipo === 'ingreso' || t.tipo === 'financiamiento' || t.tipo === 'transferencia')) {
			const corte = aperturas[destino]?.fecha_corte;
			if (!corte || t.fecha > corte) eventosPorCentro.get(destino)!.push({ fecha: t.fecha, delta: monto });
		}
	}

	const fechasSet = new Set<string>();
	const series: SerieTrayectoria[] = [];

	for (const opt of opciones) {
		const id = Number(opt.value);
		const apertura = aperturas[id];
		const eventos = eventosPorCentro.get(id) ?? [];

		const puntos: PuntoTrayectoria[] = [];
		let saldo = apertura?.monto ?? 0;
		if (apertura) {
			puntos.push({ fecha: apertura.fecha_corte, saldo });
			fechasSet.add(apertura.fecha_corte);
		}
		for (const ev of eventos) {
			saldo += ev.delta;
			puntos.push({ fecha: ev.fecha, saldo });
			fechasSet.add(ev.fecha);
		}
		if (puntos.length === 0) continue; // sin apertura y sin movimientos — no aporta nada a la trayectoria

		series.push({ id: String(id), label: opt.label, puntos });
	}

	return { fechas: [...fechasSet].sort(), series };
}

/** Cuenta bancaria: saldo_inicial como punto de partida (sin necesitar fecha_corte — esa columna ya
 * es "todo lo que había antes de que el ERP empezara a llevar la cuenta"), anclado en su
 * `fecha_autorizacion` (o hoy, si no la tiene) — SIEMPRE se agrega este punto, aunque la cuenta no
 * tenga ninguna transacción todavía, porque su saldo puede venir 100% de una Apertura Financiera
 * (que escribe saldo_inicial directo, sin pasar por ninguna transacción — ver conciliacion.service.ts)
 * — sin este punto de partida, esas cuentas quedaban totalmente fuera del gráfico aunque sí tuvieran
 * saldo real. Luego, cada transacción real que la toca como origen (debita) o destino (acredita), sin
 * filtro de tipo — mismo criterio que recalcularSaldoCuentaBanco (cuentaBanco.service.ts). */
export async function getTrayectoriaCuentasBancarias(client: SupabaseClient): Promise<TrayectoriaResultado> {
	const [{ data: cuentas, error: errCuentas }, { data: transacciones, error: errTrans }, aperturas] = await Promise.all([
		client.from('cuenta_banco').select('numero_cuenta, titular_cuenta, tipo_moneda, saldo_inicial, fecha_autorizacion').eq('activo', true),
		client
			.from('transaccion')
			.select(`id_transaccion, tipo, descripcion, num_operacion, cuente_origen, cuente_destino, monto_total, ${COLUMNAS_MONEDA}, fecha`)
			.eq('estado', 'activo')
			.order('fecha', { ascending: true })
			.order('id_transaccion', { ascending: true }),
		getUltimasAperturasPorCuentaBanco(client)
	]);
	if (errCuentas) throw errCuentas;
	if (errTrans) throw errTrans;

	const fechasSet = new Set<string>();
	const series: SerieTrayectoria[] = [];
	const hoy = new Date().toISOString().slice(0, 10);

	for (const c of (cuentas ?? []) as any[]) {
		// Mismo criterio que fn_saldo_calculado_cuenta_banco: con punto de corte, parte de lo declarado en esa fecha y
		// solo suma lo posterior; montos en la moneda de la cuenta.
		const corte = aperturas[c.numero_cuenta];
		let saldo = corte ? corte.monto : Number(c.saldo_inicial);
		const fechaApertura: string | null = c.fecha_autorizacion ? String(c.fecha_autorizacion).slice(0, 10) : null;
		const saldoInicial = saldo;
		const movimientos: MovimientoTrayectoria[] = [];
		const puntosMov: PuntoTrayectoria[] = [];
		for (const t of (transacciones ?? []) as any[]) {
			if (corte && String(t.fecha).slice(0, 10) <= corte.fecha_corte) continue;
			const monto = montoEnMonedaCuenta(t, c.tipo_moneda);
			let delta = 0;
			if (t.cuente_origen === c.numero_cuenta) delta -= monto;
			if (t.cuente_destino === c.numero_cuenta) delta += monto;
			if (delta === 0) continue;
			movimientos.push({
				id_transaccion: t.id_transaccion,
				fecha: String(t.fecha).slice(0, 10),
				tipo: t.tipo ?? null,
				descripcion: t.descripcion ?? null,
				num_operacion: t.num_operacion ?? null,
				delta,
				saldoAntes: saldo,
				saldoDespues: saldo + delta
			});
			saldo += delta;
			puntosMov.push({ fecha: String(t.fecha).slice(0, 10), saldo });
		}
		// Sin punto de corte, el saldo de la BD suma TODAS las transacciones (también las de fecha anterior a la
		// apertura, que entonces está mal puesta). Para que la línea vaya en orden, el saldo inicial se dibuja en
		// la fecha más antigua entre la apertura y la primera transacción; se avisa cuántas quedaron antes.
		const primera = movimientos[0]?.fecha;
		const movsAntesApertura = !corte && fechaApertura ? movimientos.filter((m) => m.fecha < fechaApertura).length : 0;
		let fechaInicio = corte ? corte.fecha_corte : fechaApertura || primera || hoy;
		if (!corte && primera && primera < fechaInicio) fechaInicio = primera;
		const puntos: PuntoTrayectoria[] = [{ fecha: fechaInicio, saldo: saldoInicial }, ...puntosMov];
		for (const p of puntos) fechasSet.add(p.fecha);
		series.push({
			id: c.numero_cuenta,
			label: `${c.titular_cuenta} - ${c.numero_cuenta}`,
			puntos,
			saldoInicial,
			fechaInicial: fechaInicio,
			desdeCorte: !!corte,
			fechaApertura,
			movsAntesApertura,
			saldoActual: saldo,
			moneda: c.tipo_moneda,
			movimientos
		});
	}

	return { fechas: [...fechasSet].sort(), series };
}
