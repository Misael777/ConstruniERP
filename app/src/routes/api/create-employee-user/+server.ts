import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		console.log('[create-employee-user] Iniciando creación de empleado. Payload recibido:', body);

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
		console.log('[create-employee-user] Paso 1: Creando usuario en Supabase Auth con correo:', correo);
		const { data: authData, error: authError } = await supabase.auth.admin.createUser({
			email: correo,
			email_confirm: true, // La cuenta queda activa de inmediato
			user_metadata: {
				nombre: nombre
			}
		});

		if (authError) {
			console.error('[create-employee-user] Error al crear usuario en Supabase Auth:', authError);
			return json(
				{ success: false, error: 'Error al crear usuario en Auth: ' + authError.message },
				{ status: 400 }
			);
		}

		const newAuthUserId = authData.user.id;
		console.log('[create-employee-user] Paso 1: Completado. ID de usuario Auth generado:', newAuthUserId);

		// 2. Insertar el empleado vinculado al usuario recién creado
		console.log('[create-employee-user] Paso 2: Insertando registro en tabla empleados...');
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
			console.error('[create-employee-user] Error al insertar empleado en DB:', empError);
			// Si falla la inserción del empleado, intentamos limpiar el usuario creado
			console.log(`[create-employee-user] Intentando limpiar (eliminar) el usuario Auth creado (${newAuthUserId}) para evitar inconsistencias...`);
			const { error: deleteError } = await supabase.auth.admin.deleteUser(newAuthUserId);
			if (deleteError) {
				console.error('[create-employee-user] Error al limpiar/eliminar el usuario Auth huérfano:', deleteError);
			} else {
				console.log('[create-employee-user] Usuario Auth huérfano eliminado con éxito de la base de datos.');
			}
			return json(
				{ success: false, error: 'Error al insertar empleado: ' + empError.message },
				{ status: 400 }
			);
		}

		console.log('[create-employee-user] Paso 2: Completado. Empleado insertado con éxito:', empData?.[0]);
		return json({
			success: true,
			empleado: empData?.[0] ?? null,
			auth_user_id: newAuthUserId
		});
	} catch (err: any) {
		console.error('[create-employee-user] Error inesperado en el servidor:', err);
		return json({ success: false, error: 'Error inesperado: ' + err.message }, { status: 500 });
	}
};
