-- Nombres de clientes siempre en MAYÚSCULAS (a pedido del usuario).
-- El frontend ya guarda los nombres nuevos en mayúsculas (ClienteModal / NuevaVentaModal);
-- esto normaliza los ya existentes.
UPDATE public.cliente
SET nombre = upper(nombre)
WHERE nombre IS NOT NULL AND nombre <> upper(nombre);
