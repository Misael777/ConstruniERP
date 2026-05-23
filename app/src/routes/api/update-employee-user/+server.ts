import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		console.log('[update-employee-user] Iniciando actualización de empleado. Payload recibido:', body);

		const {
			id,
			auth_user_id,
			nombre,
			correo,
			telefono,
			rol_id,
			area_id,
			fecha_ingreso,
			salario,
			horas,
			periodo,
			nivel
		} = body;

		if (!id) {
			return json({ success: false, error: 'ID de empleado obligatorio' }, { status: 400 });
		}

		// 1. Si hay auth_user_id, actualizar el correo en Supabase Auth usando el Service Role Key
		if (auth_user_id && correo) {
			console.log(`[update-employee-user] Paso 1: Actualizando usuario Auth ${auth_user_id} con correo:`, correo);
			const { error: authError } = await supabase.auth.admin.updateUserById(auth_user_id, {
				email: correo.trim(),
				user_metadata: { nombre: nombre.trim() }
			});

			if (authError) {
				console.error('[update-employee-user] Error al actualizar usuario en Supabase Auth:', authError);
				return json(
					{ success: false, error: 'Error al actualizar usuario en Auth: ' + authError.message },
					{ status: 400 }
				);
			}
			console.log('[update-employee-user] Paso 1: Completado.');
		}

		// 2. Actualizar el registro en la tabla empleados
		console.log(`[update-employee-user] Paso 2: Actualizando empleado ID ${id} en la base de datos...`);
		const { data: empData, error: empError } = await supabase
			.from('empleados')
			.update({
				nombre: nombre.trim(),
				correo: correo.trim(),
				telefono: telefono?.trim() || null,
				rol_id: rol_id || null,
				area_id: area_id || null,
				fecha_ingreso: fecha_ingreso,
				salario: salario ?? 0,
				horas: horas ?? 0,
				periodo: periodo || 'Mensual',
				nivel: nivel?.trim() || null
			})
			.eq('id', id)
			.select(`
				id, nombre, telefono, correo, rol_id, auth_user_id,
				area_id, fecha_ingreso, salario, horas, periodo, nivel,
				roles ( nombre )
			`);

		if (empError) {
			console.error('[update-employee-user] Error al actualizar empleado en la tabla:', empError);
			return json(
				{ success: false, error: 'Error al actualizar empleado: ' + empError.message },
				{ status: 400 }
			);
		}

		console.log('[update-employee-user] Paso 2: Completado. Registro actualizado:', empData?.[0]);
		return json({
			success: true,
			empleado: empData?.[0] ?? null
		});
	} catch (err: any) {
		console.error('[update-employee-user] Error inesperado en el servidor:', err);
		return json({ success: false, error: 'Error inesperado: ' + err.message }, { status: 500 });
	}
};
