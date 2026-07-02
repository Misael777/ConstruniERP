/**
 * =============================================================
 * CONFIGURACIÓN — Cuentas por Pagar (tabla cuentas_pagar)
 * =============================================================
 *
 * Motor genérico de validación/máscara/moneda en $lib/shared/fieldConfig.ts.
 * Este archivo solo define QUÉ campos tiene el formulario/tabla de cuentas_pagar.
 *
 * ESQUEMA REAL EN BD (verificado contra el schema cache de PostgREST):
 *   CREATE TABLE cuentas_pagar (
 *     id_cuenta_pagar     BIGSERIAL PRIMARY KEY,
 *     id_proveedor        BIGINT NOT NULL REFERENCES proveedor(id_proveedor),
 *     id_presupuesto      BIGINT REFERENCES presupuesto(id_presupuesto),
 *     id_partida          BIGINT REFERENCES partida(id_partida),
 *     tipo_documento      SMALLINT,
 *     num_documento       VARCHAR(20),
 *     monto_comprometido  NUMERIC NOT NULL,
 *     monto_pagado        NUMERIC NOT NULL,
 *     saldo_pendiente     NUMERIC NOT NULL,
 *     fotma_pago          SMALLINT,        -- OJO: typo real en BD ("fotma", falta la "r")
 *     categoria_gasto     SMALLINT,
 *     condicion_pago      VARCHAR(100),    -- OJO: sin tilde (distinto de "condición_pago" en cuentas_cobrar)
 *     responsable         VARCHAR(100),
 *     fecha_emision       DATE NOT NULL,
 *     fecha_vencimiento   DATE,
 *     fecha_pago_programada DATE,
 *     monto_imponible     NUMERIC NOT NULL,
 *     monto_igv           NUMERIC NOT NULL,
 *     detraccion          NUMERIC,
 *     monto_retencion     NUMERIC,
 *     estado              VARCHAR(20) DEFAULT 'pendiente', -- sin CHECK real, texto libre
 *     observacion         VARCHAR(200),    -- OJO: singular (distinto de "observaciones" en cuentas_cobrar)
 *     usuario_registro    VARCHAR(100),
 *     created_at          TIMESTAMPTZ DEFAULT NOW()
 *   );
 *
 * Notas importantes:
 * - `fotma_pago` está mal escrito en la BD real (falta la "r" de "forma"). Se usa tal cual como
 *   `key` — el label visible en la UI sí dice "Forma de Pago" correctamente.
 * - `condicion_pago` (sin tilde) y `observacion` (singular) son distintos, a propósito, de los
 *   nombres usados en cuentas_cobrar ("condición_pago" con tilde, "observaciones" plural) — no es
 *   un error de este archivo, así están definidas ambas tablas en la BD real.
 * - `monto_pagado` y `saldo_pendiente` NO son editables (showInForm:false): se recalculan
 *   automáticamente en cuentasPagar.service.ts cada vez que se registra o elimina un pago.
 *   `estado` también se ajusta ahí, salvo que ya esté en "vencido" (marca manual).
 * - `usuario_registro` NO está en FIELDS_CONFIG: se completa server-side con el usuario autenticado.
 * - `id_presupuesto` / `id_partida` son FK opcionales sin selector dinámico todavía — AJUSTAR a
 *   'select' con `optionsSource` si se necesita elegirlos desde una lista en vez de digitar el ID.
 * - `tipo_documento`, `fotma_pago`, `categoria_gasto` son códigos SMALLINT sin tabla de catálogo —
 *   AJUSTAR a 'select' cuando el ERP defina esos catálogos.
 */

import type { FieldConfig } from '$lib/shared/fieldConfig';
import { currencyMask } from '$lib/shared/fieldConfig';

export const TABLE_NAME = 'cuentas_pagar';
export const PK_COLUMN = 'id_cuenta_pagar';
export const SEARCHABLE_COLUMNS = ['num_documento', 'responsable', 'observacion'] as const;
export const DEFAULT_PAGE_SIZE = 10;
export const DEFAULT_SORT_FIELD = 'created_at';
export const DEFAULT_SORT_DIR: 'asc' | 'desc' = 'desc';

export const FIELDS_CONFIG: FieldConfig[] = [
	{
		key: 'id_proveedor',
		label: 'Proveedor',
		tipo: 'select',
		required: true,
		optionsSource: 'proveedor', // opciones cargadas en runtime desde la tabla proveedor, ver +page.server.ts
		showInTable: true,
		showInForm: true,
		sortable: false
	},
	{
		key: 'id_presupuesto',
		label: 'ID Presupuesto',
		tipo: 'number',
		helpText: 'FK opcional a presupuesto.id_presupuesto. AJUSTAR a select si se necesita elegir de una lista.',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'id_partida',
		label: 'ID Partida',
		tipo: 'number',
		helpText: 'FK opcional a partida.id_partida. AJUSTAR a select si se necesita elegir de una lista.',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'num_documento',
		label: 'N° Documento',
		tipo: 'text',
		maxLength: 20,
		placeholder: 'F001-00123',
		showInTable: true,
		showInForm: true,
		sortable: false
	},
	{
		key: 'tipo_documento',
		label: 'Tipo Documento (código)',
		tipo: 'number',
		helpText: 'Código numérico sin catálogo definido aún. AJUSTAR a select cuando exista la tabla de referencia.',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'monto_comprometido',
		label: 'Monto Comprometido',
		tipo: 'currency',
		required: true,
		min: 0.01,
		mask: currencyMask,
		regex: /^\d+(\.\d{1,2})?$/,
		regexMessage: 'Solo números, con máximo 2 decimales',
		placeholder: '0.00',
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		key: 'monto_pagado',
		label: 'Pagado',
		tipo: 'currency',
		showInTable: true,
		showInForm: false, // se recalcula automáticamente, ver nota arriba
		sortable: true
	},
	{
		key: 'saldo_pendiente',
		label: 'Saldo Pendiente',
		tipo: 'currency',
		showInTable: true,
		showInForm: false,
		sortable: true
	},
	{
		key: 'monto_imponible',
		label: 'Monto Imponible',
		tipo: 'currency',
		required: true,
		min: 0,
		mask: currencyMask,
		regex: /^\d+(\.\d{1,2})?$/,
		regexMessage: 'Solo números, con máximo 2 decimales',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'monto_igv',
		label: 'Monto IGV',
		tipo: 'currency',
		required: true,
		min: 0,
		mask: currencyMask,
		regex: /^\d+(\.\d{1,2})?$/,
		regexMessage: 'Solo números, con máximo 2 decimales',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'detraccion',
		label: 'Detracción',
		tipo: 'currency',
		min: 0,
		mask: currencyMask,
		regex: /^\d+(\.\d{1,2})?$/,
		regexMessage: 'Solo números, con máximo 2 decimales',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'monto_retencion',
		label: 'Retención',
		tipo: 'currency',
		min: 0,
		mask: currencyMask,
		regex: /^\d+(\.\d{1,2})?$/,
		regexMessage: 'Solo números, con máximo 2 decimales',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'fotma_pago', // nombre real de columna (typo en BD), ver nota arriba
		label: 'Forma de Pago (código)',
		tipo: 'number',
		helpText: 'Código numérico sin catálogo definido aún. AJUSTAR a select cuando exista la tabla de referencia.',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'categoria_gasto',
		label: 'Categoría de Gasto (código)',
		tipo: 'number',
		helpText: 'Código numérico sin catálogo definido aún. AJUSTAR a select cuando exista la tabla de referencia.',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'condicion_pago', // sin tilde, distinto de cuentas_cobrar
		label: 'Condición de Pago',
		tipo: 'text',
		maxLength: 100,
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'responsable',
		label: 'Responsable',
		tipo: 'text',
		maxLength: 100,
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
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		key: 'fecha_pago_programada',
		label: 'Fecha Pago Programada',
		tipo: 'date',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'estado',
		label: 'Estado',
		tipo: 'select',
		options: [
			{ value: 'pendiente', label: 'Pendiente' },
			{ value: 'pagado', label: 'Pagado' },
			{ value: 'vencido', label: 'Vencido' }
		],
		helpText: 'Pendiente/Pagado se recalculan solos al registrar pagos. "Vencido" es una marca manual que se conserva.',
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		key: 'observacion', // singular, distinto de cuentas_cobrar
		label: 'Observación',
		tipo: 'text',
		maxLength: 200,
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'created_at',
		label: 'Creado',
		tipo: 'readonly',
		showInTable: true,
		showInForm: false,
		sortable: true,
		defaultSort: 'desc'
	}
];
