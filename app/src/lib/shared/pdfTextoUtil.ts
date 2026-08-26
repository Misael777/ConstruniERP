/**
 * Helpers de texto envuelto (wrap) para jsPDF, compartidos por todos los comprobantes/recibos
 * autogenerados (comprobanteTransferenciaInterna.ts, reciboPagoEfectivo.ts) — miden la altura REAL que
 * ocupa un texto ya envuelto ANTES de dibujar cada recuadro, para poder dimensionarlo dinámicamente en
 * vez de una altura fija que un texto largo podía desbordar.
 */
import type jsPDF from 'jspdf';

export const LINE_H = 3.4;

/** Escribe texto ya partido en líneas y devuelve cuántos mm ocupó verticalmente. */
export function escribirLineas(doc: jsPDF, texto: string, x: number, y: number, maxWidth: number): number {
	const lineas: string[] = doc.splitTextToSize(texto || '—', maxWidth);
	doc.text(lineas, x, y);
	return lineas.length * LINE_H;
}

/** Mide en mm cuánto ocuparía un texto SIN dibujarlo — para calcular la altura de un recuadro antes de
 * trazar su borde. */
export function alturaTexto(doc: jsPDF, texto: string, maxWidth: number): number {
	const lineas: string[] = doc.splitTextToSize(texto || '—', maxWidth);
	return lineas.length * LINE_H;
}
