/**
 * Exportación a Excel (.xlsx) del listado de Ventas — reusable desde tres lugares: el botón "Exportar"
 * de comercial/ventas/+page.svelte (admin, descarga directo en su navegador), y aprobaciones.service.ts
 * (cuando un admin aprueba la solicitud de exportación de un no-administrador — ahí NO se descarga en
 * el navegador del admin, se genera el archivo y se guarda en la solicitud para que el propio
 * solicitante lo descargue desde su campanita, ver NotificacionesBell.svelte). A pedido del usuario:
 * antes generaba un CSV de texto plano, ahora un .xlsx real vía exceljs — el contenido se guarda como
 * base64 (tanto para bajarlo directo como para persistirlo en payload_cambios, columna JSONB).
 */
import ExcelJS from 'exceljs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { guardarArchivoBinario } from '$lib/shared/saveFile';
import { arrayBufferToBase64 } from '$lib/shared/base64';
import { generarCodigoProyecto } from '$lib/shared/codigoProyecto';

export interface ServiceResult {
	success: boolean;
	message?: string;
}

export interface ArchivoGenerado {
	contenido: string;
	nombre: string;
	mime: string;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Genera el .xlsx del listado de ventas como base64 — sin efectos secundarios de navegador (sin
 * Blob/URL/`<a>`), para poder guardarlo (ej. en payload_cambios de una solicitud) o descargarlo,
 * según lo decida el llamador. `scopeToUserId`: si viene, filtra solo las ventas de ese asesor
 * (`asesor_comercial_id`) — se usa cuando el archivo es para OTRA persona (aprobación de su
 * solicitud), para que el archivo refleje lo que esa persona vería, no todo el portafolio. */
export async function generarVentasXLSX(client: SupabaseClient, scopeToUserId?: string | null): Promise<{ success: true; archivo: ArchivoGenerado } | { success: false; message: string }> {
	try {
		// Mismos campos que arma el código en la columna "Proyecto" del listado (ver codigoProyecto.ts)
		// — hasta ahora el archivo exportaba nombre_proyecto tal cual, que en realidad guarda el NOMBRE
		// DEL CLIENTE (se autocompleta así al crear la venta, ver NuevaVentaModal.svelte), así que la
		// columna "Proyecto" del archivo terminaba duplicando la de "Cliente".
		let query = client
			.from('proyecto')
			.select('nombre_proyecto,precio_venta,tip_proyecto,estado_predio,tipo_edifica,tipo_obra,tipo_tramite,tipo_intervencion,tipo_edificacion_obra,mes_obra,anio_obra,nro_pisos,distrito,ubicacion,fecha_inicio_plan,responsable,comision_asesor,estado_proyecto,tipo_venta,cliente:id_cliente(nombre)')
			.order('fecha_inicio_plan', { ascending: false });
		if (scopeToUserId) {
			query = query.eq('asesor_comercial_id', scopeToUserId);
		}

		const { data, error } = await query;
		if (error) return { success: false, message: error.message };

		const workbook = new ExcelJS.Workbook();
		const sheet = workbook.addWorksheet('Ventas');
		sheet.columns = [
			{ header: 'Proyecto', key: 'proyecto', width: 30 },
			{ header: 'Cliente', key: 'cliente', width: 28 },
			{ header: 'Valor venta', key: 'valorVenta', width: 14 },
			{ header: 'Tipo proyecto', key: 'tipoProyecto', width: 16 },
			{ header: 'Tipo venta', key: 'tipoVenta', width: 14 },
			{ header: 'Fecha inicio', key: 'fechaInicio', width: 14 },
			{ header: 'Asesor', key: 'asesor', width: 24 },
			{ header: 'Comisión %', key: 'comision', width: 12 },
			{ header: 'Estado', key: 'estado', width: 16 }
		];
		sheet.getRow(1).font = { bold: true };

		(data ?? []).forEach((r: any) => {
			sheet.addRow({
				proyecto: generarCodigoProyecto(r) || r.nombre_proyecto || '',
				cliente: r.cliente?.nombre ?? '',
				valorVenta: r.precio_venta ?? '',
				tipoProyecto: r.tip_proyecto ?? '',
				tipoVenta: r.tipo_venta ?? '',
				fechaInicio: r.fecha_inicio_plan ?? '',
				asesor: r.responsable ?? '',
				comision: r.comision_asesor ?? '',
				estado: r.estado_proyecto ?? ''
			});
		});

		const buffer = await workbook.xlsx.writeBuffer();

		return {
			success: true,
			archivo: {
				contenido: arrayBufferToBase64(buffer as ArrayBuffer),
				nombre: `ventas_${new Date().toISOString().slice(0, 10)}.xlsx`,
				mime: XLSX_MIME
			}
		};
	} catch (err: any) {
		return { success: false, message: err?.message || String(err) };
	}
}

/** Genera el .xlsx y lo guarda de inmediato — usado por el botón "Exportar" cuando un admin lo clickea
 * directo (no por aprobación). En la app empaquetada (Tauri) muestra el diálogo nativo "Guardar
 * como"; en navegador normal usa la descarga estándar (ver guardarArchivoBinario). */
export async function exportarVentasXLSX(client: SupabaseClient, scopeToUserId?: string | null): Promise<ServiceResult> {
	const resultado = await generarVentasXLSX(client, scopeToUserId);
	if (!resultado.success) return resultado;

	try {
		await guardarArchivoBinario(resultado.archivo.contenido, resultado.archivo.nombre, resultado.archivo.mime);
		return { success: true };
	} catch (err: any) {
		return { success: false, message: err?.message || String(err) };
	}
}
