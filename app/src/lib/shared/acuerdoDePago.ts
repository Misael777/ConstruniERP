/**
 * Nombre de cada cuota de una Cuenta por Cobrar/Pagar ("Acuerdo de pago"), en un solo lugar para que el
 * Resumen de cobro/pago (ResumenCuentaModal) y la lista de Transacciones (N° de cuota guardado en
 * `transaccion.tipo_transaccion`) muestren lo mismo: la 1.ª cuota es el "Adelanto" y las siguientes
 * "1er abono", "2do abono"... — mismo orden por fecha que calcularNumeroCuota (transacciones.service.ts).
 */
const ORDINALES = ['1er', '2do', '3er', '4to', '5to', '6to', '7mo', '8vo', '9no', '10mo', '11vo', '12vo'];

/** Nombre por número de cuota (1 = Adelanto, 2 = 1er abono, ...). */
export function nombreCuota(numero: number): string {
	if (numero <= 1) return 'Adelanto';
	const n = numero - 1;
	return `${ORDINALES[n - 1] ?? `${n}°`} abono`;
}

/** Igual que nombreCuota pero por posición (0 = primera) y sabiendo el total: una cuota sola es "Pago único". */
export function acuerdoDePago(indice: number, total: number): string {
	if (total === 1) return 'Pago único';
	return nombreCuota(indice + 1);
}

/** Para `transaccion.tipo_transaccion` (N° de cuota guardado como texto): el nombre, o el texto tal cual si no es un número. */
export function nombreCuotaDeTransaccion(tipoTransaccion: string | number | null | undefined): string | null {
	if (tipoTransaccion === null || tipoTransaccion === undefined || tipoTransaccion === '') return null;
	const n = Number(tipoTransaccion);
	return Number.isInteger(n) && n > 0 ? nombreCuota(n) : String(tipoTransaccion);
}
