import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { safeEndpoint } from '$lib/server/safeEndpoint';
import { isAdminRequest } from '$lib/server/auth';
import { deleteCentroCosto } from '$lib/modules/centro-costos/services/centroCostos.service';
import { PK_COLUMN } from '$lib/modules/centro-costos/config/centroCostos.config';

const handler: RequestHandler = async ({ request, cookies }) => {
	if (!(await isAdminRequest(cookies))) {
		return json({ success: false, message: 'No autorizado: se requiere rol administrador' }, { status: 403 });
	}

	const body = await request.json();
	const id = Number(body[PK_COLUMN]);
	if (!id) {
		return json({ success: false, message: 'ID de centro de costo inválido' }, { status: 400 });
	}

	const result = await deleteCentroCosto(supabase, id);
	if (!result.success) {
		return json(result, { status: 400 });
	}
	return json(result);
};

export const POST = safeEndpoint(handler);
