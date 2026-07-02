import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { safeEndpoint } from '$lib/server/safeEndpoint';
import { isAdminRequest } from '$lib/server/auth';
import { createCentroCosto } from '$lib/modules/centro-costos/services/centroCostos.service';

const handler: RequestHandler = async ({ request, cookies }) => {
	if (!(await isAdminRequest(cookies))) {
		return json({ success: false, message: 'No autorizado: se requiere rol administrador' }, { status: 403 });
	}

	const payload = await request.json();
	const result = await createCentroCosto(supabase, payload);

	if (!result.success) {
		return json(result, { status: 400 });
	}
	return json(result);
};

export const POST = safeEndpoint(handler);
