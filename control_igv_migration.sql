-- ============================================================
-- MIGRACIÓN: Control de IGV — nueva pestaña de Control Financiero
-- ============================================================
-- Guarda el único parámetro que esta pestaña necesita persistir: el "Objetivo
-- mensual (IGV máximo a pagar)" que el usuario define desde "Configurar objetivo".
-- Todo lo demás (ventas/compras/IGV del mes, evolución histórica, simuladores) se
-- calcula en vivo a partir de `factura` (ventas) y `transaccion` (compras) — ver
-- igv.service.ts — sin tablas nuevas para eso, mismo criterio que el resto de
-- Control Financiero (solo LEE esos datos, no los toca).
--
-- Un solo registro (id fijo = 1, "singleton") en vez de una fila por mes: el
-- objetivo es un techo de control interno que se redefine ocasionalmente, no un
-- valor que deba llevar historial — mismo espíritu simple que apertura_financiera
-- pero sin necesitar múltiples filas.
-- Idempotente: se puede correr más de una vez sin duplicar la fila semilla.
-- ============================================================

CREATE TABLE IF NOT EXISTS igv_objetivo (
	id                  SMALLINT PRIMARY KEY DEFAULT 1,
	objetivo_mensual    NUMERIC(14,2) NOT NULL DEFAULT 5000,
	usuario_registro    VARCHAR(200),
	updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	CONSTRAINT igv_objetivo_singleton CHECK (id = 1)
);

INSERT INTO igv_objetivo (id, objetivo_mensual)
VALUES (1, 5000)
ON CONFLICT (id) DO NOTHING;

-- Fuerza a PostgREST a recargar el schema cache de inmediato.
NOTIFY pgrst, 'reload schema';
