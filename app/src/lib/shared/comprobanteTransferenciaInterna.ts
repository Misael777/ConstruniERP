/**
 * Genera el PDF "RECIBO - TRANSFERENCIA INTERNA" que se emite al crear/editar una transacción con
 * Alcance=Interna — a pedido explícito del usuario, replica el formato de su comprobante físico real
 * (dos copias por hoja: Original + Copia). Los recuadros se dimensionan según el texto real que traen
 * (código de proyecto largo, concepto largo, etc. — a pedido explícito del usuario, "que la data quede
 * encuadrada dentro de los espacios del formato", en vez de una altura fija que podía desbordar el
 * recuadro). 100% cliente (jsPDF), sin backend — funciona igual en navegador, Tauri Windows y Android.
 */
import jsPDF from 'jspdf';
import { montoEnLetras } from './numeroALetras';
import { arrayBufferToBase64 } from './base64';
import { EMPRESA_NOMBRE, EMPRESA_RUC } from './empresaConstantes';
import { escribirLineas, alturaTexto } from './pdfTextoUtil';
import { formatearFechaLarga, formatearFechaCorta, formatearMonto } from './pdfFormatoUtil';

// A pedido explícito del usuario: Cuenta Origen/Destino son fijas para TODA transferencia interna, no
// dependen del Centro de Costo — no hay ningún catálogo contable real en el sistema todavía.
const CUENTA_ORIGEN = { codigo: '9102.01', nombre: 'Costos Indirectos de Obra' };
const CUENTA_DESTINO = { codigo: '9102.02', nombre: 'Costos Directos de Obra' };

const MARGEN_IZQ = 15;
const MARGEN_DER = 195;
const MITAD = (MARGEN_IZQ + MARGEN_DER) / 2;

export interface DatosComprobanteInterno {
	numero: number;
	fecha: string; // 'YYYY-MM-DD'
	origenCodigo: string;
	origenNombre: string;
	destinoCodigo: string;
	destinoNombre: string;
	monto: number;
	concepto: string;
	usuario: string;
}

/** Flecha "origen → destino" dibujada con vectores, centrada en (cx, cy) — reemplaza al carácter "→"
 * que el font base14 de jsPDF no renderiza bien. Se mantiene angosta (el hueco entre la línea divisoria
 * de columnas y el texto "código..." de la columna derecha es de apenas ~3mm) para no pisar el texto. */
function dibujarFlecha(doc: jsPDF, cx: number, cy: number): void {
	doc.setDrawColor(15, 59, 94);
	doc.setFillColor(15, 59, 94);
	doc.setLineWidth(0.5);
	doc.line(cx - 1.8, cy, cx + 0.7, cy);
	doc.triangle(cx + 0.2, cy - 1.2, cx + 0.2, cy + 1.2, cx + 1.7, cy, 'F');
	doc.setLineWidth(0.2);
}

/** Dibuja UNA copia del comprobante (Original o Copia) empezando en `y0`. Devuelve el Y donde terminó
 * (para poder ubicar la segunda copia justo después, sin superponerse ni dejar un hueco enorme). */
function dibujarVoucher(doc: jsPDF, y0: number, esCopia: boolean, datos: DatosComprobanteInterno): number {
	const numeroTexto = `N° ${String(datos.numero).padStart(4, '0')}`;
	const anchoMedio = MITAD - MARGEN_IZQ - 6;
	const anchoCompleto = MARGEN_DER - MARGEN_IZQ;

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
	doc.text(`${esCopia ? 'COPIA - ' : ''}RECIBO - TRANSFERENCIA INTERNA`, MARGEN_DER, y0 + 11, { align: 'right' });
	doc.text(`Fecha: ${formatearFechaCorta(datos.fecha)}`, MARGEN_DER, y0 + 15, { align: 'right' });
	doc.text('Página: 1 de 1', MARGEN_DER, y0 + 19, { align: 'right' });

	doc.setDrawColor(180);
	doc.line(MARGEN_IZQ, y0 + 22, MARGEN_DER, y0 + 22);

	// --- Intro ---
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(9);
	const introAltura = escribirLineas(
		doc,
		`Con fecha ${formatearFechaLarga(datos.fecha)} se realizó la siguiente transferencia entre centros de costos:`,
		MARGEN_IZQ,
		y0 + 28,
		anchoCompleto
	);

	// --- Sección 1: Desde y hacia ---
	let y = y0 + 29 + introAltura;
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(9);
	doc.setFillColor(15, 59, 94);
	doc.circle(MARGEN_IZQ + 2, y - 1, 2.2, 'F');
	doc.setTextColor(255);
	doc.setFontSize(7);
	doc.text('1', MARGEN_IZQ + 2, y - 0.3, { align: 'center' });
	doc.setTextColor(0);
	doc.setFontSize(9);
	doc.text('DESDE Y HACIA', MARGEN_IZQ + 6, y);
	y += 3;

	const alturaNombresSeccion1 = Math.max(alturaTexto(doc, datos.origenNombre, anchoMedio), alturaTexto(doc, datos.destinoNombre, anchoMedio));
	const altoSeccion1 = 10 + alturaNombresSeccion1 + 3;
	doc.setDrawColor(120);
	doc.rect(MARGEN_IZQ, y, anchoCompleto, altoSeccion1);
	doc.line(MITAD, y, MITAD, y + altoSeccion1);

	doc.setFont('helvetica', 'normal');
	doc.setFontSize(7);
	doc.setTextColor(120);
	doc.text('DESDE (CENTRO DE COSTO ORIGEN)', MARGEN_IZQ + 3, y + 5);
	doc.text('HACIA (CENTRO DE COSTO DESTINO)', MITAD + 3, y + 5);
	doc.setTextColor(0);
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(10);
	doc.text(datos.origenCodigo, MARGEN_IZQ + 3, y + 10);
	doc.text(datos.destinoCodigo, MITAD + 3, y + 10);
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(8);
	escribirLineas(doc, datos.origenNombre, MARGEN_IZQ + 3, y + 14, anchoMedio);
	escribirLineas(doc, datos.destinoNombre, MITAD + 3, y + 14, anchoMedio);
	// jsPDF's base14 Helvetica no soporta el glifo Unicode "→" (se veía como un carácter roto) — se
	// dibuja el flechazo a mano con vectores en su lugar.
	dibujarFlecha(doc, MITAD, y + 8.5);

	// --- Sección 2: Importe y concepto ---
	y += altoSeccion1 + 6;
	doc.setFillColor(15, 59, 94);
	doc.circle(MARGEN_IZQ + 2, y - 1, 2.2, 'F');
	doc.setTextColor(255);
	doc.setFontSize(7);
	doc.text('2', MARGEN_IZQ + 2, y - 0.3, { align: 'center' });
	doc.setTextColor(0);
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

	// --- Sección 3: Cuentas contables ---
	y += altoSeccion2 + 6;
	doc.setFillColor(15, 59, 94);
	doc.circle(MARGEN_IZQ + 2, y - 1, 2.2, 'F');
	doc.setTextColor(255);
	doc.setFontSize(7);
	doc.text('3', MARGEN_IZQ + 2, y - 0.3, { align: 'center' });
	doc.setTextColor(0);
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(9);
	doc.text('CUENTAS CONTABLES', MARGEN_IZQ + 6, y);
	y += 3;

	const altoSeccion3 = 10 + Math.max(alturaTexto(doc, CUENTA_ORIGEN.nombre, anchoMedio - 22), alturaTexto(doc, CUENTA_DESTINO.nombre, anchoMedio - 22));
	doc.rect(MARGEN_IZQ, y, anchoCompleto, altoSeccion3);
	doc.line(MITAD, y, MITAD, y + altoSeccion3);

	doc.setFont('helvetica', 'normal');
	doc.setFontSize(7);
	doc.setTextColor(120);
	doc.text('CUENTA ORIGEN', MARGEN_IZQ + 3, y + 5);
	doc.text('CUENTA DESTINO', MITAD + 3, y + 5);
	doc.setTextColor(0);
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(9);
	doc.text(CUENTA_ORIGEN.codigo, MARGEN_IZQ + 3, y + 10);
	doc.text(CUENTA_DESTINO.codigo, MITAD + 3, y + 10);
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(7.5);
	escribirLineas(doc, CUENTA_ORIGEN.nombre, MARGEN_IZQ + 25, y + 10, anchoMedio - 22);
	escribirLineas(doc, CUENTA_DESTINO.nombre, MITAD + 25, y + 10, anchoMedio - 22);

	// --- Pie: registrado por ---
	y += altoSeccion3 + 8;
	doc.setDrawColor(180);
	doc.line(MARGEN_IZQ, y, MARGEN_DER, y);
	y += 5;
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(7.5);
	doc.text('TRANSACCIÓN REGISTRADA POR', MARGEN_IZQ, y);
	doc.setFont('helvetica', 'normal');
	doc.text(`Usuario: ${datos.usuario}`, MARGEN_IZQ, y + 4);
	doc.text(`Fecha y hora: ${new Date().toLocaleString('es-PE')}`, MARGEN_IZQ, y + 8);

	return y + 8;
}

/** Arma el PDF completo (Original + Copia en una sola hoja) y lo devuelve en base64, listo para
 * guardarArchivoBinario (mismo helper multiplataforma que ya usan las exportaciones y R1/R2). La
 * segunda copia empieza justo después de donde terminó la primera (más un margen fijo), no en un Y fijo
 * — así un concepto/nombre largo que agranda la primera copia nunca se superpone con la segunda. */
export function generarComprobanteTransferenciaInternaBase64(datos: DatosComprobanteInterno): string {
	const doc = new jsPDF();
	const finPrimera = dibujarVoucher(doc, 10, false, datos);

	const ySeparador = finPrimera + 6;
	doc.setDrawColor(150);
	doc.setLineDashPattern([1.5, 1.5], 0);
	doc.line(MARGEN_IZQ, ySeparador, MARGEN_DER, ySeparador);
	doc.setLineDashPattern([], 0);

	dibujarVoucher(doc, ySeparador + 6, true, datos);

	return arrayBufferToBase64(doc.output('arraybuffer'));
}
