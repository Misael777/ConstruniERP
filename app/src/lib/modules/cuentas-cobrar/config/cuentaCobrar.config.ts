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
 *     id_centro_costo    BIGINT REFERENCES centro_costo(id_centro_costo), -- agregada por migración (ver nota abajo)
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
 *     monto_dolares      NUMERIC,   -- agregada por migración, ver nota abajo
 *     tipo_cambio        NUMERIC(12,2), -- agregada por migración, ver nota abajo (hasta entero + 2 decimales)
 *     observaciones      VARCHAR(200),
 *     prioridad          VARCHAR(10), -- agregada por migración, ver nota abajo ('alto'|'medio'|'bajo')
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
 * - `tipo_documento` ya tiene su propio catálogo fijo de 5 opciones (Factura/Boleta de venta/Recibo
 *   por Honorarios/Ticket/Otro, ver el campo abajo) — distinto del catálogo de 11 de cuentas_pagar.
 * - `forma_pago`, "condición_pago" siguen siendo códigos SMALLINT sin tabla de referencia en el
 *   esquema actual — AJUSTAR: conviértelos a 'select' con `options` fijas (o `optionsSource`
 *   apuntando a una tabla de catálogo) en cuanto el ERP defina qué significa cada código.
 * - `id_centro_costo` se agregó vía migración manual (ALTER TABLE, ver transacciones.service.ts) para
 *   poder generar automáticamente una fila en `transaccion` (tipo 'ingreso') cada vez que se registra
 *   un cobro nuevo — ese centro de costo se usa como DESTINO de la transacción (ahí entra el ingreso).
 *   Cuentas creadas ANTES de la migración quedan con id_centro_costo NULL: en ese caso la generación
 *   automática de la transacción simplemente se omite (no bloquea el registro del cobro).
 * - `monto_dolares`/`tipo_cambio` se agregaron vía migración manual (ver
 *   cuentas_cobrar_dolares_migration.sql) para cuentas en USD. Se bloquean mutuamente con `monto`
 *   según `moneda` (ver campos abajo): con moneda='PEN', `monto` es el campo libre de siempre y
 *   estos dos quedan bloqueados/vacíos; con moneda='USD', estos dos se habilitan y `monto` se
 *   bloquea y se recalcula solo como monto_dolares × tipo_cambio (ver `disabledValue` como función
 *   en $lib/shared/fieldConfig.ts — un "computeValue condicional").
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
		optionsSource: 'cliente', // opciones cargadas en runtime desde la tabla cliente, ver +page.svelte (client-side, sin servidor)
		showInTable: true,
		showInForm: true,
		sortable: false
	},
	{
		key: 'id_centro_costo',
		label: 'Centro de Costo',
		tipo: 'select',
		required: true,
		optionsSource: 'centro_costo', // cargado en runtime desde la tabla centro_costo, ver +page.svelte
		helpText: 'Centro de costo que recibe este ingreso. Se usa como destino al generar automáticamente la transacción del cobro.',
		showInTable: false,
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
		label: 'Tipo de Documento',
		tipo: 'number', // la columna en BD es SMALLINT; se renderiza como <select> porque trae `options` (ver modal/motor genérico)
		required: false,
		// Catálogo propio de cuentas_cobrar (a pedido del usuario) — YA NO comparte el catálogo de
		// 11 opciones de cuentas_pagar (ver cuentaPagar.config.ts, que no cambió). Códigos secuenciales
		// 1-5 sin verificar contra SUNAT N.º 01. Todas las cuentas existentes ya usaban el valor '1'
		// (Factura), así que este recorte no deja ninguna fila con un valor huérfano.
		options: [
			{ value: '1', label: 'Factura' },
			{ value: '2', label: 'Boleta de venta' },
			{ value: '3', label: 'Recibo por Honorarios' },
			{ value: '4', label: 'Ticket' },
			{ value: '5', label: 'Otro' }
		],
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'monto',
		label: 'Valor de venta',
		tipo: 'currency',
		required: true,
		min: 0.01,
		mask: currencyMask,
		regex: /^\d+(\.\d{1,2})?$/,
		regexMessage: 'Solo números, con máximo 2 decimales',
		placeholder: '0.00',
		// Con moneda='USD' este campo se bloquea y se calcula solo (monto_dolares × tipo_cambio) —
		// ver disabledValue como función más abajo. Con moneda='PEN' (o vacío) queda libre como siempre.
		disabledWhen: (values) => String(values.moneda ?? '') === 'USD',
		disabledValue: (values) => {
			const dolares = Number(values.monto_dolares);
			const cambio = Number(values.tipo_cambio);
			return dolares > 0 && cambio > 0 ? Number((dolares * cambio).toFixed(2)) : null;
		},
		helpText: 'Con moneda Dólares, este monto se calcula solo (Monto en Dólares × Tipo de Cambio).',
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		key: 'monto_dolares',
		label: 'Monto en Dólares',
		tipo: 'currency',
		min: 0.01,
		mask: currencyMask,
		regex: /^\d+(\.\d{1,2})?$/,
		regexMessage: 'Solo números, con máximo 2 decimales',
		placeholder: '0.00',
		// Bloqueado salvo que la moneda sea Dólares; obligatorio solo en ese caso (ver requiredWhen).
		disabledWhen: (values) => String(values.moneda ?? '') !== 'USD',
		requiredWhen: (values) => String(values.moneda ?? '') === 'USD',
		helpText: 'Obligatorio si la moneda es Dólares.',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'tipo_cambio',
		label: 'Tipo de Cambio',
		tipo: 'number',
		min: 0.01,
		mask: (raw) => raw.replace(/[^\d.]/g, '').replace(/(\..{2}).+/, '$1'), // hasta 2 decimales
		regex: /^\d+(\.\d{1,2})?$/,
		regexMessage: 'Solo números, con máximo 2 decimales',
		placeholder: '3.75',
		disabledWhen: (values) => String(values.moneda ?? '') !== 'USD',
		requiredWhen: (values) => String(values.moneda ?? '') === 'USD',
		helpText: 'Tipo de cambio del día (S/ por US$). Obligatorio si la moneda es Dólares.',
		showInTable: false,
		showInForm: true,
		sortable: false
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
		label: 'Forma de Pago',
		tipo: 'number', // la columna en BD es SMALLINT; se renderiza como <select> porque trae `options`
		// Antes era Contado(1)/Crédito(2). Crédito se renombra a Fraccionado (mismo código '2', mismo
		// comportamiento: habilita Número de Cuotas y genera cuotas iguales) y se agrega Por Porcentaje
		// ('3') que por ahora se comporta igual que Fraccionado — el reparto por porcentaje real queda
		// pendiente para un pedido futuro.
		options: [
			{ value: '1', label: 'Contado' },
			{ value: '2', label: 'Fraccionado' },
			{ value: '3', label: 'Por Porcentaje' }
		],
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'condición_pago', // nombre real de columna con tilde, ver nota arriba
		label: 'Número de Cuotas',
		tipo: 'number',
		min: 1,
		placeholder: 'Ej. 3',
		// Se bloquea (deshabilitado, no se valida, se guarda como null) cuando forma_pago = '1' (Contado).
		// AJUSTAR: si más adelante quieres exigirlo cuando es Crédito, agrega required condicional aparte.
		disabledWhen: (values) => String(values.forma_pago ?? '') === '1',
		helpText: 'Solo aplica si la forma de pago es Crédito. Se bloquea automáticamente en Contado.',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'responsable',
		label: 'Responsable',
		tipo: 'select',
		optionsSource: 'empleado', // opciones cargadas en runtime desde la tabla empleados, ver +page.svelte
		// La columna sigue siendo VARCHAR de texto libre (no una FK) — el valor guardado es el nombre
		// del empleado elegido. Ensanchada de VARCHAR(20) a VARCHAR(100) vía migración (ver
		// responsable_varchar_migration.sql) porque 20 no alcanza para un nombre completo real, y con
		// el dropdown ya no hay forma de escribir una versión abreviada a mano.
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
		// Agregada por migración manual (ver cuentas_cobrar_prioridad_migration.sql).
		key: 'prioridad',
		label: 'Prioridad',
		tipo: 'select',
		options: [
			{ value: 'alto', label: 'Alto' },
			{ value: 'medio', label: 'Medio' },
			{ value: 'bajo', label: 'Bajo' }
		],
		optionColors: {
			alto: '#dc2626', // red-600
			medio: '#d97706', // amber-600
			bajo: '#16a34a' // green-600
		},
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
