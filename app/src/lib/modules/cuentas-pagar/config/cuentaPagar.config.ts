/**
 * =============================================================
 * CONFIGURACIÓN — Cuentas por Pagar (tabla cuentas_pagar)
 * =============================================================
 *
 * Motor genérico de validación/máscara/moneda en $lib/shared/fieldConfig.ts.
 * Este archivo solo define QUÉ campos tiene el formulario/tabla de cuentas_pagar.
 *
 * ESQUEMA REAL EN BD (verificado contra el schema cache de PostgREST):
 *   CREATE TABLE cuentas_pagar (
 *     id_cuenta_pagar     BIGSERIAL PRIMARY KEY,
 *     id_proveedor        BIGINT NOT NULL REFERENCES proveedor(id_proveedor),
 *     id_centro_costo     BIGINT REFERENCES centro_costo(id_centro_costo), -- agregada por migración (ver nota abajo)
 *     id_presupuesto      BIGINT REFERENCES presupuesto(id_presupuesto),
 *     id_partida          BIGINT REFERENCES partida(id_partida),
 *     tipo_documento      SMALLINT,
 *     num_documento       VARCHAR(20),
 *     monto_comprometido  NUMERIC NOT NULL,
 *     monto_pagado        NUMERIC NOT NULL,
 *     saldo_pendiente     NUMERIC NOT NULL,
 *     fotma_pago          SMALLINT,        -- OJO: typo real en BD ("fotma", falta la "r")
 *     categoria_gasto     SMALLINT,
 *     condicion_pago      VARCHAR(100),    -- OJO: sin tilde (distinto de "condición_pago" en cuentas_cobrar)
 *     responsable         VARCHAR(100),
 *     fecha_emision       DATE NOT NULL,
 *     fecha_vencimiento   DATE,
 *     fecha_pago_programada DATE,
 *     monto_imponible     NUMERIC NOT NULL,
 *     monto_igv           NUMERIC NOT NULL,
 *     detraccion          NUMERIC,
 *     monto_retencion     NUMERIC,
 *     estado              VARCHAR(20) DEFAULT 'pendiente', -- sin CHECK real, texto libre
 *     observacion         VARCHAR(200),    -- OJO: singular (distinto de "observaciones" en cuentas_cobrar)
 *     prioridad           VARCHAR(10),     -- agregada por migración, ver nota abajo ('alto'|'media'|'bajo')
 *     usuario_registro    VARCHAR(100),
 *     created_at          TIMESTAMPTZ DEFAULT NOW()
 *   );
 *
 * Notas importantes:
 * - `fotma_pago` está mal escrito en la BD real (falta la "r" de "forma"). Se usa tal cual como
 *   `key` — el label visible en la UI sí dice "Forma de Pago" correctamente.
 * - `condicion_pago` (sin tilde) y `observacion` (singular) son distintos, a propósito, de los
 *   nombres usados en cuentas_cobrar ("condición_pago" con tilde, "observaciones" plural) — no es
 *   un error de este archivo, así están definidas ambas tablas en la BD real.
 * - `monto_pagado`, `saldo_pendiente` y `estado` NO son editables (showInForm:false): los calcula
 *   cuentasPagar.service.ts (ver computeEstadoCuentaPagar) cada vez que se crea/edita la cuenta o
 *   se registra/elimina un pago — pagado si saldo=0, vencido si hoy pasó fecha_vencimiento o
 *   fecha_pago_programada, si no pendiente. Ya NO es una marca manual.
 * - `usuario_registro` NO está en FIELDS_CONFIG: se completa server-side con el usuario autenticado.
 * - `id_presupuesto` / `id_partida` son FK opcionales sin selector dinámico todavía (se digitan como
 *   número). AJUSTAR a 'select' con `optionsSource` si se necesita elegirlos desde una lista.
 * - `tipo_documento`, `fotma_pago` y `categoria_gasto` ya son 'select' con opciones fijas
 *   (`categoria_gasto` usa los códigos reales del PCGE clase 6, los demás son secuenciales sin
 *   catálogo oficial verificado — ver notas en cada campo).
 * - `id_centro_costo` se agregó vía migración manual (ALTER TABLE, ver transacciones.service.ts) para
 *   poder generar automáticamente una fila en `transaccion` (tipo 'egreso') cada vez que se registra
 *   un pago nuevo — ese centro de costo se usa como ORIGEN de la transacción (de ahí sale el gasto).
 *   Cuentas creadas ANTES de la migración quedan con id_centro_costo NULL: en ese caso la generación
 *   automática de la transacción simplemente se omite (no bloquea el registro del pago).
 */

import type { FieldConfig } from '$lib/shared/fieldConfig';
import { currencyMask } from '$lib/shared/fieldConfig';

export const TABLE_NAME = 'cuentas_pagar';
export const PK_COLUMN = 'id_cuenta_pagar';
export const SEARCHABLE_COLUMNS = ['num_documento', 'responsable', 'observacion'] as const;
export const DEFAULT_PAGE_SIZE = 10;
export const DEFAULT_SORT_FIELD = 'created_at';
export const DEFAULT_SORT_DIR: 'asc' | 'desc' = 'desc';

export const FIELDS_CONFIG: FieldConfig[] = [
	{
		key: 'id_proveedor',
		label: 'Proveedor',
		tipo: 'select',
		required: true,
		optionsSource: 'proveedor', // opciones cargadas en runtime desde la tabla proveedor, ver +page.svelte (client-side, sin servidor)
		showInTable: true,
		showInForm: true,
		sortable: false
	},
	{
		key: 'id_centro_costo',
		label: 'Centro de Costo',
		tipo: 'select',
		// Ya no es obligatorio (a pedido del usuario) — a pedido explícito, ofrece exactamente el mismo
		// conjunto que la pestaña "Centro de Costos" del submódulo homónimo (obra/consultoría/bolsa
		// general manuales + proyectos con venta cerrada), ver getCentroCostoOptionsSoloCentros en
		// transacciones.service.ts.
		optionsSource: 'centro_costo', // cargado en runtime desde la tabla centro_costo, ver +page.svelte
		helpText: 'Centro de costo al que se carga este gasto. Se usa como origen al generar automáticamente la transacción del pago.',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'id_presupuesto',
		label: 'ID Presupuesto',
		tipo: 'number', // FK numérica en BD; se renderiza como textbox (sin flechitas) vía renderAsText
		renderAsText: true,
		mask: (raw) => raw.replace(/\D/g, ''), // solo dígitos mientras se escribe
		regex: /^\d+$/,
		regexMessage: 'Solo dígitos',
		helpText: 'FK opcional a presupuesto.id_presupuesto. AJUSTAR a select si se necesita elegir de una lista.',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'id_partida',
		label: 'ID Partida',
		tipo: 'number',
		helpText: 'FK opcional a partida.id_partida. AJUSTAR a select si se necesita elegir de una lista.',
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
		key: 'tipo_documento',
		label: 'Tipo de Documento',
		tipo: 'number', // la columna en BD es SMALLINT; se renderiza como <select> porque trae `options`
		// Catálogo recortado a pedido del usuario (antes tenía 11 opciones) — mantenerlo sincronizado
		// con transaccion.config.ts, que reutiliza EXACTAMENTE este mismo catálogo (ver nota ahí).
		// Verificado contra datos reales: solo el código '1' (Factura) estaba en uso, así que este
		// recorte no deja ninguna fila existente con un valor huérfano.
		options: [
			{ value: '1', label: 'Factura' },
			{ value: '2', label: 'Boleta de venta' },
			{ value: '3', label: 'Recibo por Honorarios' },
			{ value: '4', label: 'Ticket' },
			{ value: '5', label: 'Autodetracción' },
			{ value: '6', label: 'Otros' }
		],
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'monto_comprometido',
		label: 'Monto Comprometido',
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
		key: 'monto_pagado',
		label: 'Pagado',
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
		// Calculado: monto_imponible = monto_comprometido / 1.18 (base sin IGV, IGV Perú = 18%).
		// AJUSTAR la tasa 1.18 aquí si el IGV cambia.
		key: 'monto_imponible',
		label: 'Monto Imponible',
		tipo: 'currency',
		computeValue: (v) => {
			const comprometido = Number(v.monto_comprometido);
			return Number.isFinite(comprometido) && v.monto_comprometido !== '' ? (comprometido / 1.18).toFixed(2) : '';
		},
		helpText: 'Se calcula solo: Monto Comprometido ÷ 1.18',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		// Calculado: monto_igv = monto_comprometido - monto_imponible.
		key: 'monto_igv',
		label: 'Monto IGV',
		tipo: 'currency',
		computeValue: (v) => {
			const comprometido = Number(v.monto_comprometido);
			if (!Number.isFinite(comprometido) || v.monto_comprometido === '') return '';
			// Resta el imponible YA REDONDEADO (no el valor crudo), para que Imponible + IGV
			// siempre cuadre exacto con el Monto Comprometido, sin desfases de centavos.
			const imponibleRedondeado = Number((comprometido / 1.18).toFixed(2));
			return (comprometido - imponibleRedondeado).toFixed(2);
		},
		helpText: 'Se calcula solo: Monto Comprometido − Monto Imponible',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		// Editable: porcentaje de detracción (ej. 4, 10, 12), NO un monto en soles.
		key: 'detraccion',
		label: 'Detracción (%)',
		tipo: 'number',
		min: 0,
		max: 100,
		placeholder: 'Ej. 4',
		helpText: 'Porcentaje de detracción (no un monto). Se usa para calcular la Retención.',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		// Calculado: monto_retencion = (monto_comprometido * detraccion) / 100.
		key: 'monto_retencion',
		label: 'Retención',
		tipo: 'currency',
		computeValue: (v) => {
			const comprometido = Number(v.monto_comprometido);
			const detraccionPct = Number(v.detraccion);
			if (!Number.isFinite(comprometido) || v.monto_comprometido === '') return '';
			if (!Number.isFinite(detraccionPct) || v.detraccion === '') return '';
			return ((comprometido * detraccionPct) / 100).toFixed(2);
		},
		helpText: 'Se calcula solo: (Monto Comprometido × Detracción) ÷ 100',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'fotma_pago', // nombre real de columna (typo en BD), ver nota arriba
		label: 'Forma de Pago',
		tipo: 'number', // la columna en BD es SMALLINT; se renderiza como <select> porque trae `options`
		options: [
			{ value: '1', label: 'Contado' },
			{ value: '2', label: 'Crédito' }
		],
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'frecuencia_pago',
		label: 'Frecuencia de Pago',
		tipo: 'select',
		// Default 'sin_periodicidad' al crear se aplica en CuentaPagarModal.svelte (buildInitialValues)
		// — FieldConfig no tiene un mecanismo de valor por defecto propio, mismo criterio que
		// "responsable" (prellenado con el usuario actual) en ese mismo archivo.
		options: [
			{ value: 'sin_periodicidad', label: 'Sin periodicidad' },
			{ value: 'mensual', label: 'Mensual' },
			{ value: 'quincenal', label: 'Quincenal' },
			{ value: 'semanal', label: 'Semanal' }
		],
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'fin_periodo_pago',
		label: 'Fin de Periodo de Pago',
		tipo: 'date',
		// Solo tiene sentido si la cuenta es recurrente — se bloquea (deshabilitado, no se valida) y se
		// limpia cuando Frecuencia de Pago = 'Sin periodicidad'.
		disabledWhen: (values) => String(values.frecuencia_pago ?? '') === 'sin_periodicidad',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'categoria_gasto',
		label: 'Categoría de Gasto',
		tipo: 'number', // la columna en BD es SMALLINT; se renderiza como <select> porque trae `options`
		// Códigos reales del PCGE (Plan Contable General Empresarial - Perú), clase 6: Gastos por Naturaleza.
		options: [
			{ value: '60', label: 'Compras' },
			{ value: '61', label: 'Variación de Inventarios' },
			{ value: '62', label: 'Gastos de Personal y Directores' },
			{ value: '63', label: 'Gastos de Servicios Prestados por Terceros' },
			{ value: '64', label: 'Gastos por Tributos' },
			{ value: '65', label: 'Otros Gastos de Gestión' },
			{ value: '66', label: 'Pérdida por Deterioro de Activos' },
			{ value: '67', label: 'Gastos Financieros' },
			{ value: '68', label: 'Valuación y Deterioro de Activos y Provisiones' },
			{ value: '69', label: 'Costos de Producción y Gastos por Función' }
		],
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		// `condicion_pago` (columna real, VARCHAR(100), sin tilde) se reutiliza aquí como "Número de
		// Cuotas": se guarda como texto numérico ("3", "6"...) porque la columna es texto libre, no
		// se migró a numérico. Si > 0 y forma de pago es Crédito, cuentasPagar.service.ts genera
		// automáticamente esa cantidad de registros en "pagos" (estado_pago='programado'), uno por
		// mes desde Fecha Emisión, topados a Fecha Vencimiento — ver generarCuotasProgramadas().
		key: 'condicion_pago', // sin tilde, distinto de cuentas_cobrar
		label: 'Número de Cuotas',
		tipo: 'text',
		maxLength: 3,
		mask: (raw) => raw.replace(/\D/g, ''), // solo dígitos mientras se escribe
		regex: /^\d+$/,
		regexMessage: 'Solo dígitos',
		// Se bloquea (deshabilitado, no se valida) y queda fijo en "1" cuando fotma_pago = '1'
		// (Contado) — un pago de contado es, por definición, una sola cuota.
		disabledWhen: (values) => String(values.fotma_pago ?? '') === '1',
		disabledValue: '1',
		placeholder: 'Ej. 3',
		helpText:
			'En Contado queda fijo en 1 (un solo pago). Si es Crédito y pones más de 1, se programan ' +
			'automáticamente esa cantidad de pagos futuros al guardar, uno por mes desde la Fecha ' +
			'Emisión, sin pasar la Fecha Vencimiento.',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'responsable',
		label: 'Responsable',
		tipo: 'select',
		optionsSource: 'empleado', // opciones cargadas en runtime desde la tabla empleados, ver +page.svelte
		// La columna sigue siendo VARCHAR(100) de texto libre (no una FK) — el valor guardado es el
		// nombre del empleado elegido, mismo formato que ya tenían los registros escritos a mano.
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
		key: 'fecha_pago_programada',
		label: 'Fecha Pago Programada',
		tipo: 'date',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		// Ya NO es editable a mano (showInForm:false): lo calcula computeEstadoCuentaPagar() en
		// cuentasPagar.service.ts — pagado si saldo_pendiente=0; vencido si hoy > fecha_vencimiento
		// o > fecha_pago_programada; si no, pendiente. `options` se mantiene para mostrar el label
		// del badge en la tabla (getOptionLabel lo usa ahí, independiente de showInForm).
		key: 'estado',
		label: 'Estado',
		tipo: 'select',
		options: [
			{ value: 'pendiente', label: 'Pendiente' },
			{ value: 'pagado', label: 'Pagado' },
			{ value: 'vencido', label: 'Vencido' }
		],
		showInTable: true,
		showInForm: false,
		sortable: true
	},
	{
		key: 'observacion', // singular, distinto de cuentas_cobrar
		label: 'Observación',
		tipo: 'text',
		maxLength: 200,
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		// Agregada por migración manual (ver cuentas_pagar_prioridad_migration.sql).
		key: 'prioridad',
		label: 'Prioridad',
		tipo: 'select',
		options: [
			{ value: 'alto', label: 'Alto' },
			{ value: 'media', label: 'Media' },
			{ value: 'bajo', label: 'Bajo' }
		],
		optionColors: {
			alto: '#dc2626', // red-600
			media: '#d97706', // amber-600
			bajo: '#16a34a' // green-600
		},
		showInTable: false,
		showInForm: true,
		sortable: false
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
