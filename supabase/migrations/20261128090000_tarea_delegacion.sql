-- Ticket #128 (rechazo 27/11/2026: "Falta un botón para delegar a otra persona"): delegar una tarea de "Alertas de
-- tareas" / "Tareas de hoy" a otro usuario del ERP. COMPARTIDA (todos ven a quién está a cargo). La tarea pasa a
-- "Mis tareas" de la persona elegida y a "Delegadas" de quien la delegó. Sin fila = el responsable de siempre (el de la
-- cuenta o el "Responsable de los vencimientos" de la ficha). No modifica las cuentas ni las fichas. Idempotente.

CREATE TABLE IF NOT EXISTS public.tarea_delegacion (
    id_alerta     text PRIMARY KEY CHECK (length(id_alerta) BETWEEN 1 AND 120),
    responsable   text NOT NULL CHECK (length(btrim(responsable)) BETWEEN 1 AND 200),
    delegado_por  text,
    updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tarea_delegacion ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tarea_delegacion_todos ON public.tarea_delegacion;
CREATE POLICY tarea_delegacion_todos ON public.tarea_delegacion
    TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tarea_delegacion TO authenticated;

NOTIFY pgrst, 'reload schema';
