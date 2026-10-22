import { describe, it, expect } from 'vitest';
import { calcularApu, cantidadPorCuadrilla, type LineaApuCalculo } from './apu';

// APU "EST-001 Concreto en zapatas f'c=210 kg/cm²" de la imagen de referencia: m³, rendimiento 12 m³/día, jornada 8 h.
const lineas: LineaApuCalculo[] = [
	{ tipo: 'mano_obra', unidad: 'hh', precio: 27.5, cuadrilla: 1, cantidad: 0, incluido: true }, // Operario
	{ tipo: 'mano_obra', unidad: 'hh', precio: 19.0, cuadrilla: 2, cantidad: 0, incluido: true }, // Peón
	{ tipo: 'material', unidad: 'bol', precio: 32.0, cuadrilla: null, cantidad: 6, incluido: true }, // Cemento
	{ tipo: 'material', unidad: 'm3', precio: 75.0, cuadrilla: null, cantidad: 0.83, incluido: true }, // Arena gruesa
	{ tipo: 'material', unidad: 'm3', precio: 70.0, cuadrilla: null, cantidad: 0.99, incluido: true }, // Piedra chancada
	{ tipo: 'equipo', unidad: 'hm', precio: 35.0, cuadrilla: 1, cantidad: 0, incluido: true }, // Mezcladora
	{ tipo: 'equipo', unidad: '%mo', precio: 0, cuadrilla: null, cantidad: 3, incluido: true } // Herramientas manuales 3% MO
];

describe('APU de partidas', () => {
	it('cantidad por cuadrilla = cuadrilla × jornada ÷ rendimiento', () => {
		expect(cantidadPorCuadrilla(1, 8, 12)).toBe(0.667);
		expect(cantidadPorCuadrilla(2, 8, 12)).toBe(1.333);
	});

	it('reproduce los parciales de la imagen', () => {
		const r = calcularApu(lineas, 8, 12);
		expect(r.parciales[0]).toBe(18.34); // 0.667 × 27.50 (igual que la imagen)
		expect(r.parciales[1]).toBe(25.33); // 1.333 × 19.00
		expect(r.parciales[2]).toBe(192); // 6 × 32
		expect(r.parciales[3]).toBe(62.25); // 0.83 × 75
		expect(r.parciales[4]).toBe(69.3); // 0.99 × 70
		expect(r.parciales[5]).toBe(23.35); // 0.667 × 35 (igual que la imagen)
		expect(r.totalManoObra).toBe(43.67);
		expect(r.parciales[6]).toBe(1.31); // 3% × 43.67
		expect(r.precioUnitario).toBe(r.parciales.reduce((s, p) => Math.round((s + p) * 100) / 100, 0));
	});

	it('una línea no incluida no suma', () => {
		const sinCemento = lineas.map((l, i) => (i === 2 ? { ...l, incluido: false } : l));
		expect(calcularApu(lineas, 8, 12).precioUnitario - calcularApu(sinCemento, 8, 12).precioUnitario).toBeCloseTo(192, 2);
	});
});
