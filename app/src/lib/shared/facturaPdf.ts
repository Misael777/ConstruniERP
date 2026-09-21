/**
 * Genera el PDF de una Factura/Boleta de Facturación (submódulo Finanzas > Facturación) — documento
 * INTERNO (no un comprobante electrónico SUNAT, ver factura.config.ts), pensado para vista previa e
 * impresión/descarga. Mismo pipeline HTML→PNG→PDF que reciboPagoEfectivo.ts/reciboPagoProveedor.ts
 * (renderHtmlToPngDataUrl + jsPDF, 100% cliente, funciona igual en navegador, Tauri Windows y
 * Tauri Android) pero con su propia plantilla (tabla de partidas, resumen de totales) en vez del
 * lenguaje visual v-* de los vouchers — y con ensamblarPdfUnaCopiaMultipagina en vez de "dos copias
 * en una hoja", porque una factura con muchas partidas debe paginar, no encogerse.
 */
import { montoEnLetras } from './numeroALetras';
import { EMPRESA_NOMBRE, EMPRESA_RUC } from './empresaConstantes';
import { formatearFechaCorta } from './pdfFormatoUtil';
import { renderHtmlToPngDataUrl, ensamblarPdfUnaCopiaMultipagina } from './pdfHtmlRender';
import { escapeHtml } from './pdfVoucherEstilos';

const ANCHO_PLANTILLA_PX = 800;

export interface DatosFacturaDetallePdf {
	codigo: string | null;
	descripcion: string;
	unidad: string | null;
	cantidad: number;
	precio_unitario: number;
	subtotal: number;
}

export interface DatosFacturaPdf {
	folio: string;
	tipoComprobante: 'factura' | 'boleta';
	tipoFactura: string;
	fechaEmision: string; // 'YYYY-MM-DD'
	fechaVencimiento: string | null;
	proyectoNombre: string;
	proyectoCodigo: string;
	clienteNombre: string;
	clienteDocumentoLabel: string; // 'RUC' | 'DNI' | 'CE' | '—'
	clienteDocumento: string;
	moneda: string; // 'PEN' | 'USD'
	detalle: DatosFacturaDetallePdf[];
	subtotal: number;
	porcentajeAmortizacion: number;
	montoAmortizacion: number;
	porcentajeRetencionGarantia: number;
	montoRetencionGarantia: number;
	montoIgv: number;
	montoTotal: number;
	comentarios: string | null;
	estado: string; // borrador | pendiente | pagado | vencido | anulada — solo para el sello
}

function simbolo(moneda: string): string {
	return moneda === 'USD' ? 'US$' : 'S/';
}

function formatoMonto(valor: number, moneda: string): string {
	return `${simbolo(moneda)} ${valor.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function construirHtml(datos: DatosFacturaPdf): string {
	const filas = datos.detalle
		.map(
			(d) => `
		<tr>
			<td class="f-td f-td-codigo">${escapeHtml(d.codigo ?? '—')}</td>
			<td class="f-td">${escapeHtml(d.descripcion)}</td>
			<td class="f-td f-td-center">${escapeHtml(d.unidad ?? '—')}</td>
			<td class="f-td f-td-right">${d.cantidad.toLocaleString('es-PE', { maximumFractionDigits: 4 })}</td>
			<td class="f-td f-td-right">${formatoMonto(d.precio_unitario, datos.moneda)}</td>
			<td class="f-td f-td-right f-td-strong">${formatoMonto(d.subtotal, datos.moneda)}</td>
		</tr>`
		)
		.join('');

	const sello = datos.estado === 'borrador' ? '<div class="f-sello f-sello-borrador">BORRADOR</div>' : datos.estado === 'anulada' ? '<div class="f-sello f-sello-anulada">ANULADA</div>' : '';

	return `
		<div class="f-doc">
			${sello}
			<div class="f-header">
				<div>
					<div class="f-empresa-nombre">${escapeHtml(EMPRESA_NOMBRE)}</div>
					<div class="f-empresa-ruc">RUC ${escapeHtml(EMPRESA_RUC)}</div>
				</div>
				<div class="f-header-right">
					<div class="f-tipo-badge">${datos.tipoComprobante === 'factura' ? 'FACTURA' : 'BOLETA DE VENTA'}</div>
					<div class="f-folio">${escapeHtml(datos.folio)}</div>
				</div>
			</div>

			<div class="f-meta-grid">
				<div>
					<div class="f-meta-label">Cliente</div>
					<div class="f-meta-value">${escapeHtml(datos.clienteNombre)}</div>
					<div class="f-meta-sub">${escapeHtml(datos.clienteDocumentoLabel)}: ${escapeHtml(datos.clienteDocumento || '—')}</div>
				</div>
				<div>
					<div class="f-meta-label">Proyecto</div>
					<div class="f-meta-value">${escapeHtml(datos.proyectoNombre)}</div>
					<div class="f-meta-sub">${escapeHtml(datos.proyectoCodigo)}</div>
				</div>
				<div>
					<div class="f-meta-label">Fecha Emisión</div>
					<div class="f-meta-value">${formatearFechaCorta(datos.fechaEmision)}</div>
					${datos.fechaVencimiento ? `<div class="f-meta-sub">Vence: ${formatearFechaCorta(datos.fechaVencimiento)}</div>` : ''}
				</div>
				<div>
					<div class="f-meta-label">Tipo de Factura</div>
					<div class="f-meta-value">${escapeHtml(datos.tipoFactura)}</div>
				</div>
			</div>

			<table class="f-table">
				<thead>
					<tr>
						<th class="f-th">Código</th>
						<th class="f-th">Descripción</th>
						<th class="f-th f-td-center">Unidad</th>
						<th class="f-th f-td-right">Cantidad</th>
						<th class="f-th f-td-right">P. Unitario</th>
						<th class="f-th f-td-right">Subtotal</th>
					</tr>
				</thead>
				<tbody>${filas}</tbody>
			</table>

			<div class="f-footer-grid">
				<div class="f-en-letras">
					<div class="f-meta-label">Son</div>
					<div class="f-meta-value">${escapeHtml(montoEnLetras(datos.montoTotal, datos.moneda === 'USD' ? 'DÓLARES' : 'SOLES'))}</div>
					${datos.comentarios ? `<div class="f-comentarios"><div class="f-meta-label">Comentarios</div><div class="f-meta-sub">${escapeHtml(datos.comentarios)}</div></div>` : ''}
				</div>
				<div class="f-totales">
					<div class="f-total-row"><span>Subtotal</span><span>${formatoMonto(datos.subtotal, datos.moneda)}</span></div>
					${datos.montoAmortizacion > 0 ? `<div class="f-total-row f-total-negativo"><span>(-) Amortización (${datos.porcentajeAmortizacion}%)</span><span>-${formatoMonto(datos.montoAmortizacion, datos.moneda)}</span></div>` : ''}
					${datos.montoRetencionGarantia > 0 ? `<div class="f-total-row f-total-negativo"><span>(-) Retención de Garantía (${datos.porcentajeRetencionGarantia}%)</span><span>-${formatoMonto(datos.montoRetencionGarantia, datos.moneda)}</span></div>` : ''}
					<div class="f-total-row"><span>(+) IGV (18%)</span><span>+${formatoMonto(datos.montoIgv, datos.moneda)}</span></div>
					<div class="f-total-row f-total-final"><span>Total a Pagar</span><span>${formatoMonto(datos.montoTotal, datos.moneda)}</span></div>
				</div>
			</div>
		</div>
	`;
}

const ESTILOS_FACTURA = `
	.f-doc { position: relative; font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; padding: 28px 32px; box-sizing: border-box; border: 1.5px solid #64748b; border-radius: 14px; }
	.f-sello { position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%) rotate(-28deg); font-weight: 800; font-size: 64px; letter-spacing: 0.15em; text-transform: uppercase; opacity: 0.16; pointer-events: none; z-index: 5; white-space: nowrap; }
	.f-sello-borrador { color: #64748b; }
	.f-sello-anulada { color: #dc2626; }
	.f-header { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 1px solid #dbe3ec; padding-bottom: 16px; margin-bottom: 18px; }
	.f-empresa-nombre { font-weight: 700; font-size: 17px; color: #0f3b5e; }
	.f-empresa-ruc { font-size: 12px; color: #64748b; margin-top: 2px; }
	.f-header-right { text-align: right; }
	.f-tipo-badge { display: inline-block; background: #0f3b5e; color: #fff; font-weight: 700; font-size: 12px; letter-spacing: 0.04em; padding: 4px 12px; border-radius: 6px; margin-bottom: 6px; }
	.f-folio { font-weight: 700; font-size: 16px; color: #0f3b5e; }
	.f-meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 18px; }
	.f-meta-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #94a3b8; font-weight: 600; margin-bottom: 2px; }
	.f-meta-value { font-size: 13px; font-weight: 600; color: #1e293b; }
	.f-meta-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
	.f-table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
	.f-th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.03em; color: #64748b; font-weight: 700; padding: 8px 8px; border-bottom: 1.5px solid #0f3b5e; }
	.f-td { font-size: 12px; padding: 8px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
	.f-td-codigo { font-family: 'SFMono-Regular', Consolas, monospace; font-size: 11px; color: #64748b; white-space: nowrap; }
	.f-td-center { text-align: center; }
	.f-td-right { text-align: right; white-space: nowrap; }
	.f-td-strong { font-weight: 600; }
	.f-footer-grid { display: flex; justify-content: space-between; gap: 24px; }
	.f-en-letras { flex: 1; min-width: 0; }
	.f-comentarios { margin-top: 14px; }
	.f-totales { width: 280px; flex-shrink: 0; }
	.f-total-row { display: flex; justify-content: space-between; font-size: 12.5px; padding: 5px 0; color: #334155; }
	.f-total-negativo span:last-child { color: #dc2626; }
	.f-total-final { border-top: 1.5px solid #0f3b5e; margin-top: 4px; padding-top: 10px; font-weight: 700; font-size: 15px; color: #0f3b5e; }
`;

/** Renderiza la plantilla a PNG y la ensambla en un PDF paginado. Devuelve tanto el data URL PNG (para
 * mostrar la vista previa dentro del modal, sin re-renderizar) como el PDF ya listo en base64. */
export async function generarFacturaPdf(datos: DatosFacturaPdf): Promise<{ pngDataUrl: string; pdfBase64: string }> {
	const html = `<style>${ESTILOS_FACTURA}</style>${construirHtml(datos)}`;
	const render = await renderHtmlToPngDataUrl(html, ANCHO_PLANTILLA_PX);
	const pdfBase64 = ensamblarPdfUnaCopiaMultipagina(render);
	return { pngDataUrl: render.dataUrl, pdfBase64 };
}
