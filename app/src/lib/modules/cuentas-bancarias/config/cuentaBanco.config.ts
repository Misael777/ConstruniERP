/**
 * =============================================================
 * CONFIGURACIÓN — Cuentas Bancarias (tabla cuenta_banco)
 * =============================================================
 *
 * Motor genérico de validación/máscara/moneda en $lib/shared/fieldConfig.ts.
 * Este archivo solo define QUÉ campos tiene el formulario/tabla de cuenta_banco.
 *
 * ESQUEMA REAL EN BD (ver cuenta_banco_migration.sql):
 *   CREATE TABLE cuenta_banco (
 *     id_cuenta_banco     BIGSERIAL PRIMARY KEY,
 *     numero_cuenta       VARCHAR(30) NOT NULL,
 *     titular_cuenta      VARCHAR(150) NOT NULL,
 *     nombre_banco        VARCHAR(100) NOT NULL,
 *     tipo_cuenta         VARCHAR(20) NOT NULL CHECK (tipo_cuenta IN ('corriente','ahorros','plazo_fijo','mancomunada','sueldo')),
 *     tipo_moneda         VARCHAR(10) NOT NULL CHECK (tipo_moneda IN ('soles','dolares','otro')),
 *     cci_cuenta          VARCHAR(20),
 *     numero_tarjeta      VARCHAR(20),
 *     estado              VARCHAR(15) NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','inactiva','autorizada','no_autorizada')),
 *     usuario             VARCHAR(100),
 *     fecha_autorizacion  DATE,
 *     observacion         TEXT,
 *     created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 *
 * Notas:
 * - `usuario` NO está en FIELDS_CONFIG: se completa client-side con el nombre del usuario
 *   autenticado (ver CuentaBancoModal.svelte), igual que usuario_registro en otros módulos —
 *   no es editable a mano desde el formulario.
 * - `estado` combina dos cosas: si la cuenta está activa/inactiva en uso, y si está autorizada o no.
 *   No hay botón dedicado de "aprobar" (a diferencia de transaccion.aprobado) — se cambia como
 *   cualquier otro campo del formulario, junto con `fecha_autorizacion` y `observacion`.
 */

import type { FieldConfig } from '$lib/shared/fieldConfig';

export const TABLE_NAME = 'cuenta_banco';
export const PK_COLUMN = 'id_cuenta_banco';
export const SEARCHABLE_COLUMNS = ['numero_cuenta', 'titular_cuenta', 'nombre_banco'] as const;
export const DEFAULT_PAGE_SIZE = 10;
export const DEFAULT_SORT_FIELD = 'created_at';
export const DEFAULT_SORT_DIR: 'asc' | 'desc' = 'desc';

export const FIELDS_CONFIG: FieldConfig[] = [
	{
		key: 'numero_cuenta',
		label: 'Número de Cuenta',
		tipo: 'text',
		required: true,
		maxLength: 30,
		placeholder: 'N° de cuenta',
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		key: 'titular_cuenta',
		label: 'Titular de la Cuenta',
		tipo: 'text',
		required: true,
		maxLength: 150,
		placeholder: 'Nombre del titular',
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		key: 'nombre_banco',
		label: 'Banco',
		tipo: 'text',
		required: true,
		maxLength: 100,
		placeholder: 'Nombre del banco',
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		key: 'tipo_cuenta',
		label: 'Tipo de Cuenta',
		tipo: 'select',
		required: true,
		options: [
			{ value: 'corriente', label: 'Cuenta Corriente' },
			{ value: 'ahorros', label: 'Cuenta Ahorros' },
			{ value: 'plazo_fijo', label: 'Cuenta a Plazo Fijo' },
			{ value: 'mancomunada', label: 'Cuenta Mancomunada' },
			{ value: 'sueldo', label: 'Cuenta Sueldo' }
		],
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		key: 'tipo_moneda',
		label: 'Tipo de Moneda',
		tipo: 'select',
		required: true,
		options: [
			{ value: 'soles', label: 'Soles' },
			{ value: 'dolares', label: 'Dólares' },
			{ value: 'otro', label: 'Otro' }
		],
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		key: 'cci_cuenta',
		label: 'CCI',
		tipo: 'text',
		maxLength: 20,
		mask: (raw) => raw.replace(/\D/g, ''),
		regex: /^\d*$/,
		regexMessage: 'Solo dígitos',
		placeholder: 'Código de cuenta interbancario (20 dígitos)',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'numero_tarjeta',
		label: 'Número de Tarjeta',
		tipo: 'text',
		maxLength: 20,
		mask: (raw) => raw.replace(/\D/g, ''),
		regex: /^\d*$/,
		regexMessage: 'Solo dígitos',
		placeholder: 'N° de tarjeta (opcional)',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'estado',
		label: 'Estado',
		tipo: 'select',
		required: true,
		options: [
			{ value: 'activa', label: 'Activa' },
			{ value: 'inactiva', label: 'Inactiva' },
			{ value: 'autorizada', label: 'Autorizada' },
			{ value: 'no_autorizada', label: 'No Autorizada' }
		],
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		key: 'fecha_autorizacion',
		label: 'Fecha de Autorización',
		tipo: 'date',
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		key: 'observacion',
		label: 'Observación',
		tipo: 'text',
		maxLength: 500,
		placeholder: 'Notas u observaciones',
		showInTable: false,
		showInForm: true,
		sortable: false
	}
];
