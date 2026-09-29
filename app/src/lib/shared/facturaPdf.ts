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

const ANCHO_PLANTILLA_PX = 820;
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
	detraccionBienServicio: string;
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
	/* min-height = proporción A4 (820px de ancho × 297/210): la factura ocupa una hoja completa con la nota y el
	   pie pegados al fondo (margin-top:auto en .fx-nota), con o sin bloque de detracción. Si el contenido es más
	   alto (muchas líneas), crece y ensamblarPdfUnaCopiaMultipagina lo reparte en más páginas. */
	.fx-agua { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; pointer-events: none; z-index: 20; }
	.fx-agua span { font-weight: 800; font-size: 78px; letter-spacing: 0.12em; color: rgba(100,116,139,0.20); transform: rotate(-28deg); white-space: nowrap; }
	.fx-c { text-align: center; }
	.fx-r { text-align: right; white-space: nowrap; }
	.fx-nota { margin-top: auto; background: #e7edf6; border: 1px solid #c9d6e8; border-radius: 6px; text-align: center; font-size: 10px; color: #334155; padding: 7px 10px; margin-bottom: 12px; line-height: 1.4; }
	.fx-pie { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #1e3a6d; padding: 6px 0 0; font-size: 9.5px; color: #64748b; }
	.fx-pie b { color: #fff; background: #f26a21; font-weight: 800; font-size: 10.5px; padding: 3px 9px; border-radius: 3px; }

	/* Plantilla Factura v4 — formato de referencia entregado por el usuario (caja de cabecera navy con
	   título/RUC/N° apilados a la derecha, grilla de 2 columnas para los datos del cliente en vez de filas
	   apiladas, panel de totales a la derecha con caja gris "SON" a la izquierda, y una barra naranja de
	   vigencia a todo el ancho pegada al fondo de la hoja). Mantiene el logo/RUC/dirección reales de
	   Construni y el detalle completo (todas las líneas de totales + detracción) — solo cambia la
	   disposición visual, no los datos. */
	.fv { position: relative; display: flex; flex-direction: column; min-height: 1160px; font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; background: #fff; padding: 26px 30px 0; box-sizing: border-box; border: 2px solid #1e3a6d; overflow: hidden; }
	.fv * { box-sizing: border-box; }
	.fv-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; margin-bottom: 18px; }
	.fv-logo-section { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; }
	.fv-logo-img { width: 56px; height: auto; display: block; flex-shrink: 0; }
	.fv-company-info h1 { margin: 0; font-weight: 800; font-size: 18px; color: #1e3a6d; line-height: 1.2; }
	.fv-company-info p { margin: 4px 0 0; font-size: 10.5px; color: #475569; line-height: 1.35; }
	.fv-ruc-box { width: 240px; flex-shrink: 0; border: 2px solid #1e3a6d; border-radius: 4px; overflow: hidden; text-align: center; }
	.fv-ruc-header { background: #1e3a6d; color: #fff; font-weight: 800; font-size: 13px; letter-spacing: 0.02em; padding: 6px 8px; }
	.fv-ruc-number { color: #1e3a6d; font-weight: 700; font-size: 12.5px; padding: 6px 8px; border-bottom: 1px solid #1e3a6d; }
	.fv-doc-number { color: #1e3a6d; font-weight: 800; font-size: 12.5px; padding: 6px 8px; }
	.fv-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 20px; margin-bottom: 14px; }
	.fv-input-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; font-size: 11px; }
	.fv-input-label { width: 130px; flex-shrink: 0; font-weight: 700; color: #1e3a6d; }
	.fv-input-field { flex: 1; min-width: 0; background: #e7edf6; border: 1px solid #c9d6e8; border-radius: 3px; padding: 3px 8px; min-height: 18px; color: #0f172a; display: flex; align-items: center; }
	.fv-table-container { margin-bottom: 12px; }
	.fv-items-table { width: 100%; border-collapse: collapse; }
	.fv-items-table th { background: #1e3a6d; color: #fff; font-size: 11px; font-weight: 700; padding: 8px 8px; border-bottom: 3px solid #f26a21; text-align: center; }
	.fv-items-table td { font-size: 11.5px; padding: 6px 8px; border: 1px solid #cbd5e1; height: 26px; vertical-align: top; }
	.fv-bottom-section { display: flex; gap: 18px; align-items: flex-start; margin-bottom: 14px; }
	.fv-left-panel { flex: 1; min-width: 0; }
	.fv-right-panel { width: 300px; flex-shrink: 0; }
	.fv-gray-box { background: #e7edf6; border: 1px solid #c9d6e8; border-radius: 3px; padding: 9px 12px; font-size: 11.5px; min-height: 60px; margin-top: 8px; }
	.fv-gray-box b { color: #1e3a6d; font-size: 12px; margin-right: 6px; }
	.fv-total-row { display: flex; justify-content: space-between; font-size: 11.5px; padding: 4px 2px; border-bottom: 1px solid #e2e8f0; }
	.fv-total-row span:first-child { font-weight: 700; color: #1e3a6d; }
	.fv-total-row span:last-child { color: #334155; }
	.fv-grand-total { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; background: #f26a21; color: #fff; border-radius: 5px; padding: 8px 10px; font-weight: 800; font-size: 13px; }
	.fv-detraction-box { background: #1e3a6d; color: #fff; font-weight: 800; font-size: 11.5px; padding: 7px 12px; margin-bottom: 2px; letter-spacing: 0.02em; }
	.fv-detraction-content { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; background: #f1f5f9; border: 1px solid #e2e8f0; padding: 9px 12px; margin-bottom: 12px; }
	.fv-detraction-row { display: flex; align-items: center; gap: 8px; font-size: 10.5px; color: #334155; font-weight: 600; }
	.fv-detraction-label { width: 140px; flex-shrink: 0; color: #1e3a6d; }
	.fv-detraction-val { flex: 1; min-width: 0; background: #fff; border: 1px solid #cbd5e1; border-radius: 3px; min-height: 18px; padding: 2px 6px; color: #0f172a; font-weight: 500; }
	.fv-bottom-bar { height: 6px; background: #f26a21; margin: 6px -30px 0; }
	.fv-validity { text-align: center; font-size: 9.5px; color: #64748b; padding: 5px 0 0; }

	/* Plantilla "simple" v2 — Boleta / Nota de Crédito / Nota de Débito (formato de referencia entregado
	   por el usuario: caja con título+SERIE/N°, grilla de cliente a 2 columnas con divisor, tabla de 5
	   columnas con "Importe", panel de letras a la izquierda y totales simples a la derecha, pie con
	   barra naranja de cierre). Misma paleta que Factura (#1e3a6d navy, #f26a21 naranja) pero con su
	   propia cabecera/pie (fs-*), independiente de Factura. */
	.fs { position: relative; display: flex; flex-direction: column; min-height: 1160px; font-family: Arial, Helvetica, sans-serif; color: #1e293b; background: #fff; padding: 22px 26px 0; box-sizing: border-box; border: 1.5px solid #1e3a6d; overflow: hidden; }
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

function filaTotalV(etiqueta: string, valor: string, sim: string): string {
	return `<div class="fv-total-row"><span>${escapeHtml(etiqueta)}</span><span>${escapeHtml(sim)} ${escapeHtml(valor)}</span></div>`;
}

function construirHtml(d: DatosFacturaPdf): string {
	const sim = simbolo(d.moneda);
	const filas = d.lineas.map(
		(l) => `<tr>
			<td class="fx-c">${fmtCantidad(l.cantidad)}</td>
			<td class="fx-c">${escapeHtml(l.unidad)}</td>
			<td>${escapeHtml(l.descripcion)}</td>
			<td class="fx-r">${sim} ${fmt(l.valorUnitario)}</td>
		</tr>`
	);
	while (filas.length < FILAS_MINIMAS) filas.push('<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>');

	// Esta función solo se usa para Factura (Boleta/Notas usan construirHtmlSimple, con su propio
	// formato) — folio y título quedan fijos a ese único caso.
	const numero = d.folio ?? 'E001-________';
	const tituloCaja = TITULO_CAJA.factura;
	const nombreMoneda = d.moneda === 'USD' ? 'DÓLARES' : 'SOLES';
	const son = montoEnLetras(d.importeTotal, nombreMoneda);

	const bloqueDetraccion = d.sujetaDetraccion
		? `<div class="fv-detraction-box">INFORMACIÓN DE LA DETRACCIÓN</div>
			<div class="fv-detraction-content">
				<div class="fv-detraction-row"><span class="fv-detraction-label">Leyenda</span><span class="fv-detraction-val">Operación sujeta al Sistema de Pago de Obligaciones Tributarias con el Gobierno Central.</span></div>
				<div class="fv-detraction-row"><span class="fv-detraction-label">Bien o Servicio</span><span class="fv-detraction-val">${escapeHtml(d.detraccionBienServicio)}</span></div>
				<div class="fv-detraction-row"><span class="fv-detraction-label">Medio de pago</span><span class="fv-detraction-val">${escapeHtml(d.detraccionMedioPago)}</span></div>
				<div class="fv-detraction-row"><span class="fv-detraction-label">Nro. Cta. Banco de la Nación</span><span class="fv-detraction-val">${escapeHtml(d.detraccionCuentaBn)}</span></div>
				<div class="fv-detraction-row"><span class="fv-detraction-label">Porcentaje de detracción</span><span class="fv-detraction-val">${escapeHtml(String(d.porcentajeDetraccion))} %</span></div>
				<div class="fv-detraction-row"><span class="fv-detraction-label">Monto de detracción</span><span class="fv-detraction-val">${sim} ${fmt(d.montoDetraccion)}</span></div>
			</div>`
		: '';

	return `
		<div class="fv">
			${d.marcaAgua ? `<div class="fx-agua"><span>${escapeHtml(d.marcaAgua)}</span></div>` : ''}
			<div class="fv-head">
				<div class="fv-logo-section">
					<img class="fv-logo-img" src="${LOGO_ICONO_DATA_URI}" alt="" />
					<div class="fv-company-info">
						<h1>${escapeHtml(EMPRESA_NOMBRE)}</h1>
						<p>${escapeHtml(EMPRESA_DIRECCION)}</p>
					</div>
				</div>
				<div class="fv-ruc-box">
					<div class="fv-ruc-header">${escapeHtml(tituloCaja)}</div>
					<div class="fv-ruc-number">RUC: ${escapeHtml(EMPRESA_RUC)}</div>
					<div class="fv-doc-number">N° ${escapeHtml(numero)}</div>
				</div>
			</div>

			<div class="fv-info-grid">
				<div>
					<div class="fv-input-row"><span class="fv-input-label">Fecha de Emisión</span><span class="fv-input-field">: ${formatearFechaCorta(d.fechaEmision)}</span></div>
					<div class="fv-input-row"><span class="fv-input-label">Señor(es)</span><span class="fv-input-field">: ${escapeHtml(d.clienteNombre)}</span></div>
					<div class="fv-input-row"><span class="fv-input-label">${escapeHtml(d.clienteDocumentoLabel || 'RUC')}</span><span class="fv-input-field">: ${escapeHtml(d.clienteDocumento)}</span></div>
					<div class="fv-input-row"><span class="fv-input-label">Dirección-Cliente</span><span class="fv-input-field">: ${escapeHtml(d.clienteDireccion)}</span></div>
					<div class="fv-input-row"><span class="fv-input-label">Tipo de Moneda</span><span class="fv-input-field">: ${nombreMoneda}</span></div>
					<div class="fv-input-row"><span class="fv-input-label">Observación</span><span class="fv-input-field">: ${escapeHtml(d.observacion)}</span></div>
				</div>
				<div>
					<div class="fv-input-row"><span class="fv-input-label">Forma de pago</span><span class="fv-input-field">: ${d.formaPago === 'credito' ? 'Crédito' : 'Contado'}</span></div>
				</div>
			</div>

			<div class="fv-table-container">
				<table class="fv-items-table">
					<thead><tr><th style="width:12%">Cantidad</th><th style="width:16%">Unidad Medida</th><th>Descripción</th><th style="width:20%">Valor Unitario</th></tr></thead>
					<tbody>${filas.join('')}</tbody>
				</table>
			</div>

			<div class="fv-bottom-section">
				<div class="fv-left-panel">
					<div class="fv-input-row"><span class="fv-input-label" style="width:190px">Valor de Venta de Operaciones Gratuitas</span><span class="fv-input-field" style="flex:0 0 60px">${sim} 0.00</span></div>
					<div class="fv-gray-box"><b>SON:</b>${escapeHtml(son)}</div>
				</div>
				<div class="fv-right-panel">
					${filaTotalV('Sub Total Ventas', fmt(d.subTotalVentas), sim)}
					${filaTotalV('Anticipos', fmt(d.anticipos), sim)}
					${filaTotalV('Descuentos', fmt(d.descuentos), sim)}
					${filaTotalV('Valor Venta', fmt(d.valorVenta), sim)}
					${filaTotalV('ISC', fmt(d.isc), sim)}
					${filaTotalV('IGV', fmt(d.igv), sim)}
					${filaTotalV('Otros Cargos', fmt(d.otrosCargos), sim)}
					${filaTotalV('Otros Tributos', fmt(d.otrosTributos), sim)}
					${filaTotalV('Monto de redondeo', fmt(d.redondeo), sim)}
					<div class="fv-grand-total"><span>Importe Total</span><span>${sim} ${fmt(d.importeTotal)}</span></div>
				</div>
			</div>

			${bloqueDetraccion}

			<div class="fx-nota">Esta es una representación impresa de la factura electrónica, generada en el Sistema de SUNAT.<br />Puede verificarla utilizando su clave SOL</div>
			<div class="fx-pie"><span>Más de 12 años construyendo tu futuro</span><b>www.construni.pe</b></div>
			<div class="fv-bottom-bar"></div>
			<div class="fv-validity">Validez de 30 días comprendidos hasta la fecha</div>
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
	return conCarga('Generando el PDF de la factura…', () => generarFacturaPdfInterno(datos));
}

async function generarFacturaPdfInterno(datos: DatosFacturaPdf): Promise<{ pngDataUrl: string; pdfBase64: string }> {
	const html = `<style>${ESTILOS}</style>${datos.tipoDocumento === 'factura' ? construirHtml(datos) : construirHtmlSimple(datos)}`;
	const render = await renderHtmlToPngDataUrl(html, ANCHO_PLANTILLA_PX);
	const pdfBase64 = ensamblarPdfUnaCopiaMultipagina(render);
	return { pngDataUrl: render.dataUrl, pdfBase64 };
}
