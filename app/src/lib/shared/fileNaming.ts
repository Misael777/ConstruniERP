/**
 * Nombrado de archivos subidos (contratos, proformas, documentos de proyecto, comprobantes, etc.)
 * — módulo compartido entre server routes (`api/upload-document`) y código de cliente
 * (`driveUploadClient.ts`, modales de carga). Antes cada sitio tenía su propia copia casi idéntica
 * del saneador de nombres, y la mayoría no agregaba NINGÚN identificador único (solo `Date.now()`
 * en el mejor de los casos, y ni eso para documentos de proyecto/comprobantes) — dos archivos
 * subidos el mismo día con el mismo tipo/nombre se pisaban entre sí. Pedido explícito del usuario:
 * todo archivo subido debe tener un nombre único que además permita rastrearlo.
 */

/** Sanitiza un segmento para usar en un nombre de archivo: solo letras, números, punto, guion y
 * guion bajo — espacios colapsados a "_", el resto de caracteres removidos. */
export function sanitizeFileSegment(value: string): string {
	return value
		.trim()
		.replace(/\s+/g, '_')
		.replace(/[^a-zA-Z0-9._-]/g, '')
		.replace(/_+/g, '_')
		.replace(/^_+|_+$/g, '');
}

/**
 * Genera un nombre de archivo único y trazable: `{tipo}_{YYYYMMDD-HHmmss}_{id8}_{nombre}.{ext}`.
 * El id corto (8 caracteres hex de un UUID v4, vía `crypto.randomUUID()` — disponible tanto en el
 * navegador/WebView de Tauri como en el runtime Node del server route) es lo que garantiza
 * unicidad real incluso si tipo + fecha + nombre original coinciden entre dos subidas distintas.
 */
export function generateUniqueFileName(tipo: string, originalName: string): string {
	const extension = originalName.includes('.') ? `.${originalName.split('.').pop()}` : '';
	const base = originalName.replace(/\.[^.]+$/, '');
	const now = new Date();
	const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); // YYYYMMDD-HHmmss
	const shortId = crypto.randomUUID().slice(0, 8);
	const safeTipo = sanitizeFileSegment(tipo) || 'archivo';
	const safeBase = sanitizeFileSegment(base) || 'documento';
	return `${safeTipo}_${stamp}_${shortId}_${safeBase}${extension}`;
}
