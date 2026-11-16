/**
 * Montos de una transacción en soles o en la moneda de una cuenta — espejo EXACTO de fn_monto_soles_transaccion y
 * fn_monto_en_moneda_cuenta (migración 20261112150000_saldos_corte_y_tipo_cambio.sql). Decisión del cliente
 * (12/11/2026): los centros de costo se llevan en soles (dólares × tipo de cambio) y cada cuenta bancaria en su moneda,
 * convirtiendo con el tipo de cambio de la transacción cuando las monedas difieren, como en el banco.
 *
 * Para usarlo, la consulta tiene que traer también COLUMNAS_MONEDA.
 */
export const COLUMNAS_MONEDA = 'tipo_moneda, tipo_cambio, monto_convertido';

export interface ConMoneda {
	monto_total: number | string | null;
	tipo_moneda?: string | null;
	tipo_cambio?: number | string | null;
	monto_convertido?: number | string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Monto en SOLES (lo que mueve un centro de costo). */
export function montoSoles(t: ConMoneda): number {
	const monto = Number(t.monto_total) || 0;
	if ((t.tipo_moneda ?? 'soles') !== 'dolares') return monto;
	if (t.monto_convertido !== null && t.monto_convertido !== undefined && t.monto_convertido !== '') return Number(t.monto_convertido);
	return r2(monto * (Number(t.tipo_cambio) || 0));
}

/** Monto en la moneda de una cuenta bancaria ('soles' | 'dolares' | otra = sin conversión). */
export function montoEnMonedaCuenta(t: ConMoneda, monedaCuenta: string | null | undefined): number {
	const moneda = monedaCuenta ?? 'soles';
	const monto = Number(t.monto_total) || 0;
	if (moneda !== 'soles' && moneda !== 'dolares') return monto;
	if ((t.tipo_moneda ?? 'soles') === moneda) return monto;
	if (moneda === 'soles') return montoSoles(t);
	const tc = Number(t.tipo_cambio) || 0;
	return tc > 0 ? r2(monto / tc) : 0;
}

/** ¿Hace falta tipo de cambio? (transacción en dólares, o alguna de sus cuentas en otra moneda) — misma regla que el
 * trigger fn_trg_transaccion_tipo_cambio. */
export function requiereTipoCambio(tipoMoneda: string | null | undefined, ...monedasCuentas: (string | null | undefined)[]): boolean {
	const m = tipoMoneda || 'soles';
	if (m === 'dolares') return true;
	return monedasCuentas.some((c) => (c === 'soles' || c === 'dolares') && c !== m);
}
