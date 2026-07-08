/**
 * =============================================================
 * CONFIGURACIÓN — Transacciones (tabla transaccion)
 * =============================================================
 *
 * Motor genérico de validación/máscara/moneda en $lib/shared/fieldConfig.ts.
 * Este archivo solo define QUÉ campos tiene el formulario/tabla de transaccion.
 *
 * ESQUEMA REAL EN BD (verificado contra el schema cache de PostgREST, no solo DER2.sql):
 *   CREATE TABLE transaccion (
 *     id_transaccion            BIGSERIAL PRIMARY KEY,
 *     id_centro_costo_origen    BIGINT NOT NULL,   -- sin FK real (ver nota abajo)
 *     id_centro_costo_destino   BIGINT NOT NULL,   -- sin FK real (ver nota abajo)
 *     fecha                     DATE NOT NULL,
 *     id_nombre                 VARCHAR(20),
 *     tipo_documento             VARCHAR(2),
 *     num_documento              VARCHAR(20),
 *     tipo_transaccion           VARCHAR(2),
 *     forma_pago                 VARCHAR(2),
 *     descripcion                TEXT,
 *     tipo                       VARCHAR(20) CHECK (tipo IN ('ingreso','egreso')),
 *     monto_total                NUMERIC NOT NULL,
 *     medio_pago                 VARCHAR(2),
 *     cuente_origen               VARCHAR(20),   -- OJO: typo real en BD ("cuente", no "cuenta")
 *     cuente_destino              VARCHAR(20),   -- ídem
 *     estado                      VARCHAR(10),   -- sin CHECK real, texto libre (probado insertando valor arbitrario)
 *     usuario_registro            VARCHAR(100),
 *     created_at                  TIMESTAMPTZ DEFAULT NOW()
 *   );
 *
 * Notas importantes:
 * - `id_centro_costo_origen`/`id_centro_costo_destino` NO tienen FK real en la BD (se probó insertando
 *   IDs inexistentes y Postgres los aceptó) — a diferencia de `trans_detalle.id_partida`, que sí tiene
 *   FK real. Igual se muestran como 'select' con `optionsSource: 'centro_costo'` para que el usuario
 *   elija de la lista real de centros de costo (mejor UX), aunque la BD no lo obligue.
 * - `tipo` SÍ tiene CHECK real ('ingreso' | 'egreso'), confirmado insertando un valor inválido (Postgres
 *   lo rechazó con error 23514).
 * - `tipo_documento` y `forma_pago` reutilizan EXACTAMENTE los mismos catálogos ya usados en
 *   cuentas_cobrar/cuentas_pagar para los campos del mismo nombre (mismo criterio que se usó al
 *   construir cuentas_pagar: reusar el catálogo ya definido en vez de inventar uno nuevo). Aquí la
 *   columna es VARCHAR(2) en vez de SMALLINT, así que se guardan como texto ('1'..'11') igual.
 * - `medio_pago` reutiliza el catálogo de 4 opciones recién definido para `pagos.medio_pago`
 *   (Efectivo/Transferencia bancaria/Depósito bancario/Yape o Plin), pero codificado '1'-'4' porque
 *   aquí la columna es VARCHAR(2) (código), no texto libre como en `pagos.medio_pago`.
 * - `tipo_transaccion` e `id_nombre` no tienen catálogo ni significado documentado en ningún lado del
 *   proyecto — se dejan como texto libre corto en vez de inventar opciones sin base.
 * - `cuente_origen`/`cuente_destino` son cuentas bancarias en texto libre (mismo criterio que
 *   `cobros.cuenta_banco`), no un código.
 * - `usuario_registro` NO está en FIELDS_CONFIG: se completa client-side con el email del usuario
 *   autenticado (ver +page.svelte), igual que en cuentas_pagar/cuentas_cobrar.
 */

import type { FieldConfig } from '$lib/shared/fieldConfig';
import { currencyMask } from '$lib/shared/fieldConfig';

export const TABLE_NAME = 'transaccion';
export const PK_COLUMN = 'id_transaccion';
export const SEARCHABLE_COLUMNS = ['num_documento', 'descripcion', 'id_nombre'] as const;
export const DEFAULT_PAGE_SIZE = 10;
export const DEFAULT_SORT_FIELD = 'created_at';
export const DEFAULT_SORT_DIR: 'asc' | 'desc' = 'desc';

export const FIELDS_CONFIG: FieldConfig[] = [
	{
		key: 'id_centro_costo_origen',
		label: 'Centro de Costo Origen',
		tipo: 'select',
		required: true,
		optionsSource: 'centro_costo', // cargado en runtime desde la tabla centro_costo, ver +page.svelte
		showInTable: true,
		showInForm: true,
		sortable: false
	},
	{
		key: 'id_centro_costo_destino',
		label: 'Centro de Costo Destino',
		tipo: 'select',
		required: true,
		optionsSource: 'centro_costo',
		showInTable: true,
		showInForm: true,
		sortable: false
	},
	{
		key: 'fecha',
		label: 'Fecha',
		tipo: 'date',
		required: true,
		showInTable: true,
		showInForm: true,
		sortable: true,
		defaultSort: 'desc'
	},
	{
		key: 'tipo',
		label: 'Tipo',
		tipo: 'select',
		options: [
			{ value: 'ingreso', label: 'Ingreso' },
			{ value: 'egreso', label: 'Egreso' }
		],
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		key: 'monto_total',
		label: 'Monto Total',
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
		key: 'tipo_documento',
		label: 'Tipo de Documento',
		tipo: 'text', // columna VARCHAR(2); mismo catálogo que cuentas_cobrar/cuentas_pagar
		maxLength: 2,
		options: [
			{ value: '1', label: 'Factura' },
			{ value: '2', label: 'Boleta' },
			{ value: '3', label: 'Recibo por Honorarios' },
			{ value: '4', label: 'Liquidación de Compras' },
			{ value: '5', label: 'Ticket' },
			{ value: '6', label: 'Nota de Crédito' },
			{ value: '7', label: 'Guía de Remisión' },
			{ value: '8', label: 'Comprobante de Retención' },
			{ value: '9', label: 'Comprobante de Percepción' },
			{ value: '10', label: 'Recibo de Servicios' },
			{ value: '11', label: 'Boleta de Transporte' }
		],
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
		key: 'forma_pago',
		label: 'Forma de Pago',
		tipo: 'text', // columna VARCHAR(2); mismo catálogo que cuentas_cobrar/cuentas_pagar
		maxLength: 2,
		options: [
			{ value: '1', label: 'Contado' },
			{ value: '2', label: 'Crédito' }
		],
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'medio_pago',
		label: 'Medio de Pago',
		tipo: 'text', // columna VARCHAR(2); mismo catálogo recién definido para pagos.medio_pago, codificado
		maxLength: 2,
		options: [
			{ value: '1', label: 'Efectivo' },
			{ value: '2', label: 'Transferencia bancaria' },
			{ value: '3', label: 'Depósito bancario' },
			{ value: '4', label: 'Yape o Plin' }
		],
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'cuente_origen',
		label: 'Cuenta Origen',
		tipo: 'text',
		maxLength: 20,
		placeholder: 'N° de cuenta o CCI',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'cuente_destino',
		label: 'Cuenta Destino',
		tipo: 'text',
		maxLength: 20,
		placeholder: 'N° de cuenta o CCI',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'tipo_transaccion',
		label: 'Tipo de Transacción',
		tipo: 'text',
		maxLength: 2,
		helpText: 'Código libre (máx. 2 caracteres), sin catálogo definido todavía.',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'id_nombre',
		label: 'Nombre',
		tipo: 'text',
		maxLength: 20,
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'descripcion',
		label: 'Descripción',
		tipo: 'text',
		placeholder: 'Detalle del movimiento',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'estado',
		label: 'Estado',
		tipo: 'select',
		options: [
			{ value: 'activo', label: 'Activo' },
			{ value: 'anulado', label: 'Anulado' }
		],
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		key: 'created_at',
		label: 'Creado',
		tipo: 'readonly',
		showInTable: false,
		showInForm: false,
		sortable: true
	}
];
