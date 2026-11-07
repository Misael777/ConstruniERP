import { describe, it, expect } from 'vitest';
import { jornadaDelDia } from './miAsistencia.service';
import type { Marca } from './asistencia.service';

const F = '2026-11-06';
const m = (hhmm: string, fecha = F): Marca => {
	const [h, mi] = hhmm.split(':').map(Number);
	return { fecha, minuto: h * 60 + mi, huellero: 'ERP', origen: 'erp' };
};

describe('jornadaDelDia (Mi asistencia)', () => {
	it('sin marcas: fuera de jornada y 0 minutos', () => {
		expect(jornadaDelDia([], F, 600)).toEqual({ tramos: [], enJornada: false, minutos: 0 });
	});

	it('ingreso sin salida: en jornada y cuenta hasta ahora', () => {
		const j = jornadaDelDia([m('08:00')], F, 10 * 60 + 30);
		expect(j.enJornada).toBe(true);
		expect(j.tramos).toEqual([{ inicio: 480, fin: null }]);
		expect(j.minutos).toBe(150);
	});

	it('dos tramos cerrados (salió a almorzar): suma ambos', () => {
		const j = jornadaDelDia([m('08:00'), m('12:30'), m('14:00'), m('18:00')], F, 20 * 60);
		expect(j.enJornada).toBe(false);
		expect(j.minutos).toBe(270 + 240);
	});

	it('ignora una marca repetida a menos de 2 minutos y las de otro día', () => {
		const j = jornadaDelDia([m('08:00'), m('08:01'), m('09:00'), m('07:00', '2026-11-05')], F, 600);
		expect(j.tramos).toEqual([{ inicio: 480, fin: 540 }]);
		expect(j.minutos).toBe(60);
	});

	it('día pasado con ingreso sin salida (sin "ahora"): el tramo abierto no suma', () => {
		const j = jornadaDelDia([m('08:00'), m('12:00'), m('13:00')], F);
		expect(j.enJornada).toBe(true);
		expect(j.minutos).toBe(240);
	});
});
