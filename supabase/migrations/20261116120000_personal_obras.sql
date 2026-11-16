-- Varias obras o áreas por trabajador (a pedido del usuario, 16/11/2026), con historial.
--   personal_obra: TODAS las obras o áreas asignadas al trabajador (varias a la vez).
--   personal.id_centro_costo sigue siendo la obra PRINCIPAL (a la que se carga su costo en la planilla y por la que
--   se agrupa la lista); siempre está también en personal_obra (lo asegura un trigger).
--   Historial: desde ahora el tipo 'obra' de personal_historial_asignacion se registra con cada alta/baja en
--   personal_obra (antes, con el cambio de personal.id_centro_costo). Requiere 20261112120100_personal_historial_asignacion.
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.personal_obra (
    id_personal bigint NOT NULL REFERENCES public.personal (id_personal) ON DELETE CASCADE,
    id_centro_costo bigint NOT NULL REFERENCES public.centro_costo (id_centro_costo) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id_personal, id_centro_costo)
);
COMMENT ON TABLE public.personal_obra IS 'Obras o áreas asignadas a cada trabajador (varias). La principal es personal.id_centro_costo.';
CREATE INDEX IF NOT EXISTS idx_personal_obra_centro ON public.personal_obra (id_centro_costo);

ALTER TABLE public.personal_obra ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS personal_obra_autenticados ON public.personal_obra;
CREATE POLICY personal_obra_autenticados ON public.personal_obra TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, DELETE ON public.personal_obra TO authenticated;

-- Punto de partida (ANTES del trigger de historial, para no duplicar: el historial ya tiene abierta la principal).
INSERT INTO public.personal_obra (id_personal, id_centro_costo)
SELECT id_personal, id_centro_costo FROM public.personal WHERE id_centro_costo IS NOT NULL
ON CONFLICT DO NOTHING;

-- La obra principal siempre está entre sus obras (venga de la ficha, del huellero o de cualquier otro camino).
-- Solo agrega: quitar una obra lo decide la app (al cambiar la principal, la anterior puede seguir asignada).
CREATE OR REPLACE FUNCTION public.fn_personal_obra_principal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.id_centro_costo IS NOT NULL THEN
        INSERT INTO personal_obra (id_personal, id_centro_costo) VALUES (NEW.id_personal, NEW.id_centro_costo)
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_personal_obra_principal ON public.personal;
CREATE TRIGGER trg_personal_obra_principal
    AFTER INSERT OR UPDATE OF id_centro_costo ON public.personal
    FOR EACH ROW EXECUTE FUNCTION public.fn_personal_obra_principal();

-- Historial de obras: alta en personal_obra = asignada; baja = retirada (si la baja viene de borrar la ficha, el
-- historial se borra con ella).
CREATE OR REPLACE FUNCTION public.fn_personal_obra_historial() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO personal_historial_asignacion (id_personal, tipo, id_centro_costo, detalle)
        VALUES (NEW.id_personal, 'obra', NEW.id_centro_costo, fn_historial_detalle_obra(NEW.id_centro_costo));
    ELSIF EXISTS (SELECT 1 FROM personal WHERE id_personal = OLD.id_personal) THEN
        UPDATE personal_historial_asignacion SET fecha_fin = now()
        WHERE id_personal = OLD.id_personal AND tipo = 'obra' AND id_centro_costo = OLD.id_centro_costo AND fecha_fin IS NULL;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_personal_obra_historial ON public.personal_obra;
CREATE TRIGGER trg_personal_obra_historial
    AFTER INSERT OR DELETE ON public.personal_obra
    FOR EACH ROW EXECUTE FUNCTION public.fn_personal_obra_historial();

-- El trigger de personal ya no registra obras (ahora lo hace personal_obra): solo referentes.
CREATE OR REPLACE FUNCTION public.fn_personal_historial_asignacion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF TG_OP = 'INSERT'
       OR NULLIF(btrim(NEW.referente_nombre), '') IS DISTINCT FROM NULLIF(btrim(OLD.referente_nombre), '')
       OR NEW.referente_cargo IS DISTINCT FROM OLD.referente_cargo THEN
        UPDATE personal_historial_asignacion SET fecha_fin = now()
        WHERE id_personal = NEW.id_personal AND tipo = 'referente' AND fecha_fin IS NULL;
        IF NULLIF(btrim(NEW.referente_nombre), '') IS NOT NULL THEN
            INSERT INTO personal_historial_asignacion (id_personal, tipo, referente_nombre, referente_cargo)
            VALUES (NEW.id_personal, 'referente', btrim(NEW.referente_nombre), NEW.referente_cargo);
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_personal_historial_asignacion ON public.personal;
CREATE TRIGGER trg_personal_historial_asignacion
    AFTER INSERT OR UPDATE OF referente_nombre, referente_cargo ON public.personal
    FOR EACH ROW EXECUTE FUNCTION public.fn_personal_historial_asignacion();

-- Tramos de obra abiertos que ya no corresponden a ninguna obra asignada (no debería haber; por las dudas).
UPDATE public.personal_historial_asignacion h SET fecha_fin = now()
WHERE h.tipo = 'obra' AND h.fecha_fin IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.personal_obra po WHERE po.id_personal = h.id_personal AND po.id_centro_costo = h.id_centro_costo);

NOTIFY pgrst, 'reload schema';
