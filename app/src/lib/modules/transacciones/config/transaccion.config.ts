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
 *     created_at                  TIMESTAMPTZ DEFAULT NOW(),
 *     comprobante_url             TEXT,  -- agregada por migración, ver transaccion_comprobante_migration.sql
 *     aprobado                    BOOLEAN NOT NULL DEFAULT FALSE, -- agregada por migración, ver transaccion_aprobacion_migration.sql
 *     aprobado_por                VARCHAR(100),
 *     aprobado_en                 TIMESTAMPTZ
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
			{ value: 'egreso', label: 'Egreso' },
			{ value: 'financiamiento', label: 'Financiamiento' }
		],
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		// Catálogo de categorías por tipo de movimiento (definido por el usuario, ver mockup
		// "Movimientos de Caja y Financiamiento"). `options` trae las 7 completas (para validar
		// cualquier valor ya guardado y traducirlo a label en tabla/badges); `optionsWhen` filtra
		// cuáles se OFRECEN en el <select> del formulario según el `tipo` elegido — ver
		// TransaccionModal.svelte, que además limpia este campo cuando el usuario cambia `tipo`.
		key: 'categoria',
		label: 'Categoría',
		tipo: 'select',
		options: [
			{ value: 'Consultoría', label: 'Consultoría' },
			{ value: 'Ingresos por Servicios', label: 'Ingresos por Servicios' },
			{ value: 'G. Operativos', label: 'G. Operativos' },
			{ value: 'G. Administrativos', label: 'G. Administrativos' },
			{ value: 'Servicios', label: 'Servicios' },
			{ value: 'Materiales', label: 'Materiales' },
			{ value: 'Préstamos', label: 'Préstamos' }
		],
		optionsWhen: (payload) => {
			const tipo = String(payload.tipo ?? '');
			if (tipo === 'ingreso') {
				return [
					{ value: 'Consultoría', label: 'Consultoría' },
					{ value: 'Ingresos por Servicios', label: 'Ingresos por Servicios' }
				];
			}
			if (tipo === 'egreso') {
				return [
					{ value: 'G. Operativos', label: 'G. Operativos' },
					{ value: 'G. Administrativos', label: 'G. Administrativos' },
					{ value: 'Servicios', label: 'Servicios' },
					{ value: 'Materiales', label: 'Materiales' }
				];
			}
			if (tipo === 'financiamiento') {
				return [{ value: 'Préstamos', label: 'Préstamos' }];
			}
			return [];
		},
		helpText: 'Elige primero el Tipo — las categorías disponibles dependen de él.',
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
		// Columna real en BD sigue llamándose tipo_transaccion (no tenía catálogo ni uso definido) —
		// se reutiliza como "Número de Cuota": cuando la transacción se genera desde una cuota
		// programada de pagos/cobros, se prellena sola con la posición de esa cuota (1, 2, 3...) en
		// el calendario de la cuenta. En una transacción creada a mano, queda libre para digitar.
		key: 'tipo_transaccion',
		label: 'Número de Cuota',
		tipo: 'text',
		maxLength: 2,
		mask: (raw) => raw.replace(/\D/g, ''),
		regex: /^\d*$/,
		regexMessage: 'Solo dígitos',
		helpText: 'Se completa solo si esta transacción viene de una cuota programada de pagos/cobros.',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		// id_nombre ya NO es editable a mano: se completa solo con el nombre del usuario que inició
		// sesión en el ERP (permisosState.userName), igual que usuario_registro pero legible para
		// mostrar en vez del email — ver TransaccionModal.svelte y createTransaccion().
		key: 'id_nombre',
		label: 'Nombre',
		tipo: 'readonly',
		maxLength: 20,
		showInTable: false,
		showInForm: false,
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
		// No editable por el motor genérico (showInForm:false, mismo criterio que id_nombre): se sube a
		// Google Drive y se completa desde TransaccionModal.svelte (ver uploadComprobante) — createTransaccion/
		// updateTransaccion lo exigen (no-nulo) antes de guardar, ver transacciones.service.ts.
		key: 'comprobante_url',
		label: 'Comprobante',
		tipo: 'readonly',
		showInTable: false,
		showInForm: false,
		sortable: false
	},
	{
		// Solo se cambia vía aprobarTransaccion/desaprobarTransaccion (botón "Aprobar", solo admin) —
		// nunca por el formulario genérico. Ver transacciones.service.ts.
		key: 'aprobado',
		label: 'Aprobado',
		tipo: 'readonly',
		showInTable: true,
		showInForm: false,
		sortable: true
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
