import { resolveApiUrl, parseJsonResponse } from '$lib/apiClient';
import { isRunningInTauri, uploadToDriveClient, deleteDriveFileClient } from '$lib/driveUploadClient';
import { generateUniqueFileName } from '$lib/shared/fileNaming';

export type ProjectDocumentType = 'contrato' | 'proforma' | 'documento' | 'comprobante';

export interface UploadProjectDocumentOptions {
	type: ProjectDocumentType;
	projectId: number | string;
	/** Solo aplica a type: 'documento' — subtipo de negocio (ej. 'Proforma', 'Planos Estructurales'). */
	documentType?: string;
	documentName?: string;
	projectName?: string;
}

/**
 * Sube un archivo a Google Drive, ruteando según la plataforma:
 * en Tauri (adapter-static, sin servidor Node) sube directo desde el WebView vía
 * driveUploadClient; en web delega al endpoint `/api/upload-document`.
 * Consolida la lógica antes duplicada en NuevaVentaModal.svelte y DocumentosTab.svelte.
 */
export async function uploadProjectDocument(
	file: File,
	opts: UploadProjectDocumentOptions
): Promise<{ url: string; fileName: string }> {
	const { type, projectId, documentType, documentName, projectName } = opts;

	console.log(`[uploadProjectDocument] type=${type} file=${file.name} (${file.size}b) inTauri=${isRunningInTauri()}`);

	if (isRunningInTauri()) {
		const baseLabel =
			type === 'documento'
				? `documento_${documentType || 'Otro'}_${documentName || file.name}_${projectName || 'Proyecto'}`
				: type;
		const fileName = generateUniqueFileName(baseLabel, file.name);
		const { url } = await uploadToDriveClient(file, fileName, type);
		console.log(`[uploadProjectDocument] ✓ Tauri upload OK. URL: ${url}`);
		return { url, fileName };
	}

	const formData = new FormData();
	formData.append('file', file);
	formData.append('type', type);
	formData.append('projectId', String(projectId));
	if (documentType) formData.append('documentType', documentType);
	if (documentName) formData.append('documentName', documentName);
	if (projectName) formData.append('projectName', projectName);

	const response = await fetch(resolveApiUrl('/api/upload-document'), {
		method: 'POST',
		body: formData
	});

	const result = await parseJsonResponse(response);
	if (!response.ok || !result.success) {
		throw new Error(result.details || result.error || 'Error al subir documento.');
	}

	console.log(`[uploadProjectDocument] ✓ Server upload OK. URL: ${result.url}`);
	return { url: result.url as string, fileName: result.fileName as string };
}

/** Extrae el fileId de Drive de una URL de descarga (`uc?export=download&id=X`) o de visor (`/file/d/X/...`). */
export function extractDriveFileId(url: string | null | undefined): string | null {
	if (!url) return null;
	const queryMatch = url.match(/[?&]id=([^&]+)/);
	if (queryMatch) return queryMatch[1];
	const pathMatch = url.match(/\/file\/d\/([^/]+)/);
	return pathMatch ? pathMatch[1] : null;
}

/**
 * Elimina el archivo real en Google Drive detrás de una URL ya subida (contrato, proforma,
 * documento o comprobante) — best-effort: si falla (red, permisos, ya no existe), se registra
 * en consola pero NUNCA bloquea la eliminación de la fila en BD que lo referenciaba, mismo
 * criterio que `deleteContratoAnterior` en proyectos/gestion/[id]/+page.svelte y
 * `deleteComprobante` en TransaccionModal.svelte (de donde se consolida esta lógica).
 */
export async function deleteProjectDocumentFile(url: string | null | undefined): Promise<void> {
	const fileId = extractDriveFileId(url);
	if (!fileId) return;

	try {
		if (isRunningInTauri()) {
			await deleteDriveFileClient(fileId);
		} else {
			const response = await fetch(resolveApiUrl('/api/upload-document'), {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fileId })
			});
			await parseJsonResponse(response);
		}
		console.log(`[deleteProjectDocumentFile] ✓ Archivo eliminado de Drive: ${fileId}`);
	} catch (err) {
		console.warn('[deleteProjectDocumentFile] No se pudo eliminar el archivo en Drive (best-effort):', err);
	}
}
