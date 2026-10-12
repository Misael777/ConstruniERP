/**
 * Compartir un comprobante + mensaje (ticket #83: "Detalle de Transacción" → Compartir / Compartir a
 * proveedor). Cada plataforma tiene su propia vía:
 *   - App Android (Tauri): Share Sheet nativo vía el plugin share-target (SharePlugin.compartir) — el
 *     WebView de Android no implementa navigator.share.
 *   - Escritorio / navegador: navigator.share (con el archivo si el sistema lo admite).
 *   - Si nada de eso existe: se copia el mensaje al portapapeles (el comprobante se descarga aparte).
 */
import { invoke } from '@tauri-apps/api/core';
import { isRunningInTauri, downloadFromDriveClient } from '$lib/driveUploadClient';
import { extractDriveFileId } from '$lib/shared/uploadProjectDocument';
import { resolveApiUrl } from '$lib/apiClient';
import { getInfoVersionApp } from '$lib/shared/appVersion';

export type ResultadoCompartir = 'compartido' | 'copiado' | 'cancelado';

/** Descarga el archivo de Drive de un comprobante (null si no hay o falla — se comparte solo el texto). */
export async function descargarComprobante(url: string | null | undefined): Promise<Blob | null> {
	const fileId = url ? extractDriveFileId(url) : null;
	if (!fileId) return null;
	try {
		if (isRunningInTauri()) return await downloadFromDriveClient(fileId);
		const res = await fetch(resolveApiUrl(`/api/upload-document?fileId=${encodeURIComponent(fileId)}&filename=comprobante`));
		return res.ok ? await res.blob() : null;
	} catch (err) {
		console.warn('[compartir] No se pudo descargar el comprobante:', err);
		return null;
	}
}

function extensionDe(tipo: string): string {
	if (tipo.includes('png')) return 'png';
	if (tipo.includes('webp')) return 'webp';
	if (tipo.includes('pdf')) return 'pdf';
	return 'jpg';
}

async function aBase64(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binario = '';
	for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binario);
}

export async function compartirComprobante(opciones: { texto: string; archivo?: Blob | null; nombreBase?: string }): Promise<ResultadoCompartir> {
	const { texto, archivo } = opciones;
	const tipo = archivo?.type || 'image/jpeg';
	const nombre = `${opciones.nombreBase ?? 'comprobante'}.${extensionDe(tipo)}`;

	if (isRunningInTauri() && (await getInfoVersionApp()).plataforma === 'android') {
		await invoke('plugin:share-target|compartir', {
			payload: { texto, data: archivo ? await aBase64(archivo) : null, mimeType: archivo ? tipo : null, fileName: archivo ? nombre : null }
		});
		return 'compartido';
	}

	try {
		if (archivo && typeof navigator.canShare === 'function') {
			const file = new File([archivo], nombre, { type: tipo });
			if (navigator.canShare({ files: [file] })) {
				await navigator.share({ files: [file], text: texto });
				return 'compartido';
			}
		}
		if (typeof navigator.share === 'function') {
			await navigator.share({ text: texto });
			return 'compartido';
		}
	} catch (err) {
		if ((err as Error)?.name === 'AbortError') return 'cancelado';
		console.warn('[compartir] navigator.share falló, se copia el mensaje:', err);
	}
	await navigator.clipboard.writeText(texto);
	return 'copiado';
}
