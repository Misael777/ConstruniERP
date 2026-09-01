/**
 * Genera el PDF "RECIBO DE PAGO" que se emite para un pago en Efectivo de una transacción Externa de
 * tipo Ingreso — a pedido explícito del usuario, replica AL PIXEL un HTML de referencia que compartió
 * (posicionamiento absoluto dentro de una hoja fija de 544×682px, con las dos copias — Original y
 * "COPIA" — ya dispuestas una debajo de la otra separadas por una línea punteada). El CSS de acá es
 * prácticamente un calco de esa referencia; solo se cambia el logo embebido en base64 por el logo real
 * de la empresa (/logo.png, mismo que usa el resto del ERP) y se reemplazan los valores de ejemplo por
 * los datos reales de la transacción. Las firmas manuscritas (ver SignaturePad.svelte/
 * ReciboPagoModal.svelte) se incrustan como imagen. Arma la hoja completa como HTML/CSS y la convierte a
 * UNA sola imagen con html2canvas antes de incrustarla en el PDF con jsPDF — funciona igual en
 * navegador, Tauri Windows y Tauri Android.
 */
import jsPDF from 'jspdf';
import { montoEnLetras } from './numeroALetras';
import { arrayBufferToBase64 } from './base64';
import { EMPRESA_NOMBRE, EMPRESA_RUC } from './empresaConstantes';
import { formatearFechaCorta, formatearMonto } from './pdfFormatoUtil';
import { renderHtmlToPngDataUrl } from './pdfHtmlRender';
import { escapeHtml } from './pdfVoucherEstilos';

const ANCHO_PLANTILLA_PX = 544; // ancho fijo de la hoja de referencia (.page)
const ANCHO_PAGINA_MM = 190; // ancho de contenido en el PDF (A4 210mm con 10mm de margen a cada lado)
const MARGEN_PAGINA_MM = 10;

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
	/** true = medio_pago '1' (Efectivo) — sección 3 muestra el casillero fijo "EFECTIVO" con su
	 * descripción de siempre. false = cualquier otro medio (Transferencia/Depósito/Yape o Plin, ver
	 * FIELDS_CONFIG) — la sección 3 muestra en cambio un recuadro simple con `formaPagoTexto` tal cual lo
	 * escribió el usuario (ej. "Yape a Willy Melchor") — a pedido explícito del usuario, con imagen de
	 * referencia. */
	esEfectivo: boolean;
	/** Descripción libre del medio de pago no efectivo (ej. "Yape a Willy Melchor", "Transferencia BCP a
	 * Juan Pérez") — solo se usa/requiere cuando esEfectivo es false. */
	formaPagoTexto?: string;
}

// CSS calcado de la referencia del usuario (posiciones/tamaños en px tal cual) — ver comentario de
// archivo arriba. No usa las clases "v-*" de pdfVoucherEstilos.ts porque este diseño es un
// posicionamiento absoluto propio, distinto del layout flexbox del comprobante de transferencia interna.
const ESTILOS_RECIBO_PAGO = `
	* { box-sizing: border-box; }
	.rp-page { position: relative; width: 544px; height: 682px; background: #fff; overflow: hidden; font-family: Arial, Helvetica, sans-serif; color: #111; }
	.rp-receipt { position: absolute; left: 87px; width: 369px; height: 251px; font-size: 5.2px; line-height: 1.05; background: #fff; }
	.rp-r1 { top: 74px; }
	.rp-r2 { top: 383px; }
	.rp-separador { position: absolute; left: 87px; top: 358px; width: 369px; border-top: 1px dotted #777; }
	.rp-logo { position: absolute; left: 0; top: 0; width: 151px; height: 30px; object-fit: contain; object-position: left center; }
	.rp-header-right { position: absolute; right: 0; top: 0; width: 92px; text-align: center; }
	.rp-number { font-size: 8px; font-weight: 700; margin-bottom: 2px; }
	.rp-badge { display: inline-block; border: 1px solid #111; border-radius: 2px; padding: 1px 5px; font-size: 6px; font-weight: 700; letter-spacing: .1px; }
	.rp-meta { font-size: 4.8px; margin-top: 2px; line-height: 1.15; }
	.rp-intro { position: absolute; left: 0; right: 0; top: 33px; border-bottom: 1px solid #777; padding-bottom: 2px; font-size: 5px; line-height: 1.15; }
	.rp-section { position: absolute; left: 0; right: 0; border: 1px solid #777; border-radius: 2px; }
	.rp-section-title { position: absolute; left: 0; top: -8px; font-size: 5.2px; font-weight: 700; background: #fff; }
	/* Recibo NO EFECTIVO — a pedido explícito del usuario, con imagen de referencia: fondo crema/beige
	   para diferenciarlo de un vistazo del recibo en Efectivo (blanco, arriba). Las etiquetas numeradas
	   de cada sección ("1 POR CONCEPTO DE", etc.) tienen su propio fondo blanco fijo para "recortar" la
	   línea del borde — acá también cambian a crema para no quedar como un rectángulo blanco flotando. */
	.rp-receipt-no-efectivo { background: #f4e9d2; }
	.rp-receipt-no-efectivo .rp-section-title { background: #f4e9d2; }
	.rp-project { top: 59px; height: 22px; padding: 7px 7px 3px; }
	.rp-project-name { font-size: 7px; font-weight: 700; }
	.rp-project-sub { font-size: 5px; margin-top: 1px; }
	.rp-amount { top: 88px; height: 33px; }
	.rp-amount-left { position: absolute; left: 0; top: 0; width: 142px; height: 100%; border-right: 1px solid #777; text-align: center; }
	.rp-amount-right { position: absolute; left: 142px; right: 0; top: 0; height: 100%; padding: 8px 7px; }
	.rp-amount-head { font-size: 4.5px; font-weight: 700; margin-top: 2px; }
	.rp-amount-value { font-size: 9px; font-weight: 700; margin-top: 5px; }
	.rp-amount-words { font-size: 4.4px; margin-top: 1px; }
	.rp-concept-head { font-size: 4.5px; font-weight: 700; text-align: center; }
	.rp-concept { font-size: 4.6px; line-height: 1.15; margin-top: 6px; }
	.rp-document { font-size: 7px; margin-right: 4px; }
	.rp-payment { top: 128px; height: 28px; padding: 7px 7px 3px; }
	.rp-cashbox { font-size: 6px; font-weight: 700; margin-bottom: 2px; }
	.rp-cashbox::before { content: ""; display: inline-block; width: 7px; height: 7px; border: 1px solid #777; border-radius: 1px; vertical-align: -2px; margin-right: 6px; }
	.rp-payment-note { font-size: 4.5px; line-height: 1.2; }
	.rp-forma-pago-texto { border: 1.2px solid #94a3b8; border-radius: 3px; padding: 5px 7px; font-size: 6.5px; font-weight: 700; color: #1e293b; letter-spacing: .02em; margin-top: 2px; }
	.rp-detail { top: 162px; height: 21px; }
	.rp-detail-cell { position: absolute; top: 0; height: 100%; padding: 5px 7px 2px; }
	.rp-detail-cell.rp-first { left: 0; width: 50%; border-right: 1px solid #777; }
	.rp-detail-cell.rp-last { left: 50%; width: 50%; }
	.rp-detail-head { font-size: 4.5px; text-align: center; }
	.rp-detail-value { font-size: 6px; font-weight: 700; text-align: center; margin-top: 2px; }
	.rp-signatures { position: absolute; left: 0; right: 0; top: 187px; height: 61px; border-top: 1px dotted #777; }
	.rp-sig { position: absolute; top: 6px; width: 130px; text-align: center; }
	.rp-sig.rp-left { left: 14px; }
	.rp-sig.rp-right { right: 14px; }
	.rp-sig-title { font-size: 4.5px; font-weight: 700; margin-bottom: 2px; }
	.rp-sig-title .rp-normal { font-weight: normal; }
	.rp-firma-img-wrap { height: 10px; display: flex; align-items: flex-end; justify-content: center; }
	.rp-firma-img { max-height: 10px; max-width: 120px; object-fit: contain; }
	.rp-line { border-top: 1px solid #777; width: 130px; margin: 1px auto 0; }
	.rp-sig-name { font-size: 5.1px; font-weight: 700; margin-top: 3px; }
	.rp-sig-info { font-size: 4.5px; line-height: 1.15; margin-top: 1px; }
`;

/** Un bloque de recibo (Original o Copia) — misma estructura para r1/r2, la referencia solo agrega la
 * etiqueta "COPIA" arriba a la derecha en la segunda. */
function construirBloqueRecibo(posicionClase: string, esCopia: boolean, datos: DatosReciboPago): string {
	const numeroTexto = String(datos.numero).padStart(7, '0');
	const horaActual = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });

	return `
		<div class="rp-receipt ${posicionClase} ${datos.esEfectivo ? '' : 'rp-receipt-no-efectivo'}">
			<img class="rp-logo" src="/logo.png" alt="${escapeHtml(EMPRESA_NOMBRE)}" />
			<div class="rp-header-right">
				<div class="rp-number">N° ${escapeHtml(numeroTexto)}</div>
				<div class="rp-badge">${esCopia ? 'COPIA - ' : ''}RECIBO DE PAGO</div>
				<div class="rp-meta">Fecha: ${escapeHtml(formatearFechaCorta(datos.fecha))}<br>Página: 1 de 1</div>
			</div>

			<div class="rp-intro">Yo, ${escapeHtml(datos.clienteNombre)}, identificado con RUC/DNI ${escapeHtml(datos.clienteDni)}, <b>dejo constancia de haber pagado a favor de ${escapeHtml(EMPRESA_NOMBRE)}</b>, identificado con RUC ${escapeHtml(EMPRESA_RUC)}, el importe que se detalla a continuación:</div>

			<div class="rp-section rp-project">
				<div class="rp-section-title">1&nbsp;&nbsp;POR CONCEPTO DE</div>
				<div class="rp-project-name">${escapeHtml(datos.proyectoNombre)}</div>
				<div class="rp-project-sub">Código: ${escapeHtml(datos.proyectoCodigo)}</div>
			</div>

			<div class="rp-section rp-amount">
				<div class="rp-section-title">2&nbsp;&nbsp;IMPORTE Y CONCEPTO</div>
				<div class="rp-amount-left">
					<div class="rp-amount-head">IMPORTE (S/)</div>
					<div class="rp-amount-value">${escapeHtml(formatearMonto(datos.monto))}</div>
					<div class="rp-amount-words">(${escapeHtml(montoEnLetras(datos.monto))})</div>
				</div>
				<div class="rp-amount-right">
					<div class="rp-concept-head"><span class="rp-document">▧</span> CONCEPTO</div>
					<div class="rp-concept">${escapeHtml(datos.concepto)}</div>
				</div>
			</div>

			<div class="rp-section rp-payment">
				<div class="rp-section-title">3&nbsp;&nbsp;FORMA DE PAGO</div>
				${
					datos.esEfectivo
						? `<div class="rp-cashbox">EFECTIVO</div>
					<div class="rp-payment-note">El pago se realizó en efectivo por la suma indicada en el presente recibo.</div>`
						: `<div class="rp-forma-pago-texto">${escapeHtml((datos.formaPagoTexto || '').toUpperCase())}</div>`
				}
			</div>

			<div class="rp-section rp-detail">
				<div class="rp-section-title">4&nbsp;&nbsp;DETALLE DEL RECIBO</div>
				<div class="rp-detail-cell rp-first">
					<div class="rp-detail-head">N° DE RECIBO</div>
					<div class="rp-detail-value">${escapeHtml(numeroTexto)}</div>
				</div>
				<div class="rp-detail-cell rp-last">
					<div class="rp-detail-head">FECHA DE EMISIÓN</div>
					<div class="rp-detail-value">${escapeHtml(formatearFechaCorta(datos.fecha))}</div>
				</div>
			</div>

			<div class="rp-signatures">
				<div class="rp-sig rp-left">
					<div class="rp-sig-title">FIRMA DIGITAL DEL CLIENTE<br><span class="rp-normal">(Firma manuscrita)</span></div>
					<div class="rp-firma-img-wrap">
						${datos.firmaClienteDataUrl ? `<img class="rp-firma-img" src="${datos.firmaClienteDataUrl}" />` : ''}
					</div>
					<div class="rp-line"></div>
					<div class="rp-sig-name">${escapeHtml(datos.clienteNombre)}</div>
					<div class="rp-sig-info">RUC/DNI: ${escapeHtml(datos.clienteDni)}<br>Fecha: ${escapeHtml(formatearFechaCorta(datos.fecha))} ${escapeHtml(horaActual)}</div>
				</div>
				<div class="rp-sig rp-right">
					<div class="rp-sig-title">FIRMA DE QUIEN RECIBE</div>
					<div class="rp-firma-img-wrap">
						${datos.firmaReceptorDataUrl ? `<img class="rp-firma-img" src="${datos.firmaReceptorDataUrl}" />` : ''}
					</div>
					<div class="rp-line"></div>
					<div class="rp-sig-name">NOMBRE: ${escapeHtml(datos.receptorNombre)}</div>
					<div class="rp-sig-info">DNI: ${escapeHtml(datos.receptorDni)}<br>Fecha de recepción: ${escapeHtml(formatearFechaCorta(datos.fecha))} ${escapeHtml(horaActual)}</div>
				</div>
			</div>
		</div>
	`;
}

function construirPaginaHtml(datos: DatosReciboPago): string {
	return `
		<div class="rp-page">
			${construirBloqueRecibo('rp-r1', false, datos)}
			<div class="rp-separador"></div>
			${construirBloqueRecibo('rp-r2', true, datos)}
		</div>
	`;
}

/** Arma el PDF completo (Original + Copia ya dispuestas en una sola hoja de 544×682px, ver referencia
 * del usuario) y lo devuelve en base64, listo para guardarArchivoBinario. Se renderiza UNA sola vez —
 * ambas copias ya están posicionadas dentro de la misma plantilla. */
export async function generarReciboPagoBase64(datos: DatosReciboPago): Promise<string> {
	const html = `<style>${ESTILOS_RECIBO_PAGO}</style>${construirPaginaHtml(datos)}`;
	const pagina = await renderHtmlToPngDataUrl(html, ANCHO_PLANTILLA_PX);

	const doc = new jsPDF();
	const alturaMm = (pagina.heightPx / pagina.widthPx) * ANCHO_PAGINA_MM;
	doc.addImage(pagina.dataUrl, 'PNG', MARGEN_PAGINA_MM, MARGEN_PAGINA_MM, ANCHO_PAGINA_MM, alturaMm);

	return arrayBufferToBase64(doc.output('arraybuffer'));
}
