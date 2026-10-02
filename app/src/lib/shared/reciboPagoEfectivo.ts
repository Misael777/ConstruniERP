/**
 * Genera el PDF "RECIBO DE PAGO" que se emite para un pago (Efectivo o no) de una transacción Externa
 * de tipo Ingreso — a pedido explícito del usuario, con imagen de referencia: mismo lenguaje visual v-*
 * (header con logo/N°, cajas redondeadas, círculos numerados) que comprobanteTransferenciaInterna.ts/
 * reciboPagoProveedor.ts, en vez del layout anterior de posicionamiento absoluto con fuentes diminutas
 * (544×682px, dos copias en una sola hoja fija). Acá el CLIENTE es quien paga y la EMPRESA quien recibe
 * (en RECIBO DE PAGO A PROVEEDOR de reciboPagoProveedor.ts es al revés). La sección 3 "FORMA DE PAGO"
 * cambia según `esEfectivo` — a pedido explícito del usuario, con imagen de referencia: NO Efectivo ya
 * no es un solo texto libre ("Yape a Willy Melchor"), son 3 datos por separado: el medio elegido en el
 * formulario principal (ícono + label), el N° de Operación (ya reconocido/ingresado ahí mismo) y el
 * nombre de quien figura como titular de la cuenta origen (nombreTitularCuenta, sin fuente en el
 * formulario — queda "—" si no hay dato). Las firmas (v-firmas) YA NO dependen de esEfectivo — a pedido
 * explícito del usuario, son opcionales para cualquier medio de pago (ver botón "Firmar Comprobante" en
 * TransaccionModal.svelte); esEfectivo solo decide qué muestra la sección 3. Se arma como HTML/CSS y se
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
	/** true = medio_pago '1' (Efectivo) — sección 3 muestra el casillero fijo "EFECTIVO". false =
	 * cualquier otro medio (Transferencia/Depósito/Yape o Plin) — muestra en cambio el medio elegido +
	 * N° de Operación + Nombre Titular de la Cuenta (ver medioPagoLabel/numeroOperacion/
	 * nombreTitularCuenta). */
	esEfectivo: boolean;
	/** Label del Medio de Pago ya elegido en el formulario principal (ej. "Transferencia bancaria",
	 * "Yape o Plin") — solo cuando esEfectivo es false. */
	medioPagoLabel?: string;
	/** N° de Operación ya reconocido/ingresado en el formulario principal de la transacción
	 * (formValues.num_operacion) — solo cuando esEfectivo es false. */
	numeroOperacion?: string;
	/** Nombre de quien figura como titular de la cuenta desde la que se hizo la transferencia/Yape/
	 * depósito — solo cuando esEfectivo es false. Sin fuente en el formulario principal ni en ningún
	 * popup; queda "—" si no hay dato (ver TransaccionModal.svelte, construirDatosReciboPagoAuto). */
	nombreTitularCuenta?: string;
	/** Título de la sección 1 — por defecto "POR CONCEPTO DE". En un Ingreso de Categoría "Préstamo" es
	 * "BENEFICIARIO" (ver construirDatosReciboPagoAuto en TransaccionModal.svelte). */
	tituloSeccionConcepto?: string;
}

// Iconos SVG inline (calcados de Lucide "Banknote"/"Smartphone"/"Landmark") — a propósito, NO emojis:
// un emoji depende de la fuente del sistema operativo y puede verse distinto (o no verse) entre
// navegador, Tauri Windows y Tauri Android, violando el requisito multiplataforma.
const ICONO_BILLETE_LOGO = `<svg class="v-logo-icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>`;
const ICONO_BILLETE = `<svg class="v-icono-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>`;
const ICONO_TELEFONO = `<svg class="v-icono-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/></svg>`;
const ICONO_BANCO = `<svg class="v-icono-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/></svg>`;

/** Yape/Plin son pagos desde el celular -> ícono de teléfono; Transferencia/Depósito bancario ->
 * ícono de banco. Por texto del label (no un código aparte) para no depender de que quien llame le
 * pase un campo extra solo para esto. */
function iconoMedioPago(label: string): string {
	return /yape|plin/i.test(label) ? ICONO_TELEFONO : ICONO_BANCO;
}

function construirVoucherHtml(esCopia: boolean, datos: DatosReciboPago, sinMarcaAgua = false): string {
	const numeroTexto = `N° ${String(datos.numero).padStart(7, '0')}`;
	const horaActual = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });

	return `
		<div class="voucher-copia">
			<div class="v-header">
				<div class="v-empresa">
					<div class="v-logo">${ICONO_BILLETE_LOGO}</div>
					<div>
						<div class="v-empresa-nombre">${escapeHtml(EMPRESA_NOMBRE)}</div>
						<div class="v-empresa-ruc">RUC: ${escapeHtml(EMPRESA_RUC)}</div>
					</div>
				</div>
				<div class="v-header-right">
					<div class="v-numero-badge">${escapeHtml(numeroTexto)}</div>
					<div class="v-header-meta">
						<div class="v-titulo">${esCopia ? 'COPIA - ' : ''}RECIBO DE PAGO</div>
						<div>Fecha: ${escapeHtml(formatearFechaCorta(datos.fecha))}</div>
						<div>Página: 1 de 1</div>
					</div>
				</div>
			</div>

			<div class="v-intro">Yo, ${escapeHtml(datos.clienteNombre)}, identificado con RUC/DNI ${escapeHtml(datos.clienteDni)}, <b>dejo constancia de haber pagado a favor de ${escapeHtml(EMPRESA_NOMBRE)}</b>, identificado con RUC ${escapeHtml(EMPRESA_RUC)}, el importe que se detalla a continuación:</div>

			<div class="v-seccion">
				<div class="v-seccion-titulo"><span class="v-num-circulo">1</span> ${escapeHtml(datos.tituloSeccionConcepto || 'POR CONCEPTO DE')}</div>
				<div class="v-caja v-caja-1col">
					<div class="v-col-nombre" style="font-size:13px;font-weight:700;color:#1e293b;">${escapeHtml(datos.proyectoNombre)}</div>
					<div class="v-col-nombre">Código: ${escapeHtml(datos.proyectoCodigo)}</div>
				</div>
			</div>

			<div class="v-seccion">
				<div class="v-seccion-titulo"><span class="v-num-circulo">2</span> IMPORTE Y CONCEPTO</div>
				<div class="v-caja v-caja-2col">
					<div class="v-col">
						<div class="v-col-label">Importe (S/)</div>
						<div class="v-importe">${escapeHtml(formatearMonto(datos.monto))}</div>
						<div class="v-importe-letras">(${escapeHtml(montoEnLetras(datos.monto))})</div>
					</div>
					<div class="v-col">
						<div class="v-col-label">Concepto</div>
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
					<div class="v-col-nombre">El pago se realizó en efectivo por la suma indicada en el presente recibo.</div>`
							: `<div class="v-cashbox-row">${iconoMedioPago(datos.medioPagoLabel || '')} ${escapeHtml((datos.medioPagoLabel || '').toUpperCase())}</div>
					<div style="display:flex;gap:16px;margin-top:8px;">
						<div style="flex:1;min-width:0;">
							<div class="v-col-label">N° de Operación</div>
							<div class="v-col-codigo">${escapeHtml(datos.numeroOperacion || '—')}</div>
						</div>
						<div style="flex:1;min-width:0;">
							<div class="v-col-label">Nombre Titular de la Cuenta</div>
							<div class="v-col-codigo">${escapeHtml(datos.nombreTitularCuenta || '—')}</div>
						</div>
					</div>`
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
					<div class="v-firma-titulo">Firma digital del cliente<br>(Firma manuscrita)</div>
					<div class="v-firma-img-wrap">
						${datos.firmaClienteDataUrl ? `<img class="v-firma-img" src="${datos.firmaClienteDataUrl}" />` : ''}
					</div>
					<div class="v-firma-linea"></div>
					<div class="v-firma-nombre">${escapeHtml(datos.clienteNombre)}</div>
					<div class="v-firma-info">RUC/DNI: ${escapeHtml(datos.clienteDni)}<br>Fecha: ${escapeHtml(formatearFechaCorta(datos.fecha))} ${escapeHtml(horaActual)}</div>
				</div>
				<div class="v-firma">
					<div class="v-firma-titulo">Firma de quien recibe</div>
					<div class="v-firma-img-wrap">
						${datos.firmaReceptorDataUrl ? `<img class="v-firma-img" src="${datos.firmaReceptorDataUrl}" />` : ''}
					</div>
					<div class="v-firma-linea"></div>
					<div class="v-firma-nombre">${escapeHtml(datos.receptorNombre)}</div>
					<div class="v-firma-info">DNI: ${escapeHtml(datos.receptorDni)}<br>Fecha de recepción: ${escapeHtml(formatearFechaCorta(datos.fecha))} ${escapeHtml(horaActual)}</div>
				</div>
			</div>
			${sinMarcaAgua ? '' : marcaAguaBorrador(48)}
		</div>
	`;
}

async function renderVoucherComoImagen(esCopia: boolean, datos: DatosReciboPago, sinMarcaAgua = false) {
	const html = `<style>${ESTILOS_VOUCHER_BASE}</style>${construirVoucherHtml(esCopia, datos, sinMarcaAgua)}`;
	return renderHtmlToPngDataUrl(html, ANCHO_PLANTILLA_PX);
}

/** Arma el recibo como HTML autocontenido, sin pasar por html2canvas/jsPDF — mismo criterio que
 * construirHtmlCompleto en comprobanteTransferenciaInterna.ts/reciboPagoProveedor.ts: mientras la
 * transacción sigue siendo un borrador, el recibo queda en HTML; recién se convierte a PDF de verdad al
 * guardar/cerrar (ver handleSubmit en TransaccionModal.svelte). Fondo del body en blanco (antes gris-
 * azulado #e2e8f0) — a pedido explícito del usuario: si alguien imprime directo desde esta vista previa
 * (Ctrl+P sobre el popup), un fondo de página completo gasta tinta de sobra en cada impresión. El PDF
 * real (generarReciboPagoBase64/renderHtmlToPngDataUrl) ya usaba fondo blanco de por sí — esto solo
 * alinea la vista previa con lo que de verdad se imprime/descarga. */
export function construirHtmlCompleto(datos: DatosReciboPago): string {
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>RECIBO DE PAGO (borrador)</title><style>body{background:#ffffff;margin:0;padding:20px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}${ESTILOS_VOUCHER_BASE}.voucher-copia{max-width:${ANCHO_PLANTILLA_PX}px;margin:0 auto 16px;}</style></head><body>${construirVoucherHtml(false, datos)}${construirVoucherHtml(true, datos)}</body></html>`;
}

/** Arma el PDF completo (Original + Copia en una sola hoja) y lo devuelve en base64, listo para
 * guardarArchivoBinario — el ensamblado en la hoja A4 (incluida la escala si el contenido es más alto
 * de lo normal) vive centralizado en pdfHtmlRender.ts, ver ensamblarPdfDosCopiasA4. */
export async function generarReciboPagoBase64(datos: DatosReciboPago, sinMarcaAgua = false) {
	// Ticket #9: un solo punto por generador — cubre "Original + Copia" (dos renders de renderHtmlToPngDataUrl)
	// como UNA sola espera, en vez de parpadear entre cada mitad.
	registrarAccion('pdf', `Recibo de pago en efectivo N° ${datos.numero}`);
	return conCarga('Generando el recibo de pago…', () => generarReciboPagoBase64Interno(datos, sinMarcaAgua));
}

async function generarReciboPagoBase64Interno(datos: DatosReciboPago, sinMarcaAgua = false): Promise<string> {
	const [original, copia] = await Promise.all([
		renderVoucherComoImagen(false, datos, sinMarcaAgua),
		renderVoucherComoImagen(true, datos, sinMarcaAgua)
	]);
	return ensamblarPdfDosCopiasA4(original, copia);
}
