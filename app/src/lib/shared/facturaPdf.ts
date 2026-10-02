/**
 * Genera el PDF/imagen de la FACTURA de Construni (submódulo Finanzas > Facturación) en el formato real
 * entregado por el usuario ("FACTURA ELECTRÓNICA", RUC, N° E001-…, Señor(es)/RUC/Dirección, tabla
 * Cantidad/Unidad/Descripción/Valor Unitario, SON, Sub Total Ventas … Importe Total y bloque opcional
 * "Información de la detracción"). Documento INTERNO — no es un comprobante electrónico SUNAT (ver
 * factura.config.ts). Mismo pipeline HTML→PNG→PDF que reciboPagoEfectivo.ts (renderHtmlToPngDataUrl +
 * jsPDF, 100% cliente: navegador, Tauri Windows y Tauri Android) pero paginado con
 * ensamblarPdfUnaCopiaMultipagina en vez de "dos copias en una hoja".
 */
import { montoEnLetras } from './numeroALetras';
import { EMPRESA_NOMBRE, EMPRESA_RUC, EMPRESA_DIRECCION } from './empresaConstantes';
import { LOGO_ICONO_DATA_URI } from './logoIconoDataUri';
import { formatearFechaCorta } from './pdfFormatoUtil';
import { renderHtmlToPngDataUrl, ensamblarPdfUnaCopiaMultipagina } from './pdfHtmlRender';
import { escapeHtml } from './pdfVoucherEstilos';
import { conCarga } from '$lib/stores/loading.svelte';
import { registrarAccion } from '$lib/shared/auditoria';

// A4 (210 × 297 mm) con 20 mm en blanco a la IZQUIERDA (para perforar las hojas impresas) y 10 mm en los
// otros 3 lados → contenido de 180 × 277 mm. La plantilla se renderiza a ese ancho EXACTO (180 mm a
// 96 dpi) y se coloca a escala 1:1 en el PDF, así mm/pt del CSS = mm/pt reales al imprimir.
const MM_A_PX = 96 / 25.4;
const ANCHO_CONTENIDO_MM = 180;
const ANCHO_PLANTILLA_PX = ANCHO_CONTENIDO_MM * MM_A_PX;
const MARGEN_IZQUIERDO_MM = 20;
const MARGEN_SUPERIOR_INFERIOR_MM = 10;
const FILAS_MINIMAS = 5;

export interface DatosFacturaLineaPdf {
	cantidad: number;
	unidad: string;
	descripcion: string;
	valorUnitario: number;
}

export interface DatosFacturaPdf {
	/** Define el rótulo de la caja de cabecera ("FACTURA ELECTRÓNICA"/"BOLETA..."/"NOTA DE CRÉDITO..."/
	 * "NOTA DE DÉBITO...") y la serie del placeholder de folio en la vista previa. */
	tipoDocumento: 'factura' | 'boleta' | 'nota_credito' | 'nota_debito';
	/** null = todavía sin número (vista previa antes de autorizar) — se imprime "____-________". */
	folio: string | null;
	fechaEmision: string; // 'YYYY-MM-DD'
	formaPago: 'contado' | 'credito';
	clienteNombre: string;
	clienteDocumentoLabel: string; // 'RUC' | 'DNI' | 'CE'
	clienteDocumento: string;
	clienteDireccion: string;
	moneda: 'PEN' | 'USD';
	observacion: string;
	lineas: DatosFacturaLineaPdf[];
	subTotalVentas: number;
	anticipos: number;
	descuentos: number;
	valorVenta: number;
	isc: number;
	igv: number;
	otrosCargos: number;
	otrosTributos: number;
	redondeo: number;
	importeTotal: number;
	sujetaDetraccion: boolean;
	porcentajeDetraccion: number;
	montoDetraccion: number;
	/** Solo Nota de Crédito: texto del "Tipo de nota de crédito" (ej. "Devolución Total"). */
	tipoNota?: string;
	detraccionTipoOperacion: string;
	detraccionBienServicio: string;
	/** "030 - Contratos de construcción" (catálogo "Código de Bien/Servicio sujeto a detracción"). */
	detraccionCodigoBien: string;
	detraccionMedioPago: string;
	detraccionCuentaBn: string;
	/** Sello de agua opcional (ej. 'VISTA PREVIA' antes de autorizar, 'ANULADA'). */
	marcaAgua?: string | null;
}

function simbolo(moneda: 'PEN' | 'USD'): string {
	return moneda === 'USD' ? 'US$' : 'S/';
}

function fmt(valor: number): string {
	return Number(valor || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCantidad(valor: number): string {
	return Number(valor || 0).toLocaleString('es-PE', { maximumFractionDigits: 4 });
}

const TITULO_CAJA: Record<DatosFacturaPdf['tipoDocumento'], string> = {
	factura: 'FACTURA ELECTRÓNICA',
	boleta: 'BOLETA DE VENTA ELECTRÓNICA',
	nota_credito: 'NOTA DE CRÉDITO ELECTRÓNICA',
	nota_debito: 'NOTA DE DÉBITO ELECTRÓNICA'
};

const ESTILOS = `
	/* Sello de agua (VISTA PREVIA / BORRADOR / ANULADA), común a todas las plantillas. */
	.fx-agua { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; pointer-events: none; z-index: 20; }
	.fx-agua span { font-weight: 800; font-size: 78px; letter-spacing: 0.12em; color: rgba(100,116,139,0.20); transform: rotate(-28deg); white-space: nowrap; }
	/* Plantilla Factura A4 — copia exacta del formato de referencia (imagen entregada por el usuario) en
	   MEDIDAS REALES: todo va en mm/pt y el contenedor mide 180 mm (A4 210 − 20 mm de margen izquierdo
	   en blanco para perforar − 10 mm derecho), que generarFacturaPdf coloca a escala 1:1 en la hoja.
	   min-height ≈ alto útil A4 (297 − 10 − 10 mm): ocupa una hoja completa con la nota y el pie pegados
	   al fondo; si hay muchas líneas crece y ensamblarPdfUnaCopiaMultipagina lo reparte en más páginas. */
	.fa { position: relative; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box; width: 100%; min-height: 276mm; background: #fff; color: #1e3a6d; font-family: Arial, Helvetica, sans-serif; }
	.fa * { box-sizing: border-box; }
	.fa-box { display: flex; align-items: center; min-height: 5.2mm; padding: 0 1.6mm; background: #dde5f1; border: 0.2mm solid #c3d0e4; border-radius: 0.8mm; font-size: 8pt; font-weight: 400; color: #0f172a; }
	.fa-lbl { font-weight: 700; font-size: 8pt; color: #1e3a6d; white-space: nowrap; }
	.fa-dp { width: 3mm; flex-shrink: 0; text-align: center; font-weight: 700; font-size: 8pt; color: #1e3a6d; }
	.fa-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2mm; }
	.fa-logo { display: flex; flex-direction: column; align-items: center; width: 34mm; flex-shrink: 0; }
	.fa-logo img { width: 17mm; height: auto; display: block; }
	.fa-logo-txt { margin-top: 1.5mm; font-weight: 800; font-size: 19pt; letter-spacing: -0.03em; line-height: 1; color: #1e3a6d; }
	.fa-emisor { flex: 1; min-width: 0; padding: 0 4mm 0 5mm; }
	.fa-emisor-nombre { font-weight: 800; font-size: 13pt; line-height: 1.15; text-transform: uppercase; }
	.fa-emisor-dir { margin-top: 1.5mm; max-width: 78mm; font-size: 6pt; line-height: 1.5; letter-spacing: 0.02em; color: #475569; }
	.fa-ruc { width: 60mm; flex-shrink: 0; border: 0.6mm solid #1e3a6d; border-radius: 3mm; overflow: hidden; text-align: center; }
	.fa-ruc-tit { background: #1e3a6d; color: #fff; font-weight: 800; font-size: 10.5pt; letter-spacing: 0.02em; padding: 2.4mm 1mm; }
	.fa-ruc-num { font-weight: 800; font-size: 12pt; padding: 2mm 1mm 1.2mm; }
	.fa-ruc-nro { display: flex; align-items: center; justify-content: center; gap: 1.5mm; font-weight: 800; font-size: 10.5pt; padding: 0 2mm 2.2mm; }
	.fa-ruc-nro .fa-box { min-width: 30mm; min-height: 5mm; justify-content: center; font-weight: 700; }
	.fa-datos { margin-bottom: 2mm; }
	.fa-fila { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2mm; }
	.fa-grupo { display: flex; align-items: center; }
	.fa-tabla { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 2mm; }
	.fa-tabla th { height: 9mm; background: #1e3a6d; color: #fff; font-size: 8pt; font-weight: 700; text-align: center; border: 0.2mm solid #1e3a6d; border-bottom: 0.9mm solid #f26a21; }
	.fa-tabla td { height: 6.6mm; padding: 0 1.6mm; font-size: 8pt; color: #0f172a; border: 0.25mm solid #2b4a7a; overflow: hidden; }
	.fa-c { text-align: center; }
	.fa-r { text-align: right; white-space: nowrap; }
	.fa-bajo { display: flex; align-items: flex-start; gap: 6mm; margin-bottom: 2mm; }
	.fa-bajo-izq { width: 94mm; flex-shrink: 0; }
	.fa-grat { display: flex; align-items: center; }
	.fa-grat .fa-lbl { font-size: 6.5pt; }
	.fa-grat .fa-box { width: 28mm; justify-content: space-between; }
	.fa-son { margin-top: 3mm; min-height: 27mm; padding: 2mm 2.4mm; background: #dde5f1; border: 0.2mm solid #c3d0e4; border-radius: 1mm; font-size: 8pt; line-height: 1.4; color: #0f172a; }
	.fa-son b { margin-right: 1.5mm; font-size: 10pt; color: #1e3a6d; }
	.fa-tot { flex: 1; min-width: 0; padding: 2mm 2mm 0; border: 0.3mm solid #2b4a7a; border-radius: 1.5mm; overflow: hidden; }
	.fa-tot-fila { display: flex; align-items: center; margin-bottom: 1.4mm; }
	.fa-tot-fila .fa-lbl { flex: 1; text-align: right; font-size: 7.5pt; }
	.fa-tot-fila .fa-box { width: 27mm; min-height: 4.6mm; justify-content: space-between; }
	.fa-tot-final { margin: 1.5mm -2mm 0; padding: 1.8mm 2mm; background: #f26a21; }
	.fa-tot-final .fa-lbl { color: #fff; font-size: 9pt; }
	.fa-tot-final .fa-dp { color: #fff; }
	.fa-tot-final .fa-box { background: #fff; border-color: #fff; font-weight: 700; }
	.fa-det { margin-top: 2mm; }
	.fa-det-tit { padding: 1.5mm 2.4mm; background: #1e3a6d; color: #fff; font-weight: 800; font-size: 8pt; letter-spacing: 0.02em; }
	.fa-det-cuerpo { display: grid; grid-template-columns: 1fr 1fr; gap: 1.6mm 4mm; padding: 2.4mm; background: #eef2f8; border: 0.2mm solid #c3d0e4; }
	.fa-det-fila { display: flex; align-items: center; }
	.fa-det-fila .fa-lbl { width: 34mm; font-size: 7pt; white-space: normal; }
	.fa-det-fila .fa-box { flex: 1; min-width: 0; font-size: 7pt; background: #fff; }
	.fa-footer { padding-top: 2mm; }
	.fa-nota { padding: 2.6mm 3mm; background: #dde5f1; border: 0.2mm solid #c3d0e4; border-radius: 1.5mm; text-align: center; font-size: 6.5pt; line-height: 1.5; color: #334155; }
	.fa-pie { display: flex; align-items: center; justify-content: space-between; margin-top: 4mm; }
	.fa-pie-txt { padding-left: 2.2mm; border-left: 1.2mm solid #f26a21; font-size: 7pt; line-height: 1.6; color: #1e3a6d; }
	.fa-pie-web { width: 46mm; padding: 2.4mm 0; background: #f26a21; border-radius: 0.8mm; text-align: center; font-weight: 800; font-size: 8.5pt; color: #fff; }

	/* Plantilla "simple" v2 — Boleta / Nota de Crédito / Nota de Débito (formato de referencia entregado
	   por el usuario: caja con título+SERIE/N°, grilla de cliente a 2 columnas con divisor, tabla de 5
	   columnas con "Importe", panel de letras a la izquierda y totales simples a la derecha, pie con
	   barra naranja de cierre). Misma paleta que Factura (#1e3a6d navy, #f26a21 naranja) pero con su
	   propia cabecera/pie (fs-*), independiente de Factura. */
	.fs { position: relative; display: flex; flex-direction: column; min-height: 276mm; font-family: Arial, Helvetica, sans-serif; color: #1e293b; background: #fff; padding: 22px 26px 0; box-sizing: border-box; border: 1.5px solid #1e3a6d; overflow: hidden; }
	.fs * { box-sizing: border-box; }
	.fs-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #1e3a6d; padding-bottom: 10px; margin-bottom: 12px; }
	.fs-logo-section { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
	.fs-logo-img { width: 48px; height: auto; display: block; flex-shrink: 0; }
	.fs-company-info h1 { margin: 0; font-weight: 800; font-size: 13px; color: #1e3a6d; text-transform: uppercase; line-height: 1.25; }
	.fs-company-info p { margin: 2px 0 0; font-size: 10px; color: #555; }
	.fs-box { width: 230px; flex-shrink: 0; border: 2px solid #1e3a6d; border-radius: 4px; overflow: hidden; }
	.fs-box-header { background: #1e3a6d; color: #fff; text-align: center; font-weight: 800; font-size: 11px; padding: 5px 6px; letter-spacing: 0.02em; }
	.fs-box-body { padding: 6px 8px; font-size: 11px; font-weight: 700; display: flex; justify-content: space-between; color: #1e3a6d; }
	.fs-info-grid { display: flex; margin-bottom: 10px; }
	.fs-info-col { padding-right: 10px; }
	.fs-info-col:first-child { width: 55%; border-right: 1px solid #1e3a6d; }
	.fs-info-col:last-child { width: 45%; padding-left: 10px; padding-right: 0; }
	.fs-info-row { display: flex; margin-bottom: 4px; align-items: center; gap: 6px; }
	.fs-info-label { width: 130px; flex-shrink: 0; font-weight: 700; color: #1e3a6d; font-size: 10.5px; }
	.fs-info-value { flex: 1; min-width: 0; background: #e7edf6; border: 1px solid #c9d6e8; border-radius: 3px; padding: 3px 7px; min-height: 17px; font-size: 10.5px; color: #0f172a; display: flex; align-items: center; }
	.fs-tabla { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
	.fs-tabla th { background: #1e3a6d; color: #fff; font-size: 10.5px; font-weight: 700; padding: 6px 7px; border: 1px solid #1e3a6d; text-align: center; }
	.fs-tabla td { font-size: 10.5px; padding: 5px 7px; border: 1px solid #cbd5e1; height: 22px; vertical-align: top; }
	.fs-c { text-align: center; }
	.fs-r { text-align: right; white-space: nowrap; }
	.fs-bottom { display: flex; gap: 12px; margin-bottom: 12px; align-items: flex-start; }
	.fs-left-panel { flex: 1; min-width: 0; border: 1px solid #1e3a6d; border-radius: 4px; padding: 8px 10px; }
	.fs-letras-box { margin-bottom: 8px; }
	.fs-letras-title { font-weight: 700; font-size: 10.5px; color: #1e3a6d; margin-bottom: 3px; }
	.fs-letras-content { background: #e7edf6; border: 1px solid #c9d6e8; border-radius: 3px; padding: 5px 8px; min-height: 20px; font-size: 10.5px; color: #0f172a; }
	.fs-referencia { font-size: 9.5px; color: #475569; margin-top: 6px; line-height: 1.4; }
	.fs-referencia b { color: #1e3a6d; }
	.fs-right-panel { width: 260px; flex-shrink: 0; }
	.fs-total-table { width: 100%; border-collapse: collapse; }
	.fs-total-table td { border: 1px solid #cbd5e1; padding: 5px 8px; font-size: 10.5px; }
	.fs-total-label { background: #f1f5f9; font-weight: 700; color: #1e3a6d; width: 60%; }
	.fs-total-amount { text-align: right; width: 40%; }
	.fs-total-final td { background: #f26a21; color: #fff; font-weight: 800; font-size: 11.5px; border-color: #f26a21; }
	.fs-footer { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #1e3a6d; padding-top: 6px; margin-top: auto; font-size: 9.5px; color: #555; }
	.fs-footer-logo { color: #f26a21; font-weight: 800; font-size: 11px; }
	.fs-bottom-line { height: 5px; background: #f26a21; margin: 6px -26px 0; }
`;

function filaTot(etiqueta: string, valor: string, sim: string): string {
	return `<div class="fa-tot-fila"><span class="fa-lbl">${escapeHtml(etiqueta)}</span><span class="fa-dp">:</span><span class="fa-box"><span>${escapeHtml(sim)}</span><span>${escapeHtml(valor)}</span></span></div>`;
}

function filaDato(etiqueta: string, valor: string, estiloBox = ''): string {
	return `<div class="fa-fila"><div class="fa-grupo"><span class="fa-lbl" style="width:30mm">${escapeHtml(etiqueta)}</span><span class="fa-dp">:</span><span class="fa-box" style="width:82mm;${estiloBox}">${escapeHtml(valor)}</span></div></div>`;
}

function construirHtml(d: DatosFacturaPdf): string {
	const sim = simbolo(d.moneda);
	const filas = d.lineas.map(
		(l) => `<tr>
			<td class="fa-c">${fmtCantidad(l.cantidad)}</td>
			<td class="fa-c">${escapeHtml(l.unidad)}</td>
			<td>${escapeHtml(l.descripcion)}</td>
			<td class="fa-r">${sim} ${fmt(l.valorUnitario)}</td>
		</tr>`
	);
	while (filas.length < FILAS_MINIMAS) filas.push('<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>');

	// Esta función solo se usa para Factura (Boleta/Notas usan construirHtmlSimple, con su propio formato).
	const { serie, correlativo } = serieYCorrelativo(d);
	const nombreMoneda = d.moneda === 'USD' ? 'DÓLARES' : 'SOLES';
	const son = montoEnLetras(d.importeTotal, nombreMoneda);

	const bloqueDetraccion = d.sujetaDetraccion
		? `<div class="fa-det">
				<div class="fa-det-tit">INFORMACIÓN DE LA DETRACCIÓN</div>
				<div class="fa-det-cuerpo">
					<div class="fa-det-fila"><span class="fa-lbl">Leyenda</span><span class="fa-box">Operación sujeta al Sistema de Pago de Obligaciones Tributarias con el Gobierno Central.</span></div>
					<div class="fa-det-fila"><span class="fa-lbl">Tipo de operación</span><span class="fa-box">${escapeHtml(d.detraccionTipoOperacion)}</span></div>
					<div class="fa-det-fila"><span class="fa-lbl">Bien o Servicio</span><span class="fa-box">${escapeHtml(d.detraccionBienServicio)}</span></div>
					<div class="fa-det-fila"><span class="fa-lbl">Código de Bien/Servicio</span><span class="fa-box">${escapeHtml(d.detraccionCodigoBien)}</span></div>
					<div class="fa-det-fila"><span class="fa-lbl">Medio de pago</span><span class="fa-box">${escapeHtml(d.detraccionMedioPago)}</span></div>
					<div class="fa-det-fila"><span class="fa-lbl">Nro. Cta. Banco de la Nación</span><span class="fa-box">${escapeHtml(d.detraccionCuentaBn)}</span></div>
					<div class="fa-det-fila"><span class="fa-lbl">Porcentaje de detracción</span><span class="fa-box">${escapeHtml(String(d.porcentajeDetraccion))} %</span></div>
					<div class="fa-det-fila"><span class="fa-lbl">Monto de detracción</span><span class="fa-box">${sim} ${fmt(d.montoDetraccion)}</span></div>
				</div>
			</div>`
		: '';

	return `
		<div class="fa">
			${d.marcaAgua ? `<div class="fx-agua"><span>${escapeHtml(d.marcaAgua)}</span></div>` : ''}
			<div class="fa-head">
				<div class="fa-logo"><img src="${LOGO_ICONO_DATA_URI}" alt="" /><span class="fa-logo-txt">construni</span></div>
				<div class="fa-emisor">
					<div class="fa-emisor-nombre">${escapeHtml(EMPRESA_NOMBRE)}</div>
					<div class="fa-emisor-dir">${escapeHtml(EMPRESA_DIRECCION)}</div>
				</div>
				<div class="fa-ruc">
					<div class="fa-ruc-tit">${escapeHtml(TITULO_CAJA.factura)}</div>
					<div class="fa-ruc-num">RUC: ${escapeHtml(EMPRESA_RUC)}</div>
					<div class="fa-ruc-nro"><span>N° ${escapeHtml(serie)} -</span><span class="fa-box">${d.folio ? escapeHtml(correlativo) : ''}</span></div>
				</div>
			</div>

			<div class="fa-datos">
				<div class="fa-fila">
					<div class="fa-grupo"><span class="fa-lbl" style="width:30mm">Fecha de Emisión</span><span class="fa-dp">:</span><span class="fa-box" style="width:82mm">${formatearFechaCorta(d.fechaEmision)}</span></div>
					<div class="fa-grupo"><span class="fa-lbl">Forma de pago</span><span class="fa-dp">:</span><span class="fa-box" style="width:27mm">${d.formaPago === 'credito' ? 'Crédito' : 'Contado'}</span></div>
				</div>
				${filaDato('Señor(es)', d.clienteNombre)}
				${filaDato(d.clienteDocumentoLabel || 'RUC', d.clienteDocumento)}
				${filaDato('Dirección del Cliente', d.clienteDireccion, 'min-height:14.5mm;align-items:flex-start;padding-top:1mm;')}
				${filaDato('Tipo de Moneda', nombreMoneda)}
				${filaDato('Observación', d.observacion)}
			</div>

			<table class="fa-tabla">
				<colgroup><col style="width:28mm" /><col style="width:35mm" /><col style="width:73mm" /><col style="width:44mm" /></colgroup>
				<thead><tr><th>Cantidad</th><th>Unidad Medida</th><th>Descripción</th><th>Valor Unitario</th></tr></thead>
				<tbody>${filas.join('')}</tbody>
			</table>

			<div class="fa-bajo">
				<div class="fa-bajo-izq">
					<div class="fa-grat"><span class="fa-lbl">Valor de Venta de Operaciones Gratuitas</span><span class="fa-dp">:</span><span class="fa-box"><span>${sim}</span><span>0.00</span></span></div>
					<div class="fa-son"><b>SON:</b>${escapeHtml(son)}</div>
				</div>
				<div class="fa-tot">
					${filaTot('Sub Total Ventas', fmt(d.subTotalVentas), sim)}
					${filaTot('Anticipos', fmt(d.anticipos), sim)}
					${filaTot('Descuentos', fmt(d.descuentos), sim)}
					${filaTot('Valor Venta', fmt(d.valorVenta), sim)}
					${filaTot('ISC', fmt(d.isc), sim)}
					${filaTot('IGV', fmt(d.igv), sim)}
					${filaTot('Otros Cargos', fmt(d.otrosCargos), sim)}
					${filaTot('Otros Tributos', fmt(d.otrosTributos), sim)}
					${filaTot('Monto de redondeo', fmt(d.redondeo), sim)}
					<div class="fa-tot-fila fa-tot-final"><span class="fa-lbl">Importe Total</span><span class="fa-dp">:</span><span class="fa-box"><span>${sim}</span><span>${fmt(d.importeTotal)}</span></span></div>
				</div>
			</div>

			${bloqueDetraccion}

			<div class="fa-footer">
				<div class="fa-nota">Esta es una representación impresa de la factura electrónica, generada en el Sistema de SUNAT.<br />Puede verificarla utilizando su clave SOL.</div>
				<div class="fa-pie"><span class="fa-pie-txt">Más de 12 años construyendo tu futuro</span><span class="fa-pie-web">www.construni.pe</span></div>
			</div>
		</div>
	`;
}

/** Serie/correlativo separados a partir del folio ("B001-00000001" -> "B001"/"00000001") — el formato
 * simple los muestra en dos líneas ("SERIE: B001" / "N° 00000001"), a diferencia de Factura que los
 * imprime juntos ("N° E001-00000001"). Sin folio todavía (vista previa) se usa la serie real de cada
 * tipo con un placeholder de correlativo. */
const SERIE_POR_TIPO: Record<DatosFacturaPdf['tipoDocumento'], string> = {
	factura: 'E001',
	boleta: 'B001',
	nota_credito: 'NC01',
	nota_debito: 'ND01'
};
function serieYCorrelativo(d: DatosFacturaPdf): { serie: string; correlativo: string } {
	if (!d.folio) return { serie: SERIE_POR_TIPO[d.tipoDocumento], correlativo: '________' };
	const [serie, correlativo] = d.folio.split('-');
	return { serie: serie ?? SERIE_POR_TIPO[d.tipoDocumento], correlativo: correlativo ?? '________' };
}

/** Plantilla "simple" v2 — Boleta / Nota de Crédito / Nota de Débito (formato de referencia entregado
 * por el usuario: caja de cabecera con título/SERIE/N° en una sola caja navy, grilla de 2 columnas
 * (55/45 con divisor) para los datos del cliente, tabla de 5 columnas con "Importe", panel izquierdo
 * bordeado con "Importe en letras"/observaciones y panel derecho con tabla de totales simple). Para
 * Nota de Crédito/Débito, "Observación" se muestra rotulada como "Motivo de la Nota" (mismo campo del
 * formulario — a pedido explícito del usuario, sin reintroducir un selector de "documento relacionado",
 * dato que este submódulo no registra). */
function construirHtmlSimple(d: DatosFacturaPdf): string {
	const sim = simbolo(d.moneda);
	const esNota = d.tipoDocumento === 'nota_credito' || d.tipoDocumento === 'nota_debito';
	const { serie, correlativo } = serieYCorrelativo(d);
	const nombreMoneda = d.moneda === 'USD' ? 'DÓLARES' : 'SOLES';
	const son = montoEnLetras(d.importeTotal, nombreMoneda);

	const filas = d.lineas.map(
		(l) => `<tr>
			<td class="fs-c">${fmtCantidad(l.cantidad)}</td>
			<td class="fs-c">${escapeHtml(l.unidad)}</td>
			<td>${escapeHtml(l.descripcion)}</td>
			<td class="fs-r">${sim} ${fmt(l.valorUnitario)}</td>
			<td class="fs-r">${sim} ${fmt(l.cantidad * l.valorUnitario)}</td>
		</tr>`
	);
	while (filas.length < FILAS_MINIMAS) filas.push('<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>');

	return `
		<div class="fs">
			${d.marcaAgua ? `<div class="fx-agua"><span>${escapeHtml(d.marcaAgua)}</span></div>` : ''}
			<div class="fs-head">
				<div class="fs-logo-section">
					<img class="fs-logo-img" src="${LOGO_ICONO_DATA_URI}" alt="" />
					<div class="fs-company-info">
						<h1>${escapeHtml(EMPRESA_NOMBRE)}</h1>
						<p>${escapeHtml(EMPRESA_DIRECCION)}</p>
						<p>RUC: ${escapeHtml(EMPRESA_RUC)}</p>
					</div>
				</div>
				<div class="fs-box">
					<div class="fs-box-header">${escapeHtml(TITULO_CAJA[d.tipoDocumento])}</div>
					<div class="fs-box-body"><span>SERIE: ${escapeHtml(serie)}</span><span>N° ${escapeHtml(correlativo)}</span></div>
				</div>
			</div>

			<div class="fs-info-grid">
				<div class="fs-info-col">
					<div class="fs-info-row"><span class="fs-info-label">Fecha de Emisión</span><span class="fs-info-value">: ${formatearFechaCorta(d.fechaEmision)}</span></div>
					<div class="fs-info-row"><span class="fs-info-label">Señores</span><span class="fs-info-value">: ${escapeHtml(d.clienteNombre)}</span></div>
					<div class="fs-info-row"><span class="fs-info-label">Dirección</span><span class="fs-info-value">: ${escapeHtml(d.clienteDireccion)}</span></div>
					<div class="fs-info-row"><span class="fs-info-label">${escapeHtml(d.clienteDocumentoLabel || 'RUC')}</span><span class="fs-info-value">: ${escapeHtml(d.clienteDocumento)}</span></div>
					<div class="fs-info-row"><span class="fs-info-label">Tipo de Moneda</span><span class="fs-info-value">: ${nombreMoneda}</span></div>
					${!esNota ? `<div class="fs-info-row"><span class="fs-info-label">Observación</span><span class="fs-info-value">: ${escapeHtml(d.observacion)}</span></div>` : ''}
				</div>
				<div class="fs-info-col">
					<div class="fs-info-row"><span class="fs-info-label">Tipo de Documento</span><span class="fs-info-value">: ${escapeHtml(d.clienteDocumentoLabel || 'RUC')}</span></div>
					<div class="fs-info-row"><span class="fs-info-label">Forma de Pago</span><span class="fs-info-value">: ${d.formaPago === 'credito' ? 'CRÉDITO' : 'CONTADO'}</span></div>
					${d.tipoDocumento === 'nota_credito' && d.tipoNota ? `<div class="fs-info-row"><span class="fs-info-label">Tipo de Nota</span><span class="fs-info-value">: ${escapeHtml(d.tipoNota)}</span></div>` : ''}
					${esNota ? `<div class="fs-info-row"><span class="fs-info-label">Motivo de la Nota</span><span class="fs-info-value">: ${escapeHtml(d.observacion || '—')}</span></div>` : ''}
				</div>
			</div>

			<table class="fs-tabla">
				<thead><tr><th style="width:10%">Cantidad</th><th style="width:12%">U.M.</th><th>Descripción</th><th style="width:16%">Valor Unitario</th><th style="width:16%">Importe</th></tr></thead>
				<tbody>${filas.join('')}</tbody>
			</table>

			<div class="fs-bottom">
				<div class="fs-left-panel">
					<div class="fs-letras-box">
						<div class="fs-letras-title">Importe en letras:</div>
						<div class="fs-letras-content">${escapeHtml(son)}</div>
					</div>
					<div class="fs-referencia"><b>Resumen:</b> Documento generado por el Sistema de Gestión de Comprobantes de Construni.</div>
				</div>
				<div class="fs-right-panel">
					<table class="fs-total-table">
						<tr><td class="fs-total-label">Sub Total</td><td class="fs-total-amount">${sim} ${fmt(d.valorVenta)}</td></tr>
						<tr><td class="fs-total-label">IGV (18%)</td><td class="fs-total-amount">${sim} ${fmt(d.igv)}</td></tr>
						<tr class="fs-total-final"><td>Importe Total</td><td class="fs-total-amount">${sim} ${fmt(d.importeTotal)}</td></tr>
					</table>
				</div>
			</div>

			<div class="fs-footer">
				<div>Esta es una representación impresa del ${escapeHtml(TITULO_CAJA[d.tipoDocumento].toLowerCase())}. Puede verificarla utilizando su clave SOL.</div>
				<div class="fs-footer-logo">www.construni.pe</div>
			</div>
			<div class="fs-bottom-line"></div>
		</div>
	`;
}

/** Renderiza la plantilla a PNG y la ensambla en un PDF paginado. Devuelve tanto el data URL PNG (vista
 * previa dentro del modal y archivo que se guarda en Drive) como el PDF ya listo en base64. Factura usa
 * su propia plantilla (sin cambios); Boleta/Nota de Crédito/Nota de Débito usan el formato "simple"
 * entregado por el usuario (ver construirHtmlSimple). */
export async function generarFacturaPdf(datos: DatosFacturaPdf) {
	// Ticket #9: un solo punto por generador — cubre "Original + Copia" (dos renders de renderHtmlToPngDataUrl)
	// como UNA sola espera, en vez de parpadear entre cada mitad.
	registrarAccion('pdf', `${datos.tipoDocumento.replace('_', ' ')} ${datos.folio ?? '(sin folio)'} — ${datos.clienteNombre}`);
	return conCarga('Generando el PDF de la factura…', () => generarFacturaPdfInterno(datos));
}

async function generarFacturaPdfInterno(datos: DatosFacturaPdf): Promise<{ pngDataUrl: string; pdfBase64: string }> {
	const html = `<style>${ESTILOS}</style>${datos.tipoDocumento === 'factura' ? construirHtml(datos) : construirHtmlSimple(datos)}`;
	const render = await renderHtmlToPngDataUrl(html, ANCHO_PLANTILLA_PX);
	const pdfBase64 = ensamblarPdfUnaCopiaMultipagina(render, {
		anchoMm: ANCHO_CONTENIDO_MM,
		margenIzquierdoMm: MARGEN_IZQUIERDO_MM,
		margenSuperiorMm: MARGEN_SUPERIOR_INFERIOR_MM,
		margenInferiorMm: MARGEN_SUPERIOR_INFERIOR_MM
	});
	return { pngDataUrl: render.dataUrl, pdfBase64 };
}
