import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/supabaseClient', () => ({ supabase: {} }));

import { diaPlanTarea, pestanaTarea, type AlertaTarea, type EstadoTarea } from './alertas.service';

const HOY = '2026-11-27';
const alerta = (fecha: string): AlertaTarea => ({ id: 'cxc-1', modulo: 'finanzas', titulo: 'x', fecha, prioridad: 'alta', responsable: null, registradoPor: null, href: '/' });
const aplazada = (hasta: string, fecha_alerta: string | null): EstadoTarea => ({ id_alerta: 'cxc-1', estado: 'aplazada', aplazada_hasta: hasta, fecha_alerta });

describe('diaPlanTarea (calendario de tareas)', () => {
	it('lo vencido va en hoy', () => {
		expect(diaPlanTarea(alerta('2024-05-01'), undefined, HOY)).toBe(HOY);
	});
	it('lo que vence después va en su fecha', () => {
		expect(diaPlanTarea(alerta('2026-12-03'), undefined, HOY)).toBe('2026-12-03');
	});
	it('movida a otro día: va en ese día y queda en Aplazadas', () => {
		const a = alerta('2024-05-01');
		const e = aplazada('2026-12-02', a.fecha);
		expect(diaPlanTarea(a, e, HOY)).toBe('2026-12-02');
		expect(pestanaTarea(a, e, HOY)).toBe('aplazada');
	});
	it('movida a hoy: va en hoy y sigue en la pestaña Hoy', () => {
		const a = alerta('2026-12-03');
		const e = aplazada(HOY, a.fecha);
		expect(diaPlanTarea(a, e, HOY)).toBe(HOY);
		expect(pestanaTarea(a, e, HOY)).toBe('hoy');
	});
	it('si el día al que se movió ya pasó, vuelve a hoy', () => {
		const a = alerta('2024-05-01');
		expect(diaPlanTarea(a, aplazada('2026-11-20', a.fecha), HOY)).toBe(HOY);
	});
	it('si la alerta cambió de fecha (otra cuota), se ignora el día guardado', () => {
		expect(diaPlanTarea(alerta('2026-12-05'), aplazada('2026-12-01', '2026-11-01'), HOY)).toBe('2026-12-05');
	});
});
