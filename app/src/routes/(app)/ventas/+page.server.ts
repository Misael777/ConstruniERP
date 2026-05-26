import { supabase } from '$lib/server/supabase';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const prerender = false;

export const load: PageServerLoad = async () => {
	try {
		// Cargar Ventas junto con el nombre del cliente
		const { data: ventas, error: ventasError } = await supabase
			.from('ventas')
			.select(`
				*,
				clientes (
					id,
					nombre
				)
			`)
			.order('fecha_venta', { ascending: false });
			
		if (ventasError) throw ventasError;
		
		// Cargar Empleados (para desplegar en dropdown de asesores)
		const { data: empleados } = await supabase
			.from('empleados')
			.select('id, nombre')
			.order('nombre');

		// Cargar Clientes
		const { data: clientes } = await supabase
			.from('clientes')
			.select('id, nombre')
			.order('nombre');

		// Cargar Obras (Proyectos Obra)
		const { data: obras } = await supabase
			.from('obras')
			.select('id, nombre, codigo')
			.order('nombre');

		// Cargar Consultorías (Proyectos Consultoría)
		const { data: consultorias } = await supabase
			.from('consultorias')
			.select('id, nombre, codigo')
			.order('nombre');

		return { 
			ventas: ventas || [],
			empleados: empleados || [],
			clientes: clientes || [],
			obras: obras || [],
			consultorias: consultorias || []
		};
	} catch (err) {
		console.warn("Error al cargar datos en el módulo de ventas:", err);
		return { ventas: [], empleados: [], clientes: [], obras: [], consultorias: [] };
	}
};

export const actions: Actions = {
	create: async ({ request }) => {
		const formData = await request.formData();
		
		const proyectoId = parseInt(formData.get('proyecto_id')?.toString() || '0');
		const codigo = formData.get('codigo')?.toString() || '';
		const fecha = formData.get('fecha')?.toString() || null;
		const valor = parseFloat(formData.get('valor')?.toString() || '0');
		const comisionPorcentaje = parseFloat(formData.get('comisionPorcentaje')?.toString() || '0');
		const comisionMonto = parseFloat(formData.get('comisionMonto')?.toString() || '0');
		const tipoProyecto = formData.get('caract_tipo')?.toString() || '';
		const asesor = formData.get('asesor')?.toString() || '';
		const clienteNombre = formData.get('cliente')?.toString() || 'Cliente Sin Nombre';
		const observaciones = formData.get('observaciones')?.toString() || '';

		if (!proyectoId) {
			return fail(400, { success: false, error: 'Debe seleccionar un proyecto válido de la lista.' });
		}

		try {
			// 1. Obtener o crear el cliente en la tabla maestras
			let clienteId: number;
			const { data: existingCliente } = await supabase
				.from('clientes')
				.select('id')
				.eq('nombre', clienteNombre.trim())
				.maybeSingle();

			if (existingCliente) {
				clienteId = existingCliente.id;
			} else {
				const { data: newCliente, error: createError } = await supabase
					.from('clientes')
					.insert({ nombre: clienteNombre.trim() })
					.select('id')
					.single();
				if (createError) throw createError;
				clienteId = newCliente.id;
			}

			// 2. Asociar Obra o Consultoría según tipoProyecto y obtener su nombre
			let obraId: number | null = null;
			let consultoriaId: number | null = null;
			let proyectoNombre = '';

			if (tipoProyecto === 'O') {
				obraId = proyectoId;
				const { data: obra, error: obraError } = await supabase
					.from('obras')
					.select('nombre')
					.eq('id', obraId)
					.single();
				if (obraError || !obra) throw new Error('El proyecto de obra seleccionado no existe.');
				proyectoNombre = obra.nombre;
			} else {
				consultoriaId = proyectoId;
				const { data: consultoria, error: consultoriaError } = await supabase
					.from('consultorias')
					.select('nombre')
					.eq('id', consultoriaId)
					.single();
				if (consultoriaError || !consultoria) throw new Error('El proyecto de consultoría seleccionado no existe.');
				proyectoNombre = consultoria.nombre;
			}

			// 3. Insertar venta
			const { error: insertError } = await supabase
				.from('ventas')
				.insert({
					concepto: proyectoNombre,
					codigo: codigo,
					codigo_generado: codigo,
					fecha_venta: fecha,
					precio_final: valor,
					valor_unitario: valor, // Requerido NOT NULL en schema original
					comision_porcentaje: comisionPorcentaje,
					comision_monto: comisionMonto,
					tipo_proyecto: tipoProyecto,
					cliente_id: clienteId,
					obra_id: obraId,
					consultoria_id: consultoriaId,
					status: 'En Ejecución',
					status_pago: 'Pendiente',
					comentarios: `Asesor: ${asesor} | Obs: ${observaciones}`
				});

			if (insertError) throw insertError;

			return { success: true, message: 'Venta registrada con éxito' };
		} catch (err: any) {
			console.error("Error al guardar venta:", err);
			return fail(400, { success: false, error: err.message || 'Error al registrar venta en la base de datos' });
		}
	},

	update: async ({ request }) => {
		const formData = await request.formData();
		const id = parseInt(formData.get('id')?.toString() || '0');
		
		if (!id) return fail(400, { success: false, error: 'ID de venta no válido para actualizar' });

		const proyectoId = parseInt(formData.get('proyecto_id')?.toString() || '0');
		const codigo = formData.get('codigo')?.toString() || '';
		const fecha = formData.get('fecha')?.toString() || null;
		const valor = parseFloat(formData.get('valor')?.toString() || '0');
		const comisionPorcentaje = parseFloat(formData.get('comisionPorcentaje')?.toString() || '0');
		const comisionMonto = parseFloat(formData.get('comisionMonto')?.toString() || '0');
		const tipoProyecto = formData.get('caract_tipo')?.toString() || '';
		const asesor = formData.get('asesor')?.toString() || '';
		const clienteNombre = formData.get('cliente')?.toString() || 'Cliente Sin Nombre';
		const observaciones = formData.get('observaciones')?.toString() || '';

		if (!proyectoId) {
			return fail(400, { success: false, error: 'Debe seleccionar un proyecto válido de la lista.' });
		}

		try {
			// 1. Obtener o crear el cliente
			let clienteId: number;
			const { data: existingCliente } = await supabase
				.from('clientes')
				.select('id')
				.eq('nombre', clienteNombre.trim())
				.maybeSingle();

			if (existingCliente) {
				clienteId = existingCliente.id;
			} else {
				const { data: newCliente, error: createError } = await supabase
					.from('clientes')
					.insert({ nombre: clienteNombre.trim() })
					.select('id')
					.single();
				if (createError) throw createError;
				clienteId = newCliente.id;
			}

			// 2. Asociar Obra o Consultoría según tipoProyecto y obtener su nombre
			let obraId: number | null = null;
			let consultoriaId: number | null = null;
			let proyectoNombre = '';

			if (tipoProyecto === 'O') {
				obraId = proyectoId;
				const { data: obra, error: obraError } = await supabase
					.from('obras')
					.select('nombre')
					.eq('id', obraId)
					.single();
				if (obraError || !obra) throw new Error('El proyecto de obra seleccionado no existe.');
				proyectoNombre = obra.nombre;
			} else {
				consultoriaId = proyectoId;
				const { data: consultoria, error: consultoriaError } = await supabase
					.from('consultorias')
					.select('nombre')
					.eq('id', consultoriaId)
					.single();
				if (consultoriaError || !consultoria) throw new Error('El proyecto de consultoría seleccionado no existe.');
				proyectoNombre = consultoria.nombre;
			}

			// 3. Actualizar venta
			const { error: updateError } = await supabase
				.from('ventas')
				.update({
					concepto: proyectoNombre,
					codigo: codigo,
					codigo_generado: codigo,
					fecha_venta: fecha,
					precio_final: valor,
					valor_unitario: valor,
					comision_porcentaje: comisionPorcentaje,
					comision_monto: comisionMonto,
					tipo_proyecto: tipoProyecto,
					cliente_id: clienteId,
					obra_id: obraId,
					consultoria_id: consultoriaId,
					comentarios: `Asesor: ${asesor} | Obs: ${observaciones}`
				})
				.eq('id', id);

			if (updateError) throw updateError;

			return { success: true, message: 'Venta actualizada con éxito' };
		} catch (err: any) {
			console.error("Error al actualizar venta:", err);
			return fail(400, { success: false, error: err.message || 'Error al actualizar venta' });
		}
	},

	delete: async ({ request }) => {
		const formData = await request.formData();
		const id = parseInt(formData.get('id')?.toString() || '0');

		if (!id) return fail(400, { success: false, error: 'ID de venta no proporcionado' });

		try {
			// Borrar la venta (no eliminamos el proyecto catalogado, solo la transacción de venta)
			const { error: deleteError } = await supabase
				.from('ventas')
				.delete()
				.eq('id', id);

			if (deleteError) throw deleteError;

			return { success: true, message: 'Venta eliminada con éxito' };
		} catch (err: any) {
			console.error("Error al eliminar venta:", err);
			return fail(400, { success: false, error: err.message || 'Error al eliminar venta' });
		}
	}
};
