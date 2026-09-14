-- ----------------------------------------------------------------------------
-- Agrega tipo_moneda/tipo_cambio/monto_convertido a `transaccion` — a pedido
-- explícito del usuario, para poder registrar una transacción en Dólares y
-- llevar su equivalente en Soles (mismo criterio ya usado en cuentas_cobrar:
-- moneda/monto_dolares/tipo_cambio, ver cuentaCobrar.config.ts).
--
-- Verificado contra el esquema real (OpenAPI de Supabase, con la service role
-- key): `transaccion` NO tiene ninguna de estas 3 columnas todavía.
--
-- `tipo_moneda` por defecto 'soles' (a pedido explícito del usuario, solo dos
-- opciones acá — sin 'otro', a diferencia de cuenta_banco.tipo_moneda).
-- `tipo_cambio`/`monto_convertido` quedan NULL en transacciones existentes y
-- en cualquiera nueva en Soles (el formulario los oculta y no los pide salvo
-- que Tipo de Moneda sea Dólares, ver TransaccionModal.svelte).
-- ----------------------------------------------------------------------------

-- OJO: monto_convertido se creó acá en NUMERIC(14,2) — luego se amplió a
-- NUMERIC(14,4) vía transaccion_monto_convertido_4decimales_migration.sql
-- (a pedido explícito del usuario, "Monto Convertido" se muestra con 4
-- decimales). Si esta migración corre en una base de datos NUEVA, corre
-- ambos archivos en orden, o cambia directo el (14,2) de abajo por (14,4).
ALTER TABLE transaccion
    ADD COLUMN IF NOT EXISTS tipo_moneda VARCHAR(10) NOT NULL DEFAULT 'soles' CHECK (tipo_moneda IN ('soles', 'dolares')),
    ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS monto_convertido NUMERIC(14,2);
