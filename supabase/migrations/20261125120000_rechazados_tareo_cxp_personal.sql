-- Tickets rechazados (24/11/2026). Requiere 20261124120000_tareo_aprobacion_jefe_proyeccion.sql.
--
-- #133/#134/#122  CxP de planilla:
--   * Proyección "con todos los números" (decisión del usuario): la cuota "Proyección de planilla" sigue, pero ahora
--     se guarda su DETALLE por trabajador (planilla_proyeccion: estimado por días, saldo de tareo, aprobado, reserva),
--     para que en el Resumen de pago se vea de dónde sale cada sol y cuadre con lo enviado.
--   * Consultoría y Corporativo: una CxP POR TRABAJADOR y periodo (planilla.id_personal). Obra sigue agrupada.
--   * Quien ve Cuentas por Pagar (ver_finanzas_cuentas_pendientes) puede leer planilla y tareo para ver los
--     trabajadores de cada cuota (antes solo con ver_rrhh_asistencia).
-- #117  Horas extra: las registra el jefe inmediato (o un administrador) por día en el tareo (tareo_extra); se pagan
--       por hora sobre su tarifa y se suman al total que se aprueba. La salida marcada tarde no suma horas.
-- #110  Personal: nuevos regímenes y modalidades formativas; contratos con vencimiento (personal_contrato); varias
--       cuentas bancarias (personal_cuenta_bancaria); seguros SCTR salud, SCTR pensión y Vida Ley con aseguradora,
--       archivo e historial (personal_seguro); método de registro "Registro manual" (personal.registro_manual): marca
--       desde el ERP aunque su horario sea fijo.
--
-- No modifica datos existentes (las columnas antiguas de banco y SCTR se siguen leyendo). Idempotente.

-- ═════════════════════════ #110 Personal ═════════════════════════
ALTER TABLE public.personal DROP CONSTRAINT IF EXISTS personal_regimen_check;
ALTER TABLE public.personal ADD CONSTRAINT personal_regimen_check CHECK (regimen IS NULL OR regimen IN (
    'general', 'construccion_civil', 'microempresa', 'pequena_empresa',
    'locacion_servicios', 'practicas_preprofesionales', 'practicas_profesionales',
    'contrata', 'subcontrata'));  -- contrata/subcontrata: valores anteriores, se conservan

ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS registro_manual boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.personal_contrato (
    id_contrato    bigserial PRIMARY KEY,
    id_personal    bigint NOT NULL REFERENCES public.personal(id_personal) ON DELETE CASCADE,
    numero         varchar(60),
    fecha_inicio   date,
    fecha_fin      date,
    archivo_url    text,
    observacion    varchar(200),
    usuario        varchar(200),
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS personal_contrato_personal_idx ON public.personal_contrato (id_personal);

CREATE TABLE IF NOT EXISTS public.personal_cuenta_bancaria (
    id_cuenta      bigserial PRIMARY KEY,
    id_personal    bigint NOT NULL REFERENCES public.personal(id_personal) ON DELETE CASCADE,
    banco          varchar(60) NOT NULL,
    moneda         varchar(3) NOT NULL DEFAULT 'PEN' CHECK (moneda IN ('PEN', 'USD')),
    numero_cuenta  varchar(30),
    cci            varchar(25),
    principal      boolean NOT NULL DEFAULT false,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS personal_cuenta_bancaria_personal_idx ON public.personal_cuenta_bancaria (id_personal);

CREATE TABLE IF NOT EXISTS public.personal_seguro (
    id_seguro      bigserial PRIMARY KEY,
    id_personal    bigint NOT NULL REFERENCES public.personal(id_personal) ON DELETE CASCADE,
    tipo           varchar(15) NOT NULL CHECK (tipo IN ('sctr_salud', 'sctr_pension', 'vida_ley')),
    aseguradora    varchar(100),
    poliza         varchar(40),
    fecha_inicio   date,
    fecha_fin      date,
    archivo_url    text,
    observacion    varchar(200),
    usuario        varchar(200),
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS personal_seguro_personal_idx ON public.personal_seguro (id_personal, tipo, fecha_fin DESC);

-- Mismo acceso que la ficha de Personal (personal_autenticados).
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['personal_contrato', 'personal_cuenta_bancaria', 'personal_seguro'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_autenticados') THEN
            EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t || '_autenticados', t);
        END IF;
        EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE public.personal_contrato_id_contrato_seq, public.personal_cuenta_bancaria_id_cuenta_seq, public.personal_seguro_id_seguro_seq TO authenticated;

-- Registro manual: marca desde el ERP con cualquier horario.
CREATE OR REPLACE FUNCTION public.fn_mi_asistencia_marcar()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_p personal;
    v_ahora timestamptz := now();
BEGIN
    v_p := fn_mi_asistencia_ficha();
    IF v_p.id_personal IS NULL THEN
        RAISE EXCEPTION 'Tu usuario no está vinculado a una ficha de Personal. Pide a un administrador que lo vincule.';
    END IF;
    IF NOT v_p.registro_manual AND NOT EXISTS (SELECT 1 FROM horario h WHERE h.id_horario = v_p.id_horario AND h.tipo IN ('libre', 'mixto')) THEN
        RAISE EXCEPTION 'Tu horario es fijo: registra tu asistencia en el huellero (o pide que activen el registro manual en tu configuración de asistencia).';
    END IF;
    IF EXISTS (SELECT 1 FROM asistencia_marcacion
               WHERE pin = v_p.pin AND marcado_en > v_ahora - interval '2 minutes' AND (evento IS NULL OR evento < 20)) THEN
        RAISE EXCEPTION 'Ya registraste hace un momento. Espera 2 minutos para volver a marcar.';
    END IF;
    INSERT INTO asistencia_marcacion (id_dispositivo, pin, marcado_en, origen, id_centro_costo)
    VALUES (NULL, v_p.pin, v_ahora, 'erp', v_p.id_centro_costo);
    RETURN jsonb_build_object('marcado_en', v_ahora);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_mi_asistencia(p_desde date, p_hasta date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_p personal;
BEGIN
    v_p := fn_mi_asistencia_ficha();
    IF v_p.id_personal IS NULL THEN RETURN NULL; END IF;
    IF p_hasta - p_desde > 62 THEN RAISE EXCEPTION 'El periodo no puede pasar de 62 días.'; END IF;
    RETURN jsonb_build_object(
        'personal', jsonb_build_object(
            'id_personal', v_p.id_personal, 'pin', v_p.pin,
            'nombre', COALESCE(NULLIF(btrim(concat_ws(' ', v_p.nombres, v_p.apellidos)), ''), v_p.nombre),
            'fecha_ingreso', v_p.fecha_ingreso, 'fecha_cese', v_p.fecha_cese,
            'registro_manual', v_p.registro_manual,
            'obra', (SELECT cc.nombre FROM centro_costo cc WHERE cc.id_centro_costo = v_p.id_centro_costo)),
        'horario', (SELECT to_jsonb(h) || jsonb_build_object('horario_dia',
                        COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.dia) FROM horario_dia d WHERE d.id_horario = h.id_horario), '[]'::jsonb))
                    FROM horario h WHERE h.id_horario = v_p.id_horario),
        'marcas', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('marcado_en', m.marcado_en, 'evento', m.evento, 'origen', m.origen,
                                                'huellero', d.nombre) ORDER BY m.marcado_en)
            FROM asistencia_marcacion m LEFT JOIN asistencia_dispositivo d ON d.id_dispositivo = m.id_dispositivo
            WHERE m.pin = v_p.pin
              AND m.marcado_en >= (p_desde::timestamp AT TIME ZONE 'America/Lima')
              AND m.marcado_en < ((p_hasta + 1)::timestamp AT TIME ZONE 'America/Lima')), '[]'::jsonb)
    );
END;
$function$;

-- ═════════════════════════ #117 Horas extra ═════════════════════════
CREATE TABLE IF NOT EXISTS public.tareo_extra (
    id_extra         bigserial PRIMARY KEY,
    id_personal      bigint NOT NULL REFERENCES public.personal(id_personal) ON DELETE CASCADE,
    id_centro_costo  bigint NOT NULL REFERENCES public.centro_costo(id_centro_costo) ON DELETE CASCADE,
    fecha            date NOT NULL,
    minutos          integer NOT NULL CHECK (minutos > 0 AND minutos <= 1440),
    observacion      varchar(200),
    registrado_por   varchar(200),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id_personal, id_centro_costo, fecha)
);
ALTER TABLE public.tareo_extra ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tareo_extra' AND policyname = 'tareo_extra_leer') THEN
        CREATE POLICY tareo_extra_leer ON public.tareo_extra FOR SELECT TO authenticated USING (tiene_permiso('ver_rrhh_asistencia'));
    END IF;
END $$;
REVOKE ALL ON public.tareo_extra FROM anon;
GRANT SELECT ON public.tareo_extra TO authenticated;

-- p_minutos = 0 quita las horas extra del día. Solo el jefe inmediato del trabajador o un administrador.
CREATE OR REPLACE FUNCTION public.fn_tareo_horas_extra(p_id_personal bigint, p_id_centro_costo bigint, p_fecha date, p_minutos integer, p_observacion text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_quien text;
BEGIN
    IF NOT (is_admin() OR fn_tareo_es_jefe(p_id_personal)) THEN
        RAISE EXCEPTION 'Solo el jefe inmediato del trabajador (o un administrador) registra sus horas extra.' USING ERRCODE = '42501', HINT = 'NO_ES_JEFE';
    END IF;
    SELECT nombre INTO v_quien FROM empleados WHERE auth_user_id = auth.uid() LIMIT 1;
    IF COALESCE(p_minutos, 0) <= 0 THEN
        DELETE FROM tareo_extra WHERE id_personal = p_id_personal AND id_centro_costo = p_id_centro_costo AND fecha = p_fecha;
        RETURN;
    END IF;
    INSERT INTO tareo_extra (id_personal, id_centro_costo, fecha, minutos, observacion, registrado_por, updated_at)
    VALUES (p_id_personal, p_id_centro_costo, p_fecha, LEAST(p_minutos, 1440), left(NULLIF(btrim(p_observacion), ''), 200), left(COALESCE(v_quien, 'Administrador'), 200), now())
    ON CONFLICT (id_personal, id_centro_costo, fecha) DO UPDATE
        SET minutos = EXCLUDED.minutos, observacion = EXCLUDED.observacion, registrado_por = EXCLUDED.registrado_por, updated_at = now();
END $$;
REVOKE ALL ON FUNCTION public.fn_tareo_horas_extra(bigint, bigint, date, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tareo_horas_extra(bigint, bigint, date, integer, text) TO authenticated;

-- ═════════════════════════ #133/#134/#122 Planilla ═════════════════════════
-- Lectura para quien ve Cuentas por Pagar (trabajador de cada cuota del Resumen de pago).
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['planilla', 'tareo_envio', 'tareo_trabajador', 'tareo_semana'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_leer_cxp') THEN
            EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tiene_permiso(''ver_finanzas_cuentas_pendientes''))', t || '_leer_cxp', t);
        END IF;
    END LOOP;
END $$;

-- CxP individual (Consultoría y Corporativo): planilla de un solo trabajador.
ALTER TABLE public.planilla ADD COLUMN IF NOT EXISTS id_personal bigint REFERENCES public.personal(id_personal) ON DELETE SET NULL;
ALTER TABLE public.planilla DROP CONSTRAINT IF EXISTS planilla_id_centro_costo_grupo_inicio_key;
CREATE UNIQUE INDEX IF NOT EXISTS planilla_unica ON public.planilla (id_centro_costo, grupo, inicio, (COALESCE(id_personal, 0)));

-- Detalle de la proyección (lo escribe fn_planilla_recalcular; se lee en el Resumen de pago).
CREATE TABLE IF NOT EXISTS public.planilla_proyeccion (
    id_planilla  bigint NOT NULL REFERENCES public.planilla(id_planilla) ON DELETE CASCADE,
    id_personal  bigint NOT NULL REFERENCES public.personal(id_personal) ON DELETE CASCADE,
    concepto     varchar(12) NOT NULL CHECK (concepto IN ('estimado', 'saldo_tareo', 'aprobado', 'reserva')),
    fecha        date NOT NULL,
    dias         numeric(6,1),
    monto        numeric(12,2) NOT NULL,
    PRIMARY KEY (id_planilla, id_personal, concepto, fecha)
);
ALTER TABLE public.planilla_proyeccion ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'planilla_proyeccion' AND policyname = 'planilla_proyeccion_leer') THEN
        CREATE POLICY planilla_proyeccion_leer ON public.planilla_proyeccion FOR SELECT TO authenticated
            USING (tiene_permiso('ver_finanzas_cuentas_pendientes') OR tiene_permiso('ver_rrhh_asistencia'));
    END IF;
END $$;
REVOKE ALL ON public.planilla_proyeccion FROM anon;
GRANT SELECT ON public.planilla_proyeccion TO authenticated;

-- ¿El centro de costo es de OBRA? (proyecto que no es de consultoría). Lo demás va por trabajador.
CREATE OR REPLACE FUNCTION public.fn_centro_es_obra(p_id_centro_costo bigint) RETURNS boolean
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
    SELECT EXISTS (
        SELECT 1 FROM centro_costo cc LEFT JOIN proyecto pr ON pr.id_proyecto = cc.id_proyecto
        WHERE cc.id_centro_costo = p_id_centro_costo AND cc.tipo = 'proyecto' AND COALESCE(pr.tipo_venta, '') <> 'consultoria');
$$;

-- Trabajador dueño de la planilla: NULL en obra (agrupada), el trabajador en Consultoría/Corporativo.
CREATE OR REPLACE FUNCTION public.fn_planilla_dueno(p_id_centro_costo bigint, p_id_personal bigint) RETURNS bigint
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
    SELECT CASE WHEN fn_centro_es_obra(p_id_centro_costo) THEN NULL ELSE p_id_personal END;
$$;

-- Planilla existente (sin crearla) de un centro, grupo, fecha y dueño.
CREATE OR REPLACE FUNCTION public.fn_planilla_buscar(p_id_centro_costo bigint, p_grupo text, p_fecha date, p_id_personal bigint DEFAULT NULL) RETURNS bigint
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
    SELECT id_planilla FROM planilla
    WHERE id_centro_costo = p_id_centro_costo AND grupo = p_grupo AND inicio = (fn_planilla_periodo(p_grupo, p_fecha)).inicio
      AND id_personal IS NOT DISTINCT FROM p_id_personal;
$$;

DROP FUNCTION IF EXISTS public.fn_planilla_asegurar(bigint, text, date, boolean);
CREATE OR REPLACE FUNCTION public.fn_planilla_asegurar(p_id_centro_costo bigint, p_grupo text, p_fecha date, p_recrear_borrada boolean DEFAULT true, p_id_personal bigint DEFAULT NULL)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_per record;
    v_planilla planilla;
    v_cxp bigint;
    v_obra text;
    v_trab text;
BEGIN
    SELECT * INTO v_per FROM fn_planilla_periodo(p_grupo, p_fecha);
    SELECT * INTO v_planilla FROM planilla
    WHERE id_centro_costo = p_id_centro_costo AND grupo = p_grupo AND inicio = v_per.inicio AND id_personal IS NOT DISTINCT FROM p_id_personal;
    IF FOUND AND v_planilla.id_cuenta_pagar IS NOT NULL THEN RETURN v_planilla.id_planilla; END IF;
    -- La planilla existe pero su CxP fue eliminada por el usuario: la proyección automática la respeta.
    IF FOUND AND NOT p_recrear_borrada THEN RETURN NULL; END IF;

    SELECT COALESCE(codigo, nombre, 'Obra') INTO v_obra FROM centro_costo WHERE id_centro_costo = p_id_centro_costo;
    IF p_id_personal IS NOT NULL THEN
        SELECT COALESCE(NULLIF(btrim(concat_ws(', ', apellidos, nombres)), ''), nombre, 'Trabajador') INTO v_trab FROM personal WHERE id_personal = p_id_personal;
    END IF;
    INSERT INTO cuentas_pagar (id_proveedor, id_centro_costo, monto_comprometido, monto_pagado, saldo_pendiente, monto_imponible, monto_igv,
                               fecha_emision, fecha_vencimiento, estado, observacion, frecuencia_pago, usuario_registro, responsable)
    VALUES (fn_planilla_proveedor(), p_id_centro_costo, 0, 0, 0, 0, 0, v_per.inicio, v_per.fin, 'pendiente',
            left(CASE WHEN v_trab IS NULL
                      THEN format('Planilla %s %s %s–%s', p_grupo, v_obra, to_char(v_per.inicio, 'DD/MM'), to_char(v_per.fin, 'DD/MM/YYYY'))
                      ELSE format('Planilla %s %s · %s %s–%s', p_grupo, v_obra, v_trab, to_char(v_per.inicio, 'DD/MM'), to_char(v_per.fin, 'DD/MM/YYYY')) END, 200),
            'sin_periodicidad', 'sistema', 'Planilla de personal')
    RETURNING id_cuenta_pagar INTO v_cxp;

    INSERT INTO planilla (id_centro_costo, grupo, inicio, fin, id_cuenta_pagar, id_personal)
    VALUES (p_id_centro_costo, p_grupo, v_per.inicio, v_per.fin, v_cxp, p_id_personal)
    ON CONFLICT (id_centro_costo, grupo, inicio, (COALESCE(id_personal, 0))) DO UPDATE SET id_cuenta_pagar = EXCLUDED.id_cuenta_pagar
    RETURNING * INTO v_planilla;
    RETURN v_planilla.id_planilla;
END $function$;
REVOKE ALL ON FUNCTION public.fn_planilla_asegurar(bigint, text, date, boolean, bigint) FROM PUBLIC, anon, authenticated;

-- Proyección con detalle por trabajador. Mismas reglas que 20261124120000 (estimación por día de cada trabajador
-- activo, saldo sin enviar de los tareos enviados en parte, y lo aprobado o reservado aún sin enviar), pero cada parte
-- queda en planilla_proyeccion con su trabajador, sus días y su fecha. Las cuotas "Proyección de planilla" son la suma
-- por fecha. Una planilla individual (id_personal) solo proyecta a ese trabajador.
CREATE OR REPLACE FUNCTION public.fn_planilla_recalcular(p_id_planilla bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
    v_pl planilla;
    v_total numeric;
    v_pago bigint;
    v_fechas date[];
    v_montos numeric[];
    i integer;
BEGIN
    SELECT * INTO v_pl FROM planilla WHERE id_planilla = p_id_planilla;
    IF NOT FOUND OR v_pl.id_cuenta_pagar IS NULL THEN RETURN; END IF;

    DELETE FROM planilla_proyeccion WHERE id_planilla = v_pl.id_planilla;

    -- (1) Estimado: días del periodo no cubiertos por un tareo (enviado, aprobado o reservado) × S/ por día.
    INSERT INTO planilla_proyeccion (id_planilla, id_personal, concepto, fecha, dias, monto)
    SELECT v_pl.id_planilla, p.id_personal, 'estimado', v_pl.fin, count(*),
           round(sum(CASE WHEN p.periodicidad_pago = 'diaria' THEN p.monto_pago
                          ELSE p.monto_pago / CASE p.periodicidad_pago WHEN 'semanal' THEN 7 WHEN 'quincenal' THEN 15 ELSE 30 END END), 2)
    FROM personal p
    CROSS JOIN LATERAL generate_series(GREATEST(v_pl.inicio, COALESCE(p.fecha_ingreso, v_pl.inicio)),
                                       LEAST(v_pl.fin, COALESCE(p.fecha_cese, v_pl.fin)), interval '1 day') AS g(dia)
    WHERE p.id_centro_costo = v_pl.id_centro_costo
      AND (v_pl.id_personal IS NULL OR p.id_personal = v_pl.id_personal)
      AND p.estado = 'activo'
      AND COALESCE(p.monto_pago, 0) > 0
      AND fn_planilla_grupo(p.periodicidad_pago) = v_pl.grupo
      AND (p.periodicidad_pago <> 'diaria' OR (
            CASE WHEN EXISTS (SELECT 1 FROM horario_dia hd WHERE hd.id_horario = p.id_horario)
                 THEN EXISTS (SELECT 1 FROM horario_dia hd WHERE hd.id_horario = p.id_horario AND hd.dia = extract(isodow FROM g.dia)::int)
                 ELSE extract(isodow FROM g.dia) < 7 END))
      AND NOT EXISTS (
            SELECT 1 FROM tareo_trabajador tt JOIN tareo_semana ts ON ts.id_tareo = tt.id_tareo
            WHERE tt.id_personal = p.id_personal AND ts.id_centro_costo = v_pl.id_centro_costo
              AND (tt.enviado > 0 OR tt.aprobado_monto IS NOT NULL OR tt.reserva_monto IS NOT NULL)
              AND g.dia::date BETWEEN ts.semana_inicio AND fn_tareo_fin(ts.periodo, ts.semana_inicio))
    GROUP BY p.id_personal
    HAVING round(sum(CASE WHEN p.periodicidad_pago = 'diaria' THEN p.monto_pago
                          ELSE p.monto_pago / CASE p.periodicidad_pago WHEN 'semanal' THEN 7 WHEN 'quincenal' THEN 15 ELSE 30 END END), 2) > 0;

    -- (2) Saldo de tareos enviados en parte; (3) aprobado o (4) reservado, aún sin enviar.
    INSERT INTO planilla_proyeccion (id_planilla, id_personal, concepto, fecha, dias, monto)
    SELECT v_pl.id_planilla, id_personal, concepto, fecha, NULL, round(sum(monto), 2)
    FROM (
        SELECT tt.id_personal,
               CASE WHEN tt.enviado > 0 THEN 'saldo_tareo' WHEN tt.aprobado_monto IS NOT NULL THEN 'aprobado' ELSE 'reserva' END AS concepto,
               CASE WHEN tt.enviado > 0 THEN v_pl.fin ELSE COALESCE(tt.reserva_fecha, v_pl.fin) END AS fecha,
               CASE WHEN tt.enviado > 0 THEN GREATEST(tt.total - tt.enviado, 0) ELSE COALESCE(tt.aprobado_monto, tt.reserva_monto) END AS monto
        FROM tareo_trabajador tt
        JOIN tareo_semana ts ON ts.id_tareo = tt.id_tareo
        JOIN personal p ON p.id_personal = tt.id_personal
        WHERE ts.id_centro_costo = v_pl.id_centro_costo
          AND (v_pl.id_personal IS NULL OR tt.id_personal = v_pl.id_personal)
          AND (tt.enviado > 0 OR tt.aprobado_monto IS NOT NULL OR tt.reserva_monto IS NOT NULL)
          AND fn_planilla_grupo(p.periodicidad_pago) = v_pl.grupo
          AND ts.semana_inicio BETWEEN v_pl.inicio AND v_pl.fin
    ) x
    GROUP BY id_personal, concepto, fecha
    HAVING round(sum(monto), 2) > 0;

    -- Cuotas "Proyección de planilla": una por fecha.
    SELECT COALESCE(array_agg(fecha ORDER BY fecha), '{}'), COALESCE(array_agg(monto ORDER BY fecha), '{}')
      INTO v_fechas, v_montos
    FROM (SELECT fecha, sum(monto) AS monto FROM planilla_proyeccion WHERE id_planilla = v_pl.id_planilla GROUP BY fecha HAVING sum(monto) > 0) s;

    FOR i IN 1 .. COALESCE(array_length(v_fechas, 1), 0) LOOP
        v_pago := NULL;
        SELECT id_pago INTO v_pago FROM pagos
        WHERE id_cuenta_pagar = v_pl.id_cuenta_pagar AND estado_pago = 'programado' AND referencia = 'Proyección de planilla' AND fecha_pago = v_fechas[i]
        ORDER BY id_pago LIMIT 1;
        IF v_pago IS NULL THEN
            SELECT id_pago INTO v_pago FROM pagos
            WHERE id_cuenta_pagar = v_pl.id_cuenta_pagar AND estado_pago = 'programado' AND referencia = 'Proyección de planilla'
              AND fecha_pago <> ALL (v_fechas)
            ORDER BY id_pago LIMIT 1;
        END IF;
        IF v_pago IS NULL THEN
            INSERT INTO pagos (id_cuenta_pagar, monto, fecha_pago, estado_pago, referencia, usuario_registro)
            VALUES (v_pl.id_cuenta_pagar, v_montos[i], v_fechas[i], 'programado', 'Proyección de planilla', 'sistema');
        ELSE
            UPDATE pagos SET monto = v_montos[i], fecha_pago = v_fechas[i] WHERE id_pago = v_pago;
        END IF;
    END LOOP;

    DELETE FROM pagos pg
    WHERE pg.id_cuenta_pagar = v_pl.id_cuenta_pagar AND pg.estado_pago = 'programado' AND pg.referencia = 'Proyección de planilla'
      AND (pg.fecha_pago <> ALL (v_fechas)
           OR EXISTS (SELECT 1 FROM pagos o
                      WHERE o.id_cuenta_pagar = pg.id_cuenta_pagar AND o.estado_pago = 'programado'
                        AND o.referencia = 'Proyección de planilla' AND o.fecha_pago = pg.fecha_pago AND o.id_pago < pg.id_pago));

    SELECT COALESCE(sum(monto), 0) INTO v_total FROM pagos WHERE id_cuenta_pagar = v_pl.id_cuenta_pagar AND estado_pago <> 'cancelado';
    UPDATE cuentas_pagar SET monto_comprometido = v_total, monto_imponible = v_total WHERE id_cuenta_pagar = v_pl.id_cuenta_pagar;
    PERFORM fn_recalcular_cuenta_pagar(v_pl.id_cuenta_pagar);
END $function$;

-- Proyección del periodo actual: obras agrupadas; Consultoría y Corporativo, una por trabajador.
CREATE OR REPLACE FUNCTION public.fn_planilla_proyectar_todo()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    r record;
    v_n integer := 0;
    v_hoy date := (now() AT TIME ZONE 'America/Lima')::date;
BEGIN
    FOR r IN
        SELECT DISTINCT p.id_centro_costo, fn_planilla_grupo(p.periodicidad_pago) AS grupo, fn_planilla_dueno(p.id_centro_costo, p.id_personal) AS dueno
        FROM personal p
        WHERE p.estado = 'activo' AND p.id_centro_costo IS NOT NULL AND COALESCE(p.monto_pago, 0) > 0
    LOOP
        -- false: si el usuario eliminó la CxP de este periodo, no se vuelve a crear.
        PERFORM fn_planilla_recalcular(fn_planilla_asegurar(r.id_centro_costo, r.grupo, v_hoy, false, r.dueno));
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END $function$;

-- Aprobar / enviar / reservar: la planilla es la del trabajador en Consultoría y Corporativo (fn_planilla_dueno).
CREATE OR REPLACE FUNCTION public.fn_tareo_aprobar(p_id_centro_costo bigint, p_inicio date, p_items jsonb, p_periodo text DEFAULT 'semanal')
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
    v_tareo bigint;
    v_item jsonb;
    v_p personal;
    v_total numeric;
    v_quien text;
    v_n integer := 0;
    v_planillas bigint[] := '{}';
    v_pl bigint;
BEGIN
    SELECT nombre INTO v_quien FROM empleados WHERE auth_user_id = auth.uid() LIMIT 1;
    v_tareo := fn_tareo_asegurar(p_id_centro_costo, p_inicio, p_periodo);
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
        SELECT * INTO v_p FROM personal WHERE id_personal = (v_item->>'id_personal')::bigint;
        IF NOT FOUND THEN RAISE EXCEPTION 'Trabajador % no encontrado.', v_item->>'id_personal'; END IF;
        IF NOT (is_admin() OR fn_tareo_es_jefe(v_p.id_personal)) THEN
            RAISE EXCEPTION 'Solo el jefe inmediato de % (o un administrador) puede aprobar su tareo.', COALESCE(v_item->>'nombre', 'este trabajador')
                USING ERRCODE = '42501', HINT = 'NO_ES_JEFE';
        END IF;
        v_total := round(COALESCE((v_item->>'total')::numeric, 0), 2);
        INSERT INTO tareo_trabajador (id_tareo, id_personal, minutos, tarifa_hora, total, aprobado_monto, aprobado_por, aprobado_en)
        VALUES (v_tareo, v_p.id_personal, COALESCE((v_item->>'minutos')::int, 0), COALESCE((v_item->>'tarifa_hora')::numeric, 0),
                v_total, v_total, left(COALESCE(v_quien, 'Administrador'), 200), now())
        ON CONFLICT (id_tareo, id_personal) DO UPDATE
            SET minutos = EXCLUDED.minutos, tarifa_hora = EXCLUDED.tarifa_hora, total = EXCLUDED.total,
                aprobado_monto = EXCLUDED.aprobado_monto, aprobado_por = EXCLUDED.aprobado_por, aprobado_en = EXCLUDED.aprobado_en;
        v_n := v_n + 1;
        v_pl := fn_planilla_buscar(p_id_centro_costo, fn_planilla_grupo(v_p.periodicidad_pago), p_inicio, fn_planilla_dueno(p_id_centro_costo, v_p.id_personal));
        IF v_pl IS NOT NULL THEN v_planillas := array_append(v_planillas, v_pl); END IF;
    END LOOP;
    PERFORM fn_planilla_recalcular(x) FROM (SELECT DISTINCT unnest(v_planillas) AS x) s;
    RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION public.fn_tareo_enviar(p_id_centro_costo bigint, p_semana_inicio date, p_items jsonb, p_usuario text DEFAULT NULL::text, p_periodo text DEFAULT 'semanal')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
    v_tareo bigint;
    v_item jsonb;
    v_p personal;
    v_prev tareo_trabajador;
    v_tt tareo_trabajador;
    v_monto numeric;
    v_total numeric;
    v_nombre text;
    v_planilla bigint;
    v_cxp bigint;
    v_pago bigint;
    v_fecha date;
    v_planillas bigint[] := '{}';
    v_enviados integer := 0;
BEGIN
    IF NOT tiene_permiso('aprobar_tareo') THEN
        RAISE EXCEPTION 'No tienes permiso para aprobar el tareo.' USING ERRCODE = '42501';
    END IF;
    v_tareo := fn_tareo_asegurar(p_id_centro_costo, p_semana_inicio, p_periodo);

    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
        SELECT * INTO v_p FROM personal WHERE id_personal = (v_item->>'id_personal')::bigint;
        IF NOT FOUND THEN RAISE EXCEPTION 'Trabajador % no encontrado.', v_item->>'id_personal'; END IF;
        v_nombre := COALESCE(v_item->>'nombre', 'Trabajador');
        v_total := round(COALESCE((v_item->>'total')::numeric, 0), 2);
        v_monto := round(COALESCE((v_item->>'monto')::numeric, 0), 2);
        v_fecha := COALESCE(NULLIF(v_item->>'fecha_cxp', '')::date, fn_tareo_fin(p_periodo, p_semana_inicio));

        IF v_monto > 0 THEN
            SELECT * INTO v_prev FROM tareo_trabajador WHERE id_tareo = v_tareo AND id_personal = v_p.id_personal;
            IF NOT FOUND OR v_prev.aprobado_monto IS NULL THEN
                IF NOT FOUND OR v_prev.enviado <= 0 THEN
                    RAISE EXCEPTION '%: falta la aprobación del jefe inmediato.', v_nombre USING HINT = 'TAREO_SIN_APROBAR';
                END IF;
            ELSIF abs(v_prev.aprobado_monto - v_total) > 0.005 THEN
                RAISE EXCEPTION '%: el monto cambió desde que se aprobó (S/ % aprobado, ahora S/ %). El jefe inmediato debe aprobarlo de nuevo.',
                    v_nombre, v_prev.aprobado_monto, v_total USING HINT = 'TAREO_APROBACION_VENCIDA';
            END IF;
        END IF;

        INSERT INTO tareo_trabajador (id_tareo, id_personal, minutos, tarifa_hora, bonos, total, fecha_cxp)
        VALUES (v_tareo, v_p.id_personal, COALESCE((v_item->>'minutos')::int, 0), COALESCE((v_item->>'tarifa_hora')::numeric, 0),
                COALESCE((v_item->>'bonos')::numeric, 0), v_total, v_fecha)
        ON CONFLICT (id_tareo, id_personal) DO UPDATE
            SET minutos = EXCLUDED.minutos, tarifa_hora = EXCLUDED.tarifa_hora, bonos = EXCLUDED.bonos, total = EXCLUDED.total, fecha_cxp = EXCLUDED.fecha_cxp
        RETURNING * INTO v_tt;

        IF v_monto <= 0 THEN CONTINUE; END IF;
        IF v_tt.enviado + v_monto - v_tt.total > 0.005 THEN
            RAISE EXCEPTION '%: el monto a enviar (S/ %) supera lo pendiente (S/ %).', v_nombre, v_monto, v_tt.total - v_tt.enviado;
        END IF;

        v_planilla := fn_planilla_asegurar(p_id_centro_costo, fn_planilla_grupo(v_p.periodicidad_pago), p_semana_inicio, true,
                                           fn_planilla_dueno(p_id_centro_costo, v_p.id_personal));
        SELECT id_cuenta_pagar INTO v_cxp FROM planilla WHERE id_planilla = v_planilla;
        INSERT INTO pagos (id_cuenta_pagar, monto, fecha_pago, estado_pago, referencia, usuario_registro)
        VALUES (v_cxp, v_monto, v_fecha, 'programado',
                left(format('Tareo %s · %s', to_char(p_semana_inicio, 'DD/MM'), v_nombre), 100), left(p_usuario, 100))
        RETURNING id_pago INTO v_pago;
        INSERT INTO tareo_envio (id_tareo_trabajador, id_planilla, id_pago, monto, fecha_cxp, usuario)
        VALUES (v_tt.id_tareo_trabajador, v_planilla, v_pago, v_monto, v_fecha, left(p_usuario, 200));
        UPDATE tareo_trabajador SET enviado = enviado + v_monto WHERE id_tareo_trabajador = v_tt.id_tareo_trabajador;
        v_planillas := array_append(v_planillas, v_planilla);
        v_enviados := v_enviados + 1;
    END LOOP;

    UPDATE tareo_semana SET estado = 'aprobado', aprobado_por = left(p_usuario, 200), aprobado_en = now() WHERE id_tareo = v_tareo;
    PERFORM fn_planilla_recalcular(x) FROM (SELECT DISTINCT unnest(v_planillas) AS x) s;
    RETURN jsonb_build_object('id_tareo', v_tareo, 'enviados', v_enviados);
END $$;

CREATE OR REPLACE FUNCTION public.fn_tareo_reservar(p_id_centro_costo bigint, p_semana_inicio date, p_items jsonb, p_fecha date, p_usuario text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
    v_tareo bigint;
    v_item jsonb;
    v_p personal;
    v_monto numeric;
    v_n integer := 0;
    v_planillas bigint[] := '{}';
    v_dueno bigint;
BEGIN
    IF NOT tiene_permiso('aprobar_tareo') THEN
        RAISE EXCEPTION 'No tienes permiso para aprobar el tareo.' USING ERRCODE = '42501';
    END IF;
    IF p_fecha IS NULL THEN RAISE EXCEPTION 'Elige la fecha de la reserva.'; END IF;
    v_tareo := fn_tareo_asegurar(p_id_centro_costo, p_semana_inicio, 'semanal');
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
        SELECT * INTO v_p FROM personal WHERE id_personal = (v_item->>'id_personal')::bigint;
        IF NOT FOUND THEN RAISE EXCEPTION 'Trabajador % no encontrado.', v_item->>'id_personal'; END IF;
        v_monto := round(COALESCE((v_item->>'monto')::numeric, 0), 2);
        v_dueno := fn_planilla_dueno(p_id_centro_costo, v_p.id_personal);
        INSERT INTO tareo_trabajador (id_tareo, id_personal, reserva_monto, reserva_fecha, reserva_por, reserva_en)
        VALUES (v_tareo, v_p.id_personal, NULLIF(GREATEST(v_monto, 0), 0), CASE WHEN v_monto > 0 THEN p_fecha END,
                CASE WHEN v_monto > 0 THEN left(p_usuario, 200) END, CASE WHEN v_monto > 0 THEN now() END)
        ON CONFLICT (id_tareo, id_personal) DO UPDATE
            SET reserva_monto = EXCLUDED.reserva_monto, reserva_fecha = EXCLUDED.reserva_fecha,
                reserva_por = EXCLUDED.reserva_por, reserva_en = EXCLUDED.reserva_en;
        IF v_monto > 0 THEN
            v_planillas := array_append(v_planillas, fn_planilla_asegurar(p_id_centro_costo, fn_planilla_grupo(v_p.periodicidad_pago), p_semana_inicio, true, v_dueno));
        ELSE
            v_planillas := array_append(v_planillas, fn_planilla_buscar(p_id_centro_costo, fn_planilla_grupo(v_p.periodicidad_pago), p_semana_inicio, v_dueno));
        END IF;
        v_n := v_n + 1;
    END LOOP;
    PERFORM fn_planilla_recalcular(x) FROM (SELECT DISTINCT unnest(v_planillas) AS x) s WHERE x IS NOT NULL;
    RETURN v_n;
END $$;

NOTIFY pgrst, 'reload schema';
