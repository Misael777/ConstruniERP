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
 *     factura_url                 TEXT,  -- agregada por migración, ver transaccion_factura_migration.sql
 *       -- factura/boleta de venta, adjunto SEPARADO y OPCIONAL del comprobante de pago
 *     aprobado                    BOOLEAN NOT NULL DEFAULT FALSE, -- agregada por migración, ver transaccion_aprobacion_migration.sql
 *     aprobado_por                VARCHAR(100),
 *     aprobado_en                 TIMESTAMPTZ,
 *     tipo_alcance                VARCHAR(10) NOT NULL DEFAULT 'externa' CHECK (tipo_alcance IN ('interna','externa')),
 *       -- agregada por migración, ver transaccion_tipo_alcance_migration.sql
 *     num_operacion               VARCHAR(30),  -- agregada por migración, ver transaccion_num_operacion_migration.sql
 *     tipo_gasto                  VARCHAR(50),  -- agregada por migración, ver transaccion_tipo_gasto_migration.sql
 *   );
 *
 * Notas importantes:
 * - `id_centro_costo_origen`/`id_centro_costo_destino` NO tienen FK real en la BD (se probó insertando
 *   IDs inexistentes y Postgres los aceptó) — a diferencia de `trans_detalle.id_partida`, que sí tiene
 *   FK real. Igual se muestran como 'select' con `optionsSource: 'centro_costo'` para que el usuario
 *   elija de la lista real de centros de costo (mejor UX), aunque la BD no lo obligue.
 * - `tipo` SÍ tiene CHECK real ('ingreso' | 'egreso'), confirmado insertando un valor inválido (Postgres
 *   lo rechazó con error 23514).
 * - `tipo_documento` reutiliza EXACTAMENTE el catálogo de cuentas_pagar.tipo_documento (6 opciones:
 *   Factura/Boleta de venta/Recibo por Honorarios/Ticket/Autodetracción/Otros — ver cuentaPagar.config.ts).
 *   `forma_pago` también reutiliza su propio catálogo compartido. Aquí la columna es VARCHAR(2) en vez
 *   de SMALLINT, así que se guardan como texto ('1'..'6') igual.
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
		// Toggle "Transacción Interna" / "Transacción Externa" — se renderiza aparte (widget propio,
		// no el <select> genérico) al inicio del formulario, ver TransaccionModal.svelte. Interna
		// fuerza y bloquea el campo `tipo` en 'transferencia' (ver más abajo); Externa deja el
		// formulario exactamente como funcionaba antes de agregar esto.
		key: 'tipo_alcance',
		label: 'Alcance de la Transacción',
		tipo: 'select',
		required: true,
		options: [
			{ value: 'interna', label: 'Transacción Interna' },
			{ value: 'externa', label: 'Transacción Externa' }
		],
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'id_centro_costo_origen',
		label: 'Centro de costo origen',
		tipo: 'select',
		required: true,
		optionsSource: 'centro_costo', // cargado en runtime desde la tabla centro_costo, ver +page.svelte
		showInTable: true,
		showInForm: true,
		sortable: false
	},
	{
		key: 'id_centro_costo_destino',
		label: 'Centro de costo destino',
		tipo: 'select',
		required: true,
		optionsSource: 'centro_costo',
		showInTable: true,
		showInForm: true,
		sortable: false
	},
	{
		// Posición intercambiada con 'fecha' (a pedido del usuario) — ver 'fecha' justo abajo.
		key: 'tipo',
		label: 'Tipo',
		tipo: 'select',
		options: [
			{ value: 'ingreso', label: 'Ingreso' },
			{ value: 'egreso', label: 'Egreso' },
			{ value: 'financiamiento', label: 'Financiamiento' },
			// 'financiamiento' y 'transferencia' se mantienen en `options` (no se borran) porque siguen
			// siendo valores válidos guardados en BD: 'transferencia' se autoselecciona y se bloquea
			// cuando "Alcance de la Transacción" = Interna (ver TransaccionModal.svelte), y ambos deben
			// poder traducirse a su label en badges/filtros de transacciones ya existentes. `optionsWhen`
			// de abajo es lo único que decide qué se OFRECE en el <select> manual — a pedido del usuario,
			// solo Egreso/Ingreso (con Egreso por defecto, ver buildInitialValues en TransaccionModal.svelte).
			{ value: 'transferencia', label: 'Transferencia' }
		],
		optionsWhen: () => [
			{ value: 'egreso', label: 'Egreso' },
			{ value: 'ingreso', label: 'Ingreso' }
		],
		showInTable: true,
		showInForm: true,
		sortable: true
	},
	{
		// Posición intercambiada con 'tipo' — ver arriba.
		key: 'fecha',
		label: 'Fecha (reconocida)',
		tipo: 'date',
		required: true,
		showInTable: true,
		showInForm: true,
		sortable: true,
		defaultSort: 'desc'
	},
	{
		// Catálogo de categorías por tipo de movimiento (definido por el usuario). `options` trae TODAS
		// las categorías, vigentes y viejas (para validar cualquier valor ya guardado y traducirlo a
		// label en tabla/badges); `optionsWhen` filtra cuáles se OFRECEN en el <select> del formulario
		// según el `tipo` elegido — ver TransaccionModal.svelte, que además limpia este campo cuando el
		// usuario cambia `tipo`.
		key: 'categoria',
		label: 'Categoría',
		tipo: 'select',
		options: [
			// Catálogo vigente (a pedido explícito del usuario) — Ingreso: Adelanto/Valorización/Abonos;
			// Egreso: Honorarios/Alquileres/Servicios/Subcontrata/Compras/Movilidad/Impuestos/Préstamo.
			{ value: 'Adelanto', label: 'Adelanto' },
			{ value: 'Valorización', label: 'Valorización' },
			{ value: 'Abonos', label: 'Abonos' },
			{ value: 'Honorarios', label: 'Honorarios' },
			{ value: 'Alquileres', label: 'Alquileres' },
			{ value: 'Servicios', label: 'Servicios' },
			{ value: 'Subcontrata', label: 'Subcontrata' },
			{ value: 'Compras', label: 'Compras' },
			{ value: 'Movilidad', label: 'Movilidad' },
			{ value: 'Impuestos', label: 'Impuestos' },
			{ value: 'Préstamo', label: 'Préstamo' },
			// Catálogo propio para proyectos de OBRA (código con prefijo "OBRA"/"SUP") — a pedido
			// explícito del usuario, distinto del genérico de arriba. Resuelto en TransaccionModal.svelte
			// (ver esProyectoDeObra/CATEGORIA_OBRA_INGRESO/CATEGORIA_OBRA_EGRESO), no acá en optionsWhen,
			// porque depende del Centro de Costo elegido (necesita consultar su proyecto vinculado), no
			// solo de `tipo`. Solo 'Adenda'/'Sub Contrata'/'Material'/'Equipos'/'Gastos generales' son
			// nuevos — el resto ('Adelanto', 'Valorización', 'Servicios', 'Honorarios', 'Compras',
			// 'Alquileres', 'Préstamo') ya estaban arriba.
			{ value: 'Adenda', label: 'Adenda' },
			{ value: 'Sub Contrata', label: 'Sub Contrata' },
			{ value: 'Material', label: 'Material' },
			{ value: 'Equipos', label: 'Equipos' },
			{ value: 'Gastos generales', label: 'Gastos generales' },
			// Catálogo propio para Centro de Costo "Corporativo" (tipo 'bolsa general') — resuelto en
			// TransaccionModal.svelte (ver esCorporativo/CATEGORIA_CORPORATIVO_INGRESO/
			// CATEGORIA_CORPORATIVO_EGRESO). Solo 'Inyecciones'/'Inversión' son nuevos — el resto ya
			// estaba arriba (Honorarios/Alquileres/Servicios/Préstamo/Compras/Movilidad/Impuestos).
			{ value: 'Inyecciones', label: 'Inyecciones' },
			{ value: 'Inversión', label: 'Inversión' },
			// Subcategorías del dropdown en cascada de Obra + Egreso y Corporativo + Egreso (ver
			// TIPOS_GASTO_OBRA/TIPOS_GASTO_CORPORATIVO en TransaccionModal.svelte) — el valor final que se
			// guarda en `categoria` es la subcategoría elegida (ej. "Acero 6mm"), no la categoría
			// principal, así que cada una tiene que estar acá o validateField la rechaza como "valor no
			// permitido" (ver fieldConfig.ts) y bloquea el botón Crear/Actualizar.
			{ value: 'Maestro de Obra Principal', label: 'Maestro de Obra Principal' },
			{ value: 'Movimiento Tierras', label: 'Movimiento Tierras' },
			{ value: 'Movimiento Desmonte', label: 'Movimiento Desmonte' },
			{ value: 'Transporte Madera y Puntales', label: 'Transporte Madera y Puntales' },
			{ value: 'Inspección de Obra', label: 'Inspección de Obra' },
			{ value: 'Alquiler de Herramientas', label: 'Alquiler de Herramientas' },
			{ value: 'Demolición', label: 'Demolición' },
			{ value: 'Oficial', label: 'Oficial' },
			{ value: 'Peón', label: 'Peón' },
			{ value: 'Ayudante', label: 'Ayudante' },
			{ value: 'Eléctrico', label: 'Eléctrico' },
			{ value: 'Otras Subcontratos', label: 'Otras Subcontratos' },
			{ value: 'Acero 3/4"', label: 'Acero 3/4"' },
			{ value: 'Acero 5/8"', label: 'Acero 5/8"' },
			{ value: 'Acero 1/2"', label: 'Acero 1/2"' },
			{ value: 'Acero 3/8"', label: 'Acero 3/8"' },
			{ value: 'Acero 8mm', label: 'Acero 8mm' },
			{ value: 'Acero 6mm', label: 'Acero 6mm' },
			{ value: 'Premezclado', label: 'Premezclado' },
			{ value: 'Ladrillo', label: 'Ladrillo' },
			{ value: 'Concreto', label: 'Concreto' },
			{ value: 'Arena', label: 'Arena' },
			{ value: 'Confitillo', label: 'Confitillo' },
			{ value: 'Piedra Chancada', label: 'Piedra Chancada' },
			{ value: 'Adhesivos Epóxicos', label: 'Adhesivos Epóxicos' },
			{ value: 'Otros Materiales', label: 'Otros Materiales' },
			{ value: 'Ensayos Laboratorio', label: 'Ensayos Laboratorio' },
			{ value: 'Multas', label: 'Multas' },
			{ value: 'Sindicato', label: 'Sindicato' },
			{ value: 'Portátil SSHH', label: 'Portátil SSHH' },
			{ value: 'SCTR', label: 'SCTR' },
			{ value: 'IGV', label: 'IGV' },
			{ value: 'Otros Servicios', label: 'Otros Servicios' },
			{ value: 'Residente', label: 'Residente' },
			{ value: 'Soma', label: 'Soma' },
			{ value: 'Calidad', label: 'Calidad' },
			{ value: 'Otros Honorarios', label: 'Otros Honorarios' },
			{ value: 'Compactadora', label: 'Compactadora' },
			{ value: 'Vibradora', label: 'Vibradora' },
			{ value: 'Winche', label: 'Winche' },
			{ value: 'Buggies', label: 'Buggies' },
			{ value: 'Otros Equipos', label: 'Otros Equipos' },
			{ value: 'EPPS', label: 'EPPS' },
			{ value: 'Festividad', label: 'Festividad' },
			{ value: 'Equipo de Seguridad', label: 'Equipo de Seguridad' },
			{ value: 'Malla Raschel', label: 'Malla Raschel' },
			{ value: 'Seguridad', label: 'Seguridad' },
			{ value: 'Otras Compras', label: 'Otras Compras' },
			{ value: 'Implementación de Oficina de Obra', label: 'Implementación de Oficina de Obra' },
			{ value: 'Implementación de Almacén', label: 'Implementación de Almacén' },
			{ value: 'Otros Gastos Generales', label: 'Otros Gastos Generales' },
			{ value: 'Administración', label: 'Administración' },
			{ value: 'Gestión de Obra', label: 'Gestión de Obra' },
			{ value: 'Coordinación de Obra', label: 'Coordinación de Obra' },
			{ value: 'Comercial', label: 'Comercial' },
			{ value: 'Marketing', label: 'Marketing' },
			{ value: 'Oficina Técnica', label: 'Oficina Técnica' },
			{ value: 'Oficina', label: 'Oficina' },
			{ value: 'Agua y Luz', label: 'Agua y Luz' },
			{ value: 'Mantenimiento Ascensor', label: 'Mantenimiento Ascensor' },
			{ value: 'Publicidad', label: 'Publicidad' },
			{ value: 'Emergencia', label: 'Emergencia' },
			{ value: 'Limpieza', label: 'Limpieza' },
			{ value: 'Tarjeta de Crédito Pierina', label: 'Tarjeta de Crédito Pierina' },
			{ value: 'Tarjeta de Primo de Willy', label: 'Tarjeta de Primo de Willy' },
			{ value: 'Comida', label: 'Comida' },
			{ value: 'Prospectos de Ventas', label: 'Prospectos de Ventas' },
			{ value: 'Producción', label: 'Producción' },
			{ value: 'Renta', label: 'Renta' },
			{ value: 'Tasas Muni', label: 'Tasas Muni' },
			{ value: 'Capacitación', label: 'Capacitación' },
			{ value: 'Mantenimiento Equipos', label: 'Mantenimiento Equipos' },
			{ value: 'Año Nuevo y Navidad', label: 'Año Nuevo y Navidad' },
			{ value: 'Implementación Oficina', label: 'Implementación Oficina' },
			// Catálogo anterior — ya no se ofrece en el <select> (ver optionsWhen abajo), se mantiene
			// acá solo para traducir a label cualquier transacción vieja que ya haya guardado uno de
			// estos valores (mismo criterio que 'transferencia'/'financiamiento' en el campo 'tipo').
			{ value: 'Consultoría', label: 'Consultoría' },
			{ value: 'Ingresos por Servicios', label: 'Ingresos por Servicios' },
			{ value: 'G. Operativos', label: 'G. Operativos' },
			{ value: 'G. Administrativos', label: 'G. Administrativos' },
			{ value: 'Materiales', label: 'Materiales' },
			{ value: 'Préstamos', label: 'Préstamos' },
			{ value: 'Inyección', label: 'Inyección' }
		],
		optionsWhen: (payload) => {
			const tipo = String(payload.tipo ?? '');
			if (tipo === 'ingreso') {
				return [
					{ value: 'Adelanto', label: 'Adelanto' },
					{ value: 'Valorización', label: 'Valorización' },
					{ value: 'Abonos', label: 'Abonos' }
				];
			}
			if (tipo === 'egreso') {
				return [
					{ value: 'Honorarios', label: 'Honorarios' },
					{ value: 'Alquileres', label: 'Alquileres' },
					{ value: 'Servicios', label: 'Servicios' },
					{ value: 'Subcontrata', label: 'Subcontrata' },
					{ value: 'Compras', label: 'Compras' },
					{ value: 'Movilidad', label: 'Movilidad' },
					{ value: 'Impuestos', label: 'Impuestos' },
					{ value: 'Préstamo', label: 'Préstamo' }
				];
			}
			if (tipo === 'financiamiento') {
				return [{ value: 'Préstamos', label: 'Préstamos' }];
			}
			if (tipo === 'transferencia') {
				return [
					{ value: 'Préstamo', label: 'Préstamo' },
					{ value: 'Inyección', label: 'Inyección' }
				];
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
		label: 'Monto (reconocido)',
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
		// A pedido del usuario: se lee sola del boucher vía OCR + regex, sin IA (ver ocrComprobante.ts),
		// mismo criterio que 'fecha'/'monto_total' — widget "reconocido" hecho a mano en
		// TransaccionModal.svelte (no el <select>/<input> genérico), junto a esos dos.
		key: 'num_operacion',
		label: 'N° de Operación',
		tipo: 'text',
		maxLength: 30,
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		// A pedido del usuario: solo aplica a Egreso en proyectos de Obra — 7 dropdowns propios en
		// "Otros campos" (uno por Categoría: Honorarios/Alquileres/Servicios/Sub Contrata/Compras/
		// Movilidad/Impuestos, ver TIPOS_GASTO_OBRA en TransaccionModal.svelte), que comparten esta
		// única columna. Sin `options` acá porque el catálogo depende de cuál de los 7 se usó — el
		// motor genérico solo necesita esto para incluirlo en el payload al guardar.
		key: 'tipo_gasto',
		label: 'Tipo de Gasto',
		tipo: 'text',
		maxLength: 50,
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'tipo_documento',
		label: 'Tipo de Documento',
		tipo: 'text', // columna VARCHAR(2); mismo catálogo que cuentas_pagar.tipo_documento (ver
		// cuentaPagar.config.ts) — recortado a pedido del usuario, mantener sincronizado si se ajusta allá.
		maxLength: 2,
		options: [
			{ value: '1', label: 'Factura' },
			{ value: '2', label: 'Boleta de venta' },
			{ value: '3', label: 'Recibo por Honorarios' },
			{ value: '4', label: 'Ticket' },
			{ value: '5', label: 'Autodetracción' },
			{ value: '6', label: 'Otros' },
			// Solo se ofrecen cuando "Alcance de la Transacción" = Interna, ver optionsWhen abajo.
			{ value: '7', label: 'Talonario' },
			{ value: '8', label: 'Boucher' }
		],
		// En Interna, un comprobante externo (factura/boleta/etc.) no aplica — solo talonario/boucher
		// internos. En Externa se mantiene el catálogo original de 6 — ver TransaccionModal.svelte,
		// que además limpia este campo cuando cambia el Alcance para no dejar un valor inválido.
		optionsWhen: (payload) => {
			if (String(payload.tipo_alcance ?? '') === 'interna') {
				return [
					{ value: '7', label: 'Talonario' },
					{ value: '8', label: 'Boucher' }
				];
			}
			return [
				{ value: '1', label: 'Factura' },
				{ value: '2', label: 'Boleta de venta' },
				{ value: '3', label: 'Recibo por Honorarios' },
				{ value: '4', label: 'Ticket' },
				{ value: '5', label: 'Autodetracción' },
				{ value: '6', label: 'Otros' }
			];
		},
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'num_documento',
		label: 'N° de Documento',
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
		label: 'Cuenta origen',
		tipo: 'text',
		maxLength: 20,
		placeholder: 'N° de cuenta o CCI',
		showInTable: false,
		showInForm: true,
		sortable: false
	},
	{
		key: 'cuente_destino',
		label: 'Cuenta destino',
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
		// Mismo criterio que comprobante_url: no editable por el motor genérico, se sube a Google
		// Drive y se completa desde TransaccionModal.svelte — a diferencia del comprobante, esta es
		// OPCIONAL (factura o boleta de venta del proveedor/cliente, distinta del boucher de pago).
		// Ver transaccion_factura_migration.sql.
		key: 'factura_url',
		label: 'Factura o boleta de venta',
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
		// Ya NO es un <select> manual (a pedido del usuario) — se calcula solo server-side
		// (resolveEstadoTransaccion en transacciones.service.ts): 'consulta' mientras el Alcance sea
		// Interna, 'anulado'/'activo' vía los botones Anular/Reactivar (solo admin, ver
		// TransaccionModal.svelte). showInForm:false lo saca de validatePayload/buildWritablePayload —
		// el motor genérico ya no lo toca, solo lo hacen esas dos vías explícitas.
		key: 'estado',
		label: 'Estado',
		tipo: 'select',
		options: [
			{ value: 'activo', label: 'Activo' },
			{ value: 'anulado', label: 'Anulado' },
			{ value: 'consulta', label: 'Consulta' }
		],
		showInTable: true,
		showInForm: false,
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
