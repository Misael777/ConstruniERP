import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();

		const {
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

		// 1. Crear usuario en Supabase Auth usando el Service Role Key
		const { data: authData, error: authError } = await supabase.auth.admin.createUser({
			email: correo,
			email_confirm: true, // La cuenta queda activa de inmediato
			user_metadata: {
				nombre: nombre
			}
		});

		if (authError) {
			return json(
				{ success: false, error: 'Error al crear usuario en Auth: ' + authError.message },
				{ status: 400 }
			);
		}

		const newAuthUserId = authData.user.id;

		// 2. Insertar el empleado vinculado al usuario recién creado
		const { data: empData, error: empError } = await supabase
			.from('empleados')
			.insert([
				{
					nombre: nombre.trim(),
					correo: correo.trim(),
					telefono: telefono?.trim() || null,
					rol_id: rol_id || null,
					area_id: area_id || null,
					fecha_ingreso: fecha_ingreso,
					salario: salario ?? 0,
					horas: horas ?? 0,
					periodo: periodo || 'Mensual',
					nivel: nivel?.trim() || null,
					auth_user_id: newAuthUserId
				}
			])
			.select(`
				id, nombre, telefono, correo, rol_id, auth_user_id,
				roles ( nombre )
			`);

		if (empError) {
			// Si falla la inserción del empleado, intentamos limpiar el usuario creado
			await supabase.auth.admin.deleteUser(newAuthUserId);
			return json(
				{ success: false, error: 'Error al insertar empleado: ' + empError.message },
				{ status: 400 }
			);
		}

		return json({
			success: true,
			empleado: empData?.[0] ?? null,
			auth_user_id: newAuthUserId
		});
	} catch (err: any) {
		console.error('[create-employee-user] Error inesperado:', err);
		return json({ success: false, error: 'Error inesperado: ' + err.message }, { status: 500 });
	}
};
