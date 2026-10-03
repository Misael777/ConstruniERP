/**
 * Lee un comprobante emitido por SUNAT (Factura, Boleta, Nota de Crédito, Nota de Débito) desde el archivo
 * que sube el usuario en "Emisión de Comprobante" (modo "PDF de SUNAT" de FacturaModal.svelte), usando la
 * técnica más exacta disponible para cada tipo de archivo:
 *   1. XML (UBL 2.1)  -> leerXmlSunat: datos exactos.
 *   2. PDF            -> texto digital del PDF (extraerTextoPdf, pdf.js) + regex (extraerDatosDeTexto). Los
 *                        PDF que genera SUNAT traen esa capa de texto: lectura exacta e instantánea.
 *   3. PDF escaneado o foto (JPG/PNG) -> OCR (Tesseract, leerTextoComprobante) + los mismos regex.
 * Todo corre en el cliente (pdf.js, DOMParser y Tesseract WASM): igual en navegador, Tauri Windows y Tauri
 * Android, sin servicios externos.
 */
import { extraerDatosDeTexto, leerXmlSunat, camposReconocidos, type DatosComprobanteLeido } from './lectorComprobante';
import { extraerTextoPdf } from '$lib/shared/pdfPreview';
import { leerTextoComprobante } from '$lib/shared/ocrComprobante';

export const TAMANO_MAXIMO_COMPROBANTE = 20 * 1024 * 1024; // 20 MB
export const ACEPTA_COMPROBANTE = 'application/pdf,image/jpeg,image/png,.xml,text/xml,application/xml';

export type MetodoLectura = 'xml' | 'pdf_texto' | 'ocr';

export interface ComprobanteLeido {
	datos: DatosComprobanteLeido;
	metodo: MetodoLectura;
}

function esXml(file: File): boolean {
	return /\.xml$/i.test(file.name) || file.type === 'text/xml' || file.type === 'application/xml';
}
function esPdf(file: File): boolean {
	return /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
}

/** Valida tipo y tamaño antes de leer. null = válido. */
export function validarArchivoComprobante(file: File): string | null {
	if (file.size > TAMANO_MAXIMO_COMPROBANTE) return 'El archivo supera el tamaño máximo de 20 MB.';
	if (!esXml(file) && !esPdf(file) && !/^image\/(jpeg|png)$/.test(file.type) && !/\.(jpe?g|png)$/i.test(file.name)) {
		return 'Formato no permitido. Usa PDF, JPG, PNG o XML.';
	}
	return null;
}

/** Lanza solo si el archivo no se puede abrir; lo que no se reconozca queda en null para completarlo a mano. */
export async function leerComprobanteSunat(file: File): Promise<ComprobanteLeido> {
	if (esXml(file)) return { datos: leerXmlSunat(await file.text()), metodo: 'xml' };

	if (esPdf(file)) {
		const texto = await extraerTextoPdf(file);
		const datos = extraerDatosDeTexto(texto);
		// Con la capa de texto se reconoce casi todo; si casi no hay texto (PDF escaneado), se recurre a OCR.
		if (texto.length >= 40 && camposReconocidos(datos).encontrados >= 3) return { datos, metodo: 'pdf_texto' };
	}

	return { datos: extraerDatosDeTexto(await leerTextoComprobante(file)), metodo: 'ocr' };
}
