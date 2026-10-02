/**
 * Genera el PDF "RECIBO DE PAGO A PROVEEDOR" que se emite para un pago (Efectivo o no) de una
 * transacción Externa de tipo Egreso — a pedido explícito del usuario, con imagen de referencia:
 * mismo lenguaje visual v-* (header con logo/N°, cajas redondeadas, círculos numerados) que
 * comprobanteTransferenciaInterna.ts, en vez del layout anterior de posicionamiento absoluto con
 * fuentes diminutas (544×682px, dos copias en una sola hoja fija). Acá la EMPRESA es quien entrega
 * el dinero y el PROVEEDOR quien lo recibe (en RECIBO DE PAGO de reciboPagoEfectivo.ts es al revés:
 * el cliente paga y la empresa recibe). La sección 3 "FORMA DE PAGO" cambia según `esEfectivo` —
 * mismo criterio que reciboPagoEfectivo.ts (el fondo crema que diferenciaba Efectivo/No Efectivo se
 * quitó a pedido explícito del usuario: mismo formato blanco que el resto de los recibos, ver
 * pdfVoucherEstilos.ts). Se arma como HTML/CSS y se
 * convierte a imagen con html2canvas antes de incrustarla en el PDF con jsPDF — funciona igual en
 * navegador, Tauri Windows y Tauri Android.
 */
import { montoEnLetras } from './numeroALetras';
import { EMPRESA_NOMBRE, EMPRESA_RUC } from './empresaConstantes';
import { formatearFechaCorta, formatearMonto } from './pdfFormatoUtil';
import { renderHtmlToPngDataUrl, ensamblarPdfDosCopiasA4 } from './pdfHtmlRender';
import { ESTILOS_VOUCHER_BASE, marcaAguaBorrador, escapeHtml } from './pdfVoucherEstilos';
import { conCarga } from '$lib/stores/loading.svelte';
import { registrarAccion } from '$lib/shared/auditoria';

const ANCHO_PLANTILLA_PX = 750;

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
	 * `formaPagoTexto`. Mismo criterio que DatosReciboPago.esEfectivo en reciboPagoEfectivo.ts. Las
	 * firmas (v-firmas) YA NO dependen de este campo — son opcionales para cualquier medio de pago. */
	esEfectivo: boolean;
	/** Label del Medio de Pago ya elegido en el formulario principal (ver TransaccionModal.svelte) — solo
	 * se usa/muestra cuando esEfectivo es false. */
	formaPagoTexto?: string;
}

// Iconos SVG inline (calcados de Lucide "Truck"/"Banknote") — a propósito, NO emojis: un emoji
// depende de la fuente del sistema operativo y puede verse distinto (o no verse) entre navegador,
// Tauri Windows y Tauri Android, violando el requisito multiplataforma. El camión va en el círculo
// del header (mismo lugar que la brújula de Transferencia Interna, ver .v-logo-icono) — un camión de
// carga encaja mejor que una brújula para un pago A UN PROVEEDOR.
const ICONO_CAMION_LOGO = `<svg class="v-logo-icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14v10"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>`;
const ICONO_BILLETE = `<svg class="v-icono-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>`;

function construirVoucherHtml(esCopia: boolean, datos: DatosReciboPagoProveedor, sinMarcaAgua = false): string {
	const numeroTexto = `N° ${String(datos.numero).padStart(7, '0')}`;
	const horaActual = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });

	return `
		<div class="voucher-copia">
			<div class="v-header">
				<div class="v-empresa">
					<div class="v-logo">${ICONO_CAMION_LOGO}</div>
					<div>
						<div class="v-empresa-nombre">${escapeHtml(EMPRESA_NOMBRE)}</div>
						<div class="v-empresa-ruc">RUC: ${escapeHtml(EMPRESA_RUC)}</div>
					</div>
				</div>
				<div class="v-header-right">
					<div class="v-numero-badge">${escapeHtml(numeroTexto)}</div>
					<div class="v-header-meta">
						<div class="v-titulo">${esCopia ? 'COPIA - ' : ''}RECIBO DE PAGO A PROVEEDOR</div>
						<div>Fecha: ${escapeHtml(formatearFechaCorta(datos.fecha))}</div>
						<div>Página: 1 de 1</div>
					</div>
				</div>
			</div>

			<div class="v-intro">Por medio del presente documento, la empresa <b>${escapeHtml(EMPRESA_NOMBRE)}</b> con RUC ${escapeHtml(EMPRESA_RUC)}, hace constar ${datos.esEfectivo ? 'la entrega en efectivo' : 'el pago'} del importe detallado a continuación a favor de:</div>

			<div class="v-seccion">
				<div class="v-seccion-titulo"><span class="v-num-circulo">1</span> PROVEEDOR / DESTINATARIO</div>
				<div class="v-caja v-caja-1col">
					<div class="v-col-nombre" style="font-size:13px;font-weight:700;color:#1e293b;">${escapeHtml(datos.proveedorNombre)}</div>
					<div class="v-col-nombre">RUC/DNI: ${escapeHtml(datos.proveedorRuc)} | Proyecto: ${escapeHtml(datos.proyectoNombre)}</div>
				</div>
			</div>

			<div class="v-seccion">
				<div class="v-seccion-titulo"><span class="v-num-circulo">2</span> IMPORTE Y CONCEPTO</div>
				<div class="v-caja v-caja-2col">
					<div class="v-col">
						<div class="v-col-label">Importe entregado (S/)</div>
						<div class="v-importe">${escapeHtml(formatearMonto(datos.monto))}</div>
						<div class="v-importe-letras">(${escapeHtml(montoEnLetras(datos.monto))})</div>
					</div>
					<div class="v-col">
						<div class="v-col-label">Concepto de pago</div>
						<div class="v-texto">${escapeHtml(datos.concepto)}</div>
					</div>
				</div>
			</div>

			<div class="v-seccion">
				<div class="v-seccion-titulo"><span class="v-num-circulo">3</span> FORMA DE PAGO</div>
				<div class="v-caja v-caja-1col">
					${
						datos.esEfectivo
							? `<div class="v-cashbox-row">${ICONO_BILLETE} EFECTIVO</div>
					<div class="v-col-nombre">Se hizo entrega del dinero en efectivo al representante del proveedor.</div>`
							: `<div class="v-forma-pago-texto">${escapeHtml((datos.formaPagoTexto || '').toUpperCase())}</div>`
					}
				</div>
			</div>

			<div class="v-seccion">
				<div class="v-seccion-titulo"><span class="v-num-circulo">4</span> DETALLE DEL RECIBO</div>
				<div class="v-caja v-caja-2col">
					<div class="v-col">
						<div class="v-col-label">N° de recibo</div>
						<div class="v-col-codigo">${escapeHtml(numeroTexto)}</div>
					</div>
					<div class="v-col">
						<div class="v-col-label">Fecha de emisión</div>
						<div class="v-col-codigo">${escapeHtml(formatearFechaCorta(datos.fecha))}</div>
					</div>
				</div>
			</div>

			<div class="v-firmas">
				<div class="v-firma">
					<div class="v-firma-titulo">Entregué conforme<br>(Empresa)</div>
					<div class="v-firma-img-wrap">
						${datos.firmaEntregoDataUrl ? `<img class="v-firma-img" src="${datos.firmaEntregoDataUrl}" />` : ''}
					</div>
					<div class="v-firma-linea"></div>
					<div class="v-firma-nombre">${escapeHtml(datos.entregoNombre)}</div>
					<div class="v-firma-info">DNI: ${escapeHtml(datos.entregoDni)}<br>Fecha: ${escapeHtml(formatearFechaCorta(datos.fecha))} ${escapeHtml(horaActual)}</div>
				</div>
				<div class="v-firma">
					<div class="v-firma-titulo">Recibí conforme<br>(Proveedor)</div>
					<div class="v-firma-img-wrap">
						${datos.firmaRecibioDataUrl ? `<img class="v-firma-img" src="${datos.firmaRecibioDataUrl}" />` : ''}
					</div>
					<div class="v-firma-linea"></div>
					<div class="v-firma-nombre">${escapeHtml(datos.recibioNombre)}</div>
					<div class="v-firma-info">DNI: ${escapeHtml(datos.recibioDni)}<br>Fecha de recepción: ${escapeHtml(formatearFechaCorta(datos.fecha))} ${escapeHtml(horaActual)}</div>
				</div>
			</div>
			${sinMarcaAgua ? '' : marcaAguaBorrador(48)}
		</div>
	`;
}

async function renderVoucherComoImagen(esCopia: boolean, datos: DatosReciboPagoProveedor, sinMarcaAgua = false) {
	const html = `<style>${ESTILOS_VOUCHER_BASE}</style>${construirVoucherHtml(esCopia, datos, sinMarcaAgua)}`;
	return renderHtmlToPngDataUrl(html, ANCHO_PLANTILLA_PX);
}

/** Arma el recibo como HTML autocontenido, sin pasar por html2canvas/jsPDF — mismo criterio que
 * construirHtmlCompleto en comprobanteTransferenciaInterna.ts: mientras la transacción sigue siendo un
 * borrador, el recibo queda en HTML; recién se convierte a PDF de verdad al guardar/cerrar (ver
 * handleSubmit en TransaccionModal.svelte). Fondo del body en blanco (antes gris-azulado #e2e8f0) — a
 * pedido explícito del usuario: si alguien imprime directo desde esta vista previa (Ctrl+P sobre el
 * popup), un fondo de página completo gasta tinta de sobra en cada impresión. El PDF real
 * (generarReciboPagoProveedorBase64/renderHtmlToPngDataUrl) ya usaba fondo blanco de por sí — esto solo
 * alinea la vista previa con lo que de verdad se imprime/descarga. */
export function construirHtmlCompleto(datos: DatosReciboPagoProveedor): string {
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>RECIBO DE PAGO A PROVEEDOR (borrador)</title><style>body{background:#ffffff;margin:0;padding:20px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}${ESTILOS_VOUCHER_BASE}.voucher-copia{max-width:${ANCHO_PLANTILLA_PX}px;margin:0 auto 16px;}</style></head><body>${construirVoucherHtml(false, datos)}${construirVoucherHtml(true, datos)}</body></html>`;
}

/** Arma el PDF completo (Original + Copia en una sola hoja) y lo devuelve en base64, listo para
 * guardarArchivoBinario — el ensamblado en la hoja A4 (incluida la escala si el contenido es más alto
 * de lo normal) vive centralizado en pdfHtmlRender.ts, ver ensamblarPdfDosCopiasA4. */
export async function generarReciboPagoProveedorBase64(datos: DatosReciboPagoProveedor, sinMarcaAgua = false) {
	// Ticket #9: un solo punto por generador — cubre "Original + Copia" (dos renders de renderHtmlToPngDataUrl)
	// como UNA sola espera, en vez de parpadear entre cada mitad.
	registrarAccion('pdf', `Recibo de pago a proveedor N° ${datos.numero}`);
	return conCarga('Generando el recibo de pago…', () => generarReciboPagoProveedorBase64Interno(datos, sinMarcaAgua));
}

async function generarReciboPagoProveedorBase64Interno(datos: DatosReciboPagoProveedor, sinMarcaAgua = false): Promise<string> {
	const [original, copia] = await Promise.all([
		renderVoucherComoImagen(false, datos, sinMarcaAgua),
		renderVoucherComoImagen(true, datos, sinMarcaAgua)
	]);
	return ensamblarPdfDosCopiasA4(original, copia);
}
