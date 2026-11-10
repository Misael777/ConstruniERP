-- Referente del trabajador en su ficha de Personal (a pedido del usuario, 07/11/2026): quién lo trajo o responde
-- por él en obra (p. ej. el subcontratista). Nombre libre; el cargo se elige de una lista que vive en
-- personal.service.ts (CARGOS_REFERENTE), por eso no tiene lista fija en la base.
-- Idempotente.

ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS referente_nombre varchar(150);
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS referente_cargo varchar(50);
COMMENT ON COLUMN public.personal.referente_nombre IS 'Nombre del referente (p. ej. el subcontratista que lo trajo).';
COMMENT ON COLUMN public.personal.referente_cargo IS 'Cargo del referente (Subcontratista, Contratista…).';

NOTIFY pgrst, 'reload schema';
