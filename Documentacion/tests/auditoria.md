# Tests — Auditoría (Control de Accesos → Auditoría)

Módulo que registra sesiones, acciones y errores. Ver `GuiaAgente.md` §7c y la migración
`supabase/migrations/20261002120000_auditoria.sql`.

## A. Base de datos

Corrida el 2026-10-02 en un Postgres 16 local temporal (Dev no respondía). Se usaron stubs de `auth.uid()`,
empleados, roles y una tabla `transaccion`, y las peticiones de la app se simularon con
`request.jwt.claims` / `request.headers`.

| ID | Caso | Resultado |
|---|---|---|
| AU-01 | La migración corre dos veces seguidas sin error (idempotente) | PASS |
| AU-02 | Usuario autenticado abre sesión y recibe id + token; el latido actualiza `ultimo_latido` | PASS |
| AU-03 | INSERT/UPDATE/DELETE en una tabla de negocio quedan registrados y ligados a la sesión del header | PASS |
| AU-04 | UPDATE que solo toca `updated_at` no se registra; un UPDATE real guarda solo las columnas que cambiaron (antes/después) | PASS |
| AU-05 | Usuario sin el permiso `ver_iam_auditoria` no ve ninguna fila (RLS) | PASS |
| AU-06 | Evento de PDF con el token correcto se registra; con un token falso no | PASS |
| AU-07 | Con la sesión de Supabase ya perdida (rol `anon`), el cierre `sesion_expirada` se registra con el token | PASS |
| AU-08 | `anon` no puede abrir sesión, leer los tokens ni insertar directo en las tablas | PASS |
| AU-09 | Sesión sin latido por más de 3 min: `auditoria_cerrar_huerfanas()` la cierra como `cierre_inesperado` | PASS |
| AU-10 | Si después llega desde el diario local el cierre real (`app_cerrada` con su hora), reemplaza al `cierre_inesperado` | PASS |
| AU-11 | Freno de errores: de 35 errores en un minuto se guardan 30 | PASS |
| AU-12 | `auditoria_purgar()` borra la acción de hace 15 días y el error de hace 8 días, y conserva el resto | PASS |
| AU-13 | Un usuario que manda en el header la sesión de OTRO usuario: el cambio queda a su nombre y sin sesión ajena | PASS |

**Repetida en Supabase Dev real (2026-10-02)** con AU-02 a AU-11 y AU-13:
- Todo dentro de una transacción con `ROLLBACK`, usando los empleados seed vinculados temporalmente a
  usuarios de prueba. Dev quedó sin rastros.
- Resultado: todos PASS, con los mismos valores que en local.
- AU-03 se probó con un UPDATE real sobre `transaccion` y con un INSERT/DELETE sobre `cliente`.

**AU-30 (CORS del header `x-auditoria-sesion`) — PASS en Dev:**
- El preflight es aceptado (200, allow-origin `*`, header permitido) desde `http://tauri.localhost`,
  `tauri://localhost` y `http://localhost:5173`, en `/rest/v1`, `/auth/v1` y `/storage/v1`.
- Un GET real con el header responde 200.
- El RPC `auditoria_latido` como anon responde 204, y `auditoria_purgar` como anon responde 401 (negado).

## B. App (pendiente: requiere un usuario de Auth en Dev y `npm run tauri dev`)

| ID | Caso | Esperado |
|---|---|---|
| AU-20 | Iniciar sesión | La sesión aparece en "Conectados ahora" |
| AU-21 | Editar una transacción | Aparece en Acciones con el detalle antes → después |
| AU-22 | "Cerrar sesión" desde la barra superior y desde el menú lateral | `logout_manual` en ambos casos |
| AU-23 | Cerrar la ventana con la X | `app_cerrada` con la hora exacta |
| AU-24 | Terminar el proceso desde el Administrador de tareas y volver a entrar | La sesión anterior queda `cierre_inesperado` a la hora del último latido |
| AU-25 | Forzar la pérdida de sesión (borrar el token en devtools o dejar el equipo sin red) | `sesion_expirada` |
| AU-26 | Generar una factura en PDF y exportar Ventas a Excel | Acciones `pdf` y `descarga` |
| AU-27 | Recargar la página (F5) en la versión web | Sigue la MISMA sesión; no queda un `app_cerrada` falso |
| AU-28 | Android: mandar la app a segundo plano y cerrarla desde recientes | `cierre_inesperado` |
| AU-29 | Usuario sin el permiso | No ve "Auditoría" en el menú |
| AU-30 | **Crítico antes de publicar** | Todas las peticiones a Supabase siguen funcionando con el header `x-auditoria-sesion` (CORS) — **PASS en Dev a nivel API** (ver arriba); falta confirmarlo navegando la app |
