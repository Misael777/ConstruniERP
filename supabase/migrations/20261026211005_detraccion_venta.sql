-- Detracción en las ventas (a pedido del usuario, Nueva/Editar venta): campo "Detracción" Sí/No y su porcentaje.
-- Con detracción, CADA cuota de la venta (armadas del adelanto, pagos de valorización, cuotas del plan de pagos) se
-- parte en dos cuotas de la misma Cuenta por Cobrar:
--   - la cuota neta  = monto × (1 − %)   → lo que entra a la cuenta de la empresa;
--   - su detracción  = monto × %          → lo que el cliente deposita en Banco de la Nación, con vencimiento
--                                           5 días hábiles (lunes a viernes) después de la cuota.
-- Así la suma de cuotas + detracciones sigue siendo igual al valor de venta. La detracción queda pendiente por
-- defecto, o cobrada junto con su armada si el usuario lo indica.
-- Idempotente.

-- Porcentaje de detracción de la venta (NULL = sin detracción).
ALTER TABLE public.proyecto ADD COLUMN IF NOT EXISTS detraccion_porcentaje numeric(5,2);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proyecto_detraccion_porcentaje_check') THEN
        ALTER TABLE public.proyecto ADD CONSTRAINT proyecto_detraccion_porcentaje_check
            CHECK (detraccion_porcentaje IS NULL OR (detraccion_porcentaje > 0 AND detraccion_porcentaje < 100));
    END IF;
END $$;

-- La cuota de detracción y la cuota de la que sale (borrar la cuota de origen borra su detracción).
ALTER TABLE public.cobros ADD COLUMN IF NOT EXISTS es_detraccion boolean NOT NULL DEFAULT false;
ALTER TABLE public.cobros ADD COLUMN IF NOT EXISTS id_cobro_origen bigint REFERENCES public.cobros (id_cobro) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS ix_cobros_id_cobro_origen ON public.cobros (id_cobro_origen);
-- Casilla bajo el N.° de una cuota (Forma de cobranza): su detracción se cobra JUNTO con la cuota — al registrar el
-- cobro de la cuota, la detracción se registra cobrada en el mismo momento, con su transacción relacionada.
ALTER TABLE public.cobros ADD COLUMN IF NOT EXISTS detraccion_junto boolean NOT NULL DEFAULT false;

-- La transacción de una detracción cobrada junto con su armada queda RELACIONADA a la transacción de esa armada
-- (no es una transacción independiente). fn_crear_transaccion inserta columnas fijas, así que la app la completa
-- justo después de crearla (ver cobrarDetraccionConSuArmada en detraccion.service.ts).
ALTER TABLE public.transaccion ADD COLUMN IF NOT EXISTS id_transaccion_origen bigint REFERENCES public.transaccion (id_transaccion) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_transaccion_id_transaccion_origen ON public.transaccion (id_transaccion_origen);

NOTIFY pgrst, 'reload schema';
