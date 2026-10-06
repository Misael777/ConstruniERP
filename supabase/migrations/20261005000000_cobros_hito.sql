-- Ticket #66: en "Forma de cobranza" (Nueva venta) cada cuota tiene ahora un "Hito de cobro" de texto libre
-- (ej. "Aprobación de arquitectura", "Entrega de ingenierías"), que se ve en Cuentas por Cobrar → Resumen de
-- cobro. Columna opcional; no modifica filas existentes. Idempotente.
ALTER TABLE cobros ADD COLUMN IF NOT EXISTS hito VARCHAR(200);

NOTIFY pgrst, 'reload schema';
