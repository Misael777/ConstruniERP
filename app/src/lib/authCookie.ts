/**
 * Puente sesión (cliente) -> cookie (servidor).
 *
 * El proyecto guarda la sesión de Supabase en localStorage (ver supabaseClient.ts) y no usa
 * @supabase/ssr, así que +page.server.ts / +server.ts no tienen forma nativa de saber quién
 * hace la petición. Este helper copia el access_token/refresh_token a cookies simples cada vez
 * que cambia el estado de auth (login, refresh, logout), para que el servidor pueda leerlas
 * con `event.cookies` y verificar la sesión (ver $lib/server/auth.ts).
 *
 * Nota de seguridad: al setearse desde JS del cliente, estas cookies NO pueden ser httpOnly
 * (quedan expuestas a XSS igual que ya lo está el token en localStorage). Si más adelante se
 * necesita algo más robusto, migrar a @supabase/ssr con cookies httpOnly reales.
 */

export const ACCESS_TOKEN_COOKIE = 'sb-access-token';
export const REFRESH_TOKEN_COOKIE = 'sb-refresh-token';

interface MinimalSession {
	access_token: string;
	refresh_token: string;
	expires_in?: number;
}

export function syncAuthCookies(session: MinimalSession | null) {
	if (typeof document === 'undefined') return;

	if (!session) {
		document.cookie = `${ACCESS_TOKEN_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
		document.cookie = `${REFRESH_TOKEN_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
		return;
	}

	const accessMaxAge = session.expires_in ?? 3600;
	document.cookie = `${ACCESS_TOKEN_COOKIE}=${session.access_token}; path=/; max-age=${accessMaxAge}; SameSite=Lax`;
	// El refresh token se conserva más tiempo (30 días) para no forzar re-login en cada expiración del access token.
	document.cookie = `${REFRESH_TOKEN_COOKIE}=${session.refresh_token}; path=/; max-age=2592000; SameSite=Lax`;
}
