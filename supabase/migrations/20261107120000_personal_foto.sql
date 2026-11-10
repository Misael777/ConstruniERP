-- Foto del trabajador en su ficha de Personal (a pedido del usuario, 06/11/2026).
-- Se guarda solo el enlace: la imagen (JPEG reducido a 600 px en el propio dispositivo) se sube a Google Drive,
-- igual que las imágenes de Anuncios y los comprobantes. Funciona igual en navegador, Windows y Android.
-- Idempotente.

ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS foto_url text;
COMMENT ON COLUMN public.personal.foto_url IS 'Foto del trabajador (enlace de Google Drive). NULL = sin foto.';

NOTIFY pgrst, 'reload schema';
