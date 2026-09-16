/**
 * Lecturas de `app_release` — la fila la CREA el script de deploy (fuera de la app, con una Supabase
 * service role key, ver Documentacion/MecanismoCICD.md), nunca un botón dentro del ERP. Este archivo
 * solo lee, para que el botón "Actualizar" y el banner "Incluido en la vX.Y.Z" del ticket sepan qué
 * mostrar.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AppRelease {
	id_release: number;
	version: string;
	changelog: string | null;
	url_manifest_win: string | null;
	url_instalador_win: string | null;
	url_apk_drive: string | null;
	publicado_por: string | null;
	created_at: string;
}

const TABLE_NAME = 'app_release';

/** Último release publicado — para comparar contra la versión instalada y decidir si mostrar
 * "Actualizar" en un lugar genérico (ej. un ícono en el header), no atado a un ticket puntual. */
export async function getUltimoRelease(client: SupabaseClient): Promise<AppRelease | null> {
	const { data, error } = await client.from(TABLE_NAME).select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
	if (error) throw error;
	return (data as AppRelease) ?? null;
}

/** El release que incluyó un ticket puntual — para el banner "Incluido en la vX.Y.Z" dentro del
 * detalle del ticket. Null mientras el ticket no tenga id_release asignado (todavía no se publicó
 * ningún release que lo incluya). */
export async function getReleaseDeTicket(client: SupabaseClient, idRelease: number | null): Promise<AppRelease | null> {
	if (!idRelease) return null;
	const { data, error } = await client.from(TABLE_NAME).select('*').eq('id_release', idRelease).maybeSingle();
	if (error) throw error;
	return (data as AppRelease) ?? null;
}
