/**
 * Ticket #123 (11/11/2026): "si borro algún archivo de la ERP, debería borrarse también del Drive". Se llama
 * DESPUÉS de un borrado definitivo (no al dar de baja: eso se puede restaurar) con los enlaces que tenía lo
 * borrado. Antes de borrar cada archivo se comprueba que ninguna otra fila de la ERP lo siga usando: un mismo
 * comprobante puede respaldar varias filas (ej. una detracción y su ingreso), y borrarlo dejaría a las otras
 * sin archivo. Best-effort, igual que deleteProjectDocumentFile: si Drive falla, se avisa en consola y nunca
 * bloquea el borrado en la ERP.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** Todas las columnas de la ERP que guardan un enlace a un archivo de Drive. */
const REFERENCIAS: { tabla: string; columnas: string[] }[] = [
	{ tabla: 'transaccion', columnas: ['comprobante_url', 'factura_url', 'comprobante_autogenerado_url', 'comprobante_autogenerado_url_final'] },
	{ tabla: 'transaccion_comprobante_pago', columnas: ['url'] },
	{ tabla: 'documento_proyecto', columnas: ['storage_url'] },
	{ tabla: 'factura', columnas: ['imagen_url'] },
	{ tabla: 'factura_archivo', columnas: ['url'] },
	{ tabla: 'personal', columnas: ['foto_url'] },
	{ tabla: 'ticket', columnas: ['imagen_url'] },
	{ tabla: 'ticket_comentario', columnas: ['imagen_url'] },
	{ tabla: 'anuncios', columnas: ['imagen_url'] },
	{ tabla: 'proyecto', columnas: ['contrato'] }
];

async function sigueEnUso(client: SupabaseClient, fileId: string): Promise<boolean> {
	const consultas = REFERENCIAS.map(({ tabla, columnas }) =>
		client
			.from(tabla)
			.select('*', { count: 'exact', head: true })
			.or(columnas.map((c) => `${c}.ilike.*${fileId}*`).join(','))
	);
	const resultados = await Promise.all(consultas);
	for (const r of resultados) {
		// Si no se puede comprobar (permisos, tabla ausente), se asume en uso: mejor dejar un archivo de más
		// en Drive que borrar uno que alguien todavía necesita.
		if (r.error) return true;
		if ((r.count ?? 0) > 0) return true;
	}
	return false;
}

/** Borra de Drive los archivos de estos enlaces que ya no use ninguna fila de la ERP. */
export async function borrarArchivosDriveHuerfanos(client: SupabaseClient, urls: (string | null | undefined)[]): Promise<void> {
	if (!urls.some(Boolean)) return;
	// Import diferido: uploadProjectDocument arrastra el cliente de la API ($env), que no existe en los tests
	// de los servicios que importan este archivo.
	// Best-effort de verdad: si el módulo no se puede cargar (ej. en Node, sin $env), se avisa y se sigue — antes la
	// promesa rechazada quedaba sin atrapar (deleteTransaccion la llama con `void`) y tumbaba el proceso.
	let mod: typeof import('$lib/shared/uploadProjectDocument');
	try {
		mod = await import('$lib/shared/uploadProjectDocument');
	} catch (err) {
		console.warn('[borrarArchivosDriveHuerfanos] No se pudo cargar el cliente de Drive; no se limpian archivos:', err);
		return;
	}
	const { deleteProjectDocumentFile, extractDriveFileId } = mod;
	const ids = [...new Set(urls.map((u) => extractDriveFileId(u)).filter((id): id is string => !!id && /^[A-Za-z0-9_-]+$/.test(id)))];
	for (const fileId of ids) {
		try {
			if (await sigueEnUso(client, fileId)) continue;
			await deleteProjectDocumentFile(`https://drive.google.com/uc?export=download&id=${fileId}`);
		} catch (err) {
			console.warn('[borrarArchivosDriveHuerfanos] No se pudo limpiar el archivo en Drive:', fileId, err);
		}
	}
}

/** Enlaces de archivos de estas transacciones (comprobante, factura, autogenerados y comprobantes de pago). */
export async function enlacesDeTransacciones(client: SupabaseClient, ids: number[]): Promise<string[]> {
	if (ids.length === 0) return [];
	const [{ data: txs }, { data: pagos }] = await Promise.all([
		client.from('transaccion').select('comprobante_url, factura_url, comprobante_autogenerado_url, comprobante_autogenerado_url_final').in('id_transaccion', ids),
		client.from('transaccion_comprobante_pago').select('url').in('id_transaccion', ids)
	]);
	return [
		...(txs ?? []).flatMap((t: any) => [t.comprobante_url, t.factura_url, t.comprobante_autogenerado_url, t.comprobante_autogenerado_url_final]),
		...(pagos ?? []).map((p: any) => p.url)
	].filter((u): u is string => !!u);
}
