-- ============================================================
-- MIGRACIÓN: M4.1 Gantt con Dependencias
-- Amplía cronograma_actividad, crea cronograma_dependencia,
-- cronograma_plan_base y extiende restriccion.
-- Idempotente: usa ALTER TABLE … ADD COLUMN IF NOT EXISTS
-- ============================================================

-- 1. Agregar columnas de fechas reales y plan base a cronograma_actividad
ALTER TABLE cronograma_actividad
    ADD COLUMN IF NOT EXISTS fecha_inicio_plan   DATE,
    ADD COLUMN IF NOT EXISTS fecha_fin_plan      DATE,
    ADD COLUMN IF NOT EXISTS plan_base_inicio    DATE,
    ADD COLUMN IF NOT EXISTS plan_base_fin       DATE,
    ADD COLUMN IF NOT EXISTS id_partida          BIGINT REFERENCES partida(id_partida) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS color               VARCHAR(20);

-- 2. Dependencias entre actividades (FS, SS, FF, SF)
CREATE TABLE IF NOT EXISTS cronograma_dependencia (
    id_dependencia         BIGSERIAL   PRIMARY KEY,
    id_actividad_origen    BIGINT      NOT NULL REFERENCES cronograma_actividad(id_cronograma_actividad) ON DELETE CASCADE,
    id_actividad_destino   BIGINT      NOT NULL REFERENCES cronograma_actividad(id_cronograma_actividad) ON DELETE CASCADE,
    tipo_dependencia       VARCHAR(5)  NOT NULL DEFAULT 'FS'
                               CHECK (tipo_dependencia IN ('FS', 'SS', 'FF', 'SF')),
    lag_dias               INTEGER     NOT NULL DEFAULT 0,
    created_at             TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_dep UNIQUE (id_actividad_origen, id_actividad_destino),
    CONSTRAINT chk_no_self_dep CHECK (id_actividad_origen <> id_actividad_destino)
);

-- 3. Snapshots del Plan Base
CREATE TABLE IF NOT EXISTS cronograma_plan_base (
    id_plan_base       BIGSERIAL   PRIMARY KEY,
    id_proyecto        BIGINT      NOT NULL REFERENCES proyecto(id_proyecto) ON DELETE CASCADE,
    nombre             VARCHAR(100) NOT NULL DEFAULT 'Plan Base',
    fecha_snapshot     DATE        NOT NULL DEFAULT CURRENT_DATE,
    datos_json         JSONB       NOT NULL,
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Extender restriccion con estado, tipo y actividad vinculada
ALTER TABLE restriccion
    ADD COLUMN IF NOT EXISTS estado                  VARCHAR(20) NOT NULL DEFAULT 'abierta'
                                                         CHECK (estado IN ('abierta','en_seguimiento','resuelta')),
    ADD COLUMN IF NOT EXISTS tipo_restriccion        VARCHAR(50),
    ADD COLUMN IF NOT EXISTS descripcion             TEXT,
    ADD COLUMN IF NOT EXISTS id_cronograma_actividad BIGINT
                                                         REFERENCES cronograma_actividad(id_cronograma_actividad) ON DELETE SET NULL;

-- 5. Índices
CREATE INDEX IF NOT EXISTS idx_crono_dep_origen  ON cronograma_dependencia(id_actividad_origen);
CREATE INDEX IF NOT EXISTS idx_crono_dep_destino ON cronograma_dependencia(id_actividad_destino);
CREATE INDEX IF NOT EXISTS idx_crono_pb_proyecto ON cronograma_plan_base(id_proyecto);
CREATE INDEX IF NOT EXISTS idx_crono_act_padre   ON cronograma_actividad(id_actividad_padre);

-- 6. RLS
ALTER TABLE cronograma_dependencia  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cronograma_plan_base    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cronograma_actividad    ENABLE ROW LEVEL SECURITY;
ALTER TABLE restriccion             ENABLE ROW LEVEL SECURITY;

-- 7. Plantillas de cronograma (secuencias predefinidas de partidas para reutilizar)
CREATE TABLE IF NOT EXISTS plantilla_cronograma (
    id_plantilla       BIGSERIAL    PRIMARY KEY,
    nombre             VARCHAR(100) NOT NULL,
    descripcion        TEXT,
    categoria          VARCHAR(50),
    usuario_registro   VARCHAR(100),
    created_at         TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plantilla_actividad (
    id_plantilla_actividad       BIGSERIAL PRIMARY KEY,
    id_plantilla                 BIGINT    NOT NULL REFERENCES plantilla_cronograma(id_plantilla) ON DELETE CASCADE,
    id_partida                   BIGINT    REFERENCES partida(id_partida) ON DELETE SET NULL,
    nombre_actividad             VARCHAR(200) NOT NULL,
    nivel                        INTEGER   NOT NULL DEFAULT 1,
    id_actividad_padre_template  BIGINT    REFERENCES plantilla_actividad(id_plantilla_actividad) ON DELETE CASCADE,
    duracion_dias                INTEGER   NOT NULL DEFAULT 7,
    lag_inicio_dias              INTEGER   NOT NULL DEFAULT 0,
    orden                        INTEGER   NOT NULL DEFAULT 0,
    created_at                   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE plantilla_cronograma ENABLE ROW LEVEL SECURITY;
ALTER TABLE plantilla_actividad  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cronograma_dependencia' AND policyname='auth_full_crono_dep') THEN
    CREATE POLICY "auth_full_crono_dep" ON cronograma_dependencia FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cronograma_plan_base' AND policyname='auth_full_crono_pb') THEN
    CREATE POLICY "auth_full_crono_pb" ON cronograma_plan_base FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cronograma_actividad' AND policyname='auth_full_crono_act') THEN
    CREATE POLICY "auth_full_crono_act" ON cronograma_actividad FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='restriccion' AND policyname='auth_full_restriccion') THEN
    CREATE POLICY "auth_full_restriccion" ON restriccion FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='plantilla_cronograma' AND policyname='auth_full_plantilla') THEN
    CREATE POLICY "auth_full_plantilla" ON plantilla_cronograma FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='plantilla_actividad' AND policyname='auth_full_plantilla_act') THEN
    CREATE POLICY "auth_full_plantilla_act" ON plantilla_actividad FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
