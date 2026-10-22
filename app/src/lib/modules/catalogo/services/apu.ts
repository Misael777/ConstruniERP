/**
 * Cálculo del APU (análisis de precios unitarios) de una partida del catálogo — funciones puras (sin BD ni DOM)
 * para poder probarlas con vitest. Reglas (según la imagen de referencia del usuario):
 *  - Mano de obra y equipos con cuadrilla: cantidad = cuadrilla × jornada ÷ rendimiento
 *    (ej. operario 1 × 8 h ÷ 12 m³/día = 0.667 hh/m³).
 *  - Materiales: la cantidad se ingresa directamente (ej. 6.000 bol/m³).
 *  - Unidad "%mo" (ej. herramientas manuales 3% MO): parcial = cantidad% × total de mano de obra.
 *  - Parcial = cantidad × precio; P.U. de la partida = suma de parciales de las líneas incluidas.
 */
import type { TipoRecurso } from './catalogo.service';

export interface LineaApuCalculo {
	tipo: TipoRecurso;
	unidad: string | null;
	precio: number;
	cuadrilla: number | null;
	/** Cantidad ingresada (se usa cuando no hay cuadrilla, o para %MO). */
	cantidad: number;
	incluido: boolean;
}

const r = (n: number, d: number) => Math.round((Number(n) || 0) * 10 ** d) / 10 ** d;

export const esPorcentajeMO = (unidad: string | null) => (unidad ?? '').toLowerCase() === '%mo';
/** Las líneas de mano de obra y equipos calculan su cantidad con la cuadrilla. */
export const usaCuadrilla = (tipo: TipoRecurso, unidad: string | null) => (tipo === 'mano_obra' || tipo === 'equipo') && !esPorcentajeMO(unidad);

export function cantidadPorCuadrilla(cuadrilla: number, jornada: number, rendimiento: number): number {
	if (!(rendimiento > 0)) return 0;
	// 3 decimales, como el APU de referencia (0.667): así el parcial coincide (0.667 × 27.50 = 18.34).
	return r((cuadrilla * jornada) / rendimiento, 3);
}

/** Cantidad efectiva de una línea (calculada por cuadrilla si corresponde). */
export function cantidadLinea(l: LineaApuCalculo, jornada: number, rendimiento: number): number {
	if (usaCuadrilla(l.tipo, l.unidad) && l.cuadrilla !== null && l.cuadrilla !== undefined) return cantidadPorCuadrilla(l.cuadrilla, jornada, rendimiento);
	return r(l.cantidad, 3);
}

export interface ResultadoApu {
	cantidades: number[];
	parciales: number[];
	/** Precio mostrado por línea (en %MO es el total de mano de obra sobre el que se aplica el %). */
	precios: number[];
	totalManoObra: number;
	totalPorTipo: Record<TipoRecurso, number>;
	precioUnitario: number;
}

export function calcularApu(lineas: LineaApuCalculo[], jornada: number, rendimiento: number): ResultadoApu {
	const cantidades = lineas.map((l) => cantidadLinea(l, jornada, rendimiento));
	const parciales = lineas.map(() => 0);
	const precios = lineas.map((l) => l.precio);
	// Primero todo lo que no es %MO, para conocer el total de mano de obra.
	lineas.forEach((l, i) => {
		if (!esPorcentajeMO(l.unidad)) parciales[i] = l.incluido ? r(cantidades[i] * l.precio, 2) : 0;
	});
	const totalManoObra = r(lineas.reduce((s, l, i) => s + (l.tipo === 'mano_obra' && !esPorcentajeMO(l.unidad) ? parciales[i] : 0), 0), 2);
	lineas.forEach((l, i) => {
		if (esPorcentajeMO(l.unidad)) {
			precios[i] = totalManoObra;
			parciales[i] = l.incluido ? r((cantidades[i] / 100) * totalManoObra, 2) : 0;
		}
	});
	const totalPorTipo: Record<TipoRecurso, number> = { material: 0, mano_obra: 0, equipo: 0, subcontrato: 0 };
	lineas.forEach((l, i) => (totalPorTipo[l.tipo] = r(totalPorTipo[l.tipo] + parciales[i], 2)));
	const precioUnitario = r(parciales.reduce((s, p) => s + p, 0), 2);
	return { cantidades, parciales, precios, totalManoObra, totalPorTipo, precioUnitario };
}
