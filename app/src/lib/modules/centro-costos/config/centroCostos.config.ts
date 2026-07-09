/**
 * =============================================================
 * CONFIGURACIÓN CENTRALIZADA — Módulo Centro de Costos
 * =============================================================
 *
 * Este archivo es la ÚNICA fuente de verdad sobre los campos del
 * formulario/tabla de "centro_costo": tipos, validaciones, máscaras,
 * opciones de select y orden por defecto.
 *
 * El service (centroCostos.service.ts), el +page.svelte (client-side, sin servidor) y el
 * modal (CentroCostoModal.svelte) leen FIELDS_CONFIG en lugar de
 * tener reglas hardcodeadas — así, para ajustar un formato (largo
 * máximo, regex, mayúsculas, opciones de un select, etc.) solo
 * hay que tocar este archivo.
 *
 * ESQUEMA REAL EN BD (verificado contra el schema cache de PostgREST, no contra el SQL local):
 *   CREATE TABLE centro_costo (
 *     id_centro_costo  BIGSERIAL PRIMARY KEY,
 *     codigo           VARCHAR(50) NOT NULL,
 *     nombre           VARCHAR(200) NOT NULL,
 *     tipo             VARCHAR(20) NOT NULL,
 *     monto_actual     NUMERIC,
 *     created_at       TIMESTAMPTZ DEFAULT NOW(),
 *     id_proyecto      BIGINT REFERENCES proyecto(id_proyecto)   ON DELETE CASCADE,
 *     id_cliente       BIGINT REFERENCES cliente(id_cliente)     ON DELETE CASCADE,
 *     id_proveedor     BIGINT REFERENCES proveedor(id_proveedor) ON DELETE CASCADE
 *   );
 * Las tres últimas columnas se agregaron vía centro_costo_vinculacion_migration.sql — reemplazan un
 * intento anterior (columna "id_referencia") que NuevaVentaModal.svelte usaba pero que NUNCA existió
 * realmente en la BD; ese upsert fallaba en silencio (no revisaba el resultado). Como mucho una de
 * las tres puede ser no-nula por fila (chk_centro_costo_una_entidad) — se completan solas vía
 * getOrCrearCentroCostoParaEntidad en centroCostos.service.ts, nunca a mano.
 *
 * OJO: DER2.sql y DB_reset_withoutacces.sql tienen la columna mal escrita como "monto_ctual"
 * (typo, falta la "a" de "actual"). La base de datos real en Supabase SÍ tiene el nombre correcto
 * "monto_actual" (confirmado consultando GET {SUPABASE_URL}/rest/v1/ con Accept: application/openapi+json).
 * Si actualizas esos .sql para corregir el typo, no hace falta tocar nada aquí — el código ya usa
 * el nombre real "monto_actual".
 *
 * La tabla NO tiene columna de estado (no hay soft-delete todavía),
 * por eso DELETE_STRATEGY = 'hard'. Si en el futuro agregas una
 * columna (p.ej. `estado VARCHAR(20)`), cambia DELETE_STRATEGY a
 * 'soft' y completa SOFT_DELETE_COLUMN más abajo — el resto del
 * módulo (service, page.server, UI) ya está preparado para ambos
 * modos sin tocar más código.
 */

// ---------------------------------------------------------------
// Tipos de campo soportados por el renderer genérico del modal
// ---------------------------------------------------------------
// 'currency' se valida y convierte igual que 'number', pero se renderiza como texto (para poder
// aplicar máscara de miles/decimales) y se formatea como moneda en tabla y formulario.
export type CentroCostoFieldType = 'text' | 'number' | 'currency' | 'select' | 'readonly';

export interface CentroCostoFieldOption {
	value: string;
	label: string;
}

export interface CentroCostoFieldConfig {
	/** Nombre exacto de la columna en la tabla centro_costo */
	key: string;
	/** Etiqueta visible en tabla/formulario */
	label: string;
	/** Tipo de control/validación */
	tipo: CentroCostoFieldType;
	/** ¿Obligatorio al crear/editar? */
	required?: boolean;
	/** Largo máximo (debe reflejar el VARCHAR(n) real de la BD) */
	maxLength?: number;
	/** Valor numérico mínimo permitido (inclusive) para tipo 'number' | 'currency' */
	min?: number;
	/** Si true, el valor se fuerza a MAYÚSCULAS mientras se escribe */
	uppercase?: boolean;
	/** Expresión regular de validación (formato exacto del ERP) */
	regex?: RegExp;
	/** Mensaje a mostrar cuando `regex` no matchea */
	regexMessage?: string;
	/**
	 * Función de máscara/transformación aplicada en cada input
	 * (se ejecuta ANTES de la validación). Útil para limpiar
	 * espacios, forzar formato "CC-0001", etc.
	 */
	mask?: (rawValue: string) => string;
	/** Opciones para tipo 'select' (debe reflejar el CHECK de la BD) */
	options?: CentroCostoFieldOption[];
	/** Placeholder del input */
	placeholder?: string;
	/** Texto de ayuda bajo el campo */
	helpText?: string;
	/** ¿Se muestra como columna en la tabla? */
	showInTable?: boolean;
	/** ¿Se muestra/edita en el modal de crear/editar? */
	showInForm?: boolean;
	/** ¿La columna admite ordenamiento desde la cabecera de tabla? */
	sortable?: boolean;
	/** Orden por defecto si este es el campo de orden inicial */
	defaultSort?: 'asc' | 'desc';
}

// ---------------------------------------------------------------
// Constantes del módulo
// ---------------------------------------------------------------

/** Nombre real de la tabla en Supabase/Postgres */
export const TABLE_NAME = 'centro_costo';

/** Columna llave primaria (usada para eq() en update/delete) */
export const PK_COLUMN = 'id_centro_costo';

/** Columnas usadas por el buscador (ilike OR) — pedido: código y nombre */
export const SEARCHABLE_COLUMNS = ['codigo', 'nombre'] as const;

/** Tamaño de página por defecto de la tabla paginada */
export const DEFAULT_PAGE_SIZE = 10;

/** Campo y dirección de orden por defecto cuando no hay query params */
export const DEFAULT_SORT_FIELD = 'created_at';
export const DEFAULT_SORT_DIR: 'asc' | 'desc' = 'desc';

/**
 * Estrategia de borrado:
 *  - 'hard' -> DELETE real (lo que aplica hoy, no hay columna de estado)
 *  - 'soft' -> UPDATE de SOFT_DELETE_COLUMN a SOFT_DELETE_INACTIVE_VALUE
 *
 * AJUSTAR: cuando agregues una columna de estado a centro_costo,
 * cambia esto a 'soft' y completa los 3 valores de abajo. El botón
 * de la UI cambiará automáticamente su texto de "Eliminar" a "Anular".
 */
export const DELETE_STRATEGY: 'hard' | 'soft' = 'hard';
export const SOFT_DELETE_COLUMN: string | null = null; // ej: 'estado'
export const SOFT_DELETE_ACTIVE_VALUE: string | null = null; // ej: 'activo'
export const SOFT_DELETE_INACTIVE_VALUE: string | null = null; // ej: 'inactivo'

// ---------------------------------------------------------------
// FIELDS_CONFIG — definición de cada columna del centro de costo
// ---------------------------------------------------------------
export const FIELDS_CONFIG: CentroCostoFieldConfig[] = [
	{
		key: 'codigo',
		label: 'Código',
		tipo: 'text',
		required: true,
		maxLength: 50, // VARCHAR(50) en BD — no subir sin migrar la columna
		uppercase: true, // AJUSTAR: poner en false si el ERP permite minúsculas
		regex: /^[A-Z0-9_-]+$/,
		regexMessage: 'Solo letras mayúsculas, números, guion (-) y guion bajo (_)',
		// Ejemplo de máscara: quita espacios y fuerza mayúsculas mientras se escribe.
		// AJUSTAR al formato real que use el ERP (ej. forzar prefijo "CC-").
		mask: (raw) => raw.toUpperCase().replace(/\s+/g, ''),
		placeholder: 'CC-001',
		helpText: 'Identificador corto y único del centro de costo.',
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		key: 'nombre',
		label: 'Nombre',
		tipo: 'text',
		required: true,
		maxLength: 200, // VARCHAR(200) en BD
		uppercase: false,
		// Ejemplo de máscara: colapsa espacios dobles. AJUSTAR si se requiere otro formato.
		mask: (raw) => raw.replace(/\s{2,}/g, ' '),
		placeholder: 'Edificio Las Palmas - Torre A',
		helpText: 'Nombre descriptivo del centro de costo.',
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		key: 'tipo',
		label: 'Tipo',
		tipo: 'select',
		required: true,
		// Debe reflejar exactamente el CHECK (tipo IN (...)) de la tabla centro_costo — ver
		// centro_costo_vinculacion_migration.sql. 'proyecto'/'cliente'/'proveedor' se completan solos
		// (getOrCrearCentroCostoParaEntidad en este mismo service) cuando se crea esa entidad; se
		// listan aquí solo para que se vean con su label correcto en esta tabla, no para elegirlos a
		// mano — un centro con uno de esos 3 tipos sin su id_proyecto/id_cliente/id_proveedor
		// correspondiente no tiene sentido (ver chk_centro_costo_una_entidad).
		options: [
			{ value: 'obra', label: 'Obra' },
			{ value: 'consultoria', label: 'Consultoría' },
			{ value: 'area', label: 'Área' },
			{ value: 'otro', label: 'Otro' },
			{ value: 'proyecto', label: 'Proyecto (automático)' },
			{ value: 'cliente', label: 'Cliente (automático)' },
			{ value: 'proveedor', label: 'Proveedor (automático)' }
		],
		helpText: 'Clasificación del centro de costo. "Proyecto/Cliente/Proveedor" se generan solos al crear esa entidad — no los selecciones a mano aquí.',
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		key: 'monto_actual', // nombre real de la columna en BD (ver nota sobre el typo de los .sql arriba)
		label: 'Monto Actual',
		tipo: 'currency',
		required: true,
		min: 0.01, // AJUSTAR: representa ">0"; súbelo si el ERP exige un monto mínimo mayor.
		// Máscara: conserva solo dígitos y un único punto decimal, con máximo 2 decimales,
		// mientras el usuario escribe (el separador de miles solo se aplica al MOSTRAR el valor,
		// no mientras se edita, para no pelear con la posición del cursor).
		mask: (raw) => {
			let value = raw.replace(/[^\d.]/g, '');
			const parts = value.split('.');
			if (parts.length > 2) value = parts[0] + '.' + parts.slice(1).join('');
			const [intPart, decPart] = value.split('.');
			return decPart !== undefined ? `${intPart}.${decPart.slice(0, 2)}` : value;
		},
		regex: /^\d+(\.\d{1,2})?$/,
		regexMessage: 'Solo números, con máximo 2 decimales',
		placeholder: '0.00',
		helpText: 'Monto actual del centro de costo. Se muestra como S/ 1,234.56 en tabla y formulario.',
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		key: 'created_at',
		label: 'Creado',
		tipo: 'readonly',
		showInTable: true,
		showInForm: false, // se genera con DEFAULT NOW(), no se edita
		sortable: true,
		defaultSort: 'desc' // debe coincidir con DEFAULT_SORT_FIELD/DEFAULT_SORT_DIR de arriba
	}
];

// ---------------------------------------------------------------
// Helpers de validación (centralizados — los usan tanto el modal
// para validar en tiempo real, como el service en el servidor)
// ---------------------------------------------------------------

/** Valida un único campo según su definición en FIELDS_CONFIG. Devuelve el mensaje de error o null. */
export function validateField(field: CentroCostoFieldConfig, rawValue: unknown): string | null {
	if (field.tipo === 'readonly') return null;

	const value = rawValue === null || rawValue === undefined ? '' : String(rawValue).trim();

	if (field.required && value === '') {
		return `${field.label} es obligatorio`;
	}
	if (value === '') return null; // campo opcional vacío -> válido

	const isNumeric = field.tipo === 'number' || field.tipo === 'currency';
	if (isNumeric && Number.isNaN(Number(value))) {
		return `${field.label} debe ser un número`;
	}
	if (isNumeric && field.min !== undefined && Number(value) < field.min) {
		return `${field.label} debe ser mayor a ${field.min}`;
	}
	if (field.maxLength && value.length > field.maxLength) {
		return `${field.label} no puede superar ${field.maxLength} caracteres`;
	}
	if (field.regex && !field.regex.test(value)) {
		return field.regexMessage || `${field.label} tiene un formato inválido`;
	}
	if (field.tipo === 'select' && field.options && !field.options.some((o) => o.value === value)) {
		return `${field.label} tiene un valor no permitido`;
	}
	return null;
}

/** Valida un payload completo (objeto key -> valor) contra todos los campos editables. */
export function validateCentroCostoPayload(payload: Record<string, unknown>): Record<string, string> {
	const errors: Record<string, string> = {};
	for (const field of FIELDS_CONFIG) {
		if (!field.showInForm) continue;
		const message = validateField(field, payload[field.key]);
		if (message) errors[field.key] = message;
	}
	return errors;
}

/** Aplica uppercase + mask (en ese orden) a un valor crudo de input, según la config del campo. */
export function applyFieldMask(field: CentroCostoFieldConfig, raw: string): string {
	let value = raw;
	if (field.uppercase) value = value.toUpperCase();
	if (field.mask) value = field.mask(value);
	return value;
}

/** Devuelve el label legible de una opción de un select (para mostrar en la tabla). */
export function getOptionLabel(field: CentroCostoFieldConfig, value: unknown): string {
	const option = field.options?.find((o) => o.value === String(value));
	return option?.label ?? String(value ?? '');
}

const CURRENCY_FORMATTER = new Intl.NumberFormat('es-PE', {
	style: 'currency',
	currency: 'PEN',
	minimumFractionDigits: 2,
	maximumFractionDigits: 2
});

/** Formatea un monto como moneda (ej. "S/ 1,234.56"). AJUSTAR locale/currency si el ERP cambia de moneda. */
export function formatCurrency(value: unknown): string {
	const num = Number(value);
	if (value === null || value === undefined || value === '' || Number.isNaN(num)) return '—';
	return CURRENCY_FORMATTER.format(num);
}
