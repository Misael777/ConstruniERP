/**
 * Contratos y adendas de una venta con historial (Finanzas de Obras, imagen "Editar venta" del cliente): todos viven
 * en documento_proyecto (tipo 'Contrato' o 'Adenda'); el vigente ("Actual") es el único con vigente = true y los demás
 * se muestran como "Anterior". proyecto.contrato se mantiene con la URL del vigente, porque el listado de Ventas y
 * otras pantallas la siguen leyendo de ahí. Las proformas no cambian: su "Actual" es es_proforma_final.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type TipoContrato = 'Contrato' | 'Adenda';

export interface DocumentoContrato {
	id_documento: number;
	nombre: string;
	tipo_documento: TipoContrato;
	storage_url: string | null;
	file_size: number | null;
	vigente: boolean;
	monto: number | null;
	created_at: string;
}

export async function listarContratos(client: SupabaseClient, idProyecto: number): Promise<DocumentoContrato[]> {
	const { data, error } = await client
		.from('documento_proyecto')
		.select('id_documento, nombre, tipo_documento, storage_url, file_size, vigente, monto, created_at')
		.eq('id_proyecto', idProyecto)
		.in('tipo_documento', ['Contrato', 'Adenda'])
		.order('vigente', { ascending: false })
		.order('created_at', { ascending: false });
	if (error) throw error;
	return (data ?? []) as DocumentoContrato[];
}

/** Registra un contrato o adenda nuevo como el vigente (el anterior pasa a "Anterior"). Devuelve su id. */
export async function registrarContrato(
	client: SupabaseClient,
	p: { idProyecto: number; url: string; nombre: string; tipo: TipoContrato; monto?: number | null; fileSize?: number | null; fileType?: string | null; usuario?: string | null }
): Promise<{ success: true; idDocumento: number } | { success: false; message: string }> {
	const { error: e1 } = await client
		.from('documento_proyecto')
		.update({ vigente: false })
		.eq('id_proyecto', p.idProyecto)
		.in('tipo_documento', ['Contrato', 'Adenda'])
		.eq('vigente', true);
	if (e1) return { success: false, message: e1.message };
	const { data, error } = await client
		.from('documento_proyecto')
		.insert({
			id_proyecto: p.idProyecto,
			nombre: p.nombre.slice(0, 200),
			tipo_documento: p.tipo,
			estado: 'aprobado',
			storage_url: p.url,
			file_size: p.fileSize ?? null,
			file_type: p.fileType ?? null,
			vigente: true,
			monto: p.monto != null && p.monto > 0 ? Math.round(p.monto * 100) / 100 : null,
			creado_por: p.usuario ?? null,
			responsable: p.usuario ?? null
		})
		.select('id_documento')
		.single();
	if (error || !data) return { success: false, message: error?.message ?? 'No se pudo registrar el documento.' };
	await client.from('proyecto').update({ contrato: p.url }).eq('id_proyecto', p.idProyecto);
	return { success: true, idDocumento: data.id_documento };
}

/** Marca otro contrato/adenda ya subido como el vigente. */
export async function marcarContratoVigente(client: SupabaseClient, idProyecto: number, idDocumento: number) {
	const { data: doc } = await client.from('documento_proyecto').select('storage_url').eq('id_documento', idDocumento).single();
	const { error: e1 } = await client.from('documento_proyecto').update({ vigente: false }).eq('id_proyecto', idProyecto).in('tipo_documento', ['Contrato', 'Adenda']).eq('vigente', true);
	if (e1) return { success: false as const, message: e1.message };
	const { error } = await client.from('documento_proyecto').update({ vigente: true }).eq('id_documento', idDocumento);
	if (error) return { success: false as const, message: error.message };
	if (doc?.storage_url) await client.from('proyecto').update({ contrato: doc.storage_url }).eq('id_proyecto', idProyecto);
	return { success: true as const };
}
