/**
 * Catálogo → Partidas (a pedido del usuario, con imagen de referencia): catálogo general de partidas con su APU,
 * separado por ámbito (Obra / Consultoría) y organizado en un árbol de especialidades. Tablas partida_especialidad,
 * partida_catalogo y partida_catalogo_apu (ver migración catalogo_partidas_apu). Los recursos del APU vienen del
 * catálogo de Recursos (recurso_precio). Patrón dar-de-baja en partidas (`activo`).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import type { TipoRecurso } from './catalogo.service';
import { calcularApu } from './apu';

export type Ambito = 'obra' | 'consultoria';

export interface Especialidad {
	id_especialidad: number;
	ambito: Ambito;
	nombre: string;
	id_padre: number | null;
	prefijo: string | null;
	orden: number;
}

export interface PartidaCat {
	id_partida_catalogo: number;
	ambito: Ambito;
	codigo: string;
	nombre: string;
	unidad: string | null;
	rendimiento: number;
	jornada: number;
	id_especialidad: number | null;
	precio_referencia: number;
	activo: boolean;
	updated_at: string | null;
}

export interface LineaApu {
	id_recurso: number;
	codigo: string | null;
	nombre: string;
	tipo: TipoRecurso;
	unidad: string | null;
	precio: number;
	cuadrilla: number | null;
	cantidad: number;
	incluido: boolean;
}

export interface Resultado<T = undefined> {
	success: boolean;
	message: string;
	data?: T;
}

function mensaje(error: { message?: string; code?: string } | null, porDefecto: string): string {
	if (!error) return porDefecto;
	if (error.code === '23505') return 'Ya existe otra partida con ese código.';
	if (error.code === 'PGRST205' || error.code === '42703' || error.code === '42P01')
		return 'Falta aplicar la migración del catálogo de partidas (catalogo_partidas_apu) en la base de datos.';
	return `${porDefecto}: ${error.message ?? ''}`;
}

const num = (v: unknown) => Number(v) || 0;

// ── Especialidades ───────────────────────────────────────────────────────────────────────────────

export async function getEspecialidades(client: SupabaseClient, ambito: Ambito): Promise<Especialidad[]> {
	const { data, error } = await client
		.from('partida_especialidad')
		.select('id_especialidad, ambito, nombre, id_padre, prefijo, orden')
		.eq('ambito', ambito)
		.eq('activo', true)
		.order('orden')
		.order('nombre');
	if (error) throw new Error(mensaje(error, 'No se pudieron cargar las especialidades'));
	return (data ?? []) as Especialidad[];
}

export async function crearEspecialidad(client: SupabaseClient, ambito: Ambito, nombre: string, idPadre: number | null, prefijo: string | null): Promise<Resultado<Especialidad>> {
	const limpio = nombre.trim();
	if (!limpio) return { success: false, message: 'Escribe el nombre de la especialidad.' };
	const { data, error } = await client
		.from('partida_especialidad')
		.insert({ ambito, nombre: limpio.slice(0, 80), id_padre: idPadre, prefijo: prefijo?.trim().toUpperCase().slice(0, 6) || null, orden: 99 })
		.select('id_especialidad, ambito, nombre, id_padre, prefijo, orden')
		.single();
	if (error) return { success: false, message: error.code === '23505' ? 'Esa especialidad ya existe en ese nivel.' : mensaje(error, 'No se pudo crear la especialidad') };
	return { success: true, message: 'Especialidad creada', data: data as Especialidad };
}

/** Prefijo de código de una especialidad: el suyo o el del ancestro más cercano que lo tenga (Zapatas → EST). */
export function prefijoDe(especialidades: Especialidad[], idEspecialidad: number | null): string {
	let actual = especialidades.find((e) => e.id_especialidad === idEspecialidad);
	while (actual) {
		if (actual.prefijo) return actual.prefijo;
		actual = especialidades.find((e) => e.id_especialidad === actual!.id_padre);
	}
	return 'PAR';
}

/** Ids de una especialidad y todas sus descendientes (para filtrar por una rama del árbol). */
export function idsDeRama(especialidades: Especialidad[], idRaiz: number): Set<number> {
	const ids = new Set<number>([idRaiz]);
	let creció = true;
	while (creció) {
		creció = false;
		for (const e of especialidades) if (e.id_padre !== null && ids.has(e.id_padre) && !ids.has(e.id_especialidad)) {
			ids.add(e.id_especialidad);
			creció = true;
		}
	}
	return ids;
}

// ── Partidas ─────────────────────────────────────────────────────────────────────────────────────

export async function getPartidas(client: SupabaseClient, ambito: Ambito, soloEliminadas = false): Promise<PartidaCat[]> {
	const { data, error } = await client
		.from('partida_catalogo')
		.select('id_partida_catalogo, ambito, codigo, nombre, unidad, rendimiento, jornada, id_especialidad, precio_referencia, activo, updated_at')
		.eq('ambito', ambito)
		.eq('activo', !soloEliminadas)
		.order('codigo');
	if (error) throw new Error(mensaje(error, 'No se pudieron cargar las partidas'));
	return (data ?? []).map((p: any) => ({ ...p, rendimiento: num(p.rendimiento), jornada: num(p.jornada), precio_referencia: num(p.precio_referencia) })) as PartidaCat[];
}

export async function getApu(client: SupabaseClient, idPartida: number): Promise<LineaApu[]> {
	const { data, error } = await client
		.from('partida_catalogo_apu')
		.select('id_recurso, cuadrilla, cantidad, incluido, orden, recurso:id_recurso(codigo, nombre, tipo, unidad, precio_unitario)')
		.eq('id_partida_catalogo', idPartida)
		.order('orden');
	if (error) throw new Error(mensaje(error, 'No se pudo cargar el APU'));
	return (data ?? []).map((l: any) => ({
		id_recurso: l.id_recurso,
		codigo: l.recurso?.codigo ?? null,
		nombre: l.recurso?.nombre ?? '(recurso eliminado)',
		tipo: l.recurso?.tipo ?? 'material',
		unidad: l.recurso?.unidad ?? null,
		precio: num(l.recurso?.precio_unitario),
		cuadrilla: l.cuadrilla === null ? null : num(l.cuadrilla),
		cantidad: num(l.cantidad),
		incluido: l.incluido !== false
	}));
}

export async function siguienteCodigoPartida(client: SupabaseClient, prefijo: string): Promise<string> {
	const { data } = await client.from('partida_catalogo').select('codigo').ilike('codigo', `${prefijo}-%`);
	const max = (data ?? []).reduce((m: number, r: any) => {
		const n = Number(String(r.codigo).slice(prefijo.length + 1));
		return Number.isFinite(n) && n > m ? n : m;
	}, 0);
	return `${prefijo}-${String(max + 1).padStart(3, '0')}`;
}

export interface DatosPartida {
	ambito: Ambito;
	codigo: string;
	nombre: string;
	unidad: string;
	rendimiento: number;
	jornada: number;
	id_especialidad: number | null;
}

/** Guarda la cabecera y REEMPLAZA las líneas del APU; el P.U. de referencia se recalcula con calcularApu. */
export async function guardarPartida(client: SupabaseClient, datos: DatosPartida, lineas: LineaApu[], idPartida: number | null, usuario: string | null): Promise<Resultado<PartidaCat>> {
	if (!datos.codigo.trim()) return { success: false, message: 'Completa el código de la partida.' };
	if (!datos.nombre.trim()) return { success: false, message: 'Completa el nombre de la partida.' };
	if (!datos.unidad) return { success: false, message: 'Elige la unidad de la partida.' };
	if (!(datos.rendimiento > 0)) return { success: false, message: 'El rendimiento debe ser mayor a 0.' };
	if (!(datos.jornada > 0)) return { success: false, message: 'La jornada debe ser mayor a 0.' };
	const calculo = calcularApu(lineas, datos.jornada, datos.rendimiento);
	const cabecera = {
		ambito: datos.ambito,
		codigo: datos.codigo.trim().toUpperCase().slice(0, 20),
		nombre: datos.nombre.trim().slice(0, 250),
		unidad: datos.unidad,
		rendimiento: datos.rendimiento,
		jornada: datos.jornada,
		id_especialidad: datos.id_especialidad,
		precio_referencia: calculo.precioUnitario
	};
	const consulta = idPartida
		? client.from('partida_catalogo').update(cabecera).eq('id_partida_catalogo', idPartida)
		: client.from('partida_catalogo').insert({ ...cabecera, usuario_registro: usuario });
	const { data, error } = await consulta.select('*').single();
	if (error) return { success: false, message: mensaje(error, 'No se pudo guardar la partida') };
	const id = data.id_partida_catalogo as number;

	const { error: errBorrar } = await client.from('partida_catalogo_apu').delete().eq('id_partida_catalogo', id);
	if (errBorrar) return { success: false, message: mensaje(errBorrar, 'No se pudo actualizar el APU') };
	if (lineas.length > 0) {
		const filas = lineas.map((l, i) => ({
			id_partida_catalogo: id,
			id_recurso: l.id_recurso,
			cuadrilla: l.cuadrilla,
			cantidad: calculo.cantidades[i],
			incluido: l.incluido,
			orden: i
		}));
		const { error: errLineas } = await client.from('partida_catalogo_apu').insert(filas);
		if (errLineas) return { success: false, message: mensaje(errLineas, 'Se guardó la partida pero no su APU') };
	}
	return {
		success: true,
		message: idPartida ? 'Partida actualizada' : 'Partida creada',
		data: { ...(data as any), rendimiento: num(data.rendimiento), jornada: num(data.jornada), precio_referencia: num(data.precio_referencia) }
	};
}

export async function darDeBajaPartida(client: SupabaseClient, id: number): Promise<Resultado> {
	const { error } = await client.from('partida_catalogo').update({ activo: false }).eq('id_partida_catalogo', id);
	return error ? { success: false, message: mensaje(error, 'No se pudo dar de baja la partida') } : { success: true, message: 'Partida dada de baja' };
}

export async function restaurarPartida(client: SupabaseClient, id: number): Promise<Resultado> {
	const { error } = await client.from('partida_catalogo').update({ activo: true }).eq('id_partida_catalogo', id);
	return error ? { success: false, message: mensaje(error, 'No se pudo restaurar la partida') } : { success: true, message: 'Partida restaurada' };
}

export async function eliminarPartidaPermanente(client: SupabaseClient, id: number): Promise<Resultado> {
	const { error } = await client.from('partida_catalogo').delete().eq('id_partida_catalogo', id);
	return error ? { success: false, message: mensaje(error, 'No se pudo eliminar la partida') } : { success: true, message: 'Partida eliminada permanentemente' };
}

// ── Importación S10 / Excel (cabeceras de partidas) ──────────────────────────────────────────────

function sinTildes(t: string): string {
	return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export interface ResultadoImportacionPartidas {
	creadas: number;
	actualizadas: number;
	omitidas: number;
	errores: string[];
}

/**
 * Importa partidas desde un .xlsx (S10 o planilla propia): Código, Partida/Descripción, Unidad, Rendimiento y
 * Especialidad. Crea o actualiza las CABECERAS (por código); el APU de cada partida se arma después en pantalla.
 * Sin código, se genera con el prefijo de la especialidad (o "PAR").
 */
export async function importarPartidasExcel(client: SupabaseClient, ambito: Ambito, archivo: File, especialidades: Especialidad[], usuario: string | null): Promise<ResultadoImportacionPartidas> {
	const res: ResultadoImportacionPartidas = { creadas: 0, actualizadas: 0, omitidas: 0, errores: [] };
	const libro = new ExcelJS.Workbook();
	await libro.xlsx.load(await archivo.arrayBuffer());
	const hoja = libro.worksheets[0];
	if (!hoja) throw new Error('El archivo no tiene hojas.');
	const texto = (v: unknown): string => {
		if (v === null || v === undefined) return '';
		if (typeof v === 'object' && 'richText' in (v as any)) return (v as any).richText.map((p: any) => p.text).join('').trim();
		if (typeof v === 'object' && 'result' in (v as any)) return String((v as any).result ?? '').trim();
		return String(v).trim();
	};
	let filaEnc = 0;
	const col: Record<string, number> = {};
	for (let i = 1; i <= Math.min(20, hoja.rowCount) && !filaEnc; i++) {
		const enc: Record<string, number> = {};
		hoja.getRow(i).eachCell((c, n) => {
			const h = sinTildes(texto(c.value));
			if (!enc.codigo && /^(codigo|cod\.?|item)/.test(h)) enc.codigo = n;
			else if (!enc.nombre && /(partida|descripcion|nombre)/.test(h)) enc.nombre = n;
			else if (!enc.unidad && /^(unidad|und\.?|u\.m\.?|um)$/.test(h)) enc.unidad = n;
			else if (!enc.rendimiento && /rendimiento|rend/.test(h)) enc.rendimiento = n;
			else if (!enc.especialidad && /especialidad|grupo|subpresupuesto/.test(h)) enc.especialidad = n;
		});
		if (enc.nombre) {
			filaEnc = i;
			Object.assign(col, enc);
		}
	}
	if (!filaEnc) throw new Error('No se encontró la fila de encabezados: el archivo debe tener una columna Partida o Descripción.');

	const { data: existentes } = await client.from('partida_catalogo').select('id_partida_catalogo, codigo');
	const idPorCodigo = new Map((existentes ?? []).map((p: any) => [String(p.codigo).toUpperCase(), p.id_partida_catalogo as number]));
	const proximo: Record<string, string> = {};

	for (let i = filaEnc + 1; i <= hoja.rowCount; i++) {
		const f = hoja.getRow(i);
		const nombre = texto(f.getCell(col.nombre).value);
		if (!nombre) continue;
		const unidad = col.unidad ? texto(f.getCell(col.unidad).value).toLowerCase().slice(0, 10) : '';
		const rend = col.rendimiento ? Number(texto(f.getCell(col.rendimiento).value).replace(',', '.')) : 1;
		if (!unidad) {
			res.omitidas++; // filas de título/agrupador de S10 (sin unidad)
			continue;
		}
		const nombreEsp = col.especialidad ? sinTildes(texto(f.getCell(col.especialidad).value)) : '';
		const esp = nombreEsp ? especialidades.find((e) => sinTildes(e.nombre) === nombreEsp) : undefined;
		let codigo = col.codigo ? texto(f.getCell(col.codigo).value).toUpperCase().slice(0, 20) : '';
		const cabecera = { nombre: nombre.slice(0, 250), unidad, rendimiento: rend > 0 ? rend : 1, ...(esp ? { id_especialidad: esp.id_especialidad } : {}) };
		const existente = codigo ? idPorCodigo.get(codigo) : undefined;
		if (existente) {
			const { error } = await client.from('partida_catalogo').update(cabecera).eq('id_partida_catalogo', existente);
			if (error) res.errores.push(`Fila ${i}: ${error.message}`);
			else res.actualizadas++;
			continue;
		}
		if (!codigo) {
			const prefijo = prefijoDe(especialidades, esp?.id_especialidad ?? null);
			codigo = proximo[prefijo] ?? (await siguienteCodigoPartida(client, prefijo));
			proximo[prefijo] = `${prefijo}-${String(Number(codigo.slice(prefijo.length + 1)) + 1).padStart(3, '0')}`;
		}
		const { data, error } = await client.from('partida_catalogo').insert({ ambito, codigo, jornada: 8, usuario_registro: usuario, ...cabecera }).select('id_partida_catalogo').single();
		if (error) res.errores.push(`Fila ${i}: ${mensaje(error, 'no se pudo crear')}`);
		else {
			res.creadas++;
			idPorCodigo.set(codigo, data.id_partida_catalogo);
		}
	}
	return res;
}
