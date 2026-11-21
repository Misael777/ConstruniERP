-- Ticket #133 (21/11/2026): tareos que quedaron marcados como "Enviado" aunque sus pagos en Cuentas por Pagar ya se
-- eliminaron (antes del trigger trg_pagos_revertir_envio_tareo). Desde el Tareo semanal, quien tiene el permiso
-- aprobar_tareo ve un aviso "pagos eliminados" y puede liberar esos montos para volver a enviarlos.
--
-- Solo toca envíos cuyo pago ya no existe (tareo_envio.id_pago IS NULL) de la obra y semana indicadas: resta su monto del
-- "enviado" del trabajador y borra el registro del envío. No toca CxP ni pagos. Devuelve el monto liberado. Idempotente.

CREATE OR REPLACE FUNCTION public.fn_tareo_liberar_envios_sin_pago(p_id_centro_costo bigint, p_semana_inicio date)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
    r record;
    v_total numeric := 0;
BEGIN
    IF NOT tiene_permiso('aprobar_tareo') THEN
        RAISE EXCEPTION 'No tienes permiso para aprobar tareos';
    END IF;
    FOR r IN
        DELETE FROM tareo_envio e
        USING tareo_trabajador tt, tareo_semana ts
        WHERE e.id_tareo_trabajador = tt.id_tareo_trabajador
          AND tt.id_tareo = ts.id_tareo
          AND ts.id_centro_costo = p_id_centro_costo
          AND ts.semana_inicio = p_semana_inicio
          AND e.id_pago IS NULL
        RETURNING e.id_tareo_trabajador, e.monto
    LOOP
        UPDATE tareo_trabajador SET enviado = GREATEST(enviado - r.monto, 0) WHERE id_tareo_trabajador = r.id_tareo_trabajador;
        v_total := v_total + r.monto;
    END LOOP;
    RETURN v_total;
END $$;

REVOKE ALL ON FUNCTION public.fn_tareo_liberar_envios_sin_pago(bigint, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tareo_liberar_envios_sin_pago(bigint, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
