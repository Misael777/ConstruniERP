/**
 * Exportación a CSV del listado de Ventas — reusable desde dos lugares: el botón "Exportar" de
 * comercial/ventas/+page.svelte (admin, exporta directo) y aprobaciones.service.ts (cuando un admin
 * aprueba la solicitud de exportación de un no-administrador, ver crearSolicitud/aprobarSolicitud).
 * Mismo patrón Blob + <a download> ya usado en panoramas/+page.svelte — no se agrega ninguna
 * librería nueva (xlsx/exceljs) para mantener el bundle liviano.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ServiceResult {
	success: boolean;
	message?: string;
}

/** Exporta el listado de ventas (tabla `proyecto`) a un CSV descargado en el navegador actual.
 * `scopeToUserId`: si viene, filtra solo las ventas de ese asesor (`asesor_comercial_id`) — se usa
 * cuando un admin aprueba la exportación de OTRA persona, para que el archivo refleje lo que esa
 * persona vería, no todo el portafolio. Si se omite, exporta todas las ventas (uso directo por un
 * admin desde el botón "Exportar"). */
export async function exportarVentasCSV(client: SupabaseClient, scopeToUserId?: string | null): Promise<ServiceResult> {
	try {
		let query = client
			.from('proyecto')
			.select('nombre_proyecto,precio_venta,tip_proyecto,fecha_inicio_plan,responsable,comision_asesor,estado_proyecto,tipo_venta,cliente:id_cliente(nombre)')
			.order('fecha_inicio_plan', { ascending: false });
		if (scopeToUserId) {
			query = query.eq('asesor_comercial_id', scopeToUserId);
		}

		const { data, error } = await query;
		if (error) return { success: false, message: error.message };

		const headers = ['Proyecto', 'Cliente', 'Valor venta', 'Tipo proyecto', 'Tipo venta', 'Fecha inicio', 'Asesor', 'Comisión %', 'Estado'];
		const filas = (data ?? []).map((r: any) => [
			r.nombre_proyecto ?? '',
			r.cliente?.nombre ?? '',
			r.precio_venta ?? '',
			r.tip_proyecto ?? '',
			r.tipo_venta ?? '',
			r.fecha_inicio_plan ?? '',
			r.responsable ?? '',
			r.comision_asesor ?? '',
			r.estado_proyecto ?? ''
		]);

		const csv = [headers, ...filas]
			.map((fila) => fila.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
			.join('\n');

		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `ventas_${new Date().toISOString().slice(0, 10)}.csv`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);

		return { success: true };
	} catch (err: any) {
		return { success: false, message: err?.message || String(err) };
	}
}
