-- Vínculo y empleador del trabajador + fecha del salario vigente (a pedido del usuario, 11/11/2026, con el nuevo
-- formato de la pantalla Personal):
--   vinculo: 'planilla_propia' (en planilla de la empresa) o 'subcontratista' (personal de un subcontratista).
--            Vacío = se deduce del régimen (subcontrata → subcontratista; el resto → planilla propia).
--   empleador_nombre / empleador_ruc: la empresa que lo emplea cuando es personal de un subcontratista
--            (en planilla propia, vacío = la propia empresa).
--   empleador_tamano: régimen de la empresa empleadora: 'micro' / 'pequena' (REMYPE) o 'general'.
--   monto_pago_desde: desde cuándo rige el monto de pago actual ("Salario vigente · Desde").
-- Idempotente.

ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS vinculo varchar(20);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS empleador_nombre varchar(150);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS empleador_ruc varchar(11);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS empleador_tamano varchar(10);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS monto_pago_desde date;

ALTER TABLE public.personal DROP CONSTRAINT IF EXISTS personal_vinculo_check;
ALTER TABLE public.personal ADD CONSTRAINT personal_vinculo_check
    CHECK (vinculo IS NULL OR vinculo IN ('planilla_propia', 'subcontratista'));
ALTER TABLE public.personal DROP CONSTRAINT IF EXISTS personal_empleador_tamano_check;
ALTER TABLE public.personal ADD CONSTRAINT personal_empleador_tamano_check
    CHECK (empleador_tamano IS NULL OR empleador_tamano IN ('micro', 'pequena', 'general'));
ALTER TABLE public.personal DROP CONSTRAINT IF EXISTS personal_empleador_ruc_check;
ALTER TABLE public.personal ADD CONSTRAINT personal_empleador_ruc_check
    CHECK (empleador_ruc IS NULL OR empleador_ruc ~ '^\d{11}$');

COMMENT ON COLUMN public.personal.vinculo IS 'planilla_propia | subcontratista (vacío = según el régimen).';
COMMENT ON COLUMN public.personal.empleador_nombre IS 'Empresa empleadora si es personal de un subcontratista (vacío = la propia empresa).';
COMMENT ON COLUMN public.personal.empleador_ruc IS 'RUC de la empresa empleadora (11 dígitos).';
COMMENT ON COLUMN public.personal.empleador_tamano IS 'Régimen de la empresa empleadora: micro / pequena (REMYPE) / general.';
COMMENT ON COLUMN public.personal.monto_pago_desde IS 'Desde cuándo rige el monto de pago actual.';

NOTIFY pgrst, 'reload schema';
