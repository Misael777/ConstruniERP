/**
 * Ficha del personal (tabla `personal`, migración 20261102130000_personal.sql). Incluye obreros de construcción
 * civil y personal en régimen general; no son usuarios del ERP (eso es Empleados en IAM).
 * `pin` es el código del trabajador en los huelleros (correlativo, lo asigna la base: fn_personal_asignar_pin): las marcaciones se enlazan por él.
 * Los trabajadores registrados primero en un huellero llegan solo con pin y nombre: quedan como "ficha incompleta".
 * Dar de baja / restaurar / eliminar permanente: skill dar-de-baja-pattern.
 */
import { borrarArchivosDriveHuerfanos } from '$lib/shared/borrarArchivosDrive';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CENTRO_COSTO_SELECT, nombreCentro } from '$lib/modules/asistencia/services/huelleros.service';

export interface Personal {
	id_personal: number;
	/** Ticket #118: lo que sabe hacer en campo (etiquetas libres). Sin la migración 20261127120000: undefined. */
	aptitudes?: string[] | null;
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
	regimen:
		| 'general'
		| 'construccion_civil'
		| 'microempresa'
		| 'pequena_empresa'
		| 'locacion_servicios'
		| 'practicas_preprofesionales'
		| 'practicas_profesionales'
		| 'contrata'
		| 'subcontrata'
		| null;
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
	/** Ticket #125: usuario del ERP (nombre) que renueva el SCTR / examen médico; sus alertas van a su "Mis tareas". */
	responsable_vencimientos?: string | null;
	/** Firmó el consentimiento para guardar su huella/rostro (Ley 29733); sin él la biometría no sale del huellero. */
	consentimiento_biometrico: boolean;
	consentimiento_fecha: string | null;
	id_empleado: number | null;
	/** Foto del trabajador (enlace de Google Drive; ver personalFoto.ts). */
	foto_url: string | null;
	/** Referente: quién lo trajo o responde por él en obra (p. ej. su subcontratista). */
	referente_nombre: string | null;
	referente_cargo: string | null;
	/** Tickets #119/#118: usuario del ERP (empleados.id) que aprueba su tareo. Sin la migración 20261124120000 no viene. */
	id_jefe_inmediato?: number | null;
	/** Modalidad de trabajo (se muestra en el tareo de Consultoría). */
	modalidad?: 'presencial' | 'remoto' | 'hibrido' | null;
	/** Ticket #110: método "Registro manual": marca su ingreso y salida desde el ERP aunque su horario sea fijo. */
	registro_manual?: boolean;
	/** Vínculo: en planilla propia o personal de un subcontratista (null = según el régimen; ver vinculoDe). */
	vinculo: 'planilla_propia' | 'subcontratista' | null;
	/** Empresa empleadora si es de un subcontratista (vacío en planilla propia = la propia empresa). */
	empleador_nombre: string | null;
	empleador_ruc: string | null;
	/** Régimen de la empresa empleadora: micro / pequeña (REMYPE) o general. */
	empleador_tamano: 'micro' | 'pequena' | 'general' | null;
	/** Desde cuándo rige el monto de pago actual. */
	monto_pago_desde: string | null;
	estado: 'activo' | 'baja';
	created_at: string;
	centro_costo?: { codigo: string; nombre: string; tipo?: string } | null;
	horario?: { nombre: string } | null;
	/** Huelleros donde marca (tabla personal_huellero); no depende de la obra. huellas/rostros: cuántos tiene
	 * registrados en ese huellero (solo el número; biometria_at null = el huellero aún no lo ha informado). */
	personal_huellero?: { id_dispositivo: number; huellas?: number; rostros?: number; biometria_at?: string | null }[];
	/** Todas sus obras o áreas (personal_obra); la principal es id_centro_costo. Sin la migración 20261116120000 no viene. */
	personal_obra?: { id_centro_costo: number; centro_costo?: { codigo: string; nombre: string; tipo?: string } | null }[];
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
/** Ticket #110 (punto 1): regímenes laborales y modalidades contractuales y formativas, como pidió la clienta. */
export const REGIMENES = [
	{ value: 'general', label: 'Régimen general', grupo: 'Regímenes laborales (planilla)' },
	{ value: 'construccion_civil', label: 'Régimen especial de construcción civil', grupo: 'Regímenes laborales (planilla)' },
	{ value: 'microempresa', label: 'Régimen especial de microempresa', grupo: 'Regímenes laborales (planilla)' },
	{ value: 'pequena_empresa', label: 'Régimen especial de pequeña empresa', grupo: 'Regímenes laborales (planilla)' },
	{ value: 'locacion_servicios', label: 'Locación de servicios', grupo: 'Modalidades de vinculación contractual y formativas' },
	{ value: 'practicas_preprofesionales', label: 'Convenio de prácticas preprofesionales', grupo: 'Modalidades de vinculación contractual y formativas' },
	{ value: 'practicas_profesionales', label: 'Convenio de prácticas profesionales', grupo: 'Modalidades de vinculación contractual y formativas' }
];
/** Valores de la versión anterior: se siguen mostrando en las fichas que los tienen hasta que se cambien. */
export const REGIMENES_ANTERIORES = [
	{ value: 'contrata', label: 'Contrata (anterior)', grupo: 'Anterior' },
	{ value: 'subcontrata', label: 'Subcontrata (anterior)', grupo: 'Anterior' }
];
export const TODOS_REGIMENES = [...REGIMENES, ...REGIMENES_ANTERIORES];
/** Ticket #110 (punto 2): cargos sugeridos (el campo sigue aceptando cualquier texto). */
/** Cargos por área (ticket #110, lista de la clienta del 26/11/2026). En la ficha se eligen de una lista agrupada;
 * se puede escribir otro con «Otro…». */
export const CARGOS_POR_AREA: { area: string; grupos: { grupo: string; cargos: string[] }[] }[] = [
	{
		area: 'Consultoría',
		grupos: [
			{ grupo: 'Dirección y diseño', cargos: ['Director de proyectos', 'Coordinador de proyectos', 'Arquitecto proyectista', 'Ingeniero estructural', 'Ingeniero sanitario', 'Ingeniero electricista', 'Especialista en seguridad', 'Especialista en instalaciones mecánicas', 'Especialista en gas natural'] },
			{ grupo: 'BIM y dibujo técnico', cargos: ['BIM Manager', 'Coordinador BIM', 'Modelador BIM Arquitectura', 'Modelador BIM Estructural', 'Modelador BIM MEP (general)', 'Modelador BIM Eléctrico', 'Modelador BIM Sanitario', 'Modelador BIM Gas', 'Modelador BIM HVAC (mecánicas)', 'Dibujante CAD'] },
			{ grupo: 'Asistencia técnica y gestión', cargos: ['Asistente de arquitectura', 'Asistente de ingeniería', 'Especialista en licencias', 'Gestor de trámites', 'Topógrafo', 'Calicatero', 'Practicante de arquitectura', 'Practicante de ingeniería'] }
		]
	},
	{
		area: 'Obra',
		grupos: [
			{ grupo: 'Personal técnico y administrativo', cargos: ['Gerente de obra', 'Ingeniero residente', 'Ingeniero de campo', 'Ingeniero de oficina técnica', 'Ingeniero de calidad', 'Supervisor de obra', 'Prevencionista de riesgos (SSOMA)', 'Asistente de obra', 'Administrador de obra', 'Almacenero', 'Topógrafo'] },
			{ grupo: 'Personal obrero – Jefatura', cargos: ['Maestro de obra', 'Capataz'] },
			{ grupo: 'Personal obrero – Operarios', cargos: ['Operario carpintero', 'Operario fierrero', 'Operario albañil', 'Operario gasfitero', 'Operario electricista', 'Operario soldador', 'Operario drywallero', 'Operario andamiero', 'Operario enchapador', 'Operario pintor', 'Operador de maquinaria'] },
			{ grupo: 'Personal obrero – Oficiales', cargos: ['Oficial carpintero', 'Oficial fierrero', 'Oficial albañil', 'Oficial gasfitero', 'Oficial electricista', 'Oficial soldador', 'Oficial drywallero', 'Oficial andamiero', 'Oficial enchapador', 'Oficial pintor'] },
			{ grupo: 'Personal obrero – Ayudantes', cargos: ['Ayudante carpintero', 'Ayudante fierrero', 'Ayudante albañil', 'Ayudante gasfitero', 'Ayudante electricista', 'Ayudante soldador', 'Ayudante drywallero', 'Ayudante andamiero', 'Ayudante enchapador', 'Ayudante pintor', 'Ayudante general'] }
		]
	},
	{
		area: 'Administración y corporativo',
		grupos: [
			{ grupo: 'Dirección y gerencia', cargos: ['Director general', 'Gerente general', 'Gerente de operaciones', 'Gerente comercial', 'Gerente de administración y finanzas'] },
			{ grupo: 'Administración y finanzas', cargos: ['Administrador general', 'Asistente administrativo', 'Auxiliar administrativo', 'Contador', 'Asistente contable', 'Analista financiero', 'Tesorero', 'Practicante administrativo'] },
			{ grupo: 'Recursos humanos', cargos: ['Jefe de recursos humanos', 'Asistente de recursos humanos'] },
			{ grupo: 'Logística y compras', cargos: ['Jefe de logística', 'Asistente de logística', 'Encargado de compras', 'Almacenero'] },
			{ grupo: 'Comercial y marketing', cargos: ['Jefe comercial', 'Asesor comercial', 'Asistente comercial', 'Coordinador de marketing', 'Community manager', 'Diseñador gráfico'] },
			{ grupo: 'Servicios generales', cargos: ['Recepcionista', 'Personal de limpieza', 'Personal de vigilancia', 'Personal de mantenimiento', 'Conductor'] }
		]
	}
];
/** Todos los cargos de la lista (sin repetir). */
export const CARGOS_SUGERIDOS = [...new Set(CARGOS_POR_AREA.flatMap((a) => a.grupos.flatMap((g) => g.cargos)))];
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
export const VINCULOS = [
	{ value: 'planilla_propia', label: 'Planilla propia' },
	{ value: 'subcontratista', label: 'Personal de subcontratista' }
];
export const TAMANOS_EMPRESA = [
	{ value: 'micro', label: 'MYPE · Microempresa' },
	{ value: 'pequena', label: 'MYPE · Pequeña empresa' },
	{ value: 'general', label: 'Régimen general' }
];
/** Vínculo efectivo: el elegido en la ficha o, si no se eligió, el que corresponde a su régimen. */
export const vinculoDe = (p: Pick<Personal, 'vinculo' | 'regimen'>): 'planilla_propia' | 'subcontratista' =>
	p.vinculo ?? (p.regimen === 'subcontrata' ? 'subcontratista' : 'planilla_propia');
/** Empresa empleadora a mostrar: la del subcontratista o la propia empresa. */
export const empleadorDe = (p: Pick<Personal, 'vinculo' | 'regimen' | 'empleador_nombre'>, propia: string): string =>
	p.empleador_nombre?.trim() || (vinculoDe(p) === 'planilla_propia' ? propia : '');
/** Unidad corta del monto: "/ día" para jornal diario (el resto se entiende por la periodicidad). */
export const unidadMonto = (periodicidad: string | null) => (periodicidad === 'diaria' ? '/ día' : '');
/** Cómo se le paga, para la etiqueta bajo el monto. El jornal diario se paga por semana. */
export const etiquetaPeriodicidad = (periodicidad: string | null) =>
	({ diaria: 'Pago semanal', semanal: 'Pago semanal', quincenal: 'Quincenal', mensual: 'Mensual' })[periodicidad ?? ''] ?? '';
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
/** Ticket #125: el SCTR dura 1 mes, así que avisa solo 1 semana antes (el examen médico sigue en 30 días). */
export const DIAS_AVISO_SCTR = 7;
export const diasAvisoVencimiento = (nombre: string) => (nombre === 'SCTR' ? DIAS_AVISO_SCTR : DIAS_AVISO_VENCIMIENTO);

/** Avisos de SCTR (7 días antes) y examen médico (30 días antes) vencidos o por vencer. */
export function alertasVencimiento(p: Personal, hoy: string): { texto: string; vencido: boolean }[] {
	const alertas: { texto: string; vencido: boolean }[] = [];
	for (const [nombre, fecha] of [['SCTR', p.sctr_vencimiento], ['Examen médico', p.examen_medico_vencimiento]] as const) {
		const dias = diasPara(fecha, hoy);
		if (dias === null || dias > diasAvisoVencimiento(nombre)) continue;
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
	const consultar = (huelleros: string, conObras: boolean) => {
		const obras = conObras ? `, personal_obra(id_centro_costo, ${CENTRO_COSTO_SELECT})` : '';
		// La obra principal se nombra por su FK: con personal_obra hay dos caminos de personal a centro_costo (PGRST201).
		const principal = CENTRO_COSTO_SELECT.replace('centro_costo(', 'centro_costo!personal_id_centro_costo_fkey(');
		const query = client.from('personal').select(`*, ${principal}, horario(nombre), personal_huellero(${huelleros})${obras}`).order('apellidos', { nullsFirst: true }).order('nombre');
		return soloEliminados ? query.eq('estado', 'baja') : query.neq('estado', 'baja');
	};
	let conObras = true;
	let { data, error } = await consultar('id_dispositivo, huellas, rostros, biometria_at', conObras);
	// Base sin la migración 20261116120000 (sin personal_obra): se carga igual, con una sola obra.
	if (error && /personal_obra/.test(`${error.message} ${error.details ?? ''} ${error.hint ?? ''}`)) {
		conObras = false;
		({ data, error } = await consultar('id_dispositivo, huellas, rostros, biometria_at', conObras));
	}
	// Base sin la migración 20261103130000 (columna inexistente, 42703): se carga igual, sin el aviso de huella.
	if (error?.code === '42703') ({ data, error } = await consultar('id_dispositivo', conObras));
	if (error) throw error;
	return (data ?? []).map((p: any) => ({
		...p,
		centro_costo: nombreCentro(p.centro_costo),
		personal_obra: p.personal_obra?.map((o: any) => ({ id_centro_costo: o.id_centro_costo, centro_costo: nombreCentro(o.centro_costo) }))
	})) as unknown as Personal[];
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
/** Guarda la ficha. `huelleros` = lista completa de huelleros donde marca; null = no se tocan (al editar, los
 * huelleros, el horario y la biometría se configuran en Asistencia → Configuración). */
export async function guardarPersonal(
	client: SupabaseClient,
	id: number | null,
	datos: DatosPersonal,
	huelleros: number[] | null,
	/** Todas sus obras o áreas (incluida la principal, datos.id_centro_costo); null = no se tocan. */
	obras: number[] | null = null
): Promise<number> {
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
	if (obras) await sincronizarObras(client, idPersonal, obras);
	if (huelleros) await sincronizarHuelleros(client, idPersonal, huelleros);
	return idPersonal;
}

/** Obras o áreas del trabajador: las de personal_obra, o solo la principal si la base aún no tiene esa tabla. */
export function obrasDe(p: Pick<Personal, 'id_centro_costo' | 'personal_obra'>): number[] {
	const ids = (p.personal_obra ?? []).map((o) => o.id_centro_costo);
	if (p.id_centro_costo && !ids.includes(p.id_centro_costo)) ids.unshift(p.id_centro_costo);
	return ids;
}

/** Deja al trabajador exactamente en `obras` (personal_obra). La principal la agrega también un trigger. */
async function sincronizarObras(client: SupabaseClient, idPersonal: number, obras: number[]): Promise<void> {
	const { data: actuales, error: errorLectura } = await client.from('personal_obra').select('id_centro_costo').eq('id_personal', idPersonal);
	if (errorLectura) {
		// Base sin la migración 20261116120000: con una sola obra (la principal) no hace falta la tabla.
		const sinTabla = errorLectura.code === 'PGRST205' || errorLectura.code === '42P01';
		if (sinTabla && obras.length <= 1) return;
		if (sinTabla) throw new Error('Esta base aún no admite varias obras por trabajador (falta la migración 20261116120000_personal_obras).');
		throw errorLectura;
	}
	const antes = new Set((actuales ?? []).map((v) => v.id_centro_costo as number));
	const quitar = [...antes].filter((o) => !obras.includes(o));
	const agregar = obras.filter((o) => !antes.has(o));
	if (quitar.length) {
		const { error } = await client.from('personal_obra').delete().eq('id_personal', idPersonal).in('id_centro_costo', quitar);
		if (error) throw error;
	}
	if (agregar.length) {
		const { error } = await client.from('personal_obra').insert(agregar.map((o) => ({ id_personal: idPersonal, id_centro_costo: o })));
		if (error) throw error;
	}
}

/** Campos de asistencia que se editan desde Asistencia → Configuración. */
export type DatosAsistenciaPersonal = Pick<DatosPersonal, 'id_horario' | 'id_empleado' | 'consentimiento_biometrico' | 'consentimiento_fecha' | 'registro_manual'>;

/** Guarda solo la configuración de asistencia (horario, usuario del ERP, consentimiento) y los huelleros donde marca. */
export async function guardarAsistenciaPersonal(client: SupabaseClient, idPersonal: number, datos: DatosAsistenciaPersonal, huelleros: number[]): Promise<void> {
	const { error } = await client
		.from('personal')
		.update({
			id_horario: datos.id_horario,
			id_empleado: datos.id_empleado,
			consentimiento_biometrico: datos.consentimiento_biometrico,
			consentimiento_fecha: datos.consentimiento_biometrico ? datos.consentimiento_fecha || null : null,
			// Base sin la migración 20261125120000: la columna no existe; solo se envía si se activó.
			...(datos.registro_manual !== undefined ? { registro_manual: datos.registro_manual } : {}),
			updated_at: new Date().toISOString()
		})
		.eq('id_personal', idPersonal);
	if (error) throw errorAmigable(error);
	await sincronizarHuelleros(client, idPersonal, huelleros);
}

/** Deja al trabajador exactamente en `huelleros` (agrega y quita filas de personal_huellero). */
async function sincronizarHuelleros(client: SupabaseClient, idPersonal: number, huelleros: number[]): Promise<void> {
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
}

/** Un tramo del historial de asignaciones (personal_historial_asignacion; lo llenan triggers, solo lectura). */
export interface Asignacion {
	id_historial: number;
	tipo: 'obra' | 'huellero' | 'referente';
	detalle: string | null;
	referente_nombre: string | null;
	referente_cargo: string | null;
	fecha_inicio: string;
	fecha_fin: string | null;
}

/** Obras, huelleros y referentes que tuvo el trabajador, del más reciente al más antiguo. */
export async function getHistorialAsignaciones(client: SupabaseClient, idPersonal: number): Promise<Asignacion[]> {
	const { data, error } = await client
		.from('personal_historial_asignacion')
		.select('id_historial, tipo, detalle, referente_nombre, referente_cargo, fecha_inicio, fecha_fin')
		.eq('id_personal', idPersonal)
		.order('fecha_inicio', { ascending: false })
		.order('id_historial', { ascending: false });
	if (error) throw error;
	return (data ?? []) as Asignacion[];
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

/** Ticket #144: aptitud técnica de un cargo con su nivel. */
export type NivelAptitud = 'basico' | 'intermedio' | 'avanzado';
export const NIVELES_APTITUD: { value: NivelAptitud; label: string }[] = [
	{ value: 'basico', label: 'Básico' },
	{ value: 'intermedio', label: 'Intermedio' },
	{ value: 'avanzado', label: 'Avanzado' }
];
export interface AptitudCargo {
	actividad: string;
	nivel: NivelAptitud | null;
}

/** Un tramo del historial de cargos (personal_cargo_historial). fecha_fin vacía = cargo vigente. Ticket #144: puede haber
 * un cargo PRINCIPAL vigente y varios SECUNDARIOS a la vez, cada uno con sus aptitudes técnicas. */
export interface CargoHistorial {
	id_cargo_historial?: number;
	cargo: string;
	fecha_inicio: string;
	fecha_fin: string | null;
	observacion: string | null;
	clasificacion?: 'principal' | 'secundario';
	aptitudes?: AptitudCargo[];
}

/** Historial de cargos de un trabajador, del más reciente al más antiguo. */
export async function getCargosHistorial(client: SupabaseClient, idPersonal: number): Promise<CargoHistorial[]> {
	const consultar = (cols: string) => client.from('personal_cargo_historial').select(cols).eq('id_personal', idPersonal).order('fecha_inicio', { ascending: false });
	let { data, error } = await consultar('id_cargo_historial, cargo, fecha_inicio, fecha_fin, observacion, clasificacion, aptitudes');
	// Sin la migración 20261127140000: sin clasificación ni aptitudes (todos principales).
	if (error?.code === '42703' || error?.code === 'PGRST204') ({ data, error } = await consultar('id_cargo_historial, cargo, fecha_inicio, fecha_fin, observacion'));
	if (error) throw error;
	return ((data ?? []) as any[]).map((t) => ({ ...t, clasificacion: t.clasificacion ?? 'principal', aptitudes: Array.isArray(t.aptitudes) ? t.aptitudes : [] })) as CargoHistorial[];
}

/** ¿El tramo sigue abierto (vigente o programado)? */
export const cargoAbierto = (t: CargoHistorial, hoy: string) => !!t.cargo.trim() && (!t.fecha_fin || t.fecha_fin >= hoy);

/** El cargo PRINCIPAL vigente (el más reciente ya iniciado; si no, el próximo programado), o null. */
export function cargoActual(tramos: CargoHistorial[], hoy = hoyLima()): string | null {
	const abiertos = tramos
		.filter((t) => cargoAbierto(t, hoy) && (t.clasificacion ?? 'principal') === 'principal')
		.sort((a, b) => Number(a.fecha_inicio > hoy) - Number(b.fecha_inicio > hoy) || b.fecha_inicio.localeCompare(a.fecha_inicio));
	return abiertos[0]?.cargo.trim() ?? null;
}

/** Aptitudes de los cargos abiertos (sin repetir): pasan a personal.aptitudes, que usa el tareo. */
export function aptitudesDeCargos(tramos: CargoHistorial[], hoy = hoyLima()): string[] {
	const vistos = new Map<string, string>();
	for (const t of tramos.filter((t) => cargoAbierto(t, hoy)))
		for (const a of t.aptitudes ?? []) if (a.actividad?.trim()) vistos.set(a.actividad.trim().toLowerCase(), a.actividad.trim());
	return [...vistos.values()];
}

/** Guarda el historial tal como quedó en la ficha: borra los tramos quitados, actualiza los existentes e inserta los nuevos. */
export async function guardarCargosHistorial(client: SupabaseClient, idPersonal: number, tramos: CargoHistorial[]): Promise<void> {
	const { data: actuales, error: errorLectura } = await client.from('personal_cargo_historial').select('id_cargo_historial').eq('id_personal', idPersonal);
	if (errorLectura) throw errorLectura;
	const quedan = new Set(tramos.filter((t) => t.id_cargo_historial).map((t) => t.id_cargo_historial));
	const quitar = (actuales ?? []).map((a) => a.id_cargo_historial as number).filter((id) => !quedan.has(id));
	if (quitar.length) {
		const { error } = await client.from('personal_cargo_historial').delete().in('id_cargo_historial', quitar);
		if (error) throw error;
	}
	let conExtras = true;
	const fila = (t: CargoHistorial) => ({
		id_personal: idPersonal,
		cargo: t.cargo.trim(),
		fecha_inicio: t.fecha_inicio,
		fecha_fin: t.fecha_fin || null,
		observacion: t.observacion?.trim() || null,
		...(conExtras
			? { clasificacion: t.clasificacion ?? 'principal', aptitudes: (t.aptitudes ?? []).filter((a) => a.actividad?.trim()).map((a) => ({ actividad: a.actividad.trim(), nivel: a.nivel ?? null })) }
			: {})
	});
	const sinColumna = (e: { code?: string } | null) => e?.code === '42703' || e?.code === 'PGRST204';
	for (const t of tramos.filter((t) => t.id_cargo_historial)) {
		let { error } = await client.from('personal_cargo_historial').update(fila(t)).eq('id_cargo_historial', t.id_cargo_historial!);
		if (sinColumna(error)) {
			conExtras = false;
			({ error } = await client.from('personal_cargo_historial').update(fila(t)).eq('id_cargo_historial', t.id_cargo_historial!));
		}
		if (error) throw error;
	}
	const nuevos = tramos.filter((t) => !t.id_cargo_historial);
	if (nuevos.length) {
		let { error } = await client.from('personal_cargo_historial').insert(nuevos.map(fila));
		if (sinColumna(error)) {
			conExtras = false;
			({ error } = await client.from('personal_cargo_historial').insert(nuevos.map(fila)));
		}
		if (error) throw error;
	}
}

/** Ticket #144: otros trabajadores con ese cargo y aptitudes registradas ("Importar aptitudes de otro trabajador"). */
export async function aptitudesPorCargo(
	client: SupabaseClient,
	cargo: string,
	excluirIdPersonal: number | null
): Promise<{ idPersonal: number; nombre: string; aptitudes: AptitudCargo[] }[]> {
	if (!cargo.trim()) return [];
	const { data, error } = await client
		.from('personal_cargo_historial')
		.select('id_personal, aptitudes, fecha_inicio, personal!inner(nombres, apellidos, nombre, estado)')
		.ilike('cargo', cargo.trim())
		.order('fecha_inicio', { ascending: false });
	if (error) return [];
	const porPersona = new Map<number, { idPersonal: number; nombre: string; aptitudes: AptitudCargo[] }>();
	for (const r of (data ?? []) as any[]) {
		const per = Array.isArray(r.personal) ? r.personal[0] : r.personal;
		if (r.id_personal === excluirIdPersonal || per?.estado === 'baja' || porPersona.has(r.id_personal)) continue;
		const aptitudes = (Array.isArray(r.aptitudes) ? r.aptitudes : []) as AptitudCargo[];
		if (!aptitudes.length) continue;
		porPersona.set(r.id_personal, {
			idPersonal: r.id_personal,
			nombre: [per?.nombres, per?.apellidos].filter(Boolean).join(' ').trim() || per?.nombre || 'Trabajador',
			aptitudes
		});
	}
	return [...porPersona.values()];
}

/** Ticket #144: un tramo del historial de remuneraciones. fecha_fin vacía = vigente. */
export interface RemuneracionHistorial {
	id_remuneracion?: number;
	fecha_inicio: string;
	fecha_fin: string | null;
	periodicidad: 'diaria' | 'semanal' | 'quincenal' | 'mensual';
	monto: number;
	observacion: string | null;
}

/** Historial de remuneraciones (del más reciente al más antiguo). null si la base aún no tiene la tabla (migración
 * 20261127140000): entonces la ficha sigue con los campos de "Condiciones actuales". */
export async function getRemuneraciones(client: SupabaseClient, idPersonal: number): Promise<RemuneracionHistorial[] | null> {
	const { data, error } = await client
		.from('personal_remuneracion_historial')
		.select('id_remuneracion, fecha_inicio, fecha_fin, periodicidad, monto, observacion')
		.eq('id_personal', idPersonal)
		.order('fecha_inicio', { ascending: false });
	if (error) {
		if (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST204') return null;
		throw error;
	}
	return ((data ?? []) as any[]).map((r) => ({ ...r, monto: Number(r.monto) }));
}

/** La remuneración vigente hoy (la más reciente ya iniciada y sin cerrar; si no, la más reciente). */
export function remuneracionVigente(tramos: RemuneracionHistorial[], hoy = hoyLima()): RemuneracionHistorial | null {
	const orden = [...tramos].sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio));
	return orden.find((t) => t.fecha_inicio <= hoy && (!t.fecha_fin || t.fecha_fin >= hoy)) ?? orden[0] ?? null;
}

export async function guardarRemuneraciones(client: SupabaseClient, idPersonal: number, tramos: RemuneracionHistorial[], usuario: string | null): Promise<void> {
	const { data: actuales, error: e0 } = await client.from('personal_remuneracion_historial').select('id_remuneracion').eq('id_personal', idPersonal);
	if (e0) throw e0;
	const quedan = new Set(tramos.filter((t) => t.id_remuneracion).map((t) => t.id_remuneracion));
	const quitar = (actuales ?? []).map((a) => a.id_remuneracion as number).filter((id) => !quedan.has(id));
	if (quitar.length) {
		const { error } = await client.from('personal_remuneracion_historial').delete().in('id_remuneracion', quitar);
		if (error) throw error;
	}
	const fila = (t: RemuneracionHistorial) => ({
		id_personal: idPersonal,
		fecha_inicio: t.fecha_inicio,
		fecha_fin: t.fecha_fin || null,
		periodicidad: t.periodicidad,
		monto: Math.round(Number(t.monto) * 100) / 100,
		observacion: t.observacion?.trim() || null
	});
	for (const t of tramos.filter((t) => t.id_remuneracion)) {
		const { error } = await client.from('personal_remuneracion_historial').update(fila(t)).eq('id_remuneracion', t.id_remuneracion!);
		if (error) throw error;
	}
	const nuevos = tramos.filter((t) => !t.id_remuneracion).map((t) => ({ ...fila(t), usuario }));
	if (nuevos.length) {
		const { error } = await client.from('personal_remuneracion_historial').insert(nuevos);
		if (error) throw error;
	}
}
