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
import { formatearFechaCorta } from './pdfFormatoUtil';
import { renderHtmlToPngDataUrl, ensamblarPdfUnaCopiaMultipagina } from './pdfHtmlRender';
import { escapeHtml } from './pdfVoucherEstilos';

const ANCHO_PLANTILLA_PX = 820;
const FILAS_MINIMAS = 5;

export interface DatosFacturaLineaPdf {
	cantidad: number;
	unidad: string;
	descripcion: string;
	valorUnitario: number;
}

export interface DatosFacturaPdf {
	/** null = todavía sin número (vista previa antes de autorizar) — se imprime "E001-________". */
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

const ESTILOS = `
	/* min-height = proporción A4 (820px de ancho × 297/210): la factura ocupa una hoja completa con la nota y el
	   pie pegados al fondo (margin-top:auto en .fx-nota), con o sin bloque de detracción. Si el contenido es más
	   alto (muchas líneas), crece y ensamblarPdfUnaCopiaMultipagina lo reparte en más páginas. */
	.fx { position: relative; display: flex; flex-direction: column; min-height: 1160px; font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; background: #fff; padding: 26px 30px 22px; box-sizing: border-box; border: 2px solid #1e3a6d; }
	.fx * { box-sizing: border-box; }
	.fx-agua { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; pointer-events: none; z-index: 20; }
	.fx-agua span { font-weight: 800; font-size: 78px; letter-spacing: 0.12em; color: rgba(100,116,139,0.20); transform: rotate(-28deg); white-space: nowrap; }
	.fx-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; margin-bottom: 20px; }
	.fx-emisor { display: flex; align-items: center; gap: 16px; flex: 1; min-width: 0; }
	.fx-logo { display: flex; flex-direction: column; align-items: center; gap: 4px; flex-shrink: 0; }
	.fx-logo img { width: 66px; height: 66px; border-radius: 10px; display: block; }
	.fx-logo-txt { font-weight: 800; font-size: 20px; letter-spacing: -0.02em; color: #1e3a6d; line-height: 1; }
	.fx-emisor-txt { min-width: 0; }
	.fx-emisor-nombre { font-weight: 800; font-size: 19px; color: #1e3a6d; line-height: 1.15; }
	.fx-emisor-dir { font-size: 10.5px; color: #475569; margin-top: 4px; line-height: 1.35; }
	.fx-caja { width: 250px; flex-shrink: 0; border: 2px solid #1e3a6d; border-radius: 10px; overflow: hidden; text-align: center; }
	.fx-caja-tit { background: #1e3a6d; color: #fff; font-weight: 800; font-size: 14px; padding: 9px 6px; letter-spacing: 0.02em; }
	.fx-caja-ruc { font-weight: 800; font-size: 14px; color: #1e3a6d; padding: 9px 6px 3px; }
	.fx-caja-num { font-weight: 800; font-size: 14px; color: #1e3a6d; padding: 3px 6px 10px; }
	.fx-row { display: flex; align-items: center; gap: 10px; margin-bottom: 7px; }
	.fx-lbl { width: 128px; flex-shrink: 0; font-size: 11.5px; color: #334155; font-weight: 600; }
	.fx-val { flex: 1; min-width: 0; min-height: 24px; background: #e7edf6; border: 1px solid #c9d6e8; border-radius: 4px; padding: 4px 8px; font-size: 12px; color: #0f172a; display: flex; align-items: center; }
	.fx-val-alto { min-height: 46px; align-items: flex-start; }
	.fx-val-corto { flex: 0 0 150px; }
	.fx-lbl-der { width: auto; margin-left: 14px; }
	.fx-tabla { width: 100%; border-collapse: collapse; margin: 14px 0 12px; border: 1px solid #1e3a6d; }
	.fx-tabla th { background: #1e3a6d; color: #fff; font-size: 11.5px; font-weight: 700; padding: 8px 8px; border-bottom: 3px solid #f26a21; text-align: center; }
	.fx-tabla td { font-size: 11.5px; padding: 6px 8px; border: 1px solid #cbd5e1; height: 26px; vertical-align: top; }
	.fx-c { text-align: center; }
	.fx-r { text-align: right; white-space: nowrap; }
	.fx-bajo { display: flex; gap: 18px; align-items: flex-start; margin-bottom: 14px; }
	.fx-bajo-izq { flex: 1; min-width: 0; }
	.fx-gratuitas { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #334155; font-weight: 600; margin-bottom: 10px; }
	.fx-gratuitas .fx-val { flex: 0 0 130px; }
	.fx-son { border: 1px solid #c9d6e8; background: #e7edf6; border-radius: 6px; padding: 8px 10px; min-height: 64px; font-size: 11.5px; }
	.fx-son b { color: #f26a21; font-size: 14px; margin-right: 6px; }
	.fx-tot { width: 292px; flex-shrink: 0; border: 1px solid #1e3a6d; border-radius: 6px; padding: 8px 10px; }
	.fx-tot-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; font-size: 11px; color: #334155; font-weight: 600; }
	.fx-tot-row .fx-tl { flex: 1; text-align: right; }
	.fx-tot-row .fx-tv { flex: 0 0 130px; background: #e7edf6; border: 1px solid #c9d6e8; border-radius: 3px; padding: 3px 7px; display: flex; justify-content: space-between; font-weight: 500; color: #0f172a; }
	.fx-tot-final { margin-top: 7px; border: 2px solid #f26a21; border-radius: 5px; padding: 5px 6px; }
	.fx-tot-final .fx-tl { color: #f26a21; font-weight: 800; font-size: 12px; }
	.fx-tot-final .fx-tv { background: #fff; border-color: #f26a21; font-weight: 800; }
	.fx-det { border: 1px solid #1e3a6d; border-radius: 6px; overflow: hidden; margin-bottom: 12px; }
	.fx-det-tit { background: #1e3a6d; color: #fff; font-weight: 800; font-size: 11.5px; padding: 6px 12px; letter-spacing: 0.02em; }
	.fx-det-body { padding: 9px 12px 6px; }
	.fx-det-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 10.5px; color: #334155; font-weight: 600; }
	.fx-det-row .fx-dl { width: 118px; flex-shrink: 0; }
	.fx-det-row .fx-dv { flex: 1; min-width: 0; min-height: 21px; background: #e7edf6; border: 1px solid #c9d6e8; border-radius: 3px; padding: 3px 7px; font-weight: 500; color: #0f172a; }
	.fx-det-row .fx-dv-corto { flex: 0 0 86px; text-align: right; }
	.fx-det-row .fx-dv-medio { flex: 0 0 120px; }
	.fx-nota { margin-top: auto; background: #e7edf6; border: 1px solid #c9d6e8; border-radius: 6px; text-align: center; font-size: 10px; color: #334155; padding: 7px 10px; margin-bottom: 12px; line-height: 1.4; }
	.fx-pie { display: flex; justify-content: space-between; align-items: center; border-left: 4px solid #f26a21; padding: 3px 0 3px 8px; font-size: 10.5px; color: #1e3a6d; }
	.fx-pie b { font-weight: 800; }
`;

function filaTotal(etiqueta: string, valor: string, sim: string, extraClase = ''): string {
	return `<div class="fx-tot-row ${extraClase}"><span class="fx-tl">${escapeHtml(etiqueta)} :</span><span class="fx-tv"><span>${escapeHtml(sim)}</span><span>${escapeHtml(valor)}</span></span></div>`;
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

	const numero = d.folio ?? 'E001-________';
	const nombreMoneda = d.moneda === 'USD' ? 'DÓLARES' : 'SOLES';
	const son = montoEnLetras(d.importeTotal, nombreMoneda);

	const bloqueDetraccion = d.sujetaDetraccion
		? `<div class="fx-det">
				<div class="fx-det-tit">INFORMACIÓN DE LA DETRACCIÓN</div>
				<div class="fx-det-body">
					<div class="fx-det-row"><span class="fx-dl">Leyenda</span><span class="fx-dv" style="background:#fff;border-color:#fff;padding-left:0">: Operación sujeta al Sistema de Pago de Obligaciones Tributarias con el Gobierno Central.</span></div>
					<div class="fx-det-row"><span class="fx-dl">Bien o Servicio</span><span class="fx-dv">${escapeHtml(d.detraccionBienServicio)}</span></div>
					<div class="fx-det-row"><span class="fx-dl">Medio de pago</span><span class="fx-dv">${escapeHtml(d.detraccionMedioPago)}</span></div>
					<div class="fx-det-row">
						<span class="fx-dl">Nro. Cta. Banco de la Nación</span><span class="fx-dv">${escapeHtml(d.detraccionCuentaBn)}</span>
						<span>Porcentaje de detracción</span><span class="fx-dv fx-dv-corto">${escapeHtml(String(d.porcentajeDetraccion))} %</span>
						<span>Monto de detracción</span><span class="fx-dv fx-dv-medio">${sim} ${fmt(d.montoDetraccion)}</span>
					</div>
				</div>
			</div>`
		: '';

	return `
		<div class="fx">
			${d.marcaAgua ? `<div class="fx-agua"><span>${escapeHtml(d.marcaAgua)}</span></div>` : ''}
			<div class="fx-head">
				<div class="fx-emisor">
					<div class="fx-logo"><img src="/logo.png" alt="" /><span class="fx-logo-txt">construni</span></div>
					<div class="fx-emisor-txt">
						<div class="fx-emisor-nombre">${escapeHtml(EMPRESA_NOMBRE)}</div>
						<div class="fx-emisor-dir">${escapeHtml(EMPRESA_DIRECCION)}</div>
					</div>
				</div>
				<div class="fx-caja">
					<div class="fx-caja-tit">FACTURA ELECTRÓNICA</div>
					<div class="fx-caja-ruc">RUC: ${escapeHtml(EMPRESA_RUC)}</div>
					<div class="fx-caja-num">N° ${escapeHtml(numero)}</div>
				</div>
			</div>

			<div class="fx-row">
				<span class="fx-lbl">Fecha de Emisión :</span><span class="fx-val">${formatearFechaCorta(d.fechaEmision)}</span>
				<span class="fx-lbl fx-lbl-der" style="width:auto">Forma de pago :</span><span class="fx-val fx-val-corto">${d.formaPago === 'credito' ? 'Crédito' : 'Contado'}</span>
			</div>
			<div class="fx-row"><span class="fx-lbl">Señor(es) :</span><span class="fx-val">${escapeHtml(d.clienteNombre)}</span></div>
			<div class="fx-row"><span class="fx-lbl">${escapeHtml(d.clienteDocumentoLabel || 'RUC')} :</span><span class="fx-val">${escapeHtml(d.clienteDocumento)}</span></div>
			<div class="fx-row"><span class="fx-lbl">Dirección del Cliente :</span><span class="fx-val fx-val-alto">${escapeHtml(d.clienteDireccion)}</span></div>
			<div class="fx-row"><span class="fx-lbl">Tipo de Moneda :</span><span class="fx-val">${nombreMoneda}</span></div>
			<div class="fx-row"><span class="fx-lbl">Observación :</span><span class="fx-val">${escapeHtml(d.observacion)}</span></div>

			<table class="fx-tabla">
				<thead><tr><th style="width:12%">Cantidad</th><th style="width:16%">Unidad Medida</th><th>Descripción</th><th style="width:20%">Valor Unitario</th></tr></thead>
				<tbody>${filas.join('')}</tbody>
			</table>

			<div class="fx-bajo">
				<div class="fx-bajo-izq">
					<div class="fx-gratuitas"><span>Valor de Venta de Operaciones Gratuitas :</span><span class="fx-val">${sim} 0.00</span></div>
					<div class="fx-son"><b>SON:</b>${escapeHtml(son)}</div>
				</div>
				<div class="fx-tot">
					${filaTotal('Sub Total Ventas', fmt(d.subTotalVentas), sim)}
					${filaTotal('Anticipos', fmt(d.anticipos), sim)}
					${filaTotal('Descuentos', fmt(d.descuentos), sim)}
					${filaTotal('Valor Venta', fmt(d.valorVenta), sim)}
					${filaTotal('ISC', fmt(d.isc), sim)}
					${filaTotal('IGV', fmt(d.igv), sim)}
					${filaTotal('Otros Cargos', fmt(d.otrosCargos), sim)}
					${filaTotal('Otros Tributos', fmt(d.otrosTributos), sim)}
					${filaTotal('Monto de redondeo', fmt(d.redondeo), sim)}
					${filaTotal('Importe Total', fmt(d.importeTotal), sim, 'fx-tot-final')}
				</div>
			</div>

			${bloqueDetraccion}

			<div class="fx-nota">Esta es una representación impresa de la factura electrónica, generada en el Sistema de SUNAT.<br />Puede verificarla utilizando su clave SOL</div>
			<div class="fx-pie"><span>Más de 12 años construyendo tu futuro</span><b>www.construni.pe</b></div>
		</div>
	`;
}

/** Renderiza la plantilla a PNG y la ensambla en un PDF paginado. Devuelve tanto el data URL PNG (vista
 * previa dentro del modal y archivo que se guarda en Drive) como el PDF ya listo en base64. */
export async function generarFacturaPdf(datos: DatosFacturaPdf): Promise<{ pngDataUrl: string; pdfBase64: string }> {
	const html = `<style>${ESTILOS}</style>${construirHtml(datos)}`;
	const render = await renderHtmlToPngDataUrl(html, ANCHO_PLANTILLA_PX);
	const pdfBase64 = ensamblarPdfUnaCopiaMultipagina(render);
	return { pngDataUrl: render.dataUrl, pdfBase64 };
}
