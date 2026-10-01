/**
 * Lectura de comprobantes electrónicos de INGRESO (Factura, Boleta, Nota de Crédito, Nota de Débito) para
 * el repositorio de "Emisión de Comprobante" (ver comprobantesIngreso.service.ts):
 *   - extraerDatosDeTexto: texto leído por OCR (Tesseract, ver leerTextoComprobante en ocrComprobante.ts)
 *     -> datos, solo con regex. Función pura (sin OCR ni DOM) para poder probarla con vitest.
 *   - leerXmlSunat: XML UBL 2.1 de SUNAT -> datos exactos, sin OCR (DOMParser, disponible en navegador,
 *     Tauri Windows y Tauri Android).
 * Ninguna lanza: lo que no se reconoce queda en null para que el usuario lo complete a mano.
 */

export type TipoComprobanteIngreso = 'factura' | 'boleta' | 'nota_credito' | 'nota_debito';

export interface DatosComprobanteLeido {
	tipo: TipoComprobanteIngreso | null;
	serie: string | null;
	numero: string | null;
	fecha_emision: string | null; // yyyy-mm-dd
	ruc_emisor: string | null;
	razon_social_emisor: string | null;
	doc_receptor: string | null;
	nombre_receptor: string | null;
	moneda: 'PEN' | 'USD' | null;
	subtotal: number | null;
	igv: number | null;
	total: number | null;
	/** Solo Nota de Crédito/Débito: "F001-00000245" del comprobante que modifica. */
	serie_numero_referencia: string | null;
}

export function datosVacios(): DatosComprobanteLeido {
	return {
		tipo: null,
		serie: null,
		numero: null,
		fecha_emision: null,
		ruc_emisor: null,
		razon_social_emisor: null,
		doc_receptor: null,
		nombre_receptor: null,
		moneda: null,
		subtotal: null,
		igv: null,
		total: null,
		serie_numero_referencia: null
	};
}

/** Cuántos de los datos principales se reconocieron — para mostrar la confianza de la lectura. */
export function camposReconocidos(d: DatosComprobanteLeido): { encontrados: number; total: number } {
	const principales = [d.tipo, d.serie, d.numero, d.fecha_emision, d.ruc_emisor, d.doc_receptor, d.total];
	return { encontrados: principales.filter((v) => v !== null && v !== '').length, total: principales.length };
}

function sinTildes(texto: string): string {
	return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ── Texto (OCR) ────────────────────────────────────────────────────────────────────────────────────

/** Monto con 2 decimales, separador de miles opcional (coma o espacio): "1,299.00", "1 299.00", "180.00". */
const PATRON_MONTO = /\d{1,3}(?:[,\s]\d{3})*\.\d{2}|\d+\.\d{2}/g;

function aNumero(crudo: string): number | null {
	const n = Number(crudo.replace(/[,\s]/g, ''));
	return Number.isFinite(n) ? n : null;
}

/** Último monto de la línea que contiene alguna de las etiquetas (el valor va al final de la línea:
 * "SUBTOTAL  1,100.00", "IGV (18%)  198.00"). `desdeAbajo` recorre el texto de abajo hacia arriba — para el
 * total, que va en el bloque final; así no se confunde con la columna "TOTAL" del encabezado de la tabla de
 * productos. `mirarSiguiente`: si la línea no trae monto, prueba la siguiente (Tesseract a veces separa
 * etiqueta y valor en dos líneas). */
function montoPorEtiqueta(lineas: string[], etiquetas: RegExp, { desdeAbajo = false, mirarSiguiente = true } = {}): number | null {
	const indices = lineas.map((_, i) => i);
	if (desdeAbajo) indices.reverse();
	for (const i of indices) {
		if (!etiquetas.test(sinTildes(lineas[i].toLowerCase()))) continue;
		for (const linea of mirarSiguiente ? [lineas[i], lineas[i + 1] ?? ''] : [lineas[i]]) {
			const montos = linea.match(PATRON_MONTO);
			if (montos?.length) return aNumero(montos[montos.length - 1]);
		}
	}
	return null;
}

function detectarTipo(textoPlano: string, serie: string | null): TipoComprobanteIngreso | null {
	// Nota de crédito/débito primero: su texto también suele decir "factura" (la que modifican).
	if (/nota\s+de\s+credito/.test(textoPlano)) return 'nota_credito';
	if (/nota\s+de\s+debito/.test(textoPlano)) return 'nota_debito';
	if (/\bboleta\b/.test(textoPlano)) return 'boleta';
	if (/\bfactura\b/.test(textoPlano)) return 'factura';
	if (serie?.startsWith('B')) return 'boleta';
	if (serie?.startsWith('F')) return 'factura';
	return null;
}

/** Serie SUNAT (4 caracteres: F001, B001, E001, FC01, BD01...) + correlativo. Tolera que el OCR lea la
 * letra "O" en vez del cero dentro de la serie. */
const PATRON_SERIE_NUMERO = /\b([FBE][A-Z0-9O]{3})\s*[-–—]\s*(\d{1,8})\b/g;

function normalizarSerie(serie: string): string {
	return serie.charAt(0) + serie.slice(1).replace(/O/g, '0');
}

function aFechaIso(dia: string, mes: string, anio: string): string | null {
	const d = Number(dia);
	const m = Number(mes);
	let a = Number(anio);
	if (anio.length === 2) a += 2000;
	if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12 && a >= 2000 && a <= 2100)) return null;
	return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function extraerFechaDeLinea(linea: string): string | null {
	const dmy = linea.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})\b/);
	if (dmy) return aFechaIso(dmy[1], dmy[2], dmy[3]);
	const ymd = linea.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
	if (ymd) return aFechaIso(ymd[3], ymd[2], ymd[1]);
	return null;
}

function extraerFecha(lineas: string[]): string | null {
	for (let i = 0; i < lineas.length; i++) {
		if (!/fecha\s+de\s+emision|fecha\s+emision|f\.\s*emision/.test(sinTildes(lineas[i].toLowerCase()))) continue;
		const fecha = extraerFechaDeLinea(lineas[i]) ?? extraerFechaDeLinea(lineas[i + 1] ?? '');
		if (fecha) return fecha;
	}
	for (const linea of lineas) {
		const fecha = extraerFechaDeLinea(linea);
		if (fecha) return fecha;
	}
	return null;
}

/** RUC peruano: 11 dígitos que empiezan con 10, 15, 17 o 20 (tolera espacios que mete el OCR). */
const PATRON_RUC = /\b((?:10|15|17|20)\d{9})\b/g;

/** Texto que sigue a una etiqueta en su misma línea ("Señor(es): EMPRESA DEMO S.A.C." -> "EMPRESA DEMO S.A.C."). */
function valorDeEtiqueta(lineas: string[], etiqueta: RegExp): string | null {
	for (const linea of lineas) {
		const plano = sinTildes(linea);
		const m = plano.match(etiqueta);
		if (!m || m.index === undefined) continue;
		const resto = linea.slice(m.index + m[0].length).replace(/^[\s:.\-]+/, '').trim();
		if (resto.length >= 3) return resto;
	}
	return null;
}

export function extraerDatosDeTexto(texto: string): DatosComprobanteLeido {
	const datos = datosVacios();
	if (!texto?.trim()) return datos;

	const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	const plano = sinTildes(texto.toLowerCase());

	// Serie-número: el primero es el propio comprobante; en una NC/ND, el siguiente distinto (o el que sigue a
	// "modifica/referencia/afectado") es el comprobante que corrige.
	const seriesEncontradas = [...texto.toUpperCase().matchAll(PATRON_SERIE_NUMERO)].map((m) => ({
		serie: normalizarSerie(m[1]),
		numero: m[2].padStart(8, '0'),
		indice: m.index ?? 0
	}));
	if (seriesEncontradas.length) {
		datos.serie = seriesEncontradas[0].serie;
		datos.numero = seriesEncontradas[0].numero;
	}
	datos.tipo = detectarTipo(plano, datos.serie);
	if ((datos.tipo === 'nota_credito' || datos.tipo === 'nota_debito') && seriesEncontradas.length > 1) {
		const propio = `${datos.serie}-${datos.numero}`;
		const etiquetaRef = plano.search(/modifica|referencia|afectad|documento\s+que/);
		const candidatas = seriesEncontradas.filter((s) => `${s.serie}-${s.numero}` !== propio);
		const ref = (etiquetaRef >= 0 ? candidatas.find((s) => s.indice > etiquetaRef) : undefined) ?? candidatas[0];
		if (ref) datos.serie_numero_referencia = `${ref.serie}-${ref.numero}`;
	}

	datos.fecha_emision = extraerFecha(lineas);

	// RUC: el primero (encabezado) es el emisor; el siguiente distinto, el receptor. Sin segundo RUC, el
	// receptor puede ser un DNI (boleta a persona natural).
	const textoSinEspaciosEnNumeros = texto.replace(/(\d)\s(?=\d)/g, '$1');
	const rucs = [...new Set([...textoSinEspaciosEnNumeros.matchAll(PATRON_RUC)].map((m) => m[1]))];
	datos.ruc_emisor = rucs[0] ?? null;
	datos.doc_receptor = rucs[1] ?? textoSinEspaciosEnNumeros.match(/\bD\.?N\.?I\.?\s*[:N°º.\s]*(\d{8})\b/i)?.[1] ?? null;

	// Razón social del emisor: la línea con letras justo antes de la que tiene su RUC (encabezado típico:
	// nombre en una línea, "RUC: ..." en la siguiente).
	if (datos.ruc_emisor) {
		const idx = lineas.findIndex((l) => l.replace(/(\d)\s(?=\d)/g, '$1').includes(datos.ruc_emisor!));
		// Primero, el texto ANTES de "RUC" en la misma línea ("DISTRIBUIDORA EJEMPLO S.A.C. RUC: 2012...").
		const antesDelRuc = idx >= 0 ? lineas[idx].split(/\bR\.?\s?U\.?\s?C\.?\b/i)[0].trim() : '';
		if (/[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,}/.test(antesDelRuc) && !/\d{6,}/.test(antesDelRuc)) datos.razon_social_emisor = antesDelRuc;
		for (let i = idx - 1; !datos.razon_social_emisor && i >= 0 && i >= idx - 3; i--) {
			const candidata = lineas[i].replace(/\b(?:R\.?U\.?C\.?|FACTURA|BOLETA|ELECTR[OÓ]NICA)\b.*$/i, '').trim();
			if (/[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,}/.test(candidata) && !/\d{6,}/.test(candidata)) {
				datos.razon_social_emisor = candidata;
				break;
			}
		}
	}

	datos.nombre_receptor = valorDeEtiqueta(lineas, /se[nñ]or(?:\(?es\)?)?|cliente|adquiri?ente|raz[oó]n\s+social\s+del\s+cliente/i);

	datos.moneda = /\bdolares\b|\bus\$|\busd\b/.test(plano) ? 'USD' : /\bsoles\b|\bs\/|\bpen\b/.test(plano) ? 'PEN' : null;

	datos.subtotal = montoPorEtiqueta(lineas, /op\.?\s*gravad|operacion(?:es)?\s+gravad|sub\s*-?\s*total|valor\s+de\s+venta/);
	datos.igv = montoPorEtiqueta(lineas, /\bigv\b|i\.g\.v/);
	datos.total =
		montoPorEtiqueta(lineas, /importe\s+total|total\s+a\s+pagar|total\s+general|monto\s+total/, { desdeAbajo: true }) ??
		montoPorEtiqueta(lineas, /\btotal\b(?!\s*(?:valor|op|gravad|de\s+venta))/, { desdeAbajo: true, mirarSiguiente: false });
	// Si solo se leyó subtotal + IGV, el total es su suma (y viceversa).
	if (datos.total === null && datos.subtotal !== null && datos.igv !== null) datos.total = Math.round((datos.subtotal + datos.igv) * 100) / 100;
	if (datos.subtotal === null && datos.total !== null && datos.igv !== null) datos.subtotal = Math.round((datos.total - datos.igv) * 100) / 100;

	return datos;
}

// ── XML UBL 2.1 (SUNAT) ────────────────────────────────────────────────────────────────────────────

function hijo(el: Element | null | undefined, nombre: string): Element | null {
	if (!el) return null;
	for (const c of Array.from(el.children)) if (c.localName === nombre) return c;
	return null;
}

function ruta(el: Element | null | undefined, ...nombres: string[]): Element | null {
	let actual: Element | null | undefined = el;
	for (const n of nombres) actual = hijo(actual, n);
	return actual ?? null;
}

function textoDe(el: Element | null): string | null {
	const t = el?.textContent?.trim();
	return t ? t : null;
}

function numeroDe(el: Element | null): number | null {
	const t = textoDe(el);
	if (t === null) return null;
	const n = Number(t);
	return Number.isFinite(n) ? n : null;
}

/** Lee un XML de comprobante electrónico SUNAT (Invoice / CreditNote / DebitNote, UBL 2.1). */
export function leerXmlSunat(xml: string): DatosComprobanteLeido {
	const datos = datosVacios();
	let doc: Document;
	try {
		doc = new DOMParser().parseFromString(xml, 'application/xml');
	} catch {
		return datos;
	}
	const raiz = doc.documentElement;
	if (!raiz || raiz.getElementsByTagName('parsererror').length) return datos;

	const nombreRaiz = raiz.localName;
	if (nombreRaiz === 'CreditNote') datos.tipo = 'nota_credito';
	else if (nombreRaiz === 'DebitNote') datos.tipo = 'nota_debito';
	else if (nombreRaiz === 'Invoice') {
		const codigo = textoDe(hijo(raiz, 'InvoiceTypeCode'));
		datos.tipo = codigo === '03' ? 'boleta' : 'factura';
	}

	const id = textoDe(hijo(raiz, 'ID'));
	const partes = id?.match(/^([A-Z0-9]{4})-(\d{1,8})$/i);
	if (partes) {
		datos.serie = partes[1].toUpperCase();
		datos.numero = partes[2].padStart(8, '0');
	}
	datos.fecha_emision = textoDe(hijo(raiz, 'IssueDate'));
	const moneda = textoDe(hijo(raiz, 'DocumentCurrencyCode'));
	datos.moneda = moneda === 'USD' ? 'USD' : moneda === 'PEN' ? 'PEN' : null;

	const emisor = ruta(raiz, 'AccountingSupplierParty', 'Party');
	datos.ruc_emisor = textoDe(ruta(emisor, 'PartyIdentification', 'ID'));
	datos.razon_social_emisor = textoDe(ruta(emisor, 'PartyLegalEntity', 'RegistrationName')) ?? textoDe(ruta(emisor, 'PartyName', 'Name'));

	const receptor = ruta(raiz, 'AccountingCustomerParty', 'Party');
	datos.doc_receptor = textoDe(ruta(receptor, 'PartyIdentification', 'ID'));
	datos.nombre_receptor = textoDe(ruta(receptor, 'PartyLegalEntity', 'RegistrationName')) ?? textoDe(ruta(receptor, 'PartyName', 'Name'));

	const totales = hijo(raiz, 'LegalMonetaryTotal') ?? hijo(raiz, 'RequestedMonetaryTotal');
	datos.total = numeroDe(hijo(totales, 'PayableAmount'));
	datos.subtotal = numeroDe(hijo(totales, 'LineExtensionAmount'));
	datos.igv = numeroDe(ruta(raiz, 'TaxTotal', 'TaxAmount'));
	if (datos.subtotal === null && datos.total !== null && datos.igv !== null) datos.subtotal = Math.round((datos.total - datos.igv) * 100) / 100;

	datos.serie_numero_referencia = textoDe(ruta(raiz, 'BillingReference', 'InvoiceDocumentReference', 'ID'));
	return datos;
}
