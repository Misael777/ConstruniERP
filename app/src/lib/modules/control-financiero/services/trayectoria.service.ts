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
import { getUltimasAperturasPorCentroCosto } from './conciliacion.service';

export interface PuntoTrayectoria {
	fecha: string;
	saldo: number;
}

export interface SerieTrayectoria {
	id: string;
	label: string;
	puntos: PuntoTrayectoria[];
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
			.select('id_centro_costo_origen, id_centro_costo_destino, tipo, monto_total, fecha')
			.eq('estado', 'activo')
			.order('fecha', { ascending: true })
	]);
	if (error) throw error;

	const ids = opciones.map((o) => Number(o.value));
	const idsSet = new Set(ids);
	const eventosPorCentro = new Map<number, { fecha: string; delta: number }[]>();
	for (const id of ids) eventosPorCentro.set(id, []);

	for (const t of (transacciones ?? []) as any[]) {
		const monto = Number(t.monto_total);
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
 * es "todo lo que había antes de que el ERP empezara a llevar la cuenta") + cada transacción real que
 * la toca como origen (debita) o destino (acredita), sin filtro de tipo — mismo criterio que
 * recalcularSaldoCuentaBanco (cuentaBanco.service.ts). */
export async function getTrayectoriaCuentasBancarias(client: SupabaseClient): Promise<TrayectoriaResultado> {
	const [{ data: cuentas, error: errCuentas }, { data: transacciones, error: errTrans }] = await Promise.all([
		client.from('cuenta_banco').select('numero_cuenta, titular_cuenta, saldo_inicial').eq('activo', true),
		client
			.from('transaccion')
			.select('cuente_origen, cuente_destino, monto_total, fecha')
			.eq('estado', 'activo')
			.order('fecha', { ascending: true })
	]);
	if (errCuentas) throw errCuentas;
	if (errTrans) throw errTrans;

	const fechasSet = new Set<string>();
	const series: SerieTrayectoria[] = [];

	for (const c of (cuentas ?? []) as any[]) {
		let saldo = Number(c.saldo_inicial);
		const puntos: PuntoTrayectoria[] = [];
		for (const t of (transacciones ?? []) as any[]) {
			const monto = Number(t.monto_total);
			let delta = 0;
			if (t.cuente_origen === c.numero_cuenta) delta -= monto;
			if (t.cuente_destino === c.numero_cuenta) delta += monto;
			if (delta === 0) continue;
			saldo += delta;
			puntos.push({ fecha: t.fecha, saldo });
			fechasSet.add(t.fecha);
		}
		if (puntos.length === 0) continue; // sin transacciones — nada que trazar, evita una línea invisible en el gráfico
		series.push({ id: c.numero_cuenta, label: `${c.titular_cuenta} - ${c.numero_cuenta}`, puntos });
	}

	return { fechas: [...fechasSet].sort(), series };
}
