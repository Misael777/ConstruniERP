-- Finanzas de Obras (Documentacion/PlanFinanzasObras.md, Excel del cliente "ERP - CONFIGURACIÓN DEL MÓDULO DE
-- FINANZAS OBRAS"). Solo ventas de Obra; Consultoría no cambia.
--
-- El dinero sigue donde ya vive: cada armada de un adelanto y cada pago de una valorización es UNA cuota
-- (`cobros`) de la única Cuenta por Cobrar de la venta, y cada cuota cobrada tiene su `transaccion`
-- (fn_confirmar_cobro). Esta migración solo agrega:
--   1) cobro_grupo: agrupa las cuotas en Adelanto 1, 2… / Valorización 1, 2… (cobros.id_grupo).
--   2) cobros.partida: "Partidas ejecutadas" de un pago de valorización.
--   3) documento_proyecto: Contrato y Adenda con historial (vigente = "Actual") y monto; los contratos que eran
--      una URL suelta en proyecto.contrato pasan a filas. Las proformas siguen usando es_proforma_final.
--   4) proyecto_valor_historial + fn_ajustar_valor_venta: cambiar valor de venta/comisión de una venta cerrada de
--      forma atómica, sin tocar cobros ni transacciones ya registrados.
--   5) Permisos: registrar_adelantos_adicionales, gestionar_valorizaciones, ajustar_valor_venta.
--   6) Backfill de las ventas de Obra existentes.
-- Idempotente.

-- 1) Grupos de cobro --------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cobro_grupo (
    id_grupo           bigserial PRIMARY KEY,
    id_cuenta_cobrar   bigint NOT NULL REFERENCES public.cuentas_cobrar (id_cuenta_cobrar) ON DELETE CASCADE,
    tipo               varchar(20) NOT NULL CHECK (tipo IN ('adelanto', 'valorizacion')),
    numero             smallint NOT NULL CHECK (numero > 0),
    -- Valorización: su monto planificado (los pagos se programan dentro). Adelanto: null (= suma de sus armadas).
    monto_planificado  numeric(12,2) CHECK (monto_planificado IS NULL OR monto_planificado >= 0),
    -- Contrato/adenda que origina el grupo (ej. el Adelanto 2 de una adenda). Opcional.
    id_documento       bigint REFERENCES public.documento_proyecto (id_documento) ON DELETE SET NULL,
    observaciones      varchar(200),
    usuario_registro   varchar(100),
    created_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id_cuenta_cobrar, tipo, numero)
);
CREATE INDEX IF NOT EXISTS idx_cobro_grupo_cuenta ON public.cobro_grupo (id_cuenta_cobrar);
ALTER TABLE public.cobro_grupo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cobro_grupo_autenticados ON public.cobro_grupo;
CREATE POLICY cobro_grupo_autenticados ON public.cobro_grupo TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cobro_grupo TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.cobro_grupo_id_grupo_seq TO authenticated;

-- 2) Cuotas: grupo y partida ------------------------------------------------------------------------------
ALTER TABLE public.cobros ADD COLUMN IF NOT EXISTS id_grupo bigint REFERENCES public.cobro_grupo (id_grupo) ON DELETE SET NULL;
ALTER TABLE public.cobros ADD COLUMN IF NOT EXISTS partida varchar(200);
CREATE INDEX IF NOT EXISTS idx_cobros_grupo ON public.cobros (id_grupo) WHERE id_grupo IS NOT NULL;

-- 3) Documentos: contratos y adendas con historial ---------------------------------------------------------
ALTER TABLE public.documento_proyecto ADD COLUMN IF NOT EXISTS vigente boolean NOT NULL DEFAULT false;
ALTER TABLE public.documento_proyecto ADD COLUMN IF NOT EXISTS monto numeric(12,2);
-- Un solo contrato/adenda "Actual" por proyecto (comparten la misma lista, como en la pantalla Editar venta).
CREATE UNIQUE INDEX IF NOT EXISTS uq_documento_proyecto_contrato_vigente
    ON public.documento_proyecto (id_proyecto) WHERE vigente AND tipo_documento IN ('Contrato', 'Adenda');
-- proyecto.contrato (URL suelta) → fila 'Contrato' vigente. La columna se mantiene sincronizada por la app.
INSERT INTO public.documento_proyecto (id_proyecto, nombre, tipo_documento, estado, storage_url, vigente, creado_por, responsable)
SELECT p.id_proyecto, left('Contrato - ' || p.nombre_proyecto, 200), 'Contrato', 'aprobado', p.contrato,
       NOT EXISTS (SELECT 1 FROM public.documento_proyecto d2 WHERE d2.id_proyecto = p.id_proyecto AND d2.vigente AND d2.tipo_documento IN ('Contrato', 'Adenda')),
       p.responsable, p.responsable
FROM public.proyecto p
WHERE p.contrato IS NOT NULL AND p.contrato <> ''
  AND NOT EXISTS (SELECT 1 FROM public.documento_proyecto d WHERE d.id_proyecto = p.id_proyecto AND d.storage_url = p.contrato);

-- 4) Historial del valor de venta ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.proyecto_valor_historial (
    id                     bigserial PRIMARY KEY,
    id_proyecto            bigint NOT NULL REFERENCES public.proyecto (id_proyecto) ON DELETE CASCADE,
    valor_anterior         numeric(12,2) NOT NULL,
    valor_nuevo            numeric(12,2) NOT NULL,
    comision_pct_anterior  numeric,
    comision_pct_nueva     numeric,
    id_documento           bigint REFERENCES public.documento_proyecto (id_documento) ON DELETE SET NULL,
    motivo                 varchar(300),
    usuario                varchar(200),
    created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proyecto_valor_historial_proyecto ON public.proyecto_valor_historial (id_proyecto);
ALTER TABLE public.proyecto_valor_historial ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS proyecto_valor_historial_leer ON public.proyecto_valor_historial;
CREATE POLICY proyecto_valor_historial_leer ON public.proyecto_valor_historial FOR SELECT TO authenticated USING (true);
-- Sin INSERT/UPDATE directo: solo fn_ajustar_valor_venta escribe aquí.
GRANT SELECT ON public.proyecto_valor_historial TO authenticated;

-- Cambia el valor de venta (y la comisión %) de una venta en una sola transacción: proyecto, Cuenta por Cobrar
-- (monto y saldo) e historial. No toca cobros ni transacciones. No deja bajar el valor por debajo de lo cobrado.
CREATE OR REPLACE FUNCTION public.fn_ajustar_valor_venta(
    p_id_proyecto bigint,
    p_valor_nuevo numeric,
    p_comision_pct numeric DEFAULT NULL,
    p_id_documento bigint DEFAULT NULL,
    p_motivo text DEFAULT NULL,
    p_usuario text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_proy proyecto;
    v_cuenta cuentas_cobrar;
    v_cobrado numeric := 0;
BEGIN
    IF NOT tiene_permiso('ajustar_valor_venta') THEN
        RAISE EXCEPTION 'No tienes permiso para cambiar el valor de venta.' USING ERRCODE = '42501';
    END IF;
    IF p_valor_nuevo IS NULL OR p_valor_nuevo <= 0 THEN
        RAISE EXCEPTION 'El valor de venta debe ser mayor a 0.';
    END IF;

    SELECT * INTO v_proy FROM proyecto WHERE id_proyecto = p_id_proyecto FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Venta #% no encontrada.', p_id_proyecto; END IF;

    SELECT * INTO v_cuenta FROM cuentas_cobrar WHERE id_proyecto = p_id_proyecto AND activo ORDER BY id_cuenta_cobrar LIMIT 1 FOR UPDATE;
    IF FOUND THEN
        PERFORM fn_recalcular_cuenta_cobrar(v_cuenta.id_cuenta_cobrar);
        SELECT monto_cobrado INTO v_cobrado FROM cuentas_cobrar WHERE id_cuenta_cobrar = v_cuenta.id_cuenta_cobrar;
        IF p_valor_nuevo < COALESCE(v_cobrado, 0) THEN
            RAISE EXCEPTION 'El nuevo valor (S/ %) es menor a lo ya cobrado (S/ %).', p_valor_nuevo, v_cobrado;
        END IF;
    END IF;

    INSERT INTO proyecto_valor_historial (id_proyecto, valor_anterior, valor_nuevo, comision_pct_anterior, comision_pct_nueva, id_documento, motivo, usuario)
    VALUES (p_id_proyecto, COALESCE(v_proy.precio_venta, 0), p_valor_nuevo, v_proy.comision_asesor,
            COALESCE(p_comision_pct, v_proy.comision_asesor), p_id_documento, left(p_motivo, 300), left(p_usuario, 200));

    UPDATE proyecto
    SET precio_venta = p_valor_nuevo,
        costo_estima = p_valor_nuevo,
        comision_asesor = COALESCE(p_comision_pct, comision_asesor)
    WHERE id_proyecto = p_id_proyecto;

    IF v_cuenta.id_cuenta_cobrar IS NOT NULL THEN
        UPDATE cuentas_cobrar SET monto = p_valor_nuevo WHERE id_cuenta_cobrar = v_cuenta.id_cuenta_cobrar;
        PERFORM fn_recalcular_cuenta_cobrar(v_cuenta.id_cuenta_cobrar);
    END IF;

    RETURN jsonb_build_object('id_proyecto', p_id_proyecto, 'valor_anterior', v_proy.precio_venta, 'valor_nuevo', p_valor_nuevo,
                              'id_cuenta_cobrar', v_cuenta.id_cuenta_cobrar);
END $$;
REVOKE ALL ON FUNCTION public.fn_ajustar_valor_venta(bigint, numeric, numeric, bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ajustar_valor_venta(bigint, numeric, numeric, bigint, text, text) TO authenticated;

-- 5) Permisos -----------------------------------------------------------------------------------------------
INSERT INTO public.permisos (nombre, descripcion)
SELECT v.nombre, v.descripcion
FROM (VALUES
    ('registrar_adelantos_adicionales', 'Obras: registrar el Adelanto 2 en adelante y armadas nuevas en una venta cerrada'),
    ('gestionar_valorizaciones', 'Obras: crear y editar valorizaciones y sus pagos en el Resumen de cobro'),
    ('ajustar_valor_venta', 'Cambiar el valor de venta y la comisión de una venta cerrada (adendas)')
) AS v (nombre, descripcion)
WHERE NOT EXISTS (SELECT 1 FROM public.permisos p WHERE p.nombre = v.nombre);

INSERT INTO public.roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permisos p ON p.nombre IN ('registrar_adelantos_adicionales', 'gestionar_valorizaciones', 'ajustar_valor_venta')
WHERE r.nombre IN ('administrador', 'socio')
  AND NOT EXISTS (SELECT 1 FROM public.roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);

-- 6) Backfill de las ventas de Obra ---------------------------------------------------------------------------
-- Para cada Cuenta por Cobrar activa de una venta de Obra que todavía no tiene grupos: las primeras cuotas (por
-- fecha) que son adelanto —su transacción es categoría 'Adelanto' o su referencia empieza con "Adelanto"— pasan
-- a ser las armadas del Adelanto 1; cada cuota restante pasa a ser una Valorización con un solo pago.
DO $$
DECLARE
    v_cc record;
    v_cuota record;
    v_en_adelanto boolean;
    v_grupo_adelanto bigint;
    v_grupo bigint;
    v_n_val smallint;
BEGIN
    FOR v_cc IN
        SELECT cc.id_cuenta_cobrar
        FROM cuentas_cobrar cc
        JOIN proyecto p ON p.id_proyecto = cc.id_proyecto
        WHERE cc.activo AND p.tipo_venta = 'obra'
          AND NOT EXISTS (SELECT 1 FROM cobro_grupo g WHERE g.id_cuenta_cobrar = cc.id_cuenta_cobrar)
    LOOP
        v_en_adelanto := true;
        v_grupo_adelanto := NULL;
        v_n_val := 0;
        FOR v_cuota IN
            SELECT c.id_cobro, c.monto, c.referencia,
                   (t.categoria = 'Adelanto' OR c.referencia ILIKE 'adelanto%') AS es_adelanto
            FROM cobros c
            LEFT JOIN transaccion t ON t.id_transaccion = c.id_transaccion
            WHERE c.id_cuenta_cobrar = v_cc.id_cuenta_cobrar AND c.estado_cobro <> 'cancelado'
            ORDER BY c.fecha_cobro, c.id_cobro
        LOOP
            IF v_en_adelanto AND v_cuota.es_adelanto THEN
                IF v_grupo_adelanto IS NULL THEN
                    INSERT INTO cobro_grupo (id_cuenta_cobrar, tipo, numero) VALUES (v_cc.id_cuenta_cobrar, 'adelanto', 1)
                    RETURNING id_grupo INTO v_grupo_adelanto;
                END IF;
                -- El texto automático "Adelanto – Nª armada" (ticket #102) ya lo da el grupo: se limpia.
                UPDATE cobros SET id_grupo = v_grupo_adelanto,
                                  referencia = CASE WHEN referencia ~* '^adelanto( – .* armada)?$' THEN NULL ELSE referencia END
                WHERE id_cobro = v_cuota.id_cobro;
            ELSE
                v_en_adelanto := false;
                v_n_val := v_n_val + 1;
                INSERT INTO cobro_grupo (id_cuenta_cobrar, tipo, numero, monto_planificado)
                VALUES (v_cc.id_cuenta_cobrar, 'valorizacion', v_n_val, v_cuota.monto)
                RETURNING id_grupo INTO v_grupo;
                UPDATE cobros SET id_grupo = v_grupo WHERE id_cobro = v_cuota.id_cobro;
            END IF;
        END LOOP;
    END LOOP;
END $$;

-- 7) fn_confirmar_cobro (misma lógica que 20260925000000, H7 + H4): al cobrar una cuota con un monto MENOR, el
-- resto que queda programado conserva su grupo, partida y referencia (antes se perdían). Un cobro nuevo sin
-- cuota previa también puede traer id_grupo/partida en p_cobro_payload.
CREATE OR REPLACE FUNCTION fn_confirmar_cobro(
    p_id_cuenta_cobrar BIGINT, p_transaccion_payload JSONB, p_id_cobro BIGINT DEFAULT NULL,
    p_cobro_payload JSONB DEFAULT NULL, p_idempotency_key UUID DEFAULT NULL
) RETURNS cobros
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
    v_cuenta cuentas_cobrar;
    v_cobro cobros;
    v_cobro_existente cobros;
    v_transaccion transaccion;
    v_t transaccion;
    v_comprometido NUMERIC;
    v_disponible NUMERIC;
    v_soles NUMERIC;
    v_resto NUMERIC;
BEGIN
    SELECT * INTO v_cuenta FROM cuentas_cobrar WHERE id_cuenta_cobrar = p_id_cuenta_cobrar FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cuenta por cobrar % no encontrada', p_id_cuenta_cobrar USING HINT = 'CUENTA_NO_ENCONTRADA';
    END IF;

    v_t := jsonb_populate_record(NULL::transaccion, p_transaccion_payload);
    v_soles := fn_monto_soles_transaccion(v_t);

    IF p_id_cobro IS NOT NULL THEN
        SELECT * INTO v_cobro FROM cobros WHERE id_cobro = p_id_cobro FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Cobro % no encontrado', p_id_cobro USING HINT = 'CUENTA_NO_ENCONTRADA';
        END IF;
        IF v_cobro.estado_cobro = 'cobrado' THEN
            RETURN v_cobro;
        END IF;
        IF v_soles - v_cobro.monto > 0.01 THEN
            RAISE EXCEPTION 'El monto % supera el de la cuota %', v_soles, v_cobro.monto USING HINT = 'MONTO_EXCEDE_CUOTA';
        END IF;
    ELSE
        SELECT COALESCE(SUM(monto), 0) INTO v_comprometido FROM cobros
            WHERE id_cuenta_cobrar = p_id_cuenta_cobrar AND estado_cobro <> 'cancelado';
        v_disponible := v_cuenta.monto - v_comprometido;
        IF v_soles - v_disponible > 0.01 THEN
            RAISE EXCEPTION 'El monto % supera lo disponible % en la cuenta', v_soles, v_disponible
                USING HINT = 'MONTO_EXCEDE_COMPROMETIDO';
        END IF;
    END IF;

    v_transaccion := fn_crear_transaccion(p_transaccion_payload, p_idempotency_key);
    v_soles := fn_monto_soles_transaccion(v_transaccion);

    IF p_id_cobro IS NOT NULL THEN
        v_resto := ROUND(v_cobro.monto - v_soles, 2);
        UPDATE cobros SET estado_cobro = 'cobrado', id_transaccion = v_transaccion.id_transaccion, monto = v_soles
            WHERE id_cobro = p_id_cobro
            RETURNING * INTO v_cobro;
        IF v_resto > 0.01 THEN
            INSERT INTO cobros (id_cuenta_cobrar, monto, fecha_cobro, estado_cobro, id_grupo, partida, referencia)
            VALUES (p_id_cuenta_cobrar, v_resto, v_cobro.fecha_cobro, 'programado', v_cobro.id_grupo, v_cobro.partida, v_cobro.referencia);
        END IF;
    ELSE
        SELECT * INTO v_cobro_existente FROM cobros WHERE id_transaccion = v_transaccion.id_transaccion;
        IF FOUND THEN
            v_cobro := v_cobro_existente;
        ELSE
            INSERT INTO cobros (id_cuenta_cobrar, monto, fecha_cobro, medio_cobro, num_operacion, cuenta_banco, usuario_registro, referencia, estado_cobro, id_transaccion, id_grupo, partida)
            SELECT p_id_cuenta_cobrar, v_soles, r.fecha_cobro, r.medio_cobro, r.num_operacion, r.cuenta_banco, r.usuario_registro, r.referencia, 'cobrado', v_transaccion.id_transaccion, r.id_grupo, r.partida
            FROM jsonb_populate_record(NULL::cobros, p_cobro_payload) r
            RETURNING * INTO v_cobro;
        END IF;
    END IF;

    PERFORM fn_recalcular_cuenta_cobrar(p_id_cuenta_cobrar);

    RETURN v_cobro;
END;
$$;

-- Auditoría (mismo trigger genérico que el resto de tablas de negocio, ver 20261002120000_auditoria.sql).
DO $$
BEGIN
    IF to_regproc('public.auditoria_registrar_cambio') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS auditoria_cambio ON public.cobro_grupo;
        CREATE TRIGGER auditoria_cambio AFTER INSERT OR UPDATE OR DELETE ON public.cobro_grupo
            FOR EACH ROW EXECUTE FUNCTION auditoria_registrar_cambio('id_grupo');
        DROP TRIGGER IF EXISTS auditoria_cambio ON public.proyecto_valor_historial;
        CREATE TRIGGER auditoria_cambio AFTER INSERT OR UPDATE OR DELETE ON public.proyecto_valor_historial
            FOR EACH ROW EXECUTE FUNCTION auditoria_registrar_cambio('id');
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
