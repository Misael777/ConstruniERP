-- ============================================================
-- MIGRACIÓN: solicitud_aprobacion
--
-- A pedido del usuario: un usuario SIN rango de administrador ya no puede
-- eliminar/editar un cliente o una venta directamente — en su lugar se crea
-- una fila acá, visible en la campanita de notificaciones para TODOS los
-- administradores, que pueden aprobar (aplica el cambio real) o rechazar
-- (no hace nada) desde ahí. Reemplaza al viejo flujo de Ventas que pedía la
-- contraseña de un admin ahí mismo (ConfirmDeleteVentaModal.svelte, ya
-- retirado) por uno asíncrono: no hace falta tener un admin presente.
--
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

CREATE TABLE IF NOT EXISTS solicitud_aprobacion (
    id_solicitud        BIGSERIAL PRIMARY KEY,
    tipo_entidad         VARCHAR(20) NOT NULL CHECK (tipo_entidad IN ('cliente', 'proyecto')),
    id_entidad           BIGINT NOT NULL,
    -- 'cerrar_venta' aparte de 'editar' para poder mostrar un texto/ícono distinto en la campanita
    tipo_accion          VARCHAR(20) NOT NULL CHECK (tipo_accion IN ('editar', 'eliminar', 'cerrar_venta')),
    -- nombre/nombre_proyecto al momento de pedir — evita depender de un join si el registro cambia
    -- de nombre o se borra mientras la solicitud sigue pendiente.
    descripcion_entidad  VARCHAR(200),
    -- campos propuestos a guardar (null para 'eliminar')
    payload_cambios      JSONB,
    solicitado_por       VARCHAR(200),
    solicitado_por_id    UUID,
    estado               VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobado', 'rechazado')),
    resuelto_por         VARCHAR(200),
    resuelto_en          TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_solicitud_estado ON solicitud_aprobacion(estado);

NOTIFY pgrst, 'reload schema';
