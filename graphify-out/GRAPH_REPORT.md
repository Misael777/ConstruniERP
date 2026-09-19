# Graph Report - ConstruniERP  (2026-09-18)

## Corpus Check
- 405 files · ~476,537 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 55 file(s) not represented in the graph (top: (none) 18, .xml 11, .properties 6)

## Summary
- 2412 nodes · 4355 edges · 220 communities (122 shown, 98 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 147 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- API & Drive Client Utils
- Cuentas por Pagar & Transacciones Config
- Cuentas por Cobrar Config
- Google Drive Integration
- Comprobantes & Vouchers PDF
- Android Share Target (JNI)
- Panoramas de Pagos/Cobros
- Cobros & Panorama Config
- Core DB Schema (Proyectos)
- Panorama & Cuenta Modals UI
- Android Build Tooling (Tauri)
- Tauri Android Plugin SDK
- Share Target Desktop (Rust)
- Aprobaciones & Baja Logica
- Share Target Plugin Core (Rust)
- Ventas Dashboard & KPIs
- Movimientos de Caja
- Flujo de Proyecto (Doc Cliente)
- Proveedores & Ventas Tables
- Shared UI Components
- Cuentas Bancarias/Cobrar Handlers
- Release Build Script
- Plantillas de Partidas UI
- Navegacion & Permisos
- Empleados & Admin Auth
- OCR de Comprobantes
- Partidas Store (Gantt Tree)
- Financial Integrity RPC (SQL)
- Dashboard Financiero
- Gantt Planning Service
- Actualizaciones & Preview Drive
- NPM Dependencies
- App Build Dependencies
- Conciliacion Financiera
- Tauri Path Plugin (Android)
- Centro de Costos (SQL Migrations)
- Tickets Service
- Tauri JSObject Bridge (Android)
- Incidencias Control Financiero
- Cobros/Pagos SQL Migrations
- Centro de Costos Config
- Centro de Costos Service
- Cuentas Bancarias Config
- Tauri Plugin Annotations (Android)
- Control Financiero Checks
- Columnfilterbar
- Pluginhandle
- Index
- Index
- Scope Y Gantt
- Partidas
- Dashboard Proyectos De Obras
- Ppc Causas De Incumplimiento Modulo Proyectos
- +Page
- Logger
- Schema
- Schema
- Der2
- Tsconfig
- Control Financiero Migration
- Curva S Modulo De Proyectos
- Planmoduloticketsyreleases
- Schema
- Schema
- Dashboard Proyectos De Consultoria
- Rnc Razones De No Cumplimiento Modulo De Proyectos
- Permissionhelper
- Package
- Tree
- +Page
- Ticketmodal
- Cronograma Gantt Migration
- Package
- Presupuestomodule
- Codigoproyecto
- Releases.Service
- Movimientoscaja.Service
- Tickets
- Shareplugin
- Permissionstate
- Gantt Con Dependencias Modulo Proyectos
- Main Dashboard Modulo De Proyectos
- Exampleinstrumentedtest
- Teoriatransferencias
- Centrocostos.Service
- Centrocostomodal
- Transacciones.Service
- Aprobaciones De Documentos Modulo De Proyectos
- Gestion De Documentos Modulo De Proyectos
- Plantillas Para Flujos Proyectos De Consultoria
- Ticket Module Migration
- Anuncios.Service
- Trayectoria.Service
- Schema
- Schema
- Tauri.Conf
- Metodologia Last Planner
- Revision Proyectos Feedback Modulo Proyectos Obras
- Package
- +Page
- Desktop Updater
- Schema
- Bandeja De Pagos Pendientes
- Gestion De Partidas Con Progresos Modulo Proyectos
- Historico De Cumplimiento Modulo Proyecto Obras
- Solicitud Aprobacion Notificado Migration
- +Page
- Default
- Jsarray
- Schema
- Main
- Ppc Modulo Proyecto Obras
- Documento Proyecto Migration
- Apis
- Loggerhook
- Peruubigeo
- Pdftextoutil
- +Page
- Gradlew
- Tauri.Conf
- Tauri.Conf
- Tauri.Conf
- Package
- Scratch Logo Check
- Invalidpluginmethodexception
- Schema
- Svelte.Config
- +Page
- +Layout
- Mainactivity
- Build
- Vitest.Config
- Documento Proyecto Proforma Final Migration
- Fix Audit Trigger
- Transaccion Comprobante Pago Migration
- Transaccion Detalle Categoria Migration
- Anuncios Migration
- App.D
- Cuentabanco.Service
- +Page
- +Page
- Build.Gradle
- Reference
- Cargo
- App
- Cuenta Banco
- Cuenta Banco
- Cuenta Banco
- Cuenta Banco
- Presupuesto
- Documento Proyecto

## God Nodes (most connected - your core abstractions)
1. `[]` - 61 edges
2. `Plugin` - 43 edges
3. `Invoke` - 42 edges
4. `translateSupabaseError()` - 30 edges
5. `PluginManager` - 27 edges
6. `(app)/+layout.svelte (auth guard + app shell)` - 24 edges
7. `JSObject` - 23 edges
8. `validatePayload()` - 22 edges
9. `buildWritablePayload()` - 20 edges
10. `getClient()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `Ciclo de vida del ticket (resuelto → aprobado → release/cerrado)` --references--> `MODULE_REGISTRY`  [EXTRACTED]
  Documentacion/PlanModuloTicketsYReleases.md → app/src/lib/config/modules.ts
- `ConstruniERP README (root)` --semantically_similar_to--> `ConstruniERP Developer Manual`  [INFERRED] [semantically similar]
  README.md → DEVELOPER_MANUAL.md
- `Construni ERP UI Mockup (demo.html)` --semantically_similar_to--> `M9 Dashboards Globales`  [INFERRED] [semantically similar]
  demo.html → Documentacion/SCOPE_Y_GANTT.md
- `aplicarTransaccion()` --semantically_similar_to--> `Evento B: transferencia directa entre cuentas bancarias (B_m → B_n)`  [INFERRED] [semantically similar]
  app/scripts/html_ideas/dashboard_transacctions.html → Documentacion/TeoriaTransferencias.md
- `Construni ERP UI Mockup (demo.html)` --semantically_similar_to--> `Simulador Visual Tiempo+Nodos (dashboard_transacctions.html)`  [INFERRED] [semantically similar]
  demo.html → app/scripts/html_ideas/dashboard_transacctions.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Dar de baja / Ver eliminados / Borrado permanente — componentes compartidos** — claude_skills_dar_de_baja_pattern_skill_pattern, app_src_lib_shared_components_confirmmodal, app_src_lib_shared_components_adminconfirmmodal, app_src_lib_shared_adminauth_verifyadmincredentials [EXTRACTED 1.00]
- **Pipeline CI (automático) + CD (manual, release.mjs)** — github_workflows_ci_workflow, documentacion_mecanismocicd_flujo, scripts_release_mjs [EXTRACTED 1.00]
- **Flujo Ticket → Aprobación → Release (tickets.service + releases.service + release.mjs)** — documentacion_planmodulotickets_ticket_lifecycle, app_src_lib_modules_tickets_services_tickets_service, app_src_lib_modules_tickets_services_releases_service, scripts_release_mjs [EXTRACTED 1.00]

## Communities (220 total, 98 thin omitted)

### Community 0 - "API & Drive Client Utils"
Cohesion: 0.07
Nodes (48): fetchApi(), getBaseUrl(), parseJsonResponse(), resolveApiUrl(), deleteDriveFileClient(), downloadFromDriveClient(), downloadFromDriveClientStream(), getAccessToken() (+40 more)

### Community 1 - "Cuentas por Pagar & Transacciones Config"
Cohesion: 0.05
Nodes (37): buscarCuentasPagarVinculables(), if(), DEFAULT_PAGE_SIZE, DEFAULT_SORT_DIR, DEFAULT_SORT_FIELD, FIELDS_CONFIG, PK_COLUMN, SEARCHABLE_COLUMNS (+29 more)

### Community 2 - "Cuentas por Cobrar Config"
Cohesion: 0.06
Nodes (46): ListParams, DEFAULT_PAGE_SIZE, DEFAULT_SORT_DIR, DEFAULT_SORT_FIELD, FIELDS_CONFIG, PK_COLUMN, SEARCHABLE_COLUMNS, TABLE_NAME (+38 more)

### Community 3 - "Google Drive Integration"
Cohesion: 0.07
Nodes (36): server/config.ts (config privada + placeholder Google Drive), deleteDriveFile(), downloadDriveFile(), getDriveAccessToken(), getDriveFolderId(), googleDriveConfig, renameDriveFile(), uploadToDrive() (+28 more)

### Community 4 - "Comprobantes & Vouchers PDF"
Cohesion: 0.09
Nodes (45): construirHtmlCompleto(), construirVoucherHtml(), DatosComprobanteInterno, generarComprobanteTransferenciaInternaBase64(), renderVoucherComoImagen(), EMPRESA_NOMBRE, EMPRESA_RUC, formatCurrency() (+37 more)

### Community 5 - "Android Share Target (JNI)"
Cohesion: 0.06
Nodes (27): ActivityResult, activityresultcontracts, ActivityResultLauncher, JniMethod, Channel, ChannelDeserializer, RegisterListenerArgs, ActivityResultCallback (+19 more)

### Community 6 - "Panoramas de Pagos/Cobros"
Cohesion: 0.06
Nodes (33): BandejaParams, BandejaResult, BandejaSortBy, computeEstadoVencimiento(), computePrioridad(), cuentasCobrarConFracciones(), cuentasPagarConFracciones(), diasHastaVencimiento() (+25 more)

### Community 7 - "Cobros & Panorama Config"
Cohesion: 0.07
Nodes (39): getMontoRecibidoPorCentroCosto(), FIELDS_CONFIG, PARENT_FK_COLUMN, PK_COLUMN, TABLE_NAME, DEFAULT_PAGE_SIZE, DEFAULT_SORT_DIR, DEFAULT_SORT_FIELD (+31 more)

### Community 8 - "Core DB Schema (Proyectos)"
Cohesion: 0.08
Nodes (42): capture_instance_audit, acero_detalle, adelanto, contrato_proyecto, documento_proyecto, egreso_semanal, idx_acero_proyecto, idx_documento_proyecto_proyecto (+34 more)

### Community 9 - "Panorama & Cuenta Modals UI"
Cohesion: 0.06
Nodes (19): if(), handleInput(), hasErrors, mode, submitting, title, agregarFraccion(), errorGuardado (+11 more)

### Community 10 - "Android Build Tooling (Tauri)"
Cohesion: 0.08
Nodes (25): BuildTask, Config, RustPlugin, FsUtils, Context, Uri, applicationextension, AssetManager (+17 more)

### Community 11 - "Tauri Android Plugin SDK"
Cohesion: 0.08
Nodes (11): AppCompatActivity, Configuration, Intent, IntentSenderRequest, ObjectMapper, Uri, WebView, Plugin (+3 more)

### Community 12 - "Share Target Desktop (Rust)"
Cohesion: 0.06
Nodes (33): get_pending_share(), AppHandle, Option, PendingShare, R, Result, String, init() (+25 more)

### Community 13 - "Aprobaciones & Baja Logica"
Cohesion: 0.08
Nodes (24): CerrarVentaParams, ClienteDependencias, darDeBajaCliente(), darDeBajaVenta(), deleteClienteCascade(), EstadoSolicitud, getClienteDependencias(), restaurarCliente() (+16 more)

### Community 14 - "Share Target Plugin Core (Rust)"
Cohesion: 0.14
Nodes (31): init(), PendingShare, R, ShareTarget, String, ShareTargetExt, T, check_first_admin_available() (+23 more)

### Community 15 - "Ventas Dashboard & KPIs"
Cohesion: 0.06
Nodes (26): charts, closeModal(), confirmDarDeBajaOpen, confirmEliminarPermanenteOpen, confirmRestaurarOpen, date, day, eliminandoPermanente (+18 more)

### Community 16 - "Movimientos de Caja"
Cohesion: 0.06
Nodes (26): getCentroCostoTipoMap(), [], cuentaBancoSeleccionada, desde, egresosTotal, filasPagina, financiamientoCount, financiamientoTotal (+18 more)

### Community 17 - "Flujo de Proyecto (Doc Cliente)"
Cohesion: 0.09
Nodes (35): Detalle de Etapas del Flujo (tabla), Entregable: Memoria Descriptiva (MEM-01), Entregable: Plano Arquitectura (ARQ-01), Entregable: Plano Electrico (ELE-01), Entregable: Plano Estructuras (EST-01), Entregable: Plano Sanitario (SAN-01), Entregables asociados (panel), Etapa: Anteproyecto (+27 more)

### Community 18 - "Proveedores & Ventas Tables"
Cohesion: 0.10
Nodes (9): loadVentaParaEditar(), getCliente(), getFechaLocalHoy(), MobileFabAction, mobileFabState, setMobileFab(), setMobileFabActions(), handleEliminarPermanente() (+1 more)

### Community 19 - "Shared UI Components"
Cohesion: 0.10
Nodes (8): dismiss(), push(), { subscribe, update }, toast, ToastKind, ToastMessage, toasts, svelte

### Community 20 - "Cuentas Bancarias/Cobrar Handlers"
Cohesion: 0.14
Nodes (30): handleSubmit(), createCuentaBanco(), recalcularSaldoCuentaBanco(), updateCuentaBanco(), createCuentaCobrar(), cuentaTieneTransaccionAprobada(), deleteCuentaCobrar(), sincronizarCuotasProgramadas() (+22 more)

### Community 21 - "Release Build Script"
Cohesion: 0.08
Nodes (27): apkIdx, archivos, args, BUNDLE_DIR, fail(), firma, instaladorNombre, latestJson (+19 more)

### Community 22 - "Plantillas de Partidas UI"
Cohesion: 0.09
Nodes (8): app/README.md (boilerplate plantilla sv/SvelteKit), dragChildCount, opacity, sortedItems, title, hasSupabaseConfig, supabase, ConstruniERP README (root)

### Community 23 - "Navegacion & Permisos"
Cohesion: 0.13
Nodes (10): ADMIN_ROLE, getFirstAccessiblePath(), getRequiredPermiso(), MODULE_REGISTRY, ModuleItem, pendingShareState, hasPermiso(), loadPermisos() (+2 more)

### Community 24 - "Empleados & Admin Auth"
Cohesion: 0.15
Nodes (19): confirmActivation(), createUser(), darDeBajaEmpleado(), defaultAuthHeaders(), deleteUser(), fetchWithApiKey(), getUser(), getUserAdminUrl() (+11 more)

### Community 25 - "OCR de Comprobantes"
Cohesion: 0.16
Nodes (25): calcularConfianza(), calcularUmbralOtsu(), cargarImagen(), extraerFecha(), extraerMoneda(), extraerMonto(), extraerMontoFactura(), extraerMontoOperacionExitosa() (+17 more)

### Community 26 - "Partidas Store (Gantt Tree)"
Cohesion: 0.08
Nodes (26): countDescendants(), crearOAbrirPresupuesto(), currentAuthUserId, draggingNode, draggingPos, ensurePresupuestoParaProyecto(), errorMessage, filteredPartidasTree (+18 more)

### Community 27 - "Financial Integrity RPC (SQL)"
Cohesion: 0.10
Nodes (19): cliente, cobros, cuentas_cobrar, idx_transaccion_centro, transaccion, fn_anular_transaccion(), fn_confirmar_cobro(), fn_crear_transaccion() (+11 more)

### Community 28 - "Dashboard Financiero"
Cohesion: 0.11
Nodes (25): AristaFlujo, CATEGORIA_GASTO_LABELS, CentroCostoRendimiento, claveAnioMes(), ConcentracionCategoria, esCentroExterno(), etiquetaAnioMes(), FiltrosFinanzas (+17 more)

### Community 29 - "Gantt Planning Service"
Cohesion: 0.13
Nodes (20): addDaysISO(), applyShiftToEffective(), BRANCH_HUES, computeProgress(), visit(), computeRollup(), visit(), ConstraintEdge (+12 more)

### Community 31 - "NPM Dependencies"
Cohesion: 0.08
Nodes (23): @supabase/supabase-js, name, private, type, version, chart.js, html2canvas-pro, @modelcontextprotocol/sdk (+15 more)

### Community 32 - "App Build Dependencies"
Cohesion: 0.09
Nodes (23): dependencies, chart.js, exceljs, html2canvas-pro, jspdf, @lucide/svelte, @modelcontextprotocol/sdk, pdfjs-dist (+15 more)

### Community 33 - "Conciliacion Financiera"
Cohesion: 0.12
Nodes (19): AperturaFinanciera, AperturaLotePayload, AperturaVigente, ConciliacionFinanciera, crearAperturaFinancieraLote(), EstadoConciliacion, FuenteApertura, getSaldoTotalCentrosCosto() (+11 more)

### Community 34 - "Tauri Path Plugin (Android)"
Cohesion: 0.20
Nodes (4): PathPlugin, Invoke, objectmapper, TypeReference

### Community 35 - "Centro de Costos (SQL Migrations)"
Cohesion: 0.12
Nodes (16): idx_centro_costo_id_empleado, uq_centro_costo_empleado, idx_centro_costo_id_cliente, idx_centro_costo_id_proveedor, idx_centro_costo_id_proyecto, uq_centro_costo_cliente, uq_centro_costo_proveedor, uq_centro_costo_proyecto (+8 more)

### Community 36 - "Tickets Service"
Cohesion: 0.12
Nodes (16): if(), aprobarTicket(), cambiarEstado(), crearTicket(), EstadoTicket, FiltrosTicketDeveloper, getTicketsDeveloper(), marcarEnProgreso() (+8 more)

### Community 37 - "Tauri JSObject Bridge (Android)"
Cohesion: 0.13
Nodes (4): JSObject, PluginResult, jsonexception, JSONObject

### Community 38 - "Incidencias Control Financiero"
Cohesion: 0.13
Nodes (14): cerrarIncidencia(), CrearIncidenciaPayload, EstadoIncidencia, FiltrosIncidencia, identificarCausa(), Incidencia, IncidenciaEvento, iniciarInvestigacion() (+6 more)

### Community 39 - "Cobros/Pagos SQL Migrations"
Cohesion: 0.11
Nodes (16): idx_cobros_id_transaccion, idx_pagos_id_transaccion, idx_cuentas_cobrar_id_transaccion, idx_cuentas_pagar_id_transaccion, generar_cuentas_pagar_recurrentes(), uq_cuentas_pagar_padre, generar_cuentas_pagar_recurrentes(), check_partida_cycle() (+8 more)

### Community 40 - "Centro de Costos Config"
Cohesion: 0.11
Nodes (15): CentroCostoFieldConfig, CentroCostoFieldOption, CentroCostoFieldType, CURRENCY_FORMATTER, DEFAULT_PAGE_SIZE, DEFAULT_SORT_DIR, DEFAULT_SORT_FIELD, DELETE_STRATEGY (+7 more)

### Community 41 - "Centro de Costos Service"
Cohesion: 0.11
Nodes (10): COLUMNA_POR_TIPO, EntidadCentroCosto, EntidadVinculada, ListParams, ListResult, PREFIJO_CODIGO_MANUAL, PREFIJO_CODIGO_POR_TIPO, ProyectoVinculadoConsultoria (+2 more)

### Community 42 - "Cuentas Bancarias Config"
Cohesion: 0.15
Nodes (13): DEFAULT_PAGE_SIZE, DEFAULT_SORT_DIR, DEFAULT_SORT_FIELD, FIELDS_CONFIG, PK_COLUMN, SEARCHABLE_COLUMNS, TABLE_NAME, CuentaBanco (+5 more)

### Community 43 - "Tauri Plugin Annotations (Android)"
Cohesion: 0.15
Nodes (12): Activity, Permission, TauriPlugin, AppPlugin, WebView, GetFileNameFromUriArgs, getRealNameFromURI(), Uri (+4 more)

### Community 44 - "Control Financiero Checks"
Cohesion: 0.12
Nodes (9): getSaldosDetalleCuentasBancarias(), checkSaldosConsistentes(), ChequeoConsistencia, CHEQUEOS, EstadoCheck, ResultadoCheck, ResultadoChequeoConId, RevisionFinanciera (+1 more)

### Community 45 - "Columnfilterbar"
Cohesion: 0.15
Nodes (13): activeCount, clearAll(), expanded, filterableFields, setRange(), setText(), triggerDebounced(), columnFilterKind() (+5 more)

### Community 46 - "Pluginhandle"
Cohesion: 0.16
Nodes (7): Intent, IntentSenderRequest, WebView, PluginHandle, CommandData, Method, sharedpreferences

### Community 47 - "Index"
Cohesion: 0.25
Nodes (16): ref_npm_supabase_supabase_js_2, buildJsonResponse(), confirmActivation(), corsHeaders, createUser(), darDeBajaEmpleado(), deleteUser(), getOrCrearCentroCostoEmpleado() (+8 more)

### Community 48 - "Index"
Cohesion: 0.14
Nodes (15): mcp-server/index.ts (servidor MCP), AGENT_TOOLS, ctx, server, supabase, transport, agent-tools/registry.ts (tipo AgentTool + crearRegistro), AgentContext (+7 more)

### Community 49 - "Scope Y Gantt"
Cohesion: 0.15
Nodes (16): Simulador Visual Tiempo+Nodos (dashboard_transacctions.html), Construni ERP UI Mockup (demo.html), Demo module: AI Insights (predicción/YOLO), Demo module: Compras, Demo module: Costos & Presupuestos, Demo module: Finanzas, Demo module: RRHH Obra, Metodología Last Planner® (+8 more)

### Community 50 - "Partidas"
Cohesion: 0.22
Nodes (16): addPartidaToPlantilla(), collectAll(), createPartida(), createPlantilla(), deletePartida(), deletePlantilla(), fetchPartidasTree(), fetchPlantillaDetalle() (+8 more)

### Community 51 - "Dashboard Proyectos De Obras"
Cohesion: 0.21
Nodes (16): Accesos Rápidos (Quick Access Shortcuts), PPC y Análisis de Incumplimiento, Carga de Trabajo (Team Workload %), Horas Hombre (Semana Próxima) Chart, Kanban de Ejecución (Semana), Sistema Last Planner Adaptado, Look Ahead (Próx. 4 semanas), Pendientes Globales (Global Pending Items List) (+8 more)

### Community 52 - "Ppc Causas De Incumplimiento Modulo Proyectos"
Cohesion: 0.17
Nodes (16): Causa AP Actividades Previas (2, 5.41%), Causa CLI-ING Cliente-Ingenieria (3, 8.11%), Causa DT Documentacion Tecnica (2, 5.41%), Causa EQ Equipos (2, 5.41%), Causa EE Errores de Ejecucion (3, 8.11%), Causa EXTERNO (3, 8.11%), Causa MATERIALES (10, 27.03%), Causa PERSONAL (12, 32.43%) (+8 more)

### Community 53 - "+Page"
Cohesion: 0.16
Nodes (10): actualizarEmpleado(), closeConfirmDarDeBaja(), closeConfirmRestaurar(), confirmarDarDeBaja(), confirmarRestaurar(), confirmDarDeBajaOpen, confirmEliminarPermanenteOpen, confirmRestaurarOpen (+2 more)

### Community 54 - "Logger"
Cohesion: 0.13
Nodes (6): Logger, dateformat, log, simpledateformat, suppresslint, textutils

### Community 55 - "Schema"
Cohesion: 0.14
Nodes (15): default, description, type, properties, type, Commands, Scopes, default (+7 more)

### Community 56 - "Schema"
Cohesion: 0.14
Nodes (15): description, properties, required, type, DefaultPermission, description, type, description (+7 more)

### Community 57 - "Der2"
Cohesion: 0.20
Nodes (7): area, empleados, is_admin(), permisos, roles, roles_permisos, is_admin()

### Community 58 - "Tsconfig"
Cohesion: 0.14
Nodes (13): compilerOptions, allowJs, checkJs, esModuleInterop, forceConsistentCasingInFileNames, moduleResolution, resolveJsonModule, rewriteRelativeImportExtensions (+5 more)

### Community 59 - "Control Financiero Migration"
Cohesion: 0.24
Nodes (13): apertura_financiera, conciliacion_financiera, idx_apertura_financiera_centro_costo, idx_apertura_financiera_fecha, idx_conciliacion_fecha, idx_incidencia_estado, idx_incidencia_evento_incidencia, idx_incidencia_severidad (+5 more)

### Community 60 - "Curva S Modulo De Proyectos"
Cohesion: 0.20
Nodes (14): Ajustes (tab), Avance Financiero (metric, 0% gastado), Avance Fisico (metric, 24.1% real vs 54.1% plan), Avances (tab), Cronograma del proyecto (26 Abr 2026 - 26 Sep 2026, 22 semanas), Cronograma (tab), Curva S - Plan vs. Real (chart), Dashboard (tab) (+6 more)

### Community 61 - "Planmoduloticketsyreleases"
Cohesion: 0.19
Nodes (10): /api/upload-document endpoint, DEVELOPER_ROLE, Tauri auto-update (plugin-updater + firma + latest.json), Mecanismo de CI/CD de ConstruniERP (CI automático + CD manual firmado), Tabla `release`, Ciclo de vida del ticket (resuelto → aprobado → release/cerrado), Tabla `ticket`, Consideraciones Tauri (rutas /api/* no disponibles en build estático) (+2 more)

### Community 62 - "Schema"
Cohesion: 0.15
Nodes (13): definitions, Number, PermissionKind, Target, Value, anyOf, description, oneOf (+5 more)

### Community 63 - "Schema"
Cohesion: 0.15
Nodes (13): properties, description, items, type, platforms, scope, version, allOf (+5 more)

### Community 64 - "Dashboard Proyectos De Consultoria"
Cohesion: 0.29
Nodes (13): Aprobaciones y Flujo de Entrega (Elaboracion-Revision Interna-Revision Cliente-Aprueba/Observa), Beneficios (visibilidad, productividad, reduccion de observaciones, trazabilidad), Control Documental y Versionamiento (documentos, version, fecha, estado), Entregables del Proyecto (tabla con responsable, fecha, estado, avance), ERP para Proyectos de Consultoria (Diseno de Planos), Horas Hombre (Planificado vs Ejecutado por semana), Dashboard Proyectos de Consultoria (screenshot), Indicadores Principales (PPC de Entregables, Observaciones por especialidad/semana) (+5 more)

### Community 65 - "Rnc Razones De No Cumplimiento Modulo De Proyectos"
Cohesion: 0.28
Nodes (13): RNC (Razones de No Cumplimiento) Dashboard Screenshot, Indice de Impacto (promedio de compromisos afectados por RNC), Last Planner System (LPS methodology), Lecciones Aprendidas (module tab and panel), Modulo de Proyectos (ERP Consultoria - Oficina Tecnica), PPC - Percent Plan Complete, Vivienda Multifamiliar Los Robles (PRY-2026-015), Registro de RNC (log table with ID, fecha, descripcion, categoria, origen, accion inmediata, responsable) (+5 more)

### Community 66 - "Permissionhelper"
Cohesion: 0.27
Nodes (6): activitycompat, Context, PermissionHelper, arraylist, build, packagemanager

### Community 67 - "Package"
Cohesion: 0.17
Nodes (12): devDependencies, svelte, svelte-check, @sveltejs/adapter-auto, @sveltejs/kit, @sveltejs/vite-plugin-svelte, @tauri-apps/api, @tauri-apps/cli (+4 more)

### Community 68 - "Tree"
Cohesion: 0.24
Nodes (7): i(), computeBlockShift(), findNode(), buildTree(), fillMissingAncestors(), flattenSubtree(), Item

### Community 69 - "+Page"
Cohesion: 0.17
Nodes (12): eliminarVentaCascade(), closeConfirmDarDeBaja(), closeConfirmRestaurar(), compararVentasParaTabla(), confirmarDarDeBaja(), confirmarEliminarPermanente(), confirmarRestaurar(), fetchVentas() (+4 more)

### Community 70 - "Ticketmodal"
Cohesion: 0.20
Nodes (10): descripcion, error, guardando, handleSubmit(), modulo, onImagenChange(), opcionesModulo, resetForm() (+2 more)

### Community 71 - "Cronograma Gantt Migration"
Cohesion: 0.24
Nodes (11): cronograma_dependencia, cronograma_plan_base, idx_crono_act_padre, idx_crono_dep_destino, idx_crono_dep_origen, idx_crono_pb_proyecto, plantilla_actividad, plantilla_cronograma (+3 more)

### Community 72 - "Package"
Cohesion: 0.18
Nodes (11): scripts, build, check, check:watch, dev, mcp, prepare, preview (+3 more)

### Community 73 - "Presupuestomodule"
Cohesion: 0.22
Nodes (7): cargar(), loading, showNuevoModal, volverALista(), fetchPresupuestos(), presupuestosList, svelte

### Community 74 - "Codigoproyecto"
Cohesion: 0.20
Nodes (10): if(), CentroCosto, getProyectosCentroCostoConsultoria(), resolveEntidadVinculada(), getProyectoOptions(), CuentaPagar, generarCodigoProyecto(), mesAnioDeFecha() (+2 more)

### Community 75 - "Releases.Service"
Cohesion: 0.18
Nodes (8): AppRelease, Caso especial: baja de Empleado bloquea la cuenta de Supabase Auth, Mecanismo solicitud_aprobacion, SUPABASE_SERVICE_ROLE_KEY (acceso total, sin RLS), Capa de herramientas para agentes de IA (arquitectura MCP), user-admin Edge Function (CRUD Auth + empleados), ref_supabase_supabase_js, Supabase Edge Functions README (user-admin)

### Community 76 - "Movimientoscaja.Service"
Cohesion: 0.27
Nodes (10): codigoMovimiento(), FilaMovimiento, filtroOrigenODestino(), getMovimientosCaja(), MovimientosCajaParams, MovimientosCajaResult, signoMonto(), TipoMovimiento (+2 more)

### Community 77 - "Tickets"
Cohesion: 0.18
Nodes (7): listarTickets, TicketCompacto, ticketsTools, ultimaVersionApp, verImagenAdjunta, verTicket, Por qué tools/tickets.ts reimplementa queries en vez de importar tickets.service.ts

### Community 78 - "Shareplugin"
Cohesion: 0.33
Nodes (5): Intent, Uri, WebView, SharePlugin, bytearrayoutputstream

### Community 79 - "Permissionstate"
Cohesion: 0.20
Nodes (5): PermissionState, DENIED, GRANTED, PROMPT, PROMPT_WITH_RATIONALE

### Community 80 - "Gantt Con Dependencias Modulo Proyectos"
Cohesion: 0.25
Nodes (11): Avance Real (real progress overlay), Brikel (software brand), Dependencias (dependency lines toggle), Dias y Tolerancia (working days & tolerance settings), Gantt con Dependencias (Gantt chart with task dependencies), Gantt con Dependencias - Modulo Proyectos (screenshot), Modulo Proyectos (Projects Module), Plan Base (baseline plan) (+3 more)

### Community 81 - "Main Dashboard Modulo De Proyectos"
Cohesion: 0.35
Nodes (11): Dark Theme UI Design Pattern, Main Dashboard - Modulo de Proyectos (Screenshot), Importar Excel/PDF Action, KPI Summary Cards (Proyectos Activos, Presupuesto Total, Total Gastado, Avance Promedio), Mis Proyectos Dashboard View, Modulo de Proyectos (Projects Module), Nuevo Proyecto Action, Portafolio (Company Project Portfolio) (+3 more)

### Community 82 - "Exampleinstrumentedtest"
Cohesion: 0.20
Nodes (6): androidjunit4, ExampleInstrumentedTest, ExampleUnitTest, instrumentationregistry, runwith, test

### Community 83 - "Teoriatransferencias"
Cohesion: 0.24
Nodes (7): aplicarTransaccion(), Atomicidad/ACID y concurrencia en transferencias financieras, Evento A: transferencia entre centros de costo (C_i → C_j), Evento B: transferencia directa entre cuentas bancarias (B_m → B_n), Matriz W (distribución cuenta bancaria ↔ centro de costo), Modelo matemático de saldos (B, C, W) y transferencias, Función RECONCILIAR SISTEMA FINANCIERO

### Community 84 - "Centrocostos.Service"
Cohesion: 0.22
Nodes (9): cerrarVentaAprobada(), actualizarSaldoCentroCostoProyecto(), generarCodigoCentroCostoManual(), getCodigoCentroCostoCompartido(), getOrCrearCentroCostoCompartido(), getOrCrearCentroCostoParaEntidad(), getSaldosVentaPorCentroCosto(), getOrCrearClientePrestamos() (+1 more)

### Community 85 - "Centrocostomodal"
Cohesion: 0.24
Nodes (9): gridColsClass, handleSubmit(), modalWidthClass, title, validateCentroCostoPayload(), validateField(), buildWritablePayload(), createCentroCosto() (+1 more)

### Community 86 - "Transacciones.Service"
Cohesion: 0.27
Nodes (10): registrarCobroDesdeTransaccion(), registrarPagoDesdeTransaccion(), anularTransaccion(), construirInsertDataTransaccion(), crearTransaccionSistema(), createTransaccion(), labelPorCodigoMedioPago(), resolveEstadoTransaccion() (+2 more)

### Community 87 - "Aprobaciones De Documentos Modulo De Proyectos"
Cohesion: 0.38
Nodes (10): Acciones Rapidas (Quick Actions: Enviar a revision, Solicitar aprobacion, Generar nueva version, Eliminar documento), Approvers by Specialty (Arquitectura, Estructuras, Instalaciones Sanitarias, Instalaciones Electricas), Estado del Documento (Pendiente de Aprobacion status badge), Flujo de Aprobacion (Approval Workflow: Borrador -> Revision Tecnica -> Aprobacion Especialidades -> Aprobacion Jefe de Proyecto -> Emitido), Historial de Aprobaciones (Approval History Log), Aprobaciones de Documentos - Modulo de Proyectos (Screenshot), Matriz de Aprobacion por Especialidad (Approval Matrix by Specialty), Modulo de Proyectos (Projects Module) (+2 more)

### Community 88 - "Gestion De Documentos Modulo De Proyectos"
Cohesion: 0.31
Nodes (10): Gestión de Documentos - Módulo de Proyectos (screenshot), Acciones Rápidas, Documentos del Proyecto (listado), Flujo de Aprobación (Borrador/Revisión/Aprobación/Emitido), Gestión Documental del Proyecto, Módulo de Proyectos, Plantillas de Documentos, Project Charter (documento/plantilla) (+2 more)

### Community 89 - "Plantillas Para Flujos Proyectos De Consultoria"
Cohesion: 0.33
Nodes (10): Acciones sobre plantilla (Duplicar, Exportar, Eliminar Plantilla), Etapas del flujo con rol responsable (Levantamiento, Anteproyecto, Revision Cliente, Correcciones, Desarrollo Especialidades, Coordinacion, Control de Calidad, Entrega al Cliente, Observaciones Cliente, Correccion, Aprobacion Cliente, Entrega Final, Cierre del Proyecto), Plantillas para Flujos - Proyectos de Consultoria (screenshot), Logica de bifurcacion Aprobado / Rechazado entre Revision Cliente y Correcciones, Modulo Plantillas de Flujo de Procesos, Panel Informacion de la Plantilla (codigo, estado, creador, fechas, usada en N proyectos), Plantilla Vivienda Multifamiliar (12 etapas, plantilla por defecto), Pestanas de detalle: Vista del Flujo, Detalle de Etapas, Configuracion (+2 more)

### Community 90 - "Ticket Module Migration"
Cohesion: 0.38
Nodes (9): app_release, idx_ticket_comentario_ticket, idx_ticket_creado_por_id, idx_ticket_estado, idx_ticket_evento_ticket, idx_ticket_id_release, ticket, ticket_comentario (+1 more)

### Community 91 - "Anuncios.Service"
Cohesion: 0.28
Nodes (6): Anuncio, AnuncioPayload, createAnuncio(), ServiceResult, updateAnuncio(), validarPayload()

### Community 92 - "Trayectoria.Service"
Cohesion: 0.31
Nodes (7): getSaldosDetalleCentrosCosto(), getUltimasAperturasPorCentroCosto(), getTrayectoriaCentrosCosto(), PuntoTrayectoria, SerieTrayectoria, TrayectoriaResultado, getCentroCostoOptionsSoloCentros()

### Community 93 - "Schema"
Cohesion: 0.22
Nodes (8): anyOf, description, description, properties, default, $schema, title, type

### Community 94 - "Schema"
Cohesion: 0.28
Nodes (9): items, items, $ref, type, items, set, description, items (+1 more)

### Community 95 - "Tauri.Conf"
Cohesion: 0.22
Nodes (8): app, security, windows, identifier, productName, $schema, csp, version

### Community 96 - "Metodologia Last Planner"
Cohesion: 0.53
Nodes (9): 4. Analisis de Restricciones, 5. Causas de no Cumplimiento, Metodologia Last Planner (Infographic), Last Planner System, Lean Construction, 2. Look Ahead, 6. Plan Diario, 1. Plan Maestro (+1 more)

### Community 97 - "Revision Proyectos Feedback Modulo Proyectos Obras"
Cohesion: 0.39
Nodes (8): Analisis de Causas de Incumplimiento & Medidas Correctivas, Porcentaje de Cumplimiento (Compliance %) Indicator, Revision Proyectos Feedback - Modulo Proyectos Obras (Screenshot), Last Planner System (LPS) Master Schedule, Metrado Planificado vs Metrado Real Tracking, Modulo Proyectos Obras (ERP Construction Projects Module), WBS Task Breakdown (Item/Nombre de tarea hierarchy), Weekly Calendar Grid (Semana 08 Day Columns D-S)

### Community 98 - "Package"
Cohesion: 0.25
Nodes (7): dependencies, @supabase/supabase-js, @supabase/supabase-js, name, private, type, version

### Community 99 - "+Page"
Cohesion: 0.29
Nodes (7): crearSolicitud(), isAdmin(), fetchResumenVentas(), handleExportar(), handleResumenDesdeChange(), handleResumenHastaChange(), handleVentaGuardada()

### Community 100 - "Desktop Updater"
Cohesion: 0.29
Nodes (6): description, identifier, permissions, platforms, $schema, windows

### Community 101 - "Schema"
Cohesion: 0.33
Nodes (7): Permission, default, description, items, required, type, permission

### Community 102 - "Bandeja De Pagos Pendientes"
Cohesion: 0.48
Nodes (7): Bandeja de Pagos Pendientes (feature), Cuentas por Pagar (modulo de finanzas), Asignacion de pagos por arrastrar y soltar, Bandeja de Pagos Pendientes (UI Screenshot), Panorama (escenario de flujo de caja), Priorizacion de pagos (Alta/Media/Baja, orden arrastrable), Proyeccion de ingresos, pagos y flujo de caja

### Community 103 - "Gestion De Partidas Con Progresos Modulo Proyectos"
Cohesion: 0.48
Nodes (7): Actividad reciente (widget), Distribución del gasto por partida (widget), Pestaña Gastos, Gestión de partidas con progreso, Gestión de partidas con progresos - Módulo Proyectos (screenshot), Módulo Proyectos, Tareas críticas (widget)

### Community 104 - "Historico De Cumplimiento Modulo Proyecto Obras"
Cohesion: 0.43
Nodes (7): Causas de Incumplimiento Historico, % Cumplimiento General del Proyecto (89%), Historico Semanal de % Cumplimiento en PPC, Historico de Cumplimiento - Modulo Proyecto Obras (Screenshot), Metrica PPC (Porcentaje de Plan Cumplido), Modulo Proyecto Obras, Responsable de Incumplimiento

### Community 105 - "Solicitud Aprobacion Notificado Migration"
Cohesion: 0.43
Nodes (5): idx_solicitud_estado, solicitud_aprobacion, idx_solicitud_notificacion_solicitud, idx_solicitud_notificacion_usuario, solicitud_notificacion

### Community 106 - "+Page"
Cohesion: 0.33
Nodes (6): etiquetaVenta(), handleDarDeBajaEvent(), handleEliminarPermanenteEvent(), handleRestaurarEvent(), handleViewContrato(), handleViewProforma()

### Community 107 - "Default"
Cohesion: 0.33
Nodes (5): description, identifier, permissions, $schema, windows

### Community 108 - "Jsarray"
Cohesion: 0.40
Nodes (3): JSArray, E, JSONArray

### Community 109 - "Schema"
Cohesion: 0.33
Nodes (6): allOf, default, description, allow, deny, commands

### Community 110 - "Main"
Cohesion: 0.33
Nodes (3): main.rs (punto de entrada Tauri), Integración Google Drive (upload/distribución de archivos y APKs), ConstruniERP Developer Manual

### Community 111 - "Ppc Modulo Proyecto Obras"
Cohesion: 0.53
Nodes (6): HH Ganadas / Porcentaje de Avance Teorico, Causas de Incumplimiento (COD/Descripcion/Cant), Cronograma de actividades (instalacion sanitaria), PPC - Modulo Proyecto Obras (screenshot), Modulo Proyecto Obras, Calculo de PPC (Porcentaje de Plan Cumplido)

### Community 112 - "Documento Proyecto Migration"
Cohesion: 0.40
Nodes (4): documento_proyecto, idx_documento_proyecto_proyecto, trg_set_updated_at_documento, trg_documento_proyecto_updated_at

### Community 113 - "Apis"
Cohesion: 0.40
Nodes (3): apis_update_timestamp, public.apis, public.refresh_api_updated_at

### Community 115 - "Peruubigeo"
Cohesion: 0.40
Nodes (4): DEPARTAMENTOS, DISTRITOS_POR_PROVINCIA, PROVINCIAS, PROVINCIAS_POR_DEPARTAMENTO

### Community 117 - "+Page"
Cohesion: 0.40
Nodes (5): cumpleColumnFilters(), exportarCSV(), formatDate(), medioPagoDe(), montoMovimiento()

### Community 118 - "Gradlew"
Cohesion: 0.70
Nodes (4): gradlew script, die(), save(), warn()

### Community 119 - "Tauri.Conf"
Cohesion: 0.40
Nodes (5): build, beforeBuildCommand, beforeDevCommand, devUrl, frontendDist

### Community 120 - "Tauri.Conf"
Cohesion: 0.40
Nodes (5): bundle, active, createUpdaterArtifacts, icon, targets

### Community 121 - "Tauri.Conf"
Cohesion: 0.40
Nodes (5): plugins, updater, active, endpoints, pubkey

### Community 122 - "Package"
Cohesion: 0.40
Nodes (4): ref_sveltejs_kit_vite, @sveltejs/vite-plugin-svelte, @tailwindcss/vite, vite

### Community 126 - "Schema"
Cohesion: 0.50
Nodes (4): PermissionSet, description, required, type

### Community 128 - "+Page"
Cohesion: 0.67
Nodes (3): fetchMovimientos(), idsParaTipoFiltroCC(), toggleTipoFilterCC()

## Ambiguous Edges - Review These
- `ConstruniERP — Alcance del Sistema y Plan de Desarrollo` → `Demo module: AI Insights (predicción/YOLO)`  [AMBIGUOUS]
  demo.html · relation: conceptually_related_to
- `Pizarra Interactiva (Miro Integration)` → `Proyectos de Obras Module (Construction Projects Production Center)`  [AMBIGUOUS]
  Documentacion/Cliente/Dashboard Proyectos de Obras.jpeg · relation: conceptually_related_to

## Knowledge Gaps
- **539 isolated node(s):** `public.apis`, `recurso_precio`, `anuncios`, `AGENT_TOOLS`, `supabase` (+534 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 977 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **98 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `ConstruniERP — Alcance del Sistema y Plan de Desarrollo` and `Demo module: AI Insights (predicción/YOLO)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Pizarra Interactiva (Miro Integration)` and `Proyectos de Obras Module (Construction Projects Production Center)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `[]` connect `Movimientos de Caja` to `+Page`, `Cuentas por Pagar & Transacciones Config`, `+Page`, `Panorama & Cuenta Modals UI`, `Cuentas Bancarias Config`, `Cuentabanco.Service`, `Movimientoscaja.Service`, `Columnfilterbar`, `Proveedores & Ventas Tables`, `Shared UI Components`, `+Page`, `Plantillas de Partidas UI`, `Navegacion & Permisos`, `Actualizaciones & Preview Drive`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `ConstruniERP Developer Manual` connect `Main` to `Google Drive Integration`, `Tauri.Conf`, `Plantillas de Partidas UI`, `Navegacion & Permisos`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `@lucide/svelte` connect `Panorama & Cuenta Modals UI` to `Presupuestomodule`, `Proveedores & Ventas Tables`, `NPM Dependencies`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `[]` (e.g. with `closeViewModal()` and `cumpleColumnFilters()`) actually correct?**
  _`[]` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `public.apis`, `recurso_precio`, `anuncios` to the rest of the system?**
  _539 weakly-connected nodes found - possible documentation gaps or missing edges._