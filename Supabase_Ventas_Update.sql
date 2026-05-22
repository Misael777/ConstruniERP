-- Agregando campos faltantes a la tabla ventas según diseño UI
ALTER TABLE ventas
ADD COLUMN IF NOT EXISTS comision_porcentaje NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS comision_monto NUMERIC(10,2),
ADD COLUMN IF NOT EXISTS url_proforma TEXT,
ADD COLUMN IF NOT EXISTS url_contrato TEXT,
ADD COLUMN IF NOT EXISTS tipo_proyecto VARCHAR(50),
ADD COLUMN IF NOT EXISTS codigo_generado VARCHAR(100);
