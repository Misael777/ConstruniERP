---
name: dar-de-baja-pattern
description: "Use when adding, reviewing, or auditing delete/soft-delete functionality on any top-level entity module in ConstruniERP (Clientes, Ventas, Proveedores, Empleados, Cuentas por Pagar/Cobrar, Cuentas Bancarias, Centro de Costos, or a future module with a directory-style CRUD list). Describes the required pattern: dado-de-baja records hidden from normal lists, an admin-only 'Ver eliminados' view, and true permanent deletion always gated by admin password re-entry."
---

# Patrón "dado de baja oculto + Eliminados solo-admin + borrado permanente con contraseña"

A pedido explícito del usuario, TODOS los módulos de entidades del ERP siguen esta misma regla de
tres capas. No inventes una variante nueva para un módulo nuevo — replica esto.

## Las tres capas

1. **Dar de baja (soft delete)** — reversible, disponible para cualquier usuario (no requiere ser
   admin, no requiere contraseña). Es lo que reemplaza al viejo botón "Eliminar" de cada módulo.
2. **Ver eliminados** — un toggle en la MISMA página (nunca una ruta nueva), visible **solo si
   `isAdmin()`**, que cambia la lista para mostrar ÚNICAMENTE los registros dados de baja. Desde ahí:
   - **Restaurar** — reversible, sin contraseña.
   - **Eliminar permanentemente** — el DELETE real de la fila. SIEMPRE detrás de `AdminConfirmModal`
     (pide correo + contraseña), sin excepción, incluso si quien lo hace ya es admin. Esto es un
     requisito explícito del usuario — no lo omitas "porque ya es admin".
3. **El listado normal** excluye los dados de baja por defecto, para TODOS los usuarios (admin
   incluido) — no es opcional, no hay forma de verlos fuera de "Ver eliminados".

## Columna de estado — cuál usar

Antes de agregar una columna nueva, revisa si la tabla ya tiene una columna de estado libre que
puedas reusar con el valor `'baja'`:

- **Reusar `estado`/`estado_x` con valor `'baja'`** si esa columna hoy es libre/sin otro significado
  fijo — así están `cliente.estado`, `proyecto.estado_proyecto`, `proveedor.estado`,
  `empleados.estado`, `centro_costo.estado`.
- **Agregar una columna booleana `activo`** (nueva, `BOOLEAN NOT NULL DEFAULT true`) si `estado` en
  esa tabla YA significa otra cosa (un workflow, no activo/inactivo) — así están
  `cuentas_pagar.activo`, `cuentas_cobrar.activo`, `cuenta_banco.activo`, porque su `estado` ya es
  `pendiente/vencido/pagado` o (para cuenta_banco) un CHECK con `activa/inactiva/autorizada/
  no_autorizada`. Ver `entidades_activo_migration.sql` para el patrón de migración exacto.

Nunca inventes un tercer nombre de columna (`deleted_at`, `is_deleted`, etc.) — mantiene la
consistencia entre módulos.

## Las 4 funciones de servicio por módulo

Cada `*.service.ts` necesita:

1. **`getX(client, params)`** — agrega un parámetro `soloEliminados?: boolean` a su `ListParams`; el
   query filtra `.eq('estado', 'baja')` / `.eq('activo', false)` si es `true`, o
   `.neq('estado', 'baja')` / `.eq('activo', true)` si es `false`/default.
2. **`darDeBajaX(client, id)`** — `UPDATE ... SET estado = 'baja'` (o `activo = false`). Si la
   entidad tiene un centro de costo propio (cliente/proyecto/proveedor/empleado), también lo da de
   baja en cascada vía `darDeBajaCentroCostoDeEntidad` (`centroCostos.service.ts`) — best-effort, si
   falla se loguea con `console.warn` pero NO revierte el cambio principal.
3. **`restaurarX(client, id)`** — la contraparte exacta: `estado = 'activo'` / `activo = true`, y
   `restaurarCentroCostoDeEntidad` si aplica.
4. **`eliminarXPermanente(client, id)`** (o el `deleteX` que ya existía) — el DELETE real, sin
   cambios de comportamiento; si ya existía un chequeo de dependencias antes de borrar (ver
   `getClienteDependencias`/`deleteClienteCascade` en `aprobaciones.service.ts`), consérvalo — sigue
   aplicando igual.

## La UI por página (`+page.svelte`)

- `let verEliminados = $state(false);` + `function toggleVerEliminados() { verEliminados = !verEliminados; fetchList(); }`.
- Botón "Ver eliminados" / "Volver", gateado por `{#if isAdmin()}` (salvo que la página YA sea
  admin-only por un guard en `onMount`, como Centro de Costos/Cuentas Bancarias — ahí no hace falta
  repetir el chequeo).
- En modo eliminados: título/subtítulo cambian ("X eliminados" + badge "Solo administradores"), los
  botones de alta ("Nuevo X") y otras acciones normales se ocultan, y las acciones de fila cambian de
  Editar/Dar-de-baja a Restaurar/Eliminar-permanente.
- **Confirmaciones**: `ConfirmModal.svelte` (`$lib/shared/components/ConfirmModal.svelte`) para dar
  de baja/restaurar (sin contraseña) — NUNCA `window.confirm()` nativo, que puede fallar en la app de
  Tauri por permisos ACL del plugin de diálogos. `AdminConfirmModal.svelte` +
  `verifyAdminCredentials` (`$lib/shared/adminAuth.ts`) para el borrado permanente — mismo patrón que
  el borrado masivo de Transacciones (`finanzas/tranzacciones/+page.svelte`, el precedente original).
- **Errores**: `toast.error(...)` (`$lib/stores/toast.ts`) con el mensaje completo — usa
  `describeError(err)` (`$lib/shared/describeError.ts`) para incluir code/details/hint, no solo
  `err.message`, así el motivo real queda visible en pantalla sin depender de una consola (no hay una
  accesible en el `.exe` empaquetado).

## Ejemplo de referencia

`comercial/clientes/+page.svelte` + `aprobaciones.service.ts` (`darDeBajaCliente`/
`restaurarCliente`/`deleteClienteCascade`) es la implementación más limpia y completa — cópiala como
plantilla antes que cualquier otro módulo si tienes dudas de estructura exacta.

## Casos especiales ya resueltos (no los repitas dos veces)

- **Ventas**: antes una venta abierta se eliminaba directo (hard) y una cerrada se daba de baja
  (soft) — se unificaron en una sola acción `darDeBajaVenta` que acepta cualquier estado previo.
- **Centro de Costos**: el botón de baja/eliminar SOLO existe para centros manuales sin vincular a
  ninguna entidad (`tipo IN ('obra','consultoria','bolsa general','otro')`, sin
  `id_proyecto/id_cliente/id_proveedor/id_empleado`) — los vinculados se dan de baja en cascada junto
  con su entidad dueña, nunca desde este módulo.
- **Empleados**: además de `empleados.estado`, dar de baja bloquea la cuenta de Auth
  (`ban_duration:'876000h'`) vía la Edge Function `user-admin`; restaurar la desbloquea
  (`ban_duration:'none'`). El borrado permanente (`deleteUser`) borra la cuenta de Auth Y el
  registro. **Cambios a la Edge Function requieren `supabase functions deploy user-admin` — no se
  aplican solos.**

## Fuera de alcance (decisión explícita del usuario)

Transacciones (ya tiene borrado masivo con contraseña, es un libro contable, no una lista de
entidades) y sub-ítems como partidas, roles, líneas de presupuesto, actividades de Gantt — ponerles
contraseña a cada línea sería incómodo de usar. Si el usuario pide extender el patrón a uno de estos,
confirma el alcance con él antes de aplicarlo — no asumas que aplica automáticamente.
