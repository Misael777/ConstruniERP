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
import { renderPdfFirstPageToDataUrl } from '$lib/shared/pdfPreview';
import { conCarga } from '$lib/stores/loading.svelte';
import { diag, iniciarOperacion, terminarOperacion } from '$lib/shared/diagnostico.svelte';

/** Modo diagnóstico (congelamiento al subir una transferencia en Android): 'actual' es el pipeline de siempre;
 * 'propuesto' es el candidato a arreglo — nunca agranda, limita el lado más largo a LADO_MAX_PROPUESTO y le pasa
 * el canvas directo a Tesseract (sin generar un PNG). Solo el panel de diagnóstico usa 'propuesto' (prueba A/B
 * en el mismo teléfono, ver probarOcr). */
export type ModoOcr = 'actual' | 'propuesto';
const LADO_MAX_PROPUESTO = 2000;

/**
 * "Filtros de realce" — a pedido explícito del usuario, mejora la imagen ANTES de pasarla a Tesseract
 * (fotos de boucher con el celular: luz pareja/baja, compresión de WhatsApp, texto chico) vía <canvas>
 * 2D puro, mismo mecanismo ya usado en pdfPreview.ts — sin librería nueva, funciona igual en browser/
 * Tauri Windows/Android. Pipeline (orden estándar en la industria para OCR de fotos de documentos):
 *   1. Escala de grises (luminancia perceptual) — el color no aporta nada al texto, solo ruido.
 *   2. Umbral de Otsu, calculado del propio histograma de la imagen (no un número fijo) — separa texto
 *      de fondo automáticamente sin importar si la foto salió más clara/oscura de lo normal.
 *   3. Binarización pura blanco/negro con ese umbral — Tesseract internamente ya intenta algo parecido,
 *      pero hacerlo antes con buen contraste da mejores resultados en fotos reales (no en PDFs ya
 *      limpios, pero tampoco les hace daño — se aplica parejo a ambas fuentes, más simple que ramificar).
 *   4. Si la imagen es más chica que UMBRAL_UPSCALE de ancho, se escala 2x — un texto muy chico en
 *      píxeles reales es el otro gran enemigo de Tesseract, aparte del contraste.
 * Nunca lanza — si algo falla (imagen corrupta, canvas no soportado), devuelve la fuente ORIGINAL sin
 * tocar, para no bloquear el OCR entero por un problema del preprocesamiento en sí.
 */
const UMBRAL_UPSCALE_PX = 1200;

function cargarImagen(fuente: File | string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		const url = typeof fuente === 'string' ? fuente : URL.createObjectURL(fuente);
		const liberar = () => {
			if (typeof fuente !== 'string') URL.revokeObjectURL(url);
		};
		img.onload = () => {
			liberar();
			resolve(img);
		};
		img.onerror = () => {
			liberar();
			reject(new Error('No se pudo cargar la imagen para preprocesarla.'));
		};
		img.src = url;
	});
}

/** Maximiza la varianza entre la clase "texto" (oscura) y "fondo" (clara) del histograma de grises —
 * método estándar de Otsu para binarización adaptativa. */
function calcularUmbralOtsu(histograma: number[], total: number): number {
	let sumaTotal = 0;
	for (let i = 0; i < 256; i++) sumaTotal += i * histograma[i];
	let sumaB = 0;
	let pesoB = 0;
	let varianzaMax = 0;
	let umbral = 128;
	for (let i = 0; i < 256; i++) {
		pesoB += histograma[i];
		if (pesoB === 0) continue;
		const pesoF = total - pesoB;
		if (pesoF === 0) break;
		sumaB += i * histograma[i];
		const mediaB = sumaB / pesoB;
		const mediaF = (sumaTotal - sumaB) / pesoF;
		const varianzaEntre = pesoB * pesoF * (mediaB - mediaF) * (mediaB - mediaF);
		if (varianzaEntre > varianzaMax) {
			varianzaMax = varianzaEntre;
			umbral = i;
		}
	}
	return umbral;
}

async function preprocesarImagenParaOcr(fuente: File | string, modo: ModoOcr = 'actual'): Promise<File | string | HTMLCanvasElement> {
	try {
		diag('Cargando imagen');
		const img = await cargarImagen(fuente);
		const escala =
			modo === 'propuesto'
				? Math.min(1, LADO_MAX_PROPUESTO / Math.max(img.width, img.height))
				: img.width < UMBRAL_UPSCALE_PX ? 2 : 1;
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(img.width * escala);
		canvas.height = Math.round(img.height * escala);
		diag('Imagen cargada; creando canvas', {
			original: `${img.width}x${img.height}`,
			escala: Math.round(escala * 100) / 100,
			canvas: `${canvas.width}x${canvas.height}`,
			megapixeles: Math.round((canvas.width * canvas.height) / 10000) / 100,
			memoriaCanvasMB: Math.round((canvas.width * canvas.height * 4) / 1048576)
		});
		const ctx = canvas.getContext('2d');
		if (!ctx) return fuente;
		ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

		diag('Leyendo píxeles (getImageData)');
		const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const pixeles = imageData.data;
		const cantidadPixeles = pixeles.length / 4;
		const histograma = new Array(256).fill(0);
		const grises = new Uint8ClampedArray(cantidadPixeles);
		for (let i = 0; i < pixeles.length; i += 4) {
			const gris = Math.round(0.299 * pixeles[i] + 0.587 * pixeles[i + 1] + 0.114 * pixeles[i + 2]);
			grises[i / 4] = gris;
			histograma[gris]++;
		}

		diag('Píxeles leídos; binarizando');
		const umbral = calcularUmbralOtsu(histograma, cantidadPixeles);
		for (let i = 0; i < pixeles.length; i += 4) {
			const valor = grises[i / 4] > umbral ? 255 : 0;
			pixeles[i] = pixeles[i + 1] = pixeles[i + 2] = valor;
		}
		ctx.putImageData(imageData, 0, 0);
		if (modo === 'propuesto') {
			diag('Realce listo; se pasa el canvas directo a Tesseract');
			return canvas;
		}
		diag('Realce listo; generando PNG (toDataURL)');
		const png = canvas.toDataURL('image/png');
		diag('PNG generado', { pngKB: Math.round((png.length * 0.75) / 1024) });
		return png;
	} catch (err) {
		console.warn('[ocrComprobante] No se pudo preprocesar la imagen, se usa el original:', err);
		diag('Error en el realce (se usa el original)', { error: err instanceof Error ? err.message : String(err) });
		return fuente;
	}
}

export interface ReconocerComprobanteResult {
	success: boolean;
	fecha?: string | null;
	monto?: number | null;
	num_operacion?: string | null;
	moneda?: 'dolares' | null;
	/** Tipo de cambio (S/ por US$) — solo aplica a un boucher de CAMBIO DE MONEDA (ej. "¡Tipo de cambio
	 * exitoso!" de BCP, ver extraerTipoCambio), no a un boucher de pago/transferencia normal. */
	tipo_cambio?: number | null;
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
 * un número con separador de miles opcional (coma) y decimales opcionales (punto). El separador de
 * miles también acepta un ESPACIO en vez de coma — confirmado con OCR real sobre el "RECIBO -
 * TRANSFERENCIA INTERNA" autogenerado (ver comprobanteTransferenciaInterna.ts): a ese tamaño de fuente
 * Tesseract leyó "S/ 5,000.00" como "S/ 5 000.00", perdiendo la coma — sin esto, extraerMonto solo
 * reconocía el "5" suelto. Se usa tanto para la búsqueda con etiqueta como sin ella, ver extraerMonto. */
const PATRON_MONTO = /S\/\.?\s*(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i;

/** Mismo patrón que PATRON_MONTO pero para un boucher en Dólares — símbolo "$"/"US$"/"U$S" en vez de
 * "S/" (a pedido explícito del usuario: un boucher en Dólares no tiene "S/" en ningún lado, así que
 * extraerMonto/extraerMontoOperacionExitosa devolvían null aunque el monto sí estuviera bien legible).
 * "$" solo (sin "US"/"U$S" antes) también cuenta como Dólares acá: este archivo solo procesa boucher de
 * pago (bancos peruanos), que nunca usan "$" para Soles. */
const PATRON_MONTO_DOLARES = /(?:US\$|U\$S|\$)\s*(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i;

/** Quita los separadores de miles (coma o espacio, ver PATRON_MONTO) antes de convertir a número. */
function limpiarMonto(valorCrudo: string): number | null {
	const valor = Number(valorCrudo.replace(/[,\s]/g, ''));
	return Number.isFinite(valor) ? valor : null;
}

/** Último respaldo de extraerMonto, SOLO cuando ni la etiqueta ni el "S/ <número>" genérico encontraron
 * nada — boucher tipo Yape/Plin/BCP con el banner "¡Operación exitosa!" y el monto justo debajo en letra
 * grande y estilizada (confirmado con un boucher BCP real: Tesseract no reconoció el símbolo "S/" de ese
 * monto grande, aunque sí leyó bien el resto del texto — sin este respaldo, extraerMonto devolvía null
 * en ese caso). Se ancla a esa frase EXACTA (tolerante solo a la tilde de "operación", nunca a un texto
 * genérico) y busca el primer número con forma de monto (2 decimales, "S/" opcional) en una ventana
 * corta después — acotado a este contexto puntual para no "malograr" ninguna otra búsqueda: un número
 * suelto en cualquier otra parte del comprobante nunca se toma como monto por esta vía, solo el que
 * aparece pegado a esta frase bien reconocible y específica de un pago/transferencia ya confirmado. */
function extraerMontoOperacionExitosa(texto: string): number | null {
	const idx = texto.search(/operaci[oó]n\s+exitosa/i);
	if (idx === -1) return null;
	const ventana = texto.slice(idx, idx + 60);
	const m = ventana.match(/(?:S\/\.?\s*|(?:US\$|U\$S|\$)\s*)?(\d{1,3}(?:[,\s]\d{3})*\.\d{2}|\d+\.\d{2})/);
	return m ? limpiarMonto(m[1]) : null;
}

/** Busca el monto pagado. Tres pasadas, en orden de prioridad:
 *  1. Junto a una etiqueta explícita ("Monto"/"Importe"/"Total"/"Pagaste"/"Enviaste"/"Pagado") — evita
 *     confundirlo con otro monto secundario del comprobante (comisión, ITF, saldo disponible, etc.)
 *     que a veces aparece ANTES en el texto, algo común en transferencias BCP/BBVA/Interbank.
 *  2. Si no hay ninguna etiqueta reconocible (caso típico de Yape/Plin, que solo muestran "S/10" en
 *     grande sin la palabra "Monto" al lado), se toma el primer "S/ <número>" que aparezca.
 *  3. Si tampoco hay ningún "S/" reconocible en todo el texto (Tesseract a veces no lee ese símbolo
 *     cuando el monto está en letra muy grande/estilizada — ver extraerMontoOperacionExitosa), se
 *     intenta ese último respaldo, acotado a boucher con el banner "¡Operación exitosa!".
 * null si ninguna de las pasadas encuentra nada.
 * Tolerancia de 40 caracteres entre etiqueta y monto (antes 15) — a pedido explícito del usuario, con
 * nuevos formatos de referencia (ej. constancia de operación BCP con layout de tabla "etiqueta | valor"
 * en dos columnas): mismo motivo que el gap de 40 caracteres que ya usa extraerNumeroOperacion para
 * "N° DE RECIBO"/"FECHA DE EMISIÓN" — Tesseract puede linealizar un layout de dos columnas metiendo
 * texto de otro bloque entre la etiqueta y su valor. Ensanchar el gap es seguro: solo tolera más texto
 * SIN dígitos en el medio (\D), nunca deja que el patrón salte por encima de otro número real.
 * Cada intento con PATRON_MONTO (símbolo "S/") se repite con PATRON_MONTO_DOLARES (símbolo "$"/"US$") —
 * a pedido explícito del usuario, un boucher en Dólares no tiene "S/" en ningún lado. */
function extraerMonto(texto: string): number | null {
	const conEtiquetaSoles = texto.match(new RegExp(`(?:monto|importe|total|pagaste|enviaste|pagado)\\D{0,40}?${PATRON_MONTO.source}`, 'i'));
	if (conEtiquetaSoles) return limpiarMonto(conEtiquetaSoles[1]);

	const conEtiquetaDolares = texto.match(new RegExp(`(?:monto|importe|total|pagaste|enviaste|pagado)\\D{0,40}?${PATRON_MONTO_DOLARES.source}`, 'i'));
	if (conEtiquetaDolares) return limpiarMonto(conEtiquetaDolares[1]);

	const genericoSoles = texto.match(PATRON_MONTO);
	if (genericoSoles) return limpiarMonto(genericoSoles[1]);

	const genericoDolares = texto.match(PATRON_MONTO_DOLARES);
	if (genericoDolares) return limpiarMonto(genericoDolares[1]);

	return extraerMontoOperacionExitosa(texto);
}

/** Monto de una factura/boleta (a diferencia de extraerMonto, pensada para un boucher de pago) — prueba
 * etiquetas típicas de un comprobante de venta, de la más a la menos específica ("total a pagar" antes
 * que "total" a secas, para no toparse con "Sub Total" u otra fila secundaria primero). El símbolo "S/"
 * es OPCIONAL acá: algunas facturas solo indican la moneda una vez ("SOLES") y muestran los montos en
 * una tabla sin el símbolo en cada línea — exige 2 decimales para no confundirse con un RUC/N° de
 * documento cercano. Si una etiqueta aparece varias veces (ej. "Total" de cada ítem de una tabla), se
 * queda con la ÚLTIMA — el total general va al final, después del detalle/subtotal/IGV. Mismo gap de 40
 * caracteres que extraerMonto (ver comentario ahí) — a pedido explícito del usuario, con formatos de
 * referencia tipo NubeFact donde el cuadro "IMPORTE EN LETRAS" queda al lado (no debajo) de la tabla de
 * totales, y Tesseract puede linealizar ese texto metido entre "TOTAL" y su "S/ monto". */
function extraerMontoFactura(texto: string): number | null {
	for (const etiqueta of ['total a pagar', 'importe total', 'total general', 'monto total', 'total']) {
		// Separador de miles coma o espacio — mismo motivo que PATRON_MONTO arriba.
		const regex = new RegExp(`${etiqueta}\\D{0,40}?(?:S\\/\\.?\\s*)?(\\d{1,3}(?:[,\\s]\\d{3})*\\.\\d{2}|\\d+\\.\\d{2})`, 'gi');
		let ultimo: RegExpExecArray | null = null;
		for (let m = regex.exec(texto); m !== null; m = regex.exec(texto)) ultimo = m;
		if (ultimo) {
			const valor = limpiarMonto(ultimo[1]);
			if (valor !== null) return valor;
		}
	}
	return extraerMonto(texto);
}

/** Prefijo "N°"/"Nro."/"Número"/"Código" tolerante a cómo Tesseract suele leer mal el símbolo "°" —
 * confirmado corriendo OCR de verdad sobre el "RECIBO DE PAGO" autogenerado (ver reciboPagoEfectivo.ts):
 * en un mismo documento lo leyó como `N*` en un lugar y como `N"` en otro. Sin esto, cualquier etiqueta
 * que dependa de "N°" es frágil. */
const PREFIJO_NUMERO = '(?:n[°º*"\']?\\.?|nro\\.?|n[uú]mero|c[oó]digo)';

/** Busca un N° de operación bancario: etiqueta reconocible ("N°"/"Nro."/"Número"/"Código" + "de
 * operación"/"transacción"/"referencia"/"constancia"/"rastreo"/"confirmación" — cada banco usa la
 * suya: Yape/Plin dicen "operación", BCP escribe "Número de operación" completo, Interbank "N° de
 * constancia") seguida DE INMEDIATO de un bloque de dígitos — descarta cualquier otro número del
 * comprobante (monto, celular, código de seguridad) que no venga con esa etiqueta al lado. Tolera
 * espacios/guiones internos en el número (se limpian) y exige al menos 6 dígitos, para no confundirlo
 * con un código de seguridad corto (ej. el de 3 dígitos de Yape). Compartida por extraerNumeroOperacion
 * (área 1, boucher principal) y extraerNumeroDocumento (sección "Comprobantes") — a pedido explícito
 * del usuario, un boucher bancario normal adjuntado ahí también debe reconocer su N° de operación, no
 * solo la serie de factura/boleta o el N° de recibo autogenerado. */
function extraerNumeroConEtiquetaBancaria(texto: string): string | null {
	const m = texto.match(
		new RegExp(`${PREFIJO_NUMERO}\\s*(?:de\\s*)?(?:operaci[oó]n|transacci[oó]n|referencia|constancia|rastreo|confirmaci[oó]n)\\s*[:\\-]?\\s*(\\d[\\d\\s-]{4,14}\\d)`, 'i')
	);
	if (!m) return null;
	const soloDigitos = m[1].replace(/[\s-]/g, '');
	return soloDigitos.length >= 6 ? soloDigitos : null;
}

/** Busca un N° suelto en la PARTE SUPERIOR del documento (ej. "N° 0001" en
 * comprobanteTransferenciaInterna.ts, "N° 0000117" en reciboPagoEfectivo.ts/reciboPagoProveedor.ts) —
 * confirmado corriendo OCR real contra los 3 formatos de recibo que este ERP autogenera. 4 a 10
 * dígitos: la Transferencia Interna usa un correlativo de solo 4 dígitos ("N° 0001", ver
 * comprobanteTransferenciaInterna.ts) que un rango de 6-10 dejaba fuera — confirmado que ese formato
 * además NO tiene ninguna sección "N° DE RECIBO" (a diferencia de los otros dos), así que sin este
 * intento su N° no se reconocía de NINGUNA forma al volver a adjuntarlo. Acotado a los primeros ~120
 * caracteres para no confundirlo con cualquier otro "N°" que aparezca más adelante en el documento. */
function extraerNumeroEncabezado(texto: string): string | null {
	const inicio = texto.slice(0, 120);
	const m = inicio.match(new RegExp(`${PREFIJO_NUMERO}\\s*(\\d{4,10})\\b`, 'i'));
	return m ? m[1] : null;
}

/** Busca el número/código de operación para "Fecha (reconocida)"/"Monto (reconocido)"/"N° de Operación
 * (reconocido)" del área 1 (ver reconocerComprobante). Tres intentos: (1) etiqueta bancaria, ver
 * extraerNumeroConEtiquetaBancaria; (2) "N° DE RECIBO" — el propio "RECIBO DE PAGO"/"RECIBO DE PAGO A
 * PROVEEDOR" autogenerados de este ERP (ver reciboPagoEfectivo.ts/reciboPagoProveedor.ts), cuando
 * alguno de esos PDF se vuelve a adjuntar como boucher: ahí la etiqueta vive en un encabezado de DOS
 * COLUMNAS junto a "FECHA DE EMISIÓN" — confirmado con OCR real, Tesseract linealiza las dos etiquetas
 * juntas ANTES que los dos valores ("N° DE RECIBO FECHA DE EMISIÓN" en una línea, "0000117 21/08/2025"
 * en la siguiente), por eso tolera hasta 40 caracteres que no sean dígitos entre la etiqueta y el
 * número; (3) el N° suelto del encabezado (ver extraerNumeroEncabezado) — único respaldo que sí cubre
 * el "RECIBO - TRANSFERENCIA INTERNA" (comprobanteTransferenciaInterna.ts), que no tiene sección "N° DE
 * RECIBO". */
function extraerNumeroOperacion(texto: string): string | null {
	const conEtiquetaBancaria = extraerNumeroConEtiquetaBancaria(texto);
	if (conEtiquetaBancaria) return conEtiquetaBancaria;

	const conEtiquetaRecibo = texto.match(new RegExp(`${PREFIJO_NUMERO}\\s*(?:de\\s*)?recibo\\D{0,40}?(\\d{6,10})`, 'i'));
	if (conEtiquetaRecibo) return conEtiquetaRecibo[1];

	return extraerNumeroEncabezado(texto);
}

/** Detecta si el boucher está en Dólares — a pedido explícito del usuario, para autoseleccionar "Tipo
 * de Moneda" en TransaccionModal.svelte (ver runOcr ahí) sin que el usuario tenga que cambiarlo a mano.
 * Solo reporta 'dolares': el default del formulario ya es 'soles', así que no hace falta (ni conviene)
 * detectarlo explícitamente — evita pisar una elección manual del usuario cuando el boucher no menciona
 * ninguna moneda. Busca "dólares"/"dolares" (banco peruano, ej. "Moneda Dólares") o "US$"/"USD" (forma
 * más típica de un boucher en dólares de banco extranjero o de una cuenta en USD) con límites de palabra,
 * para no confundirse con un RUC/código que solo contenga esas letras seguidas. */
function extraerMoneda(texto: string): 'dolares' | null {
	const t = sinTildes(texto.toLowerCase());
	return /\bdolares\b|\bus\$|\busd\b/.test(t) ? 'dolares' : null;
}

/** Tipo de cambio (S/ por US$) de un boucher de CAMBIO DE MONEDA — a pedido explícito del usuario, para
 * autocompletar "Tipo de Cambio" en TransaccionModal.svelte (ver runOcr ahí) sin que el usuario tenga
 * que copiarlo a mano. Confirmado con un boucher BCP real ("¡Tipo de cambio exitoso!"): el valor viene
 * junto a la etiqueta "Tipo de cambio" con 3-4 decimales (ej. "S/ 3.4010"), no 2 como un monto normal —
 * por eso exige {3,4} decimales exactos (\.\d{3,4}) en vez de reusar PATRON_MONTO (tope de 2). "S/" es
 * OPCIONAL: algunos formatos escriben el número solo, sin el símbolo delante. Mismo gap de 40 caracteres
 * tolerante a texto intermedio que el resto de extractores de este archivo (ver extraerMonto). null si
 * no hay ninguna etiqueta "tipo de cambio" en el texto (boucher de pago/transferencia normal, no de
 * cambio de moneda).
 *
 * Bug real reportado por el usuario: el propio banner del boucher dice "¡Tipo de cambio exitoso!"
 * justo ANTES del monto YA CONVERTIDO (ej. "S/ 34,008.30", con separador de miles y 2 decimales) —
 * como esa frase también matchea "tipo de cambio" y el monto convertido aparece a pocos caracteres,
 * una versión anterior de este regex (que aceptaba 1-4 decimales Y separador de miles) enganchaba ESE
 * número por error en vez del tipo de cambio real, unas líneas más abajo ("Tipo de cambio  S/ 3.4010").
 * Exigir 3-4 decimales exactos y sin separador de miles (un tipo de cambio real nunca los necesita, es
 * un número chico) hace que el banner falle su intento de match y el regex avance solo hasta la
 * segunda ocurrencia real de la etiqueta. */
function extraerTipoCambio(texto: string): number | null {
	const m = texto.match(/tipo\s+de\s+cambio\D{0,40}?(?:S\/\.?\s*)?(\d{1,3}\.\d{3,4})\b/i);
	return m ? limpiarMonto(m[1]) : null;
}

function calcularConfianza(fecha: string | null, monto: number | null, numOperacion: string | null): 'alta' | 'media' | 'baja' {
	const encontrados = [fecha, monto, numOperacion].filter((v) => v !== null && v !== undefined).length;
	if (encontrados === 3) return 'alta';
	if (encontrados > 0) return 'media';
	return 'baja';
}

/** Detecta el Tipo de Documento (mismo catálogo del campo homónimo, ver transaccion.config.ts) por
 * palabra clave en el texto reconocido — para la sección "Comprobantes" (ver
 * reconocerComprobantePago). "Recibo de pago"/"transferencia interna" (los PDF que este mismo ERP
 * autogenera, ver reciboPagoEfectivo.ts/comprobanteTransferenciaInterna.ts) tienen su propia opción
 * "Recibo" en el catálogo (valor '9') — a pedido explícito del usuario. */
function extraerTipoDocumento(texto: string): string | null {
	const t = sinTildes(texto.toLowerCase());
	if (/\bfactura\b/.test(t)) return '1';
	if (/\bboleta\b/.test(t)) return '2';
	if (/recibo\s+por\s+honorarios/.test(t)) return '3';
	if (/\bticket\b/.test(t)) return '4';
	if (/autodetraccion|\bdetraccion\b/.test(t)) return '5';
	if (/recibo\s+de\s+pago|transferencia\s+interna/.test(t)) return '9';
	return null;
}

/** N° de documento — cuatro intentos, de más a menos específico:
 *
 * 1. Serie peruana (letra + 2-3 dígitos, ej. F001/B001/E001) + correlativo (hasta 8 dígitos), ej.
 *    "F001-00123" — facturas/boletas.
 *
 * 2. N° de operación bancario (ver extraerNumeroConEtiquetaBancaria) — a pedido explícito del usuario:
 *    un boucher normal (Yape/Plin/BCP/BBVA/Interbank) adjuntado en la sección "Comprobantes" no tiene
 *    esa serie con letra, así que antes se quedaba sin N° de documento aunque el boucher sí mostrara
 *    claramente su N° de operación — ahora también se reconoce acá, igual que ya hacía
 *    extraerNumeroOperacion para el boucher principal del área 1.
 *
 * 3. El N° suelto del encabezado (ver extraerNumeroEncabezado) — más confiable que "N° DE RECIBO" (el
 *    intento 4) porque no depende de que el OCR linealice bien un encabezado de dos columnas, solo de
 *    leer un número grande y aislado casi al inicio del texto. Único de los cuatro que sí cubre el
 *    "RECIBO - TRANSFERENCIA INTERNA" (ver comprobanteTransferenciaInterna.ts), que no tiene sección
 *    "N° DE RECIBO" como los otros dos recibos autogenerados.
 *
 * 4. "N° DE RECIBO" (sección 4 de "RECIBO DE PAGO"/"RECIBO DE PAGO A PROVEEDOR" autogenerados, ver
 *    reciboPagoEfectivo.ts/reciboPagoProveedor.ts) como último respaldo — mismo patrón tolerante a
 *    encabezados de dos columnas y a cómo Tesseract lee mal "°" que ya usa extraerNumeroOperacion (ver
 *    PREFIJO_NUMERO). */
function extraerNumeroDocumento(texto: string): string | null {
	const m = texto.match(/\b([A-Z]{1,3}\d{2,3})[\s-]+(\d{1,8})\b/);
	if (m) return `${m[1]}-${m[2]}`;

	const conEtiquetaBancaria = extraerNumeroConEtiquetaBancaria(texto);
	if (conEtiquetaBancaria) return conEtiquetaBancaria;

	const mEncabezado = extraerNumeroEncabezado(texto);
	if (mEncabezado) return mEncabezado;

	const mRecibo = texto.match(new RegExp(`${PREFIJO_NUMERO}\\s*(?:de\\s*)?recibo\\D{0,40}?(\\d{6,10})`, 'i'));
	return mRecibo ? mRecibo[1] : null;
}

export interface ReconocerComprobantePagoResult {
	success: boolean;
	tipo_documento?: string | null;
	num_documento?: string | null;
	monto?: number | null;
	error?: string;
}

/** Lee Tipo de Documento/N° de Documento/Monto de un comprobante (factura, boleta, etc.) vía OCR +
 * regex, para autocompletar cada fila de la sección "Comprobantes" en TransaccionModal.svelte — a
 * pedido explícito del usuario. A diferencia de reconocerComprobante (boucher de pago del área 1, solo
 * imágenes), esta SÍ procesa PDF: renderiza su primera página a imagen (ver
 * renderPdfFirstPageToDataUrl, a mayor resolución que la miniatura de vista previa, para que el OCR
 * tenga texto más nítido) antes de pasarla a Tesseract. Nunca lanza. */
/** PDF/imagen → realce → Tesseract, con cada paso anotado en el registro de diagnóstico (ver
 * diagnostico.svelte.ts): si Android mata la app a la mitad, el registro dice en qué paso fue. */
async function leerTextoOcr(file: File, etiqueta: string, anchoPdf: number, modo: ModoOcr = 'actual'): Promise<string> {
	const operacion = `OCR ${etiqueta}${modo === 'propuesto' ? ' (propuesto)' : ''}`;
	iniciarOperacion(operacion, { archivo: file.name, tipo: file.type, kb: Math.round(file.size / 1024) });
	const inicio = performance.now();
	try {
		const esPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
		let fuente: File | string = file;
		if (esPdf) {
			diag('PDF: renderizando la primera página', { ancho: anchoPdf });
			fuente = await renderPdfFirstPageToDataUrl(file, anchoPdf);
		}
		const fuenteRealzada = await preprocesarImagenParaOcr(fuente, modo);
		diag('Tesseract: iniciando (descarga/arranque del motor + lectura)');
		const inicioTesseract = performance.now();
		const { data } = await recognize(fuenteRealzada, 'spa');
		diag('Tesseract: terminó', { segundos: Math.round((performance.now() - inicioTesseract) / 100) / 10, caracteres: (data.text || '').length });
		terminarOperacion(operacion, { segundosTotal: Math.round((performance.now() - inicio) / 100) / 10 });
		return data.text || '';
	} catch (err) {
		terminarOperacion(operacion, { error: err instanceof Error ? err.message : String(err) });
		throw err;
	}
}

/** Prueba A/B del panel de diagnóstico: corre el OCR completo con el pipeline actual o el propuesto. */
export async function probarOcr(file: File, modo: ModoOcr): Promise<{ segundos: number; caracteres: number }> {
	const inicio = performance.now();
	const texto = await leerTextoOcr(file, `prueba ${file.name}`, 1600, modo);
	return { segundos: Math.round((performance.now() - inicio) / 100) / 10, caracteres: texto.length };
}

export async function reconocerComprobantePago(file: File): Promise<ReconocerComprobantePagoResult> {
	return conCarga('Leyendo el comprobante…', () => reconocerComprobantePagoInterno(file));
}

async function reconocerComprobantePagoInterno(file: File): Promise<ReconocerComprobantePagoResult> {
	try {
		const texto = await leerTextoOcr(file, 'comprobante de pago', 1600);
		// Log temporal para ajustar los regex con el texto REAL que lee Tesseract en cada factura/boleta
		// (en vez de adivinar formatos) — revisar en la consola del navegador (F12) tras subir un archivo.
		console.log('[ocrComprobante] Texto reconocido (comprobante de pago):', texto);

		const tipo_documento = extraerTipoDocumento(texto);
		const num_documento = extraerNumeroDocumento(texto);
		const monto = extraerMontoFactura(texto);

		if (tipo_documento === null && num_documento === null && monto === null) {
			return { success: false, error: 'No se pudo reconocer ningún dato del comprobante. Complétalos a mano.' };
		}
		return { success: true, tipo_documento, num_documento, monto };
	} catch (err) {
		console.error('[ocrComprobante] Error reconociendo comprobante de pago:', err);
		return { success: false, error: err instanceof Error ? err.message : String(err) };
	}
}

/** Texto completo de una Factura/Boleta/Nota de Crédito/Débito (foto o PDF) leído con OCR — para el
 * modo "PDF de SUNAT" de "Emisión de Comprobante" cuando el archivo es una foto o un PDF escaneado (ver extraerDatosDeTexto en
 * facturacion/services/lectorComprobante.ts, que lo interpreta con regex). Mismo pipeline que
 * reconocerComprobantePago (PDF -> imagen, realce, Tesseract en español) pero a mayor resolución: un
 * comprobante trae más texto chico (tabla de productos, bloque de totales) que un boucher. Lanza si
 * Tesseract falla; quien llama decide cómo avisar. */
export async function leerTextoComprobante(file: File): Promise<string> {
	return conCarga('Leyendo el comprobante…', async () => {
		return leerTextoOcr(file, 'factura/boleta', 2000);
	});
}

/** Lee fecha, monto y N° de operación de una foto o PDF de comprobante de pago vía OCR (Tesseract.js) +
 * regex — ver "Fecha (reconocida)"/"Monto (reconocido)"/"N° de Operación (reconocido)" en
 * TransaccionModal.svelte. Si `file` es un PDF (ej. el boucher de un banco exportado como PDF, o el
 * "RECIBO - TRANSFERENCIA INTERNA"/"RECIBO DE PAGO" autogenerados), se renderiza su primera página a
 * imagen (ver renderPdfFirstPageToDataUrl) antes de pasarla a Tesseract — mismo criterio que
 * reconocerComprobantePago, que ya soportaba PDF; antes esta función SOLO procesaba imágenes y un PDF
 * se descartaba en silencio (ver runOcr en TransaccionModal.svelte), dejando Fecha/Monto/N° de
 * Operación sin ningún valor reconocido y sin ningún aviso al usuario. Nunca lanza — un fallo de
 * reconocimiento no debe bloquear el registro manual de la transacción. */
export async function reconocerComprobante(file: File): Promise<ReconocerComprobanteResult> {
	return conCarga('Leyendo el comprobante…', () => reconocerComprobanteInterno(file));
}

async function reconocerComprobanteInterno(file: File): Promise<ReconocerComprobanteResult> {
	try {
		const texto = await leerTextoOcr(file, 'boucher de transferencia', 1600);
		// Log temporal para ajustar los regex con el texto REAL que lee Tesseract en cada boucher (en
		// vez de adivinar formatos) — revisar en la consola del navegador (F12) tras subir un boucher.
		console.log('[ocrComprobante] Texto reconocido:', texto);

		const fecha = extraerFecha(texto);
		const monto = extraerMonto(texto);
		const num_operacion = extraerNumeroOperacion(texto);
		const moneda = extraerMoneda(texto);
		const tipo_cambio = extraerTipoCambio(texto);

		if (fecha === null && monto === null && num_operacion === null) {
			return { success: false, moneda, tipo_cambio, error: 'No se pudo reconocer ningún dato del comprobante. Complétalos a mano.' };
		}

		return { success: true, fecha, monto, num_operacion, moneda, tipo_cambio, confianza: calcularConfianza(fecha, monto, num_operacion) };
	} catch (err) {
		console.error('[ocrComprobante] Error reconociendo comprobante:', err);
		return { success: false, error: err instanceof Error ? err.message : String(err) };
	}
}
