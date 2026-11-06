-- Comprobante de Venta en Gestión de Comprobantes (Emisión de comprobantes → "Tipo de documento" → Emitir
-- Comprobante de Venta). Es el tipo_documento '12' de las transacciones (ticket #101). Documento interno, como los
-- demás del módulo, con su propia serie: CV01-00000001, CV01-00000002…
-- Idempotente.

ALTER TABLE public.factura DROP CONSTRAINT IF EXISTS factura_tipo_comprobante_check;
ALTER TABLE public.factura ADD CONSTRAINT factura_tipo_comprobante_check
    CHECK (tipo_comprobante IN ('factura', 'boleta', 'nota_credito', 'nota_debito', 'comprobante_venta'));

CREATE SEQUENCE IF NOT EXISTS public.comprobante_venta_folio_seq;
GRANT USAGE, SELECT ON SEQUENCE public.comprobante_venta_folio_seq TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_asignar_folio_factura() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.folio IS NULL OR NEW.folio = '' THEN
        NEW.folio := CASE NEW.tipo_comprobante
            WHEN 'boleta' THEN 'B001-' || LPAD(nextval('boleta_folio_seq')::text, 8, '0')
            WHEN 'nota_credito' THEN 'NC01-' || LPAD(nextval('nota_credito_folio_seq')::text, 8, '0')
            WHEN 'nota_debito' THEN 'ND01-' || LPAD(nextval('nota_debito_folio_seq')::text, 8, '0')
            WHEN 'comprobante_venta' THEN 'CV01-' || LPAD(nextval('comprobante_venta_folio_seq')::text, 8, '0')
            ELSE 'E001-' || LPAD(nextval('factura_folio_seq')::text, 8, '0')
        END;
    END IF;
    RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
