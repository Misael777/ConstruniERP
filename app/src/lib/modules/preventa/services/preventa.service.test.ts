import { describe, expect, it } from 'vitest';
import { indicadores, mejores, porVencer, proximaActividad, valorConIgv, valorPonderado, comisionAsesor, type ActividadOportunidad, type Oportunidad } from './preventa.service';

const HOY = '2026-11-28';
const op = (p: Partial<Oportunidad>): Oportunidad => ({
	id_oportunidad: 1, codigo: 'PV-2026-00001', id_cliente: null, prospecto: 'X', nombre: 'Obra', tipo: null, origen: null, id_ejecutivo: null,
	etapa: 'propuesta', prioridad: 'media', moneda: 'PEN', valor_sin_igv: 100000, con_igv: true, probabilidad: 50, fecha_registro: '2026-11-01',
	fecha_cierre: null, vigencia_propuesta: null, tipo_comprobante: null, comision_porcentaje: null, descripcion: null, notas: null,
	motivo_perdida: null, activo: true, usuario_registro: null, updated_at: '2026-11-20T10:00:00Z', ...p
});

describe('Pre-Venta (ticket #46)', () => {
	it('valor con IGV, ponderado y comisión (imagen: 850,000 → 1,003,000; 30 % → 300,900; 2 % → 17,000)', () => {
		const o = op({ valor_sin_igv: 850000, probabilidad: 30, comision_porcentaje: 2 });
		expect(valorConIgv(o)).toBe(1003000);
		expect(valorPonderado(o)).toBe(300900);
		expect(comisionAsesor(o)).toBe(17000);
	});
	it('indicadores del embudo', () => {
		const ops = [
			op({ id_oportunidad: 1, etapa: 'cotizacion' }),
			op({ id_oportunidad: 2, etapa: 'negociacion', con_igv: false }),
			op({ id_oportunidad: 3, etapa: 'adjudicada' }),
			op({ id_oportunidad: 4, etapa: 'perdida', updated_at: '2026-10-05T00:00:00Z' }),
			op({ id_oportunidad: 5, etapa: 'prospecto', activo: false })
		];
		const k = indicadores(ops, HOY);
		expect(k.activas).toBe(2);
		expect(k.valorPipeline).toBe(218000);
		expect(k.cotizacionesEnviadas).toBe(1);
		expect(k.enNegociacion).toBe(1);
		expect(k.ganadasMes).toBe(1);
		expect(k.perdidasMes).toBe(0);
		expect(k.tasaConversion).toBe(50);
		expect(k.porConfirmar).toBe(109000);
	});
	it('por vencer (7 días, incluye vencidas) y mejores por valor ponderado', () => {
		const ops = [
			op({ id_oportunidad: 1, fecha_cierre: '2026-12-02', probabilidad: 90 }),
			op({ id_oportunidad: 2, fecha_cierre: '2026-11-25' }),
			op({ id_oportunidad: 3, fecha_cierre: '2026-12-30', valor_sin_igv: 900000 }),
			op({ id_oportunidad: 4, fecha_cierre: '2026-11-30', etapa: 'adjudicada' })
		];
		expect(porVencer(ops, HOY).map((o) => [o.id_oportunidad, o.diasParaCierre])).toEqual([
			[2, -3],
			[1, 4]
		]);
		expect(mejores(ops, 2).map((o) => o.id_oportunidad)).toEqual([3, 1]);
	});
	it('próxima actividad pendiente por oportunidad', () => {
		const a = (id: number, idOp: number, fecha: string, completada = false): ActividadOportunidad => ({ id_actividad: id, id_oportunidad: idOp, tipo: 'llamada', titulo: 't', fecha_hora: fecha, enlace: null, lugar: null, notas: null, responsable: null, completada, usuario_registro: null });
		const m = proximaActividad([a(1, 1, '2026-12-05T10:00:00Z'), a(2, 1, '2026-12-01T10:00:00Z'), a(3, 1, '2026-11-29T10:00:00Z', true), a(4, 2, '2026-11-01T10:00:00Z')], '2026-11-28T00:00:00Z');
		expect(m.get(1)?.id_actividad).toBe(2);
		expect(m.has(2)).toBe(false);
	});
});
