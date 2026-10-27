import { describe, it, expect } from 'vitest';
import { sumarDiasHabiles, partirDetraccion, porcentajeDetraccion, nombreDetraccion, esReferenciaDetraccion } from './detraccion';

describe('detracción', () => {
	it('suma 5 días hábiles saltando sábados y domingos', () => {
		expect(sumarDiasHabiles('2026-11-06')).toBe('2026-11-13'); // viernes → viernes
		expect(sumarDiasHabiles('2026-11-02')).toBe('2026-11-09'); // lunes → lunes
		expect(sumarDiasHabiles('2026-11-07')).toBe('2026-11-13'); // sábado → viernes
		expect(sumarDiasHabiles('2026-11-08')).toBe('2026-11-13'); // domingo → viernes
		expect(sumarDiasHabiles('2026-12-29')).toBe('2027-01-05'); // cruza de año
		expect(sumarDiasHabiles('2026-11-04', 1)).toBe('2026-11-05');
	});

	it('parte la cuota en neto + detracción y cuadra exacto', () => {
		expect(partirDetraccion(30000, 12)).toEqual({ neto: 26400, detraccion: 3600 });
		const p = partirDetraccion(1234.57, 12);
		expect(p.detraccion).toBe(148.15);
		expect(Math.round((p.neto + p.detraccion) * 100) / 100).toBe(1234.57);
		expect(partirDetraccion(500, null)).toEqual({ neto: 500, detraccion: 0 });
	});

	it('con varias cuotas, netos + detracciones = valor de venta', () => {
		const cuotas = [33333.33, 33333.33, 33333.34];
		const total = cuotas.map((c) => partirDetraccion(c, 12)).reduce((s, p) => s + p.neto + p.detraccion, 0);
		expect(Math.round(total * 100) / 100).toBe(100000);
	});

	it('valida el porcentaje y nombra la cuota', () => {
		expect(porcentajeDetraccion('12')).toBe(12);
		expect(porcentajeDetraccion(0)).toBeNull();
		expect(porcentajeDetraccion(100)).toBeNull();
		expect(porcentajeDetraccion('abc')).toBeNull();
		expect(nombreDetraccion('Adelanto 1 - Armada 2')).toBe('Detracción – Adelanto 1 - Armada 2');
		expect(esReferenciaDetraccion('Detracción – 1er abono')).toBe(true);
		expect(esReferenciaDetraccion('1er abono')).toBe(false);
	});
});
