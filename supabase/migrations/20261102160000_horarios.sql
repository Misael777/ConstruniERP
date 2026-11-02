-- Horarios de trabajo (módulo Personal y Asistencia). Catálogo de horarios con entrada/salida/refrigerio por día
-- de la semana (el sábado de construcción civil suele ser más corto), tolerancia de tardanza, y un horario
-- asignado a cada trabajador (personal.id_horario). El control de asistencia compara las marcas contra esto.
-- Se crean dos horarios de ejemplo editables. Idempotente.

CREATE TABLE IF NOT EXISTS public.horario (
    id_horario      bigserial PRIMARY KEY,
    nombre          varchar(80) NOT NULL,
    tolerancia_min  smallint NOT NULL DEFAULT 10 CHECK (tolerancia_min BETWEEN 0 AND 120),
    estado          varchar(10) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'baja')),
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_horario_nombre ON public.horario (lower(nombre)) WHERE estado = 'activo';

-- Un registro por día laborable (dia ISO: 1 = lunes … 7 = domingo). Día sin registro = descanso.
CREATE TABLE IF NOT EXISTS public.horario_dia (
    id_horario         bigint NOT NULL REFERENCES public.horario (id_horario) ON DELETE CASCADE,
    dia                smallint NOT NULL CHECK (dia BETWEEN 1 AND 7),
    hora_entrada       time NOT NULL,
    hora_salida        time NOT NULL,
    refrigerio_inicio  time,
    refrigerio_fin     time,
    PRIMARY KEY (id_horario, dia),
    CHECK (hora_salida > hora_entrada),
    CHECK ((refrigerio_inicio IS NULL) = (refrigerio_fin IS NULL)),
    CHECK (refrigerio_inicio IS NULL OR (refrigerio_inicio >= hora_entrada AND refrigerio_fin > refrigerio_inicio AND refrigerio_fin <= hora_salida))
);

ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS id_horario bigint REFERENCES public.horario (id_horario) ON DELETE SET NULL;

ALTER TABLE public.horario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.horario_dia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS horario_autenticados ON public.horario;
CREATE POLICY horario_autenticados ON public.horario TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS horario_dia_autenticados ON public.horario_dia;
CREATE POLICY horario_dia_autenticados ON public.horario_dia TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.horario, public.horario_dia TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.horario_id_horario_seq TO authenticated;

-- Horarios de ejemplo (solo si el catálogo está vacío).
DO $$
DECLARE v_id bigint;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.horario) THEN
        INSERT INTO public.horario (nombre, tolerancia_min) VALUES ('Construcción civil (48 h)', 10) RETURNING id_horario INTO v_id;
        INSERT INTO public.horario_dia (id_horario, dia, hora_entrada, hora_salida, refrigerio_inicio, refrigerio_fin)
        SELECT v_id, d, '07:30', '17:00', '12:00', '13:00' FROM generate_series(1, 5) d;
        INSERT INTO public.horario_dia (id_horario, dia, hora_entrada, hora_salida) VALUES (v_id, 6, '07:30', '13:00');

        INSERT INTO public.horario (nombre, tolerancia_min) VALUES ('Oficina (lunes a viernes)', 10) RETURNING id_horario INTO v_id;
        INSERT INTO public.horario_dia (id_horario, dia, hora_entrada, hora_salida, refrigerio_inicio, refrigerio_fin)
        SELECT v_id, d, '08:30', '18:00', '13:00', '14:00' FROM generate_series(1, 5) d;
    END IF;
END $$;

INSERT INTO permisos (nombre, descripcion)
SELECT 'ver_rrhh_horarios', 'Ver y configurar los horarios de trabajo'
WHERE NOT EXISTS (SELECT 1 FROM permisos WHERE nombre = 'ver_rrhh_horarios');
INSERT INTO roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.nombre = 'ver_rrhh_horarios'
WHERE r.nombre IN ('administrador', 'socio')
  AND NOT EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);

NOTIFY pgrst, 'reload schema';
