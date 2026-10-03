-- "Emisión de Comprobante" en modo "PDF de SUNAT" (FacturaModal.svelte): además de la imagen (png) y el PDF
-- que genera el ERP, se guarda el archivo ORIGINAL emitido por SUNAT (PDF, foto o XML) del que se leyeron los
-- datos — ver adjuntarComprobanteSunat en facturacion.service.ts. Amplía el CHECK de factura_archivo.tipo.
-- Idempotente.
ALTER TABLE public.factura_archivo DROP CONSTRAINT IF EXISTS factura_archivo_tipo_check;
ALTER TABLE public.factura_archivo
    ADD CONSTRAINT factura_archivo_tipo_check CHECK (tipo IN ('png', 'pdf', 'sunat'));
