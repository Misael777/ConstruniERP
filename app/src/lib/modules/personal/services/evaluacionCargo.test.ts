import { describe, expect, it } from 'vitest';
import {
	APTITUDES_GERENCIALES,
	calificacionFinal,
	cumplimientoObjetivo,
	cumplimientoRendimiento,
	formatoSugerido,
	subtotalCriterios,
	subtotalObjetivos,
	validacionAutomatica,
	type CriterioEvaluado
} from './evaluacionCargo';

describe('evaluación de cargo (ticket #152)', () => {
	it('obrero: cumplimiento = real / esperado (imagen: 11/12 = 92 %, 15/20 = 75 %, 4/8 = 50 %)', () => {
		expect(cumplimientoRendimiento({ esperado: 12, real: 11 })).toBe(92);
		expect(cumplimientoRendimiento({ esperado: 20, real: 15 })).toBe(75);
		expect(cumplimientoRendimiento({ esperado: 8, real: 4 })).toBe(50);
		expect(cumplimientoRendimiento({ esperado: 0, real: 4 })).toBeNull();
	});
	it('validación automática: 92 validado, 75 observado, 50 no calificado', () => {
		expect(validacionAutomatica(92)).toBe('validado');
		expect(validacionAutomatica(75)).toBe('observado');
		expect(validacionAutomatica(50)).toBe('no_calificado');
	});
	it('consultoría: desempeño ponderado (imagen: 85 %)', () => {
		const criterios: CriterioEvaluado[] = [
			{ criterio: 'Calidad técnica', peso: 30, nota: 5 },
			{ criterio: 'Cumplimiento de plazos', peso: 25, nota: 4 },
			{ criterio: 'Autonomía', peso: 20, nota: 4 },
			{ criterio: 'Coordinación', peso: 15, nota: 3 },
			{ criterio: 'Organización', peso: 10, nota: 5 }
		];
		expect(subtotalCriterios(criterios)).toEqual({ pesoTotal: 100, subtotal: 85 });
	});
	it('gerencial: 89 % aptitudes × 40 % + 92 % objetivos × 60 % = 90.8 % (imagen)', () => {
		const notas = [5, 4, 5, 4, 4, 4];
		const criterios = APTITUDES_GERENCIALES.map((c, i) => ({ ...c, nota: notas[i] }));
		expect(subtotalCriterios(criterios).subtotal).toBe(89);
		const objetivos = [
			{ indicador: 'Facturación', unidad: 'S/', meta: 500000, real: 475000 },
			{ indicador: 'Margen', unidad: '%', meta: 15, real: 12 },
			{ indicador: 'Plan', unidad: '%', meta: 100, real: 90 },
			{ indicador: 'Metas', unidad: '%', meta: 100, real: 95 },
			{ indicador: 'Cobranza', unidad: '%', meta: 95, real: 95 }
		];
		expect(cumplimientoObjetivo(objetivos[1])).toBe(80);
		expect(subtotalObjetivos(objetivos)).toBe(92);
		expect(calificacionFinal({ formato: 'gerencial', aptitudes: [], criterios, objetivos, peso_aptitudes: 40 })).toBe(90.8);
	});
	it('formato sugerido según el cargo', () => {
		expect(formatoSugerido('Gerente de operaciones')).toBe('gerencial');
		expect(formatoSugerido('Operario albañil')).toBe('obrero');
		expect(formatoSugerido('Arquitecto proyectista')).toBe('consultoria');
		expect(formatoSugerido('Arquitecto', { esObra: true })).toBe('obrero');
	});
});
