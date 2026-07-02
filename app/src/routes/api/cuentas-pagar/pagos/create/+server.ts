import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { safeEndpoint } from '$lib/server/safeEndpoint';
import { getServerAuth, isAdminRequest } from '$lib/server/auth';
import { createPago } from '$lib/modules/cuentas-pagar/services/cuentasPagar.service';
import { PARENT_FK_COLUMN } from '$lib/modules/cuentas-pagar/config/pago.config';

const handler: RequestHandler = async ({ request, cookies }) => {
	if (!(await isAdminRequest(cookies))) {
		return json({ success: false, message: 'No autorizado: se requiere rol administrador' }, { status: 403 });
	}

	const auth = await getServerAuth(cookies);
	const body = await request.json();
	const idCuentaPagar = Number(body[PARENT_FK_COLUMN]);
	if (!idCuentaPagar) {
		return json({ success: false, message: 'ID de cuenta por pagar inválido' }, { status: 400 });
	}

	const result = await createPago(supabase, idCuentaPagar, body, auth?.email ?? null);
	if (!result.success) return json(result, { status: 400 });
	return json(result);
};

export const POST = safeEndpoint(handler);
