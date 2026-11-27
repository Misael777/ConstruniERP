-- Ticket #118 (rechazo 27/11/2026, maquetas de Real y Proyección): el pie del Tareo se ordena en "Control presupuestal"
-- (presupuesto asignado previamente + fecha de asignación) y "Control financiero" (fondo reservado actualmente + fecha
-- de reserva + cuenta bancaria). Faltaban la fecha de asignación, la fecha de reserva y la cuenta bancaria del fondo.
-- Columnas nuevas en tareo_semana (nulas) y una función para guardarlas. No modifica datos existentes. Idempotente.

ALTER TABLE public.tareo_semana ADD COLUMN IF NOT EXISTS presupuesto_fecha date;
ALTER TABLE public.tareo_semana ADD COLUMN IF NOT EXISTS fondo_fecha date;
ALTER TABLE public.tareo_semana ADD COLUMN IF NOT EXISTS fondo_id_cuenta_banco bigint REFERENCES public.cuenta_banco (id_cuenta_banco) ON DELETE SET NULL;

-- Guarda las tres a la vez (la app manda los valores actuales). Mismo permiso que el presupuesto y el fondo.
CREATE OR REPLACE FUNCTION public.fn_tareo_control(
    p_id_centro_costo bigint,
    p_semana_inicio date,
    p_periodo text,
    p_presupuesto_fecha date,
    p_fondo_fecha date,
    p_id_cuenta_banco bigint
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tareo bigint;
BEGIN
    IF NOT tiene_permiso('aprobar_tareo') THEN
        RAISE EXCEPTION 'No tienes permiso para aprobar el tareo.' USING ERRCODE = '42501';
    END IF;
    v_tareo := fn_tareo_asegurar(p_id_centro_costo, p_semana_inicio, COALESCE(p_periodo, 'semanal'));
    UPDATE tareo_semana
    SET presupuesto_fecha = p_presupuesto_fecha, fondo_fecha = p_fondo_fecha, fondo_id_cuenta_banco = p_id_cuenta_banco
    WHERE id_tareo = v_tareo;
END $$;
REVOKE ALL ON FUNCTION public.fn_tareo_control(bigint, date, text, date, date, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tareo_control(bigint, date, text, date, date, bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';
