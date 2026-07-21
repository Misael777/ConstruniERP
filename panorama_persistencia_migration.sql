-- ============================================================
-- MIGRACIÓN: Persistencia de Panoramas de Cobro + arrastre de fraccionamientos individuales
-- ============================================================
-- 1) Iguala cuentas_cobrar con cuentas_pagar: hoy Panoramas de Cobro es 100% de sesión (se pierde
--    al recargar) porque nunca se agregaron estas columnas. Mismo patrón que ya tiene cuentas_pagar.
-- 2) Agrega panorama_id/panorama_orden a "pagos" y "cobros" (las cuotas/fraccionamientos
--    individuales de cada cuenta) — permite arrastrar UNA cuota suelta a un panorama, independiente
--    de sus cuotas hermanas y de la cuenta completa. Una cuenta con 2+ cuotas 'programado' se
--    considera "fraccionada" y se muestra como un cluster de tarjetas arrastrables por separado en
--    la bandeja/panoramas (ver panoramas.service.ts); con 0-1 cuota sigue siendo una tarjeta simple,
--    tal como ya funcionaba, sin cambios.
-- Idempotente: se puede correr más de una vez sin error.
-- ============================================================

ALTER TABLE cuentas_cobrar
    ADD COLUMN IF NOT EXISTS panorama_id SMALLINT NULL,
    ADD COLUMN IF NOT EXISTS panorama_orden INTEGER NULL;

ALTER TABLE pagos
    ADD COLUMN IF NOT EXISTS panorama_id SMALLINT NULL,
    ADD COLUMN IF NOT EXISTS panorama_orden INTEGER NULL;

ALTER TABLE cobros
    ADD COLUMN IF NOT EXISTS panorama_id SMALLINT NULL,
    ADD COLUMN IF NOT EXISTS panorama_orden INTEGER NULL;

CREATE INDEX IF NOT EXISTS idx_cuentas_cobrar_panorama ON cuentas_cobrar(panorama_id);
CREATE INDEX IF NOT EXISTS idx_pagos_panorama ON pagos(panorama_id);
CREATE INDEX IF NOT EXISTS idx_cobros_panorama ON cobros(panorama_id);

NOTIFY pgrst, 'reload schema';
