/**
 * =============================================================
 * MOTOR GENÉRICO DE FIELDS_CONFIG (compartido entre módulos)
 * =============================================================
 *
 * Extraído del patrón usado primero en centro-costos (ver
 * app/src/lib/modules/centro-costos/config/centroCostos.config.ts).
 * Cualquier módulo nuevo que necesite un formulario/tabla dirigidos
 * por config (validación, máscara, moneda, opciones de select) debe
 * definir su propio arreglo de FieldConfig e importar estos helpers
 * en vez de reescribirlos.
 *
 * NOTA: centro-costos NO fue migrado a este archivo (para no arriesgar
 * el módulo ya probado); si se quiere unificar, es un cambio aparte.
 */

export type FieldType = 'text' | 'number' | 'currency' | 'select' | 'date' | 'readonly';

export interface FieldOption {
	value: string;
	label: string;
}

export interface FieldConfig {
	/** Nombre exacto de la columna en la tabla real de BD */
	key: string;
	/** Etiqueta visible en tabla/formulario */
	label: string;
	tipo: FieldType;
	required?: boolean;
	maxLength?: number;
	/** Valor numérico mínimo permitido (inclusive) para tipo 'number' | 'currency' */
	min?: number;
	/** Valor numérico máximo permitido (inclusive) para tipo 'number' | 'currency' */
	max?: number;
	/**
	 * Renderiza el input como texto plano (sin flechitas de spinner) aunque `tipo` sea 'number'.
	 * Útil para códigos cortos donde no tiene sentido un <input type="number"> (ej. cuenta_banco).
	 */
	renderAsText?: boolean;
	uppercase?: boolean;
	regex?: RegExp;
	regexMessage?: string;
	mask?: (rawValue: string) => string;
	/** Opciones estáticas para tipo 'select' (usar `optionsSource` si vienen de otra tabla) */
	options?: FieldOption[];
	/**
	 * Marca que las opciones de este select se cargan en runtime desde otra tabla
	 * (ej. clientes, proveedores). El +page.server.ts las resuelve y las pasa como
	 * `dynamicOptions[key]` al modal — ver cuentasCobrar.config.ts para un ejemplo.
	 */
	optionsSource?: string;
	placeholder?: string;
	helpText?: string;
	showInTable?: boolean;
	showInForm?: boolean;
	sortable?: boolean;
	defaultSort?: 'asc' | 'desc';
	/**
	 * Bloquea el campo (input deshabilitado, no se valida) cuando esta función devuelve true,
	 * evaluada contra el payload completo del formulario (para poder depender del valor de OTRO
	 * campo). Ej.: cuotas.disabledWhen = (v) => v.forma_pago === '1' (Contado).
	 */
	disabledWhen?: (payload: Record<string, unknown>) => boolean;
	/**
	 * Valor que toma el campo mientras está bloqueado por disabledWhen (en vez de vaciarse a null).
	 * Ej.: cuotas.disabledValue = '1' -> Contado siempre queda en "1 cuota" en vez de vacío.
	 */
	disabledValue?: string | number;
	/**
	 * Convierte el campo en "calculado": se muestra deshabilitado (no se escribe a mano), su valor
	 * se recalcula en vivo a partir del resto del payload, no se valida, y al guardar SIEMPRE se usa
	 * el resultado de esta función (nunca lo que traiga el formulario, para que no se pueda desincronizar).
	 * Ej.: monto_imponible.computeValue = (v) => Number(v.monto_comprometido) / 1.18.
	 */
	computeValue?: (payload: Record<string, unknown>) => string | number | null;
}

/** Valida un único campo según su definición. Devuelve el mensaje de error o null. */
export function validateField(field: FieldConfig, rawValue: unknown): string | null {
	if (field.tipo === 'readonly') return null;

	const value = rawValue === null || rawValue === undefined ? '' : String(rawValue).trim();

	if (field.required && value === '') {
		return `${field.label} es obligatorio`;
	}
	if (value === '') return null;

	const isNumeric = field.tipo === 'number' || field.tipo === 'currency';
	if (isNumeric && Number.isNaN(Number(value))) {
		return `${field.label} debe ser un número`;
	}
	if (isNumeric && field.min !== undefined && Number(value) < field.min) {
		return `${field.label} debe ser mayor a ${field.min}`;
	}
	if (isNumeric && field.max !== undefined && Number(value) > field.max) {
		return `${field.label} no puede superar ${field.max}`;
	}
	if (field.tipo === 'date' && Number.isNaN(new Date(value).getTime())) {
		return `${field.label} debe ser una fecha válida`;
	}
	if (field.maxLength && value.length > field.maxLength) {
		return `${field.label} no puede superar ${field.maxLength} caracteres`;
	}
	if (field.regex && !field.regex.test(value)) {
		return field.regexMessage || `${field.label} tiene un formato inválido`;
	}
	// Aplica a cualquier campo con `options` fijas, no solo tipo:'select' — un campo 'number' con
	// `options` (ej. un código SMALLINT mostrado como dropdown) también debe venir de esa lista.
	if (field.options && !field.options.some((o) => o.value === value)) {
		return `${field.label} tiene un valor no permitido`;
	}
	return null;
}

/** Valida un payload completo contra todos los campos editables (showInForm) de un FIELDS_CONFIG. */
export function validatePayload(fields: FieldConfig[], payload: Record<string, unknown>): Record<string, string> {
	const errors: Record<string, string> = {};
	for (const field of fields) {
		if (!field.showInForm) continue;
		if (field.disabledWhen?.(payload)) continue; // campo bloqueado: no se exige ni se valida
		if (field.computeValue) continue; // campo calculado: lo controla el sistema, no el usuario
		const message = validateField(field, payload[field.key]);
		if (message) errors[field.key] = message;
	}
	return errors;
}

/** Aplica uppercase + mask (en ese orden) a un valor crudo de input. */
export function applyFieldMask(field: FieldConfig, raw: string): string {
	let value = raw;
	if (field.uppercase) value = value.toUpperCase();
	if (field.mask) value = field.mask(value);
	return value;
}

/** Devuelve el label legible de una opción de un select, buscando primero en dynamicOptions. */
export function getOptionLabel(
	field: FieldConfig,
	value: unknown,
	dynamicOptions?: Record<string, FieldOption[]>
): string {
	const options = (field.optionsSource && dynamicOptions?.[field.key]) || field.options;
	const option = options?.find((o) => o.value === String(value));
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

/**
 * Traduce un error crudo de Postgres/PostgREST a un mensaje legible en español, usando FIELDS_CONFIG
 * para identificar a qué campo se refiere (ej. una violación de FK como "cuentas_pagar_id_presupuesto_fkey"
 * se traduce a "El valor ingresado en 'ID Presupuesto' no existe..."). Si no reconoce el error, devuelve
 * error.message tal cual llegó.
 */
export function translateSupabaseError(error: { code?: string; message?: string }, fields: FieldConfig[]): string {
	if (error.code === '23503' && error.message) {
		const match = error.message.match(/constraint "([a-z0-9_]+)_fkey"/i);
		const field = match ? fields.find((f) => match[1].endsWith(f.key)) : undefined;
		return field
			? `El valor ingresado en "${field.label}" no existe. Verifica el ID o déjalo vacío si no aplica.`
			: 'El valor ingresado hace referencia a un registro que no existe.';
	}
	if (error.code === '23514') {
		return 'El valor ingresado no cumple una regla de la base de datos (revisa las opciones permitidas).';
	}
	if (error.code === '23502') {
		return 'Falta completar un campo obligatorio.';
	}
	return error.message || 'Ocurrió un error inesperado.';
}

/** Máscara reutilizable para campos de moneda: solo dígitos + un punto decimal, máx. 2 decimales. */
export function currencyMask(raw: string): string {
	let value = raw.replace(/[^\d.]/g, '');
	const parts = value.split('.');
	if (parts.length > 2) value = parts[0] + '.' + parts.slice(1).join('');
	const [intPart, decPart] = value.split('.');
	return decPart !== undefined ? `${intPart}.${decPart.slice(0, 2)}` : value;
}

/** Convierte un payload de formulario (strings) a tipos escribibles en BD, según FIELDS_CONFIG. */
export function buildWritablePayload(fields: FieldConfig[], payload: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const field of fields) {
		if (!field.showInForm) continue;
		if (field.disabledWhen?.(payload)) {
			// Campo bloqueado -> usa disabledValue si se definió (ej. "1"), si no queda vacío. Nunca lo
			// que tenga el formulario, sin importar lo que el usuario haya escrito antes de bloquearse.
			result[field.key] = field.disabledValue ?? null;
			continue;
		}
		if (field.computeValue) {
			const computed = field.computeValue(payload);
			result[field.key] = computed === '' || computed === null || computed === undefined ? null : Number(computed);
			continue;
		}
		let value = payload[field.key];
		if (typeof value === 'string') value = value.trim();
		if ((field.tipo === 'number' || field.tipo === 'currency') && value !== '' && value !== undefined && value !== null) {
			value = Number(value);
		}
		result[field.key] = value === '' ? null : value;
	}
	return result;
}
