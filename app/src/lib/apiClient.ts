/**
 * API Client - Cross-platform URL resolution
 * Handles web dev, Tauri desktop, and mobile environments
 *
 * Behavior:
 * - If the browser origin is http(s), use relative URLs so the app talks to
 *   the same host that served the frontend (dev server or deployed SvelteKit).
 * - If running under a custom protocol (tauri://, file://, app://) or when
 *   running headless, prefer a configured `PUBLIC_API_BASE_URL` public env var
 *   (useful for Tauri production builds where no server is embedded).
 */

import { env } from '$env/dynamic/public';
import { isRunningInTauri } from './driveUploadClient';

function getBaseUrl(): string {
	if (typeof window === 'undefined') return '';

	const href = window.location.href;

	// Running under Tauri (any platform, including Windows' https://tauri.localhost)
	// or a raw file:// origin: fall back to a configured public API base.
	// PUBLIC_API_BASE_URL should be set to the deployed app URL (e.g. https://app.example.com).
	// Note: production Tauri builds use adapter-static, so +server.ts endpoints don't
	// exist at all — prefer driveUploadClient's direct upload path over this fallback.
	if (isRunningInTauri() || href.startsWith('file://')) {
		const baseUrl = env.PUBLIC_API_BASE_URL;
		if (baseUrl && baseUrl.length > 0) {
			// Ensure it does not end with a slash
			return baseUrl.replace(/\/$/, '');
		}
		// No configured public API base — return empty so resolveApiUrl yields relative path
		return '';
	}

	// Normal web origin -> use relative URLs
	return '';
}

/**
 * Resolve API endpoint URL for cross-platform compatibility
 * @param endpoint - API endpoint path (e.g., '/api/delete-employee-user')
 * @returns Full URL or relative path for fetch()
 */
export function resolveApiUrl(endpoint: string): string {
	const baseUrl = getBaseUrl();
	return baseUrl + endpoint;
}

/**
 * Helper for fetch requests to API endpoints
 * Includes error handling for HTML responses (common in Tauri/mobile issues)
 */
export async function fetchApi(
	endpoint: string,
	options?: RequestInit
): Promise<Response> {
	const url = resolveApiUrl(endpoint);
	const response = await fetch(url, options);
	
	console.debug(`[fetchApi] ${endpoint}:`, {
		url,
		status: response.status,
		statusText: response.statusText,
		contentType: response.headers.get('content-type'),
		ok: response.ok
	});
	
	// If we get HTML response (error page), log details for debugging
	const contentType = response.headers.get('content-type') || '';
	if (contentType.includes('text/html')) {
		const htmlPreview = await response.clone().text().then(t => t.slice(0, 300));
		console.warn(`[fetchApi] Received HTML response for ${endpoint}:`, {
			status: response.status,
			statusText: response.statusText,
			contentType,
			htmlPreview
		});
		
		// Don't throw here - let parseJsonResponse handle it for better error messages
		// This will be caught when trying to parse as JSON
	}
	
	return response;
}

/**
 * Safe JSON parsing from API response
 * Logs raw response if JSON parsing fails
 */
export async function parseJsonResponse(response: Response): Promise<any> {
	const contentType = response.headers.get('content-type');
	
	if (!contentType?.includes('application/json')) {
		const text = await response.text();
		console.error('[API Response] Non-JSON content type received:', {
			contentType,
			status: response.status,
			statusText: response.statusText,
			bodyPreview: text.slice(0, 500)
		});
		throw new Error(
			`API HTTP ${response.status}: Expected JSON but got: ${contentType}. ` +
			`Response: ${text.slice(0, 200)}`
		);
	}

	return response.json();
}
