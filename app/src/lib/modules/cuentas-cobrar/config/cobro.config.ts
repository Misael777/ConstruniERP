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
 *     cuenta_banco       VARCHAR(20),  -- migrada de SMALLINT a VARCHAR(20) para guardar el N° de cuenta real
 *     numero_opracion    VARCHAR(20),  -- ver nota abajo
 *     usuario_registro   VARCHAR(100),
 *     referencia         VARCHAR(100),
 *     estado_cobro       VARCHAR(20) NOT NULL DEFAULT 'cobrado', -- agregada por migración (ver nota abajo)
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
 * - `medio_cobro` sigue siendo un código SMALLINT sin catálogo de referencia (opciones fijas, mismos
 *   códigos 1-4 que transaccion.medio_pago: Efectivo/Transferencia bancaria/Depósito/Yape o Plin) —
 *   AJUSTAR a 'select' con `optionsSource` si algún día existe una tabla real de medios de cobro.
 * - `estado_cobro` (agregada vía migración manual, mismo patrón que `pagos.estado_pago` en
 *   cuentas_pagar) NO está en FIELDS_CONFIG a propósito: se maneja aparte en CobroModal.svelte (select
 *   "Estado" que solo aparece en modo edición). Valores: 'programado' (cuota futura autogenerada desde
 *   "Número de Cuotas" de la cuenta, no cuenta para el saldo), 'cobrado' (cobro real, cuenta para el
 *   saldo), 'cancelado' (una 'programado' que el usuario canceló, tampoco cuenta para el saldo).
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
		label: 'Medio de Cobro',
		tipo: 'number', // la columna en BD es SMALLINT; se renderiza como <select> porque trae `options`
		// Mismos códigos 1-4 que transaccion.medio_pago (ver transaccion.config.ts) — construirPayloadTransaccionPorCobro
		// copia `medio_cobro` tal cual al crear la transacción de respaldo, así que los códigos deben
		// coincidir con ese catálogo, no solo la etiqueta.
		options: [
			{ value: '1', label: 'Efectivo' },
			{ value: '2', label: 'Transferencia bancaria' },
			{ value: '3', label: 'Depósito' },
			{ value: '4', label: 'Yape o Plin' }
		],
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'cuenta_banco',
		label: 'N° de Cuenta Bancaria',
		tipo: 'text',
		maxLength: 20, // la columna en BD se migró a VARCHAR(20) — cabe una cuenta normal o un CCI interbancario
		// Solo dígitos, espacios y guiones (formatos típicos al mostrar una cuenta, ej. "191-1234567-0-89").
		mask: (raw) => raw.replace(/[^\d\s-]/g, ''),
		regex: /^[\d\s-]+$/,
		regexMessage: 'Solo números, espacios y guiones',
		placeholder: 'Ej. 191-1234567-0-89 o CCI de 20 dígitos',
		helpText: 'Número de cuenta bancaria o CCI donde se recibió el cobro.',
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
