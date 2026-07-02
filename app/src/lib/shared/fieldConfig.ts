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
	if (field.tipo === 'date' && Number.isNaN(new Date(value).getTime())) {
		return `${field.label} debe ser una fecha válida`;
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

/** Valida un payload completo contra todos los campos editables (showInForm) de un FIELDS_CONFIG. */
export function validatePayload(fields: FieldConfig[], payload: Record<string, unknown>): Record<string, string> {
	const errors: Record<string, string> = {};
	for (const field of fields) {
		if (!field.showInForm) continue;
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
		let value = payload[field.key];
		if (typeof value === 'string') value = value.trim();
		if ((field.tipo === 'number' || field.tipo === 'currency') && value !== '' && value !== undefined && value !== null) {
			value = Number(value);
		}
		result[field.key] = value === '' ? null : value;
	}
	return result;
}
