# Guía para agentes de IA — ConstruniERP

Documento de traspaso para otro agente (Claude Code u otro) que vaya a trabajar en este repo. Cubre: (1) el servidor
MCP ("Axigh", el nombre que le da el equipo; inspirado en gh-axi), (2) las dos bases de datos (Dev y Producción),
(3) las políticas de uso, y (4) las políticas de los tests de negocio. Léelo completo antes de tocar datos.

> Estado descrito: 2026-09-25. Si algo aquí contradice el código o la base, **manda lo que observes ahora** y
> corrige este documento. Ningún secreto vive aquí: las credenciales están en archivos locales ignorados por git.

Documentos hermanos: [FlujoDeNegocio.md](FlujoDeNegocio.md) (proceso de negocio de punta a punta),
[AgentTools.md](AgentTools.md) (arquitectura de la capa de herramientas), [tests/README.md](tests/README.md)
(suite de tests de negocio y hallazgos), [MecanismoCICD.md](MecanismoCICD.md) (releases),
[../supabase/migrations/README.md](../supabase/migrations/README.md) (migraciones),
[GuiaDevYTests.md](GuiaDevYTests.md) (manual paso a paso de la base Dev, migraciones y cómo escribir/correr tests).

---

## 0. Reglas de oro (si solo lees una sección, lee esta)

1. **Producción es datos reales de clientes.** Solo se escribe en Producción en el módulo **Tickets/Panel Developer**
   (por decisión explícita del dueño del proyecto). Todo lo demás se prueba en **Dev**.
2. **Los cambios de esquema van como archivo de migración** en `supabase/migrations/`, primero a Dev, verificados, y
   recién después a Producción **con confirmación del usuario**. Nunca SQL suelto contra Producción.
3. **Nunca imprimas, commitees ni pegues credenciales** (`app/.env`, `app/.env.dev`, contraseñas de base, claves
   `service_role`). Están gitignoreadas; verifica con `git status` antes de cualquier commit.
4. **Si el clasificador de permisos de Claude Code bloquea una acción** (push a Producción, borrado masivo), **no la
   esquives** con otra vía. Explica al usuario qué querías hacer y dale el comando exacto para que lo corra él.
5. **No cierres ni marques nada como hecho sin haberlo verificado** (tests corridos, datos leídos). Sé explícito
   sobre lo que probaste y lo que no (por ejemplo: "probé la capa de servicio, no la pantalla").

---

## 1. Qué es ConstruniERP (contexto mínimo)

- App **SvelteKit 5 (runes) + Supabase + Tauri v2** (escritorio y Android), `adapter-static`: **no hay servidor
  SvelteKit en tiempo de ejecución**. Los `+page.server.ts`/`+server.ts` son código muerto o de prerender; toda la
  lógica corre en el cliente contra Supabase.
- Código en `app/`. Módulos de negocio en `app/src/lib/modules/*` (cada uno con `services/*.service.ts`, algunos con
  `config/*.config.ts` que definen los campos de formularios/tablas — `FieldConfig`).
- Seguridad: RLS está activo solo en **algunas** tablas: las de Soporte/Solicitudes/Tickets, más `documento_proyecto`,
  `empleados`, `roles`, `permisos`, `roles_permisos`, `cronograma_*`, `plantilla_*`, `restriccion` y
  `app_version_usuario`. Sus políticas son "usuario autenticado puede todo" (o "solo admin" para escribir en
  empleados/roles/permisos). **Consecuencia importante:** una sesión caducada (rol `anon`) sí falla en esas tablas con
  `violates row-level security policy` (código 42501), pero **puede seguir insertando** en las demás (`proyecto`,
  `transaccion`, `cuentas_*`…), que no tienen RLS. El resto del ERP se controla en la UI (`isAdmin()`,
  `permisosState`). La clave `service_role` (la del MCP) **se salta RLS** y puede leer y escribir cualquier tabla; el
  único candado real para los agentes es *a qué proyecto apunta* (ver §3).
- Proceso de negocio (qué se llena primero y qué depende de qué): [FlujoDeNegocio.md](FlujoDeNegocio.md).
- Regla no obvia central: **casi todo movimiento de dinero es una Transacción entre dos Centros de Costo**
  (`id_centro_costo_origen` → `id_centro_costo_destino`), y los centros de costo de clientes, proveedores, empleados y
  proyectos **se crean solos** (`getOrCrearCentroCostoParaEntidad`).

---

## 2. Las dos bases de datos

| | **Producción** | **Desarrollo** |
|---|---|---|
| Proyecto Supabase | `CONSTRUNISYS` | `construnierp-dev` |
| Ref del proyecto | `nqffgnbcwsixlaodhaku` | `hlfaxszecrxgkbjafepv` |
| Archivo de credenciales | `app/.env` | `app/.env.dev` |
| Pooler (Postgres) | `aws-1-us-west-1.pooler.supabase.com:5432` | `aws-0-us-east-1.pooler.supabase.com:5432` |
| Datos | **Reales** (clientes, ventas, cobros, tickets) | **Sintéticos** (nunca copiar datos de Producción) |
| Escritura desde agentes | **Solo Tickets/Releases** | Todo |

### 2.1 Variables de cada archivo (mismos nombres en ambos; el archivo cargado decide el entorno)

`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` (URI de Postgres por
el **Session pooler**, con la contraseña percent-encoded — `#` → `%23`). `app/.env` además trae las claves de Google
Drive y de firma de Tauri. **Nunca hay una variable "modo"**: el entorno se deduce de la URL (ver §3.3).

Por qué el pooler y no la conexión directa: en proyectos nuevos de Supabase la conexión directa es solo IPv6 y el
contenedor Docker del CLI no la resuelve (`could not translate host name`).

### 2.2 Esquema (resumen técnico)

- Esquema `public`, ~59 tablas. Baseline en `supabase/migrations/20260924144941_baseline.sql` (volcado real de
  Producción, solo estructura). Dev se creó aplicando esa migración.
- Tablas núcleo por módulo:
  - **Acceso:** `empleados`, `roles`, `permisos`, `roles_permisos`, `area`.
  - **Comercial:** `cliente`, `proyecto` (una "venta" ES un proyecto; `tipo_venta` obra|consultoria,
    `estado_proyecto` activo|venta_cerrada|baja), `contrato_proyecto`, `documento_proyecto`.
  - **Finanzas:** `centro_costo`, `transaccion`, `cuentas_pagar` + `pagos`, `cuentas_cobrar` + `cobros`,
    `cuenta_banco`, `proveedor`, `factura` + `factura_detalle` + `factura_archivo`, `conciliacion_financiera`,
    `apertura_financiera`, `incidencia`.
  - **Proyectos:** `presupuesto` + `presupuesto_detalle` + `partida`, `cronograma_*`, `plantilla_*`.
  - **Soporte:** `ticket`, `ticket_comentario`, `ticket_evento`, `app_release`, `app_version_usuario`
    (con RLS).
- **Funciones SQL (RPC) que sostienen la integridad financiera** — nunca las reimplementes en el cliente:
  `fn_crear_transaccion` (bloqueo, chequeo de saldo del centro origen, inserta, recalcula cuentas bancarias),
  `fn_confirmar_pago` / `fn_confirmar_cobro` (atómicas: crean la transacción y el pago/cobro; parten una cuota si
  se paga de menos; rechazan pagar de más), `fn_recalcular_cuenta_pagar` / `fn_recalcular_cuenta_cobrar` (derivan
  `monto_pagado|cobrado`, `saldo_pendiente`, `estado` desde `pagos`/`cobros`), `fn_recalcular_saldo_cuenta_banco`,
  `fn_monto_soles_transaccion` (equivalente en soles de una transacción, con conversión de dólares),
  `fn_emitir_factura`, `fn_asignar_folio_factura` (trigger).
- Columnas con nombres engañosos: `cuentas_pagar.fotma_pago` (typo real, sin "r"), `cuentas_cobrar."condición_pago"`
  (con tilde literal), `cobros.numero_opracion` (typo), `transaccion.cuente_origen/destino` (typo; guardan el
  `numero_cuenta` de una cuenta bancaria).

### 2.3 Reglas de negocio confirmadas (2026-09-25) — las que más se violan por error

- **Cuentas por Pagar y por Cobrar se comportan igual:** `monto_pagado|cobrado`, `saldo_pendiente` y `estado` se
  derivan de **sus propios** `pagos`/`cobros`; nunca se escriben a mano. (Antes, Cobrar derivaba de todos los
  ingresos al centro de costo; se cambió por decisión del cliente.)
- El monto de una cuenta es **siempre en soles**. Ambas pueden estar en dólares (`moneda = 'USD'`,
  `monto = monto_dolares × tipo_cambio`). Cada pago/cobro descuenta el **equivalente en soles** de su transacción; una
  transacción en dólares **exige `tipo_cambio`**.
- **"Frecuencia de Pago"** (solo Pagar) crea **varias cuentas** independientes, cada una por el monto íntegro.
  **"Fraccionar este pago"** crea **una** cuenta con **cuotas** (filas `programado` en `pagos`/`cobros`) que deben
  sumar **exactamente** lo que falta por pagar/cobrar. Para cambiar la periodicidad del saldo restante a mitad de un
  plan se usa Fraccionar, no Frecuencia.
- **Pagar una cuota programada**: vía `confirmar_pago_cuota` / `confirmar_cobro_cuota`. Con un monto **menor** que la
  cuota, la cuota se **parte** (lo abonado queda `pagado`, el resto `programado` en la misma fecha); con uno **mayor**
  se rechaza. Un pago **suelto** (`registrar_pago_*`) se rechaza si las cuotas ya cubren el 100 %.
- El **lápiz** de una cuota (editar su monto) reajusta la **última** cuota pendiente para que el total cuadre, y ahora
  rechaza: montos que dejarían una cuota negativa, cambiar el monto de la única cuota pendiente, y cambiar el monto de
  una cuota ya pagada.
- Un centro de costo vinculado a una entidad **no se borra directo**; se borra en cascada al borrar la entidad dueña.
- `cuenta_banco.saldo_actual` **nunca se escribe**: se recalcula siempre.

---

## 3. El servidor MCP ("Axigh")

### 3.1 Qué es

Una **capa de herramientas** (`app/src/lib/server/agent-tools/`) expuesta por un servidor MCP por **stdio**
(`app/mcp-server/index.ts`). Las herramientas **envuelven las funciones de servicio reales** del ERP
(`*.service.ts`), así pasan por las mismas reglas de negocio que la interfaz; **no son CRUD crudo sobre tablas**.
El diseño permite, a futuro, reusar la misma capa desde un chat embebido en la app (sin MCP de por medio).

Archivos clave:

| Archivo | Rol |
|---|---|
| `agent-tools/registry.ts` | Tipo `AgentTool`, `crearRegistro`, `filtrarPorEntorno` (el candado Dev/Prod) |
| `agent-tools/tools/tickets.ts` | Soporte/Tickets (re-implementado standalone: `tickets.service.ts` importa código Svelte) |
| `agent-tools/tools/cuentas-pagar.ts`, `cuentas-cobrar.ts` | Finanzas |
| `agent-tools/tools/catalogos.ts` | Proveedores, clientes, centros de costo, cuentas bancarias, transacciones |
| `agent-tools/tools/_util.ts` | Helpers (`desempaquetar`, validaciones, `USUARIO_AGENTE`) |
| `mcp-server/index.ts` | Servidor: elige entorno por URL, filtra herramientas, atiende `tools/list` y `tools/call` |
| `scripts/lib-resolver.mjs` + `register-lib-resolver.mjs` | Permiten a Node puro resolver `$lib/...` e imports sin extensión para cargar los `*.service.ts` reales |
| `scripts/mcp-call.mjs` | Cliente de línea de comandos (ver §3.4) |

### 3.2 Dos servidores, un mismo código

| Nombre en Claude Code | Comando | Archivo de entorno | Herramientas |
|---|---|---|---|
| `construnierp` | `npm run mcp` | `app/.env` (Producción) | **16**: todas las lecturas + Tickets |
| `construnierp-dev` | `npm run mcp:dev` | `app/.env.dev` (Dev) | **31**: lecturas + escrituras |

Ambos están registrados con `claude mcp add` (scope local del proyecto). Herramientas de Producción:
`listar_tickets`, `ver_ticket`, `ultima_version_app`, `versiones_instaladas`, `ver_imagen_adjunta` y todas las
`listar_*`, `ver_*`, `auditar_*`. Las de escritura solo existen en Dev.

### 3.3 Cómo se separa Dev de Producción (el candado)

1. `mcp-server/index.ts` mira `PUBLIC_SUPABASE_URL`: contiene el ref de Dev → `dev`; el de Producción → `prod`;
   cualquier otro → **aborta**.
2. Cada herramienta que escribe lleva `escritura: true`. `filtrarPorEntorno` **no las registra en `prod`**, salvo las
   que además tengan `escrituraEnProd: true` (hoy ninguna herramienta MCP; Tickets se escribe con scripts, ver §5.4).
3. La `service_role` se salta RLS, así que **este filtro es la única barrera**. Si añades una herramienta de
   escritura, **márcala `escritura: true`** siempre.

### 3.4 Cómo usarlo

**Ojo importante (estado conocido):** `claude mcp list` puede mostrar "✔ Connected" y aun así las herramientas
`mcp__construnierp__*` **no aparecer** en la lista nativa de la sesión (a veces se arregla reiniciando la extensión
de VS Code). Antes de asumir que existen, búscalas; si no están, usa el cliente de línea de comandos, que funciona
siempre:

```bash
cd app
node scripts/mcp-call.mjs dev list                    # catálogo de herramientas de Dev
node scripts/mcp-call.mjs prod list                   # catálogo de Producción
node scripts/mcp-call.mjs dev '[{"name":"listar_cuentas_pagar","arguments":{"limit":5}}]'
node scripts/mcp-call.mjs prod '[{"name":"ver_ticket","arguments":{"id_ticket":30}}]'
```

(`npm run mcp:call -- dev list` es equivalente.) Se pueden encadenar varias llamadas en el arreglo. Los errores de
regla de negocio llegan como `(ERROR)` con el **mensaje real del servicio** (por ejemplo "El monto supera el de la
cuota…"), no como éxito ambiguo.

### 3.5 Catálogo de herramientas

**Tickets / Soporte** (lectura): `listar_tickets`, `ver_ticket {id_ticket}` (con comentarios e `imagen_url`),
`ver_imagen_adjunta {imagen_url}` (devuelve la imagen real), `ultima_version_app`, `versiones_instaladas` (qué versión
tiene cada usuario/dispositivo).

**Catálogos** (lectura): `listar_proveedores`, `listar_clientes`, `listar_centros_costo {tipo?}` (necesitas sus ids
para toda transacción), `listar_cuentas_bancarias`, `listar_transacciones {id_centro_costo?, tipo?, limit?}`.
Escritura (Dev): `crear_transaccion {payload}`.

**Cuentas por Pagar** — lectura: `listar_cuentas_pagar {id_proveedor?, estado?, limit?}`,
`ver_cuenta_pagar {id_cuenta_pagar}` (cuenta + cuotas + transacciones), `auditar_cuentas_pagar {id_cuenta_pagar?}`.
Escritura (Dev): `crear_cuenta_pagar {payload, fracciones?}`, `crear_serie_cuentas_pagar {payload}`,
`registrar_pago_cuenta_pagar {id_cuenta_pagar, transaccion}`, `confirmar_pago_cuota {id_pago, transaccion}`,
`refraccionar_cuenta_pagar {id_cuenta_pagar, fracciones}`, `actualizar_cuenta_pagar {id_cuenta_pagar, cambios}`,
`editar_cuota_pago {id_pago, cambios, estado_pago?}`, `dar_de_baja_cuenta_pagar {id_cuenta_pagar}`.

**Cuentas por Cobrar** — lectura: `listar_cuentas_cobrar`, `ver_cuenta_cobrar`, `auditar_cuentas_cobrar`.
Escritura (Dev): `crear_cuenta_cobrar`, `registrar_cobro_cuenta_cobrar`, `confirmar_cobro_cuota`,
`refraccionar_cuenta_cobrar`, `actualizar_cuenta_cobrar`, `editar_cuota_cobro` (mismas firmas, con `id_cuenta_cobrar`
/ `id_cobro`).

**Forma del `transaccion`** que piden `registrar_*` y `confirmar_*` (campos obligatorios): `tipo_alcance`
(`externa`|`interna`), `id_centro_costo_origen`, `id_centro_costo_destino`, `fecha` (`YYYY-MM-DD`), `categoria`
(del catálogo de `transaccion.config.ts`: Adelanto, Valorización, Abonos, Honorarios, Servicios, Compras…),
`monto_total`, `tipo` (`ingreso`|`egreso`|`financiamiento`|`transferencia`), `tipo_moneda` (`soles`|`dolares`; si es
dólares, también `tipo_cambio`). Sentido del dinero: en un **pago**, origen = centro que paga y destino = centro del
proveedor; en un **cobro**, origen = centro del cliente y destino = centro que recibe. Las herramientas añaden solas
un `comprobante_url` de relleno.

**Las herramientas `auditar_*` son la base de los tests:** recalculan desde la fuente y devuelven **solo las
inconsistencias** (monto pagado vs suma de pagos, saldo, suma de cuotas, pago sin transacción, monto del pago vs su
transacción en soles, estado). Se pueden llamar contra Producción (solo lectura) para vigilar la salud de los datos.

### 3.6 Cómo añadir una herramienta nueva

1. Archivo nuevo en `agent-tools/tools/<dominio>.ts` exportando `AgentTool[]` (nombre, descripción **útil para un
   agente**, `inputSchema`, `permiso`, `handler`).
2. **Envuelve la función de servicio real** (`import ... from '$lib/modules/...'`) — no reescribas la regla de negocio.
   Solo reimplementa standalone si el servicio importa `$env/*`, `*.svelte.ts` (runes) o componentes: Node puro no
   puede cargarlos (ejemplos: `tickets.service.ts`, `aprobaciones.service.ts`, `facturacion.service.ts`).
3. Si escribe datos: `escritura: true`. Devuelve compacto (no vuelques el JSON crudo de Supabase).
4. Regístrala en `mcp-server/index.ts` (`crearRegistro(...)`), corre `npm run check` y pruébala con `mcp-call.mjs`.
5. Si tiene una regla comprobable, añade su `auditar_*` o casos al test correspondiente.

---

## 4. Trabajar con las bases de datos

### 4.1 Requisitos
Supabase CLI (`supabase`), **Docker Desktop encendido** (el CLI ejecuta `pg_dump`/`pg_diff` dentro de un contenedor;
si falla con "cannot find the file specified" en `dockerDesktopLinuxEngine`, arráncalo y espera a que `docker info`
responda), y Node ≥ 22 (usa `--experimental-strip-types`).

### 4.2 Comandos habituales (desde la raíz del repo)

```bash
# Extraer la URL de cada entorno sin cargar el .env completo (algunas líneas tienen espacios y rompen `source`)
DEV_URL=$(grep '^SUPABASE_DB_URL=' app/.env.dev | cut -d'=' -f2-)
PROD_URL=$(grep '^SUPABASE_DB_URL=' app/.env    | cut -d'=' -f2-)

supabase migration list --db-url "$PROD_URL"                 # qué migraciones tiene aplicadas (solo lectura)
supabase db dump --db-url "$PROD_URL" --schema public -f x.sql   # volcado de estructura (solo lectura)
supabase db push --db-url "$DEV_URL" --yes                   # aplica migraciones pendientes a Dev
supabase db push --db-url "$PROD_URL" --dry-run              # ver qué se aplicaría a Producción (sin aplicar)
```

Para ejecutar un `.sql` suelto contra Dev (por ejemplo para probar un backfill), sin `psql` local:
`MSYS_NO_PATHCONV=1 docker run --rm -v "<ruta windows>\supabase\migrations:/m" postgres:17 psql "$DEV_URL" -f /m/<archivo>.sql`.

### 4.3 Política de migraciones
- Un cambio de esquema = **un archivo nuevo** `supabase/migrations/YYYYMMDDHHMMSS_descripcion.sql` (UTC), idempotente
  (`IF NOT EXISTS`, `CREATE OR REPLACE`), terminado en `NOTIFY pgrst, 'reload schema';`.
- Orden: **Dev → verificar (tests) → Producción con confirmación del usuario**. Nunca `DROP`/`TRUNCATE`/`db reset` en
  Producción; nunca `db reset` en Dev con datos que importen.
- Los ~89 `*_migration.sql` sueltos en la raíz del repo son el **historial anterior** (se aplicaban a mano en el SQL
  Editor); se conservan como registro y **no** se re-aplican. Fueron una fuente real de deriva: hubo migraciones que
  nunca se corrieron en Producción y funciones que una migración posterior revirtió. Antes de dar por sentado que algo
  existe en Producción, **compruébalo** (`supabase db dump` o una consulta de solo lectura).
- Si el usuario aplica una migración a mano en el SQL Editor de Producción, hay que registrarla en el historial:
  `supabase migration repair --status applied <version> --db-url "$PROD_URL"`.

### 4.4 Migraciones y su estado
| Versión | Contenido | Dev | Producción |
|---|---|---|---|
| `20260924144941_baseline` | Estructura completa | sí | sí (marcada aplicada) |
| `20260924160000_fn_crear_transaccion_columnas_faltantes` | La función descartaba `categoria`, `tipo_moneda`, `tipo_cambio`, `monto_convertido`, documento pendiente | sí | sí |
| `20260924170000_cuentas_pagar_id_cuenta_pagar_padre` | Columna que encadena series por Frecuencia | sí | sí |
| `20260925000000_cuentas_moneda_cuota_parcial_cobros_propios` | Pagar en USD; cuota parcial se parte; Cobrar desde cobros propios; TC obligatorio en dólares | sí | sí |
| `20260925000100_backfill_cobros_desde_ingresos_al_centro` | Convierte los ingresos previos al centro en `cobros` para conservar saldos | sí | sí |
| `20260925120000_cuenta_banco_numero_cuenta_unico` | Índice único de `numero_cuenta` entre cuentas activas; solo se crea si no hay duplicados (en Producción sí los hay, así que se omite con un aviso) | sí | sí |
| `20260925130000_cuenta_banco_renombrar_numeros_duplicados` | Renombra las cuentas activas repetidas (WILLY `EFECTIVO` → `EFECTIVO-16`; la más antigua conserva el número y la transacción #259), recalcula sus saldos y crea el índice único | sí | sí |
| `20260925140000_cuentas_cobrar_prioridad_orden` | Columna calculada `prioridad_orden` (alto 1, medio 2, bajo 3, sin prioridad 4) para ordenar Cuentas por Cobrar por Prioridad (ticket #39) | sí | sí (aplicada a mano; **falta** `migration repair`) |
| `20260929155944_centro_costo_corporativo_unico` | Crea el centro Corporativo (`bolsa general`) si falta e índice único `uq_centro_costo_corporativo_activo` (un solo Corporativo activo). "Nuevo Centro de Costo" ya solo crea Otro/Préstamo | **pendiente** | **pendiente** |
| `20261001152541_cliente_nombre_mayusculas` | Solo datos: pasa a mayúsculas los nombres de clientes existentes | sí | sí (aplicada a mano; **falta** `migration repair`) |
| `20261002000000_cuentas_pagar_prioridad_orden` | Columna calculada `prioridad_orden` (alto 1, media 2, bajo 3, sin prioridad 4) para ordenar Cuentas por Pagar por Prioridad (ticket #45) | sí | sí (aplicada a mano; **falta** `migration repair`) |
| `20261002120000_auditoria` | Control de Accesos → Auditoría (ver §7c): tablas `auditoria_sesion`/`_accion`/`_error`, RPCs, trigger de cambios en 14 tablas de negocio, permiso `ver_iam_auditoria`, purga 14/7 días. Probada en un Postgres 16 local temporal (con stubs de `auth.uid()`), idempotente | sí | sí (aplicada a mano; **falta** `migration repair`) |
| `20261003000859_restaurar_centros_costo_borrados` | Solo datos: recrea con el MISMO id los 17 centros de costo (6 proyectos de obra, 11 clientes) borrados fuera de la app ~23/09/2026 mientras sus transacciones de adelanto los seguían usando, y crea el de la venta de obra #114. Idempotente | no aplica (solo datos de Producción) | sí |
| `20261006040943_cuentas_cobrar_ventas_cerradas` | Solo datos: crea la Cuenta por Cobrar de cada venta cerrada que no tiene una (Valor venta; ingresos ya recibidos en su centro de costo como cuotas cobradas; saldo como cuota pendiente a 30 días). Omite con NOTICE los casos ambiguos. **Correr después de** `20261003000859`. Probada en PGlite (Postgres 16 WASM), idempotente | — | **pendiente** |
| `20261007021157_factura_columnas_detraccion_y_notas` | Agrega a `factura` las columnas que la app usa desde "emision" (26/09) y faltaban en Producción: `detraccion_tipo_operacion`, `detraccion_codigo_bien`, `tipo_nota`, `folio_referencia`, `folio_nueva_factura`; `detraccion_medio_pago` pasa a TEXT; y `fn_emitir_factura` permite emitir una Nota de Crédito que solo referencia otra factura (Error en el RUC, Descuento Global) sin transacciones. Reemplaza al archivo suelto `factura_migration.sql` (que además BORRA columnas: no correrlo en Producción). Probada en PGlite, idempotente | sí | sí |
| `20261013015954_permisos_submodulos_proyectos` | Permisos de los submódulos nuevos de Proyectos (`ver_proyectos_consultoria`, `_obra`, `_catalogo`, `_reuniones`); se dan a todo rol que ya tenga `ver_proyectos`. Probada en PGlite, idempotente | sí | **pendiente** (no verificable con anon) |
| `20261013021830_catalogo_recursos` | Proyectos → Catálogo: tablas `recurso_familia` (árbol Tipos y familias, con semilla) y `unidad_medida` (con semilla); `recurso_precio` (vacía, sin uso previo) pasa a ser el catálogo de recursos: tipo acepta `subcontrato`, + `codigo` (único), `id_familia`, `id_proveedor`, `observaciones`, `activo`, `usuario_registro`, `updated_at` (trigger). Probada en PGlite, idempotente | sí | sí (verificado 2026-10-27) |
| `20261013040000_catalogo_partidas_apu` | Proyectos → Catálogo → Partidas: tablas `partida_especialidad` (árbol de especialidades por ámbito obra/consultoría, con semilla y `prefijo` para el código EST-001…), `partida_catalogo` (código único, unidad, rendimiento, jornada, P.U. de referencia, `activo`) y `partida_catalogo_apu` (recursos de `recurso_precio` con cuadrilla/cantidad/incluido; borrar un recurso usado queda bloqueado, borrar la partida borra su APU); unidad `%mo`. La tabla `partida` existente no se toca. Requiere `20261013021830`. Probada en PGlite, idempotente | sí | sí (verificado 2026-10-27) |
| `20261003011526_factura_archivo_sunat` | Amplía `factura_archivo.tipo` con `'sunat'`: el archivo original de SUNAT del que se leyeron los datos (modo "PDF de SUNAT" de Emisión de Comprobante) | **pendiente** | **pendiente** |
| `20261002130000_sincronizar_reversion_venta_y_verificacion_admin` | Sincroniza a `migrations/` lo que estaba solo en Producción (corrido a mano desde 3 archivos sueltos de la raíz, 2026-09-28): columna `proyecto.id_transaccion_cierre`, `fn_revertir_venta_por_transaccion`, `fn_anular_transaccion` (versión con reversión de venta) y `fn_verificar_credenciales_admin`. Copiadas tal cual de Producción | sí | ya estaba (**falta** `migration repair`) |
| `20261023182400_saldo_cuenta_banco_siempre_consistente` | `cuenta_banco.saldo_actual` se recalcula SOLO en la BD con triggers: en `transaccion` (crear/borrar/cambiar cuenta, monto, estado o fecha → cuentas de antes y de después), `apertura_financiera` y `cuenta_banco` (alta, saldo inicial, número). Antes dependía de que la app llamara a `fn_recalcular_saldo_cuenta_banco` y varios caminos no lo hacían (ej. eliminar Cuenta por Cobrar/Pagar borra sus transacciones): Producción quedó con S/ 107,000 fantasma (BCP GUILLERMO 37,000 + EFECTIVO - WILLY 70,000). Recalcula todas las cuentas una vez. Probada en PGlite (11 casos), idempotente | sí | sí (verificado 2026-10-27) |
| `20261026211005_detraccion_venta` | Detracción en ventas: `proyecto.detraccion_porcentaje` (NULL = sin detracción, CHECK 0–100) y en `cobros` las columnas `es_detraccion` + `id_cobro_origen` (FK a la cuota de origen, ON DELETE CASCADE). Además `transaccion.id_transaccion_origen` (FK, ON DELETE SET NULL): la transacción de una detracción cobrada junto con su armada queda relacionada a la de la armada. Cada cuota de la venta se parte en neto + detracción (vence 5 días hábiles después); lógica en `$lib/shared/detraccion.ts` y `cuentas-cobrar/services/detraccion.service.ts`. Probada en PGlite, idempotente | sí | sí (verificado 2026-10-27) |
| `20261030120000_asistencia_huellero` | Asistencia con huelleros ZKTeco por ADMS sin servidor propio: tablas `asistencia_dispositivo` (por número de serie; nuevo = `pendiente` hasta asignarle obra), `asistencia_trabajador` (pin = ID en el huellero), `asistencia_marcacion` (única por huellero+pin+hora) `asistencia_trafico` (peticiones crudas de los huelleros, 15 días, sin datos de usuarios ni biometría) y `asistencia_config` (sin acceso para anon/authenticated). `fn_asistencia_ingesta` (SECURITY DEFINER, ejecutable por anon) valida un token contra `asistencia_config.token_ingesta_sha256`; la llama el Worker `servicios/huellero-adms/worker.js`. El hash del token se carga a mano en cada entorno (no va en la migración). Idempotente | sí | sí (2026-11-02, SQL Editor) |
| `20261102120000_permisos_personal_asistencia` | Permisos del módulo "Personal y Asistencia" (`ver_rrhh`, `ver_rrhh_personal`, `ver_rrhh_asistencia`, `ver_rrhh_huelleros`), asignados a administrador y socio. Idempotente | sí | sí (2026-11-02, SQL Editor) |
| `20261102130000_personal` | `asistencia_trabajador` pasa a ser la ficha `personal` (id_personal; dni → numero_documento) con datos personales, régimen (construcción civil: categoría + jornal / general: cargo + sueldo), obra, ingreso/cese, pensión, banco, SCTR y examen médico. Único (tipo_documento, numero_documento). `fn_asistencia_ingesta` recreada para escribir en `personal`. Debe aplicarse después de 20261030120000. Idempotente | sí | sí (2026-11-02, SQL Editor) |
| `20261102150000_huellero_comandos` | Cola `asistencia_comando` ERP → huelleros (PUSH 3.x): triggers en `personal` (alta/cambio → DATA UPDATE user + userauthorize; baja, cambio de obra o código → DATA DELETE user) y en `asistencia_dispositivo` (al asignar obra recibe el personal de la obra). `fn_asistencia_comandos`/`fn_asistencia_resultados` (token, las usa el Worker en getrequest/devicecmd), `fn_asistencia_sincronizar` (sesión; DATA QUERY user + reenvío). Idempotente | sí | sí (2026-11-02, SQL Editor) |
| `20261102160000_horarios` | Catálogo `horario` + `horario_dia` (entrada/salida/refrigerio por día ISO, tolerancia), `personal.id_horario`, permiso `ver_rrhh_horarios`; crea 2 horarios de ejemplo si el catálogo está vacío. Idempotente | sí | sí (2026-11-02, SQL Editor) |
| `20261102170000_personal_huellero` | Huelleros por trabajador independientes de la obra (`personal_huellero`): vincular/desvincular encola alta/retiro; cambios de código/nombre/estado se reenvían a todos sus huelleros; un huellero asignado a obra/área se vincula al personal de esa obra/área. Lo que llega desde el huellero lo vincula sin encolar órdenes (`asistencia.desde_huellero`). Recrea `fn_asistencia_ingesta` y `fn_asistencia_sincronizar`; reemplaza el trigger de 20261102150000. Idempotente | sí | sí (2026-11-02, SQL Editor) |
| `20261102180000_personal_mover` | `fn_personal_mover(ids, centro, cambiar_huelleros)`: "Mover a otra obra o área" masivo; quita los huelleros de la obra anterior y agrega los de la nueva (los triggers encolan retiro/alta). Idempotente | sí | sí (2026-11-02, SQL Editor) |
| `20261102190000_personal_biometria` | Huella/rostro que viajan con el trabajador (Ley 29733): `personal.consentimiento_biometrico`/`consentimiento_fecha`; `personal_biometria` con la plantilla cifrada (pgp_sym_encrypt, clave propia del entorno generada en `asistencia_config.clave_biometria`, sin acceso por API); `fn_asistencia_biometria` (Worker), `fn_asistencia_encolar_alta` encola `BIODATA <id>` y `fn_asistencia_comandos` lo arma/descifra al entregarlo; quitar el consentimiento borra las plantillas; `fn_personal_biometria_resumen`. Idempotente | sí | sí (2026-11-02, SQL Editor) |
| `20261102200000_personal_periodicidad_pago` | `personal.periodicidad_pago` (diaria/semanal/quincenal/mensual) + `monto_pago` (monto por ese periodo); migra `jornal_diario` → diaria y `sueldo_mensual` → mensual y borra ambas columnas. Re-ejecutable | sí | sí (2026-11-02, SQL Editor) |
| `20261103120000_huellero_destino` | `asistencia_dispositivo.destino` (produccion/desarrollo): a qué base envía cada huellero. `fn_asistencia_destino(token, sn)` para el receptor (con variables `DEV_*` reenvía a Dev); trigger que solo deja cambiarlo al rol developer (botón "Huelleros" de la barra superior, `EntornoHuelleros.svelte`). Idempotente | sí | sí (2026-11-02, SQL Editor) |
| `20261103130000_huella_por_huellero` | `personal_huellero.huellas/rostros/dedos/biometria_at`: cuántas huellas y rostros tiene cada trabajador en cada huellero (solo el número, para todos, sin plantilla). Lo actualizan `fn_asistencia_biometria` (al registrar en el equipo o al Sincronizar), `fn_asistencia_sincronizar` (ahora también pide `DATA QUERY biodata`) y el trigger `trg_asistencia_biodata_confirmada` (copia confirmada). Aviso rojo "Falta registrar huella" en Personal. Idempotente | sí | sí (2026-11-03, SQL Editor) |
| `20261103140000_huellero_grupo_acceso` | `fn_asistencia_encolar_alta` envía los usuarios al huellero con `Group=1` (antes 0): en el grupo 0 el SenseFace 2A los rechazaba aunque reconociera la huella ("Verificación fallida", evento 48 en rtlog). Tras aplicarla, Sincronizar cada huellero. Idempotente | sí | sí (2026-11-03, SQL Editor) |
| `20261103150000_horario_libre` | `horario.tipo` (fijo/libre) + horario "Horario libre". Libre = por horas, sin `horario_dia`: Asistencia suma por día los tramos entre marcas (entrada→salida…), sin tardanza, faltas ni horas extra. Idempotente | sí | **pendiente** |
| `20261104120000_comprobante_venta` | `factura.tipo_comprobante` admite `comprobante_venta` (tipo_documento 12 de transacciones) + secuencia `comprobante_venta_folio_seq` y serie `CV01-` en `fn_asignar_folio_factura`. En Emisión de comprobantes: opción "Emitir Comp. de Venta" y pestaña Comprobante de Venta. Idempotente | sí | **pendiente** |
| `20261105120000_personal_pin_correlativo` | "Número en huellero" autogenerado: secuencia `personal_pin_seq` (arranca tras el mayor número de hasta 6 dígitos ya usado) + trigger BEFORE INSERT `fn_personal_asignar_pin` que asigna el siguiente libre si el pin viene vacío. Los que llegan del huellero conservan su número. Idempotente | sí | **pendiente** |
| `20261106130000_mi_asistencia` | "Mi asistencia": índice único en `personal.id_empleado` (ficha ↔ usuario del ERP), `asistencia_marcacion.origen` ('huellero'/'erp') con `id_dispositivo` opcional, RPC `fn_mi_asistencia` / `fn_mi_asistencia_marcar` (SECURITY DEFINER, cada usuario solo lo suyo, hora del servidor, rechaza un segundo clic en 2 min, solo horario libre o mixto). Botón «Mi asistencia» en Inicio, sin permiso de menú (borra `ver_rrhh_mi_asistencia` si existía). Idempotente | sí | **pendiente** |
| `20261107120000_personal_foto` | Foto del trabajador: `personal.foto_url` (enlace de Google Drive; la imagen se reduce a 600 px en el dispositivo). Idempotente | sí | **pendiente** |
| `20261107130000_personal_regimen_categoria` | Régimen: + `contrata`, `subcontrata`. Categoría: `varchar(50)` sin lista fija en la base (especialidades de Sub Contrata, ej. "Operario Carpintero"); las antiguas operario/oficial/peon se conservan. Idempotente | sí | **pendiente** |
| `20261107140000_personal_referente` | Referente del trabajador: `personal.referente_nombre` y `referente_cargo` (lista en CARGOS_REFERENTE: Subcontratista, Contratista). Idempotente | sí | **pendiente** |
| `20261110120000_personal_cargo_historial` | Historial de cargos: tabla `personal_cargo_historial` (cargo, fecha_inicio, fecha_fin; sin fin = actual, se copia a `personal.cargo`), RLS authenticated, y carga inicial con el cargo que ya tenía cada ficha. Idempotente | sí | **pendiente** |
| `20261111120000_personal_vinculo_empleador` | Vínculo y empleador del trabajador: `personal.vinculo` (planilla_propia/subcontratista), `empleador_nombre`, `empleador_ruc` (11 dígitos), `empleador_tamano` (micro/pequena/general) y `monto_pago_desde` (salario vigente desde). Idempotente | sí | **pendiente** |
| `20261112120000_personal_historial_asignacion` | Historial de asignaciones del trabajador: tabla `personal_historial_asignacion` (tipo obra/huellero/referente, desde/hasta, `detalle` con el texto del momento), solo lectura para la app; la llenan los triggers `trg_personal_historial_asignacion` (personal: alta y cambio de obra o referente) y `trg_personal_huellero_historial` (personal_huellero: alta/baja). Carga inicial con lo vigente. Idempotente | sí | **pendiente** |
| `20261116120000_personal_obras` | Varias obras o áreas por trabajador: tabla `personal_obra` (todas sus obras; `personal.id_centro_costo` sigue siendo la principal y el trigger `trg_personal_obra_principal` la mantiene dentro). El historial de obras pasa a registrarse con altas/bajas en `personal_obra` (`trg_personal_obra_historial`); `fn_personal_historial_asignacion` queda solo para referentes. Requiere 20261112120000. Idempotente | sí | **pendiente** |

**Comparación de esquemas Dev ↔ Producción (2026-10-02):** se compararon columnas, restricciones, índices,
funciones, triggers, políticas, RLS, extensiones y permisos de `public` con una consulta de solo lectura al
catálogo. Quedaron idénticos. Las únicas diferencias son cosméticas:
- La forma en que Postgres escribe los CHECK.
- Las funciones creadas desde el SQL Editor quedan con saltos de línea `\r\n` en Producción; sin
  espacios en blanco, el texto es el mismo.

`20260929155944` no está en ninguna de las dos bases. (`20260930032337`, el "Repositorio de comprobantes", se eliminó el 2026-10-03 sin haberse aplicado nunca: fue reemplazado por el modo "PDF de SUNAT" de Emisión de Comprobante). Para registrar en Producción las
que ya están aplicadas, hay que correr (con confirmación del usuario):
`npx supabase migration repair --status applied 20260925140000 20261001152541 20261002000000 20261002120000 20261002130000 --db-url <URL_PROD>`.

Todas las migraciones hasta `20260925130000` están aplicadas en Producción (2026-09-25, corridas a mano en el SQL Editor y registradas después con `supabase migration repair`). Lo que falta es **publicar la versión de la app** que trae el código acoplado a ellas (servicios y modales).

### 4.5 Datos de prueba de Dev
- `cd app && npm run seed:dev` (idempotente; **aborta si la URL no es Dev**). Crea: 2 empleados, 2 clientes, 2
  proveedores, una venta de Obra y una de Consultoría cerradas (con centros), un presupuesto, 2 cuentas bancarias,
  cuentas por pagar (serie mensual + fraccionada) y por cobrar, transacciones enlazadas y una factura borrador. Usa las
  funciones de servicio reales; los inserts crudos solo donde el módulo no tiene capa de servicio (empleados, clientes,
  proveedores, ventas, factura borrador).
- **Reset de Dev** (lo corre el usuario en el SQL Editor de Dev — un borrado masivo desde el agente fue bloqueado por el
  clasificador): `TRUNCATE TABLE factura_detalle, factura, cobros, pagos, cuentas_cobrar, cuentas_pagar, transaccion,
  presupuesto, centro_costo, proyecto, proveedor, cliente, empleados, cuenta_banco RESTART IDENTITY CASCADE;` y luego
  `npm run seed:dev`. Con los ids reiniciados el seed es determinista (centros: empleados 1-2, clientes 3-4,
  proveedores 5-6, proyectos 7-8).
- Los tests dejan filas marcadas `TEST-D`, `TEST-F`, `TEST-L` y transacciones de "fondeo": ruido esperable en Dev.

---

## 5. Políticas de uso (qué puedes y qué no)

### 5.1 Matriz

| Acción | Dev | Producción |
|---|---|---|
| Leer datos (MCP, scripts de solo lectura) | Sí | Sí (con cuidado: son datos reales) |
| Crear/editar/borrar datos de negocio | Sí | **No** |
| Escribir en Tickets/Releases (`ticket*`, `app_release`) | — | **Sí** (excepción explícita) |
| Cambiar el esquema (migraciones) | Sí | Solo tras probar en Dev **y confirmar con el usuario**; el push lo corre el usuario |
| Volcar el esquema (`db dump`) | Sí | Sí (solo lectura) |
| Borrado masivo / `TRUNCATE` | Lo corre el usuario | **Nunca** |

### 5.2 Permisos del clasificador de Claude Code
Están bloqueados (y no debes intentar rodearlos): `supabase db push` contra Producción y borrados masivos. Cuando pase,
detente, explica qué ibas a hacer y por qué, y entrega el comando exacto. El usuario puede correrlo o añadir una regla
Bash de permiso en su configuración.

### 5.3 Secretos
Las claves `service_role`, contraseñas de base, credenciales de Google Drive y la clave de firma de Tauri **no se
imprimen en respuestas, no se copian a documentos y no se commitean**. Verifica con `git status` que `.env`/`.env.*`
siguen ignorados. Si tienes que depurar una conexión, imprime solo el host y el usuario, nunca la contraseña.

### 5.4 Tickets (el único dominio con escritura en Producción)
El ciclo: `abierto`/`en_progreso` → `resuelto` (developer) → `aprobado`/`rechazado` (admin) → `cerrado` (al publicarse un
release que lo incluye). Para marcar un ticket como resuelto **se hace directo en la base, no por la UI**, replicando
lo que hace `marcarResuelto()` del servicio: con la clave `service_role` de `app/.env`,
1. `UPDATE ticket SET estado='resuelto', resuelto_por='construni', resuelto_en=now(), motivo_rechazo=NULL`,
2. `INSERT` en `ticket_evento` (`id_ticket, estado_anterior, estado_nuevo, usuario`),
3. `INSERT` en `ticket_comentario` (`id_ticket, autor='construni', mensaje`) explicando **con honestidad** qué se hizo,
   qué se verificó y qué falta activar (por ejemplo "requiere la próxima versión").
Solo marca como resuelto lo que realmente corregiste y verificaste; ante un ticket rechazado, lee el motivo y busca la
causa real en vez de re-marcar. Los tickets con el nombre "snoopy" (#9) se dejaron a propósito sin tocar.

### 5.5 Comandos y entorno (Windows)
El shell es Git Bash sobre Windows. Trampas ya vistas:
- Heredocs largos con Python o con comillas mezcladas a veces fallan con "unexpected EOF": **escribe el script con la
  herramienta de archivos y ejecútalo**.
- Rutas con Docker: usa `MSYS_NO_PATHCONV=1` y rutas de Windows.
- `source .env` falla por líneas con espacios antes de las comillas: extrae la variable con `grep | cut`.
- `npm run check` (svelte-check) debe dar **0 errores** (línea base: 169 warnings preexistentes). `npx vitest run`: 31 tests (2026-10-06).

---

## 6. Políticas de los tests de negocio

Los tests de negocio verifican que el **flujo de datos** de cada módulo tenga sentido de negocio, no solo que compile.
Documentación y hallazgos: [tests/README.md](tests/README.md).

### 6.1 Principios
1. **Solo contra Dev.** Los runners spawnean el servidor MCP con `.env.dev`. Nunca apuntes un test de escritura a
   Producción; contra Producción solo se usan las herramientas `auditar_*` (solo lectura).
2. **Pasan por la capa de servicio real** (vía MCP), no por INSERT crudo: así se prueban las reglas de negocio de
   verdad. Aclara siempre que **no** prueban la interfaz gráfica; los flujos de pantalla (modales, mensajes de error)
   se prueban a mano en un navegador.
3. **Cada caso es Dado/Cuando/Entonces con un ID estable** (`P-xx` Pagar, `C-xx` Cobrar, `F-xx` fraccionamiento,
   `L-xx` lápiz) y un resultado **PASS / FAIL / INFO**:
   - **PASS**: el sistema se comporta como el negocio espera.
   - **FAIL**: acepta o hace algo que el negocio no debería, o deja datos inconsistentes. Cada FAIL se explica en el
     documento del módulo con su impacto y un arreglo sugerido.
   - **INFO**: comportamiento que no es un error pero hay que conocer (regla de diseño no obvia).
4. **Un FAIL es un hallazgo, no un fallo del test.** No lo "arregles" cambiando la expectativa: reporta el hallazgo,
   documéntalo (sección Hallazgos) y, si el usuario lo pide, corrige el código/SQL y vuelve a correr hasta PASS.
5. **Cada hallazgo corregido deja un caso de regresión** que falla sin el arreglo (ejemplo: P-04 verifica que la
   transacción del pago conserva `categoria`).
6. **Deja documentado qué es "campo sospechoso/redundante"** por módulo (tabla al final de cada documento): campos
   derivados que se guardan, columnas duplicadas entre tablas, typos de nombres, catálogos paralelos.
7. **Valida el test contra el comportamiento real antes de confiar en él.** Varios FAIL iniciales resultaron ser
   errores del propio test (ejemplo: un filtro por una columna que la base nunca guardaba). Si un caso falla, primero
   determina si el error es del sistema o del test.

### 6.2 Cómo se ejecutan

```bash
cd app
npm run seed:dev                       # requisito: Dev sembrado
npm run test:negocio                   # 40 casos: Pagar y Cobrar (P-xx, C-xx)
npm run test:negocio:fraccionamiento   # 22 casos: cambio de periodicidad a mitad de plan (F-xx)
npm run test:negocio:lapiz             # 12 casos: editar cuotas y montos desiguales (L-xx)
```

Resultado de referencia (2026-09-25): 38/40, 21/22 (+1 INFO), 12/12. Los 2 FAIL de la suite general son **H3**
(vencimiento anterior a la emisión se acepta), un hallazgo abierto conocido.

Detalles de los runners:
- Cada uno **fondea** el centro de costo del proyecto con una transacción de ingreso, porque los egresos validan el
  saldo del centro y tantas corridas lo vacían.
- Las auditorías dentro de los tests se **acotan a lo creado en la corrida** (ids ≥ el primero creado) porque Dev puede
  traer restos de corridas viejas.
- Usan fechas fijas y aritmética UTC para que la zona horaria de la máquina no mueva días.

### 6.3 Cómo añadir un caso o un módulo nuevo
1. Empieza por [FlujoDeNegocio.md](FlujoDeNegocio.md) para ubicar el módulo y sus dependencias.
2. Si falta una herramienta MCP para armar o verificar el escenario, créala (§3.6) — incluye una `auditar_*` si hay una
   invariante recalculable.
3. Añade el caso al runner (`app/scripts/tests-negocio-*.mjs`) con su ID y una explicación de qué se espera y **por qué**.
4. Ejecuta; si hay FAIL, sigue §6.1 (3).
5. Documenta en `Documentacion/tests/<modulo>.md` (tabla de casos, hallazgos, campos sospechosos) y actualiza el
   resumen y el estado en `tests/README.md`.
6. Módulos aún **sin tests**: Transacciones, Centro de Costos, Cuentas Bancarias, Ventas, Facturación, Control
   Financiero. Prioridad sugerida: Transacciones y Centro de Costos (todo depende de ellos), luego Cuentas Bancarias.

### 6.4 Hallazgos abiertos y estado (resumen)
Corregidos en Dev y **pendientes de Producción**: H1 (suma de cuotas validada en servidor), H4 (dólares), H5/H6
(Cobrar desde cobros propios), H7 (cuota parcial), H8–H10 (lápiz: cuota negativa, única cuota pendiente, cuota ya
pagada). Pendiente de Producción también H2 (columna `id_cuenta_pagar_padre`). **Abierto sin arreglo:** H3.
Aplicado en Producción: la corrección de `fn_crear_transaccion` (`20260924160000`).
Consecuencia de H6 a vigilar: un ingreso suelto o el adelanto al cerrar una venta **ya no reduce el saldo de una cuenta
por cobrar** si no se vincula a ella (registrar cobro, o "Vincular con Cuenta por Cobrar" al crear la transacción);
está por decidir si el adelanto de cierre de venta debe crear también un cobro.

---

## 7. Flujo de trabajo recomendado para un cambio de negocio

1. **Entender:** lee el módulo en `FlujoDeNegocio.md`, el servicio (`*.service.ts`) y su `config`.
2. **Reproducir en Dev** con las herramientas MCP (o un caso de test nuevo que falle).
3. **Corregir** en el servicio/SQL. Si es SQL → migración nueva (§4.3).
4. **Verificar:** `npm run check` (0 errores), `npx vitest run`, los `test:negocio*` relevantes, y la migración aplicada a
   Dev (`supabase db push --db-url "$DEV_URL"`).
5. **Documentar:** actualiza `Documentacion/tests/` y, si cambió una regla de negocio, `FlujoDeNegocio.md`/este archivo.
6. **Producción:** entrega al usuario la lista ordenada de migraciones a aplicar y avisa que la app debe publicarse junto
   con ellas (`app/scripts/release.mjs` / `deploy.bat`, ver [MecanismoCICD.md](MecanismoCICD.md)). No commitees ni
   hagas push salvo que el usuario lo pida.
7. **Si hay ticket asociado**, ciérralo según §5.4 con un comentario veraz.

---

## 7b. Convención de interfaz: desplegables con buscador

Por pedido explícito de la cliente (ticket #29), **toda lista desplegable de la app debe permitir buscar**. No uses
`<select>` nativo: usa `$lib/shared/components/SelectConSaldo.svelte` (props `value`, `options` `{value,label,grupo?,saldo?}`,
`placeholder`, `disabled`, `hasError`, `onchange(value: string)`; `value` y las opciones son siempre **texto** — para
ids numéricos convierte con `String()`/`Number()`). Ya no queda ningún `<select>` funcional en la app; la única
excepción es el selector de "filas por página" de `VentasTable.svelte`, que hoy no está conectado a nada. El
panel del combo usa `z-[200]`, por encima de los modales (máx. `z-[120]`). Limitación conocida: no muestra colores
por opción (por ejemplo, el de Prioridad en Cuentas por Pagar/Cobrar).

## 7c. Auditoría (Control de Accesos → Auditoría)

Pantalla `/iam/auditoria` (permiso `ver_iam_auditoria`; admin siempre). Registra sesiones, acciones y errores.
Migración: `20261002120000_auditoria.sql`.

- **Sesión** (`auditoria_sesion`): la abre `iniciarSesionAuditoria()` (`$lib/shared/auditoria.ts`) desde
  `(app)/+layout.svelte`. Latido cada 60 s. Cómo termina (`motivo_fin`):
  - `logout_manual`: botón "Cerrar sesión". Todo logout pasa por `cerrarSesion()`; no llames
    `supabase.auth.signOut()` directo desde la app.
  - `sesion_expirada`: Supabase descartó la sesión (`onAuthStateChange` → `SIGNED_OUT` no manual).
  - `app_cerrada`: se cerró la ventana. Lo registra Rust (`src-tauri/src/auditoria.rs`, `CloseRequested`/`Exit`).
  - `cierre_inesperado`: sin latido por más de 3 min (proceso terminado, corte de luz, Android) o panic de Rust.
    Queda con la hora del último latido; si después llega el dato real desde el diario local, lo reemplaza.
- **Token por sesión**: tabla `auditoria_sesion_token`, sin acceso desde la API. Permite registrar el cierre
  aunque el cliente ya sea `anon`. Todas las escrituras van por RPCs `SECURITY DEFINER`; las tablas son de
  solo lectura desde la API.
- **Acciones** (`auditoria_accion`):
  - Cambios de datos: trigger `auditoria_registrar_cambio()` en 14 tablas de negocio, con el diff de las
    columnas que cambiaron. La sesión llega en el header `x-auditoria-sesion` (`supabaseClient.ts`) y solo
    se acepta si es del mismo usuario del JWT.
  - Descargas / PDFs / subidas: `registrarAccion()` en `saveFile.ts`, los 4 generadores de PDF y las
    subidas a Drive.
- **Errores** (`auditoria_error`): `window.onerror`/`unhandledrejection` y panics de Rust. Máximo 30 por minuto.
- **Diario local**: lo que no llega al servidor queda en `app_data_dir/auditoria/pendientes.jsonl` (Tauri)
  o `localStorage` (web) y se sube al iniciar la siguiente sesión.
- **Retención**: `auditoria_purgar()` borra acciones y sesiones de más de 14 días y errores de más de 7. La
  app la llama en cada login; si se habilita `pg_cron`, la migración agenda además una corrida diaria.
- **MCP** (solo lectura): `listar_auditoria_sesiones`, `listar_auditoria_acciones`, `listar_auditoria_errores`.
- **Para agregar una tabla al registro de cambios**, agrégala a la lista del bloque `DO $$` de la migración
  en una migración nueva, con el nombre de su clave primaria.

## 8. Glosario rápido

- **Centro de Costo:** cuenta interna de origen/destino de todo dinero; los de cliente/proveedor/empleado/proyecto se
  autogeneran.
- **Transacción:** el movimiento real de dinero. **Cuenta por Pagar/Cobrar:** una obligación; se cubre con pagos/cobros
  enlazados a transacciones.
- **Cuota:** fila `programado` en `pagos`/`cobros`. **Fraccionar:** repartir una cuenta en cuotas.
  **Frecuencia de Pago:** generar varias cuentas periódicas.
- **Backfill:** migración de datos que reconstruye filas para conservar un resultado tras un cambio de modelo.
- **Axigh / gh-axi:** nombre del servidor MCP del equipo, inspirado en el patrón de gh-axi (herramientas compactas para
  agentes en vez de acceso crudo a la base).
