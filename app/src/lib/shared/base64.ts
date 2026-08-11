/**
 * Conversión binario <-> base64 — usada por las exportaciones a Excel (ventasExport.service.ts,
 * clientesExport.service.ts) para poder guardar el archivo generado como texto dentro de
 * payload_cambios (columna JSONB de solicitud_aprobacion) y también para escribirlo a disco
 * (ver guardarArchivoBinario en saveFile.ts).
 */

/** Recorre el buffer en bloques (no `String.fromCharCode(...bytes)` de una sola vez) — con un archivo
 * grande, pasar todos los bytes como argumentos separados desborda el límite de argumentos de la
 * función en algunos motores JS. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const chunkSize = 0x8000;
	let binary = '';
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}
	return btoa(binary);
}

// Sin anotar el tipo de retorno explícitamente: TypeScript 6 infiere `Uint8Array<ArrayBuffer>` (buffer
// concreto) desde `new Uint8Array(length)` — anotarlo como el `Uint8Array` genérico "a secas" lo
// ensancha a `Uint8Array<ArrayBufferLike>` (incluye SharedArrayBuffer), que Blob's BlobPart ya no
// acepta desde que lib.dom.d.ts hizo TypedArray genérico.
export function base64ToUint8Array(base64: string) {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}
