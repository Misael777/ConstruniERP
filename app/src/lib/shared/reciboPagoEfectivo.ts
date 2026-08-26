/**
 * Genera el PDF "RECIBO DE PAGO" que se emite para un pago en Efectivo de una transacción Externa de
 * tipo Ingreso — a pedido explícito del usuario, replica el formato de su comprobante físico real (dos
 * copias por hoja: Original + Copia), con las firmas manuscritas del pagador y de quien recibe (ver
 * SignaturePad.svelte / ReciboPagoModal.svelte) incrustadas como imagen. Igual que
 * comprobanteTransferenciaInterna.ts, cada recuadro se dimensiona según el texto real que trae (nombre
 * de proyecto largo, concepto largo, etc.) en vez de una altura fija que podía desbordar el recuadro.
 * 100% cliente (jsPDF), sin backend — funciona igual en navegador, Tauri Windows y Android.
 */
import jsPDF from 'jspdf';
import { montoEnLetras } from './numeroALetras';
import { arrayBufferToBase64 } from './base64';
import { EMPRESA_NOMBRE, EMPRESA_RUC } from './empresaConstantes';
import { escribirLineas, alturaTexto } from './pdfTextoUtil';
import { formatearFechaCorta, formatearMonto } from './pdfFormatoUtil';

const MARGEN_IZQ = 15;
const MARGEN_DER = 195;
const MITAD = (MARGEN_IZQ + MARGEN_DER) / 2;

export interface DatosReciboPago {
	numero: number;
	fecha: string; // 'YYYY-MM-DD'
	proyectoCodigo: string;
	proyectoNombre: string;
	monto: number;
	concepto: string;
	clienteNombre: string;
	clienteDni: string;
	/** PNG en base64 (data URL completa, ver SignaturePad.svelte) */
	firmaClienteDataUrl: string;
	receptorNombre: string;
	receptorDni: string;
	/** PNG en base64 (data URL completa, ver SignaturePad.svelte) */
	firmaReceptorDataUrl: string;
}

/** Círculo numerado azul con texto blanco, mismo estilo que comprobanteTransferenciaInterna.ts — marca
 * el inicio de cada sección. */
function dibujarNumeroSeccion(doc: jsPDF, numero: number, x: number, y: number): void {
	doc.setFillColor(15, 59, 94);
	doc.circle(x, y - 1, 2.2, 'F');
	doc.setTextColor(255);
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(7);
	doc.text(String(numero), x, y - 0.3, { align: 'center' });
	doc.setTextColor(0);
}

/** Dibuja UNA copia del recibo (Original o Copia) empezando en `y0`. Devuelve el Y donde terminó (para
 * ubicar la segunda copia justo después, sin superponerse). */
function dibujarRecibo(doc: jsPDF, y0: number, esCopia: boolean, datos: DatosReciboPago): number {
	const numeroTexto = `N° ${String(datos.numero).padStart(7, '0')}`;
	const anchoCompleto = MARGEN_DER - MARGEN_IZQ;
	const anchoMedio = MITAD - MARGEN_IZQ - 6;

	// --- Encabezado ---
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(11);
	doc.text(EMPRESA_NOMBRE, MARGEN_IZQ, y0 + 6);
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(8);
	doc.text(`RUC: ${EMPRESA_RUC}`, MARGEN_IZQ, y0 + 11);

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(13);
	doc.text(numeroTexto, MARGEN_DER, y0 + 6, { align: 'right' });
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(8);
	doc.text(`${esCopia ? 'COPIA - ' : ''}RECIBO DE PAGO`, MARGEN_DER, y0 + 11, { align: 'right' });
	doc.text(`Fecha: ${formatearFechaCorta(datos.fecha)}`, MARGEN_DER, y0 + 15, { align: 'right' });
	doc.text('Página: 1 de 1', MARGEN_DER, y0 + 19, { align: 'right' });

	doc.setDrawColor(180);
	doc.line(MARGEN_IZQ, y0 + 22, MARGEN_DER, y0 + 22);

	// --- Intro ---
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(9);
	const introAltura = escribirLineas(
		doc,
		`Yo, ${datos.clienteNombre}, identificado con RUC/DNI ${datos.clienteDni}, dejo constancia de haber pagado a favor de ${EMPRESA_NOMBRE} con RUC ${EMPRESA_RUC}, el importe que se detalla a continuación:`,
		MARGEN_IZQ,
		y0 + 28,
		anchoCompleto
	);

	// --- Sección 1: Por concepto de ---
	let y = y0 + 29 + introAltura;
	dibujarNumeroSeccion(doc, 1, MARGEN_IZQ + 2, y);
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(9);
	doc.text('POR CONCEPTO DE', MARGEN_IZQ + 6, y);
	y += 3;

	const alturaProyecto = alturaTexto(doc, datos.proyectoNombre, anchoCompleto - 6);
	const altoSeccion1 = 6 + alturaProyecto + 6;
	doc.setDrawColor(120);
	doc.rect(MARGEN_IZQ, y, anchoCompleto, altoSeccion1);
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(10);
	const alturaNombreProyecto = escribirLineas(doc, datos.proyectoNombre, MARGEN_IZQ + 3, y + 6, anchoCompleto - 6);
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(7.5);
	doc.setTextColor(120);
	doc.text(`Código: ${datos.proyectoCodigo}`, MARGEN_IZQ + 3, y + 6 + alturaNombreProyecto + 2);
	doc.setTextColor(0);

	// --- Sección 2: Importe y concepto ---
	y += altoSeccion1 + 6;
	dibujarNumeroSeccion(doc, 2, MARGEN_IZQ + 2, y);
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(9);
	doc.text('IMPORTE Y CONCEPTO', MARGEN_IZQ + 6, y);
	y += 3;

	const alturaLetras = alturaTexto(doc, `(${montoEnLetras(datos.monto)})`, anchoMedio);
	const alturaImporte = 11 + alturaLetras;
	const alturaConcepto = 5 + alturaTexto(doc, datos.concepto, MARGEN_DER - MITAD - 6);
	const altoSeccion2 = Math.max(alturaImporte, alturaConcepto) + 3;
	doc.rect(MARGEN_IZQ, y, anchoCompleto, altoSeccion2);
	doc.line(MITAD, y, MITAD, y + altoSeccion2);

	doc.setFont('helvetica', 'normal');
	doc.setFontSize(7);
	doc.setTextColor(120);
	doc.text('IMPORTE (S/)', MARGEN_IZQ + 3, y + 5);
	doc.text('CONCEPTO', MITAD + 3, y + 5);
	doc.setTextColor(0);
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(12);
	doc.text(formatearMonto(datos.monto), MARGEN_IZQ + 3, y + 11);
	doc.setFont('helvetica', 'italic');
	doc.setFontSize(6.5);
	escribirLineas(doc, `(${montoEnLetras(datos.monto)})`, MARGEN_IZQ + 3, y + 15, anchoMedio);
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(8);
	escribirLineas(doc, datos.concepto, MITAD + 3, y + 10, MARGEN_DER - MITAD - 6);

	// --- Sección 3: Forma de pago ---
	y += altoSeccion2 + 6;
	dibujarNumeroSeccion(doc, 3, MARGEN_IZQ + 2, y);
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(9);
	doc.text('FORMA DE PAGO', MARGEN_IZQ + 6, y);
	y += 3;

	const textoFormaPago = 'El pago se realizó en efectivo por la suma indicada en el presente recibo.';
	const alturaTextoFormaPago = alturaTexto(doc, textoFormaPago, anchoCompleto - 6);
	const altoSeccion3 = 6 + alturaTextoFormaPago + 3;
	doc.rect(MARGEN_IZQ, y, anchoCompleto, altoSeccion3);
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(9);
	doc.text('EFECTIVO', MARGEN_IZQ + 3, y + 5);
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(7.5);
	doc.setTextColor(120);
	escribirLineas(doc, textoFormaPago, MARGEN_IZQ + 3, y + 10, anchoCompleto - 6);
	doc.setTextColor(0);

	// --- Sección 4: Detalle del recibo ---
	y += altoSeccion3 + 6;
	dibujarNumeroSeccion(doc, 4, MARGEN_IZQ + 2, y);
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(9);
	doc.text('DETALLE DEL RECIBO', MARGEN_IZQ + 6, y);
	y += 3;

	// 4a: N° de recibo / Fecha de emisión (fila corta, valores siempre cortos, sin necesidad de altura
	// dinámica).
	const altoDatos = 12;
	doc.rect(MARGEN_IZQ, y, anchoCompleto, altoDatos);
	doc.line(MITAD, y, MITAD, y + altoDatos);
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(7);
	doc.setTextColor(120);
	doc.text('N° DE RECIBO', MARGEN_IZQ + 3, y + 5);
	doc.text('FECHA DE EMISIÓN', MITAD + 3, y + 5);
	doc.setTextColor(0);
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(10);
	doc.text(String(datos.numero).padStart(7, '0'), MARGEN_IZQ + 3, y + 10);
	doc.text(formatearFechaCorta(datos.fecha), MITAD + 3, y + 10);

	// 4b: Firmas — imagen (PNG del canvas) + nombre/documento debajo, dos columnas.
	y += altoDatos + 4;
	const anchoFirma = 34;
	const altoFirma = 12;
	const nombreClienteAltura = alturaTexto(doc, datos.clienteNombre, anchoMedio);
	const nombreReceptorAltura = alturaTexto(doc, datos.receptorNombre, anchoMedio);
	const altoSeccion4b = 5 + altoFirma + 3 + Math.max(nombreClienteAltura, nombreReceptorAltura) + 7;
	doc.rect(MARGEN_IZQ, y, anchoCompleto, altoSeccion4b);
	doc.line(MITAD, y, MITAD, y + altoSeccion4b);

	doc.setFont('helvetica', 'normal');
	doc.setFontSize(7);
	doc.setTextColor(120);
	doc.text('FIRMA DIGITAL DEL CLIENTE', MARGEN_IZQ + 3, y + 5);
	doc.text('FIRMA DE QUIEN RECIBE', MITAD + 3, y + 5);
	doc.setTextColor(0);

	if (datos.firmaClienteDataUrl) {
		try {
			doc.addImage(datos.firmaClienteDataUrl, 'PNG', MARGEN_IZQ + 3, y + 7, anchoFirma, altoFirma);
		} catch {
			/* si el data URL no es una imagen válida, se deja el espacio en blanco — mejor esfuerzo */
		}
	}
	if (datos.firmaReceptorDataUrl) {
		try {
			doc.addImage(datos.firmaReceptorDataUrl, 'PNG', MITAD + 3, y + 7, anchoFirma, altoFirma);
		} catch {
			/* ídem */
		}
	}

	let yFirmaTexto = y + 7 + altoFirma + 3;
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(8);
	const hCliente = escribirLineas(doc, datos.clienteNombre, MARGEN_IZQ + 3, yFirmaTexto, anchoMedio);
	const hReceptor = escribirLineas(doc, datos.receptorNombre, MITAD + 3, yFirmaTexto, anchoMedio);
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(7);
	doc.setTextColor(120);
	const yDniLinea = yFirmaTexto + Math.max(hCliente, hReceptor) + 3;
	doc.text(`RUC/DNI: ${datos.clienteDni}`, MARGEN_IZQ + 3, yDniLinea);
	doc.text(`DNI: ${datos.receptorDni}`, MITAD + 3, yDniLinea);
	doc.setTextColor(0);

	// --- Pie ---
	y += altoSeccion4b + 8;
	doc.setDrawColor(180);
	doc.line(MARGEN_IZQ, y, MARGEN_DER, y);

	return y;
}

/** Arma el PDF completo (Original + Copia en una sola hoja) y lo devuelve en base64, listo para
 * guardarArchivoBinario. La segunda copia empieza justo después de donde terminó la primera. */
export function generarReciboPagoBase64(datos: DatosReciboPago): string {
	const doc = new jsPDF();
	const finPrimera = dibujarRecibo(doc, 10, false, datos);

	const ySeparador = finPrimera + 4;
	doc.setDrawColor(150);
	doc.setLineDashPattern([1.5, 1.5], 0);
	doc.line(MARGEN_IZQ, ySeparador, MARGEN_DER, ySeparador);
	doc.setLineDashPattern([], 0);

	dibujarRecibo(doc, ySeparador + 6, true, datos);

	return arrayBufferToBase64(doc.output('arraybuffer'));
}
