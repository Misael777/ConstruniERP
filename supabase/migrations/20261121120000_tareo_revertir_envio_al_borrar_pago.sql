-- Ticket #133 (21/11/2026): Romina envió el tareo de BG-001 (S/ 4,164.77) a Cuentas por Pagar, vio la planilla "duplicada"
-- (semanal + mensual, porque una trabajadora cobra mensual) y eliminó las dos CxP. Los pagos se borraron, pero el tareo
-- siguió marcando "Enviado S/ 4,164.77 · Completo": ya no se podía volver a enviar.
--
-- Ahora, al eliminar un pago que vino de un tareo (directamente o al eliminar su CxP), se deshace ese envío: se resta del
-- "enviado" del trabajador y se borra el registro de tareo_envio, así el tareo vuelve a quedar pendiente y se puede reenviar.
-- Es BEFORE DELETE: la FK tareo_envio.id_pago (ON DELETE SET NULL) se aplica después y ya no permitiría encontrar el envío.
-- No modifica datos existentes. Idempotente.

CREATE OR REPLACE FUNCTION public.fn_tareo_revertir_envio_pago() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
    r record;
BEGIN
    FOR r IN DELETE FROM tareo_envio WHERE id_pago = OLD.id_pago RETURNING id_tareo_trabajador, monto LOOP
        UPDATE tareo_trabajador SET enviado = GREATEST(enviado - r.monto, 0) WHERE id_tareo_trabajador = r.id_tareo_trabajador;
    END LOOP;
    RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_pagos_revertir_envio_tareo ON public.pagos;
CREATE TRIGGER trg_pagos_revertir_envio_tareo
    BEFORE DELETE ON public.pagos
    FOR EACH ROW EXECUTE FUNCTION public.fn_tareo_revertir_envio_pago();

NOTIFY pgrst, 'reload schema';
