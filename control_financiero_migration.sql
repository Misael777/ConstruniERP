-- ============================================================
-- MIGRACIÓN: Control Financiero — capa de supervisión sobre el módulo financiero
-- ============================================================
-- "Dashboard Finanzas" evoluciona a "Control Financiero" (mismo permiso técnico
-- `ver_finanzas_dashboard`, solo cambia la etiqueta — ver modules.ts / roles-permisos
-- +page.svelte, sin migración de permisos): pasa de solo MOSTRAR información a
-- verificar → detectar → conciliar → generar incidencia → resolver → auditar → volver
-- a verificar. Esta migración agrega las 5 tablas nuevas que sostienen ese flujo.
-- Ninguna de estas tablas participa en el cálculo de ningún saldo en vivo del resto
-- del ERP (transaccion/cuenta_banco/centro_costo/cuentas_pagar/cuentas_cobrar no se
-- tocan) — Control Financiero solo LEE esos datos y registra sus propios hallazgos.
-- Idempotente: CREATE TABLE/INDEX IF NOT EXISTS, se puede correr más de una vez.
-- ============================================================

-- ----------------------------------------------------------------------------
-- 1. Apertura Financiera / Saldo Inicial — ancla histórica de auditoría. NUNCA
--    participa en un cálculo de saldo en vivo (esos siguen siendo cuenta_banco.
--    saldo_actual / los recalculos por transaccion, sin cambios). id_cuenta_banco
--    nullable: NULL = apertura de ámbito global (todo el ERP a una fecha de corte),
--    con valor = baseline puntual de una sola cuenta.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS apertura_financiera (
	id_apertura        BIGSERIAL PRIMARY KEY,
	fecha_corte        DATE NOT NULL,
	monto              NUMERIC(14,2) NOT NULL,
	id_cuenta_banco    BIGINT REFERENCES cuenta_banco(id_cuenta_banco),
	fuente             VARCHAR(30) NOT NULL CHECK (fuente IN ('estado_de_cuenta_bancario', 'migracion_inicial', 'auditoria_externa', 'otro')),
	observaciones      TEXT,
	usuario_registro   VARCHAR(200),
	created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_apertura_financiera_fecha ON apertura_financiera(fecha_corte);

-- Agregado tras el primer corte de esta migración: el ámbito de una apertura no era solo "global o
-- una cuenta bancaria puntual" — un centro de costo también necesita su propio saldo inicial de
-- referencia (a pedido explícito del usuario, mismo criterio que ya tiene el lado de cuenta_banco).
-- Como mucho UNO de los dos ámbitos puntuales a la vez (o ninguno = global) — mismo patrón
-- num_nonnulls(...) <= 1 que ya usa chk_centro_costo_una_entidad en centro_costo.
ALTER TABLE apertura_financiera ADD COLUMN IF NOT EXISTS id_centro_costo BIGINT REFERENCES centro_costo(id_centro_costo);
CREATE INDEX IF NOT EXISTS idx_apertura_financiera_centro_costo ON apertura_financiera(id_centro_costo);
DO $$
DECLARE r RECORD;
BEGIN
	FOR r IN
		SELECT conname FROM pg_constraint
		WHERE conrelid = 'apertura_financiera'::regclass AND contype = 'c'
		  AND pg_get_constraintdef(oid) ~ 'num_nonnulls'
	LOOP
		EXECUTE format('ALTER TABLE apertura_financiera DROP CONSTRAINT %I', r.conname);
	END LOOP;
END $$;
ALTER TABLE apertura_financiera
	ADD CONSTRAINT chk_apertura_financiera_un_ambito
	CHECK (num_nonnulls(id_cuenta_banco, id_centro_costo) <= 1);

-- ----------------------------------------------------------------------------
-- 2. Incidencia — el hallazgo formal (de un chequeo de Consistencia o de una
--    Conciliación con diferencia) que hay que investigar y resolver. `id_entidad` es
--    polimórfico (sin FK real) — mismo criterio ya usado en transaccion.
--    id_centro_costo_origen/destino, que tampoco tienen FK real en este esquema.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incidencia (
	id_incidencia       BIGSERIAL PRIMARY KEY,
	severidad           VARCHAR(10) NOT NULL CHECK (severidad IN ('baja', 'media', 'alta', 'critica')),
	estado              VARCHAR(25) NOT NULL DEFAULT 'OPEN'
	                    CHECK (estado IN ('OPEN', 'INVESTIGATING', 'CAUSE_IDENTIFIED', 'ADJUSTMENT_REQUIRED', 'RESOLVED', 'CLOSED')),
	fecha_deteccion     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	tipo_entidad        VARCHAR(30) NOT NULL CHECK (tipo_entidad IN ('conciliacion', 'centro_costo', 'cuenta_banco', 'transaccion', 'revision_financiera', 'otro')),
	id_entidad          BIGINT,
	origen_check        VARCHAR(60),
	causa               TEXT,
	descripcion         TEXT NOT NULL,
	monto_diferencia    NUMERIC(14,2),
	creado_por          VARCHAR(200),
	resuelto_por        VARCHAR(200),
	resuelto_en         TIMESTAMPTZ,
	created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_incidencia_estado ON incidencia(estado);
CREATE INDEX IF NOT EXISTS idx_incidencia_severidad ON incidencia(severidad);

-- ----------------------------------------------------------------------------
-- 3. Incidencia Evento — el propio historial/auditoría de la incidencia. NO se usa
--    instance_audit_log/capture_instance_audit para esto: ese mecanismo exige
--    project_id NOT NULL REFERENCES proyecto y una incidencia financiera no está
--    atada a un proyecto (además, hoy ningún UI del ERP lee instance_audit_log).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incidencia_evento (
	id_evento          BIGSERIAL PRIMARY KEY,
	id_incidencia      BIGINT NOT NULL REFERENCES incidencia(id_incidencia) ON DELETE CASCADE,
	tipo_evento        VARCHAR(30) NOT NULL CHECK (tipo_evento IN ('creacion', 'cambio_estado', 'nota', 'ajuste_registrado')),
	estado_anterior    VARCHAR(25),
	estado_nuevo       VARCHAR(25),
	comentario         TEXT,
	usuario            VARCHAR(200),
	created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_incidencia_evento_incidencia ON incidencia_evento(id_incidencia);

-- ----------------------------------------------------------------------------
-- 4. Conciliación Financiera — cada corrida de una de las dos comparaciones del tab
--    Conciliación ('interna' = Total Centros de Costo vs Total Cuentas Bancarias,
--    'banco_manual' = saldo ERP vs el monto que el usuario ingresa a mano del estado
--    de cuenta real). `diferencia` se persiste (no se recalcula después) para que el
--    historial no cambie si los saldos siguen moviéndose. Enlace a incidencia
--    unidireccional (evita FK circular entre las dos tablas).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conciliacion_financiera (
	id_conciliacion     BIGSERIAL PRIMARY KEY,
	fecha               DATE NOT NULL DEFAULT CURRENT_DATE,
	tipo                VARCHAR(20) NOT NULL CHECK (tipo IN ('interna', 'banco_manual')),
	saldo_a             NUMERIC(14,2) NOT NULL,
	saldo_b             NUMERIC(14,2) NOT NULL,
	diferencia          NUMERIC(14,2) NOT NULL,
	estado              VARCHAR(20) NOT NULL DEFAULT 'cuadrada' CHECK (estado IN ('cuadrada', 'con_diferencia')),
	id_incidencia       BIGINT REFERENCES incidencia(id_incidencia),
	usuario_registro    VARCHAR(200),
	observaciones       TEXT,
	created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conciliacion_fecha ON conciliacion_financiera(fecha);

-- ----------------------------------------------------------------------------
-- 5. Revisión Financiera — resultado persistido de "Ejecutar revisión" (los 6+
--    chequeos de Consistencia). El tab Dashboard lee la última fila en vez de
--    recomputar los chequeos en cada visita; solo el botón "Ejecutar revisión"/
--    "Ejecutar ahora" corre `ejecutarRevision()` y escribe una fila nueva.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revision_financiera (
	id_revision         BIGSERIAL PRIMARY KEY,
	fecha               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	resultado           JSONB NOT NULL,
	controles_ok        SMALLINT NOT NULL DEFAULT 0,
	controles_alerta    SMALLINT NOT NULL DEFAULT 0,
	controles_error     SMALLINT NOT NULL DEFAULT 0,
	usuario_registro    VARCHAR(200),
	created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_revision_financiera_fecha ON revision_financiera(fecha DESC);

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
