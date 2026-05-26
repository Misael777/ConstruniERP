import { supabase } from '$lib/server/supabase';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	try {
		const { data: clientes, error: clientesError } = await supabase
			.from('clientes')
			.select('*')
			.order('nombre', { ascending: true });

		if (clientesError) throw clientesError;

		return {
			clientes: clientes || []
		};
	} catch (err) {
		console.warn("Error al cargar clientes:", err);
		return { clientes: [] };
	}
};

export const actions: Actions = {
	create: async ({ request }) => {
		const formData = await request.formData();
		const nombre = formData.get('nombre')?.toString() || '';
		const telefono = formData.get('telefono')?.toString() || '';
		const correo = formData.get('correo')?.toString() || '';
		const empresa = formData.get('empresa')?.toString() || '';
		const dni = formData.get('dni')?.toString() || '';
		const ubicacion = formData.get('ubicacion')?.toString() || '';

		if (!nombre.trim()) {
			return fail(400, { success: false, error: 'El nombre es obligatorio.' });
		}

		try {
			const { error: insertError } = await supabase
				.from('clientes')
				.insert({
					nombre: nombre.trim(),
					telefono: telefono.trim() || null,
					correo: correo.trim() || null,
					empresa: empresa.trim() || null,
					dni: dni.trim() || null,
					ubicacion: ubicacion.trim() || null
				});

			if (insertError) throw insertError;

			return { success: true, message: 'Cliente registrado con éxito' };
		} catch (err: any) {
			console.error("Error al registrar cliente:", err);
			return fail(400, { success: false, error: err.message || 'Error al registrar cliente' });
		}
	},

	update: async ({ request }) => {
		const formData = await request.formData();
		const id = parseInt(formData.get('id')?.toString() || '0');
		const nombre = formData.get('nombre')?.toString() || '';
		const telefono = formData.get('telefono')?.toString() || '';
		const correo = formData.get('correo')?.toString() || '';
		const empresa = formData.get('empresa')?.toString() || '';
		const dni = formData.get('dni')?.toString() || '';
		const ubicacion = formData.get('ubicacion')?.toString() || '';

		if (!id) return fail(400, { success: false, error: 'ID de cliente no válido' });
		if (!nombre.trim()) return fail(400, { success: false, error: 'El nombre es obligatorio.' });

		try {
			const { error: updateError } = await supabase
				.from('clientes')
				.update({
					nombre: nombre.trim(),
					telefono: telefono.trim() || null,
					correo: correo.trim() || null,
					empresa: empresa.trim() || null,
					dni: dni.trim() || null,
					ubicacion: ubicacion.trim() || null
				})
				.eq('id', id);

			if (updateError) throw updateError;

			return { success: true, message: 'Cliente actualizado con éxito' };
		} catch (err: any) {
			console.error("Error al actualizar cliente:", err);
			return fail(400, { success: false, error: err.message || 'Error al actualizar cliente' });
		}
	},

	delete: async ({ request }) => {
		const formData = await request.formData();
		const id = parseInt(formData.get('id')?.toString() || '0');

		if (!id) return fail(400, { success: false, error: 'ID de cliente no proporcionado' });

		try {
			// Nota: Si hay ventas asociadas a este cliente, fallará por la clave foránea en la base de datos (RESTRICT/CASCADE).
			// Manejaremos esto de forma segura.
			const { error: deleteError } = await supabase
				.from('clientes')
				.delete()
				.eq('id', id);

			if (deleteError) {
				if (deleteError.code === '23503') {
					return fail(400, { 
						success: false, 
						error: 'No se puede eliminar el cliente porque tiene ventas o registros asociados en el sistema.' 
					});
				}
				throw deleteError;
			}

			return { success: true, message: 'Cliente eliminado con éxito' };
		} catch (err: any) {
			console.error("Error al eliminar cliente:", err);
			return fail(400, { success: false, error: err.message || 'Error al eliminar cliente' });
		}
	}
};
