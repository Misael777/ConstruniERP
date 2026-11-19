import { describe, it, expect } from 'vitest';
import { calcularAsistencia, resumirAsistencia, type Marca } from './asistencia.service';

// L-V 07:30–17:00 con refrigerio 12–13, sábado 07:30–13:00, tolerancia 10 min (como "Construcción civil (48 h)").
const civil = {
	tolerancia_min: 10,
	horario_dia: [1, 2, 3, 4, 5].map((dia) => ({ dia, hora_entrada: '07:30', hora_salida: '17:00', refrigerio_inicio: '12:00', refrigerio_fin: '13:00' }))
		.concat([{ dia: 6, hora_entrada: '07:30', hora_salida: '13:00', refrigerio_inicio: null as unknown as string, refrigerio_fin: null as unknown as string }])
};
const m = (fecha: string, hora: string): Marca => {
	const [h, mi] = hora.split(':').map(Number);
	return { fecha, minuto: h * 60 + mi, huellero: 'Obra' };
};
const sinContrato = { ingreso: null, cese: null };

// 2026-10-26 es lunes.
describe('calcularAsistencia', () => {
	const marcas = [
		m('2026-10-26', '07:25'), m('2026-10-26', '07:26'), m('2026-10-26', '17:00'), // puntual (07:26 repetida)
		m('2026-10-27', '07:38'), m('2026-10-27', '17:30'), // dentro de tolerancia, 30 min extra
		m('2026-10-28', '07:45'), m('2026-10-28', '16:30'), // tardanza 15, salió 30 antes
		m('2026-10-29', '07:30'), // sin salida
		// 30: falta
		m('2026-10-31', '07:30'), m('2026-10-31', '13:00'), // sábado
		m('2026-11-01', '08:00'), m('2026-11-01', '12:00') // domingo, descanso trabajado
	];
	const dias = calcularAsistencia(marcas, civil, '2026-10-26', '2026-11-01', '2026-11-02', sinContrato);
	const por = Object.fromEntries(dias.map((d) => [d.fecha, d]));

	it('marca puntual descontando refrigerio y la marca repetida', () => {
		expect(por['2026-10-26'].estado).toBe('puntual');
		expect(por['2026-10-26'].marcas).toHaveLength(2);
		expect(por['2026-10-26'].trabajados).toBe(9 * 60 + 35 - 60);
	});
	it('dentro de la tolerancia no es tardanza; extra después de la salida', () => {
		expect(por['2026-10-27'].estado).toBe('puntual');
		expect(por['2026-10-27'].extra).toBe(30);
	});
	it('tardanza contada desde la hora de entrada y salida anticipada', () => {
		expect(por['2026-10-28'].estado).toBe('tarde');
		expect(por['2026-10-28'].tardanza).toBe(15);
		expect(por['2026-10-28'].salidaAnticipada).toBe(30);
	});
	it('una sola marca en día pasado = sin marca de salida; sin marcas = falta', () => {
		expect(por['2026-10-29'].estado).toBe('incompleto');
		expect(por['2026-10-30'].estado).toBe('falta');
	});
	it('domingo sin horario con marcas = trabajó en descanso, todo es extra', () => {
		expect(por['2026-11-01'].estado).toBe('descanso_trabajado');
		expect(por['2026-11-01'].extra).toBe(240);
	});
	it('resumen del periodo', () => {
		const r = resumirAsistencia(dias);
		expect(r).toMatchObject({ laborables: 6, asistidos: 6, faltas: 1, tardanzas: 1, minutosTardanza: 15, incompletos: 1 });
	});
	it('4 marcas suman los tramos (salió al refrigerio)', () => {
		const [d] = calcularAsistencia([m('2026-10-26', '07:30'), m('2026-10-26', '12:00'), m('2026-10-26', '13:30'), m('2026-10-26', '17:00')], civil, '2026-10-26', '2026-10-26', '2026-11-02', sinContrato);
		expect(d.trabajados).toBe(270 + 210);
	});
	// Marca de más al llegar (07:30 y 07:40): no debe correr las demás (a pedido del usuario, 18/11/2026).
	const dia = (...horas: string[]) =>
		calcularAsistencia(horas.map((h) => m('2026-10-26', h)), civil, '2026-10-26', '2026-10-26', '2026-11-02', sinContrato)[0];
	it('07:30 y 07:40 solas: es la entrada repetida, el día queda sin salida (no "puntual" con 10 min)', () => {
		const d = dia('07:30', '07:40');
		expect(d.estado).toBe('incompleto');
		expect(d.salida).toBeNull();
		expect(d.trabajados).toBe(0);
	});
	it('07:30 y 07:40 hoy: sigue en jornada', () => {
		const [d] = calcularAsistencia([m('2026-10-26', '07:30'), m('2026-10-26', '07:40')], civil, '2026-10-26', '2026-10-26', '2026-10-26', sinContrato);
		expect(d.estado).toBe('en_curso');
	});
	it('07:30 · 07:40 · 12:00 · 17:00: refrigerio sin vuelta marcada → se descuenta el del horario', () => {
		expect(dia('07:30', '07:40', '12:00', '17:00').trabajados).toBe(8 * 60 + 30);
	});
	it('07:30 · 07:40 · 12:00 · 13:00 · 17:00: tramos reales', () => {
		expect(dia('07:30', '07:40', '12:00', '13:00', '17:00').trabajados).toBe(8 * 60 + 30);
	});
	it('07:30 · 07:40 · 12:00 · 13:00 (se fue sin marcar): salida 13:00 con salida anticipada', () => {
		const d = dia('07:30', '07:40', '12:00', '13:00');
		expect(d.salida).toBe(13 * 60);
		expect(d.trabajados).toBe(4 * 60 + 30);
		expect(d.salidaAnticipada).toBe(4 * 60);
	});
	it('salida repetida (16:58 y 17:05): vale la última', () => {
		const d = dia('07:30', '12:02', '12:58', '16:58', '17:05');
		expect(d.salida).toBe(17 * 60 + 5);
		expect(d.trabajados).toBe(4 * 60 + 32 + 4 * 60 + 7);
	});
	it('vuelta del refrigerio repetida (12:58 y 13:00): vale la primera', () => {
		expect(dia('07:28', '12:02', '12:58', '13:00', '17:05').trabajados).toBe(4 * 60 + 34 + 4 * 60 + 7);
	});
	it('3 marcas con la del medio en el refrigerio: se descuenta el del horario', () => {
		expect(dia('07:30', '12:00', '17:00').trabajados).toBe(8 * 60 + 30);
	});
	it('antes del ingreso no cuenta como falta', () => {
		const [d] = calcularAsistencia([], civil, '2026-10-26', '2026-10-26', '2026-11-02', { ingreso: '2026-10-27', cese: null });
		expect(d.estado).toBe('fuera_contrato');
		expect(resumirAsistencia([d]).laborables).toBe(0);
	});
	it('no pasa de hoy', () => {
		expect(calcularAsistencia([], civil, '2026-11-01', '2026-11-30', '2026-11-02', sinContrato)).toHaveLength(2);
	});
});

describe('calcularAsistencia con horario libre (por horas)', () => {
	const libre = { tolerancia_min: 0, tipo: 'libre' as const, horario_dia: [] };
	const marcas = [
		m('2026-10-26', '10:00'), m('2026-10-26', '13:00'), m('2026-10-26', '15:00'), m('2026-10-26', '18:30'), // 3 h + 3 h 30
		m('2026-10-27', '09:15'), m('2026-10-27', '09:16'), m('2026-10-27', '11:45'), // 2 h 30 (09:16 repetida)
		m('2026-10-28', '08:00'), m('2026-10-28', '12:00'), m('2026-10-28', '14:00'), // 4 h y la última sin salida
		m('2026-11-01', '07:00'), m('2026-11-01', '08:00') // domingo: cuenta igual, sin extra
	];
	const dias = calcularAsistencia(marcas, libre, '2026-10-26', '2026-11-02', '2026-11-02', sinContrato);
	const por = Object.fromEntries(dias.map((d) => [d.fecha, d]));

	it('suma los tramos entre marcas, sin tardanza ni extra', () => {
		expect(por['2026-10-26']).toMatchObject({ trabajados: 390, tardanza: 0, extra: 0, estado: 'asistio', entrada: 600, salida: 1110 });
		expect(por['2026-10-27']).toMatchObject({ trabajados: 150, estado: 'asistio' });
		expect(por['2026-11-01']).toMatchObject({ trabajados: 60, extra: 0, estado: 'asistio' });
	});
	it('marca sin pareja: cuenta los tramos completos y el día queda incompleto (hoy, en jornada)', () => {
		expect(por['2026-10-28']).toMatchObject({ trabajados: 240, salida: null, estado: 'incompleto' });
		const [hoy] = calcularAsistencia([m('2026-11-02', '08:00')], libre, '2026-11-02', '2026-11-02', '2026-11-02', sinContrato);
		expect(hoy.estado).toBe('en_curso');
	});
	it('día sin marcas no es falta y no hay días laborables', () => {
		expect(por['2026-10-29'].estado).toBe('sin_marcas');
		const r = resumirAsistencia(dias);
		expect(r).toMatchObject({ faltas: 0, laborables: 0, asistidos: 4, minutosTrabajados: 390 + 150 + 240 + 60 });
	});
});
