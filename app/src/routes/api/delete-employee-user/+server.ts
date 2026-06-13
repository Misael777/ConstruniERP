import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { safeEndpoint } from '$lib/server/safeEndpoint';

const handler: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { id } = body;
		if (!id) return json({ success: false, error: 'ID de empleado obligatorio' }, { status: 400 });

		console.log('[delete-employee-user] Iniciando eliminación de empleado ID:', id);

		// 1. Obtener empleado para conocer auth_user_id
		const { data: empData, error: empFetchError } = await supabase
			.from('empleados')
			.select('id, auth_user_id, correo')
			.eq('id', id)
			.single();

		if (empFetchError) {
			console.error('[delete-employee-user] Error al obtener empleado:', empFetchError);
			return json({ success: false, error: 'Empleado no encontrado o error al consultar' }, { status: 404 });
		}

		const authUserId = empData?.auth_user_id;

		// 2. Si existe auth_user_id, eliminar usuario en Auth usando Service Role Key
		if (authUserId) {
			console.log('[delete-employee-user] Eliminando usuario Auth ID:', authUserId);
			const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(authUserId);
			if (deleteAuthError) {
				console.error('[delete-employee-user] Error al eliminar usuario Auth:', deleteAuthError);
				// No abortamos: intentaremos eliminar el registro de empleados igualmente, pero avisamos
			}
		}

		// 3. Eliminar registro en empleados
		const { error: deleteEmpError } = await supabase
			.from('empleados')
			.delete()
			.eq('id', id);

		if (deleteEmpError) {
			console.error('[delete-employee-user] Error al eliminar empleado:', deleteEmpError);
			return json({ success: false, error: 'Error al eliminar empleado: ' + deleteEmpError.message }, { status: 400 });
		}

		console.log('[delete-employee-user] Eliminación completada para empleado ID:', id);
		return json({ success: true });
	} catch (err: any) {
		console.error('[delete-employee-user] Error inesperado:', err);
		return json({ success: false, error: 'Error inesperado: ' + err.message }, { status: 500 });
	}
};

export const POST = safeEndpoint(handler);
