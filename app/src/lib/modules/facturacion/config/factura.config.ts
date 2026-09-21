/**
 * =============================================================
 * CONFIGURACIÓN — Facturación (tabla factura + factura_detalle)
 * =============================================================
 *
 * Motor genérico de validación/máscara/moneda en $lib/shared/fieldConfig.ts.
 * Ver factura_migration.sql para el esquema real en BD.
 *
 * Factura en el formato real de Construni (FACTURA ELECTRÓNICA, serie E001), armada a partir de las
 * transacciones de ingreso ya cobradas de un cliente — documento INTERNO (sin firma digital ni OSE).
 * El folio (E001-00000001, ...) se autogenera server-side vía secuencia + trigger (ver la migración),
 * nunca se edita a mano.
 *
 * `id_cliente` va con `showInForm:false`: FacturaModal.svelte lo resuelve con su propio selector de
 * Cliente (que además autocompleta Señor(es)/RUC/Dirección y carga las transacciones de ese cliente) —
 * mismo criterio que otros módulos de mezclar campos genéricos con secciones custom. Igual queda acá
 * (showInTable:true) para que la lista y el ColumnFilterBar lo traten como cualquier otra columna.
 *
 * Los totales del formato (Sub Total Ventas, Valor Venta, IGV, Importe Total, detracción…) NO están
 * acá: se calculan siempre con calcularTotalesFactura (facturacion.service.ts) a partir de las líneas.
 * `sujeta_detraccion` se maneja como 'si'/'no' en el formulario (mismo patrón que `documento_pendiente`
 * en transaccion.config.ts) y el service lo convierte al BOOLEAN real al guardar.
 */

import type { FieldConfig } from '$lib/shared/fieldConfig';

export const TABLE_NAME = 'factura';
export const PK_COLUMN = 'id_factura';
export const SEARCHABLE_COLUMNS = ['folio', 'cliente_nombre'] as const;
export const DEFAULT_PAGE_SIZE = 10;
export const DEFAULT_SORT_FIELD = 'created_at';
export const DEFAULT_SORT_DIR: 'asc' | 'desc' = 'desc';

const soloDecimales = (raw: string) => raw.replace(/[^\d.]/g, '').replace(/(\..{2}).+/, '$1');

export const FIELDS_CONFIG: FieldConfig[] = [
	{
		key: 'folio',
		label: 'Folio',
		tipo: 'readonly',
		showInTable: true,
		showInForm: false,
		sortable: true
	},
	{
		key: 'fecha_emision',
		label: 'Fecha de Emisión',
		tipo: 'date',
		required: true,
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		key: 'id_cliente',
		label: 'Cliente',
		tipo: 'select',
		optionsSource: 'cliente',
		required: true,
		showInTable: true,
		showInForm: false, // selector propio en FacturaModal.svelte, ver nota arriba
		sortable: false
	},
	{
		key: 'forma_pago',
		label: 'Forma de pago',
		tipo: 'select',
		required: true,
		options: [
			{ value: 'contado', label: 'Contado' },
			{ value: 'credito', label: 'Crédito' }
		],
		showInTable: true,
		showInForm: true,
		sortable: false
	},
	{
		key: 'observacion',
		label: 'Observación',
		tipo: 'text',
		maxLength: 300,
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'sujeta_detraccion',
		label: 'Sujeta a detracción',
		tipo: 'select',
		options: [
			{ value: 'no', label: 'No' },
			{ value: 'si', label: 'Sí' }
		],
		helpText: 'Si es Sí, la factura incluye el bloque "Información de la detracción".',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'porcentaje_detraccion',
		label: 'Porcentaje de detracción (%)',
		tipo: 'number',
		min: 0.01,
		max: 100,
		mask: soloDecimales,
		placeholder: 'Ej. 12',
		disabledWhen: (values) => String(values.sujeta_detraccion ?? 'no') !== 'si',
		requiredWhen: (values) => String(values.sujeta_detraccion ?? 'no') === 'si',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'detraccion_bien_servicio',
		label: 'Bien o Servicio',
		tipo: 'text',
		maxLength: 200,
		placeholder: 'Ej. Servicios de construcción',
		disabledWhen: (values) => String(values.sujeta_detraccion ?? 'no') !== 'si',
		requiredWhen: (values) => String(values.sujeta_detraccion ?? 'no') === 'si',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'detraccion_medio_pago',
		label: 'Medio de pago (detracción)',
		tipo: 'select',
		options: [
			{ value: 'Depósito en cuenta', label: 'Depósito en cuenta' },
			{ value: 'Transferencia de fondos', label: 'Transferencia de fondos' }
		],
		disabledWhen: (values) => String(values.sujeta_detraccion ?? 'no') !== 'si',
		requiredWhen: (values) => String(values.sujeta_detraccion ?? 'no') === 'si',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'detraccion_cuenta_bn',
		label: 'N° Cta. Banco de la Nación',
		tipo: 'text',
		maxLength: 40,
		disabledWhen: (values) => String(values.sujeta_detraccion ?? 'no') !== 'si',
		requiredWhen: (values) => String(values.sujeta_detraccion ?? 'no') === 'si',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'monto_total',
		label: 'Importe Total',
		tipo: 'currency',
		showInTable: true,
		showInForm: false, // calculado, ver calcularTotalesFactura
		sortable: true
	},
	{
		key: 'estado',
		label: 'Estado',
		tipo: 'select',
		options: [
			{ value: 'borrador', label: 'Borrador' },
			{ value: 'emitida', label: 'Emitida' },
			{ value: 'anulada', label: 'Anulada' }
		],
		optionColors: {
			borrador: '#64748b',
			emitida: '#16a34a',
			anulada: '#94a3b8'
		},
		showInTable: true,
		showInForm: false,
		sortable: false
	},
	{
		key: 'created_at',
		label: 'Creado',
		tipo: 'readonly',
		showInTable: false,
		showInForm: false,
		sortable: true,
		defaultSort: 'desc'
	}
];
