import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { supabase } from '$lib/server/supabase';
import { safeEndpoint } from '$lib/server/safeEndpoint';

const handler: RequestHandler = async ({ request }) => {
	try {
		const { email, password, type = 'setup' } = await request.json();
		console.log('[setup-password] Intentando configurar contraseña para:', email, 'Tipo:', type);

		if (!email || !password) {
			return json({ success: false, error: 'El correo y la contraseña son obligatorios' }, { status: 400 });
		}

		if (password.length < 6) {
			return json({ success: false, error: 'La contraseña debe tener al menos 6 caracteres' }, { status: 400 });
		}

		// 1. Buscar al empleado en la base de datos por correo (ignorando mayúsculas/minúsculas)
		const cleanEmail = email.trim().toLowerCase();
		let empleado: any = null;

		// Intentamos seleccionar incluyendo password_creada por si la columna ya existe
		const firstAttempt = await supabase
			.from('empleados')
			.select('id, nombre, correo, auth_user_id, password_creada')
			.ilike('correo', cleanEmail)
			.maybeSingle();

		if (firstAttempt.error) {
			const schemaError = firstAttempt.error.message?.includes('password_creada')
				|| firstAttempt.error.message?.includes('Database error querying schema')
				|| firstAttempt.error.code === '42703';

			// Si falla por la columna password_creada o por error de esquema, reintentamos sin ella
			if (schemaError) {
				console.log('[setup-password] Reintentando buscar empleado sin seleccionar password_creada...');
				const secondAttempt = await supabase
					.from('empleados')
					.select('id, nombre, correo, auth_user_id')
					.ilike('correo', cleanEmail)
					.maybeSingle();
				if (secondAttempt.error) {
					return json({ success: false, error: 'Error al buscar empleado: ' + secondAttempt.error.message }, { status: 500 });
				}
				empleado = secondAttempt.data;
			} else {
				return json({ success: false, error: 'Error al buscar empleado: ' + firstAttempt.error.message }, { status: 500 });
			}
		} else {
			empleado = firstAttempt.data;
		}

		if (!empleado) {
			console.warn('[setup-password] Intento de configuración de contraseña para correo no autorizado:', cleanEmail);
			return json(
				{ success: false, error: 'Tu correo electrónico no está registrado o no ha sido autorizado por el administrador.' },
				{ status: 403 }
			);
		}

		// Determinar si ya tiene contraseña creada
		// Si password_creada no está definido en el objeto (debido al fallback del select),
		// inferimos que ya tiene contraseña si el admin ya le vinculó un auth_user_id.
		const hasPassword = empleado.password_creada !== undefined 
			? empleado.password_creada 
			: !!empleado.auth_user_id;

		// Si el tipo es 'setup' (crear contraseña por primera vez) y ya tiene contraseña, bloquear acceso.
		if (type === 'setup' && hasPassword) {
			console.warn('[setup-password] El empleado ya configuró su contraseña anteriormente:', cleanEmail);
			return json(
				{ success: false, error: 'Ya has configurado una contraseña anteriormente. Si no la recuerdas, utiliza la opción "¿Olvidaste tu contraseña?".' },
				{ status: 400 }
			);
		}

		let authUserId = empleado.auth_user_id;

		// 2. Si no tiene auth_user_id registrado, intentar buscar o crear en Supabase Auth
		if (!authUserId) {
			console.log('[setup-password] El empleado no tiene auth_user_id. Buscando en Auth o creando nuevo...');
			
			// Primero listamos usuarios para ver si ya existe
			const { data: usersData, error: listError } = await supabase.auth.admin.listUsers();
			if (listError) {
				console.error('[setup-password] Error al listar usuarios de Auth:', listError);
				return json({ success: false, error: 'Error al buscar cuenta de usuario: ' + listError.message }, { status: 500 });
			}

			const existingUser = usersData?.users.find((u) => u.email?.toLowerCase() === cleanEmail);
			
			if (existingUser) {
				authUserId = existingUser.id;
				console.log('[setup-password] Se encontró usuario existente en Auth:', authUserId);
			} else {
				// Crear el usuario en Auth
				console.log('[setup-password] Creando usuario en Auth...');
				const { data: authData, error: createError } = await supabase.auth.admin.createUser({
					email: cleanEmail,
					password: password,
					email_confirm: true,
					user_metadata: {
						nombre: empleado.nombre
					}
				});

				if (createError) {
					console.error('[setup-password] Error al crear usuario en Auth:', createError);
					return json({ success: false, error: 'Error al crear cuenta en Auth: ' + createError.message }, { status: 400 });
				}

				authUserId = authData.user.id;
				console.log('[setup-password] Usuario creado exitosamente en Auth:', authUserId);
			}
		}

		// 3. Establecer/Actualizar contraseña en Supabase Auth
		console.log('[setup-password] Actualizando contraseña en Auth para ID:', authUserId);
		const { error: updateAuthError } = await supabase.auth.admin.updateUserById(authUserId, {
			password: password
		});

		if (updateAuthError) {
			console.error('[setup-password] Error al actualizar la contraseña del usuario en Auth:', updateAuthError);
			return json({ success: false, error: 'Error al establecer la contraseña: ' + updateAuthError.message }, { status: 400 });
		}

		// 4. Actualizar estado del empleado en la base de datos (password_creada = true y vincular auth_user_id)
		console.log('[setup-password] Actualizando empleado en la DB con password_creada = true...');
		const { error: updateDbError } = await supabase
			.from('empleados')
			.update({
				password_creada: true,
				auth_user_id: authUserId
			})
			.eq('id', empleado.id);

		if (updateDbError) {
			console.error('[setup-password] Error al actualizar con password_creada:', updateDbError);
			
			// Si el error es debido a que no existe o no se encuentra la columna 'password_creada' en la caché de Supabase,
			// hacemos un reintento actualizando únicamente 'auth_user_id'.
			if (updateDbError.message.includes('password_creada') || updateDbError.code === '42703') {
				console.log('[setup-password] Reintentando actualización sin el campo password_creada...');
				const { error: retryError } = await supabase
					.from('empleados')
					.update({
						auth_user_id: authUserId
					})
					.eq('id', empleado.id);
					
				if (retryError) {
					console.error('[setup-password] Error al reintentar actualización básica:', retryError);
					return json({ success: false, error: 'Error al guardar estado de contraseña básico: ' + retryError.message }, { status: 500 });
				}
			} else {
				return json({ success: false, error: 'Error al guardar estado de contraseña: ' + updateDbError.message }, { status: 500 });
			}
		}

		console.log('[setup-password] Contraseña configurada con éxito para:', cleanEmail);
		return json({ success: true, message: 'Contraseña configurada con éxito' });
	} catch (err: any) {
		console.error('[setup-password] Error inesperado en el servidor:', err);
		return json({ success: false, error: 'Error inesperado: ' + err.message }, { status: 500 });
	}
};

export const POST = safeEndpoint(handler);
