/**
 * Configuración del formulario "Registrar pago" (tabla pagos, hija de cuentas_pagar).
 *
 * ESQUEMA REAL EN BD:
 *   CREATE TABLE pagos (
 *     id_pago            BIGSERIAL PRIMARY KEY,
 *     id_cuenta_pagar    BIGINT NOT NULL REFERENCES cuentas_pagar(id_cuenta_pagar) ON DELETE CASCADE,
 *     monto              NUMERIC NOT NULL,
 *     fecha_pago         DATE NOT NULL,
 *     medio_pago         VARCHAR(50),   -- OJO: texto libre, no código numérico (distinto de cobros.medio_cobro)
 *     num_operacion      VARCHAR(20),
 *     usuario_registro   VARCHAR(100),
 *     referencia         VARCHAR(100),
 *     created_at         TIMESTAMPTZ DEFAULT NOW()
 *   );
 *
 * Notas:
 * - `id_cuenta_pagar` NO está en FIELDS_CONFIG: se fija con la cuenta seleccionada en la UI.
 * - `usuario_registro` NO está en FIELDS_CONFIG: se completa server-side con el usuario autenticado.
 * - `medio_pago` aquí es VARCHAR(50) de texto libre (a diferencia de `cobros.medio_cobro`, que es
 *   un código SMALLINT) — son tablas hermanas pero con este campo modelado distinto en la BD real.
 */

import type { FieldConfig } from '$lib/shared/fieldConfig';
import { currencyMask } from '$lib/shared/fieldConfig';

export const TABLE_NAME = 'pagos';
export const PK_COLUMN = 'id_pago';
export const PARENT_FK_COLUMN = 'id_cuenta_pagar';

export const FIELDS_CONFIG: FieldConfig[] = [
	{
		key: 'monto',
		label: 'Monto Pagado',
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
		key: 'fecha_pago',
		label: 'Fecha de Pago',
		tipo: 'date',
		required: true,
		showInTable: true,
		showInForm: true,
		sortable: true,
		defaultSort: 'desc'
	},
	{
		key: 'medio_pago',
		label: 'Medio de Pago',
		tipo: 'text',
		maxLength: 50,
		placeholder: 'Transferencia, efectivo, cheque...',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'num_operacion',
		label: 'N° Operación',
		tipo: 'text',
		maxLength: 20,
		showInTable: true,
		showInForm: true,
		sortable: false
	},
	{
		key: 'referencia',
		label: 'Referencia',
		tipo: 'text',
		maxLength: 100,
		showInTable: false,
		showInForm: true,
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
