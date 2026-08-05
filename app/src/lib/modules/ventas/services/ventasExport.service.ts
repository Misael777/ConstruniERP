/**
 * Exportación a CSV del listado de Ventas — reusable desde tres lugares: el botón "Exportar" de
 * comercial/ventas/+page.svelte (admin, descarga directo en su navegador), y aprobaciones.service.ts
 * (cuando un admin aprueba la solicitud de exportación de un no-administrador — ahí NO se descarga en
 * el navegador del admin, se genera el texto y se guarda en la solicitud para que el propio
 * solicitante lo descargue desde su campanita, ver NotificacionesBell.svelte). Mismo patrón Blob +
 * <a download> ya usado en panoramas/+page.svelte — no se agrega ninguna librería nueva
 * (xlsx/exceljs) para mantener el bundle liviano.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { guardarArchivoDeTexto } from '$lib/shared/saveFile';

export interface ServiceResult {
	success: boolean;
	message?: string;
}

export interface ArchivoGenerado {
	contenido: string;
	nombre: string;
	mime: string;
}

/** Genera el CSV del listado de ventas como TEXTO plano — sin efectos secundarios de navegador (sin
 * Blob/URL/`<a>`), para poder guardarlo (ej. en payload_cambios de una solicitud) o descargarlo,
 * según lo decida el llamador. `scopeToUserId`: si viene, filtra solo las ventas de ese asesor
 * (`asesor_comercial_id`) — se usa cuando el archivo es para OTRA persona (aprobación de su
 * solicitud), para que el archivo refleje lo que esa persona vería, no todo el portafolio. */
export async function generarVentasCSV(client: SupabaseClient, scopeToUserId?: string | null): Promise<{ success: true; archivo: ArchivoGenerado } | { success: false; message: string }> {
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

		return {
			success: true,
			archivo: {
				contenido: csv,
				nombre: `ventas_${new Date().toISOString().slice(0, 10)}.csv`,
				mime: 'text/csv;charset=utf-8;'
			}
		};
	} catch (err: any) {
		return { success: false, message: err?.message || String(err) };
	}
}

/** Genera el CSV y lo guarda de inmediato — usado por el botón "Exportar" cuando un admin lo clickea
 * directo (no por aprobación). En la app empaquetada (Tauri) muestra el diálogo nativo "Guardar
 * como"; en navegador normal usa la descarga estándar (ver guardarArchivoDeTexto). */
export async function exportarVentasCSV(client: SupabaseClient, scopeToUserId?: string | null): Promise<ServiceResult> {
	const resultado = await generarVentasCSV(client, scopeToUserId);
	if (!resultado.success) return resultado;

	try {
		await guardarArchivoDeTexto(resultado.archivo.contenido, resultado.archivo.nombre, resultado.archivo.mime);
		return { success: true };
	} catch (err: any) {
		return { success: false, message: err?.message || String(err) };
	}
}
