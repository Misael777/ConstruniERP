-- Ticket #39: poder ordenar las cuentas por cobrar por Prioridad. Ordenar por el texto de `prioridad` da un orden
-- alfabético incorrecto (alto, bajo, medio), así que se agrega una columna calculada con el orden lógico:
-- alto = 1, medio = 2, bajo = 3, sin prioridad = 4 (al final al ordenar de mayor a menor prioridad).
-- Columna GENERATED: se mantiene sola, no requiere tocar el código que escribe `prioridad`. Idempotente y no
-- modifica filas.

ALTER TABLE cuentas_cobrar
    ADD COLUMN IF NOT EXISTS prioridad_orden SMALLINT GENERATED ALWAYS AS (
        CASE prioridad WHEN 'alto' THEN 1 WHEN 'medio' THEN 2 WHEN 'bajo' THEN 3 ELSE 4 END
    ) STORED;

NOTIFY pgrst, 'reload schema';
