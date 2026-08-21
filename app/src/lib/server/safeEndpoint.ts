/**
 * Safe endpoint wrapper for handling configuration errors
 * Catches environment variable and initialization errors before they become HTML error pages
 */

import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';

// Genérico sobre H (en vez de sobre Params/RouteId por separado) para no tener que replicar acá el
// bound real de RouteId (AppRouteId | null, generado por SvelteKit — no exportado para reusar) —
// preserva el tipo exacto de cada +server.ts (ver Parameters<H>[0]/`as H` abajo) para que `export
// const POST = safeEndpoint(handler)` siga tipando contra el RequestHandler específico de esa ruta.
export function safeEndpoint<H extends RequestHandler<any, any>>(handler: H): H {
	const wrapped = async (event: Parameters<H>[0]) => {
		try {
			return await handler(event);
		} catch (error: any) {
			const message = error?.message || 'Unknown error';

			// Configuration errors (missing env vars)
			if (
				message.includes('SUPABASE_SERVICE_ROLE_KEY') ||
				message.includes('PUBLIC_SUPABASE_URL') ||
				message.includes('Server configuration error')
			) {
				console.error('[API] Configuration error:', message);
				return json(
					{
						success: false,
						error: 'Server not properly configured',
						details: message,
						type: 'CONFIGURATION_ERROR'
					},
					{ status: 500 }
				);
			}

			// Database or auth errors
			if (message.includes('Supabase') || message.includes('Database')) {
				console.error('[API] Supabase error:', message);
				return json(
					{
						success: false,
						error: 'Database operation failed',
						details: message,
						type: 'DATABASE_ERROR'
					},
					{ status: 500 }
				);
			}

			// Unexpected errors
			console.error('[API] Unexpected error:', error);
			return json(
				{
					success: false,
					error: 'Internal server error',
					details: message,
					type: 'INTERNAL_ERROR'
				},
				{ status: 500 }
			);
		}
	};
	return wrapped as H;
}
