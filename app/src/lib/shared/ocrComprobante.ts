/**
 * Reconocimiento de Fecha/Monto/N° de Operación en un comprobante de pago (boucher) — a pedido
 * explícito del usuario, 100% OCR + regex, SIN ningún servicio de IA (reemplaza la versión anterior,
 * que llamaba a Claude vía la Edge Function `ocr-comprobante`, ya eliminada).
 *
 * Corre client-side con Tesseract.js (WASM, mismo criterio que pdfjs-dist para el preview de PDFs) —
 * funciona igual en browser, Tauri Windows y Tauri Android, sin servidor propio ni credenciales de
 * terceros. Tesseract.js descarga su worker/core/datos de idioma desde su CDN por defecto la primera
 * vez que se usa (después quedan cacheados por el navegador) — requiere conexión a internet la primera
 * vez, igual que el resto del ERP depende de Supabase.
 */

import { recognize } from 'tesseract.js';

export interface ReconocerComprobanteResult {
	success: boolean;
	fecha?: string | null;
	monto?: number | null;
	num_operacion?: string | null;
	confianza?: 'alta' | 'media' | 'baja';
	error?: string;
}

const MESES: Record<string, string> = {
	ene: '01',
	enero: '01',
	feb: '02',
	febrero: '02',
	mar: '03',
	marzo: '03',
	abr: '04',
	abril: '04',
	may: '05',
	mayo: '05',
	jun: '06',
	junio: '06',
	jul: '07',
	julio: '07',
	ago: '08',
	agosto: '08',
	sep: '09',
	set: '09',
	septiembre: '09',
	setiembre: '09',
	oct: '10',
	octubre: '10',
	nov: '11',
	noviembre: '11',
	dic: '12',
	diciembre: '12'
};

/** Quita tildes para poder comparar "agosto"/"agosto" sin depender de cómo el OCR haya leído la tilde
 * (Tesseract a veces la pierde o la confunde con ruido). */
function sinTildes(value: string): string {
	return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Busca una fecha en el texto reconocido, en cualquiera de los formatos comunes en comprobantes
 * peruanos: 'YYYY-MM-DD', 'DD/MM/YYYY' (o con guiones), y 'DD de mes [de] YYYY' / 'DD mes. YYYY'
 * (nombre de mes en español, completo o abreviado). Devuelve siempre 'YYYY-MM-DD' o null. */
function extraerFecha(texto: string): string | null {
	let m = texto.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
	if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

	m = texto.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/);
	if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;

	m = texto.match(/\b(\d{1,2})\s*(?:de\s*)?([a-zA-Z]{3,10})\.?\s*(?:de\s*)?(20\d{2})\b/);
	if (m) {
		const mes = MESES[sinTildes(m[2].toLowerCase())];
		if (mes) return `${m[3]}-${mes}-${m[1].padStart(2, '0')}`;
	}

	return null;
}

/** Patrón común a BCP/BBVA/Interbank/Yape/Plin: símbolo "S/" (a veces "S/." — Interbank), seguido de
 * un número con separador de miles opcional (coma) y decimales opcionales (punto). Se usa tanto para
 * la búsqueda con etiqueta como sin ella, ver extraerMonto. */
const PATRON_MONTO = /S\/\.?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i;

/** Busca el monto pagado. Dos pasadas, en orden de prioridad:
 *  1. Junto a una etiqueta explícita ("Monto"/"Importe"/"Total"/"Pagaste"/"Enviaste"/"Pagado") — evita
 *     confundirlo con otro monto secundario del comprobante (comisión, ITF, saldo disponible, etc.)
 *     que a veces aparece ANTES en el texto, algo común en transferencias BCP/BBVA/Interbank.
 *  2. Si no hay ninguna etiqueta reconocible (caso típico de Yape/Plin, que solo muestran "S/10" en
 *     grande sin la palabra "Monto" al lado), se toma el primer "S/ <número>" que aparezca.
 * null si no encuentra ningún monto con el símbolo de soles en ninguna de las dos pasadas. */
function extraerMonto(texto: string): number | null {
	const conEtiqueta = texto.match(new RegExp(`(?:monto|importe|total|pagaste|enviaste|pagado)\\D{0,15}?${PATRON_MONTO.source}`, 'i'));
	const m = conEtiqueta ?? texto.match(PATRON_MONTO);
	if (!m) return null;
	const valor = Number(m[1].replace(/,/g, ''));
	return Number.isFinite(valor) ? valor : null;
}

/** Busca el número/código de operación: una etiqueta reconocible ("N°"/"Nro."/"Número"/"Código" + "de
 * operación"/"transacción"/"referencia"/"constancia"/"rastreo"/"confirmación" — cada banco usa la
 * suya: Yape/Plin dicen "operación", BCP escribe "Número de operación" completo, Interbank "N° de
 * constancia") seguida de un bloque de dígitos — descarta cualquier otro número del comprobante
 * (monto, celular, código de seguridad) que no venga con esa etiqueta al lado. Tolera espacios/guiones
 * internos en el número (se limpian) y exige al menos 6 dígitos, para no confundirlo con un código de
 * seguridad corto (ej. el de 3 dígitos de Yape). */
function extraerNumeroOperacion(texto: string): string | null {
	const m = texto.match(
		/(?:n[°ºo]?\.?|nro\.?|n[uú]mero|c[oó]digo)\s*(?:de\s*)?(?:operaci[oó]n|transacci[oó]n|referencia|constancia|rastreo|confirmaci[oó]n)\s*[:\-]?\s*(\d[\d\s-]{4,14}\d)/i
	);
	if (!m) return null;
	const soloDigitos = m[1].replace(/[\s-]/g, '');
	return soloDigitos.length >= 6 ? soloDigitos : null;
}

function calcularConfianza(fecha: string | null, monto: number | null, numOperacion: string | null): 'alta' | 'media' | 'baja' {
	const encontrados = [fecha, monto, numOperacion].filter((v) => v !== null && v !== undefined).length;
	if (encontrados === 3) return 'alta';
	if (encontrados > 0) return 'media';
	return 'baja';
}

/** Lee fecha, monto y N° de operación de una foto de comprobante de pago vía OCR (Tesseract.js) +
 * regex — ver "Fecha (reconocida)"/"Monto (reconocido)"/"N° de Operación (reconocido)" en
 * TransaccionModal.svelte. `file` debe ser una imagen (image/*); PDFs no se procesan acá (mismo
 * límite que tenía la versión anterior). Nunca lanza — un fallo de reconocimiento no debe bloquear el
 * registro manual de la transacción. */
export async function reconocerComprobante(file: File): Promise<ReconocerComprobanteResult> {
	try {
		const { data } = await recognize(file, 'spa');
		const texto = data.text || '';
		// Log temporal para ajustar los regex con el texto REAL que lee Tesseract en cada boucher (en
		// vez de adivinar formatos) — revisar en la consola del navegador (F12) tras subir un boucher.
		console.log('[ocrComprobante] Texto reconocido:', texto);

		const fecha = extraerFecha(texto);
		const monto = extraerMonto(texto);
		const num_operacion = extraerNumeroOperacion(texto);

		if (fecha === null && monto === null && num_operacion === null) {
			return { success: false, error: 'No se pudo reconocer ningún dato del comprobante. Complétalos a mano.' };
		}

		return { success: true, fecha, monto, num_operacion, confianza: calcularConfianza(fecha, monto, num_operacion) };
	} catch (err) {
		console.error('[ocrComprobante] Error reconociendo comprobante:', err);
		return { success: false, error: err instanceof Error ? err.message : String(err) };
	}
}
