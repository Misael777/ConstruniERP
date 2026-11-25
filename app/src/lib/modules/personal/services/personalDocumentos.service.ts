/**
 * Ticket #110 (rechazado 21/11/2026, puntos 3, 5 y 6): en la ficha de Personal
 *  - Contratos: número, vigencia y archivo; el ERP avisa 1 mes antes de que venza (Alertas de tareas).
 *  - Varias cuentas bancarias (BCP, BBVA, Interbank…), una marcada como principal (la que se usa para pagar).
 *  - Seguros SCTR salud, SCTR pensión y Vida Ley con aseguradora, póliza, vigencia y archivo, como historial (el SCTR
 *    dura un mes: en una obra de un año hay 12 de cada uno).
 * Tablas de la migración 20261125120000. Se editan en memoria en la ficha y se guardan junto con ella (sincronizar*).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isRunningInTauri, uploadToDriveClient } from '$lib/driveUploadClient';
import { resolveApiUrl, parseJsonResponse } from '$lib/apiClient';

export interface ContratoPersonal {
	id_contrato?: number;
	numero: string;
	fecha_inicio: string | null;
	fecha_fin: string | null;
	archivo_url: string | null;
	observacion: string;
}

export interface CuentaBancariaPersonal {
	id_cuenta?: number;
	banco: string;
	moneda: 'PEN' | 'USD';
	numero_cuenta: string;
	cci: string;
	principal: boolean;
}

export type TipoSeguro = 'sctr_salud' | 'sctr_pension' | 'vida_ley';
export interface SeguroPersonal {
	id_seguro?: number;
	tipo: TipoSeguro;
	aseguradora: string;
	poliza: string;
	fecha_inicio: string | null;
	fecha_fin: string | null;
	archivo_url: string | null;
}

export const TIPOS_SEGURO: { value: TipoSeguro; label: string }[] = [
	{ value: 'sctr_salud', label: 'SCTR · Salud' },
	{ value: 'sctr_pension', label: 'SCTR · Pensión' },
	{ value: 'vida_ley', label: 'Seguro Vida Ley' }
];
export const etiquetaSeguro = (t: string) => TIPOS_SEGURO.find((x) => x.value === t)?.label ?? t;
/** Días de aviso antes del vencimiento: SCTR 1 semana (dura un mes); Vida Ley y contratos, 1 mes. */
export const DIAS_AVISO_SEGURO: Record<TipoSeguro, number> = { sctr_salud: 7, sctr_pension: 7, vida_ley: 30 };
export const DIAS_AVISO_CONTRATO = 30;

export const BANCOS = ['BCP', 'BBVA', 'Interbank', 'Scotiabank', 'Banco de la Nación', 'BanBif', 'Banco Pichincha', 'Caja Arequipa', 'Caja Huancayo', 'Caja Piura'];
export const ASEGURADORAS = ['Rímac Seguros', 'Pacífico Seguros', 'La Positiva', 'Mapfre', 'Sanitas', 'EsSalud'];

export interface DocumentosPersonal {
	contratos: ContratoPersonal[];
	cuentas: CuentaBancariaPersonal[];
	seguros: SeguroPersonal[];
}

/** Lee los tres historiales. Sin la migración (tablas inexistentes) devuelve listas vacías. */
export async function getDocumentosPersonal(client: SupabaseClient, idPersonal: number): Promise<DocumentosPersonal & { disponible: boolean }> {
	const [c, b, s] = await Promise.all([
		client.from('personal_contrato').select('id_contrato, numero, fecha_inicio, fecha_fin, archivo_url, observacion').eq('id_personal', idPersonal).order('fecha_inicio', { ascending: false, nullsFirst: false }),
		client.from('personal_cuenta_bancaria').select('id_cuenta, banco, moneda, numero_cuenta, cci, principal').eq('id_personal', idPersonal).order('id_cuenta'),
		client.from('personal_seguro').select('id_seguro, tipo, aseguradora, poliza, fecha_inicio, fecha_fin, archivo_url').eq('id_personal', idPersonal).order('fecha_fin', { ascending: false, nullsFirst: false })
	]);
	const disponible = !c.error && !b.error && !s.error;
	return {
		disponible,
		contratos: ((c.data ?? []) as any[]).map((x) => ({ ...x, numero: x.numero ?? '', observacion: x.observacion ?? '' })),
		cuentas: ((b.data ?? []) as any[]).map((x) => ({ ...x, numero_cuenta: x.numero_cuenta ?? '', cci: x.cci ?? '' })),
		seguros: ((s.data ?? []) as any[]).map((x) => ({ ...x, aseguradora: x.aseguradora ?? '', poliza: x.poliza ?? '' }))
	};
}

const t = (v: string | null | undefined, max: number) => (v ?? '').trim().slice(0, max) || null;

/** Deja en la base exactamente las filas de la lista (borra las quitadas, actualiza y agrega). */
async function sincronizar<T extends Record<string, any>>(
	client: SupabaseClient,
	tabla: string,
	pk: string,
	idPersonal: number,
	filas: T[],
	aFila: (f: T) => Record<string, unknown>
): Promise<void> {
	const { data: actuales, error: e0 } = await client.from(tabla).select(pk).eq('id_personal', idPersonal);
	if (e0) throw e0;
	const quedan = new Set(filas.map((f) => f[pk]).filter((x) => x != null));
	const borrar = ((actuales ?? []) as any[]).map((x) => x[pk]).filter((id) => !quedan.has(id));
	if (borrar.length) {
		const { error } = await client.from(tabla).delete().in(pk, borrar);
		if (error) throw error;
	}
	for (const f of filas) {
		const datos = { ...aFila(f), id_personal: idPersonal };
		const { error } = f[pk] != null ? await client.from(tabla).update(datos).eq(pk, f[pk]) : await client.from(tabla).insert(datos);
		if (error) throw error;
	}
}

export async function guardarDocumentosPersonal(client: SupabaseClient, idPersonal: number, d: DocumentosPersonal, usuario: string | null): Promise<void> {
	await sincronizar(client, 'personal_contrato', 'id_contrato', idPersonal, d.contratos.filter((c) => c.numero.trim() || c.fecha_fin || c.archivo_url), (c) => ({
		numero: t(c.numero, 60),
		fecha_inicio: c.fecha_inicio || null,
		fecha_fin: c.fecha_fin || null,
		archivo_url: c.archivo_url,
		observacion: t(c.observacion, 200),
		usuario
	}));
	const cuentas = d.cuentas.filter((c) => c.banco.trim() && (c.numero_cuenta.trim() || c.cci.trim()));
	if (cuentas.length && !cuentas.some((c) => c.principal)) cuentas[0].principal = true;
	await sincronizar(client, 'personal_cuenta_bancaria', 'id_cuenta', idPersonal, cuentas, (c) => ({
		banco: t(c.banco, 60),
		moneda: c.moneda,
		numero_cuenta: t(c.numero_cuenta, 30),
		cci: t(c.cci, 25),
		principal: c.principal
	}));
	await sincronizar(client, 'personal_seguro', 'id_seguro', idPersonal, d.seguros.filter((s) => s.fecha_fin || s.poliza.trim() || s.archivo_url), (s) => ({
		tipo: s.tipo,
		aseguradora: t(s.aseguradora, 100),
		poliza: t(s.poliza, 40),
		fecha_inicio: s.fecha_inicio || null,
		fecha_fin: s.fecha_fin || null,
		archivo_url: s.archivo_url,
		usuario
	}));
}

/** Sube un archivo del trabajador (contrato, póliza) a Google Drive y devuelve su enlace. */
export async function subirArchivoPersonal(archivo: File, documento: string, tipo: 'contrato' | 'seguro'): Promise<string> {
	const doc = (documento || 'sin-doc').replace(/[^A-Za-z0-9]/g, '');
	const ext = (archivo.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '');
	const nombre = `personal-${tipo}-${doc}-${Date.now()}.${ext}`;
	if (isRunningInTauri()) {
		const { url } = await uploadToDriveClient(archivo, nombre, 'documento');
		return url;
	}
	const formData = new FormData();
	formData.append('file', new File([archivo], nombre, { type: archivo.type || 'application/octet-stream' }));
	formData.append('type', 'documento');
	formData.append('documentType', `personal_${tipo}`);
	formData.append('documentName', doc);
	formData.append('projectName', 'Personal');
	const response = await fetch(resolveApiUrl('/api/upload-document'), { method: 'POST', body: formData });
	const result = await parseJsonResponse(response);
	if (!response.ok || !result.success) throw new Error(result.details || result.error || 'Error al subir el archivo.');
	return result.url as string;
}
