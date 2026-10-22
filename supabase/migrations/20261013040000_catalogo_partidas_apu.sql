-- Proyectos → Catálogo → Partidas (a pedido del usuario, con imagen de referencia): catálogo general de partidas
-- con su APU (análisis de precios unitarios), separado para Obra y Consultoría, organizado en un árbol de
-- especialidades. Tablas NUEVAS a propósito: la tabla `partida` existente la usan Partidas y Plantillas y los
-- presupuestos, y no se toca. Los recursos del APU salen del catálogo de Recursos (recurso_precio).
-- Requiere 20261013021830_catalogo_recursos. Idempotente.

-- 1) Árbol "Estructura de especialidades" (por ámbito). `prefijo` arma el código de la partida (EST-001...).
CREATE TABLE IF NOT EXISTS public.partida_especialidad (
    id_especialidad bigserial PRIMARY KEY,
    ambito          varchar(12) NOT NULL CHECK (ambito IN ('obra', 'consultoria')),
    nombre          varchar(80) NOT NULL,
    id_padre        bigint REFERENCES public.partida_especialidad (id_especialidad) ON DELETE CASCADE,
    prefijo         varchar(6),
    orden           integer NOT NULL DEFAULT 0,
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_partida_especialidad_nombre
    ON public.partida_especialidad (ambito, COALESCE(id_padre, 0), nombre);

-- Semilla (solo si el ámbito todavía no tiene especialidades).
DO $$
DECLARE
    v_raiz BIGINT;
    v_ca BIGINT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.partida_especialidad WHERE ambito = 'obra') THEN
        INSERT INTO public.partida_especialidad (ambito, nombre, orden) VALUES ('obra', 'Edificaciones', 1) RETURNING id_especialidad INTO v_raiz;
        INSERT INTO public.partida_especialidad (ambito, nombre, id_padre, prefijo, orden) VALUES
            ('obra', 'Trabajos preliminares', v_raiz, 'PRE', 1),
            ('obra', 'Movimiento de tierras', v_raiz, 'MOV', 2),
            ('obra', 'Concreto simple', v_raiz, 'CS', 3);
        INSERT INTO public.partida_especialidad (ambito, nombre, id_padre, prefijo, orden) VALUES ('obra', 'Concreto armado', v_raiz, 'EST', 4) RETURNING id_especialidad INTO v_ca;
        INSERT INTO public.partida_especialidad (ambito, nombre, id_padre, orden) VALUES
            ('obra', 'Zapatas', v_ca, 1), ('obra', 'Columnas', v_ca, 2), ('obra', 'Vigas', v_ca, 3), ('obra', 'Losas', v_ca, 4);
        INSERT INTO public.partida_especialidad (ambito, nombre, id_padre, prefijo, orden) VALUES
            ('obra', 'Arquitectura', v_raiz, 'ARQ', 5),
            ('obra', 'Instalaciones sanitarias', v_raiz, 'IS', 6),
            ('obra', 'Instalaciones eléctricas', v_raiz, 'IE', 7);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.partida_especialidad WHERE ambito = 'consultoria') THEN
        INSERT INTO public.partida_especialidad (ambito, nombre, orden) VALUES ('consultoria', 'Servicios de consultoría', 1) RETURNING id_especialidad INTO v_raiz;
        INSERT INTO public.partida_especialidad (ambito, nombre, id_padre, prefijo, orden) VALUES
            ('consultoria', 'Estudios', v_raiz, 'ETU', 1),
            ('consultoria', 'Diseño y expedientes', v_raiz, 'EXP', 2),
            ('consultoria', 'Trámites y licencias', v_raiz, 'TRA', 3),
            ('consultoria', 'Supervisión', v_raiz, 'SUP', 4);
    END IF;
END $$;

-- Unidad para las líneas que se calculan como porcentaje de la mano de obra (ej. herramientas manuales 3% MO).
INSERT INTO public.unidad_medida (codigo, descripcion) VALUES ('%mo', 'Porcentaje de mano de obra') ON CONFLICT (codigo) DO NOTHING;

-- 2) Partidas del catálogo.
CREATE TABLE IF NOT EXISTS public.partida_catalogo (
    id_partida_catalogo bigserial PRIMARY KEY,
    ambito              varchar(12) NOT NULL CHECK (ambito IN ('obra', 'consultoria')),
    codigo              varchar(20) NOT NULL UNIQUE,
    nombre              varchar(250) NOT NULL,
    unidad              varchar(10),
    rendimiento         numeric(12,4) NOT NULL DEFAULT 1 CHECK (rendimiento > 0),
    jornada             numeric(6,2) NOT NULL DEFAULT 8 CHECK (jornada > 0),
    id_especialidad     bigint REFERENCES public.partida_especialidad (id_especialidad) ON DELETE SET NULL,
    precio_referencia   numeric(14,2) NOT NULL DEFAULT 0,
    activo              boolean NOT NULL DEFAULT true,
    usuario_registro    varchar(100),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- 3) Líneas del APU: un recurso del catálogo con su cuadrilla (mano de obra / equipos) y su cantidad.
CREATE TABLE IF NOT EXISTS public.partida_catalogo_apu (
    id_apu              bigserial PRIMARY KEY,
    id_partida_catalogo bigint NOT NULL REFERENCES public.partida_catalogo (id_partida_catalogo) ON DELETE CASCADE,
    id_recurso          bigint NOT NULL REFERENCES public.recurso_precio (id_recurso) ON DELETE RESTRICT,
    cuadrilla           numeric(10,4),
    cantidad            numeric(14,6) NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
    incluido            boolean NOT NULL DEFAULT true,
    orden               integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_partida_catalogo_apu_partida ON public.partida_catalogo_apu (id_partida_catalogo);

-- "Actualizado" se mantiene solo (misma función genérica que recurso_precio).
DROP TRIGGER IF EXISTS trg_partida_catalogo_updated_at ON public.partida_catalogo;
CREATE TRIGGER trg_partida_catalogo_updated_at BEFORE UPDATE ON public.partida_catalogo
    FOR EACH ROW EXECUTE FUNCTION public.fn_recurso_precio_updated_at();

GRANT ALL ON TABLE public.partida_especialidad, public.partida_catalogo, public.partida_catalogo_apu TO anon, authenticated, service_role;
GRANT ALL ON SEQUENCE public.partida_especialidad_id_especialidad_seq, public.partida_catalogo_id_partida_catalogo_seq, public.partida_catalogo_apu_id_apu_seq TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
