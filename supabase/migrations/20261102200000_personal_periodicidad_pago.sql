-- Periodicidad de pago del personal: el monto se registra por el periodo elegido (diario, semanal, quincenal
-- o mensual), en vez de jornal_diario (construcción civil) y sueldo_mensual (régimen general).
-- Los montos existentes pasan a la nueva forma: jornal → diario, sueldo → mensual. Re-ejecutable.

ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS periodicidad_pago varchar(10);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS monto_pago numeric(10,2);

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'personal' AND column_name = 'jornal_diario') THEN
		UPDATE public.personal
		SET periodicidad_pago = CASE WHEN jornal_diario IS NOT NULL THEN 'diaria' ELSE 'mensual' END,
		    monto_pago = COALESCE(jornal_diario, sueldo_mensual)
		WHERE periodicidad_pago IS NULL AND COALESCE(jornal_diario, sueldo_mensual) IS NOT NULL;
	END IF;
END $$;

ALTER TABLE public.personal DROP CONSTRAINT IF EXISTS personal_montos_check;
ALTER TABLE public.personal DROP COLUMN IF EXISTS jornal_diario;
ALTER TABLE public.personal DROP COLUMN IF EXISTS sueldo_mensual;

ALTER TABLE public.personal DROP CONSTRAINT IF EXISTS personal_periodicidad_pago_check;
ALTER TABLE public.personal ADD CONSTRAINT personal_periodicidad_pago_check
	CHECK (periodicidad_pago IS NULL OR periodicidad_pago IN ('diaria', 'semanal', 'quincenal', 'mensual'));
ALTER TABLE public.personal DROP CONSTRAINT IF EXISTS personal_monto_pago_check;
ALTER TABLE public.personal ADD CONSTRAINT personal_monto_pago_check CHECK (monto_pago IS NULL OR monto_pago >= 0);

COMMENT ON COLUMN public.personal.periodicidad_pago IS 'Cada cuánto se le paga: diaria (jornal), semanal, quincenal o mensual.';
COMMENT ON COLUMN public.personal.monto_pago IS 'Monto bruto por periodo de pago (S/), según periodicidad_pago.';

NOTIFY pgrst, 'reload schema';
