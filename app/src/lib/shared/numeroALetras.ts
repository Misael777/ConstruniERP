/**
 * Convierte un monto en soles a su formato en letras estilo comprobante peruano
 * ("DIEZ MIL Y 00/100 SOLES") — usado por el PDF de comprobante de transferencia interna
 * (ver comprobanteTransferenciaInterna.ts). Soporta hasta 999,999,999 (de sobra para este ERP).
 */

const UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
const DECENAS_ESPECIALES: Record<number, string> = {
	10: 'DIEZ',
	11: 'ONCE',
	12: 'DOCE',
	13: 'TRECE',
	14: 'CATORCE',
	15: 'QUINCE',
	16: 'DIECISÉIS',
	17: 'DIECISIETE',
	18: 'DIECIOCHO',
	19: 'DIECINUEVE'
};
const VEINTES: Record<number, string> = {
	1: 'VEINTIUNO',
	2: 'VEINTIDÓS',
	3: 'VEINTITRÉS',
	4: 'VEINTICUATRO',
	5: 'VEINTICINCO',
	6: 'VEINTISÉIS',
	7: 'VEINTISIETE',
	8: 'VEINTIOCHO',
	9: 'VEINTINUEVE'
};
const DECENAS = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

/** Convierte un número de 0 a 999 a letras. */
function convertirGrupo(n: number): string {
	if (n === 0) return '';
	if (n === 100) return 'CIEN';

	const partes: string[] = [];
	const centena = Math.floor(n / 100);
	const resto = n % 100;
	if (centena > 0) partes.push(CENTENAS[centena]);

	if (resto > 0) {
		if (resto < 10) {
			partes.push(UNIDADES[resto]);
		} else if (resto < 20) {
			partes.push(DECENAS_ESPECIALES[resto]);
		} else {
			const decena = Math.floor(resto / 10);
			const unidad = resto % 10;
			if (decena === 2 && unidad > 0) {
				partes.push(VEINTES[unidad]);
			} else if (unidad > 0) {
				partes.push(`${DECENAS[decena]} Y ${UNIDADES[unidad]}`);
			} else {
				partes.push(DECENAS[decena]);
			}
		}
	}
	return partes.join(' ');
}

export function montoEnLetras(monto: number, moneda = 'SOLES'): string {
	const valorAbsoluto = Math.abs(monto || 0);
	const entero = Math.floor(valorAbsoluto);
	const centavos = Math.round((valorAbsoluto - entero) * 100);

	const millones = Math.floor(entero / 1_000_000);
	const miles = Math.floor((entero % 1_000_000) / 1000);
	const centenas = entero % 1000;

	const partes: string[] = [];
	if (millones > 0) {
		partes.push(millones === 1 ? 'UN MILLÓN' : `${convertirGrupo(millones)} MILLONES`);
	}
	if (miles > 0) {
		partes.push(miles === 1 ? 'MIL' : `${convertirGrupo(miles)} MIL`);
	}
	if (centenas > 0 || partes.length === 0) {
		partes.push(convertirGrupo(centenas) || 'CERO');
	}

	return `${partes.join(' ')} Y ${String(centavos).padStart(2, '0')}/100 ${moneda}`;
}
