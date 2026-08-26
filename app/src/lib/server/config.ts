import { env } from '$env/dynamic/private';

export const googleDriveConfig = {
	clientId: env.GOOGLE_DRIVE_CLIENT_ID || '',
	clientSecret: env.GOOGLE_DRIVE_CLIENT_SECRET || '',
	refreshToken: env.GOOGLE_DRIVE_REFRESH_TOKEN || '',
	accessToken: env.GOOGLE_DRIVE_ACCESS_TOKEN || '',
	folderIdContratos: env.GOOGLE_DRIVE_FOLDER_ID_CONTRATOS || '',
	folderIdProformas: env.GOOGLE_DRIVE_FOLDER_ID_PROFORMAS || '',
	folderIdDocumentos: env.GOOGLE_DRIVE_FOLDER_ID_DOCUMENTOS || '',
	folderIdComprobantes: env.GOOGLE_DRIVE_FOLDER_ID_COMPROBANTES || ''
};

function getDriveFolderId(type: 'contrato' | 'proforma' | 'documento' | 'comprobante') {
	if (type === 'contrato') return googleDriveConfig.folderIdContratos;
	if (type === 'documento') return googleDriveConfig.folderIdDocumentos;
	if (type === 'comprobante') return googleDriveConfig.folderIdComprobantes;
	return googleDriveConfig.folderIdProformas;
}

async function getDriveAccessToken() {
	if (googleDriveConfig.accessToken) {
		return googleDriveConfig.accessToken;
	}

	if (!googleDriveConfig.clientId || !googleDriveConfig.clientSecret || !googleDriveConfig.refreshToken) {
		throw new Error('Google Drive credentials are missing in server environment. Provide either GOOGLE_DRIVE_ACCESS_TOKEN or a valid client ID / client secret / refresh token combination.');
	}

	const body = new URLSearchParams({
		client_id: googleDriveConfig.clientId,
		client_secret: googleDriveConfig.clientSecret,
		refresh_token: googleDriveConfig.refreshToken,
		grant_type: 'refresh_token'
	});

	const response = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body
	});

	const tokenData = await response.json();
	if (!response.ok || !tokenData.access_token) {
		throw new Error(`Google Drive token error: ${tokenData.error_description || tokenData.error || 'Unknown'}`);
	}

	return tokenData.access_token as string;
}

export async function uploadToDrive(
	file: File | Blob,
	fileName: string,
	type: 'contrato' | 'proforma' | 'documento' | 'comprobante'
): Promise<{ url: string; fileId: string }> {
	const folderId = getDriveFolderId(type);
	if (!folderId) {
		throw new Error(`Google Drive folder ID is not configured for type=${type}`);
	}

	const accessToken = await getDriveAccessToken();
	const metadata = {
		name: fileName,
		parents: [folderId]
	};

	const formData = new FormData();
	formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
	formData.append('file', file, fileName);

	const uploadResponse = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`
		},
		body: formData
	});

	const uploadResult = await uploadResponse.json();
	if (!uploadResponse.ok || !uploadResult.id) {
		throw new Error(`Google Drive upload failed: ${uploadResult.error?.message || JSON.stringify(uploadResult)}`);
	}

	const fileId = uploadResult.id as string;
	const permissionResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ role: 'reader', type: 'anyone', allowFileDiscovery: false })
	});

	if (!permissionResponse.ok) {
		const errorBody = await permissionResponse.text();
		if (!errorBody.includes('alreadyExists')) {
			console.warn('[Google Drive] Could not create public permission:', errorBody);
		}
	}

	return { url: `https://drive.google.com/uc?export=download&id=${fileId}`, fileId };
}

/**
 * Renombra un archivo ya subido — usado para el comprobante de una transacción recién creada, cuyo
 * nombre definitivo (código = id_transaccion) solo se conoce después del insert (ver
 * TransaccionModal.svelte). No es crítico: si falla, el archivo sigue accesible con su nombre temporal.
 */
export async function renameDriveFile(fileId: string, newName: string): Promise<void> {
	const accessToken = await getDriveAccessToken();
	const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, {
		method: 'PATCH',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ name: newName })
	});
	if (!response.ok) {
		const errorBody = await response.text();
		throw new Error(`Google Drive rename failed: ${errorBody}`);
	}
}

/**
 * Trae el CONTENIDO binario real de un archivo de Drive — a pedido explícito del usuario: los enlaces
 * públicos de Drive (`uc?export=download`, `usercontent.google.com/download`) no garantizan el
 * encabezado CORS de forma confiable cuando se piden con fetch() desde el navegador (a veces sí, a
 * veces "blocked by CORS policy"), así que la descarga con nombre de archivo personalizado dejó de
 * funcionar. Esto en cambio pasa por ESTE servidor (server-to-server con Google, sin CORS de por
 * medio) usando la misma autenticación que ya usa uploadToDrive/renameDriveFile/deleteDriveFile —
 * confiable, ya probada. El endpoint GET de +server.ts la usa para servirle el archivo al navegador
 * con el Content-Disposition que arma el nombre exacto que se quiere.
 */
export async function downloadDriveFile(fileId: string): Promise<{ body: ReadableStream<Uint8Array> | null; contentType: string }> {
	const accessToken = await getDriveAccessToken();
	const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
		headers: { Authorization: `Bearer ${accessToken}` }
	});
	if (!response.ok) {
		const errorBody = await response.text();
		throw new Error(`Google Drive download failed: ${errorBody}`);
	}
	return { body: response.body, contentType: response.headers.get('Content-Type') || 'application/octet-stream' };
}

/**
 * Borra un archivo de Drive por su id — usado para quitar el comprobante anterior de una transacción
 * cuando se reemplaza por uno nuevo, para no dejar duplicados (ver TransaccionModal.svelte).
 */
export async function deleteDriveFile(fileId: string): Promise<void> {
	const accessToken = await getDriveAccessToken();
	const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${accessToken}` }
	});
	if (!response.ok && response.status !== 404) {
		const errorBody = await response.text();
		throw new Error(`Google Drive delete failed: ${errorBody}`);
	}
}
