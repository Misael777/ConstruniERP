/**
 * Nombre de cada cuota de una Cuenta por Cobrar/Pagar ("Acuerdo de pago"), en un solo lugar para que el
 * Resumen de cobro/pago (ResumenCuentaModal) y la lista de Transacciones (N° de cuota guardado en
 * `transaccion.tipo_transaccion`) muestren lo mismo: la 1.ª cuota es el "Adelanto" y las siguientes
 * "1er abono", "2do abono"... — mismo orden por fecha que calcularNumeroCuota (transacciones.service.ts).
 */
const ORDINALES = ['1er', '2do', '3er', '4to', '5to', '6to', '7mo', '8vo', '9no', '10mo', '11vo', '12vo'];

/** Ticket #102: el adelanto de una venta puede llegar en varias "armadas" (depósitos). Cada armada es su propia
 * cuota cobrada, con cobros.referencia = referenciaArmada(i) — así se reconocen sin columna nueva. */
const ORDINALES_ARMADA = ['1ra', '2da', '3ra', '4ta', '5ta', '6ta', '7ma', '8va', '9na', '10ma'];
export function ordinalArmada(indice: number): string {
	return ORDINALES_ARMADA[indice] ?? `${indice + 1}ª`;
}
export function referenciaArmada(indice: number): string {
	return `Adelanto – ${ordinalArmada(indice)} armada`;
}
const ES_ARMADA = /^adelanto\b.*\barmada\b/i;
/** Cuántas de las primeras cuotas (ya ordenadas por fecha) son armadas del adelanto; 1 si ninguna lo indica
 * (cuentas de antes de las armadas: la 1.ª cuota es el adelanto, como siempre). */
export function contarArmadasAdelanto(referencias: (string | null | undefined)[]): number {
	let n = 0;
	while (n < referencias.length && ES_ARMADA.test(referencias[n] ?? '')) n++;
	return Math.max(n, 1);
}

/** Nombre por número de cuota (1 = Adelanto, 2 = 1er abono, ...). Ticket #95: en ventas de OBRA las cuotas
 * después del adelanto son "Valorización 1", "Valorización 2"... (no "abono"). Con `armadas` > 1 (ticket #102),
 * las primeras `armadas` cuotas son el adelanto ("Adelanto (2da armada)") y la numeración sigue después. */
export function nombreCuota(numero: number, esObra = false, armadas = 1): string {
	if (numero <= armadas) return armadas > 1 ? `Adelanto (${ordinalArmada(Math.max(numero, 1) - 1)} armada)` : 'Adelanto';
	const n = numero - armadas;
	return esObra ? `Valorización ${n}` : `${ORDINALES[n - 1] ?? `${n}°`} abono`;
}

/** Igual que nombreCuota pero por posición (0 = primera) y sabiendo el total: una cuota sola es "Pago único". */
export function acuerdoDePago(indice: number, total: number, esObra = false, armadas = 1): string {
	if (total === 1) return 'Pago único';
	return nombreCuota(indice + 1, esObra, armadas);
}

/** Para `transaccion.tipo_transaccion` (N° de cuota guardado como texto): el nombre, o el texto tal cual si no es un número. */
export function nombreCuotaDeTransaccion(tipoTransaccion: string | number | null | undefined): string | null {
	if (tipoTransaccion === null || tipoTransaccion === undefined || tipoTransaccion === '') return null;
	const n = Number(tipoTransaccion);
	return Number.isInteger(n) && n > 0 ? nombreCuota(n) : String(tipoTransaccion);
}
