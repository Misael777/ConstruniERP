-- Columnas de `factura` que la app usa desde el cambio "emision" (2026-09-26) pero que NO existen en Producción:
-- solo se agregaron en el archivo suelto de la raíz factura_migration.sql, que nunca se corrió completo allá.
-- Síntoma: al emitir, "No se pudo crear la factura: Could not find the 'detraccion_codigo_bien' column of
-- 'factura' in the schema cache".
--
-- OJO: NO correr factura_migration.sql de la raíz en Producción — además de agregar columnas BORRA otras
-- (DROP COLUMN ... tipo_comprobante, subtotal, etc.). Esta migración toma SOLO lo que falta, sin borrar nada.
-- Idempotente (IF NOT EXISTS).

-- Detracción: tipo de operación SUNAT y código de bien/servicio ('001'...'041').
ALTER TABLE public.factura ADD COLUMN IF NOT EXISTS detraccion_tipo_operacion VARCHAR(4);
ALTER TABLE public.factura ADD COLUMN IF NOT EXISTS detraccion_codigo_bien VARCHAR(3);
-- Algunos nombres del catálogo de medios de pago superan 50 caracteres.
ALTER TABLE public.factura ALTER COLUMN detraccion_medio_pago TYPE TEXT;

-- Notas de Crédito: tipo de nota (catálogo SUNAT 09) y, en "Anulación por error en el RUC", la factura que
-- anula y la nueva factura emitida.
ALTER TABLE public.factura ADD COLUMN IF NOT EXISTS tipo_nota VARCHAR(2);
ALTER TABLE public.factura ADD COLUMN IF NOT EXISTS folio_referencia VARCHAR(20);
ALTER TABLE public.factura ADD COLUMN IF NOT EXISTS folio_nueva_factura VARCHAR(20);

-- Que la API (PostgREST) vea las columnas nuevas de inmediato.
NOTIFY pgrst, 'reload schema';

-- Emisión: una Nota de Crédito que solo REFERENCIA otra factura ("Anulación por error en el RUC" o
-- "Descuento Global", con folio_referencia) no consume transacciones — se emite sin exigirlas. El resto sigue
-- exigiendo transacciones y marcándolas como facturadas (igual que antes). Misma versión que el archivo suelto
-- factura_migration.sql, que en Producción nunca se aplicó.
CREATE OR REPLACE FUNCTION public.fn_emitir_factura(p_id_factura BIGINT, p_imagen_url TEXT, p_usuario TEXT)
RETURNS public.factura AS $$
DECLARE
    v_factura factura;
    v_total INTEGER;
    v_asignadas INTEGER;
BEGIN
    SELECT * INTO v_factura FROM factura WHERE id_factura = p_id_factura FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Factura no encontrada' USING HINT = 'FACTURA_NO_ENCONTRADA';
    END IF;
    IF v_factura.estado = 'emitida' THEN
        RETURN v_factura;
    END IF;
    IF v_factura.estado <> 'borrador' THEN
        RAISE EXCEPTION 'Solo se puede emitir una factura en borrador' USING HINT = 'FACTURA_NO_EMITIBLE';
    END IF;

    IF NOT (v_factura.tipo_comprobante = 'nota_credito' AND v_factura.folio_referencia IS NOT NULL) THEN
        SELECT COUNT(DISTINCT id_transaccion) INTO v_total
        FROM factura_detalle WHERE id_factura = p_id_factura AND id_transaccion IS NOT NULL;
        IF v_total = 0 THEN
            RAISE EXCEPTION 'La factura no tiene transacciones seleccionadas' USING HINT = 'FACTURA_SIN_TRANSACCIONES';
        END IF;

        UPDATE transaccion SET id_factura = p_id_factura
        WHERE id_factura IS NULL
          AND id_transaccion IN (SELECT id_transaccion FROM factura_detalle WHERE id_factura = p_id_factura AND id_transaccion IS NOT NULL);
        GET DIAGNOSTICS v_asignadas = ROW_COUNT;
        IF v_asignadas <> v_total THEN
            RAISE EXCEPTION 'Alguna de las transacciones ya fue facturada' USING HINT = 'TRANSACCION_YA_FACTURADA';
        END IF;
    END IF;

    UPDATE factura
    SET estado = 'emitida', imagen_url = p_imagen_url, autorizado_por = p_usuario,
        fecha_autorizacion = NOW(), updated_at = NOW()
    WHERE id_factura = p_id_factura
    RETURNING * INTO v_factura;
    RETURN v_factura;
END;
$$ LANGUAGE plpgsql;

NOTIFY pgrst, 'reload schema';
