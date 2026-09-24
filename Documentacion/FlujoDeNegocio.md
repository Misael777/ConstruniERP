# Flujo de Negocio — ConstruniERP

Este documento describe el ERP desde el negocio, no desde el código: en qué orden se llena la primera
vez, qué depende de qué, y qué se autogenera solo. Es el punto de partida para la Fase D (suite de
tests de negocio) y para cualquier futura herramienta de agente (Fase C) — antes de escribir un caso de
prueba o una herramienta nueva, conviene ubicar el módulo acá.

Fuente: los `*.service.ts` reales de cada módulo (leídos durante esta sesión y en el inventario hecho
para el plan de Desarrollo/Testing), contrastado con el grafo de conocimiento de `/graphify`
(`graphify-out/`). Donde el código no deja un dato 100% explícito, se marca **(inferido)**.

## 0. Antes de cualquier dato de negocio: acceso

**Módulo: IAM (Control Accesos) → Empleados, Roles y Permisos**

- `roles` / `permisos` / `roles_permisos` — el catálogo de permisos ya viene precargado por migración
  (`ticket_module_migration.sql` agrega los de Tickets, por ejemplo); un rol nuevo se arma marcando
  casillas en Roles y Permisos.
- `empleados` — cada persona que va a usar el ERP necesita una fila acá (`darDeBajaEmpleado`/
  `restaurarEmpleado`/`deleteUser` en `edgeFunctionClient.ts`, respaldados por la Edge Function
  `user-admin`). Crear un empleado también crea su cuenta de Supabase Auth y, apenas tiene rol
  'proveedor'... **(no)** — el auto-centro-de-costo de tipo `empleado` se crea vía
  `getOrCrearCentroCostoParaEntidad(client, 'empleado', ...)`, ver sección 2.
- Sin un empleado con rol y permisos, no hay forma de entrar al resto del ERP — es el primer paso
  obligatorio, siempre.

## 1. Comercial: a quién le compramos y a quién le vendemos

**Módulo: Comercial → Clientes** (`cliente`, sin capa de servicio propia — CRUD inline en
`comercial/clientes/+page.svelte`)
**Módulo: Finanzas → Proveedores** (`proveedor`, `proveedores.service.ts`)

- No hay una dependencia estricta de orden entre Clientes/Proveedores y el resto — se cargan cuando
  aparece la primera venta o la primera compra que los necesita, o antes, como catálogo.
- Dar de baja un cliente/proveedor (`darDeBajaCliente`/`darDeBajaProveedor`) es un soft-delete; borrarlo
  de verdad (`deleteClienteCascade`/`deleteProveedorCascade`) primero verifica que no tenga nada
  colgando (ventas, cuentas por pagar, transacciones, centro de costo) — `getProveedorDependencias`/
  el chequeo equivalente de cliente existen justo para eso.

## 2. El concepto que atraviesa TODO: Centro de Costo

**Módulo: Finanzas → Centro de Costos** (`centro_costo`, `centroCostos.service.ts`)

Antes de seguir, esto es la pieza más importante para entender el resto del ERP: **casi todo lo que
mueve dinero necesita un Centro de Costo**, y la enorme mayoría se crean SOLOS, no a mano:

- `getOrCrearCentroCostoParaEntidad(client, tipo, idEntidad, nombre)` — se llama automáticamente al
  crear un **Cliente**, un **Proveedor**, un **Empleado** o una **Venta/Proyecto** cerrada. Idempotente:
  si ya existe uno para esa entidad, lo reusa.
- Los únicos que se crean A MANO desde "Nuevo Centro de Costo" son los de tipo `obra`/`consultoria`
  (manuales, sin entidad dueña), `otro`, `bolsa general` (recién renombrado a "Corporativo" en la UI,
  ticket #24) y `prestamo`.
- **Regla de negocio clave**: un centro de costo vinculado a una entidad (cliente/proveedor/empleado/
  proyecto) **no se puede borrar directo** — `deleteCentroCosto`/`eliminarCentroCostoPermanente`
  rechazan la operación con un mensaje explícito ("elimina esa entidad si de verdad quieres quitarlo, se
  borra en cascada"). Esto ya causó un bug real (ticket #25): si la entidad dueña nunca se borra de
  verdad, su centro de costo queda huérfano para siempre, activo, aunque el usuario "sienta" que ya lo
  eliminó.
- `TIPO_CENTRO_COSTO_OPTIONS`/`centroCumpleTipoFiltro` (`dashboardFinanzas.service.ts`) es la lista
  vigente de tipos reales que existen en la base — no asumir que "Obra"/"Consultoría" son tipos
  distintos de "Proyecto": un centro de tipo `proyecto` es Obra o Consultoría según el `tipo_venta` de
  la venta que lo generó (ver sección 3).

## 3. Comercial → Ventas: el evento que dispara todo lo demás

**Módulo: Comercial → Ventas** (`proyecto`, sin capa de servicio propia — CRUD inline en
`comercial/ventas/+page.server.ts`/`+page.svelte`; el cierre pasa por `aprobaciones.service.ts`)

- Una "Venta" en este ERP ES un `proyecto` — la tabla se llama `proyecto`, con `tipo_venta` (`obra` |
  `consultoria`) y `estado_proyecto` (en negociación → `venta_cerrada` | `baja`).
- Al **cerrar** una venta (`cerrarVentaAprobada` en `aprobaciones.service.ts`, siempre pasando por
  `solicitud_aprobacion` salvo que quien cierra ya sea admin — ver sección 9): se genera su Centro de
  Costo propio (`getOrCrearCentroCostoParaEntidad(..., 'proyecto', ...)`), y recién ahí el proyecto
  "existe" para el resto de Finanzas (Transacciones, Cuentas por Pagar/Cobrar lo pueden referenciar).
- **Bug de negocio real encontrado esta sesión (ticket #27)**: los indicadores "de este año" de Ventas
  se calculaban sobre las últimas 100 filas sin filtrar por año — una venta vieja se contaba como si
  fuera de este año. Ya corregido, pero deja una lección de diseño: cualquier KPI "de este año" en
  cualquier módulo debe filtrar explícitamente por fecha, no asumir que el orden de la consulta alcanza.
- `generarCodigoProyecto()` (`shared/codigoProyecto.ts`) arma el código visible del proyecto/venta a
  partir de sus características — no es una columna guardada, se recalcula siempre igual.

## 4. Proyectos: Presupuesto, Partidas/Gantt

**Módulo: Proyectos → Presupuesto** (`presupuesto`, `presupuesto_detalle`)
**Módulo: Proyectos → Partidas / Gantt** (`partida`, `cronograma_actividad`, `gantt-planning`
`service.ts`)

- Corren en paralelo entre sí, ambos colgando de un proyecto ya creado (no necesariamente ya cerrado
  como venta — un proyecto en negociación puede tener su propio Gantt de propuesta).
- Presupuesto: `presupuesto_detalle.total` sumado da el "presupuesto asignado" que usa Control
  Financiero para calcular desviación — no hay una columna de total en `presupuesto` mismo.
- Gantt/Partidas: `computeRollup`/`computeProgress`/`resolveConstraints`/`computeBlockShift`
  (`ganttPlanning.service.ts`, el ÚNICO módulo con pruebas unitarias reales hoy — `ganttPlanning.service.test.ts`)
  — dependencias entre actividades, arrastrar una actividad recalcula las dependientes.

## 5. Finanzas: el dinero de verdad

**Módulo: Finanzas → Transacciones** (`transaccion`, `trans_detalle`, `transacciones.service.ts`)
**Módulo: Finanzas → Cuentas por Pagar** (`cuentas_pagar`, `pagos`, `cuentasPagar.service.ts`)
**Módulo: Finanzas → Cuentas por Cobrar** (`cuentas_cobrar`, `cobros`, `cuentasCobrar.service.ts`)
**Módulo: Finanzas → Cuentas Bancarias** (`cuenta_banco`, `cuentaBanco.service.ts`)

Esta es la parte con más reglas de negocio no obvias del ERP:

- **Una Cuenta por Pagar/Cobrar es una OBLIGACIÓN** (lo que se debe o te deben), no un movimiento de
  dinero en sí. El movimiento real es una **Transacción**. Se conectan en los dos sentidos posibles:
  - `registrarPagoDesdeTransaccion`/`registrarCobroDesdeTransaccion` — una Transacción marcada como el
    pago/cobro de una Cuenta por Pagar/Cobrar YA EXISTENTE crea una fila en `pagos`/`cobros` enlazada.
  - `createCuentasPagarRecurrentes` — "Frecuencia de Pago" (mensual/quincenal/semanal) genera VARIAS
    Cuentas por Pagar futuras de una sola vez, cada una por el monto íntegro (a propósito NO reparte el
    monto entre cuotas — eso es "Fraccionar este pago", un concepto DISTINTO, ver ticket #20/#22).
  - "Fraccionar este pago" (`FraccionamientoModal.svelte`, compartido entre Pagar y Cobrar) reparte el
    monto de UNA SOLA Cuenta por Pagar/Cobrar en varias cuotas con su propia fecha — no genera cuentas
    nuevas, genera filas en `pagos`/`cobros` con `estado_pago='programado'`.
  - **Estos dos mecanismos (Frecuencia de Pago vs. Fraccionar) se confunden fácil** — mismo módulo,
    nombres parecidos, comportamiento distinto. Vale la pena un test de negocio explícito que los
    distinga (ticket #30 lo pide, sin saberlo, con "revisar frecuencia de pago").
  - Toda Transacción tiene `id_centro_costo_origen`/`id_centro_costo_destino` — de acá sale de dónde a
    dónde se mueve el dinero (puede ser interno, entre dos centros propios, o externo con un
    cliente/proveedor).
  - `cuenta_banco.saldo_actual` **nunca se pisa directo** — siempre se recalcula desde cero
    (`recalcularSaldoCuentaBanco`) sumando todo lo que entró/salió, cada vez que cambia algo. Mismo
    criterio en `recalcularCuentaCobrar`/`recalcularCuentaPagar`.
  - Aprobar/anular una Transacción (`aprobarTransaccion`/`anularTransaccion`/`reactivarTransaccion`)
    dispara los recálculos de saldo correspondientes — nunca hay que sumar/restar a mano en la UI.

**Módulo: Finanzas → Panoramas** (`panoramas.service.ts`, sin tabla propia — organiza `pagos`/`cobros`
pendientes en un tablero arrastrable)

- No crea datos nuevos: prioriza/reordena Cuentas por Pagar/Cobrar YA existentes en dos escenarios
  comparables ("Panorama 1"/"Panorama 2") para decidir qué pagar primero — puramente de planificación,
  nada se persiste como "definitivo" hasta que se genera la Transacción real.

## 6. Finanzas → Control Financiero: la capa de verificación

**Módulo: Finanzas → Control Financiero** (`conciliacion_financiera`, `apertura_financiera`,
`incidencia`, `controlFinanciero.service.ts`/`conciliacion.service.ts`/`incidencia.service.ts`/
`trayectoria.service.ts`)

- No es un módulo operativo (no se "llena" como parte del flujo normal) — es un panel de
  **consistencia**: compara lo que dicen las Transacciones contra lo que dice cada Cuenta Bancaria/
  Centro de Costo, y contra una "apertura financiera" (el saldo de arranque de un período).
  `CHEQUEOS` en `controlFinanciero.service.ts` son literalmente reglas de "esto debería cuadrar con
  esto" — el lugar correcto para verificar si el resto del flujo (secciones 2-5) está bien alimentado.
- Una "Incidencia" (`incidencia.service.ts`) es el hallazgo de una inconsistencia detectada acá,
  con su propio ciclo de vida (`iniciarInvestigacion`/`cerrarIncidencia`).
- **Dashboard financiero unificado** (`dashboard-finanzas`, `dashboardFinanzas.service.ts`) es la
  capa de AGREGACIÓN sobre todo lo anterior (Rendimiento por Centro de Costo, Flujo de Nodos, Proyección
  futura) — 100% lectura, no origina ningún dato nuevo, solo reduce/agrupa lo que ya existe en
  Transacciones/Cuentas Pagar-Cobrar/Presupuesto.

## 7. Finanzas → Facturación (módulo nuevo, todavía evolucionando)

**Módulo: Facturación** (`factura`, `factura_detalle`, `factura_archivo`, `facturacion.service.ts`)

- Flujo: elegir **Cliente** → el sistema trae TODAS sus Transacciones de ingreso ya registradas
  (`getTransaccionesDelCliente`) → se eligen cuáles facturar (las ya facturadas quedan bloqueadas) →
  Vista previa → `autorizarYEmitirFactura` (guarda el PDF en Drive y marca esas transacciones como
  facturadas). Es decir: **la Transacción es anterior a la Factura**, nunca al revés — se factura dinero
  que ya entró, no al revés.
- Es el módulo más nuevo del ERP (sin agent-tools todavía, lógica de IGV/detracción en desarrollo) —
  tratarlo como de mayor riesgo/cambio en cualquier test de negocio.

## 8. Soporte → Tickets (paralelo al flujo financiero)

**Módulo: Soporte → Tickets** (`ticket`, `ticket_comentario`, `app_release`, `app_version_usuario`,
`tickets.service.ts`/`releases.service.ts`)

- No forma parte del flujo de dinero — es el canal de retroalimentación del ERP en sí (bugs, pedidos).
  Ciclo: `abierto`/`en_progreso` → `resuelto` (developer) → `aprobado`/`rechazado` (admin) →
  `cerrado` (al publicarse un release que lo incluye, `scripts/release.mjs`).
- Es el ÚNICO módulo con agent-tools hoy (`tools/tickets.ts`) — y, por decisión explícita del usuario,
  el único que sigue con lectura+escritura directa contra Producción incluso después de la Fase C del
  plan de Desarrollo/Testing (ver `Documentacion/AgentTools.md`).

## 9. Aprobaciones: el mecanismo transversal de "pedir permiso"

**Módulo: Aprobaciones** (`solicitud_aprobacion`, `aprobaciones.service.ts`)

- No es un módulo con pantalla propia de "llenado" — es un mecanismo que varios de los anteriores
  (cerrar una venta, editar/eliminar un cliente, exportar datos) usan cuando quien actúa NO es admin:
  se crea una `solicitud_aprobacion` en vez de aplicar el cambio directo, y un admin la
  aprueba/rechaza (`aprobarSolicitud`/`rechazarSolicitud`) desde `NotificacionesBell.svelte`.
- `autoResuelto: true` (ver `crearSolicitud`) es el caso especial de "esto ya se aplicó solo, esto es
  solo un AVISO informativo para el admin" (ej. un asesor cerrando su propia venta) — no bloquea nada,
  solo notifica.

## Orden recomendado para llenar el ERP desde cero (ambiente de Desarrollo)

1. Empleados + Roles y Permisos (sección 0) — sin esto no se puede entrar.
2. Unos pocos Clientes y Proveedores de prueba (sección 1).
3. Una Venta de Obra y una de Consultoría, cerradas (sección 3) — dispara sus Centros de Costo.
4. Presupuesto + Partidas/Gantt de esa venta (sección 4) — opcional para probar Finanzas, obligatorio
   para probar Proyectos.
5. Cuentas Bancarias (sección 5) — necesarias antes de registrar cualquier Transacción real.
6. Unas Cuentas por Pagar/Cobrar (algunas con Frecuencia de Pago, otras Fraccionadas — sección 5) y sus
   Transacciones correspondientes.
7. Revisar que Control Financiero (sección 6) no marque ninguna Incidencia con esos datos de prueba.
8. Una Factura de ejemplo sobre una Transacción de ingreso ya registrada (sección 7).

Este orden es exactamente el que debería seguir el script de datos sintéticos de la Fase B del plan de
Desarrollo/Testing (`app/scripts/seed-dev.mjs`), y el orden en el que conviene escribir los `.md` de la
Fase D (empezando por cuentas-pagar/cuentas-cobrar, que es el foco del ticket #30 pendiente).
