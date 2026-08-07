/**
 * Exportación a Excel (.xlsx) del directorio de Clientes — mismo patrón que
 * ventas/services/ventasExport.service.ts: reusable desde el botón "Exportar" de
 * comercial/clientes/+page.svelte (admin, descarga directo) y desde aprobaciones.service.ts (cuando un
 * admin aprueba la solicitud de exportación de un no-administrador, ver el campo `modulo` en
 * payload_cambios de una solicitud tipo_accion='exportar').
 */
import ExcelJS from 'exceljs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { guardarArchivoBinario } from '$lib/shared/saveFile';
import { arrayBufferToBase64 } from '$lib/shared/base64';

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

/** Genera el .xlsx del directorio de clientes como base64 — sin efectos secundarios de navegador. A
 * diferencia de generarVentasXLSX, no tiene un `scopeToUserId`: el directorio de clientes no está
 * segmentado por asesor, todos los admins ven el mismo listado completo. */
export async function generarClientesXLSX(client: SupabaseClient): Promise<{ success: true; archivo: ArchivoGenerado } | { success: false; message: string }> {
	try {
		const { data, error } = await client
			.from('cliente')
			.select('nombre,tip_persona,tipo_doc,num_documento,direccion,telefono,email')
			.order('nombre', { ascending: true });
		if (error) return { success: false, message: error.message };

		const workbook = new ExcelJS.Workbook();
		const sheet = workbook.addWorksheet('Clientes');
		sheet.columns = [
			{ header: 'Nombre', key: 'nombre', width: 32 },
			{ header: 'Tipo de persona', key: 'tipoPersona', width: 16 },
			{ header: 'Tipo de documento', key: 'tipoDoc', width: 16 },
			{ header: 'N° de documento', key: 'numDocumento', width: 16 },
			{ header: 'Dirección', key: 'direccion', width: 32 },
			{ header: 'Teléfono', key: 'telefono', width: 16 },
			{ header: 'Email', key: 'email', width: 28 }
		];
		sheet.getRow(1).font = { bold: true };

		(data ?? []).forEach((r: any) => {
			sheet.addRow({
				nombre: r.nombre ?? '',
				tipoPersona: r.tip_persona === 'N' ? 'Natural' : 'Jurídica',
				tipoDoc: r.tipo_doc ?? '',
				numDocumento: r.num_documento ?? '',
				direccion: r.direccion ?? '',
				telefono: r.telefono ?? '',
				email: r.email ?? ''
			});
		});

		const buffer = await workbook.xlsx.writeBuffer();

		return {
			success: true,
			archivo: {
				contenido: arrayBufferToBase64(buffer as ArrayBuffer),
				nombre: `clientes_${new Date().toISOString().slice(0, 10)}.xlsx`,
				mime: XLSX_MIME
			}
		};
	} catch (err: any) {
		return { success: false, message: err?.message || String(err) };
	}
}

/** Genera el .xlsx y lo guarda de inmediato — usado por el botón "Exportar" cuando un admin lo clickea
 * directo (no por aprobación). */
export async function exportarClientesXLSX(client: SupabaseClient): Promise<ServiceResult> {
	const resultado = await generarClientesXLSX(client);
	if (!resultado.success) return resultado;

	try {
		await guardarArchivoBinario(resultado.archivo.contenido, resultado.archivo.nombre, resultado.archivo.mime);
		return { success: true };
	} catch (err: any) {
		return { success: false, message: err?.message || String(err) };
	}
}
