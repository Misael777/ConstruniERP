-- Ticket #45: mismo pedido que el ticket #39 (ya resuelto para cuentas_cobrar) pero para cuentas_pagar —
-- poder ordenar las cuentas por pagar por Prioridad. Ordenar por el texto de `prioridad` da un orden
-- alfabético incorrecto (alto, bajo, media), así que se agrega una columna calculada con el orden lógico:
-- alto = 1, media = 2, bajo = 3, sin prioridad = 4 (al final al ordenar de mayor a menor prioridad).
-- OJO: a diferencia de cuentas_cobrar (que usa 'medio'), cuentas_pagar usa 'media' — ver cuentaPagar.config.ts.
-- Columna GENERATED: se mantiene sola, no requiere tocar el código que escribe `prioridad`. Idempotente y no
-- modifica filas.

ALTER TABLE cuentas_pagar
    ADD COLUMN IF NOT EXISTS prioridad_orden SMALLINT GENERATED ALWAYS AS (
        CASE prioridad WHEN 'alto' THEN 1 WHEN 'media' THEN 2 WHEN 'bajo' THEN 3 ELSE 4 END
    ) STORED;

NOTIFY pgrst, 'reload schema';
