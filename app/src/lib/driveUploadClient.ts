/**
 * Client-side Google Drive upload — used in Tauri desktop builds where
 * SvelteKit server routes (+server.ts) do not exist (adapter-static).
 *
 * Reads credentials from PUBLIC_* env vars (Vite inlines them at build time).
 * These are the same credentials as the server-side config.ts, duplicated here
 * as PUBLIC_* so they survive the static build for the desktop context.
 */
import { env } from '$env/dynamic/public';

export function isRunningInTauri(): boolean {
	if (typeof window === 'undefined') return false;

	// __TAURI_INTERNALS__ is always injected by Tauri v2 (used internally by
	// @tauri-apps/api's invoke()), regardless of the `withGlobalTauri` config
	// flag. __TAURI__ is only present when withGlobalTauri is enabled, so it
	// is checked as a fallback for older/alternate configurations.
	if (typeof (window as any).__TAURI_INTERNALS__ !== 'undefined') return true;
	if (typeof (window as any).__TAURI__ !== 'undefined') return true;

	const href = window.location.href;
	if (href.startsWith('tauri://') || href.startsWith('app://')) return true;

	// On Windows, Tauri v2's WebView2 requires an http(s) origin, so the app
	// is served from the reserved `tauri.localhost` host instead of a custom
	// URI scheme like `tauri://`. Without this check, the Windows build is
	// misdetected as a regular web page.
	if (window.location.hostname === 'tauri.localhost') return true;

	return false;
}

function getFolderId(type: 'contrato' | 'proforma' | 'documento' | 'comprobante'): string {
	if (type === 'contrato') return env.PUBLIC_GOOGLE_DRIVE_FOLDER_ID_CONTRATOS || '';
	if (type === 'documento') return env.PUBLIC_GOOGLE_DRIVE_FOLDER_ID_DOCUMENTOS || '';
	if (type === 'comprobante') return env.PUBLIC_GOOGLE_DRIVE_FOLDER_ID_COMPROBANTES || '';
	return env.PUBLIC_GOOGLE_DRIVE_FOLDER_ID_PROFORMAS || '';
}

async function getAccessToken(): Promise<string> {
	const clientId     = env.PUBLIC_GOOGLE_DRIVE_CLIENT_ID     || '';
	const clientSecret = env.PUBLIC_GOOGLE_DRIVE_CLIENT_SECRET || '';
	const refreshToken = env.PUBLIC_GOOGLE_DRIVE_REFRESH_TOKEN || '';

	if (!clientId || !clientSecret || !refreshToken) {
		throw new Error(
			'Google Drive credentials not configured. ' +
			'Ensure PUBLIC_GOOGLE_DRIVE_CLIENT_ID, PUBLIC_GOOGLE_DRIVE_CLIENT_SECRET ' +
			'and PUBLIC_GOOGLE_DRIVE_REFRESH_TOKEN are set in .env'
		);
	}

	const body = new URLSearchParams({
		client_id:     clientId,
		client_secret: clientSecret,
		refresh_token: refreshToken,
		grant_type:    'refresh_token'
	});

	const res = await fetch('https://oauth2.googleapis.com/token', {
		method:  'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body
	});

	const data = await res.json();
	if (!res.ok || !data.access_token) {
		throw new Error(
			`Google Drive token error: ${data.error_description || data.error || JSON.stringify(data)}`
		);
	}
	return data.access_token as string;
}

/**
 * Upload a file to Google Drive directly from the browser/Tauri WebView.
 * Returns the public download URL plus the Drive file id (needed to rename/delete it later —
 * see renameDriveFileClient/deleteDriveFileClient below).
 */
export async function uploadToDriveClient(
	file: File | Blob,
	fileName: string,
	type: 'contrato' | 'proforma' | 'documento' | 'comprobante'
): Promise<{ url: string; fileId: string }> {
	const folderId = getFolderId(type);
	if (!folderId) {
		throw new Error(`Google Drive folder ID not configured for type="${type}"`);
	}

	const accessToken = await getAccessToken();

	const metadata = { name: fileName, parents: [folderId] };
	const form = new FormData();
	form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
	form.append('file', file, fileName);

	const uploadRes = await fetch(
		'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true',
		{ method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form }
	);

	const uploadData = await uploadRes.json();
	if (!uploadRes.ok || !uploadData.id) {
		throw new Error(
			`Google Drive upload failed: ${uploadData.error?.message || JSON.stringify(uploadData)}`
		);
	}

	const fileId = uploadData.id as string;

	// Make the file publicly readable (reader for anyone)
	const permRes = await fetch(
		`https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`,
		{
			method:  'POST',
			headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
			body:    JSON.stringify({ role: 'reader', type: 'anyone', allowFileDiscovery: false })
		}
	);

	if (!permRes.ok) {
		const errBody = await permRes.text();
		if (!errBody.includes('alreadyExists')) {
			console.warn('[driveUploadClient] Could not set public permission:', errBody);
		}
	}

	return { url: `https://drive.google.com/uc?export=download&id=${fileId}`, fileId };
}

/** Renames an already-uploaded Drive file — used to rename a comprobante to its final
 * transacción-code-based name once the transacción's real id is known (see TransaccionModal.svelte). */
export async function renameDriveFileClient(fileId: string, newName: string): Promise<void> {
	const accessToken = await getAccessToken();
	const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, {
		method: 'PATCH',
		headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: newName })
	});
	if (!res.ok) {
		throw new Error(`Google Drive rename failed: ${await res.text()}`);
	}
}

/** Deletes a Drive file by id — used to remove a comprobante's previous file when it's replaced,
 * so re-uploads don't pile up as duplicates (see TransaccionModal.svelte). */
export async function deleteDriveFileClient(fileId: string): Promise<void> {
	const accessToken = await getAccessToken();
	const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${accessToken}` }
	});
	if (!res.ok && res.status !== 404) {
		throw new Error(`Google Drive delete failed: ${await res.text()}`);
	}
}