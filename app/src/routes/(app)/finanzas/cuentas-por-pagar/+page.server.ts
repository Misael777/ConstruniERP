import { supabase } from '$lib/server/supabase';
import type { Actions, PageServerLoad } from './$types';

export const prerender = false;

export const load: PageServerLoad = async () => {
	try {
		// Mock data if Supabase fails (for UI visualization purposes)
		const { data: gastos, error } = await supabase
			.from('gastos')
			.select('*')
			.order('fecha_gasto', { ascending: false });
			
		if (error) throw error;
		
		return { gastos: gastos || [] };
	} catch (err) {
		console.warn("Could not fetch gastos from Supabase. Returning mock data.", err);
		// Retornamos un array vacío, pero en la vista pondremos datos simulados 
		// si no hay registros, para que puedas ver el diseño.
		return { gastos: [] };
	}
};

export const actions: Actions = {
	createAbono: async ({ request }) => {
		const formData = await request.formData();
		const gastoId = formData.get('gasto_id');
		const monto = parseFloat(formData.get('monto')?.toString() || '0');
		
		const data = {
			concepto: 'Pago Gasto',
			fecha_abono: formData.get('fecha'),
			gasto_id: gastoId,
			monto: monto,
			comentarios: formData.get('observaciones'),
			numero_operacion: formData.get('operacion'),
		};
		
		try {
			// 1. Registrar el Abono
			const { error: abonoError } = await supabase.from('pagos_abonos').insert(data);
			if (abonoError) throw abonoError;
			
			// 2. Actualizar Gasto (saldo y estado)
			const { data: gastoActual, error: fetchError } = await supabase
				.from('gastos')
				.select('pagado, costo_final')
				.eq('id', gastoId)
				.single();
				
			if (fetchError) throw fetchError;
			
			const nuevoPagado = (parseFloat(gastoActual.pagado) || 0) + monto;
			const costoFinal = parseFloat(gastoActual.costo_final) || 0;
			
			let nuevoStatus = 'Pendiente';
			if (nuevoPagado >= costoFinal) {
				nuevoStatus = 'Pagada';
			} else if (nuevoPagado > 0) {
				nuevoStatus = 'Parcial';
			}
			
			const { error: updateError } = await supabase
				.from('gastos')
				.update({ pagado: nuevoPagado, status: nuevoStatus })
				.eq('id', gastoId);
				
			if (updateError) throw updateError;
			
			return { success: true };
		} catch (err) {
			console.error("Error al registrar abono:", err);
			return { success: false, error: 'Error al procesar en BD' };
		}
	}
};
