import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/supabaseClient', () => ({ supabase: {} }));

import { subtituloPlanilla } from './cuentasPagar.service';

describe('subtituloPlanilla (listado de Cuentas por Pagar)', () => {
	it('planilla de una persona: muestra al trabajador y el periodo', () => {
		expect(
			subtituloPlanilla([{ grupo: 'mensual', inicio: '2026-11-01', fin: '2026-11-30', personal: { nombres: 'Francesca', apellidos: 'Barbieri Bossio' } }])
		).toBe('Barbieri Bossio, Francesca · Planilla mensual 01/11–30/11');
	});
	it('planilla de obra: muestra el periodo', () => {
		expect(subtituloPlanilla([{ grupo: 'semanal', inicio: '2026-11-30', fin: '2026-12-06', personal: null }])).toBe('Planilla semanal 30/11–06/12');
	});
	it('no es planilla: null', () => {
		expect(subtituloPlanilla([])).toBeNull();
		expect(subtituloPlanilla(null)).toBeNull();
	});
});
