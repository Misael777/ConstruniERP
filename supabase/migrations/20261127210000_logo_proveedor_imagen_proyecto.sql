-- 27/11/2026 (pedido de Romina): imagen para identificar rápido cada cuenta en Cuentas por Pagar y por Cobrar.
-- Logo del proveedor y foto/imagen del proyecto (enlace de Drive, igual que personal.foto_url). Columnas nuevas,
-- nulas: sin imagen se muestra el ícono por tipo. No modifica datos existentes. Idempotente.

ALTER TABLE public.proveedor ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE public.proyecto ADD COLUMN IF NOT EXISTS imagen_url text;

NOTIFY pgrst, 'reload schema';
