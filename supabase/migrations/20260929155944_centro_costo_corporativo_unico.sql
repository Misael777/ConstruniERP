-- ============================================================
-- Centro de costo Corporativo ÚNICO (tipo 'bolsa general', etiqueta "Corporativo")
-- ============================================================
-- A pedido del usuario: el Corporativo es un solo centro de costo del sistema, que se genera solo y ya
-- no se crea desde "Nuevo Centro de Costo" (ahí solo quedan Otro y Préstamo). La app lo asegura con
-- getOrCrearCentroCostoCorporativo (centroCostos.service.ts); esta migración lo garantiza en la BD:
--   1. Si no hay ningún Corporativo activo, crea uno ("BG-00N", "CORPORATIVO", monto 0).
--   2. Índice único parcial: nunca puede haber dos Corporativos ACTIVOS a la vez (uno dado de baja no
--      cuenta). Si ya hubiera duplicados activos, no se crea el índice y se avisa (no se borra nada).
-- Estado al escribirla (2026-09-29): Producción tiene exactamente uno, BG-001 "CORPORATIVO" (id 139).
-- Idempotente: se puede correr más de una vez.
-- ============================================================

DO $$
DECLARE
    v_activos INTEGER;
    v_total   INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_activos FROM centro_costo WHERE tipo = 'bolsa general' AND estado = 'activo';

    IF v_activos = 0 THEN
        SELECT COUNT(*) INTO v_total FROM centro_costo WHERE tipo = 'bolsa general';
        INSERT INTO centro_costo (codigo, nombre, tipo, monto_actual, estado)
        VALUES ('BG-' || lpad((v_total + 1)::text, 3, '0'), 'CORPORATIVO', 'bolsa general', 0, 'activo');
        RAISE NOTICE 'Se creó el centro de costo Corporativo.';
    ELSIF v_activos > 1 THEN
        RAISE WARNING 'Hay % centros de costo Corporativos activos: no se crea uq_centro_costo_corporativo_activo. Da de baja los sobrantes y vuelve a correr esta migración.', v_activos;
        RETURN;
    END IF;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_centro_costo_corporativo_activo
        ON centro_costo (tipo)
        WHERE tipo = 'bolsa general' AND estado = 'activo';
END $$;

NOTIFY pgrst, 'reload schema';
