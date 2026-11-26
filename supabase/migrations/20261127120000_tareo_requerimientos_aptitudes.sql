-- Ticket #118 rechazado (26/11/2026, maqueta de la clienta): en la vista PROYECCIÓN del tareo "no solo proyectamos por
-- dinero disponible, sino al personal según lo que sabe en campo".
--  - personal.aptitudes: lo que sabe hacer el trabajador (etiquetas libres: "Tarrajeo", "Asentado de ladrillos"...).
--  - tareo_requerimiento: personal requerido por obra (cargo, cantidad, aptitudes requeridas, tarifa de referencia).
--    semana_inicio NULL = vale para todas las semanas de la obra; con fecha = solo esa semana.
--  - tareo_obra_config.requerimiento_modo: cada obra elige si sus requerimientos son "por obra" o "por semana".
--  - tareo_semana.presupuesto_disponible: presupuesto que se escribe a mano para la semana (o la quincena/mes en
--    Consultoría y Corporativo); el ERP lo muestra junto al saldo real de la obra.
--  - fn_tareo_fondo / fn_tareo_presupuesto aceptan el periodo (Consultoría y Corporativo: quincenal o mensual).
-- No modifica datos existentes. Idempotente.

ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS aptitudes text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.tareo_semana ADD COLUMN IF NOT EXISTS presupuesto_disponible numeric(14, 2);

CREATE TABLE IF NOT EXISTS public.tareo_obra_config (
    id_centro_costo     bigint PRIMARY KEY REFERENCES public.centro_costo (id_centro_costo) ON DELETE CASCADE,
    requerimiento_modo  text NOT NULL DEFAULT 'obra' CHECK (requerimiento_modo IN ('obra', 'semana')),
    usuario             text,
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tareo_requerimiento (
    id_requerimiento  bigserial PRIMARY KEY,
    id_centro_costo   bigint NOT NULL REFERENCES public.centro_costo (id_centro_costo) ON DELETE CASCADE,
    semana_inicio     date,
    cargo             text NOT NULL CHECK (length(btrim(cargo)) BETWEEN 1 AND 100),
    cantidad          integer NOT NULL CHECK (cantidad BETWEEN 1 AND 999),
    aptitudes         text[] NOT NULL DEFAULT '{}',
    tarifa_dia        numeric(10, 2) CHECK (tarifa_dia IS NULL OR tarifa_dia >= 0),
    usuario           text,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_tareo_requerimiento_obra ON public.tareo_requerimiento (id_centro_costo, semana_inicio);

ALTER TABLE public.tareo_obra_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tareo_requerimiento ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['tareo_obra_config', 'tareo_requerimiento'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %1$s_leer ON public.%1$s', t);
        EXECUTE format('CREATE POLICY %1$s_leer ON public.%1$s FOR SELECT TO authenticated USING (tiene_permiso(''ver_rrhh_asistencia''))', t);
        EXECUTE format('DROP POLICY IF EXISTS %1$s_escribir ON public.%1$s', t);
        EXECUTE format('CREATE POLICY %1$s_escribir ON public.%1$s FOR ALL TO authenticated USING (tiene_permiso(''aprobar_tareo'')) WITH CHECK (tiene_permiso(''aprobar_tareo''))', t);
    END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tareo_obra_config, public.tareo_requerimiento TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.tareo_requerimiento_id_requerimiento_seq TO authenticated;

-- Fondo separado con periodo (antes solo semanal). Se reemplaza la versión de 3 parámetros: las llamadas con 3 siguen
-- funcionando por el valor por defecto.
DROP FUNCTION IF EXISTS public.fn_tareo_fondo(bigint, date, numeric);
CREATE OR REPLACE FUNCTION public.fn_tareo_fondo(p_id_centro_costo bigint, p_semana_inicio date, p_monto numeric, p_periodo text DEFAULT 'semanal')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tareo bigint;
BEGIN
    IF NOT tiene_permiso('aprobar_tareo') THEN
        RAISE EXCEPTION 'No tienes permiso para aprobar el tareo.' USING ERRCODE = '42501';
    END IF;
    v_tareo := fn_tareo_asegurar(p_id_centro_costo, p_semana_inicio, COALESCE(p_periodo, 'semanal'));
    UPDATE tareo_semana SET fondo_separado = CASE WHEN p_monto IS NULL OR p_monto < 0 THEN NULL ELSE round(p_monto, 2) END
    WHERE id_tareo = v_tareo;
END $$;
REVOKE ALL ON FUNCTION public.fn_tareo_fondo(bigint, date, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tareo_fondo(bigint, date, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_tareo_presupuesto(p_id_centro_costo bigint, p_semana_inicio date, p_monto numeric, p_periodo text DEFAULT 'semanal')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tareo bigint;
BEGIN
    IF NOT tiene_permiso('aprobar_tareo') THEN
        RAISE EXCEPTION 'No tienes permiso para aprobar el tareo.' USING ERRCODE = '42501';
    END IF;
    v_tareo := fn_tareo_asegurar(p_id_centro_costo, p_semana_inicio, COALESCE(p_periodo, 'semanal'));
    UPDATE tareo_semana SET presupuesto_disponible = CASE WHEN p_monto IS NULL OR p_monto < 0 THEN NULL ELSE round(p_monto, 2) END
    WHERE id_tareo = v_tareo;
END $$;
REVOKE ALL ON FUNCTION public.fn_tareo_presupuesto(bigint, date, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tareo_presupuesto(bigint, date, numeric, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
