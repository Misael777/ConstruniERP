import { supabase } from '$lib/server/supabase';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	try {
		const { data: ventas, error } = await supabase
			.from('ventas')
			.select('*')
			.order('fecha_venta', { ascending: false });
			
		if (error) throw error;
		
		return { ventas: ventas || [] };
	} catch (err) {
		console.warn("Could not fetch from Supabase. Returning empty array.", err);
		return { ventas: [] };
	}
};

export const actions: Actions = {
	create: async ({ request }) => {
		const formData = await request.formData();
		
		const data = {
			concepto: formData.get('proyecto'),
			codigo_generado: formData.get('codigo'),
			fecha_venta: formData.get('fecha') || null,
			precio_final: parseFloat(formData.get('valor')?.toString() || '0'),
			comision_porcentaje: parseFloat(formData.get('comisionPorcentaje')?.toString() || '0'),
			comision_monto: parseFloat(formData.get('comisionMonto')?.toString() || '0'),
			tipo_proyecto: formData.get('caract_tipo'),
			comentarios: `Asesor: ${formData.get('asesor')} | Cliente: ${formData.get('cliente')} | Obs: ${formData.get('observaciones')}`
		};
		
		// Integración con Google Drive vendría aquí
		const proformaFile = formData.get('proforma_pdf') as File;
		const contratoFile = formData.get('contrato_pdf') as File;
		console.log('Subiendo a Google Drive (mock):', proformaFile?.name, contratoFile?.name);
		
		try {
			const { error } = await supabase.from('ventas').insert(data);
			if (error) throw error;
			return { success: true };
		} catch (err) {
			console.error("Error al guardar venta:", err);
			return { success: false, error: 'Error al insertar en DB' };
		}
	}
};
