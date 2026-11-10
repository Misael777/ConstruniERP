-- "Mi asistencia" (a pedido del usuario, 06/11/2026): el empleado que usa el ERP registra su ingreso y su salida
-- desde el propio ERP (botón «Mi asistencia» en Inicio), sin huellero. Solo para horario libre o mixto (los de
-- horario fijo marcan en el huellero): las marcas se suman en pares igual que las del huellero (calcularAsistencia) y entran al
-- tareo de su obra.
--
-- 1) personal.id_empleado: vincula la ficha de Personal con el usuario del ERP (empleados) que marca por ella.
-- 2) asistencia_marcacion.origen ('huellero' | 'erp') e id_dispositivo opcional (las marcas del ERP no tienen equipo).
-- 3) fn_mi_asistencia / fn_mi_asistencia_marcar (SECURITY DEFINER): cada usuario solo lee y marca lo SUYO; la hora la
--    pone el servidor (now()), no el dispositivo.
-- 4) Ya no hay permiso de menú: el botón está en Inicio y se ve según el horario de la ficha (se borra
--    ver_rrhh_mi_asistencia si una versión previa de esta migración lo creó).
-- Idempotente.

-- 1) Vínculo ficha ↔ usuario del ERP --------------------------------------------------------------------------------
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS id_empleado integer REFERENCES public.empleados (id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_personal_empleado ON public.personal (id_empleado) WHERE id_empleado IS NOT NULL;
COMMENT ON COLUMN public.personal.id_empleado IS 'Usuario del ERP (empleados) que registra su asistencia desde "Mi asistencia". Uno a uno.';

-- 2) Marcas desde el ERP --------------------------------------------------------------------------------------------
ALTER TABLE public.asistencia_marcacion ALTER COLUMN id_dispositivo DROP NOT NULL;
ALTER TABLE public.asistencia_marcacion ADD COLUMN IF NOT EXISTS origen varchar(10) NOT NULL DEFAULT 'huellero';
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asistencia_marcacion_origen_check') THEN
        ALTER TABLE public.asistencia_marcacion ADD CONSTRAINT asistencia_marcacion_origen_check CHECK (origen IN ('huellero', 'erp'));
    END IF;
END $$;
COMMENT ON COLUMN public.asistencia_marcacion.origen IS 'huellero = marca del equipo ZKTeco; erp = registrada por el empleado en "Mi asistencia" (sin id_dispositivo).';

-- 3) Lectura y marca del propio usuario -----------------------------------------------------------------------------
-- Ficha del usuario conectado (null si su usuario no está vinculado a ninguna ficha activa).
CREATE OR REPLACE FUNCTION public.fn_mi_asistencia_ficha() RETURNS public.personal
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT p.* FROM personal p
    JOIN empleados e ON e.id = p.id_empleado
    WHERE e.auth_user_id = auth.uid() AND e.estado = 'activo' AND p.estado <> 'baja'
    LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.fn_mi_asistencia_ficha() FROM PUBLIC, anon;

-- Ficha, horario y marcas del usuario entre dos fechas (hora de Lima, inclusive).
CREATE OR REPLACE FUNCTION public.fn_mi_asistencia(p_desde date, p_hasta date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_p personal;
BEGIN
    v_p := fn_mi_asistencia_ficha();
    IF v_p.id_personal IS NULL THEN RETURN NULL; END IF;
    IF p_hasta - p_desde > 62 THEN RAISE EXCEPTION 'El periodo no puede pasar de 62 días.'; END IF;
    RETURN jsonb_build_object(
        'personal', jsonb_build_object(
            'id_personal', v_p.id_personal, 'pin', v_p.pin,
            'nombre', COALESCE(NULLIF(btrim(concat_ws(' ', v_p.nombres, v_p.apellidos)), ''), v_p.nombre),
            'fecha_ingreso', v_p.fecha_ingreso, 'fecha_cese', v_p.fecha_cese,
            'obra', (SELECT cc.nombre FROM centro_costo cc WHERE cc.id_centro_costo = v_p.id_centro_costo)),
        'horario', (SELECT to_jsonb(h) || jsonb_build_object('horario_dia',
                        COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.dia) FROM horario_dia d WHERE d.id_horario = h.id_horario), '[]'::jsonb))
                    FROM horario h WHERE h.id_horario = v_p.id_horario),
        'marcas', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('marcado_en', m.marcado_en, 'evento', m.evento, 'origen', m.origen,
                                                'huellero', d.nombre) ORDER BY m.marcado_en)
            FROM asistencia_marcacion m LEFT JOIN asistencia_dispositivo d ON d.id_dispositivo = m.id_dispositivo
            WHERE m.pin = v_p.pin
              AND m.marcado_en >= (p_desde::timestamp AT TIME ZONE 'America/Lima')
              AND m.marcado_en < ((p_hasta + 1)::timestamp AT TIME ZONE 'America/Lima')), '[]'::jsonb)
    );
END;
$$;
REVOKE ALL ON FUNCTION public.fn_mi_asistencia(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mi_asistencia(date, date) TO authenticated;

-- Registra una marca del usuario conectado con la hora del servidor. Rechaza un segundo clic dentro de 2 minutos
-- (la misma regla de "marca repetida" que usa el cálculo de asistencia).
CREATE OR REPLACE FUNCTION public.fn_mi_asistencia_marcar() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_p personal;
    v_ahora timestamptz := now();
BEGIN
    v_p := fn_mi_asistencia_ficha();
    IF v_p.id_personal IS NULL THEN
        RAISE EXCEPTION 'Tu usuario no está vinculado a una ficha de Personal. Pide a un administrador que lo vincule.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM horario h WHERE h.id_horario = v_p.id_horario AND h.tipo IN ('libre', 'mixto')) THEN
        RAISE EXCEPTION 'Tu horario es fijo: registra tu asistencia en el huellero.';
    END IF;
    IF EXISTS (SELECT 1 FROM asistencia_marcacion
               WHERE pin = v_p.pin AND marcado_en > v_ahora - interval '2 minutes' AND (evento IS NULL OR evento < 20)) THEN
        RAISE EXCEPTION 'Ya registraste hace un momento. Espera 2 minutos para volver a marcar.';
    END IF;
    INSERT INTO asistencia_marcacion (id_dispositivo, pin, marcado_en, origen, id_centro_costo)
    VALUES (NULL, v_p.pin, v_ahora, 'erp', v_p.id_centro_costo);
    RETURN jsonb_build_object('marcado_en', v_ahora);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_mi_asistencia_marcar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mi_asistencia_marcar() TO authenticated;

-- 4) Sin permiso de menú (el botón está en Inicio). Limpia el que creaba una versión previa de esta migración.
DELETE FROM public.roles_permisos WHERE permiso_id IN (SELECT id FROM public.permisos WHERE nombre = 'ver_rrhh_mi_asistencia');
DELETE FROM public.permisos WHERE nombre = 'ver_rrhh_mi_asistencia';

NOTIFY pgrst, 'reload schema';
