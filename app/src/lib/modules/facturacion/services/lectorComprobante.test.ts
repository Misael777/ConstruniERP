import { describe, it, expect } from 'vitest';
import { extraerDatosDeTexto, camposReconocidos } from './lectorComprobante';

// Texto como lo linealiza Tesseract a partir de la factura de la imagen de referencia del usuario.
const FACTURA = `DISTRIBUIDORA EJEMPLO S.A.C. RUC: 20123456789
Av. Los Ejemplos 123 - Lima - Lima - Lima FACTURA ELECTRONICA
Telef: (01) 123-4567 F001-000245
Fecha de emisión : 20/05/2024
Señor(es) : EMPRESA DEMO S.A.C.
RUC : 20601234567
Dirección : Av. Principal 456 - Lima - Lima - Lima
CANT. DESCRIPCIÓN P. UNIT. TOTAL
2 Producto A 250.00 500.00
5 Producto B 80.00 400.00
1 Producto C 200.00 200.00
SUBTOTAL 1,100.00
IGV (18%) 198.00
TOTAL 1,298.00
SON: MIL DOSCIENTOS NOVENTA Y OCHO CON 00/100 SOLES`;

const BOLETA = `CASALLO & MELCHOR S.A.C.
R.U.C. N° 20609228343
BOLETA DE VENTA ELECTRONICA
B001 - 0000117
Fecha de Emisión: 03/09/2026
Cliente: JUAN PEREZ GOMEZ
DNI: 45678912
OP. GRAVADA S/ 847.46
I.G.V. S/ 152.54
IMPORTE TOTAL S/ 1,000.00`;

const NOTA_CREDITO = `CASALLO & MELCHOR S.A.C.
RUC 20609228343
NOTA DE CREDITO ELECTRONICA
FC01-00000012
Fecha de emisión 15/09/2026
Señor(es): CONSTRUCTORA ANDINA S.A.C.
RUC 20512345678
Documento que modifica: FACTURA F001-00000245
Motivo: Anulación de la operación
Op. Gravada 100.00
IGV 18.00
Importe Total 118.00`;

describe('extraerDatosDeTexto', () => {
	it('lee la factura de la imagen de referencia', () => {
		const d = extraerDatosDeTexto(FACTURA);
		expect(d.tipo).toBe('factura');
		expect(d.serie).toBe('F001');
		expect(d.numero).toBe('00000245');
		expect(d.fecha_emision).toBe('2024-05-20');
		expect(d.ruc_emisor).toBe('20123456789');
		expect(d.razon_social_emisor).toBe('DISTRIBUIDORA EJEMPLO S.A.C.');
		expect(d.doc_receptor).toBe('20601234567');
		expect(d.nombre_receptor).toBe('EMPRESA DEMO S.A.C.');
		expect(d.moneda).toBe('PEN');
		expect(d.subtotal).toBe(1100);
		expect(d.igv).toBe(198);
		// El total sale del bloque final, NO de la columna "TOTAL" del encabezado de la tabla (500.00).
		expect(d.total).toBe(1298);
		expect(camposReconocidos(d)).toEqual({ encontrados: 7, total: 7 });
	});

	it('lee una boleta a persona natural (DNI) con etiquetas abreviadas', () => {
		const d = extraerDatosDeTexto(BOLETA);
		expect(d.tipo).toBe('boleta');
		expect(d.serie).toBe('B001');
		expect(d.numero).toBe('00000117');
		expect(d.fecha_emision).toBe('2026-09-03');
		expect(d.ruc_emisor).toBe('20609228343');
		expect(d.razon_social_emisor).toBe('CASALLO & MELCHOR S.A.C.');
		expect(d.doc_receptor).toBe('45678912');
		expect(d.nombre_receptor).toBe('JUAN PEREZ GOMEZ');
		expect(d.subtotal).toBe(847.46);
		expect(d.igv).toBe(152.54);
		expect(d.total).toBe(1000);
	});

	it('distingue una nota de crédito y su comprobante de referencia', () => {
		const d = extraerDatosDeTexto(NOTA_CREDITO);
		// Aunque el texto también dice "FACTURA" (la que modifica), es una nota de crédito.
		expect(d.tipo).toBe('nota_credito');
		expect(d.serie).toBe('FC01');
		expect(d.numero).toBe('00000012');
		expect(d.serie_numero_referencia).toBe('F001-00000245');
		expect(d.ruc_emisor).toBe('20609228343');
		expect(d.doc_receptor).toBe('20512345678');
		expect(d.total).toBe(118);
		expect(d.igv).toBe(18);
	});

	it('tolera errores típicos del OCR (O por 0 en la serie, dígitos separados, dólares)', () => {
		const d = extraerDatosDeTexto(`FACTURA ELECTRONICA\nFOO1-245\nRUC 2060 9228 343\nTotal a pagar US$ 590.00\nIGV 90.00`);
		expect(d.serie).toBe('F001');
		expect(d.numero).toBe('00000245');
		expect(d.ruc_emisor).toBe('20609228343');
		expect(d.moneda).toBe('USD');
		expect(d.total).toBe(590);
		expect(d.subtotal).toBe(500); // total - IGV
	});

	it('devuelve todo vacío si no reconoce nada', () => {
		const d = extraerDatosDeTexto('texto sin datos de comprobante');
		expect(camposReconocidos(d).encontrados).toBe(0);
		expect(extraerDatosDeTexto('').tipo).toBeNull();
	});
});
