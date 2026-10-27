/**
 * Detracción de una venta (a pedido del usuario): cada cuota de la venta (armada, pago de valorización, cuota del plan
 * de pagos) se parte en la cuota NETA (lo que entra a la cuenta de la empresa) y su DETRACCIÓN (lo que el cliente
 * deposita en Banco de la Nación), que vence 5 días hábiles después de la cuota. Neto + detracción = monto de la cuota,
 * así la suma de todo sigue siendo el valor de venta. Ver migración detraccion_venta. Funciones puras (vitest).
 */

export const DIAS_HABILES_DETRACCION = 5;

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Suma días hábiles (lunes a viernes) a una fecha 'YYYY-MM-DD'. Ej.: viernes 6 + 5 → viernes 13. */
export function sumarDiasHabiles(fecha: string, dias = DIAS_HABILES_DETRACCION): string {
	const [a, m, d] = fecha.slice(0, 10).split('-').map(Number);
	const f = new Date(Date.UTC(a, m - 1, d));
	let restantes = dias;
	while (restantes > 0) {
		f.setUTCDate(f.getUTCDate() + 1);
		const dia = f.getUTCDay();
		if (dia !== 0 && dia !== 6) restantes--;
	}
	return f.toISOString().slice(0, 10);
}

/** Parte el monto de una cuota: detracción = monto × % (redondeada a céntimos) y neto = el resto (cuadra exacto). */
export function partirDetraccion(monto: number, porcentaje: number | null | undefined): { neto: number; detraccion: number } {
	const total = r2(monto);
	if (!porcentaje || !(porcentaje > 0)) return { neto: total, detraccion: 0 };
	const detraccion = r2((total * porcentaje) / 100);
	return { neto: r2(total - detraccion), detraccion };
}

/** Porcentaje válido (0 < % < 100) o null. */
export function porcentajeDetraccion(valor: unknown): number | null {
	const n = Number(valor);
	return Number.isFinite(n) && n > 0 && n < 100 ? r2(n) : null;
}

/** Nombre de la cuota de detracción a partir del de su cuota: "Detracción – Adelanto 1 - Armada 2". */
export function nombreDetraccion(nombreCuotaOrigen: string | null | undefined): string {
	return nombreCuotaOrigen?.trim() ? `Detracción – ${nombreCuotaOrigen.trim()}` : 'Detracción';
}

/** Para `cobros.referencia` (100 caracteres). */
export function referenciaDetraccion(nombreCuotaOrigen: string | null | undefined): string {
	return nombreDetraccion(nombreCuotaOrigen).slice(0, 100);
}

export const esReferenciaDetraccion = (referencia: string | null | undefined) => /^detracci[oó]n\b/i.test(referencia?.trim() ?? '');
