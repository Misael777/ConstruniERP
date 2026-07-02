import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { safeEndpoint } from '$lib/server/safeEndpoint';
import { getServerAuth, isAdminRequest } from '$lib/server/auth';
import { createCuentaCobrar } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';

const handler: RequestHandler = async ({ request, cookies }) => {
	if (!(await isAdminRequest(cookies))) {
		return json({ success: false, message: 'No autorizado: se requiere rol administrador' }, { status: 403 });
	}

	const auth = await getServerAuth(cookies);
	const payload = await request.json();
	const result = await createCuentaCobrar(supabase, payload, auth?.email ?? null);

	if (!result.success) return json(result, { status: 400 });
	return json(result);
};

export const POST = safeEndpoint(handler);
