/**
 * =============================================================
 * CONFIGURACIÓN — Cuentas por Cobrar (tabla cuentas_cobrar)
 * =============================================================
 *
 * Motor genérico de validación/máscara/moneda en $lib/shared/fieldConfig.ts.
 * Este archivo solo define QUÉ campos tiene el formulario/tabla de cuentas_cobrar.
 *
 * ESQUEMA REAL EN BD (verificado contra el schema cache de PostgREST, no solo DER2.sql):
 *   CREATE TABLE cuentas_cobrar (
 *     id_cuenta_cobrar   BIGSERIAL PRIMARY KEY,
 *     id_cliente         BIGINT NOT NULL REFERENCES cliente(id_cliente),
 *     id_proyecto        BIGINT REFERENCES proyecto(id_proyecto),
 *     tipo_documento     SMALLINT,
 *     num_documento      VARCHAR(50),
 *     monto              NUMERIC NOT NULL,
 *     monto_cobrado      NUMERIC NOT NULL,
 *     saldo_pendiente    NUMERIC NOT NULL,
 *     forma_pago         SMALLINT,
 *     "condición_pago"   SMALLINT,   -- OJO: nombre de columna con tilde, literal en BD
 *     responsable        VARCHAR(20),
 *     fecha_emision      DATE NOT NULL,
 *     fecha_vencimiento  DATE,
 *     moneda             VARCHAR(3),
 *     observaciones      VARCHAR(200),
 *     estado             VARCHAR(20) DEFAULT 'pendiente', -- sin CHECK real, texto libre
 *     usuario_registro   VARCHAR(100),
 *     created_at         TIMESTAMPTZ DEFAULT NOW()
 *   );
 *
 * Notas importantes:
 * - "condición_pago" tiene tilde en el nombre real de columna (confirmado vía OpenAPI de
 *   PostgREST). Se usa tal cual como `key` abajo — JS/TS soporta claves con tildes sin problema.
 * - `estado` NO tiene CHECK constraint en la BD real (se probó insertando un valor arbitrario y
 *   Postgres lo aceptó) — las 3 opciones del select de abajo son solo convención del ERP, no un
 *   límite impuesto por la BD.
 * - `monto_cobrado` y `saldo_pendiente` NO son editables en el formulario (showInForm: false):
 *   se recalculan automáticamente en cuentasCobrar.service.ts cada vez que se registra o elimina
 *   un cobro (ver recalcularCuentaCobrar). `estado` también se actualiza ahí a pendiente/pagado,
 *   salvo que ya esté en "vencido" (que se preserva porque es una marca manual, no derivada del saldo).
 * - `usuario_registro` NO está en FIELDS_CONFIG: se completa server-side con el email del usuario
 *   autenticado (ver +server.ts de creación), no es editable por el usuario.
 * - `tipo_documento`, `forma_pago`, "condición_pago" son códigos SMALLINT sin tabla de referencia
 *   en el esquema actual — AJUSTAR: conviértelos a 'select' con `options` fijas (o `optionsSource`
 *   apuntando a una tabla de catálogo) en cuanto el ERP defina qué significa cada código.
 */

import type { FieldConfig } from '$lib/shared/fieldConfig';
import { currencyMask } from '$lib/shared/fieldConfig';

export const TABLE_NAME = 'cuentas_cobrar';
export const PK_COLUMN = 'id_cuenta_cobrar';
export const SEARCHABLE_COLUMNS = ['num_documento', 'responsable', 'observaciones'] as const;
export const DEFAULT_PAGE_SIZE = 10;
export const DEFAULT_SORT_FIELD = 'created_at';
export const DEFAULT_SORT_DIR: 'asc' | 'desc' = 'desc';

export const FIELDS_CONFIG: FieldConfig[] = [
	{
		key: 'id_cliente',
		label: 'Cliente',
		tipo: 'select',
		required: true,
		optionsSource: 'cliente', // opciones cargadas en runtime desde la tabla cliente, ver +page.server.ts
		showInTable: true,
		showInForm: true,
		sortable: false
	},
	{
		key: 'id_proyecto',
		label: 'Proyecto',
		tipo: 'select',
		optionsSource: 'proyecto',
		helpText: 'Opcional: asocia esta cuenta a un proyecto.',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'num_documento',
		label: 'N° Documento',
		tipo: 'text',
		maxLength: 50,
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
		key: 'monto',
		label: 'Monto',
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
		key: 'monto_cobrado',
		label: 'Cobrado',
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
		key: 'forma_pago',
		label: 'Forma de Pago (código)',
		tipo: 'number',
		helpText: 'Código numérico sin catálogo definido aún. AJUSTAR a select cuando exista la tabla de referencia.',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'condición_pago', // nombre real de columna con tilde, ver nota arriba
		label: 'Condición de Pago (código)',
		tipo: 'number',
		helpText: 'Código numérico sin catálogo definido aún. AJUSTAR a select cuando exista la tabla de referencia.',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'responsable',
		label: 'Responsable',
		tipo: 'text',
		maxLength: 20,
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
		key: 'observaciones',
		label: 'Observaciones',
		tipo: 'text',
		maxLength: 200,
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
		helpText: 'Pendiente/Pagado se recalculan solos al registrar cobros. "Vencido" es una marca manual que se conserva.',
		showInTable: true,
		showInForm: true,
		sortable: true
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
