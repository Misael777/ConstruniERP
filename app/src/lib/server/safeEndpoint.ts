/**
 * Safe endpoint wrapper for handling configuration errors
 * Catches environment variable and initialization errors before they become HTML error pages
 */

import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';

export function safeEndpoint(handler: RequestHandler): RequestHandler {
	return async (event) => {
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
}
