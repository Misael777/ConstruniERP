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
 * guion bajo — espacios colapsados a "_", el resto de caracteres removidos.
 *
 * La "ñ"/"Ñ" se protege ANTES del `.normalize('NFD')` (reemplazándola temporalmente por un
 * placeholder que no es una letra acentuada) porque NFD la descompone en "n" + un carácter
 * combinante separado (U+0303, tilde), que el paso siguiente borra igual que cualquier otro acento
 * — dejando "n" en vez de "ñ". El resto de vocablos acentuados (á, é, í, ó, ú) sí deben perder su
 * tilde (mismo comportamiento de siempre): `.normalize('NFD').replace(/[̀-ͯ]/g, '')`
 * separa cada letra acentuada en su letra base + su marca de acento como carácter Unicode aparte, y
 * borra solo esa marca — así "Ancón" queda "Ancon" (conserva la vocal) en vez de que el filtro
 * `[^a-zA-Z0-9._-]` de abajo borre directamente la "ó" completa, dejando "Ancn". Pedido explícito
 * del usuario: "Código de proyecto" (ver codigoProyecto.ts, que usa esta misma función para el
 * segmento de distrito) debe conservar TODAS las letras del distrito, incluida la "ñ". */
export function sanitizeFileSegment(value: string): string {
	return value
		.replace(/ñ/g, 'Ω')
		.replace(/Ñ/g, 'Ψ')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.trim()
		.replace(/\s+/g, '_')
		.replace(/[^a-zA-Z0-9._\-ΩΨ]/g, '')
		.replace(/Ω/g, 'ñ')
		.replace(/Ψ/g, 'Ñ')
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
