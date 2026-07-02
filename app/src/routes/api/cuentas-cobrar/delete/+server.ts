import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { safeEndpoint } from '$lib/server/safeEndpoint';
import { isAdminRequest } from '$lib/server/auth';
import { deleteCuentaCobrar } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';
import { PK_COLUMN } from '$lib/modules/cuentas-cobrar/config/cuentaCobrar.config';

const handler: RequestHandler = async ({ request, cookies }) => {
	if (!(await isAdminRequest(cookies))) {
		return json({ success: false, message: 'No autorizado: se requiere rol administrador' }, { status: 403 });
	}

	const body = await request.json();
	const id = Number(body[PK_COLUMN]);
	if (!id) return json({ success: false, message: 'ID de cuenta por cobrar inválido' }, { status: 400 });

	const result = await deleteCuentaCobrar(supabase, id);
	if (!result.success) return json(result, { status: 400 });
	return json(result);
};

export const POST = safeEndpoint(handler);
