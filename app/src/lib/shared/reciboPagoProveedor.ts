/**
 * Genera el PDF "RECIBO DE PAGO A PROVEEDOR" que se emite para un pago (Efectivo o no) de una
 * transacción Externa de tipo Egreso — a pedido explícito del usuario, replica AL PIXEL una imagen de
 * referencia que compartió. Misma plantilla base (hoja fija 544×682px, posicionamiento absoluto, dos
 * copias — Original y "COPIA" — apiladas con separador punteado) que RECIBO DE PAGO (ver
 * reciboPagoEfectivo.ts), pero con roles invertidos: acá la EMPRESA es quien entrega el dinero y el
 * PROVEEDOR quien lo recibe (en el otro, el cliente paga y la empresa recibe). Igual que RECIBO DE PAGO,
 * la sección 3 "FORMA DE PAGO" y el fondo (blanco/crema) cambian según `esEfectivo` — ver ese archivo
 * para el criterio completo. Se arma como HTML/CSS y se convierte a UNA sola imagen con html2canvas antes
 * de incrustarla en el PDF con jsPDF — funciona igual en navegador, Tauri Windows y Tauri Android.
 */
import jsPDF from 'jspdf';
import { montoEnLetras } from './numeroALetras';
import { arrayBufferToBase64 } from './base64';
import { EMPRESA_NOMBRE, EMPRESA_RUC } from './empresaConstantes';
import { formatearFechaCorta, formatearMonto } from './pdfFormatoUtil';
import { renderHtmlToPngDataUrl } from './pdfHtmlRender';
import { escapeHtml } from './pdfVoucherEstilos';

const ANCHO_PLANTILLA_PX = 544;
const ANCHO_PAGINA_MM = 190;
const MARGEN_PAGINA_MM = 10;

export interface DatosReciboPagoProveedor {
	numero: number;
	fecha: string; // 'YYYY-MM-DD'
	proveedorNombre: string;
	proveedorRuc: string;
	proyectoNombre: string;
	monto: number;
	concepto: string;
	entregoNombre: string;
	entregoDni: string;
	/** PNG en base64 (data URL completa, ver SignaturePad.svelte) */
	firmaEntregoDataUrl: string;
	recibioNombre: string;
	recibioDni: string;
	/** PNG en base64 (data URL completa, ver SignaturePad.svelte) */
	firmaRecibioDataUrl: string;
	/** true = medio_pago '1' (Efectivo) — sección 3 muestra el casillero fijo "EFECTIVO". false =
	 * cualquier otro medio (Transferencia/Depósito/Yape o Plin) — muestra en cambio un recuadro con
	 * `formaPagoTexto` tal cual lo escribió el usuario (ej. "Transferencia BCP"). Mismo criterio que
	 * DatosReciboPago.esEfectivo en reciboPagoEfectivo.ts. */
	esEfectivo: boolean;
	/** Descripción libre del medio de pago no efectivo — solo se usa/requiere cuando esEfectivo es
	 * false. */
	formaPagoTexto?: string;
}

// Misma plantilla/proporciones que reciboPagoEfectivo.ts (ver comentario de archivo) — CSS duplicado a
// propósito, mismo criterio que comprobanteTransferenciaInterna.ts: cada tipo de recibo es un archivo
// autocontenido.
const ESTILOS_RECIBO_PROVEEDOR = `
	* { box-sizing: border-box; }
	.rp-page { position: relative; width: 544px; height: 682px; background: #fff; overflow: hidden; font-family: Arial, Helvetica, sans-serif; color: #111; }
	.rp-receipt { position: absolute; left: 87px; width: 369px; height: 251px; font-size: 5.2px; line-height: 1.05; background: #fff; }
	.rp-r1 { top: 74px; }
	.rp-r2 { top: 383px; }
	.rp-separador { position: absolute; left: 87px; top: 358px; width: 369px; border-top: 1px dotted #777; }
	.rp-logo { position: absolute; left: 0; top: 0; width: 151px; height: 30px; object-fit: contain; object-position: left center; }
	.rp-header-right { position: absolute; right: 0; top: 0; width: 145px; text-align: center; }
	.rp-number { font-size: 8px; font-weight: 700; margin-bottom: 2px; }
	.rp-badge { display: inline-block; border: 1px solid #111; border-radius: 2px; padding: 1px 5px; font-size: 5.2px; font-weight: 700; letter-spacing: .1px; white-space: nowrap; }
	.rp-meta { font-size: 4.8px; margin-top: 2px; line-height: 1.15; }
	.rp-intro { position: absolute; left: 0; right: 0; top: 33px; border-bottom: 1px solid #777; padding-bottom: 2px; font-size: 5px; line-height: 1.15; }
	.rp-section { position: absolute; left: 0; right: 0; border: 1px solid #777; border-radius: 2px; }
	.rp-section-title { position: absolute; left: 0; top: -8px; font-size: 5.2px; font-weight: 700; background: #fff; display: flex; align-items: center; gap: 2px; }
	/* Recibo NO EFECTIVO — mismo criterio que reciboPagoEfectivo.ts: fondo crema/beige para diferenciarlo
	   de un vistazo del recibo en Efectivo (blanco, arriba). */
	.rp-receipt-no-efectivo { background: #f4e9d2; }
	.rp-receipt-no-efectivo .rp-section-title { background: #f4e9d2; }
	.rp-icon { width: 6px; height: 6px; color: #0f3b5e; flex-shrink: 0; }
	.rp-project { top: 59px; height: 22px; padding: 7px 7px 3px; }
	.rp-project-name { font-size: 7px; font-weight: 700; }
	.rp-project-sub { font-size: 5px; margin-top: 1px; }
	.rp-amount { top: 88px; height: 33px; }
	.rp-amount-left { position: absolute; left: 0; top: 0; width: 142px; height: 100%; border-right: 1px solid #777; text-align: center; }
	.rp-amount-right { position: absolute; left: 142px; right: 0; top: 0; height: 100%; padding: 8px 7px; }
	.rp-amount-head { font-size: 4.5px; font-weight: 700; margin-top: 2px; }
	.rp-amount-value { font-size: 9px; font-weight: 700; margin-top: 5px; }
	.rp-amount-words { font-size: 4.4px; margin-top: 1px; }
	.rp-concept-head { font-size: 4.5px; font-weight: 700; text-align: center; display: flex; align-items: center; justify-content: center; gap: 2px; }
	.rp-concept { font-size: 4.6px; line-height: 1.15; margin-top: 6px; }
	.rp-payment { top: 128px; height: 28px; padding: 7px 7px 3px; }
	.rp-cashbox { font-size: 6px; font-weight: 700; margin-bottom: 2px; display: flex; align-items: center; gap: 3px; }
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
	.rp-firma-img-wrap { height: 10px; display: flex; align-items: flex-end; justify-content: center; }
	.rp-firma-img { max-height: 10px; max-width: 120px; object-fit: contain; }
	.rp-line { border-top: 1px solid #777; width: 130px; margin: 1px auto 0; }
	.rp-sig-name { font-size: 5.1px; font-weight: 700; margin-top: 3px; }
	.rp-sig-info { font-size: 4.5px; line-height: 1.15; margin-top: 1px; }
`;

// Iconos SVG inline (calcados de Lucide "Truck"/"Banknote") — a propósito, NO emojis: un emoji depende
// de la fuente del sistema operativo y puede verse distinto (o no verse) entre navegador, Tauri Windows
// y Tauri Android, violando el requisito multiplataforma. Un SVG embebido se renderiza idéntico en todas.
const ICONO_CAMION = `<svg class="rp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14v10"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>`;
const ICONO_BILLETE = `<svg class="rp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>`;
const ICONO_DOCUMENTO = `<svg class="rp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`;

function construirBloqueRecibo(posicionClase: string, esCopia: boolean, datos: DatosReciboPagoProveedor): string {
	const numeroTexto = String(datos.numero).padStart(7, '0');
	const horaActual = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });

	return `
		<div class="rp-receipt ${posicionClase} ${datos.esEfectivo ? '' : 'rp-receipt-no-efectivo'}">
			<img class="rp-logo" src="/logo.png" alt="${escapeHtml(EMPRESA_NOMBRE)}" />
			<div class="rp-header-right">
				<div class="rp-number">N° ${escapeHtml(numeroTexto)}</div>
				<div class="rp-badge">${esCopia ? 'COPIA - ' : ''}RECIBO DE PAGO A PROVEEDOR</div>
				<div class="rp-meta">Fecha: ${escapeHtml(formatearFechaCorta(datos.fecha))}<br>Página: 1 de 1</div>
			</div>

			<div class="rp-intro">Por medio del presente documento, la empresa <b>${escapeHtml(EMPRESA_NOMBRE)}</b> con RUC ${escapeHtml(EMPRESA_RUC)}, hace constar ${datos.esEfectivo ? 'la entrega en efectivo' : 'el pago'} del importe detallado a continuación a favor de:</div>

			<div class="rp-section rp-project">
				<div class="rp-section-title">${ICONO_CAMION}1&nbsp;&nbsp;PROVEEDOR / DESTINATARIO</div>
				<div class="rp-project-name">${escapeHtml(datos.proveedorNombre)}</div>
				<div class="rp-project-sub">RUC: ${escapeHtml(datos.proveedorRuc)} | Proyecto: ${escapeHtml(datos.proyectoNombre)}</div>
			</div>

			<div class="rp-section rp-amount">
				<div class="rp-section-title">2&nbsp;&nbsp;IMPORTE Y CONCEPTO</div>
				<div class="rp-amount-left">
					<div class="rp-amount-head">IMPORTE ENTREGADO (S/)</div>
					<div class="rp-amount-value">${escapeHtml(formatearMonto(datos.monto))}</div>
					<div class="rp-amount-words">(${escapeHtml(montoEnLetras(datos.monto))})</div>
				</div>
				<div class="rp-amount-right">
					<div class="rp-concept-head">${ICONO_DOCUMENTO} CONCEPTO DE PAGO</div>
					<div class="rp-concept">${escapeHtml(datos.concepto)}</div>
				</div>
			</div>

			<div class="rp-section rp-payment">
				<div class="rp-section-title">3&nbsp;&nbsp;FORMA DE PAGO</div>
				${
					datos.esEfectivo
						? `<div class="rp-cashbox">${ICONO_BILLETE} EFECTIVO</div>
					<div class="rp-payment-note">EFECTIVO - Se hizo entrega del dinero en efectivo al representante del proveedor</div>`
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
					<div class="rp-sig-title">ENTREGUÉ CONFORME<br>(EMPRESA)</div>
					<div class="rp-firma-img-wrap">
						${datos.firmaEntregoDataUrl ? `<img class="rp-firma-img" src="${datos.firmaEntregoDataUrl}" />` : ''}
					</div>
					<div class="rp-line"></div>
					<div class="rp-sig-name">- ${escapeHtml(datos.entregoNombre)} -</div>
					<div class="rp-sig-info">DNI: ${escapeHtml(datos.entregoDni)}<br>Fecha: ${escapeHtml(formatearFechaCorta(datos.fecha))} ${escapeHtml(horaActual)}</div>
				</div>
				<div class="rp-sig rp-right">
					<div class="rp-sig-title">RECIBÍ CONFORME<br>(PROVEEDOR)</div>
					<div class="rp-firma-img-wrap">
						${datos.firmaRecibioDataUrl ? `<img class="rp-firma-img" src="${datos.firmaRecibioDataUrl}" />` : ''}
					</div>
					<div class="rp-line"></div>
					<div class="rp-sig-name">- ${escapeHtml(datos.recibioNombre)} -</div>
					<div class="rp-sig-info">DNI: ${escapeHtml(datos.recibioDni)}<br>Fecha de recepción: ${escapeHtml(formatearFechaCorta(datos.fecha))} ${escapeHtml(horaActual)}</div>
				</div>
			</div>
		</div>
	`;
}

function construirPaginaHtml(datos: DatosReciboPagoProveedor): string {
	return `
		<div class="rp-page">
			${construirBloqueRecibo('rp-r1', false, datos)}
			<div class="rp-separador"></div>
			${construirBloqueRecibo('rp-r2', true, datos)}
		</div>
	`;
}

/** Arma el PDF completo (Original + Copia en una sola hoja de 544×682px) y lo devuelve en base64, listo
 * para guardarArchivoBinario. */
export async function generarReciboPagoProveedorBase64(datos: DatosReciboPagoProveedor): Promise<string> {
	const html = `<style>${ESTILOS_RECIBO_PROVEEDOR}</style>${construirPaginaHtml(datos)}`;
	const pagina = await renderHtmlToPngDataUrl(html, ANCHO_PLANTILLA_PX);

	const doc = new jsPDF();
	const alturaMm = (pagina.heightPx / pagina.widthPx) * ANCHO_PAGINA_MM;
	doc.addImage(pagina.dataUrl, 'PNG', MARGEN_PAGINA_MM, MARGEN_PAGINA_MM, ANCHO_PAGINA_MM, alturaMm);

	return arrayBufferToBase64(doc.output('arraybuffer'));
}
