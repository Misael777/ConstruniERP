import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/supabaseClient', () => ({ supabase: {} }));

import { iconoCuentaPagar, subtituloPlanilla } from './cuentasPagar.service';

const francesca = { grupo: 'mensual', inicio: '2026-11-01', fin: '2026-11-30', personal: { nombres: 'Francesca', apellidos: 'Barbieri Bossio', foto_url: 'https://drive/f' } };
const obra = { grupo: 'semanal', inicio: '2026-11-30', fin: '2026-12-06', personal: null };

describe('subtituloPlanilla (listado de Cuentas por Pagar)', () => {
	it('planilla de una persona: el trabajador y el periodo', () => {
		expect(subtituloPlanilla([francesca])).toEqual({ quien: 'Barbieri Bossio, Francesca', periodo: '01/11–30/11/2026 (tareo)' });
	});
	it('planilla de obra: "Personal de obra" y el periodo', () => {
		expect(subtituloPlanilla([obra])).toEqual({ quien: 'Personal de obra', periodo: '30/11–06/12/2026 (tareo)' });
	});
	it('no es planilla: null', () => {
		expect(subtituloPlanilla([])).toBeNull();
		expect(subtituloPlanilla(null)).toBeNull();
	});
});

describe('iconoCuentaPagar', () => {
	it('planilla de una persona: su foto', () => {
		expect(iconoCuentaPagar({ planilla: [francesca] })).toEqual({ tipo: 'persona', imagen: 'https://drive/f' });
	});
	it('planilla de obra: la imagen del proyecto, o el casco', () => {
		expect(iconoCuentaPagar({ planilla: [obra], cc_imagen: { tipo: 'proyecto', proyecto: { imagen_url: 'https://drive/p' } } })).toEqual({ tipo: 'obra', imagen: 'https://drive/p' });
		expect(iconoCuentaPagar({ planilla: [obra], cc_imagen: { tipo: 'consultoria', proyecto: null } })).toEqual({ tipo: 'consultoria', imagen: null });
	});
	it('proveedor: su logo; préstamo: ícono de préstamo', () => {
		expect(iconoCuentaPagar({ planilla: [], proveedor: { razon_social: 'SODIMAC', logo_url: 'https://drive/s' } })).toEqual({ tipo: 'proveedor', imagen: 'https://drive/s' });
		expect(iconoCuentaPagar({ planilla: [], proveedor: { razon_social: 'X' } }, true)).toEqual({ tipo: 'prestamo', imagen: null });
	});
});

import { tiposVinculablesPorClase } from './cuentasPagar.service';

describe('tiposVinculablesPorClase (Vincular con cuenta por pagar)', () => {
	it('filtra según la Clase y la Categoría', () => {
		expect(tiposVinculablesPorClase('cliente', 'Devolución')).toEqual([]);
		expect(tiposVinculablesPorClase('proveedores', 'Compras')).toEqual(['proveedor']);
		expect(tiposVinculablesPorClase('subcontratista', 'Planilla')).toEqual(['planilla', 'subcontratista']);
		expect(tiposVinculablesPorClase('subcontratista', 'Otros')).toEqual(['subcontratista']);
		expect(tiposVinculablesPorClase('empleados', 'Honorarios')).toEqual(['planilla']);
		expect(tiposVinculablesPorClase('prestamo', 'Reembolso')).toEqual(['prestamo']);
		expect(tiposVinculablesPorClase('', null)).toBeNull();
		expect(tiposVinculablesPorClase('otro', 'Otros')).toBeNull();
	});
});
