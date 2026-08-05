-- ============================================================
-- MIGRACIÓN: seguimiento de notificaciones POR USUARIO (reemplaza el intento anterior)
--
-- El primer intento agregaba una columna `notificado` booleana directo en solicitud_aprobacion.
-- Estaba mal: una solicitud pendiente la ven TODOS los admins a la vez — con un solo booleano
-- COMPARTIDO, apenas el poll de UN admin la marcaba notificado=true, el resto de los admins dejaban
-- de recibir su propio aviso (sonido/toast) por esa misma solicitud. Se elimina esa columna.
--
-- En su lugar: una tabla aparte con una fila POR (solicitud, usuario) — cada usuario lleva su propio
-- registro de "hasta qué estado de esta solicitud ya fui notificado". `estado_anterior` es el último
-- estado por el que ESTE usuario particular ya sonó/recibió el toast nativo. Se compara contra el
-- estado ACTUAL de la solicitud como un flanco de subida en una señal: si son distintos (incluido
-- nunca haber sido notificado, estado_anterior IS NULL), corresponde notificar de nuevo — así
-- cualquier cambio de estado (pendiente -> aprobado, pendiente -> rechazado, etc.) dispara un aviso
-- nuevo, de forma independiente para cada usuario.
--
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

ALTER TABLE solicitud_aprobacion DROP COLUMN IF EXISTS notificado;

CREATE TABLE IF NOT EXISTS solicitud_notificacion (
    id_notificacion    BIGSERIAL PRIMARY KEY,
    id_solicitud       BIGINT NOT NULL REFERENCES solicitud_aprobacion(id_solicitud) ON DELETE CASCADE,
    usuario_id         UUID NOT NULL,
    -- Último estado ('pendiente'/'aprobado'/'rechazado') de la solicitud por el que ESTE usuario ya
    -- fue notificado. NULL = todavía nunca se le notificó nada de esta solicitud.
    estado_anterior    VARCHAR(20),
    notificado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (id_solicitud, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_solicitud_notificacion_usuario ON solicitud_notificacion(usuario_id);
CREATE INDEX IF NOT EXISTS idx_solicitud_notificacion_solicitud ON solicitud_notificacion(id_solicitud);

NOTIFY pgrst, 'reload schema';
