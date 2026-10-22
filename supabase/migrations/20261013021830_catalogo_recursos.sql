-- Proyectos → Catálogo (a pedido del usuario, con imagen de referencia): catálogo general de recursos
-- reutilizables en los APU, organizado por Tipo (Materiales, Mano de obra, Equipos, Subcontratos) y Familia,
-- más el catálogo de Unidades. Se construye sobre `recurso_precio` (existía, vacía y sin uso en la app) en vez
-- de crear otra tabla de recursos. Patrón dar-de-baja: columna `activo` (no se borra al dar de baja).
-- Idempotente.

-- 1) Familias de recursos (árbol "Tipos y familias").
CREATE TABLE IF NOT EXISTS public.recurso_familia (
    id_familia  bigserial PRIMARY KEY,
    tipo        varchar(20) NOT NULL CHECK (tipo IN ('material', 'mano_obra', 'equipo', 'subcontrato')),
    nombre      varchar(80) NOT NULL,
    orden       integer NOT NULL DEFAULT 0,
    activo      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tipo, nombre)
);
INSERT INTO public.recurso_familia (tipo, nombre, orden) VALUES
    ('material', 'Cementos', 1), ('material', 'Agregados', 2), ('material', 'Acero', 3),
    ('material', 'Albañilería', 4), ('material', 'Instalaciones', 5),
    ('mano_obra', 'Operarios', 1), ('mano_obra', 'Oficiales', 2), ('mano_obra', 'Peones', 3),
    ('equipo', 'Maquinaria', 1), ('equipo', 'Herramientas', 2),
    ('subcontrato', 'Especialidades', 1)
ON CONFLICT (tipo, nombre) DO NOTHING;

-- 2) Unidades de medida.
CREATE TABLE IF NOT EXISTS public.unidad_medida (
    codigo      varchar(10) PRIMARY KEY,
    descripcion varchar(60) NOT NULL,
    activo      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.unidad_medida (codigo, descripcion) VALUES
    ('und', 'Unidad'), ('bol', 'Bolsa'), ('kg', 'Kilogramo'), ('m', 'Metro'), ('m2', 'Metro cuadrado'),
    ('m3', 'Metro cúbico'), ('gln', 'Galón'), ('l', 'Litro'), ('pza', 'Pieza'), ('rll', 'Rollo'),
    ('var', 'Varilla'), ('pln', 'Plancha'), ('mll', 'Millar'), ('glb', 'Global'), ('hh', 'Hora hombre'),
    ('hm', 'Hora máquina'), ('día', 'Día'), ('mes', 'Mes')
ON CONFLICT (codigo) DO NOTHING;

-- 3) Recursos: columnas del catálogo sobre recurso_precio.
ALTER TABLE public.recurso_precio DROP CONSTRAINT IF EXISTS recurso_precio_tipo_check;
ALTER TABLE public.recurso_precio ADD CONSTRAINT recurso_precio_tipo_check
    CHECK (tipo IN ('material', 'mano_obra', 'equipo', 'subcontrato'));
ALTER TABLE public.recurso_precio ALTER COLUMN nombre TYPE varchar(200);
ALTER TABLE public.recurso_precio ADD COLUMN IF NOT EXISTS codigo varchar(20);
ALTER TABLE public.recurso_precio ADD COLUMN IF NOT EXISTS id_familia bigint REFERENCES public.recurso_familia (id_familia) ON DELETE SET NULL;
ALTER TABLE public.recurso_precio ADD COLUMN IF NOT EXISTS id_proveedor bigint REFERENCES public.proveedor (id_proveedor) ON DELETE SET NULL;
ALTER TABLE public.recurso_precio ADD COLUMN IF NOT EXISTS observaciones text;
ALTER TABLE public.recurso_precio ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
ALTER TABLE public.recurso_precio ADD COLUMN IF NOT EXISTS usuario_registro varchar(100);
ALTER TABLE public.recurso_precio ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS uq_recurso_precio_codigo ON public.recurso_precio (codigo) WHERE codigo IS NOT NULL;

-- "Actualizado" se mantiene solo.
CREATE OR REPLACE FUNCTION public.fn_recurso_precio_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_recurso_precio_updated_at ON public.recurso_precio;
CREATE TRIGGER trg_recurso_precio_updated_at BEFORE UPDATE ON public.recurso_precio
    FOR EACH ROW EXECUTE FUNCTION public.fn_recurso_precio_updated_at();

-- Mismos permisos de API que el resto de tablas del ERP (ver baseline).
GRANT ALL ON TABLE public.recurso_familia, public.unidad_medida TO anon, authenticated, service_role;
GRANT ALL ON SEQUENCE public.recurso_familia_id_familia_seq TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
