import { describe, it, expect } from 'vitest';


import {
	calcularFila,
	jornadaMinutos,
	tarifas,
	lunesDe,
	motivoMarca,
	fraccionDia,
	textoDias,
	aprobacionDe,
	estaAprobado,
	proyectarFila,
	fraccionPrevista,
	periodoConsultoria,
	calcularFilaConsultoria,
	esCentroObra,
	cumpleAptitudes,
	proyectarConsultoria,
	type MarcaTareo,
	type AjusteTareo,
	type FeriadoTareo
} from './tareo.service';
import type { Horario } from '$lib/modules/personal/services/horarios.service';
import type { Personal } from '$lib/modules/personal/services/personal.service';

// L-V 07:30–17:00 con refrigerio 12–13 (8.5 h), sábado 07:30–13:00 (5.5 h): promedio 8 h 10 min.
const civil: Horario = {
	id_horario: 1,
	nombre: 'Civil',
	tolerancia_min: 10,
	tipo: 'fijo',
	estado: 'activo',
	horario_dia: [1, 2, 3, 4, 5]
		.map((dia) => ({ dia, hora_entrada: '07:30', hora_salida: '17:00', refrigerio_inicio: '12:00', refrigerio_fin: '13:00' }))
		.concat([{ dia: 6, hora_entrada: '07:30', hora_salida: '13:00', refrigerio_inicio: null as unknown as string, refrigerio_fin: null as unknown as string }])
};
const persona = (extra: Partial<Personal> = {}): Personal =>
	({ id_personal: 7, pin: '7', nombres: 'Juan', apellidos: 'Pérez', nombre: null, periodicidad_pago: 'semanal', monto_pago: 700, fecha_ingreso: null, fecha_cese: null, estado: 'activo', ...extra }) as Personal;
const m = (fecha: string, hora: string, modo = 1): MarcaTareo => {
	const [h, mi] = hora.split(':').map(Number);
	return { fecha, minuto: h * 60 + mi, huellero: 'Obra', modo, manual: false };
};
// 2026-11-02 es lunes.
const LUNES = '2026-11-02';

describe('tarifas', () => {
	it('jornada = promedio de los días del horario; sin horario 8 h', () => {
		expect(jornadaMinutos(civil)).toBe(Math.round((5 * 510 + 330) / 6));
		expect(jornadaMinutos(null)).toBe(480);
		expect(jornadaMinutos({ ...civil, tipo: 'libre', horario_dia: [] })).toBe(480);
	});
	it('S/ día sobre días calendario y S/ hora sobre la jornada', () => {
		expect(tarifas({ monto_pago: 700, periodicidad_pago: 'semanal' }, 480)).toEqual({ tarifaDia: 100, tarifaHora: 12.5 });
		expect(tarifas({ monto_pago: 3000, periodicidad_pago: 'mensual' }, 480).tarifaDia).toBe(100);
		expect(tarifas({ monto_pago: 1500, periodicidad_pago: 'quincenal' }, 480).tarifaDia).toBe(100);
		expect(tarifas({ monto_pago: 120, periodicidad_pago: 'diaria' }, 480).tarifaHora).toBe(15);
		expect(tarifas({ monto_pago: null, periodicidad_pago: 'diaria' }, 480).tarifaHora).toBe(0);
	});
	it('lunesDe', () => {
		expect(lunesDe('2026-11-08')).toBe(LUNES);
		expect(lunesDe(LUNES)).toBe(LUNES);
	});
});

describe('calcularFila', () => {
	const marcas = [
		m('2026-11-02', '07:30'), m('2026-11-02', '17:00'), // 8.5 h
		m('2026-11-03', '07:30', 15), m('2026-11-03', '17:00', 15), // rostro
		m('2026-11-04', '07:30') // sin salida
		// 05: falta
	];
	const sinHorario = calcularFila(persona(), null, [m('2026-11-02', '08:00'), m('2026-11-02', '16:00')], [], [], null, LUNES, '2026-11-09');

	it('pago por hora exacta: horas × (monto ÷ 7 ÷ jornada)', () => {
		expect(sinHorario.minutos).toBe(480);
		expect(sinHorario.tarifaHora).toBe(12.5);
		expect(sinHorario.subtotal).toBe(100); // 8 h de 8 h de jornada = 1 día × S/ 100
		expect(sinHorario.dias[0].origen).toBe('huella');
	});

	const fila = calcularFila(persona(), civil, marcas, [], [], { id_personal: 7, bonos: 50, total: 0, enviado: 30, fecha_cxp: '2026-11-09' }, LUNES, '2026-11-09');
	it('estados y origen por día', () => {
		expect(fila.dias.map((d) => d.estado)).toEqual(['asistio', 'asistio', 'pendiente', 'falta', 'falta', 'falta', 'descanso']);
		expect(fila.dias[1].origen).toBe('rostro');
		expect(fila.porRevisar).toBe(1);
		expect(fila.diasTrabajados).toBe(2);
	});
	it('total = días × S/ por día + bonos; pendiente descuenta lo enviado (ticket #132)', () => {
		// Dos días con 8.5 h (más de la mitad de la jornada) = 2 días completos.
		expect(fila.diasPagados).toBe(2);
		expect(fila.subtotal).toBeCloseTo(2 * fila.tarifaDia, 1);
		expect(fila.total).toBeCloseTo(fila.subtotal + 50, 2);
		expect(fila.pendiente).toBeCloseTo(fila.total - 30, 2);
		expect(fila.fechaCxp).toBe('2026-11-09');
	});

	it('el ajuste del residente reemplaza al huellero', () => {
		const ajuste: AjusteTareo = { id_personal: 7, fecha: '2026-11-04', estado: 'asistio', minutos_reconocidos: 240, observacion: 'Medio día', usuario: null };
		const f = calcularFila(persona(), civil, marcas, [ajuste], [], null, LUNES, '2026-11-09');
		expect(f.dias[2].estado).toBe('asistio');
		expect(f.dias[2].minutos).toBe(240);
		expect(f.dias[2].origen).toBe('modificado');
		expect(f.porRevisar).toBe(0);
	});

	it('feriado reconoce la jornada programada del día', () => {
		const feriado: FeriadoTareo = { id_feriado: 1, fecha: '2026-11-05', id_centro_costo: null, descripcion: 'Feriado' };
		const f = calcularFila(persona(), civil, marcas, [], [feriado], null, LUNES, '2026-11-09');
		expect(f.dias[3].estado).toBe('feriado');
		expect(f.dias[3].minutos).toBe(510);
		// Trabajador de otra obra: el feriado no le reconoce jornada aquí (lo hace el tareo de su obra).
		const otra = calcularFila(persona(), civil, marcas, [], [feriado], null, LUNES, '2026-11-09', false);
		expect(otra.dias[3].estado).toBe('falta');
		expect(otra.dias[3].minutos).toBe(0);
	});

	it('días futuros quedan por venir y fuera de contrato no se pagan', () => {
		const f = calcularFila(persona({ fecha_cese: '2026-11-04' }), civil, marcas, [], [], null, LUNES, '2026-11-09');
		expect(f.dias[4].estado).toBe('fuera_contrato');
		expect(f.dias[4].pago).toBe(0);
		const g = calcularFila(persona(), civil, marcas, [], [], null, LUNES, '2026-11-04');
		expect(g.dias[5].estado).toBe('por_venir');
	});
});

describe('motivoMarca (diagnóstico de marcas)', () => {
	const principal = new Set(['7']);
	const obra = (id: number) => (id === 139 ? 'BG-001 · CORPORATIVO' : `#${id}`);
	it('cuenta la marca del huellero de esta obra', () => {
		expect(motivoMarca({ evento: 3, id_centro_costo: 490, id_dispositivo: 1, pin: '7' }, 490, principal, obra).cuenta).toBe(true);
	});
	it('no cuenta la marca de un huellero asignado a otra obra y dice cuál', () => {
		const r = motivoMarca({ evento: 3, id_centro_costo: 139, id_dispositivo: 1, pin: '7' }, 490, principal, obra);
		expect(r.cuenta).toBe(false);
		expect(r.motivo).toContain('CORPORATIVO');
	});
	it('marca sin obra: cuenta solo en la obra principal', () => {
		expect(motivoMarca({ evento: null, id_centro_costo: null, id_dispositivo: 1, pin: '7' }, 490, principal, obra).cuenta).toBe(true);
		expect(motivoMarca({ evento: null, id_centro_costo: null, id_dispositivo: 1, pin: '9' }, 490, principal, obra).cuenta).toBe(false);
	});
	it('no cuenta una marca rechazada por el huellero', () => {
		expect(motivoMarca({ evento: 27, id_centro_costo: 490, id_dispositivo: 1, pin: '7' }, 490, principal, obra).cuenta).toBe(false);
	});
});

describe('fraccionDia (ticket #132: se paga por día o medio día)', () => {
	it('más de la mitad de la jornada = 1 día; hasta la mitad = ½; sin horas = 0', () => {
		expect(fraccionDia(0, 570)).toBe(0);
		expect(fraccionDia(285, 570)).toBe(0.5); // "Medio día" exacto
		expect(fraccionDia(286, 570)).toBe(1);
		expect(fraccionDia(628, 570)).toBe(1); // 10:28 h → 1 día (no S/ por hora)
		expect(fraccionDia(120, 0)).toBe(0.5); // sin jornada: 8 h por defecto
	});
	it('textoDias', () => {
		expect(textoDias(1)).toBe('1 día');
		expect(textoDias(0.5)).toBe('½ día');
		expect(textoDias(3.5)).toBe('3½ días');
		expect(textoDias(0)).toBe('0 días');
	});
});

describe('aprobación del jefe inmediato (tickets #118/#119)', () => {
	it('aprobado solo si el total no cambió; lo enviado antes vale como aprobado', () => {
		expect(aprobacionDe({ aprobadoMonto: null, enviado: 0 }, 500)).toBe('pendiente');
		expect(aprobacionDe({ aprobadoMonto: 500, enviado: 0 }, 500)).toBe('aprobado');
		expect(aprobacionDe({ aprobadoMonto: 500, enviado: 0 }, 550)).toBe('cambio');
		expect(aprobacionDe({ aprobadoMonto: null, enviado: 200 }, 500)).toBe('previo');
		expect(estaAprobado('cambio')).toBe(false);
		expect(estaAprobado('previo')).toBe(true);
	});
});

describe('proyección (ticket #118)', () => {
	// Lunes y martes registrados (hoy = martes 03/11); miércoles a sábado previstos según el horario civil.
	const marcas = [m('2026-11-02', '07:30'), m('2026-11-02', '17:00'), m('2026-11-03', '07:30'), m('2026-11-03', '17:00')];
	const f = calcularFila(persona(), civil, marcas, [], [], null, LUNES, '2026-11-03');
	const p = proyectarFila(f, '2026-11-03');
	it('acumulado = lo registrado; por completar = días previstos × S/ día', () => {
		expect(p.dias.filter((d) => d.registrado).length).toBe(2);
		expect(p.acumulado).toBeCloseTo(2 * f.tarifaDia, 2);
		// Mié–Vie día completo; sábado 5.5 h de jornada promedio 8:10 → más de la mitad = 1; domingo descanso.
		expect(p.diasPrevistos).toBe(4);
		expect(p.porCompletar).toBeCloseTo(4 * f.tarifaDia, 2);
	});
	it('día previsto: descanso = 0, sin horario lunes a sábado, fuera de contrato = 0', () => {
		expect(fraccionPrevista(persona(), civil, f.jornadaMin, '2026-11-08')).toBe(0);
		expect(fraccionPrevista(persona(), null, 480, '2026-11-07')).toBe(1);
		expect(fraccionPrevista(persona(), null, 480, '2026-11-08')).toBe(0);
		expect(fraccionPrevista(persona({ fecha_cese: '2026-11-04' }), null, 480, '2026-11-05')).toBe(0);
	});
});

describe('Consultoría (ticket #118)', () => {
	it('periodos: quincenas 1–15 y 16–fin de mes, o mes completo', () => {
		expect(periodoConsultoria('quincenal', '2026-11-10')).toEqual({ inicio: '2026-11-01', fin: '2026-11-15' });
		expect(periodoConsultoria('quincenal', '2026-11-20')).toEqual({ inicio: '2026-11-16', fin: '2026-11-30' });
		expect(periodoConsultoria('quincenal', '2026-02-16')).toEqual({ inicio: '2026-02-16', fin: '2026-02-28' });
		expect(periodoConsultoria('mensual', '2026-12-31')).toEqual({ inicio: '2026-12-01', fin: '2026-12-31' });
	});
	it('base del periodo menos las faltas × S/ día (ej. 2 500 quincenal con una falta = −166.67)', () => {
		// L-V 08:00–17:00 (sin sábado). Quincena 16–30/11/2026, hoy = 30/11: marca todos los días hábiles menos el 18.
		const lv: Horario = { ...civil, horario_dia: [1, 2, 3, 4, 5].map((dia) => ({ dia, hora_entrada: '08:00', hora_salida: '17:00', refrigerio_inicio: '12:00', refrigerio_fin: '13:00' })) };
		const habiles = ['2026-11-16', '2026-11-17', '2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-30'];
		const marcasQ = habiles.flatMap((d) => [m(d, '08:00'), m(d, '17:00')]);
		const pq = persona({ periodicidad_pago: 'quincenal', monto_pago: 2500 });
		const base = calcularFila(pq, lv, marcasQ, [], [], { id_personal: 7, bonos: 100, total: 0, enviado: 0, fecha_cxp: null }, '2026-11-16', '2026-11-30', true, 15);
		const c = calcularFilaConsultoria(base, 'quincenal', 5, 'Corporativo');
		expect(c.diasBase).toBe(15);
		expect(c.diasReconocidos).toBe(14);
		expect(c.ajuste).toBeCloseTo(-166.67, 2);
		expect(c.fila.total).toBeCloseTo(2500 - 166.67 + 100, 2);
		// Remoto: la falta sin marca no descuenta (solo los días editados como falta).
		const remoto = calcularFilaConsultoria({ ...base, personal: { ...pq, modalidad: 'remoto' } }, 'quincenal', 5, 'Corporativo');
		expect(remoto.diasReconocidos).toBe(15);
		expect(remoto.ajuste).toBe(0);
	});
	it('obra = proyecto que no es de consultoría', () => {
		expect(esCentroObra({ tipo: 'proyecto', proyecto: { tipo_venta: 'obra' } })).toBe(true);
		expect(esCentroObra({ tipo: 'proyecto', proyecto: null })).toBe(true);
		expect(esCentroObra({ tipo: 'proyecto', proyecto: [{ tipo_venta: 'consultoria' }] })).toBe(false);
		expect(esCentroObra({ tipo: 'bolsa general', proyecto: null })).toBe(false);
		expect(esCentroObra(null)).toBe(false);
	});
});

describe('requerimientos y proyección de Consultoría (ticket #118, 26/11/2026)', () => {
	it('cumple aptitudes sin importar tildes ni mayúsculas', () => {
		expect(cumpleAptitudes(['Tarrajeo', 'asentado de LADRILLOS'], ['Asentado de ladrillos', 'Tarrajeo'])).toEqual({ tiene: 2, total: 2, faltan: [] });
		expect(cumpleAptitudes(['Tarrajeo'], ['Habilitación de acero', 'tarrajeo'])).toEqual({ tiene: 1, total: 2, faltan: ['Habilitación de acero'] });
		expect(cumpleAptitudes(null, ['Habilitacion de acero'])).toEqual({ tiene: 0, total: 1, faltan: ['Habilitacion de acero'] });
	});
	it('proyección = sueldo completo: lo registrado hasta hoy + lo que falta hasta el cierre', () => {
		// Quincena 16–30/11/2026 con horario L-V, hoy = 20/11, marcó todos los días hábiles hasta hoy.
		const lv: Horario = { ...civil, horario_dia: [1, 2, 3, 4, 5].map((dia) => ({ dia, hora_entrada: '08:00', hora_salida: '17:00', refrigerio_inicio: '12:00', refrigerio_fin: '13:00' })) };
		const marcasQ = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'].flatMap((d) => [m(d, '08:00'), m(d, '17:00')]);
		const pq = persona({ periodicidad_pago: 'quincenal', monto_pago: 1500 });
		const base = calcularFila(pq, lv, marcasQ, [], [], null, '2026-11-16', '2026-11-20', true, 15);
		const c = calcularFilaConsultoria(base, 'quincenal', 5, 'Corporativo');
		const p = proyectarConsultoria(c, '2026-11-20');
		expect(p.diasRegistrados).toBe(5);
		expect(p.diasPrevistos).toBe(10);
		expect(p.acumulado).toBeCloseTo(500, 2);
		expect(p.acumulado + p.porCompletar).toBeCloseTo(1500, 2);
	});
});

describe('horas extra (ticket #117)', () => {
	// Martes 03/11: entra 07:30 y marca la salida 19:00 (su horario sale 17:00).
	const marcas = [m('2026-11-03', '07:30'), m('2026-11-03', '19:00')];
	it('salir tarde no suma horas: cuenta hasta su hora de salida', () => {
		const f = calcularFila(persona(), civil, marcas, [], [], null, LUNES, '2026-11-09');
		expect(f.dias[1].minutos).toBe(510); // 07:30–17:00 menos refrigerio
		expect(f.dias[1].extraHuellero).toBe(120);
		expect(f.extrasMonto).toBe(0);
	});
	it('las horas extra que registra el jefe se pagan por hora y suman al total', () => {
		const extra = { id_personal: 7, fecha: '2026-11-03', minutos: 120, observacion: 'Vaciado', registrado_por: 'Jefe' };
		const f = calcularFila(persona(), civil, marcas, [], [], null, LUNES, '2026-11-09', true, 7, [extra]);
		expect(f.extrasMin).toBe(120);
		expect(f.extrasMonto).toBeCloseTo(2 * f.tarifaHora, 2);
		expect(f.total).toBeCloseTo(f.subtotal + f.extrasMonto, 2);
		expect(f.dias[1].extra?.minutos).toBe(120);
	});
});
