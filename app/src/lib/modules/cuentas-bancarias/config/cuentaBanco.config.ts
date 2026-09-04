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
 *     tipo_cuenta         VARCHAR(20) NOT NULL CHECK (tipo_cuenta IN ('corriente','ahorros','plazo_fijo','mancomunada','sueldo','efectivo')),
 *       -- 'efectivo' agregado por cuenta_banco_tipo_cuenta_efectivo_migration.sql — caja chica/fondo de
 *       -- efectivo en vez de una cuenta bancaria real (ver notas de numero_cuenta/nombre_banco abajo).
 *     tipo_moneda         VARCHAR(10) NOT NULL CHECK (tipo_moneda IN ('soles','dolares','otro')),
 *     cci_cuenta          VARCHAR(20),
 *     numero_tarjeta      VARCHAR(20),
 *     estado              VARCHAR(15) NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','inactiva','autorizada','no_autorizada')),
 *     usuario             VARCHAR(100),
 *     fecha_autorizacion  DATE,
 *     observacion         TEXT,
 *     created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *     saldo_inicial       NUMERIC(14,2) NOT NULL DEFAULT 0, -- ver cuenta_banco_saldo_migration.sql
 *     saldo_actual        NUMERIC(14,2) NOT NULL DEFAULT 0  -- ídem, solo lectura (ver nota abajo)
 *   );
 *
 * Notas:
 * - `usuario` NO está en FIELDS_CONFIG: se completa client-side con el nombre del usuario
 *   autenticado (ver CuentaBancoModal.svelte), igual que usuario_registro en otros módulos —
 *   no es editable a mano desde el formulario.
 * - `estado` combina dos cosas: si la cuenta está activa/inactiva en uso, y si está autorizada o no.
 *   No hay botón dedicado de "aprobar" (a diferencia de transaccion.aprobado) — se cambia como
 *   cualquier otro campo del formulario, junto con `fecha_autorizacion` y `observacion`.
 * - `saldo_inicial` se pide al crear Y al editar; `saldo_actual` es SIEMPRE derivado (saldo_inicial +
 *   neto de las transacciones reales que usan esta cuenta como cuente_origen/cuente_destino, ver
 *   recalcularSaldoCuentaBanco en cuentaBanco.service.ts) — nunca se escribe a mano.
 * - `tipo_cuenta = 'efectivo'` ("Cuenta Efectivo") — a pedido explícito del usuario: modela una caja
 *   chica/fondo de efectivo (no una cuenta bancaria real) dentro de la misma tabla, para que
 *   TransaccionModal.svelte pueda seguir tratándola como "una cuenta más" al elegir Cuenta Origen/
 *   Destino cuando el Medio de Pago es Efectivo (ver filtrarCuentasEfectivo en TransaccionModal.svelte,
 *   que filtra estas cuentas por la palabra "efectivo" en el label). Dos reglas ligadas a este tipo:
 *   `numero_cuenta` debe contener la palabra "efectivo" (o `titular_cuenta`, ver validateWhen abajo) y
 *   `nombre_banco` se bloquea forzado a "EFECTIVO" (no hay banco real de por medio).
 */

import type { FieldConfig } from '$lib/shared/fieldConfig';
import { currencyMask } from '$lib/shared/fieldConfig';

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
		sortable: true,
		// A pedido explícito del usuario: si Tipo de Cuenta = "Cuenta Efectivo", el Número de Cuenta (o
		// el Titular, ver abajo) debe dejar constancia de que es una cuenta de efectivo — mismo criterio
		// que ya usa TransaccionModal.svelte para filtrar estas cuentas (busca "efectivo" en el label).
		validateWhen: (v) => {
			if (v.tipo_cuenta !== 'efectivo') return null;
			const numero = String(v.numero_cuenta ?? '');
			const titular = String(v.titular_cuenta ?? '');
			if (/efectivo/i.test(numero) || /efectivo/i.test(titular)) return null;
			return 'Si el Tipo de Cuenta es "Cuenta Efectivo", el Número de Cuenta o el Titular de la Cuenta debe contener la palabra "efectivo".';
		}
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
		sortable: true,
		// A pedido explícito del usuario: una "Cuenta Efectivo" no tiene un banco real de por medio —
		// se bloquea y se fuerza a "EFECTIVO" en vez de dejarlo en blanco o a lo que hubiera antes.
		disabledWhen: (v) => v.tipo_cuenta === 'efectivo',
		disabledValue: 'EFECTIVO'
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
			{ value: 'sueldo', label: 'Cuenta Sueldo' },
			{ value: 'efectivo', label: 'Cuenta Efectivo' }
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
		// A pedido explícito del usuario: se pide al crear Y al editar. `saldo_actual` (ver más abajo)
		// siempre se deriva de este valor + el neto de las transacciones reales que usan esta cuenta como
		// origen/destino (ver recalcularSaldoCuentaBanco en cuentaBanco.service.ts) — nunca se escribe a
		// mano, así que editar este campo después de creada la cuenta SÍ recalcula saldo_actual, no lo
		// pisa directo.
		key: 'saldo_inicial',
		label: 'Saldo Inicial',
		tipo: 'currency',
		min: 0,
		mask: currencyMask,
		regex: /^\d+(\.\d{1,2})?$/,
		regexMessage: 'Solo números, con máximo 2 decimales',
		placeholder: '0.00',
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		// Solo lectura — lo mantiene recalcularSaldoCuentaBanco (ver cuentaBanco.service.ts), nunca se
		// escribe desde este formulario (showInForm:false lo excluye de validatePayload/
		// buildWritablePayload automáticamente). Arranca en 0 igual que saldo_inicial si la cuenta nunca
		// se modificó.
		key: 'saldo_actual',
		label: 'Saldo Actual',
		tipo: 'currency',
		showInTable: true,
		showInForm: false,
		sortable: true
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
