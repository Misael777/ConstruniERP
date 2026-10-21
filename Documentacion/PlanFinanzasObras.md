# Plan de implementación — Configuración del módulo de Finanzas: Obras

Fuente: `Documentacion/Cliente/ERP - CONFIGURACIÓN DEL MÓDULO DE FINANZAS OBRAS.xlsx` (1 hoja, 8 bloques de texto, 8 imágenes; la imagen de "Editar Transacción" aparece dos veces).
Fecha: 21/10/2026.

---

## 1. Qué pide el cliente (bloque por bloque)

| # | Pantalla (imagen) | Pedido |
|---|---|---|
| 1 | **Nueva venta** de Obra | Sección "Registro de adelanto" con **varios adelantos** (Adelanto 1, Adelanto 2…) y cada uno en **varias armadas** (botones "+ Agregar armada" y "+ Agregar adelanto"). Columnas: N.°, Concepto (Armada 1, 2…), Monto, Fecha de pago, **% sobre valor de venta**, **% sobre valor de armadas** (= armada ÷ total del adelanto), Comprobante, Observaciones, Acciones (editar/borrar). Totales por adelanto y tarjetas Valor venta / Adelanto registrado / Saldo por cobrar. **El asesor solo puede registrar el 1er adelanto.** |
| 2 | **Editar Transacción** (al cerrar la venta) | Al "Cerrar venta" se abre la transacción del adelanto (o de la Armada 1) para completarla. Categorías de ingreso, en este orden: **Adelanto, Valorización, Armada, Adenda**. |
| 3 | **Recibo de pago** autogenerado | Concepto = **"Adelanto"** si fue un solo pago, o **"Adelanto - Armada 1"** si fue en armadas (hoy dice "Adelanto inicial - CÓDIGO (proyecto #249)"). |
| 4 | **Ventas → lápiz** de una venta de Obra cerrada | Desde Editar venta se registra un **adelanto nuevo** o **una armada más** de un adelanto existente, **sin tocar lo ya registrado**. |
| 5 | **Editar venta** (venta cerrada) | Poder cambiar **valor de venta, comisión y datos del código** (por trabajos adicionales). **Historial de documentos**: varias proformas y contratos/**adendas**, marcando **Actual** y **Anterior** ("Agregar nueva proforma", "Agregar nuevo contrato u Adenda"). Una adenda puede traer un **Adelanto 2** con sus armadas. Recalcular % y saldos **sin alterar transacciones previas**. |
| 6 | **Cuentas por Cobrar → ojo** | Abrir el "Resumen de cobro" de la obra. |
| 7 | **Resumen de cobro** de Obra | Cabecera: valor venta, monto de adelanto, % adelanto, fecha de venta y dos barras: **avance de cobranza programada** y **efectiva**. Bloque **Adelantos** (solo lectura; desplegable con sus armadas y ojo para ver el comprobante). Bloque **Valorizaciones**: cada valorización tiene un monto planificado y **N pagos** (Pago 1, 2, 3… correlativos en toda la obra) con fecha estimada, **partidas ejecutadas**, monto, % y estado; botones "+ Agregar pago a Valorización N" y "+ Agregar valorización"; avance y estado por valorización (Pendiente / En proceso / Completada). Totales: valorizaciones + adelantos = 100 % del valor de venta. |
| 8 | **Pendiente → Editar Transacción** | Al tocar "Pendiente" de un pago se abre la transacción con categoría **Valorización**; al guardarla el pago pasa a **Cobrado** y se actualizan montos, % y avance. |

### Cómo se calculan las cifras del Resumen (verificado con los números de la imagen 7)
- **% sobre valor de venta** = monto ÷ valor de venta (15,000 ÷ 1,600,000 = 0.94 %).
- **% sobre valor de armadas** = armada ÷ total de su adelanto (15,000 ÷ 32,000 = 46.88 %).
- **Monto programado** = adelantos + pagos de valorización ya definidos (62,000 + 90,000 + 42,000 = 194,000 → 12.13 %). Las valorizaciones sin pagos (3, 4, 5) **no** cuentan como programadas.
- **Total cobrado** = adelantos + pagos cobrados (62,000 + 90,000 + 25,000 = 177,000 → 11.06 %).
- **Avance de una valorización** = cobrado ÷ su monto (25,000 ÷ 42,000 = 59.52 %).
- **Control**: Σ valorizaciones (1,520,000) + Σ adelantos (62,000) = valor de venta (1,600,000).

---

## 2. Puntos ambiguos o contradictorios (confirmar con el cliente antes de programar)

1. **Categorías "Armada" y "Adenda".** Una armada es parte de un adelanto, y una adenda es un documento (contrato), no un tipo de cobro. Si se usan como categorías, el mismo dinero quedaría clasificado de dos maneras (¿un depósito de la Armada 2 del Adelanto 2 de una adenda es "Adelanto", "Armada" o "Adenda"?) y los reportes por categoría se partirían. **Propuesta:** categoría = *Adelanto* o *Valorización*. Que es armada (o que viene de una adenda) ya lo dice su vínculo con el adelanto, y se muestra en el concepto ("Adelanto 2 – Armada 1"). Si el cliente insiste, se agregan como etiquetas visibles, sin romper los reportes.
2. **¿Solo Obra?** El Excel se titula "Finanzas Obras". Propuesta: Consultoría sigue como hoy (adelanto + abonos); Obra pasa al modelo de adelantos + valorizaciones.
3. **"El asesor solo tendrá acceso al ingreso del 1er adelanto".** ¿Quiere decir que solo administración registra el Adelanto 2 en adelante, armadas nuevas y valorizaciones? Propuesta: un permiso nuevo, asignable en Roles y Permisos.
4. **Íconos editar/borrar en los adelantos del Resumen de cobro** (imagen 7), pero el texto dice que los adelantos *no* se editan ahí. Propuesta: seguir el texto, solo lectura más el ojo del comprobante.
5. **Al cerrar la venta se abre "Editar Transacción"**, pero en Nueva venta ya se adjunta el comprobante de cada armada. Propuesta: se abre **solo para completar** la transacción ya creada de la Armada 1 (cuenta destino, n.° de operación…), no para crear otra. ¿Y las demás armadas? Propuesta: quedan completas con lo ingresado en la tabla.
6. **Cambio del valor de venta y comisión:** si la comisión del asesor ya se pagó, ¿se recalcula la diferencia? Propuesta: la comisión en S/ se recalcula y queda en el historial; cualquier pago de comisión ya hecho no se toca.
7. **Pagos de valorización con número correlativo de toda la obra** (Pago 1…15). Se asume: el número se calcula por orden de fecha y no se guarda, igual que hoy con las cuotas.
8. **Diferencia de cifras entre imágenes:** Nueva venta usa un valor de 370,000 y el Resumen uno de 1,600,000. Se toman como ejemplos distintos; las fórmulas son las mismas.

---

## 3. Diseño de datos — limpio y conectado con lo que ya existe

**Principio:** el dinero sigue viviendo donde ya vive. Cada armada y cada pago de valorización es **una fila de `cobros`** (cuota) dentro de **la única Cuenta por Cobrar** de la venta, y cada cobro cobrado tiene **su `transaccion`**, creada por `fn_confirmar_cobro` como hoy. Así siguen funcionando sin cambios:
- Control Financiero, centros de costo y saldos de cuentas bancarias;
- Panoramas de cobro, estados vencido/pendiente y el dashboard;
- las transacciones, los recibos y la auditoría.

Lo nuevo solo **agrupa** esas cuotas y versiona los documentos.

### 3.1 Tabla nueva `cobro_grupo` (adelantos y valorizaciones)
```
cobro_grupo
  id_grupo            bigserial PK
  id_cuenta_cobrar    bigint  NOT NULL → cuentas_cobrar (ON DELETE CASCADE)
  tipo                text    NOT NULL CHECK (tipo IN ('adelanto','valorizacion'))
  numero              smallint NOT NULL          -- Adelanto 1, 2… / Valorización 1, 2…
  monto_planificado   numeric(12,2)              -- valorización: su monto; adelanto: null (= Σ armadas)
  id_documento        bigint → documento_proyecto  -- contrato/adenda que lo origina (opcional)
  observaciones       varchar(200)
  activo              boolean NOT NULL DEFAULT true
  created_at          timestamptz DEFAULT now()
  UNIQUE (id_cuenta_cobrar, tipo, numero)
```
### 3.2 Columnas nuevas en `cobros`
```
cobros.id_grupo   bigint → cobro_grupo (nullable: Consultoría y cuentas manuales no lo usan)
cobros.partida    varchar(200)   -- "Partidas ejecutadas" de un pago de valorización
```
- Armada N = cobros del grupo *adelanto* ordenados por fecha. Pago N = cobros de grupos *valorización* ordenados por fecha.
- **Reemplaza el arreglo provisional del ticket #102**, que reconocía las armadas por el texto de `cobros.referencia` ("Adelanto – 2da armada"). Con `id_grupo` el nombre sale del vínculo y no del texto. `referencia` vuelve a ser solo la observación.

### 3.3 Documentos con historial (`documento_proyecto`)
- `tipo_documento`: 'Proforma' (ya existe), **'Contrato'** y **'Adenda'** nuevos.
- Columna nueva **`vigente boolean`**: el documento "Actual" de su tipo. Una sola proforma vigente y un solo contrato vigente por proyecto (índice único parcial). Los demás se muestran como "Anterior". Reemplaza a `es_proforma_final`, que se mantiene sincronizado por compatibilidad.
- Columna nueva **`monto numeric(12,2)`**: el valor que aporta el documento (ej. la adenda +S/ 55,500).
- **Migración:** los 6 `proyecto.contrato` (URL suelta) pasan a filas 'Contrato' vigentes. La columna se mantiene un tiempo por compatibilidad.

### 3.4 Historial del valor de venta — `proyecto_valor_historial`
```
id, id_proyecto, valor_anterior, valor_nuevo, comision_pct_anterior, comision_pct_nueva,
id_documento (la adenda/proforma que lo justifica), motivo, usuario, created_at
```
Un **RPC único `fn_ajustar_valor_venta(p_id_proyecto, p_valor_nuevo, p_comision_pct, p_id_documento, p_motivo)`** hace en una sola transacción:
- actualiza `proyecto.precio_venta` y `costo_estima`;
- actualiza el `monto` de la Cuenta por Cobrar y recalcula el saldo (`fn_recalcular_cuenta_cobrar`);
- escribe el historial;
- **no toca ningún cobro ni transacción ya registrado**;
- no deja bajar el valor por debajo de lo ya cobrado.

### 3.5 Permisos (Roles y Permisos)
- `registrar_adelantos_adicionales`: Adelanto 2+, armadas nuevas en una venta cerrada.
- `gestionar_valorizaciones`: crear/editar valorizaciones y sus pagos, y cobrar.
- `ajustar_valor_venta`: cambiar valor/comisión de una venta cerrada y subir adendas.

Por defecto los tres los tienen Administrador y Socio; el Asesor no.

### 3.6 Categorías y textos
- Categorías de ingreso: **Adelanto, Valorización** (y Abonos para Consultoría). "Armada" y "Adenda" quedan sujetas a la respuesta del punto 2.1.
- Concepto del recibo y descripción de la transacción: "Adelanto", o "Adelanto 1 – Armada 2"; "Valorización 2 – Pago 5 (Muros y tabiquería)".

---

## 4. Pantallas

| Pantalla | Cambio |
|---|---|
| **Nueva venta (Obra)** | `ArmadasAdelanto` pasa a ser `AdelantosVenta`: lista de adelantos, cada uno con su tabla de armadas, la columna "% sobre valor de armadas", "+ Agregar armada" y "+ Agregar adelanto" (este solo con el permiso). Al guardar: Cuenta por Cobrar, un `cobro_grupo` por adelanto y una cuota cobrada por armada. Consultoría sigue con Forma de cobranza. |
| **Cerrar venta** | Abre "Editar Transacción" de la Armada 1 (ya funciona así: `onTransaccionSugerida`). |
| **Editar venta (cerrada)** | Documentos con historial Actual/Anterior, más "Agregar nueva proforma" y "Agregar nuevo contrato u Adenda" (con su monto). Valor de venta y comisión editables con el permiso (vía `fn_ajustar_valor_venta`). Adelantos existentes en solo lectura, más "+ Agregar armada" a uno existente y "+ Agregar adelanto". |
| **Cuentas por Cobrar / Ventas → ojo** | Para Obra se abre el **Resumen de cobro de Obra** (componente nuevo `ResumenCobroObra.svelte`). Para Consultoría, el resumen de hoy. |
| **Resumen de cobro de Obra** | Cabecera con las 2 barras de avance; Adelantos desplegables (solo lectura, ojo del comprobante); Valorizaciones con sus pagos (agregar/editar/borrar un pago **pendiente**; un pago cobrado no se borra); "Pendiente" abre `TransaccionModal` con la categoría Valorización por medio del flujo de confirmación de cobro que ya existe; aviso si Σ valorizaciones + adelantos ≠ valor de venta. |
| **Transacciones** | Lista de categorías de ingreso (2.1); el N.° de cuota se muestra como "Adelanto 1 – Armada 2" o "Valorización 2 – Pago 5". |
| **Recibo de pago** | Concepto según 3.6. |

---

## 5. Fases de implementación

1. **Migración** (Dev): `cobro_grupo`, `cobros.id_grupo/partida`, `documento_proyecto.vigente/monto` y tipos nuevos, `proyecto_valor_historial`, `fn_ajustar_valor_venta`, permisos. Idempotente; backfill:
   - la venta de Obra de Prod y sus 2 cuotas → Adelanto 1 + Valorización 1;
   - los 6 contratos → filas 'Contrato';
   - la proforma final → `vigente`.
2. **Servicios**: `cobranzaObra.service.ts` (leer el resumen agrupado, crear adelanto/armada/valorización/pago, todo encima de `cobros` y `confirmarCobroCobrado`); `documentosVenta.service.ts`; `ajustarValorVenta`. Reescribir el nombre de las cuotas con `id_grupo` (quitar el regex de #102).
3. **Nueva venta / Editar venta**: adelantos múltiples, documentos con historial, ajuste de valor.
4. **Resumen de cobro de Obra** + su conexión desde Cuentas por Cobrar y Ventas.
5. **Transacción y recibo**: categorías, concepto, N.° de cuota.
6. **Pruebas en Dev** (sección 6) → `npm run check`, vitest y build → release. Migración a Prod a mano en el SQL Editor y luego `migration repair`.

Estimación: unas 4 a 6 sesiones de trabajo. Las fases 1–2 son la base; 3 y 4 son la mayor parte.

---

## 6. Pruebas en Dev (script `scripts/tests-negocio-obras.mjs`, igual que `test:negocio`)

| # | Caso | Se espera |
|---|---|---|
| O-01 | Venta de Obra 370,000 con Adelanto 1 en 3 armadas (15k/10k/7k) | 1 CxC; grupo Adelanto 1; 3 cuotas cobradas; 3 transacciones; % 4.05/2.70/1.89 y 46.88/31.25/21.88; saldo 338,000 |
| O-02 | Igual con un solo pago | Concepto del recibo "Adelanto" |
| O-03 | Asesor intenta "Agregar adelanto" | Bloqueado (sin permiso) |
| O-04 | Editar venta: agregar Armada 4 al Adelanto 1 | Cuota y transacción nuevas; las 3 anteriores intactas |
| O-05 | Adenda +55,500 → valor 425,500 con Adelanto 2 en 2 armadas | Historial de valor; CxC monto 425,500; contrato anterior "Anterior"; adenda "Actual"; transacciones previas sin cambios |
| O-06 | Bajar el valor por debajo de lo cobrado | Rechazado |
| O-07 | Crear Valorización 1 (90,000) con 3 pagos y cobrarlos | Estado "Completada" 100 %; avance programado/efectivo como en la imagen 7 |
| O-08 | Valorización 2 con 1 de 3 pagos cobrado | "En proceso" 59.52 % |
| O-09 | Valorizaciones sin pagos | No cuentan en "programado" |
| O-10 | Borrar un pago cobrado | Rechazado; uno pendiente sí se borra |
| O-11 | Σ valorizaciones + adelantos ≠ valor de venta | Aviso visible, no rompe |
| O-12 | Anular la transacción de una armada | La cuota vuelve a pendiente y los saldos se recalculan (comportamiento actual de anulación) |
| O-13 | Control Financiero / centro de costo / cuenta bancaria | Los saldos reflejan cada armada y pago (ya integrado vía `transaccion`) |
| O-14 | Consultoría | Sin cambios: Forma de cobranza, adelanto y abonos como hoy |
| O-15 | Migración aplicada dos veces | Idempotente; la venta de Obra de Prod migrada se ve igual que antes |

Además: capturas sin sesión de cada pantalla (escritorio y celular) y una prueba manual en Dev con sesión.

---

## 7. Riesgos

- **Prod tiene 1 sola venta de Obra (2 cuotas)** → es el mejor momento para cambiar el modelo: la migración es trivial.
- No mezclar "Armada/Adenda" como categorías sin decidir el punto 2.1: rompería los reportes por categoría.
- El ajuste del valor de venta debe ser **solo** por el RPC (atómico), nunca con un UPDATE suelto desde la pantalla.
