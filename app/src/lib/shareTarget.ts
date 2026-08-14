/**
 * Puente con el plugin nativo tauri-plugin-share-target (ver app/src-tauri/plugins/) — cuando el
 * usuario comparte una imagen desde otra app de Android (Galería, capturas de pantalla) con
 * Construni ERP, esto la recupera y arma un `File` normal, compatible con el mismo flujo que ya usa
 * TransaccionModal.svelte (processComprobanteFiles) para el comprobante. En Windows/desktop
 * getPendingShare siempre resuelve null (no hay Share Sheet nativo ahí, ver desktop.rs del plugin),
 * así que es seguro llamar a esto sin chequear la plataforma primero.
 */
import { invoke } from '@tauri-apps/api/core';
import { isRunningInTauri } from '$lib/driveUploadClient';

interface PendingShare {
	/** Bytes de la imagen en base64 — el lado Kotlin los manda directo en la respuesta del comando en
	 * vez de una ruta de archivo, para no depender del scope de `@tauri-apps/plugin-fs` (ver
	 * SharePlugin.kt). */
	data: string;
	fileName: string;
	mimeType: string;
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/** Si hay una imagen recién compartida pendiente, la decodifica y devuelve como `File` — `null` si
 * no hay ninguna (caso normal) o si algo falla (se loguea, nunca bloquea el arranque de la app). El
 * lado Kotlin la entrega UNA sola vez y la descarta, así que llamar esto dos veces seguidas la
 * segunda vez da `null`. */
export async function consumePendingSharedFile(): Promise<File | null> {
	if (!isRunningInTauri()) return null;
	try {
		const pending = await invoke<PendingShare | null>('plugin:share-target|get_pending_share');
		if (!pending) return null;
		const bytes = base64ToBytes(pending.data);
		return new File([bytes], pending.fileName, { type: pending.mimeType });
	} catch (err) {
		console.warn('[shareTarget] No se pudo leer la imagen compartida pendiente:', err);
		return null;
	}
}
