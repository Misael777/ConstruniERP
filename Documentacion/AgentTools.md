# Capa de herramientas para agentes de IA

A pedido explícito del usuario: sentar las bases para que un agente de IA pueda administrar
ConstruniERP. Dos horizontes de tiempo, intención muy distinta:

- **Hoy**: Claude Code (o cualquier cliente MCP) usa estas herramientas directo en sesiones de
  trabajo, en vez de scripts de Node sueltos armados a mano cada vez.
- **Mañana** (no construido todavía): un asistente de chat **embebido dentro de la propia
  plataforma** — el cliente final nunca prende nada, nunca sabe que existe un "servidor MCP", solo
  abre la app y habla con su asistente. A futuro, varios agentes/workflows agénticos por detrás, como
  funcionalidad vendible.

## Arquitectura

Una única **capa de herramientas** (`app/src/lib/server/agent-tools/`), reutilizable desde dos
transportes sin duplicar lógica:

1. **Servidor MCP** (`app/mcp-server/index.ts`, `npm run mcp`) — transporte de hoy, stdio local, sin
   nada expuesto a internet.
2. **Chat embebido** (fase futura, no construida) — un endpoint de SvelteKit llamando la API de Claude
   con la MISMA capa de herramientas directo, sin protocolo MCP de por medio.

```
app/src/lib/server/agent-tools/
  registry.ts          # tipo AgentTool + crearRegistro()
  tools/
    tickets.ts          # dominio Soporte/Tickets (demo inicial)
    <nuevo-dominio>.ts   # sumar acá, uno por módulo del ERP
app/mcp-server/
  index.ts              # servidor MCP — recorre el registro, no conoce el detalle de cada herramienta
```

## Cómo agregar una herramienta nueva

1. Elegí (o creá) el archivo de dominio en `tools/` (ej. `tools/transacciones.ts`).
2. Cada herramienta es un objeto `AgentTool` (`registry.ts`): `name`, `description`, `inputSchema`
   (JSON Schema plano), `permiso` (el mismo string que usa `hasPermiso()` en `permisos.svelte.ts`,
   o `null`), y `handler(input, ctx)`.
3. **El handler debe envolver la MISMA lógica ya validada del servicio correspondiente** (ej.
   `transacciones.service.ts`) — nunca inventar una consulta nueva ni hacer CRUD crudo sobre una tabla
   sin pasar por las reglas de negocio que ya existen.
4. Exportá un array `xxxTools: AgentTool[]` al final del archivo, y sumalo en
   `crearRegistro(...)` dentro de `mcp-server/index.ts`. No hace falta tocar nada más de ese archivo.
5. Los `import` relativos dentro de `agent-tools/` deben llevar la extensión `.ts` explícita (ej.
   `from '../registry.ts'`) — el proyecto ya tiene `rewriteRelativeImportExtensions: true` en
   `tsconfig.json` para esto, y el servidor MCP corre con `node --experimental-strip-types`, que
   exige extensión explícita en imports relativos.

## Por qué las herramientas de Tickets reimplementan sus consultas en vez de importar tickets.service.ts

`tickets.service.ts` importa `permisosState` de `$lib/stores/permisos.svelte.ts`, que usa sintaxis de
runes de Svelte 5 (`$state`) — solo el compilador de Svelte sabe procesar esa sintaxis. El servidor MCP
corre como proceso de Node puro (sin Vite/Svelte de por medio), así que un `import` directo de un
archivo que arrastre esa dependencia rompería al cargar.

**La regla, entonces**: si el servicio original no tiene ninguna dependencia de código de
cliente/Svelte, importalo directo (ver `releases.service.ts`, que no tiene ese problema). Si sí la
tiene, reimplementá standalone la MISMA consulta (misma tabla, mismos filtros, mismo orden) dentro de
`agent-tools/`, dejando un comentario que lo explique — no es lógica nueva, es la misma lógica en un
archivo que sí puede cargar en un proceso de Node puro.

## Reglas de seguridad

- `SUPABASE_SERVICE_ROLE_KEY` (acceso total, sin RLS) **nunca** se importa desde código que corra en
  el navegador — solo dentro de `agent-tools/` y del proceso del servidor MCP.
- Todas las herramientas de esta demo son de **solo lectura**. Cualquier herramienta de escritura
  (crear, editar, aprobar, eliminar) es una decisión aparte — debería, como mínimo, pasar por el mismo
  mecanismo de `solicitud_aprobacion` que ya usa el resto del ERP (ver `aprobaciones.service.ts`) en
  vez de ejecutarse directo, o pedir confirmación explícita del lado del cliente del chat.
- El campo `ctx.rol` (`registry.ts`) hoy siempre vale `'operador'` (acceso total, como administrador).
  Cuando exista el chat embebido, ese contexto debe llevar el permiso REAL del usuario logueado,
  re-derivado del lado del servidor (mismo query que `loadPermisos` en `permisos.svelte.ts` —
  `empleados → roles → roles_permisos` — pero corrido en un contexto de servidor confiable, nunca
  solo confiando en el estado del cliente).

## Cómo correr el servidor MCP

```sh
cd app
npm run mcp
```

Carga `app/.env` automáticamente (mismo patrón `--env-file` que los scripts `tauri`/`release`) — correr
`node mcp-server/index.ts` directo NO carga ese `.env` y el servidor falla creyendo que faltan
credenciales que en realidad ya están configuradas.

Para usarlo desde Claude Code, registralo como servidor MCP del proyecto (`claude mcp add`) apuntando
a ese mismo comando.

---

## Entornos Dev/Prod y dominios financieros (Fase C del plan de Desarrollo/Testing)

Dos servidores MCP, mismo código, distinta base — el entorno se deduce de la URL de Supabase cargada
(`mcp-server/index.ts`, nunca de una variable "modo"), y aborta si la URL no es ninguno de los dos
proyectos conocidos:

| Servidor Claude Code | Comando | Archivo de entorno | Herramientas |
|---|---|---|---|
| `construnierp` | `npm run mcp` | `app/.env` (Producción) | Todas las **lecturas** + Tickets |
| `construnierp-dev` | `npm run mcp:dev` | `app/.env.dev` (Dev) | Todo, incluidas las **escrituras** |

- Una herramienta con `escritura: true` **no se registra en Producción** (`filtrarPorEntorno` en
  `registry.ts`), salvo que además tenga `escrituraEnProd: true` (excepción explícita del usuario para
  Tickets/Panel Developer). La BD no tiene RLS fuera de Tickets, así que este filtro ES el candado.
- `npm run mcp*` usa `--import ./scripts/register-lib-resolver.mjs`: registra `scripts/lib-resolver.mjs`,
  que resuelve `$lib/...` y los imports relativos sin extensión, para que agent-tools importe los
  `*.service.ts` reales. Solo sirve para archivos sin acoplamiento a Svelte (`$env/*`, `*.svelte.ts`).
- Dominios cubiertos: `tools/cuentas-pagar.ts`, `tools/cuentas-cobrar.ts`, `tools/catalogos.ts`
  (proveedores, clientes, centros de costo, cuentas bancarias, transacciones). Cada uno incluye una
  herramienta `auditar_*` que recalcula saldos desde la fuente y reporta solo inconsistencias — la base
  de los tests de negocio de la Fase D.
- Datos de prueba: `npm run seed:dev` (idempotente, aborta si la URL no es Dev).

### Reglas de negocio confirmadas con estas herramientas

- **Cuentas por Pagar y por Cobrar se comportan igual** (decisión del cliente, 2026-09-25): el saldo de cada una
  se deriva de SUS PROPIOS pagos/cobros (`fn_recalcular_cuenta_pagar` / `fn_recalcular_cuenta_cobrar`). En
  Cobrar, `id_centro_costo` sigue siendo el centro que recibe el ingreso, pero los ingresos ajenos a la cuenta
  no cuentan; un ingreso suelto solo la afecta si se vincula (registrar cobro).
- Ambas pueden estar en dólares: el monto de la cuenta es siempre en soles (`monto_dolares × tipo_cambio`) y
  cada pago/cobro descuenta el equivalente en soles de su transacción. Una transacción en dólares exige tipo de
  cambio (`fn_crear_transaccion`).
- Pagar una cuota programada con menos que su monto la parte (resto queda programado); con más se rechaza.
  Ni un pago suelto ni una cuota pueden exceder lo que falta por cubrir.
- Un calendario de cuotas debe sumar exactamente lo que falta por pagar/cobrar (validado en el servidor).
- Herramientas de escritura para escenarios: `confirmar_pago_cuota`/`confirmar_cobro_cuota` (pagar una cuota
  existente), `refraccionar_cuenta_*`, `actualizar_cuenta_*`, `dar_de_baja_cuenta_pagar`.
