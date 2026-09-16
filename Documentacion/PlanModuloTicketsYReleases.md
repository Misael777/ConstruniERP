# Plan — Módulo de Tickets (Libro de Reclamaciones/Incidencias) + Sistema de Releases

## Contexto y objetivo

Hoy, tanto los reclamos/sugerencias de los usuarios del ERP como la distribución de nuevas versiones
(Windows y Android) se manejan por WhatsApp — sin trazabilidad, sin historial, sin forma de saber qué
está pendiente, en progreso o resuelto. Este plan agrega:

1. Un **módulo de tickets** dentro del propio ERP (el cliente no tiene acceso a GitHub ni sabe qué es —
   todo el reporte/seguimiento tiene que vivir en la app que ya usan).
2. Un **mecanismo de release** que conecta un ticket resuelto y aprobado con una versión nueva de la
   app, y le da al usuario un botón de "Actualizar" dentro del propio ERP.

**Nota de terminología**: en toda esta conversación, "Cliente" = el rol **Admin** de la plataforma (la
misma persona/login). No son dos roles distintos — cuando se habla de "el Admin aprueba" y "el cliente
usa/confirma", es la misma persona en los dos momentos. Esto importa para el ciclo de vida del ticket
más abajo: no hace falta un paso de confirmación separado después de la aprobación, porque quien
aprobaría el fix y quien lo usaría en producción son la misma persona.

Decisiones ya conversadas y confirmadas con el usuario (no reabrir sin razón):

- El módulo vive **dentro** del ERP, no en GitHub Issues — GitHub solo se usa como *hosting* del
  instalador de Windows (el cliente nunca lo ve ni lo sabe).
- Nuevo rol **`developer`**, mismo patrón que `ADMIN_ROLE` (`app/src/lib/config/modules.ts:111`,
  `isAdmin()` en `permisos.svelte.ts:164`) — agregar `DEVELOPER_ROLE = 'developer'` y un `isDeveloper()`
  análogo. El módulo de tickets (vista de lista completa + acciones) es visible para `developer` **y**
  para `administrador` — el resto de roles solo ve/crea SUS PROPIOS tickets.
- Ciclo de vida del ticket, ORDEN EXACTO (no es negociable, hay una dependencia real entre pasos):
  1. Developer arregla el código y marca el ticket **`resuelto`** (esto es 100% interno — el Admin/
     cliente todavía no ve nada nuevo en su app).
  2. **Admin** revisa y lo pasa a **`aprobado`** (o `rechazado`, y vuelve al paso 1) — solo el Admin
     aprueba/rechaza, no el propio developer (mismo criterio de "quien resuelve no es quien aprueba"
     que ya usan en `aprobarSolicitud`/`aprobarTransaccion` de este ERP).
  3. Developer corre el script de release — **recién acá** se compila/firma/publica la versión nueva,
     y el script barre TODOS los tickets `aprobado` sin release asignado (pueden ser varios acumulados,
     no uno por uno) y los deja en **`cerrado`** directamente, con `id_release` seteado.
  4. El botón "Actualizar" aparece en el ticket SOLO a partir del paso 3 — antes de eso no existe nada
     que instalar.
  - No hay un paso adicional de "el cliente confirma después de actualizar": como Cliente=Admin (ver
    nota de terminología arriba), ya dio su visto bueno en el paso 2 — pedirle que confirme otra vez
    después de instalar sería el mismo click repetido sin agregar nada.
- Un release agrupa automáticamente **todos** los tickets en estado `aprobado` sin release asignado
  todavía — el developer no selecciona tickets a mano al momento de publicar. Esto también actúa como
  el "candado de calidad": nada sale a producción sin haber pasado por la aprobación del Admin.
- **Windows**: distribución vía GitHub Releases + `@tauri-apps/plugin-updater` (auto-update real, un
  clic, con diálogo de confirmación — no 100% silencioso, ver `MecanismoCICD.md`).
- **Android**: distribución del APK vía Google Drive (ya integrado en este ERP, ver
  `driveUploadClient.ts`/`/api/upload-document`) — el botón "Actualizar" descarga el APK nuevo y el
  usuario lo instala a mano (Android no permite auto-instalar fuera de Play Store, no hay forma de
  evitar ese paso).
- Un solo botón "Actualizar" por ticket resuelto — no hay un paquete distinto por ticket, todos los
  tickets `aprobado` de una tanda comparten el mismo release/versión.

## Modelo de datos (nueva migración, root del repo — mismo patrón que
`control_financiero_migration.sql`/`solicitud_aprobacion_migration.sql`: `CREATE TABLE IF NOT EXISTS`,
índices, `NOTIFY pgrst, 'reload schema';`)

### `ticket`

```
id_ticket           BIGSERIAL PK
tipo                VARCHAR(20) CHECK (tipo IN ('reclamo','sugerencia','incidencia','requerimiento'))
modulo              VARCHAR(60)   -- path de MODULE_REGISTRY (modules.ts), ej. '/finanzas/tranzacciones'
titulo              VARCHAR(150) NOT NULL
descripcion         TEXT NOT NULL
prioridad           VARCHAR(10) CHECK (prioridad IN ('baja','media','alta','critica')) DEFAULT 'media'
estado              VARCHAR(15) CHECK (estado IN ('abierto','en_progreso','resuelto','aprobado','rechazado','cerrado')) DEFAULT 'abierto'
creado_por          VARCHAR(200)
creado_por_id       UUID          -- auth.users.id, mismo criterio que solicitud_aprobacion.solicitado_por_id
resuelto_por        VARCHAR(200)
resuelto_en         TIMESTAMPTZ
aprobado_por        VARCHAR(200)  -- o rechazado_por, mismo campo (solo uno de los dos aplica según estado)
aprobado_en         TIMESTAMPTZ
motivo_rechazo      TEXT          -- solo si estado='rechazado'
id_release          BIGINT REFERENCES release(id_release)  -- null hasta que un release lo incluya
created_at          TIMESTAMPTZ DEFAULT NOW()

INDEX idx_ticket_estado (estado)
INDEX idx_ticket_creado_por_id (creado_por_id)
```

### `ticket_comentario` (el "foro" por ticket)

```
id_comentario   BIGSERIAL PK
id_ticket       BIGINT REFERENCES ticket(id_ticket) ON DELETE CASCADE
autor           VARCHAR(200)
autor_id        UUID
mensaje         TEXT NOT NULL
created_at      TIMESTAMPTZ DEFAULT NOW()

INDEX idx_ticket_comentario_ticket (id_ticket)
```

### `ticket_evento` (auditoría de cambios de estado — mismo patrón que `incidencia_evento` en
`control_financiero_migration.sql`)

```
id_evento       BIGSERIAL PK
id_ticket       BIGINT REFERENCES ticket(id_ticket) ON DELETE CASCADE
estado_anterior VARCHAR(15)
estado_nuevo    VARCHAR(15)
usuario         VARCHAR(200)
comentario      TEXT
created_at      TIMESTAMPTZ DEFAULT NOW()
```

### `release`

```
id_release        BIGSERIAL PK
version           VARCHAR(20) NOT NULL    -- ej. '1.4.2'
changelog          TEXT                    -- compilado automáticamente de los títulos de los tickets incluidos
url_manifest_win  TEXT                    -- latest.json en GitHub Releases (lo que lee el updater de Tauri)
url_instalador_win TEXT                   -- .msi/.exe en GitHub Releases, informativo/debug
url_apk_drive     TEXT                    -- link/fileId de Drive del APK debug
publicado_por     VARCHAR(200)
created_at        TIMESTAMPTZ DEFAULT NOW()

UNIQUE (version)
```

## Roles y permisos

- `app/src/lib/config/modules.ts`: agregar `export const DEVELOPER_ROLE = 'developer';`, agregar la
  entrada del módulo nuevo a `MODULE_REGISTRY` (ej. `{ path: '/soporte', label: 'Soporte', permiso:
  'ver_soporte', subItems: [{ path: '/soporte/tickets', label: 'Mis Tickets', permiso:
  'ver_soporte_tickets' }, { path: '/soporte/developer', label: 'Panel Developer', permiso:
  'ver_soporte_developer' }] }`).
- `app/src/lib/stores/permisos.svelte.ts`: agregar `export function isDeveloper(): boolean { return
  permisosState.rolNombre === DEVELOPER_ROLE || isAdmin(); }` (el Admin también debe poder entrar al
  panel Developer, ya que "para mí y el administrador" fue el pedido original).
- `app/src/routes/(app)/iam/roles-permisos/+page.svelte`: agregar el rol `developer` al catálogo (si
  los roles se gestionan ahí) y las entradas `ver_soporte`/`ver_soporte_tickets`/`ver_soporte_developer`
  al catálogo de permisos, sección "Soporte".
- `ver_soporte_tickets` (crear/ver los propios tickets, comentar en ellos) se otorga a TODOS los roles
  por defecto en la migración (INSERT masivo a `roles_permisos`) — cualquier usuario debe poder
  reportar. `ver_soporte_developer` (bandeja completa, aprobar/rechazar, panel de progreso) solo a
  `developer`/`administrador`.

## Servicios (nuevos, siguiendo el patrón de `aprobaciones.service.ts`/`transacciones.service.ts`)

`app/src/lib/modules/tickets/services/tickets.service.ts`:
- `crearTicket(client, {tipo, modulo, titulo, descripcion, prioridad})` — inserta con `estado='abierto'`,
  `creado_por`/`creado_por_id` resueltos de `permisosState`/`auth.getUser()` (mismo criterio que
  `crearSolicitud`).
- `getMisTickets(client)` — filtra por `creado_por_id = auth.getUser().id`.
- `getTicketsDeveloper(client, filtros?)` — todos los tickets, para el panel Developer/Admin.
- `getTicket(client, id)` + `getComentarios(client, idTicket)`.
- `agregarComentario(client, idTicket, mensaje)`.
- `marcarEnProgreso(client, idTicket)` / `marcarResuelto(client, idTicket)` — developer/admin.
- `aprobarTicket(client, idTicket, resueltoPor)` / `rechazarTicket(client, idTicket, motivo,
  resueltoPor)` — admin-only (gate de UI, mismo criterio "sin RLS real" que el resto del ERP).
- Cada transición inserta también una fila en `ticket_evento` (mismo patrón que `incidencia.service.ts`).

`app/src/lib/modules/tickets/services/releases.service.ts`:
- `getUltimoRelease(client, plataforma)` — para que el botón "Actualizar" sepa a qué versión apuntar.
- `getReleaseDeTicket(client, idTicket)` — para el banner "Incluido en la vX.Y.Z".
- La INSERCIÓN de un `release` nuevo la hace el script de deploy (fuera del ERP, con una service key de
  Supabase) — no hace falta un botón dentro de la app para "crear release", eso lo dispara el script.

## Frontend

- `app/src/routes/(app)/soporte/tickets/+page.svelte` — lista de "Mis tickets" + botón "Nuevo ticket"
  (modal con tipo/módulo/título/descripción/prioridad, selector de módulo reusando `MODULE_REGISTRY`).
  Detalle de un ticket: estado, hilo de comentarios (`ticket_comentario`), y si tiene `id_release`, un
  banner "✅ Incluido en la versión X.Y.Z — [Actualizar ahora]".
- `app/src/routes/(app)/soporte/developer/+page.svelte` — bandeja completa (todos los tickets,
  filtros por estado/tipo/módulo/prioridad), acciones En progreso/Resuelto (developer) y
  Aprobar/Rechazar (admin), mismo hilo de comentarios visible.
- Botón "Actualizar" (componente compartido, ej. `app/src/lib/shared/components/BotonActualizar.svelte`):
  en Tauri Windows, dispara `check()`/`downloadAndInstall()` de `@tauri-apps/plugin-updater` +
  `relaunch()` de `@tauri-apps/plugin-process`; en Tauri Android, descarga el APK vía el cliente de
  Drive ya existente y abre el instalador nativo de Android.
- Notificaciones: extender `NotificacionesBell.svelte` para que también lea `ticket`/`ticket_comentario`
  (tickets nuevos → notifica a developer/admin; cambios de estado → notifica al reportante) — mismo
  mecanismo de polling/realtime ya usado para `solicitud_aprobacion`, sin duplicar el ícono de campana.

## Script de deploy (fuera de la app, en `scripts/release.mjs` o similar, Node — ver `MecanismoCICD.md`
para el detalle completo del mecanismo)

Pasos, en orden, abortando el proceso si cualquiera falla:
1. `npm run check` y `npx vitest run` como gate de calidad.
2. Bump de versión (`package.json` + `tauri.conf.json`), según flag `--patch|--minor|--major`.
3. `npm run tauri build` (Windows).
4. Firma el artefacto de update (`tauri signer sign`, clave privada fuera del repo — ver
   `MecanismoCICD.md`), genera/actualiza `latest.json`.
5. `gh release create vX.Y.Z <instalador> <latest.json> --notes "..."` (usa el mismo repo de GitHub que
   ya tienen).
6. Sube el APK debug ya compilado a Drive (reusa la lógica de subida ya existente para documentos).
7. Consulta Supabase: tickets con `estado='aprobado' AND id_release IS NULL`. Compila el changelog con
   sus títulos. Inserta la fila en `release`. Actualiza esos tickets: `id_release = <nuevo>`,
   `estado='cerrado'` — directo, sin paso de confirmación adicional (ver nota de terminología al
   inicio: Cliente=Admin, ya dio su visto bueno al aprobar en el paso 2 del ciclo de vida).

## Verificación

1. `npm run check` — 0 errores, sin subir el conteo de warnings existente.
2. `npx vitest run` — sin romper los 25 tests actuales; agregar pruebas nuevas para
   `tickets.service.ts`/`releases.service.ts` si el patrón del repo ya cubre sus otros servicios con
   tests (hoy la cobertura de tests es baja — no bloquear la migración por esto, pero sí no reducirla).
3. Dev server: `curl` a cada archivo nuevo vía `@fs/`, grep de errores de parseo (mismo procedimiento
   usado en todo este proyecto).
4. Manual, en este orden exacto (ver ciclo de vida arriba): crear un ticket como un rol no-admin →
   aparece en el panel Developer → developer lo marca Resuelto → Admin lo Aprueba → **recién ahí**
   correr el script de deploy en un entorno de prueba → confirmar que el ticket quedó con `id_release`
   seteado y `estado='cerrado'` automáticamente, y que el banner "Actualizar" aparece → probar el botón
   Actualizar en un build de Windows real (no en `npm run tauri dev`, el updater no funciona en modo
   dev).

## Preguntas abiertas (resolver antes de implementar esa parte específica)

1. ¿Dónde vive la clave privada de firma del updater y quién la tiene? (ver `MecanismoCICD.md`,
   sección de secretos) — decidir si el build/firma corre en la máquina del developer o en un runner de
   GitHub Actions con la clave como secret.
2. ¿El catálogo de "módulo" del ticket debe permitir "Otro / No aplica" para reclamos que no son de un
   módulo puntual (ej. "la app se cierra sola")? Recomendado: sí, agregar esa opción al selector.
