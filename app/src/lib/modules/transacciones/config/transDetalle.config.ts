/**
 * Configuración del formulario "Detalle de Transacción" (tabla trans_detalle, hija de transaccion).
 *
 * ESQUEMA REAL EN BD (verificado contra el schema cache de PostgREST):
 *   CREATE TABLE trans_detalle (
 *     id_trans_detalle   BIGSERIAL PRIMARY KEY,
 *     id_transaccion     BIGINT NOT NULL REFERENCES transaccion(id_transaccion) ON DELETE CASCADE,
 *     id_partida         BIGINT REFERENCES partida(id_partida),   -- FK real (a diferencia de transaccion.id_centro_costo_*)
 *     cantidad           NUMERIC,
 *     precio_unitario    NUMERIC,
 *     monto_igv          NUMERIC,
 *     porc_detraccion    NUMERIC,
 *     monto_detraccion   NUMERIC,
 *     subtotal           NUMERIC GENERATED ALWAYS AS (cantidad * precio_unitario) STORED,
 *     usuario_registro   VARCHAR(100),
 *     created_at         TIMESTAMPTZ DEFAULT NOW()
 *   );
 *
 * Notas:
 * - `id_transaccion` NO está en FIELDS_CONFIG: se fija con la transacción seleccionada en la UI.
 * - `subtotal` es una columna GENERATED (calculada por Postgres como cantidad * precio_unitario) —
 *   confirmado probando un INSERT con `subtotal` explícito, que Postgres rechazó con el error
 *   "cannot insert a non-DEFAULT value into column" (428C9). Por eso aquí es showInForm:false: nunca
 *   se envía en el payload (buildWritablePayload ya la excluye al no tener showInForm:true), solo se
 *   lee de vuelta después del insert/update para mostrarla en la tabla.
 * - `usuario_registro` NO está en FIELDS_CONFIG: se completa client-side con el usuario autenticado.
 * - `id_partida` sí tiene FK real: se probó insertando un id_partida inexistente y Postgres lo rechazó
 *   (23503). Se muestra como 'select' con `optionsSource: 'partida'`.
 */

import type { FieldConfig } from '$lib/shared/fieldConfig';
import { currencyMask } from '$lib/shared/fieldConfig';

export const TABLE_NAME = 'trans_detalle';
export const PK_COLUMN = 'id_trans_detalle';
export const PARENT_FK_COLUMN = 'id_transaccion';

export const FIELDS_CONFIG: FieldConfig[] = [
	{
		key: 'id_partida',
		label: 'Partida',
		tipo: 'select',
		optionsSource: 'partida',
		showInTable: true,
		showInForm: true,
		sortable: false
	},
	{
		key: 'cantidad',
		label: 'Cantidad',
		tipo: 'number',
		required: true,
		min: 0.0001,
		regex: /^\d+(\.\d{1,4})?$/,
		regexMessage: 'Solo números, con máximo 4 decimales',
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		key: 'precio_unitario',
		label: 'Precio Unitario',
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
		key: 'monto_igv',
		label: 'Monto IGV',
		tipo: 'currency',
		mask: currencyMask,
		placeholder: '0.00',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'porc_detraccion',
		label: '% Detracción',
		tipo: 'number',
		min: 0,
		max: 100,
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'monto_detraccion',
		label: 'Monto Detracción',
		tipo: 'currency',
		mask: currencyMask,
		placeholder: '0.00',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'subtotal',
		label: 'Subtotal',
		tipo: 'readonly', // GENERATED en BD (cantidad * precio_unitario), ver nota arriba
		showInTable: true,
		showInForm: false,
		sortable: false
	},
	{
		key: 'created_at',
		label: 'Registrado',
		tipo: 'readonly',
		showInTable: false,
		showInForm: false,
		sortable: false
	}
];
