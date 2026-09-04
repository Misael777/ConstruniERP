/**
 * Servicio de Anuncios corporativos — landing de Dashboard (`/dashboard`, ver +page.svelte). 100%
 * client-side (Supabase anon key), igual que el resto del ERP: no hay RLS real, "solo admin puede
 * publicar/editar/eliminar" es un guard de UI (isAdmin()), no de base de datos. Ver
 * anuncios_migration.sql para el esquema real.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface Anuncio {
	id_anuncio: number;
	titulo: string;
	contenido: string;
	imagen_url: string | null;
	autor: string | null;
	fecha_publicacion: string;
	activo: boolean;
	created_at: string;
}

export interface AnuncioPayload {
	titulo: string;
	contenido: string;
	imagen_url: string | null;
	fecha_publicacion: string;
}

export interface ServiceResult<T = undefined> {
	success: boolean;
	message?: string;
	data?: T;
}

const TABLE_NAME = 'anuncios';
const PK_COLUMN = 'id_anuncio';

function validarPayload(payload: AnuncioPayload): string | null {
	if (!payload.titulo.trim()) return 'El título es obligatorio.';
	if (!payload.contenido.trim()) return 'El contenido es obligatorio.';
	if (!payload.fecha_publicacion) return 'La fecha de publicación es obligatoria.';
	return null;
}

/** Anuncios para la landing — `soloActivos=true` (default) para cualquier usuario logueado; un admin
 * en modo "gestionar" puede pedir `soloActivos=false` para ver también los ocultos. Más recientes
 * primero por fecha de publicación (no por created_at, para poder programar/retro-fechar un anuncio). */
export async function getAnuncios(client: SupabaseClient, soloActivos = true): Promise<Anuncio[]> {
	let query = client
		.from(TABLE_NAME)
		.select('*')
		.order('fecha_publicacion', { ascending: false })
		.order('created_at', { ascending: false });
	if (soloActivos) query = query.eq('activo', true);
	const { data, error } = await query;
	if (error) throw error;
	return (data ?? []) as Anuncio[];
}

export async function createAnuncio(client: SupabaseClient, payload: AnuncioPayload, autor: string | null): Promise<ServiceResult<Anuncio>> {
	const validationError = validarPayload(payload);
	if (validationError) return { success: false, message: validationError };

	const { data, error } = await client
		.from(TABLE_NAME)
		.insert({ ...payload, autor })
		.select('*')
		.single();
	if (error) return { success: false, message: `No se pudo publicar el anuncio: ${error.message}` };
	return { success: true, message: 'Anuncio publicado correctamente', data: data as Anuncio };
}

export async function updateAnuncio(client: SupabaseClient, id: number, payload: AnuncioPayload): Promise<ServiceResult<Anuncio>> {
	const validationError = validarPayload(payload);
	if (validationError) return { success: false, message: validationError };

	const { data, error } = await client.from(TABLE_NAME).update(payload).eq(PK_COLUMN, id).select('*').single();
	if (error) return { success: false, message: `No se pudo actualizar el anuncio: ${error.message}` };
	return { success: true, message: 'Anuncio actualizado correctamente', data: data as Anuncio };
}

/** "Eliminar" desde la UI — soft delete (activo=false), no borra la fila. Sin ceremonia de contraseña
 * de administrador (a diferencia de las entidades financieras del patrón dar-de-baja): un anuncio no
 * tiene peso contable/de auditoría, ocultarlo ya es suficiente. */
export async function eliminarAnuncio(client: SupabaseClient, id: number): Promise<ServiceResult> {
	const { error } = await client.from(TABLE_NAME).update({ activo: false }).eq(PK_COLUMN, id);
	if (error) return { success: false, message: `No se pudo eliminar el anuncio: ${error.message}` };
	return { success: true, message: 'Anuncio eliminado' };
}
