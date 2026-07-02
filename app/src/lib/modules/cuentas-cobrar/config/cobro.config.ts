/**
 * Configuración del formulario "Registrar cobro" (tabla cobros, hija de cuentas_cobrar).
 *
 * ESQUEMA REAL EN BD:
 *   CREATE TABLE cobros (
 *     id_cobro           BIGSERIAL PRIMARY KEY,
 *     id_cuenta_cobrar   BIGINT NOT NULL REFERENCES cuentas_cobrar(id_cuenta_cobrar) ON DELETE CASCADE,
 *     monto              NUMERIC NOT NULL,
 *     fecha_cobro        DATE NOT NULL,
 *     medio_cobro        SMALLINT,
 *     num_operacion      VARCHAR(20),
 *     cuenta_banco       SMALLINT,
 *     numero_opracion    VARCHAR(20),  -- ver nota abajo
 *     usuario_registro   VARCHAR(100),
 *     referencia         VARCHAR(100),
 *     created_at         TIMESTAMPTZ DEFAULT NOW()
 *   );
 *
 * Notas:
 * - `id_cuenta_cobrar` NO está en FIELDS_CONFIG: se fija automáticamente con la cuenta
 *   seleccionada en la UI (no lo llena el usuario).
 * - `usuario_registro` NO está en FIELDS_CONFIG: se completa server-side con el usuario autenticado.
 * - La tabla tiene DOS columnas casi idénticas: `num_operacion` y `numero_opracion` (esta última con
 *   typo, falta la "e" de "operacion"). Parecen una columna duplicada por error de diseño. Se dejó
 *   fuera del formulario (`numero_opracion`) para no confundir con dos campos "N° de operación";
 *   si el ERP en verdad necesita ambas, agrégala aquí explícitamente.
 * - `medio_cobro` y `cuenta_banco` son códigos SMALLINT sin catálogo de referencia — AJUSTAR a
 *   'select' cuando exista esa tabla.
 */

import type { FieldConfig } from '$lib/shared/fieldConfig';
import { currencyMask } from '$lib/shared/fieldConfig';

export const TABLE_NAME = 'cobros';
export const PK_COLUMN = 'id_cobro';
export const PARENT_FK_COLUMN = 'id_cuenta_cobrar';

export const FIELDS_CONFIG: FieldConfig[] = [
	{
		key: 'monto',
		label: 'Monto Cobrado',
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
		key: 'fecha_cobro',
		label: 'Fecha de Cobro',
		tipo: 'date',
		required: true,
		showInTable: true,
		showInForm: true,
		sortable: true,
		defaultSort: 'desc'
	},
	{
		key: 'medio_cobro',
		label: 'Medio de Cobro (código)',
		tipo: 'number',
		helpText: 'Código numérico sin catálogo definido aún. AJUSTAR a select cuando exista la tabla de referencia.',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'cuenta_banco',
		label: 'Cuenta Banco (código)',
		tipo: 'number',
		helpText: 'Código numérico sin catálogo definido aún. AJUSTAR a select cuando exista la tabla de referencia.',
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
