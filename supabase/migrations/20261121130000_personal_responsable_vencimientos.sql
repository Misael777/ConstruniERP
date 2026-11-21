-- Ticket #125 (rechazo 20/11/2026): "agregarle el campo de responsable para los vencimientos, porque estará ligado con
-- las tareas". Usuario del ERP que debe renovar el SCTR / examen médico del trabajador: esas alertas le aparecen en
-- "Mis tareas" del ícono ⚠ (Alertas de tareas). Se guarda el nombre del usuario, igual que el Responsable de CxC/CxP.
-- Columna nueva y nula: no modifica datos existentes. Idempotente.
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS responsable_vencimientos varchar(200);
NOTIFY pgrst, 'reload schema';
