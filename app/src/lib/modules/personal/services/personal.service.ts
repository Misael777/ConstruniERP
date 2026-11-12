/**
 * Ficha del personal (tabla `personal`, migración 20261102130000_personal.sql). Incluye obreros de construcción
 * civil y personal en régimen general; no son usuarios del ERP (eso es Empleados en IAM).
 * `pin` es el código del trabajador en los huelleros (correlativo, lo asigna la base: fn_personal_asignar_pin): las marcaciones se enlazan por él.
 * Los trabajadores registrados primero en un huellero llegan solo con pin y nombre: quedan como "ficha incompleta".
 * Dar de baja / restaurar / eliminar permanente: skill dar-de-baja-pattern.
 */
import { borrarArchivosDriveHuerfanos } from '$lib/shared/borrarArchivosDrive';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface Personal {
	id_personal: number;
	pin: string;
	nombre: string | null;
	tipo_documento: 'DNI' | 'CE' | 'PAS';
	numero_documento: string | null;
	nombres: string | null;
	apellidos: string | null;
	fecha_nacimiento: string | null;
	sexo: 'M' | 'F' | null;
	telefono: string | null;
	direccion: string | null;
	contacto_emergencia_nombre: string | null;
	contacto_emergencia_telefono: string | null;
	regimen: 'construccion_civil' | 'contrata' | 'subcontrata' | 'general' | null;
	/** Especialidad (CATEGORIAS) si el régimen es de obreros; ver usaCategoria. */
	categoria: string | null;
	cargo: string | null;
	/** Cada cuánto se le paga; `monto_pago` es lo que recibe por ese periodo. */
	periodicidad_pago: 'diaria' | 'semanal' | 'quincenal' | 'mensual' | null;
	monto_pago: number | null;
	id_centro_costo: number | null;
	id_horario: number | null;
	fecha_ingreso: string | null;
	fecha_cese: string | null;
	motivo_cese: string | null;
	sistema_pension: string | null;
	cuspp: string | null;
	banco: string | null;
	numero_cuenta: string | null;
	cci: string | null;
	sctr_poliza: string | null;
	sctr_vencimiento: string | null;
	examen_medico_vencimiento: string | null;
	/** Firmó el consentimiento para guardar su huella/rostro (Ley 29733); sin él la biometría no sale del huellero. */
	consentimiento_biometrico: boolean;
	consentimiento_fecha: string | null;
	id_empleado: number | null;
	/** Foto del trabajador (enlace de Google Drive; ver personalFoto.ts). */
	foto_url: string | null;
	/** Referente: quién lo trajo o responde por él en obra (p. ej. su subcontratista). */
	referente_nombre: string | null;
	referente_cargo: string | null;
	estado: 'activo' | 'baja';
	created_at: string;
	centro_costo?: { codigo: string; nombre: string } | null;
	horario?: { nombre: string } | null;
	/** Huelleros donde marca (tabla personal_huellero); no depende de la obra. huellas/rostros: cuántos tiene
	 * registrados en ese huellero (solo el número; biometria_at null = el huellero aún no lo ha informado). */
	personal_huellero?: { id_dispositivo: number; huellas?: number; rostros?: number; biometria_at?: string | null }[];
}

/** Campos editables desde la ficha (todo menos id, estado, fechas de auditoría y lo embebido). */
export type DatosPersonal = Omit<
	Personal,
	'id_personal' | 'nombre' | 'estado' | 'created_at' | 'centro_costo' | 'horario' | 'personal_huellero'
>;

/** Usuarios activos del ERP, para vincular una ficha con quien registra su asistencia en "Mi asistencia". */
export async function getUsuariosErp(client: SupabaseClient): Promise<{ value: string; label: string }[]> {
	const { data, error } = await client.from('empleados').select('id, nombre, correo').eq('estado', 'activo').order('nombre');
	if (error) throw error;
	return (data ?? []).map((e) => ({ value: String(e.id), label: `${e.nombre}${e.correo ? ` · ${e.correo}` : ''}` }));
}

export const TIPOS_DOCUMENTO = [
	{ value: 'DNI', label: 'DNI' },
	{ value: 'CE', label: 'Carné de extranjería' },
	{ value: 'PAS', label: 'Pasaporte' }
];
export const SEXOS = [
	{ value: 'M', label: 'Masculino' },
	{ value: 'F', label: 'Femenino' }
];
export const REGIMENES = [
	{ value: 'construccion_civil', label: 'Construcción civil' },
	{ value: 'contrata', label: 'Contrata' },
	{ value: 'subcontrata', label: 'Subcontrata' },
	{ value: 'general', label: 'Régimen general' }
];
/** Cargo del referente (a pedido del usuario). Para agregar otro, súmalo aquí. */
export const CARGOS_REFERENTE = ['Subcontratista', 'Contratista'].map((v) => ({ value: v, label: v }));

/** Regímenes de obreros: llevan categoría (especialidad). Régimen general lleva cargo. */
export const usaCategoria = (regimen: string | null | undefined) =>
	regimen === 'construccion_civil' || regimen === 'contrata' || regimen === 'subcontrata';

/** Especialidades: las mismas de Sub Contrata en Transacciones (SUBOPCIONES_SUBCONTRATA en TransaccionModal.svelte),
 * a pedido del usuario. Se guarda el texto tal cual (migración 20261107130000). */
const ESPECIALIDADES: [string, string[]][] = [
	['Operario', ['Operario Carpintero', 'Operario Albañil', 'Operario Fierrero', 'Operario Eléctrico', 'Operario Sanitario', 'Operario Multifuncional']],
	['Ayudante', ['Ayudante Sanitario', 'Ayudante Carpintero', 'Ayudante Albañil', 'Ayudante Fierrero', 'Ayudante Eléctrico', 'Ayudante General']],
	['Oficial', ['Oficial Carpintero', 'Oficial Albañil', 'Oficial Fierrero', 'Oficial Eléctrico']],
	['Otros', ['Vigilante', 'Eléctrico', 'Otras Subcontratos']]
];
export const CATEGORIAS: { value: string; label: string; grupo: string }[] = ESPECIALIDADES.flatMap(([grupo, lista]) =>
	lista.map((v) => ({ value: v, label: v, grupo }))
);
/** Categorías de la versión anterior (sin especialidad): se siguen mostrando hasta que se edite la ficha. */
const CATEGORIAS_ANTERIORES: Record<string, string> = { operario: 'Operario', oficial: 'Oficial', peon: 'Peón' };
export const etiquetaCategoria = (valor: string | null | undefined) =>
	!valor ? '' : (CATEGORIAS.find((c) => c.value === valor)?.label ?? CATEGORIAS_ANTERIORES[valor] ?? valor);
export const PERIODICIDADES_PAGO = [
	{ value: 'diaria', label: 'Diario (jornal)' },
	{ value: 'semanal', label: 'Semanal' },
	{ value: 'quincenal', label: 'Quincenal' },
	{ value: 'mensual', label: 'Mensual' }
];
/** Texto del monto según el periodo: "Pago semanal", "Jornal diario"… */
export const etiquetaMonto = (periodicidad: string | null) =>
	({ diaria: 'Jornal diario', semanal: 'Pago semanal', quincenal: 'Pago quincenal', mensual: 'Sueldo mensual' })[periodicidad ?? ''] ?? 'Monto de pago';
export const SISTEMAS_PENSION = ['ONP', 'AFP Integra', 'AFP Prima', 'AFP Profuturo', 'AFP Habitat'].map((v) => ({ value: v, label: v }));

export const etiqueta = (lista: { value: string; label: string }[], valor: string | null) =>
	lista.find((o) => o.value === valor)?.label ?? '';

export function nombreCompleto(p: Pick<Personal, 'nombres' | 'apellidos' | 'nombre' | 'pin'>): string {
	const erp = [p.apellidos, p.nombres].filter(Boolean).join(', ');
	return erp || p.nombre || `Código ${p.pin}`;
}

/** Ficha creada por el huellero (o a medio llenar): faltan los datos obligatorios del formulario. */
export const fichaIncompleta = (p: Personal) => !p.numero_documento || !p.nombres || !p.apellidos || !p.regimen;

/** Huelleros donde debe marcar pero aún no tiene su huella registrada (aviso de alta prioridad). */
export const huellerosSinHuella = (p: Personal) =>
	(p.personal_huellero ?? []).filter((v) => v.huellas !== undefined && !v.huellas).map((v) => v.id_dispositivo);

/** Huelleros donde debe marcar pero aún no tiene su rostro registrado (aviso aparte, a pedido del usuario). */
export const huellerosSinRostro = (p: Personal) =>
	(p.personal_huellero ?? []).filter((v) => v.rostros !== undefined && !v.rostros).map((v) => v.id_dispositivo);

/** Días que faltan para el vencimiento (negativo = vencido), con fechas 'AAAA-MM-DD' en hora de Lima. */
function diasPara(fecha: string | null, hoy: string): number | null {
	if (!fecha) return null;
	return Math.round((Date.parse(fecha) - Date.parse(hoy)) / 86_400_000);
}

export const DIAS_AVISO_VENCIMIENTO = 30;

/** Avisos de SCTR y examen médico vencidos o por vencer en los próximos 30 días. */
export function alertasVencimiento(p: Personal, hoy: string): { texto: string; vencido: boolean }[] {
	const alertas: { texto: string; vencido: boolean }[] = [];
	for (const [nombre, fecha] of [['SCTR', p.sctr_vencimiento], ['Examen médico', p.examen_medico_vencimiento]] as const) {
		const dias = diasPara(fecha, hoy);
		if (dias === null || dias > DIAS_AVISO_VENCIMIENTO) continue;
		alertas.push(
			dias < 0
				? { texto: `${nombre} vencido`, vencido: true }
				: { texto: dias === 0 ? `${nombre} vence hoy` : `${nombre} vence en ${dias} d`, vencido: false }
		);
	}
	return alertas;
}

/** Hoy en Lima (UTC-5, sin horario de verano) como 'AAAA-MM-DD'. */
export const hoyLima = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);

export async function getPersonal(client: SupabaseClient, soloEliminados = false): Promise<Personal[]> {
	const consultar = (huelleros: string) => {
		const query = client.from('personal').select(`*, centro_costo(codigo, nombre), horario(nombre), personal_huellero(${huelleros})`).order('apellidos', { nullsFirst: true }).order('nombre');
		return soloEliminados ? query.eq('estado', 'baja') : query.neq('estado', 'baja');
	};
	let { data, error } = await consultar('id_dispositivo, huellas, rostros, biometria_at');
	// Base sin la migración 20261103130000 (columna inexistente, 42703): se carga igual, sin el aviso de huella.
	if (error?.code === '42703') ({ data, error } = await consultar('id_dispositivo'));
	if (error) throw error;
	return (data ?? []) as unknown as Personal[];
}

/** Traduce los choques de índices únicos (código de huellero o documento repetido) a un mensaje claro. */
function errorAmigable(error: { code?: string; message?: string; details?: string }): Error | typeof error {
	if (error.code !== '23505') return error;
	const texto = `${error.message ?? ''} ${error.details ?? ''}`;
	if (texto.includes('uq_personal_documento')) return new Error('Ya existe un trabajador con ese documento.');
	if (texto.includes('uq_personal_empleado')) return new Error('Ese usuario del ERP ya está vinculado a otro trabajador.');
	if (texto.includes('pin')) return new Error('Ya existe un trabajador con ese número en huellero.');
	return error;
}

/** Crea (id null) o actualiza la ficha y sus huelleros. `nombre` (el del huellero) se alinea con nombres +
 * apellidos del ERP. Vincular o desvincular un huellero encola en la BD el alta o retiro en ese equipo. */
export async function guardarPersonal(client: SupabaseClient, id: number | null, datos: DatosPersonal, huelleros: number[]): Promise<number> {
	const fila = {
		...datos,
		nombre: [datos.nombres, datos.apellidos].filter(Boolean).join(' ').slice(0, 150) || null,
		updated_at: new Date().toISOString()
	};
	let idPersonal = id;
	if (idPersonal === null) {
		// El número en huellero lo pone la base (trigger fn_personal_asignar_pin, correlativo). Se omite en vez de
		// mandarlo vacío: si faltara el trigger, el NOT NULL rechaza el alta en lugar de guardar un número vacío.
		const { pin: _pin, ...sinPin } = fila;
		const { data, error } = await client.from('personal').insert(sinPin).select('id_personal').single();
		if (error) throw errorAmigable(error);
		idPersonal = data.id_personal as number;
	} else {
		const { error } = await client.from('personal').update(fila).eq('id_personal', idPersonal);
		if (error) throw errorAmigable(error);
	}

	const { data: actuales, error: errorLectura } = await client.from('personal_huellero').select('id_dispositivo').eq('id_personal', idPersonal);
	if (errorLectura) throw errorLectura;
	const antes = new Set((actuales ?? []).map((v) => v.id_dispositivo as number));
	const quitar = [...antes].filter((d) => !huelleros.includes(d));
	const agregar = huelleros.filter((d) => !antes.has(d));
	if (quitar.length) {
		const { error } = await client.from('personal_huellero').delete().eq('id_personal', idPersonal).in('id_dispositivo', quitar);
		if (error) throw error;
	}
	if (agregar.length) {
		const { error } = await client.from('personal_huellero').insert(agregar.map((d) => ({ id_personal: idPersonal, id_dispositivo: d })));
		if (error) throw error;
	}
	return idPersonal;
}

/** Mueve varios trabajadores a otra obra o área. Con `cambiarHuelleros`, quita los huelleros de su obra anterior
 * y agrega los de la nueva (con su huella/rostro si dieron consentimiento). Devuelve cuántos se movieron. */
export async function moverPersonal(client: SupabaseClient, ids: number[], idCentroCosto: number, cambiarHuelleros: boolean): Promise<number> {
	const { data, error } = await client.rpc('fn_personal_mover', {
		p_ids: ids,
		p_id_centro_costo: idCentroCosto,
		p_cambiar_huelleros: cambiarHuelleros
	});
	if (error) throw error;
	return data ?? 0;
}

/** Huellas y rostros guardados (cifrados) por trabajador; nunca devuelve la plantilla. */
export async function getBiometriaGuardada(client: SupabaseClient): Promise<Record<number, { huellas: number; rostros: number }>> {
	const { data, error } = await client.rpc('fn_personal_biometria_resumen');
	if (error) throw error;
	const resumen: Record<number, { huellas: number; rostros: number }> = {};
	for (const r of data ?? []) resumen[r.id_personal] = { huellas: r.huellas, rostros: r.rostros };
	return resumen;
}

export async function darDeBajaPersonal(client: SupabaseClient, id: number): Promise<void> {
	const { error } = await client.from('personal').update({ estado: 'baja', updated_at: new Date().toISOString() }).eq('id_personal', id);
	if (error) throw error;
}

export async function restaurarPersonal(client: SupabaseClient, id: number): Promise<void> {
	const { error } = await client.from('personal').update({ estado: 'activo', updated_at: new Date().toISOString() }).eq('id_personal', id);
	if (error) throw error;
}

/** Borra la ficha. Sus marcaciones se conservan (se enlazan por código, no por id). */
export async function eliminarPersonalPermanente(client: SupabaseClient, id: number): Promise<void> {
	const { data: antes } = await client.from('personal').select('foto_url').eq('id_personal', id).maybeSingle();
	const { error } = await client.from('personal').delete().eq('id_personal', id);
	if (error) throw error;
	void borrarArchivosDriveHuerfanos(client, [antes?.foto_url]); // ticket #123
}
