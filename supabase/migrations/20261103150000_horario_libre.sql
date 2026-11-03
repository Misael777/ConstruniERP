-- Horario libre: trabajadores que se cuentan por horas, sin hora de entrada ni de salida.
-- horario.tipo = 'fijo' (el de siempre: jornada por día en horario_dia, con tardanza, faltas y horas extra) o 'libre'
-- (sin días en horario_dia: el ERP suma por día los tramos entre marcas — entrada→salida, entrada→salida… — y no calcula
-- tardanza, faltas ni horas extra). Crea el horario "Horario libre" si no existe.
-- Idempotente.

ALTER TABLE public.horario ADD COLUMN IF NOT EXISTS tipo varchar(10) NOT NULL DEFAULT 'fijo';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'horario_tipo_check') THEN
        ALTER TABLE public.horario ADD CONSTRAINT horario_tipo_check CHECK (tipo IN ('fijo', 'libre'));
    END IF;
END $$;
COMMENT ON COLUMN public.horario.tipo IS 'fijo: jornada por día (horario_dia). libre: por horas, sin entrada ni salida; se suman los tramos entre marcas.';

INSERT INTO public.horario (nombre, tolerancia_min, tipo)
SELECT 'Horario libre', 0, 'libre'
WHERE NOT EXISTS (SELECT 1 FROM public.horario WHERE tipo = 'libre' AND estado = 'activo')
  AND NOT EXISTS (SELECT 1 FROM public.horario WHERE lower(nombre) = 'horario libre' AND estado = 'activo');

NOTIFY pgrst, 'reload schema';
