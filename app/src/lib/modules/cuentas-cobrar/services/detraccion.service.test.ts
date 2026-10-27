import { describe, it, expect } from 'vitest';
import { cuotasEditables, fraccionesConDetraccion } from './detraccion.service';

describe('detracción en Cuentas por Cobrar', () => {
	it('parte cada cuota en neto + detracción (+5 días hábiles) y la suma sigue siendo el valor de venta', () => {
		const filas = fraccionesConDetraccion(
			[
				{ fecha: '2026-11-06', monto: 30000, referencia: 'Adelanto' },
				{ fecha: '2026-12-01', monto: 70000, referencia: '1er abono', detraccionJunto: true }
			],
			12,
			(f) => f.referencia ?? ''
		);
		expect(filas).toEqual([
			{ fecha: '2026-11-06', monto: 26400, referencia: 'Adelanto', detraccionJunto: false },
			{ fecha: '2026-11-13', monto: 3600, referencia: 'Detracción – Adelanto', detraccionJunto: false },
			{ fecha: '2026-12-01', monto: 61600, referencia: '1er abono', detraccionJunto: false },
			{ fecha: '2026-12-08', monto: 8400, referencia: 'Detracción – 1er abono', detraccionJunto: true }
		]);
		expect(filas.reduce((s, f) => s + f.monto, 0)).toBe(100000);
		expect(fraccionesConDetraccion([{ fecha: '2026-11-06', monto: 500 }], null, () => '')).toEqual([{ fecha: '2026-11-06', monto: 500 }]);
	});

	it('el editor de cuotas ve el monto bruto y reserva las detracciones de cuotas ya cobradas', () => {
		const cobros = [
			{ id_cobro: 1, estado_cobro: 'cobrado', monto: 26400, fecha_cobro: '2026-11-06', es_detraccion: false },
			{ id_cobro: 2, estado_cobro: 'programado', monto: 3600, fecha_cobro: '2026-11-13', es_detraccion: true, id_cobro_origen: 1 },
			{ id_cobro: 3, estado_cobro: 'programado', monto: 61600, fecha_cobro: '2026-12-01', es_detraccion: false, referencia: '1er abono' },
			{ id_cobro: 4, estado_cobro: 'programado', monto: 8400, fecha_cobro: '2026-12-08', es_detraccion: true, id_cobro_origen: 3, detraccion_junto: true }
		];
		expect(cuotasEditables(cobros)).toEqual({ fracciones: [{ fecha: '2026-12-01', monto: 70000, referencia: '1er abono', detraccionJunto: true }], reservado: 3600 });
	});
});
