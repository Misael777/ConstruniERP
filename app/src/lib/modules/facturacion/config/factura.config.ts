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

import type { FieldConfig, FieldOption } from '$lib/shared/fieldConfig';
import { DETRACCION_TIPOS_OPERACION, DETRACCION_BIENES_SERVICIOS, DETRACCION_CODIGOS_BIEN_SERVICIO, DETRACCION_MEDIOS_PAGO } from './detraccionCatalogos';

export const TABLE_NAME = 'factura';
export const PK_COLUMN = 'id_factura';
export const SEARCHABLE_COLUMNS = ['folio', 'cliente_nombre'] as const;
export const DEFAULT_PAGE_SIZE = 20;
export const DEFAULT_SORT_FIELD = 'created_at';
export const DEFAULT_SORT_DIR: 'asc' | 'desc' = 'desc';

const soloDecimales = (raw: string) => raw.replace(/[^\d.]/g, '').replace(/(\..{2}).+/, '$1');

/** "Tipo de nota de crédito" (lista entregada por el usuario, en su orden). El valor guardado es el código del
 * catálogo SUNAT N° 09 (Tipo de nota de crédito electrónica). */
export const TIPOS_NOTA_CREDITO: FieldOption[] = [
	{ value: '01', label: 'Anulación de la Operación' },
	{ value: '02', label: 'Anulación por Error en el RUC' },
	{ value: '04', label: 'Descuento Global' },
	{ value: '06', label: 'Devolución Total' },
	{ value: '03', label: 'Corrección por error en la descripción' },
	{ value: '07', label: 'Devolución por ítem' },
	{ value: '05', label: 'Descuento por ítem' },
	{ value: '08', label: 'Bonificación' },
	{ value: '09', label: 'Disminución en el valor' },
	{ value: '11', label: 'Ajuste de operaciones de exportación' },
	{ value: '10', label: 'Otros Conceptos' },
	{ value: '13', label: 'Ajustes – montos y/o fechas de pago' }
];

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
		key: 'tipo_nota',
		label: 'Tipo de nota de crédito',
		tipo: 'select',
		options: TIPOS_NOTA_CREDITO,
		// Solo aplica a Nota de Crédito: FacturaModal lo oculta en los demás comprobantes y lo vuelve
		// obligatorio en Nota de Crédito (esta config no conoce el tipo de comprobante).
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'folio_referencia',
		label: 'Número de FE respecto de la cual se emite la Nota de Crédito',
		tipo: 'text',
		maxLength: 20,
		// Solo "Anulación por Error en el RUC": FacturaModal los muestra (con serie/número separados) y los
		// vuelve obligatorios únicamente en ese caso.
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'folio_nueva_factura',
		label: 'Número de la Nueva Factura Electrónica',
		tipo: 'text',
		maxLength: 20,
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
		key: 'detraccion_tipo_operacion',
		label: 'Tipo de operación',
		tipo: 'select',
		// Catálogo SUNAT (ver detraccionCatalogos.ts). Se guarda el código ('1001', ...).
		options: DETRACCION_TIPOS_OPERACION.map((t) => ({ value: t.codigo, label: t.nombre })),
		disabledWhen: (values) => String(values.sujeta_detraccion ?? 'no') !== 'si',
		requiredWhen: (values) => String(values.sujeta_detraccion ?? 'no') === 'si',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'detraccion_bien_servicio',
		label: 'Bien o Servicio',
		tipo: 'select',
		// Se guarda el NOMBRE del bien/servicio (es lo que imprime el PDF y lo que ya guardaban las facturas
		// viejas en texto libre). Al elegirlo se propone su % de detracción — ver handleInput en
		// FacturaModal.svelte. Es independiente de "Código de Bien/Servicio" (otra lista de SUNAT).
		options: DETRACCION_BIENES_SERVICIOS.map((b) => ({ value: b.nombre, label: `${b.nombre} (${b.porcentaje}%)` })),
		disabledWhen: (values) => String(values.sujeta_detraccion ?? 'no') !== 'si',
		requiredWhen: (values) => String(values.sujeta_detraccion ?? 'no') === 'si',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'detraccion_codigo_bien',
		label: 'Código de Bien/Servicio sujeto a detracción',
		tipo: 'select',
		options: DETRACCION_CODIGOS_BIEN_SERVICIO.map((b) => ({ value: b.codigo, label: `${b.codigo} - ${b.nombre}` })),
		disabledWhen: (values) => String(values.sujeta_detraccion ?? 'no') !== 'si',
		requiredWhen: (values) => String(values.sujeta_detraccion ?? 'no') === 'si',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'detraccion_medio_pago',
		label: 'Medio de pago',
		tipo: 'select',
		// Catálogo SUNAT. Se guarda el NOMBRE (compatible con lo que ya guardaban las facturas viejas:
		// 'Depósito en cuenta' / 'Transferencia de fondos'), el código solo se muestra en la lista.
		options: DETRACCION_MEDIOS_PAGO.map((m) => ({ value: m.nombre, label: `${m.codigo} - ${m.nombre}` })),
		disabledWhen: (values) => String(values.sujeta_detraccion ?? 'no') !== 'si',
		requiredWhen: (values) => String(values.sujeta_detraccion ?? 'no') === 'si',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'detraccion_cuenta_bn',
		label: 'N° Cta. Banco de la Nación',
		tipo: 'select',
		// Opciones reales (cuentas ya registradas en Cuentas Bancarias cuyo banco es el Banco de la
		// Nación) inyectadas en runtime por FacturaModal.svelte — ver getCuentasBancoNacionOptions.
		options: [],
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
