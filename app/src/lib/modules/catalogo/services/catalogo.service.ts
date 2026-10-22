/**
 * Proyectos → Catálogo (a pedido del usuario, con imagen de referencia): catálogo general de recursos reutilizables
 * en los APU de todas las obras, organizado por Tipo y Familia, más Unidades y (solo lectura) Partidas.
 * Tablas: recurso_precio (recursos), recurso_familia, unidad_medida — ver migración catalogo_recursos.
 * Recursos siguen el patrón dar-de-baja: `activo` (dar de baja / restaurar / eliminar permanente solo admin).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';

export type TipoRecurso = 'material' | 'mano_obra' | 'equipo' | 'subcontrato';

export const TIPOS_RECURSO: { value: TipoRecurso; label: string; prefijo: string }[] = [
	{ value: 'material', label: 'Materiales', prefijo: 'MAT' },
	{ value: 'mano_obra', label: 'Mano de obra', prefijo: 'MO' },
	{ value: 'equipo', label: 'Equipos', prefijo: 'EQ' },
	{ value: 'subcontrato', label: 'Subcontratos', prefijo: 'SUB' }
];

export interface FamiliaRecurso {
	id_familia: number;
	tipo: TipoRecurso;
	nombre: string;
	orden: number;
}

export interface UnidadMedida {
	codigo: string;
	descripcion: string;
	activo: boolean;
}

export interface Recurso {
	id_recurso: number;
	codigo: string | null;
	tipo: TipoRecurso;
	nombre: string;
	unidad: string | null;
	precio_unitario: number;
	id_familia: number | null;
	id_proveedor: number | null;
	observaciones: string | null;
	activo: boolean;
	updated_at: string | null;
	created_at: string | null;
	proveedor?: { razon_social: string | null } | null;
}

export interface ResultadoServicio<T = undefined> {
	success: boolean;
	message: string;
	data?: T;
}

const TABLA = 'recurso_precio';

function mensajeError(error: { message?: string; code?: string } | null, porDefecto: string): string {
	if (!error) return porDefecto;
	if (error.code === '23505') return 'Ya existe otro recurso con ese código.';
	if (error.code === '23503') return 'No se puede eliminar: está en uso en el APU de alguna partida del catálogo.';
	if (error.code === 'PGRST205' || error.code === '42703' || error.code === '42P01')
		return 'Falta aplicar la migración del Catálogo (catalogo_recursos) en la base de datos.';
	return `${porDefecto}: ${error.message ?? ''}`;
}

// ── Familias y unidades ───────────────────────────────────────────────────────────────────────────

export async function getFamilias(client: SupabaseClient): Promise<FamiliaRecurso[]> {
	const { data, error } = await client.from('recurso_familia').select('id_familia, tipo, nombre, orden').eq('activo', true).order('orden').order('nombre');
	if (error) throw new Error(mensajeError(error, 'No se pudieron cargar las familias'));
	return (data ?? []) as FamiliaRecurso[];
}

export async function crearFamilia(client: SupabaseClient, tipo: TipoRecurso, nombre: string): Promise<ResultadoServicio<FamiliaRecurso>> {
	const limpio = nombre.trim();
	if (!limpio) return { success: false, message: 'Escribe el nombre de la familia.' };
	const { data, error } = await client.from('recurso_familia').insert({ tipo, nombre: limpio.slice(0, 80), orden: 99 }).select('id_familia, tipo, nombre, orden').single();
	if (error) return { success: false, message: error.code === '23505' ? 'Esa familia ya existe en este tipo.' : mensajeError(error, 'No se pudo crear la familia') };
	return { success: true, message: 'Familia creada', data: data as FamiliaRecurso };
}

export async function getUnidades(client: SupabaseClient, incluirInactivas = false): Promise<UnidadMedida[]> {
	let query = client.from('unidad_medida').select('codigo, descripcion, activo').order('codigo');
	if (!incluirInactivas) query = query.eq('activo', true);
	const { data, error } = await query;
	if (error) throw new Error(mensajeError(error, 'No se pudieron cargar las unidades'));
	return (data ?? []) as UnidadMedida[];
}

export async function guardarUnidad(client: SupabaseClient, unidad: { codigo: string; descripcion: string }, esNueva: boolean): Promise<ResultadoServicio> {
	const codigo = unidad.codigo.trim().toLowerCase();
	const descripcion = unidad.descripcion.trim();
	if (!codigo || !descripcion) return { success: false, message: 'Completa el código y la descripción de la unidad.' };
	const { error } = esNueva
		? await client.from('unidad_medida').insert({ codigo: codigo.slice(0, 10), descripcion: descripcion.slice(0, 60) })
		: await client.from('unidad_medida').update({ descripcion: descripcion.slice(0, 60) }).eq('codigo', codigo);
	if (error) return { success: false, message: error.code === '23505' ? `La unidad "${codigo}" ya existe.` : mensajeError(error, 'No se pudo guardar la unidad') };
	return { success: true, message: 'Unidad guardada' };
}

export async function cambiarEstadoUnidad(client: SupabaseClient, codigo: string, activo: boolean): Promise<ResultadoServicio> {
	const { error } = await client.from('unidad_medida').update({ activo }).eq('codigo', codigo);
	if (error) return { success: false, message: mensajeError(error, 'No se pudo actualizar la unidad') };
	return { success: true, message: activo ? 'Unidad activada' : 'Unidad desactivada' };
}

// ── Recursos ──────────────────────────────────────────────────────────────────────────────────────

export async function getRecursos(client: SupabaseClient, soloEliminados = false): Promise<Recurso[]> {
	const { data, error } = await client
		.from(TABLA)
		.select('id_recurso, codigo, tipo, nombre, unidad, precio_unitario, id_familia, id_proveedor, observaciones, activo, updated_at, created_at, proveedor:id_proveedor(razon_social)')
		.eq('activo', !soloEliminados)
		.order('codigo', { ascending: true, nullsFirst: false });
	if (error) throw new Error(mensajeError(error, 'No se pudieron cargar los recursos'));
	return (data ?? []).map((r: any) => ({ ...r, precio_unitario: Number(r.precio_unitario) })) as Recurso[];
}

/** Siguiente código libre del tipo: MAT-001, MO-001, EQ-001, SUB-001... */
export async function siguienteCodigo(client: SupabaseClient, tipo: TipoRecurso): Promise<string> {
	const prefijo = TIPOS_RECURSO.find((t) => t.value === tipo)!.prefijo;
	const { data } = await client.from(TABLA).select('codigo').ilike('codigo', `${prefijo}-%`);
	const max = (data ?? []).reduce((m: number, r: any) => {
		const n = Number(String(r.codigo).slice(prefijo.length + 1));
		return Number.isFinite(n) && n > m ? n : m;
	}, 0);
	return `${prefijo}-${String(max + 1).padStart(3, '0')}`;
}

export interface DatosRecurso {
	codigo: string;
	tipo: TipoRecurso;
	nombre: string;
	unidad: string;
	precio_unitario: number;
	id_familia: number | null;
	id_proveedor: number | null;
	observaciones: string;
}

export async function guardarRecurso(client: SupabaseClient, datos: DatosRecurso, idRecurso: number | null, usuario: string | null): Promise<ResultadoServicio<Recurso>> {
	if (!datos.codigo.trim()) return { success: false, message: 'Completa el código.' };
	if (!datos.nombre.trim()) return { success: false, message: 'Completa la descripción del recurso.' };
	if (!datos.unidad) return { success: false, message: 'Elige la unidad.' };
	if (!(Number(datos.precio_unitario) >= 0)) return { success: false, message: 'El precio de referencia debe ser 0 o mayor.' };
	const fila = {
		codigo: datos.codigo.trim().toUpperCase().slice(0, 20),
		tipo: datos.tipo,
		nombre: datos.nombre.trim().slice(0, 200),
		unidad: datos.unidad,
		precio_unitario: Math.round(Number(datos.precio_unitario) * 100) / 100,
		id_familia: datos.id_familia,
		id_proveedor: datos.id_proveedor,
		observaciones: datos.observaciones.trim() || null
	};
	const consulta = idRecurso
		? client.from(TABLA).update(fila).eq('id_recurso', idRecurso)
		: client.from(TABLA).insert({ ...fila, usuario_registro: usuario });
	const { data, error } = await consulta.select('*, proveedor:id_proveedor(razon_social)').single();
	if (error) return { success: false, message: mensajeError(error, 'No se pudo guardar el recurso') };
	return { success: true, message: idRecurso ? 'Recurso actualizado' : 'Recurso creado', data: data as Recurso };
}

export async function darDeBajaRecurso(client: SupabaseClient, idRecurso: number): Promise<ResultadoServicio> {
	const { error } = await client.from(TABLA).update({ activo: false }).eq('id_recurso', idRecurso);
	if (error) return { success: false, message: mensajeError(error, 'No se pudo dar de baja el recurso') };
	return { success: true, message: 'Recurso dado de baja' };
}

export async function restaurarRecurso(client: SupabaseClient, idRecurso: number): Promise<ResultadoServicio> {
	const { error } = await client.from(TABLA).update({ activo: true }).eq('id_recurso', idRecurso);
	if (error) return { success: false, message: mensajeError(error, 'No se pudo restaurar el recurso') };
	return { success: true, message: 'Recurso restaurado' };
}

export async function eliminarRecursoPermanente(client: SupabaseClient, idRecurso: number): Promise<ResultadoServicio> {
	const { error } = await client.from(TABLA).delete().eq('id_recurso', idRecurso);
	if (error) return { success: false, message: mensajeError(error, 'No se pudo eliminar el recurso') };
	return { success: true, message: 'Recurso eliminado permanentemente' };
}

// ── Importación S10 / Excel ───────────────────────────────────────────────────────────────────────

function sinTildes(t: string): string {
	return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Tipo a partir del texto de la columna Tipo, o del prefijo del código S10 (01 Mano de obra, 02 Materiales,
 * 03 Equipos, 04 Subcontratos), o del prefijo propio (MAT/MO/EQ/SUB). */
function inferirTipo(textoTipo: string, codigo: string): TipoRecurso {
	const t = sinTildes(textoTipo);
	if (/mano|obra|mo\b/.test(t)) return 'mano_obra';
	if (/equipo|herram|maquin/.test(t)) return 'equipo';
	if (/subcontrat/.test(t)) return 'subcontrato';
	if (/material/.test(t)) return 'material';
	const c = codigo.toUpperCase();
	if (c.startsWith('MO-') || c.startsWith('01')) return 'mano_obra';
	if (c.startsWith('EQ-') || c.startsWith('03')) return 'equipo';
	if (c.startsWith('SUB-') || c.startsWith('04')) return 'subcontrato';
	return 'material';
}

export interface ResultadoImportacion {
	creados: number;
	actualizados: number;
	omitidos: number;
	errores: string[];
}

/**
 * Importa recursos desde un .xlsx (exportación de insumos de S10 o una planilla propia). Detecta la fila de
 * encabezados buscando columnas de descripción y precio; reconoce: Código, Descripción/Recurso/Insumo, Unidad/Und,
 * Precio, Tipo y Familia. Si el código ya existe, actualiza descripción, unidad y precio; si no, lo crea. Sin
 * código, se genera uno (MAT-001...). Las unidades nuevas se dan de alta solas.
 */
export async function importarRecursosExcel(client: SupabaseClient, archivo: File, usuario: string | null): Promise<ResultadoImportacion> {
	const resultado: ResultadoImportacion = { creados: 0, actualizados: 0, omitidos: 0, errores: [] };
	const libro = new ExcelJS.Workbook();
	await libro.xlsx.load(await archivo.arrayBuffer());
	const hoja = libro.worksheets[0];
	if (!hoja) throw new Error('El archivo no tiene hojas.');

	const texto = (v: unknown): string => {
		if (v === null || v === undefined) return '';
		if (typeof v === 'object' && v !== null && 'richText' in (v as any)) return (v as any).richText.map((p: any) => p.text).join('').trim();
		if (typeof v === 'object' && v !== null && 'result' in (v as any)) return String((v as any).result ?? '').trim();
		return String(v).trim();
	};

	// Fila de encabezados: la primera (de las 20 primeras) que tenga descripción y precio.
	let filaEncabezado = 0;
	const col: Record<string, number> = {};
	for (let i = 1; i <= Math.min(20, hoja.rowCount) && !filaEncabezado; i++) {
		const encontradas: Record<string, number> = {};
		hoja.getRow(i).eachCell((celda, n) => {
			const h = sinTildes(texto(celda.value));
			if (!encontradas.codigo && /^(codigo|cod\.?|codigo s10|cod insumo)/.test(h)) encontradas.codigo = n;
			else if (!encontradas.nombre && /(descripcion|recurso|insumo|nombre)/.test(h)) encontradas.nombre = n;
			else if (!encontradas.unidad && /^(unidad|und|und\.|u\.m\.?|um)$/.test(h)) encontradas.unidad = n;
			else if (!encontradas.precio && /precio|costo|p\.u/.test(h)) encontradas.precio = n;
			else if (!encontradas.tipo && /^tipo/.test(h)) encontradas.tipo = n;
			else if (!encontradas.familia && /familia|grupo|categoria/.test(h)) encontradas.familia = n;
		});
		if (encontradas.nombre && encontradas.precio) {
			filaEncabezado = i;
			Object.assign(col, encontradas);
		}
	}
	if (!filaEncabezado) throw new Error('No se encontró la fila de encabezados: el archivo debe tener columnas de Descripción y Precio.');

	const [familias, unidades, existentes] = await Promise.all([getFamilias(client), getUnidades(client, true), client.from(TABLA).select('id_recurso, codigo')]);
	const idPorCodigo = new Map((existentes.data ?? []).filter((r: any) => r.codigo).map((r: any) => [String(r.codigo).toUpperCase(), r.id_recurso as number]));
	const unidadesConocidas = new Set(unidades.map((u) => u.codigo));
	const contadores: Partial<Record<TipoRecurso, string>> = {};

	for (let i = filaEncabezado + 1; i <= hoja.rowCount; i++) {
		const fila = hoja.getRow(i);
		const nombre = texto(fila.getCell(col.nombre).value);
		const precioTexto = texto(fila.getCell(col.precio).value).replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
		const precio = Number(precioTexto);
		if (!nombre) continue;
		if (!Number.isFinite(precio) || precio < 0) {
			resultado.omitidos++;
			continue;
		}
		let codigo = col.codigo ? texto(fila.getCell(col.codigo).value).toUpperCase() : '';
		const tipo = inferirTipo(col.tipo ? texto(fila.getCell(col.tipo).value) : '', codigo);
		const unidad = (col.unidad ? texto(fila.getCell(col.unidad).value) : 'und').toLowerCase().slice(0, 10) || 'und';
		const nombreFamilia = col.familia ? sinTildes(texto(fila.getCell(col.familia).value)) : '';
		const familia = nombreFamilia ? familias.find((f) => f.tipo === tipo && sinTildes(f.nombre) === nombreFamilia) : undefined;

		if (!unidadesConocidas.has(unidad)) {
			await client.from('unidad_medida').insert({ codigo: unidad, descripcion: unidad }).then(() => undefined);
			unidadesConocidas.add(unidad);
		}

		const idExistente = codigo ? idPorCodigo.get(codigo) : undefined;
		if (idExistente) {
			const { error } = await client.from(TABLA).update({ nombre: nombre.slice(0, 200), unidad, precio_unitario: Math.round(precio * 100) / 100, ...(familia ? { id_familia: familia.id_familia } : {}) }).eq('id_recurso', idExistente);
			if (error) resultado.errores.push(`Fila ${i}: ${error.message}`);
			else resultado.actualizados++;
			continue;
		}
		if (!codigo) {
			// Siguiente código del tipo, sin volver a consultar en cada fila.
			const prefijo = TIPOS_RECURSO.find((t) => t.value === tipo)!.prefijo;
			const ultimo = contadores[tipo] ?? (await siguienteCodigo(client, tipo));
			codigo = ultimo;
			contadores[tipo] = `${prefijo}-${String(Number(ultimo.slice(prefijo.length + 1)) + 1).padStart(3, '0')}`;
		}
		const { data, error } = await client
			.from(TABLA)
			.insert({ codigo: codigo.slice(0, 20), tipo, nombre: nombre.slice(0, 200), unidad, precio_unitario: Math.round(precio * 100) / 100, id_familia: familia?.id_familia ?? null, usuario_registro: usuario })
			.select('id_recurso')
			.single();
		if (error) resultado.errores.push(`Fila ${i}: ${mensajeError(error, 'no se pudo crear')}`);
		else {
			resultado.creados++;
			idPorCodigo.set(codigo, data.id_recurso);
		}
	}
	return resultado;
}

// ── Partidas (solo lectura: se administran en Partidas y Plantillas) ─────────────────────────────

export interface PartidaCatalogo {
	id_partida: number;
	codigo: string;
	descripcion: string;
	unidad: string | null;
	nivel: number;
	precio_unitario: number | null;
	id_partida_padre: number | null;
}

export async function getPartidasCatalogo(client: SupabaseClient): Promise<PartidaCatalogo[]> {
	const { data, error } = await client.from('partida').select('id_partida, codigo, descripcion, unidad, nivel, precio_unitario, id_partida_padre').order('id_partida');
	if (error) throw new Error(mensajeError(error, 'No se pudieron cargar las partidas'));
	return (data ?? []) as PartidaCatalogo[];
}
