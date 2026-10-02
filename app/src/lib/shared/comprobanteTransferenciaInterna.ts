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
import { montoEnLetras } from './numeroALetras';
import { EMPRESA_NOMBRE, EMPRESA_RUC } from './empresaConstantes';
import { formatearFechaLarga, formatearFechaCorta, formatearMonto } from './pdfFormatoUtil';
import { renderHtmlToPngDataUrl, ensamblarPdfDosCopiasA4 } from './pdfHtmlRender';
import { ESTILOS_VOUCHER_BASE, ICONO_BRUJULA, marcaAguaBorrador, escapeHtml } from './pdfVoucherEstilos';
import { conCarga } from '$lib/stores/loading.svelte';
import { registrarAccion } from '$lib/shared/auditoria';

const ANCHO_PLANTILLA_PX = 750;

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

function construirVoucherHtml(esCopia: boolean, datos: DatosComprobanteInterno, sinMarcaAgua = false): string {
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
			${sinMarcaAgua ? '' : marcaAguaBorrador(56)}
		</div>
	`;
}

async function renderVoucherComoImagen(esCopia: boolean, datos: DatosComprobanteInterno, sinMarcaAgua = false) {
	const html = `<style>${ESTILOS_VOUCHER_BASE}</style>${construirVoucherHtml(esCopia, datos, sinMarcaAgua)}`;
	return renderHtmlToPngDataUrl(html, ANCHO_PLANTILLA_PX);
}

/** Arma el recibo como HTML autocontenido (Original + Copia, mismo contenido que el PDF) SIN pasar por
 * html2canvas/jsPDF — a pedido explícito del usuario: todo recibo autogenerado debe quedar en HTML
 * mientras la transacción sigue siendo un borrador (más liviano, nada que convertir todavía); recién se
 * convierte a PDF de verdad al guardar/cerrar la transacción (ver generarComprobanteTransferenciaInternaBase64,
 * que se sigue usando pero ahora se llama recién en ese momento — ver handleSubmit en
 * TransaccionModal.svelte). Pensado para abrirse en una pestaña nueva vía Blob URL. Fondo del body en
 * blanco (antes gris-azulado #e2e8f0) — a pedido explícito del usuario: si alguien imprime directo desde
 * esta vista previa (Ctrl+P sobre el popup), un fondo de página completo gasta tinta de sobra en cada
 * impresión. El PDF real (generarComprobanteTransferenciaInternaBase64/renderHtmlToPngDataUrl) ya usaba
 * fondo blanco de por sí — esto solo alinea la vista previa con lo que de verdad se imprime/descarga. */
export function construirHtmlCompleto(datos: DatosComprobanteInterno): string {
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>RECIBO - TRANSFERENCIA INTERNA (borrador)</title><style>body{background:#ffffff;margin:0;padding:20px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}${ESTILOS_VOUCHER_BASE}.voucher-copia{max-width:${ANCHO_PLANTILLA_PX}px;margin:0 auto 16px;}</style></head><body>${construirVoucherHtml(false, datos)}${construirVoucherHtml(true, datos)}</body></html>`;
}

/** Arma el PDF completo (Original + Copia en una sola hoja) y lo devuelve en base64, listo para
 * guardarArchivoBinario (mismo helper multiplataforma que ya usan las exportaciones y R1/R2). Cada
 * copia se renderiza por separado (mismo layout, solo cambia la etiqueta "COPIA -"); el ensamblado en
 * la hoja A4 (incluida la escala si el contenido es más alto de lo normal, ver ensamblarPdfDosCopiasA4)
 * vive centralizado en pdfHtmlRender.ts — antes esta lógica estaba triplicada por archivo. */
export async function generarComprobanteTransferenciaInternaBase64(datos: DatosComprobanteInterno, sinMarcaAgua = false) {
	// Ticket #9: un solo punto por generador — cubre "Original + Copia" (dos renders de renderHtmlToPngDataUrl)
	// como UNA sola espera, en vez de parpadear entre cada mitad.
	registrarAccion('pdf', `Comprobante de transferencia interna N° ${datos.numero}`);
	return conCarga('Generando el comprobante de transferencia…', () => generarComprobanteTransferenciaInternaBase64Interno(datos, sinMarcaAgua));
}

async function generarComprobanteTransferenciaInternaBase64Interno(datos: DatosComprobanteInterno, sinMarcaAgua = false): Promise<string> {
	const [original, copia] = await Promise.all([
		renderVoucherComoImagen(false, datos, sinMarcaAgua),
		renderVoucherComoImagen(true, datos, sinMarcaAgua)
	]);
	return ensamblarPdfDosCopiasA4(original, copia);
}
