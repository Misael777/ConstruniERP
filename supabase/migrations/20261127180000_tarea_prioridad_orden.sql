-- Pedido de la clienta (27/11/2026) para "Tareas de hoy": cambiar la prioridad de una tarea y ordenarlas a mano
-- (arrastrando), además de una vista calendario donde se mueven de día (eso usa tarea_estado: aplazar hasta un día).
--
-- tarea_prioridad: prioridad puesta a mano, COMPARTIDA (todos los que ven la tarea ven la misma). Solo para las tareas
--   de Recursos Humanos y Proyectos; en Finanzas la prioridad se guarda en la propia cuenta (cuentas_cobrar.prioridad /
--   cuentas_pagar.prioridad), la misma que se ve en Cuentas por Cobrar / por Pagar. Sin fila = automática (por fecha).
-- tarea_orden: orden manual dentro de cada área, PERSONAL (cada usuario ordena sus tareas).
-- Tablas nuevas, no modifican datos existentes. Idempotente.

CREATE TABLE IF NOT EXISTS public.tarea_prioridad (
    id_alerta   text PRIMARY KEY CHECK (length(id_alerta) BETWEEN 1 AND 120),
    prioridad   text NOT NULL CHECK (prioridad IN ('alta', 'media', 'baja')),
    usuario     text,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tarea_prioridad ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tarea_prioridad_todos ON public.tarea_prioridad;
CREATE POLICY tarea_prioridad_todos ON public.tarea_prioridad
    TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tarea_prioridad TO authenticated;

CREATE TABLE IF NOT EXISTS public.tarea_orden (
    auth_user_id  uuid NOT NULL DEFAULT auth.uid(),
    id_alerta     text NOT NULL CHECK (length(id_alerta) BETWEEN 1 AND 120),
    orden         integer NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (auth_user_id, id_alerta)
);

ALTER TABLE public.tarea_orden ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tarea_orden_propias ON public.tarea_orden;
CREATE POLICY tarea_orden_propias ON public.tarea_orden
    TO authenticated USING (auth_user_id = auth.uid()) WITH CHECK (auth_user_id = auth.uid());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tarea_orden TO authenticated;

NOTIFY pgrst, 'reload schema';
