/**
 * Genera el PDF "RECIBO - TRANSFERENCIA INTERNA" que se emite al crear/editar una transacción con
 * Alcance=Interna — a pedido explícito del usuario, replica el formato de su comprobante físico real
 * (dos copias por hoja: Original + Copia). A diferencia de la versión anterior (dibujada a mano con las
 * primitivas de jsPDF: rect/line/text), esto arma el recibo como una plantilla HTML/CSS normal (bordes
 * redondeados, colores, tipografía) y la convierte a imagen con html2canvas antes de incrustarla en el
 * PDF — a pedido explícito del usuario, para lograr un acabado más prolijo sin pelear con las
 * primitivas de dibujo vectorial de jsPDF. El ancho/alto de cada recuadro los resuelve el propio motor
 * de layout del navegador (flexbox), no cálculos manuales de línea — por eso un nombre de proyecto o
 * concepto largo simplemente se envuelve y agranda su recuadro solo, sin desbordar. 100% cliente, sin
 * backend — funciona igual en navegador, Tauri Windows y Tauri Android.
 */
import jsPDF from 'jspdf';
import { montoEnLetras } from './numeroALetras';
import { arrayBufferToBase64 } from './base64';
import { EMPRESA_NOMBRE, EMPRESA_RUC } from './empresaConstantes';
import { formatearFechaLarga, formatearFechaCorta, formatearMonto } from './pdfFormatoUtil';
import { renderHtmlToPngDataUrl } from './pdfHtmlRender';
import { ESTILOS_VOUCHER_BASE, ICONO_BRUJULA, escapeHtml } from './pdfVoucherEstilos';

const ANCHO_PLANTILLA_PX = 750;
const ANCHO_PAGINA_MM = 190; // ancho de contenido en el PDF (A4 210mm con 10mm de margen a cada lado)
const MARGEN_PAGINA_MM = 10;

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
	/** Cuenta bancaria propia desde la que sale el dinero (label, ej. "BCP SOLES - 192 4713256045") —
	 * a pedido explícito del usuario, con imagen de referencia: reemplaza la sección "Cuentas
	 * Contables" (antes códigos contables fijos "9102.01"/"9102.02" sin relación real con la
	 * transacción) por la cuenta bancaria real usada, misma fuente que Cuenta Origen del formulario. */
	cuentaBancariaOrigen: string;
	/** Cuenta bancaria propia a la que entra el dinero — mismo criterio que cuentaBancariaOrigen. */
	cuentaBancariaDestino: string;
}

function construirVoucherHtml(esCopia: boolean, datos: DatosComprobanteInterno): string {
	const numeroTexto = `N° ${String(datos.numero).padStart(4, '0')}`;
	const montoLetras = `(${montoEnLetras(datos.monto)})`;

	return `
		<div class="voucher-copia">
			<div class="v-header">
				<div class="v-empresa">
					<div class="v-logo">${ICONO_BRUJULA}</div>
					<div>
						<div class="v-empresa-nombre">${escapeHtml(EMPRESA_NOMBRE)}</div>
						<div class="v-empresa-ruc">RUC: ${escapeHtml(EMPRESA_RUC)}</div>
					</div>
				</div>
				<div class="v-header-right">
					<div class="v-numero-badge">${escapeHtml(numeroTexto)}</div>
					<div class="v-header-meta">
						<div class="v-titulo">${esCopia ? 'COPIA - ' : ''}RECIBO - TRANSFERENCIA INTERNA</div>
						<div>Fecha: ${escapeHtml(formatearFechaCorta(datos.fecha))}</div>
						<div>Página: 1 de 1</div>
					</div>
				</div>
			</div>

			<div class="v-intro">Con fecha ${escapeHtml(formatearFechaLarga(datos.fecha))} se realizó la siguiente transferencia entre centros de costos:</div>

			<div class="v-seccion">
				<div class="v-seccion-titulo"><span class="v-num-circulo">1</span> DESDE Y HACIA</div>
				<div class="v-caja v-caja-2col">
					<div class="v-col">
						<div class="v-col-label">Desde (centro de costo origen)</div>
						<div class="v-col-codigo">${escapeHtml(datos.origenCodigo)}</div>
						<div class="v-col-nombre">${escapeHtml(datos.origenNombre)}</div>
					</div>
					<div class="v-col">
						<div class="v-flecha">&#8594;</div>
						<div class="v-col-label">Hacia (centro de costo destino)</div>
						<div class="v-col-codigo">${escapeHtml(datos.destinoCodigo)}</div>
						<div class="v-col-nombre">${escapeHtml(datos.destinoNombre)}</div>
					</div>
				</div>
			</div>

			<div class="v-seccion">
				<div class="v-seccion-titulo"><span class="v-num-circulo">2</span> IMPORTE Y CONCEPTO</div>
				<div class="v-caja v-caja-2col">
					<div class="v-col">
						<div class="v-col-label">Importe (S/)</div>
						<div class="v-importe">${escapeHtml(formatearMonto(datos.monto))}</div>
						<div class="v-importe-letras">${escapeHtml(montoLetras)}</div>
					</div>
					<div class="v-col">
						<div class="v-col-label">Concepto</div>
						<div class="v-texto">${escapeHtml(datos.concepto)}</div>
					</div>
				</div>
			</div>

			<div class="v-seccion">
				<div class="v-seccion-titulo"><span class="v-num-circulo">3</span> CUENTAS BANCARIAS</div>
				<div class="v-caja v-caja-2col">
					<div class="v-col">
						<div class="v-col-label">Cuenta origen</div>
						<div class="v-col-nombre">${escapeHtml(datos.cuentaBancariaOrigen)}</div>
					</div>
					<div class="v-col">
						<div class="v-col-label">Cuenta destino</div>
						<div class="v-col-nombre">${escapeHtml(datos.cuentaBancariaDestino)}</div>
					</div>
				</div>
			</div>

			<div class="v-footer">
				<div class="v-footer-titulo">TRANSACCIÓN REGISTRADA POR</div>
				<div>Usuario: ${escapeHtml(datos.usuario)}</div>
				<div>Fecha y hora: ${escapeHtml(new Date().toLocaleString('es-PE'))}</div>
			</div>
		</div>
	`;
}

async function renderVoucherComoImagen(esCopia: boolean, datos: DatosComprobanteInterno) {
	const html = `<style>${ESTILOS_VOUCHER_BASE}</style>${construirVoucherHtml(esCopia, datos)}`;
	return renderHtmlToPngDataUrl(html, ANCHO_PLANTILLA_PX);
}

/** Arma el PDF completo (Original + Copia en una sola hoja) y lo devuelve en base64, listo para
 * guardarArchivoBinario (mismo helper multiplataforma que ya usan las exportaciones y R1/R2). Cada
 * copia se renderiza por separado (mismo layout, solo cambia la etiqueta "COPIA -") y se ubica justo
 * después de donde terminó la anterior — un nombre/concepto largo que agranda la primera copia nunca se
 * superpone con la segunda, porque la altura de cada imagen se mide después de renderizarla. */
export async function generarComprobanteTransferenciaInternaBase64(datos: DatosComprobanteInterno): Promise<string> {
	const [original, copia] = await Promise.all([renderVoucherComoImagen(false, datos), renderVoucherComoImagen(true, datos)]);

	const doc = new jsPDF();
	const alturaOriginalMm = (original.heightPx / original.widthPx) * ANCHO_PAGINA_MM;
	const alturaCopiaMm = (copia.heightPx / copia.widthPx) * ANCHO_PAGINA_MM;

	let y = MARGEN_PAGINA_MM;
	doc.addImage(original.dataUrl, 'PNG', MARGEN_PAGINA_MM, y, ANCHO_PAGINA_MM, alturaOriginalMm);
	y += alturaOriginalMm + 4;

	doc.setDrawColor(150);
	doc.setLineDashPattern([1.5, 1.5], 0);
	doc.line(MARGEN_PAGINA_MM, y, MARGEN_PAGINA_MM + ANCHO_PAGINA_MM, y);
	doc.setLineDashPattern([], 0);
	y += 4;

	doc.addImage(copia.dataUrl, 'PNG', MARGEN_PAGINA_MM, y, ANCHO_PAGINA_MM, alturaCopiaMm);

	return arrayBufferToBase64(doc.output('arraybuffer'));
}
