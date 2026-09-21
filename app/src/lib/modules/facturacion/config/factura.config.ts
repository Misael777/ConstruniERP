/**
 * =============================================================
 * CONFIGURACIÓN — Facturación (tabla factura + factura_detalle)
 * =============================================================
 *
 * Motor genérico de validación/máscara/moneda en $lib/shared/fieldConfig.ts.
 * Ver factura_migration.sql para el esquema real en BD.
 *
 * Documento INTERNO de facturación/valorización — no es un comprobante electrónico SUNAT (sin
 * serie/correlativo oficial, firma digital ni OSE). El folio (`FAC-0001`, ...) se autogenera
 * server-side vía secuencia + trigger (ver la migración), nunca se edita a mano.
 *
 * `id_proyecto`/`id_cliente` van con `showInForm:false`: FacturaModal.svelte los resuelve con un
 * selector de proyecto propio (no el <select> genérico) porque además necesita autocompletar
 * Cliente/RUC y cargar las partidas facturables de ese proyecto — mismo criterio que otros módulos
 * (ej. "Fraccionar este pago" en CuentaCobrarModal.svelte) de mezclar campos genéricos con una
 * sección totalmente custom. Igual quedan acá (con showInTable:true) para que la lista y el
 * ColumnFilterBar los traten como cualquier otra columna filtrable.
 *
 * `subtotal`/`monto_amortizacion`/`monto_retencion_garantia`/`monto_igv` NO están en este archivo:
 * se calculan siempre con calcularTotalesFactura (facturacion.service.ts) a partir de
 * factura_detalle + los porcentajes — nunca se escriben a mano, ni siquiera como campo oculto.
 */

import type { FieldConfig } from '$lib/shared/fieldConfig';

export const TABLE_NAME = 'factura';
export const PK_COLUMN = 'id_factura';
export const SEARCHABLE_COLUMNS = ['folio'] as const;
export const DEFAULT_PAGE_SIZE = 10;
export const DEFAULT_SORT_FIELD = 'created_at';
export const DEFAULT_SORT_DIR: 'asc' | 'desc' = 'desc';

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
		key: 'id_proyecto',
		label: 'Proyecto',
		tipo: 'select',
		optionsSource: 'proyecto',
		required: true,
		showInTable: true,
		showInForm: false, // resuelto con selector propio en FacturaModal.svelte, ver nota arriba
		sortable: false
	},
	{
		key: 'id_cliente',
		label: 'Cliente',
		tipo: 'select',
		optionsSource: 'cliente',
		required: true,
		showInTable: true,
		showInForm: false, // autocompletado desde el proyecto elegido, ver nota arriba
		sortable: false
	},
	{
		key: 'tipo_comprobante',
		label: 'Tipo de Comprobante',
		tipo: 'select',
		required: true,
		options: [
			{ value: 'factura', label: 'Factura' },
			{ value: 'boleta', label: 'Boleta' }
		],
		helpText: 'Boleta si el cliente no tiene RUC (persona natural con DNI).',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'tipo_factura',
		label: 'Tipo de Factura',
		tipo: 'select',
		required: true,
		// Reutiliza el vocabulario ya establecido en transaccion.config.ts para Ingreso de Obra
		// (Adelanto/Valorización) — "Extraordinario"/"Otro" son los únicos términos nuevos.
		options: [
			{ value: 'Adelanto', label: 'Adelanto' },
			{ value: 'Valorización', label: 'Valorización' },
			{ value: 'Extraordinario', label: 'Extraordinario' },
			{ value: 'Otro', label: 'Otro' }
		],
		showInTable: true,
		showInForm: true,
		sortable: false
	},
	{
		key: 'numero_valorizacion',
		label: 'N° de Valorización',
		tipo: 'number',
		min: 1,
		placeholder: 'Ej. 6',
		disabledWhen: (values) => String(values.tipo_factura ?? '') !== 'Valorización',
		requiredWhen: (values) => String(values.tipo_factura ?? '') === 'Valorización',
		helpText: 'Solo aplica si el Tipo de Factura es Valorización.',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'fecha_emision',
		label: 'Fecha Emisión',
		tipo: 'date',
		required: true,
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		key: 'fecha_vencimiento',
		label: 'Fecha Vencimiento',
		tipo: 'date',
		showInTable: false,
		showInForm: true,
		sortable: true
	},
	{
		key: 'moneda',
		label: 'Moneda',
		tipo: 'select',
		options: [
			{ value: 'PEN', label: 'Soles (PEN)' },
			{ value: 'USD', label: 'Dólares (USD)' }
		],
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'tipo_cambio',
		label: 'Tipo de Cambio',
		tipo: 'number',
		min: 0.01,
		mask: (raw) => raw.replace(/[^\d.]/g, '').replace(/(\..{2}).+/, '$1'),
		regex: /^\d+(\.\d{1,2})?$/,
		regexMessage: 'Solo números, con máximo 2 decimales',
		placeholder: '3.75',
		disabledWhen: (values) => String(values.moneda ?? 'PEN') !== 'USD',
		requiredWhen: (values) => String(values.moneda ?? 'PEN') === 'USD',
		helpText: 'Tipo de cambio del día (S/ por US$). Obligatorio si la moneda es Dólares.',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'porcentaje_amortizacion',
		label: 'Amortización de Anticipo (%)',
		tipo: 'number',
		min: 0,
		max: 100,
		mask: (raw) => raw.replace(/[^\d.]/g, '').replace(/(\..{2}).+/, '$1'),
		placeholder: '0.00',
		helpText: '% del subtotal que se descuenta por amortización de un adelanto ya cobrado antes.',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'porcentaje_retencion_garantia',
		label: 'Retención de Fondo de Garantía (%)',
		tipo: 'number',
		min: 0,
		max: 100,
		mask: (raw) => raw.replace(/[^\d.]/g, '').replace(/(\..{2}).+/, '$1'),
		placeholder: '0.00',
		helpText: '% del subtotal que se retiene como fondo de garantía hasta el cierre del proyecto.',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'comentarios',
		label: 'Comentarios o Notas',
		tipo: 'text',
		maxLength: 500,
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'monto_total',
		label: 'Monto Total',
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
			{ value: 'pendiente', label: 'Pendiente' },
			{ value: 'pagado', label: 'Pagado' },
			{ value: 'vencido', label: 'Vencido' },
			{ value: 'anulada', label: 'Anulada' }
		],
		optionColors: {
			borrador: '#64748b',
			pendiente: '#d97706',
			pagado: '#16a34a',
			vencido: '#dc2626',
			anulada: '#94a3b8'
		},
		helpText: 'Borrador/Anulada son propios de la factura. Pendiente/Pagado/Vencido se leen de la Cuenta por Cobrar vinculada una vez emitida.',
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
