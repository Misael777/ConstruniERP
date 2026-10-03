-- Restaura los centros de costo de proyectos de OBRA y de clientes que se borraron de la base (alrededor
-- del 23/09/2026, fuera de la app: no hay registro de quién) mientras sus transacciones de adelanto
-- seguían apuntando a ellos. Síntoma: "Centro de Costos > Proyectos de Obra" vacío aunque Ventas lista
-- 7 ventas de obra cerradas, y los adelantos de esas ventas sin centro de costo de origen/destino.
--
-- Se recrean con el MISMO id_centro_costo para que las transacciones existentes vuelvan a quedar
-- enlazadas sin tocarlas. Mismo formato que getOrCrearCentroCostoParaEntidad (centroCostos.service.ts):
-- codigo PROY-<id>/CLI-<id>, nombre = id de la entidad, monto_actual 0 (los saldos se derivan de las
-- transacciones). Idempotente: no inserta si el id ya existe o si la entidad ya tiene otro centro.

INSERT INTO public.centro_costo (id_centro_costo, codigo, nombre, tipo, id_proyecto, id_cliente, monto_actual, estado)
SELECT v.id_centro_costo, v.codigo, v.nombre, v.tipo, v.id_proyecto, v.id_cliente, 0, 'activo'
FROM (VALUES
    -- Proyectos de obra (destino del adelanto)
    (213::bigint, 'PROY-109', '109', 'proyecto', 109::bigint, NULL::bigint),
    (220, 'PROY-111', '111', 'proyecto', 111, NULL),
    (235, 'PROY-115', '115', 'proyecto', 115, NULL),
    (238, 'PROY-116', '116', 'proyecto', 116, NULL),
    (240, 'PROY-118', '118', 'proyecto', 118, NULL),
    (241, 'PROY-121', '121', 'proyecto', 121, NULL),
    -- Clientes (origen del adelanto)
    (207, 'CLI-33', '33', 'cliente', NULL, 33),
    (214, 'CLI-39', '39', 'cliente', NULL, 39),
    (216, 'CLI-40', '40', 'cliente', NULL, 40),
    (217, 'CLI-41', '41', 'cliente', NULL, 41),
    (236, 'CLI-43', '43', 'cliente', NULL, 43),
    (237, 'CLI-44', '44', 'cliente', NULL, 44),
    (246, 'CLI-46', '46', 'cliente', NULL, 46),
    (254, 'CLI-50', '50', 'cliente', NULL, 50),
    (256, 'CLI-51', '51', 'cliente', NULL, 51),
    (263, 'CLI-54', '54', 'cliente', NULL, 54),
    (265, 'CLI-55', '55', 'cliente', NULL, 55)
) AS v(id_centro_costo, codigo, nombre, tipo, id_proyecto, id_cliente)
WHERE NOT EXISTS (SELECT 1 FROM public.centro_costo c WHERE c.id_centro_costo = v.id_centro_costo)
  AND NOT EXISTS (SELECT 1 FROM public.centro_costo c WHERE v.id_proyecto IS NOT NULL AND c.id_proyecto = v.id_proyecto)
  AND NOT EXISTS (SELECT 1 FROM public.centro_costo c WHERE v.id_cliente IS NOT NULL AND c.id_cliente = v.id_cliente);

-- Venta de obra cerrada #114 (OBRA_LAC_Cercado_de_Lima2_0424_ANA_ASTUDILLO): no tiene transacciones que
-- apunten a un centro viejo, así que se le crea uno nuevo (id automático), como hace el cierre de venta.
INSERT INTO public.centro_costo (codigo, nombre, tipo, id_proyecto, monto_actual, estado)
SELECT 'PROY-114', '114', 'proyecto', 114, 0, 'activo'
WHERE EXISTS (SELECT 1 FROM public.proyecto p WHERE p.id_proyecto = 114)
  AND NOT EXISTS (SELECT 1 FROM public.centro_costo c WHERE c.id_proyecto = 114);
