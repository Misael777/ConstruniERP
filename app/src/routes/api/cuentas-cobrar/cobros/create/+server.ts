import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { safeEndpoint } from '$lib/server/safeEndpoint';
import { getServerAuth, isAdminRequest } from '$lib/server/auth';
import { createCobro } from '$lib/modules/cuentas-cobrar/services/cuentasCobrar.service';
import { PARENT_FK_COLUMN } from '$lib/modules/cuentas-cobrar/config/cobro.config';

const handler: RequestHandler = async ({ request, cookies }) => {
	if (!(await isAdminRequest(cookies))) {
		return json({ success: false, message: 'No autorizado: se requiere rol administrador' }, { status: 403 });
	}

	const auth = await getServerAuth(cookies);
	const body = await request.json();
	const idCuentaCobrar = Number(body[PARENT_FK_COLUMN]);
	if (!idCuentaCobrar) {
		return json({ success: false, message: 'ID de cuenta por cobrar inválido' }, { status: 400 });
	}

	const result = await createCobro(supabase, idCuentaCobrar, body, auth?.email ?? null);
	if (!result.success) return json(result, { status: 400 });
	return json(result);
};

export const POST = safeEndpoint(handler);
