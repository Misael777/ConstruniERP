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
