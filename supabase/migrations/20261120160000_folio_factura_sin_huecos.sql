-- Numeración de comprobantes sin "números quemados" (pedido de la clienta, 20/11/2026): eliminar en forma PERMANENTE
-- un comprobante debe liberar su número. Antes el folio salía de una secuencia (nextval), que nunca retrocede: tras
-- borrar 4 intentos, el primer comprobante real salió como CV01-00000005.
--
-- Ahora el folio es el mayor número existente de la serie + 1. Así, si se elimina permanentemente el último (p. ej. el
-- N.° 4), el siguiente vuelve a ser el N.° 4. Los dados de baja / anulados siguen existiendo en la tabla, así que su
-- número NO se reutiliza (solo la eliminación permanente lo libera).
-- Concurrencia: un candado por serie (pg_advisory_xact_lock) evita que dos emisiones simultáneas tomen el mismo número;
-- además factura.folio es UNIQUE.
-- Las secuencias *_folio_seq quedan sin uso (no se borran). Idempotente.

CREATE OR REPLACE FUNCTION public.fn_asignar_folio_factura() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_serie text;
    v_ultimo integer;
BEGIN
    IF NEW.folio IS NULL OR NEW.folio = '' THEN
        v_serie := CASE NEW.tipo_comprobante
            WHEN 'boleta' THEN 'B001'
            WHEN 'nota_credito' THEN 'NC01'
            WHEN 'nota_debito' THEN 'ND01'
            WHEN 'comprobante_venta' THEN 'CV01'
            ELSE 'E001'
        END;
        PERFORM pg_advisory_xact_lock(hashtext('factura_folio:' || v_serie));
        SELECT COALESCE(MAX(substring(folio FROM length(v_serie) + 2)::integer), 0)
          INTO v_ultimo
          FROM public.factura
         WHERE folio ~ ('^' || v_serie || '-[0-9]{1,9}$');
        NEW.folio := v_serie || '-' || LPAD((v_ultimo + 1)::text, 8, '0');
    END IF;
    RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
