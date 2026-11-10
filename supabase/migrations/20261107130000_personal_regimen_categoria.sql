-- Régimen y categoría del personal (a pedido del usuario, 07/11/2026).
-- Régimen: Construcción civil, Contrata, Subcontrata, Régimen general.
-- Categoría (para construcción civil, contrata y subcontrata): las mismas especialidades que Sub Contrata en
-- Transacciones (Operario Carpintero, Ayudante Albañil, Oficial Fierrero, Vigilante, …). Se guarda el texto de la
-- especialidad, como en Transacciones, así que la columna se amplía a 50 y deja de tener lista fija en la base (la
-- lista vive en personal.service.ts). Las categorías antiguas ('operario', 'oficial', 'peon') se conservan tal cual:
-- no traen la especialidad, se muestran con su nombre y se corrigen al editar la ficha.
-- Idempotente.

ALTER TABLE public.personal DROP CONSTRAINT IF EXISTS personal_regimen_check;
ALTER TABLE public.personal ADD CONSTRAINT personal_regimen_check
    CHECK (regimen IS NULL OR regimen IN ('construccion_civil', 'contrata', 'subcontrata', 'general'));

ALTER TABLE public.personal DROP CONSTRAINT IF EXISTS personal_categoria_check;
ALTER TABLE public.personal ALTER COLUMN categoria TYPE varchar(50);

NOTIFY pgrst, 'reload schema';
