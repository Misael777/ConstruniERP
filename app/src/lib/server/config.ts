import { env } from '$env/dynamic/private';

export const googleDriveConfig = {
	clientId: env.GOOGLE_DRIVE_CLIENT_ID || '',
	clientSecret: env.GOOGLE_DRIVE_CLIENT_SECRET || '',
	refreshToken: env.GOOGLE_DRIVE_REFRESH_TOKEN || '',
	accessToken: env.GOOGLE_DRIVE_ACCESS_TOKEN || '',
	folderIdContratos: env.GOOGLE_DRIVE_FOLDER_ID_CONTRATOS || '',
	folderIdProformas: env.GOOGLE_DRIVE_FOLDER_ID_PROFORMAS || '',
	folderIdDocumentos: env.GOOGLE_DRIVE_FOLDER_ID_DOCUMENTOS || ''
};

function getDriveFolderId(type: 'contrato' | 'proforma' | 'documento') {
	if (type === 'contrato') return googleDriveConfig.folderIdContratos;
	if (type === 'documento') return googleDriveConfig.folderIdDocumentos;
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

export async function uploadToDrive(file: File | Blob, fileName: string, type: 'contrato' | 'proforma' | 'documento') {
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

	return `https://drive.google.com/uc?export=download&id=${fileId}`;
}
