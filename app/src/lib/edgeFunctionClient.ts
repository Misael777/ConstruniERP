/**
 * Supabase Edge Functions Client
 * Llamadas directas a user-admin para CRUD de usuarios Auth
 */

import { env } from '$env/dynamic/public';

const SUPABASE_URL = env.PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = env.PUBLIC_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL) {
	console.error('[edgeFunctionClient] Missing PUBLIC_SUPABASE_URL in environment');
}

function getUserAdminUrl(): string {
	return `${SUPABASE_URL}/functions/v1/user-admin`;
}

async function handleResponse(response: Response) {
	const contentType = response.headers.get('content-type');
	if (!contentType?.includes('application/json')) {
		const text = await response.text();
		throw new Error(
			`API HTTP ${response.status}: Expected JSON but got: ${contentType}. Response: ${text.slice(0, 200)}`
		);
	}

	const data = await response.json();

	if (!response.ok && !data.success) {
		throw new Error(data.error || `HTTP ${response.status}`);
	}

	return data;
}

function defaultAuthHeaders() {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (SUPABASE_ANON_KEY) {
		headers['apikey'] = SUPABASE_ANON_KEY;
		headers['Authorization'] = `Bearer ${SUPABASE_ANON_KEY}`;
	}
	return headers;
}

async function fetchWithApiKey(url: string, init: RequestInit = {}) {
	const headers = Object.assign({}, defaultAuthHeaders(), init.headers || {});
	return fetch(url, Object.assign({}, init, { headers }));
}

/**
 * Lista todos los usuarios Auth y sus registros en public.empleados
 */
export async function listUsers() {
	const response = await fetchWithApiKey(getUserAdminUrl(), {
		method: 'GET'
	});
	return handleResponse(response);
}

/**
 * Obtiene un usuario por auth_user_id
 */
export async function getUser(authUserId: string) {
	const url = new URL(getUserAdminUrl());
	url.searchParams.set('id', authUserId);
	const response = await fetchWithApiKey(url.toString(), { method: 'GET' });
	return handleResponse(response);
}

/**
 * Crea un nuevo usuario en Supabase Auth y un registro en public.empleados
 */
export async function createUser(payload: {
	email: string;
	// El empleado activa su propio acceso después vía "Configura tu acceso" (OTP + su contraseña, ver
	// badge "Estado Cuenta" en iam/empleados/+page.svelte) — el único llamador real (esa misma página)
	// nunca manda password; se deja opcional en vez de requerido para que el tipo refleje el uso real.
	password?: string;
	nombre?: string;
	telefono?: string | null;
	rol_id?: number | null;
	area_id?: number | null;
	fecha_ingreso?: string;
	salario?: number;
	horas?: number;
	periodo?: string;
	nivel?: string | null;
}) {
	const response = await fetchWithApiKey(getUserAdminUrl(), {
		method: 'POST',
		body: JSON.stringify(payload)
	});
	return handleResponse(response);
}

/**
 * Actualiza un usuario en Supabase Auth y su registro en public.empleados
 */
export async function updateUser(payload: {
	auth_user_id: string;
	email?: string;
	password?: string;
	nombre?: string;
	telefono?: string | null;
	rol_id?: number | null;
	area_id?: number | null;
	fecha_ingreso?: string;
	salario?: number;
	horas?: number;
	periodo?: string;
	nivel?: string | null;
}) {
	const response = await fetchWithApiKey(getUserAdminUrl(), {
		method: 'PUT',
		body: JSON.stringify(payload)
	});
	return handleResponse(response);
}

/**
 * Elimina un usuario de Supabase Auth y su registro en public.empleados
 */
export async function deleteUser(authUserId: string) {
	// The Edge Function expects the identifier via the `id` query param or as `body.id`.
	// Send it as a query parameter to ensure the function receives it for both UUIDs and numeric IDs.
	const url = new URL(getUserAdminUrl());
	url.searchParams.set('id', authUserId);
	const response = await fetchWithApiKey(url.toString(), {
		method: 'DELETE'
	});
	return handleResponse(response);
}

/**
 * Da de baja a un empleado — reemplaza al borrado real (deleteUser): marca su registro en
 * `empleados` como 'baja', bloquea su acceso a la cuenta de Auth (ban de larga duración) y da de
 * baja el centro de costo que se generó para él. Ver darDeBajaEmpleado en la Edge Function.
 */
export async function darDeBajaEmpleado(authUserId: string) {
	const url = new URL(getUserAdminUrl());
	url.searchParams.set('action', 'dar-de-baja');
	const response = await fetchWithApiKey(url.toString(), {
		method: 'POST',
		body: JSON.stringify({ auth_user_id: authUserId })
	});
	return handleResponse(response);
}

/** Restaura a un empleado dado de baja (contraparte de darDeBajaEmpleado) — se usa desde la sección
 * "Eliminados" de Empleados (solo-admin), sin contraseña. Ver restaurarEmpleado en la Edge Function. */
export async function restaurarEmpleado(authUserId: string) {
	const url = new URL(getUserAdminUrl());
	url.searchParams.set('action', 'restaurar');
	const response = await fetchWithApiKey(url.toString(), {
		method: 'POST',
		body: JSON.stringify({ auth_user_id: authUserId })
	});
	return handleResponse(response);
}

/**
 * Resetea la contraseña de un usuario
 */
export async function resetPassword(authUserId: string, newPassword: string) {
	const url = new URL(getUserAdminUrl());
	url.searchParams.set('action', 'reset-password');
	const response = await fetchWithApiKey(url.toString(), {
		method: 'POST',
		body: JSON.stringify({ auth_user_id: authUserId, password: newPassword })
	});
	return handleResponse(response);
}

/**
 * Marca a un empleado como realmente activado (password_configurado = true) — llamado por el
 * propio empleado justo después de completar "Configura tu acceso" (código OTP + su contraseña)
 * en login/+page.svelte. Pasa por la Edge Function (service_role) porque un update directo a
 * `empleados` desde esa sesión de bajo privilegio falla en silencio por RLS.
 */
export async function confirmActivation(authUserId: string) {
	const url = new URL(getUserAdminUrl());
	url.searchParams.set('action', 'confirm-activation');
	const response = await fetchWithApiKey(url.toString(), {
		method: 'POST',
		body: JSON.stringify({ auth_user_id: authUserId })
	});
	return handleResponse(response);
}

