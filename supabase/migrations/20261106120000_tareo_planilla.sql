-- Tareo semanal por obra y planilla en Cuentas por Pagar (pedido del cliente, 06/11/2026, con imagen de referencia).
--
-- Flujo: el residente de obra revisa en RRHH → Asistencia → "Tareo semanal por obra" las horas de cada trabajador
-- (calculadas de las marcas del huellero), corrige días (tareo_ajuste), marca feriados (tareo_feriado), agrega bonos
-- y envía a Cuentas por Pagar (fn_tareo_enviar, permiso aprobar_tareo).
--
-- Pago por hora exacta (decisión del usuario): tarifa/hora = (monto_pago ÷ días calendario del periodo: diaria 1,
-- semanal 7, quincenal 15, mensual 30) ÷ horas de la jornada; pago = horas reconocidas × tarifa + bonos. Ese cálculo
-- se hace en la app (tareo.service.ts) y aquí se guarda el resultado de cada envío.
--
-- Planilla (decisión del usuario: una CxP por obra): una Cuenta por Pagar por obra y periodo (semanal, quincenal o
-- mensual, según la periodicidad de pago del trabajador; 'diaria' va en la semanal), a nombre del proveedor
-- "PLANILLA DE PERSONAL". Cada envío del tareo es una cuota programada de esa CxP (con la Fecha CxP elegida) y una
-- cuota "Proyección de planilla" se recalcula sola con lo que falta (decisión: proyectar y ajustar). Así el saldo y
-- los pagos siguen el flujo normal de Cuentas por Pagar (fn_confirmar_pago, transacciones, Control Financiero).
-- La base no tiene tareas programadas: la app llama fn_planilla_proyectar_todo() al iniciar sesión y al abrir el tareo.
-- Idempotente.

-- 0) Permiso -----------------------------------------------------------------------------------------------------
INSERT INTO public.permisos (nombre, descripcion)
SELECT 'aprobar_tareo', 'RRHH: corregir el tareo semanal, marcar feriados y enviarlo a Cuentas por Pagar (residente de obra)'
WHERE NOT EXISTS (SELECT 1 FROM public.permisos WHERE nombre = 'aprobar_tareo');
INSERT INTO public.roles_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM public.roles r JOIN public.permisos p ON p.nombre = 'aprobar_tareo'
WHERE r.nombre IN ('administrador', 'socio')
  AND NOT EXISTS (SELECT 1 FROM public.roles_permisos rp WHERE rp.rol_id = r.id AND rp.permiso_id = p.id);

-- 1) Feriados (id_centro_costo NULL = todas las obras) -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tareo_feriado (
    id_feriado       bigserial PRIMARY KEY,
    fecha            date NOT NULL,
    id_centro_costo  bigint REFERENCES public.centro_costo (id_centro_costo) ON DELETE CASCADE,
    descripcion      varchar(100),
    usuario          varchar(200),
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tareo_feriado ON public.tareo_feriado (fecha, COALESCE(id_centro_costo, 0));

-- 2) Ajustes del residente por trabajador, día y obra (un trabajador que marca en dos obras tiene un tareo en cada una).
CREATE TABLE IF NOT EXISTS public.tareo_ajuste (
    id_ajuste            bigserial PRIMARY KEY,
    id_personal          bigint NOT NULL REFERENCES public.personal (id_personal) ON DELETE CASCADE,
    id_centro_costo      bigint NOT NULL REFERENCES public.centro_costo (id_centro_costo) ON DELETE CASCADE,
    fecha                date NOT NULL,
    estado               varchar(12) NOT NULL CHECK (estado IN ('asistio', 'feriado', 'sin_trabajo', 'falta')),
    minutos_reconocidos  integer NOT NULL CHECK (minutos_reconocidos BETWEEN 0 AND 1440),
    observacion          varchar(200),
    usuario              varchar(200),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id_personal, fecha, id_centro_costo)
);

-- 3) Semana de tareo por obra y estado por trabajador -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tareo_semana (
    id_tareo         bigserial PRIMARY KEY,
    id_centro_costo  bigint NOT NULL REFERENCES public.centro_costo (id_centro_costo) ON DELETE CASCADE,
    semana_inicio    date NOT NULL CHECK (extract(isodow FROM semana_inicio) = 1),
    estado           varchar(10) NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'aprobado')),
    aprobado_por     varchar(200),
    aprobado_en      timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id_centro_costo, semana_inicio)
);
CREATE TABLE IF NOT EXISTS public.tareo_trabajador (
    id_tareo_trabajador  bigserial PRIMARY KEY,
    id_tareo             bigint NOT NULL REFERENCES public.tareo_semana (id_tareo) ON DELETE CASCADE,
    id_personal          bigint NOT NULL REFERENCES public.personal (id_personal) ON DELETE CASCADE,
    minutos              integer NOT NULL DEFAULT 0,
    tarifa_hora          numeric(12,4) NOT NULL DEFAULT 0,
    bonos                numeric(10,2) NOT NULL DEFAULT 0 CHECK (bonos >= 0),
    total                numeric(12,2) NOT NULL DEFAULT 0,
    enviado              numeric(12,2) NOT NULL DEFAULT 0,
    fecha_cxp            date,
    UNIQUE (id_tareo, id_personal)
);

-- 4) Planilla: CxP por obra y periodo ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planilla (
    id_planilla      bigserial PRIMARY KEY,
    id_centro_costo  bigint NOT NULL REFERENCES public.centro_costo (id_centro_costo) ON DELETE CASCADE,
    grupo            varchar(10) NOT NULL CHECK (grupo IN ('semanal', 'quincenal', 'mensual')),
    inicio           date NOT NULL,
    fin              date NOT NULL,
    id_cuenta_pagar  bigint REFERENCES public.cuentas_pagar (id_cuenta_pagar) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id_centro_costo, grupo, inicio)
);
CREATE TABLE IF NOT EXISTS public.tareo_envio (
    id_envio             bigserial PRIMARY KEY,
    id_tareo_trabajador  bigint NOT NULL REFERENCES public.tareo_trabajador (id_tareo_trabajador) ON DELETE CASCADE,
    id_planilla          bigint NOT NULL REFERENCES public.planilla (id_planilla) ON DELETE CASCADE,
    id_pago              bigint REFERENCES public.pagos (id_pago) ON DELETE SET NULL,
    monto                numeric(12,2) NOT NULL CHECK (monto > 0),
    fecha_cxp            date NOT NULL,
    usuario              varchar(200),
    created_at           timestamptz NOT NULL DEFAULT now()
);

-- RLS: lectura para todo el que entra al ERP con permiso de asistencia; escritura de ajustes/feriados/bonos solo con
-- aprobar_tareo. tareo_semana, tareo_trabajador, planilla y tareo_envio solo se escriben por las funciones de abajo.
ALTER TABLE public.tareo_feriado ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tareo_ajuste ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tareo_semana ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tareo_trabajador ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planilla ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tareo_envio ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['tareo_feriado', 'tareo_ajuste', 'tareo_semana', 'tareo_trabajador', 'planilla', 'tareo_envio'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %1$s_leer ON public.%1$s', t);
        EXECUTE format('CREATE POLICY %1$s_leer ON public.%1$s FOR SELECT TO authenticated USING (tiene_permiso(''ver_rrhh_asistencia''))', t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY['tareo_feriado', 'tareo_ajuste'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %1$s_escribir ON public.%1$s', t);
        EXECUTE format('CREATE POLICY %1$s_escribir ON public.%1$s FOR ALL TO authenticated USING (tiene_permiso(''aprobar_tareo'')) WITH CHECK (tiene_permiso(''aprobar_tareo''))', t);
    END LOOP;
END $$;
GRANT SELECT ON public.tareo_feriado, public.tareo_ajuste, public.tareo_semana, public.tareo_trabajador, public.planilla, public.tareo_envio TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.tareo_feriado, public.tareo_ajuste TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.tareo_feriado_id_feriado_seq, public.tareo_ajuste_id_ajuste_seq TO authenticated;

-- 5) Funciones ----------------------------------------------------------------------------------------------------
-- Grupo de planilla según la periodicidad de pago del trabajador.
CREATE OR REPLACE FUNCTION public.fn_planilla_grupo(p_periodicidad text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_periodicidad WHEN 'quincenal' THEN 'quincenal' WHEN 'mensual' THEN 'mensual' ELSE 'semanal' END;
$$;

-- Periodo (inicio, fin) que contiene p_fecha: semanal lunes–domingo, quincenal 1–15 / 16–fin de mes, mensual el mes.
CREATE OR REPLACE FUNCTION public.fn_planilla_periodo(p_grupo text, p_fecha date, OUT inicio date, OUT fin date)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF p_grupo = 'semanal' THEN
        inicio := p_fecha - (extract(isodow FROM p_fecha)::int - 1);
        fin := inicio + 6;
    ELSIF p_grupo = 'quincenal' THEN
        IF extract(day FROM p_fecha) <= 15 THEN
            inicio := date_trunc('month', p_fecha)::date;
            fin := inicio + 14;
        ELSE
            inicio := date_trunc('month', p_fecha)::date + 15;
            fin := (date_trunc('month', p_fecha) + interval '1 month - 1 day')::date;
        END IF;
    ELSE
        inicio := date_trunc('month', p_fecha)::date;
        fin := (date_trunc('month', p_fecha) + interval '1 month - 1 day')::date;
    END IF;
END $$;

-- Proveedor al que se le cargan las planillas (se crea una sola vez).
CREATE OR REPLACE FUNCTION public.fn_planilla_proveedor() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id bigint;
BEGIN
    SELECT id_proveedor INTO v_id FROM proveedor WHERE razon_social = 'PLANILLA DE PERSONAL' ORDER BY id_proveedor LIMIT 1;
    IF v_id IS NULL THEN
        INSERT INTO proveedor (razon_social, vendedor, estado, usuario_registro)
        VALUES ('PLANILLA DE PERSONAL', 'Personal de obra (tareo)', 'activo', 'sistema')
        RETURNING id_proveedor INTO v_id;
    END IF;
    RETURN v_id;
END $$;

-- Planilla (y su CxP) de la obra para el periodo que contiene p_fecha; la crea si no existe.
CREATE OR REPLACE FUNCTION public.fn_planilla_asegurar(p_id_centro_costo bigint, p_grupo text, p_fecha date) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_per record;
    v_planilla planilla;
    v_cxp bigint;
    v_obra text;
BEGIN
    SELECT * INTO v_per FROM fn_planilla_periodo(p_grupo, p_fecha);
    SELECT * INTO v_planilla FROM planilla WHERE id_centro_costo = p_id_centro_costo AND grupo = p_grupo AND inicio = v_per.inicio;
    IF FOUND AND v_planilla.id_cuenta_pagar IS NOT NULL THEN RETURN v_planilla.id_planilla; END IF;

    SELECT COALESCE(codigo, nombre, 'Obra') INTO v_obra FROM centro_costo WHERE id_centro_costo = p_id_centro_costo;
    INSERT INTO cuentas_pagar (id_proveedor, id_centro_costo, monto_comprometido, monto_pagado, saldo_pendiente, monto_imponible, monto_igv,
                               fecha_emision, fecha_vencimiento, estado, observacion, frecuencia_pago, usuario_registro, responsable)
    VALUES (fn_planilla_proveedor(), p_id_centro_costo, 0, 0, 0, 0, 0, v_per.inicio, v_per.fin, 'pendiente',
            left(format('Planilla %s %s %s–%s', p_grupo, v_obra, to_char(v_per.inicio, 'DD/MM'), to_char(v_per.fin, 'DD/MM/YYYY')), 200),
            'sin_periodicidad', 'sistema', 'Planilla de personal')
    RETURNING id_cuenta_pagar INTO v_cxp;

    INSERT INTO planilla (id_centro_costo, grupo, inicio, fin, id_cuenta_pagar)
    VALUES (p_id_centro_costo, p_grupo, v_per.inicio, v_per.fin, v_cxp)
    ON CONFLICT (id_centro_costo, grupo, inicio) DO UPDATE SET id_cuenta_pagar = EXCLUDED.id_cuenta_pagar
    RETURNING * INTO v_planilla;
    RETURN v_planilla.id_planilla;
END $$;

-- Recalcula la cuota "Proyección de planilla" y el monto de la CxP: proyección = lo que cada trabajador activo de la
-- obra (de ese grupo) ganaría en los días del periodo que todavía no cubre un tareo enviado. Diaria: monto × días
-- programados (horario; sin horario, lunes a sábado). El resto: monto ÷ días calendario × días.
CREATE OR REPLACE FUNCTION public.fn_planilla_recalcular(p_id_planilla bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_pl planilla;
    v_proy numeric := 0;
    v_total numeric;
    v_pago bigint;
BEGIN
    SELECT * INTO v_pl FROM planilla WHERE id_planilla = p_id_planilla;
    IF NOT FOUND OR v_pl.id_cuenta_pagar IS NULL THEN RETURN; END IF;

    SELECT COALESCE(sum(
        CASE WHEN p.periodicidad_pago = 'diaria' THEN p.monto_pago
             ELSE p.monto_pago / CASE p.periodicidad_pago WHEN 'semanal' THEN 7 WHEN 'quincenal' THEN 15 ELSE 30 END
        END
    ), 0) INTO v_proy
    FROM personal p
    CROSS JOIN LATERAL generate_series(GREATEST(v_pl.inicio, COALESCE(p.fecha_ingreso, v_pl.inicio)),
                                       LEAST(v_pl.fin, COALESCE(p.fecha_cese, v_pl.fin)), interval '1 day') AS g(dia)
    WHERE p.id_centro_costo = v_pl.id_centro_costo
      AND p.estado = 'activo'
      AND COALESCE(p.monto_pago, 0) > 0
      AND fn_planilla_grupo(p.periodicidad_pago) = v_pl.grupo
      -- diaria: solo días que trabaja (según su horario fijo; sin horario, de lunes a sábado)
      AND (p.periodicidad_pago <> 'diaria' OR (
            CASE WHEN EXISTS (SELECT 1 FROM horario_dia hd WHERE hd.id_horario = p.id_horario)
                 THEN EXISTS (SELECT 1 FROM horario_dia hd WHERE hd.id_horario = p.id_horario AND hd.dia = extract(isodow FROM g.dia)::int)
                 ELSE extract(isodow FROM g.dia) < 7 END))
      -- días ya cubiertos por un tareo enviado de ese trabajador en esta obra
      AND NOT EXISTS (
            SELECT 1 FROM tareo_trabajador tt JOIN tareo_semana ts ON ts.id_tareo = tt.id_tareo
            WHERE tt.id_personal = p.id_personal AND ts.id_centro_costo = v_pl.id_centro_costo AND tt.enviado > 0
              AND g.dia::date BETWEEN ts.semana_inicio AND ts.semana_inicio + 6);
    -- más lo que quedó sin enviar de los tareos ya enviados en parte (semanas que empiezan en este periodo)
    v_proy := v_proy + COALESCE((
        SELECT sum(GREATEST(tt.total - tt.enviado, 0))
        FROM tareo_trabajador tt
        JOIN tareo_semana ts ON ts.id_tareo = tt.id_tareo
        JOIN personal p ON p.id_personal = tt.id_personal
        WHERE ts.id_centro_costo = v_pl.id_centro_costo AND tt.enviado > 0
          AND fn_planilla_grupo(p.periodicidad_pago) = v_pl.grupo
          AND ts.semana_inicio BETWEEN v_pl.inicio AND v_pl.fin), 0);
    v_proy := round(v_proy, 2);

    SELECT id_pago INTO v_pago FROM pagos
    WHERE id_cuenta_pagar = v_pl.id_cuenta_pagar AND estado_pago = 'programado' AND referencia = 'Proyección de planilla' LIMIT 1;
    IF v_proy > 0 THEN
        IF v_pago IS NULL THEN
            INSERT INTO pagos (id_cuenta_pagar, monto, fecha_pago, estado_pago, referencia, usuario_registro)
            VALUES (v_pl.id_cuenta_pagar, v_proy, v_pl.fin, 'programado', 'Proyección de planilla', 'sistema');
        ELSE
            UPDATE pagos SET monto = v_proy, fecha_pago = v_pl.fin WHERE id_pago = v_pago;
        END IF;
    ELSIF v_pago IS NOT NULL THEN
        DELETE FROM pagos WHERE id_pago = v_pago;
    END IF;

    SELECT COALESCE(sum(monto), 0) INTO v_total FROM pagos WHERE id_cuenta_pagar = v_pl.id_cuenta_pagar AND estado_pago <> 'cancelado';
    UPDATE cuentas_pagar SET monto_comprometido = v_total, monto_imponible = v_total WHERE id_cuenta_pagar = v_pl.id_cuenta_pagar;
    PERFORM fn_recalcular_cuenta_pagar(v_pl.id_cuenta_pagar);
END $$;

-- Asegura y recalcula la planilla del periodo actual de cada obra con personal activo pagado (lo llama la app al
-- iniciar sesión y al abrir el tareo). Barato: una fila por obra y grupo.
CREATE OR REPLACE FUNCTION public.fn_planilla_proyectar_todo() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    r record;
    v_n integer := 0;
    v_hoy date := (now() AT TIME ZONE 'America/Lima')::date;
BEGIN
    FOR r IN
        SELECT DISTINCT p.id_centro_costo, fn_planilla_grupo(p.periodicidad_pago) AS grupo
        FROM personal p
        WHERE p.estado = 'activo' AND p.id_centro_costo IS NOT NULL AND COALESCE(p.monto_pago, 0) > 0
    LOOP
        PERFORM fn_planilla_recalcular(fn_planilla_asegurar(r.id_centro_costo, r.grupo, v_hoy));
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END $$;

-- Envío del tareo (residente): por trabajador, guarda horas/tarifa/bonos/total, crea la cuota programada en la planilla
-- de su obra y periodo y marca la semana como aprobada. p_items: [{id_personal, minutos, tarifa_hora, bonos, total,
-- monto, fecha_cxp, nombre}]. Un trabajador puede enviarse en partes (monto < total) hasta completar su total.
CREATE OR REPLACE FUNCTION public.fn_tareo_enviar(p_id_centro_costo bigint, p_semana_inicio date, p_items jsonb, p_usuario text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_tareo tareo_semana;
    v_item jsonb;
    v_p personal;
    v_tt tareo_trabajador;
    v_monto numeric;
    v_total numeric;
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
    IF extract(isodow FROM p_semana_inicio) <> 1 THEN RAISE EXCEPTION 'La semana debe empezar en lunes.'; END IF;

    INSERT INTO tareo_semana (id_centro_costo, semana_inicio) VALUES (p_id_centro_costo, p_semana_inicio)
    ON CONFLICT (id_centro_costo, semana_inicio) DO UPDATE SET id_centro_costo = EXCLUDED.id_centro_costo
    RETURNING * INTO v_tareo;

    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
        SELECT * INTO v_p FROM personal WHERE id_personal = (v_item->>'id_personal')::bigint;
        IF NOT FOUND THEN RAISE EXCEPTION 'Trabajador % no encontrado.', v_item->>'id_personal'; END IF;
        v_total := round(COALESCE((v_item->>'total')::numeric, 0), 2);
        v_monto := round(COALESCE((v_item->>'monto')::numeric, 0), 2);
        v_fecha := COALESCE(NULLIF(v_item->>'fecha_cxp', '')::date, p_semana_inicio + 6);

        INSERT INTO tareo_trabajador (id_tareo, id_personal, minutos, tarifa_hora, bonos, total, fecha_cxp)
        VALUES (v_tareo.id_tareo, v_p.id_personal, COALESCE((v_item->>'minutos')::int, 0), COALESCE((v_item->>'tarifa_hora')::numeric, 0),
                COALESCE((v_item->>'bonos')::numeric, 0), v_total, v_fecha)
        ON CONFLICT (id_tareo, id_personal) DO UPDATE
            SET minutos = EXCLUDED.minutos, tarifa_hora = EXCLUDED.tarifa_hora, bonos = EXCLUDED.bonos, total = EXCLUDED.total, fecha_cxp = EXCLUDED.fecha_cxp
        RETURNING * INTO v_tt;

        IF v_monto <= 0 THEN CONTINUE; END IF;
        IF v_tt.enviado + v_monto - v_tt.total > 0.005 THEN
            RAISE EXCEPTION '%: el monto a enviar (S/ %) supera lo pendiente (S/ %).', COALESCE(v_item->>'nombre', 'Trabajador'), v_monto, v_tt.total - v_tt.enviado;
        END IF;

        v_planilla := fn_planilla_asegurar(p_id_centro_costo, fn_planilla_grupo(v_p.periodicidad_pago), p_semana_inicio);
        SELECT id_cuenta_pagar INTO v_cxp FROM planilla WHERE id_planilla = v_planilla;
        INSERT INTO pagos (id_cuenta_pagar, monto, fecha_pago, estado_pago, referencia, usuario_registro)
        VALUES (v_cxp, v_monto, v_fecha, 'programado',
                left(format('Tareo %s · %s', to_char(p_semana_inicio, 'DD/MM'), COALESCE(v_item->>'nombre', 'Trabajador')), 100), left(p_usuario, 100))
        RETURNING id_pago INTO v_pago;
        INSERT INTO tareo_envio (id_tareo_trabajador, id_planilla, id_pago, monto, fecha_cxp, usuario)
        VALUES (v_tt.id_tareo_trabajador, v_planilla, v_pago, v_monto, v_fecha, left(p_usuario, 200));
        UPDATE tareo_trabajador SET enviado = enviado + v_monto WHERE id_tareo_trabajador = v_tt.id_tareo_trabajador;
        v_planillas := array_append(v_planillas, v_planilla);
        v_enviados := v_enviados + 1;
    END LOOP;

    UPDATE tareo_semana SET estado = 'aprobado', aprobado_por = left(p_usuario, 200), aprobado_en = now() WHERE id_tareo = v_tareo.id_tareo;
    PERFORM fn_planilla_recalcular(x) FROM (SELECT DISTINCT unnest(v_planillas) AS x) s;
    RETURN jsonb_build_object('id_tareo', v_tareo.id_tareo, 'enviados', v_enviados);
END $$;

-- Bonos y fecha de CxP de un trabajador antes de enviar (se guardan en el borrador de la semana).
CREATE OR REPLACE FUNCTION public.fn_tareo_guardar_trabajador(p_id_centro_costo bigint, p_semana_inicio date, p_id_personal bigint, p_bonos numeric, p_fecha_cxp date)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tareo bigint;
BEGIN
    IF NOT tiene_permiso('aprobar_tareo') THEN
        RAISE EXCEPTION 'No tienes permiso para aprobar el tareo.' USING ERRCODE = '42501';
    END IF;
    INSERT INTO tareo_semana (id_centro_costo, semana_inicio) VALUES (p_id_centro_costo, p_semana_inicio)
    ON CONFLICT (id_centro_costo, semana_inicio) DO UPDATE SET id_centro_costo = EXCLUDED.id_centro_costo
    RETURNING id_tareo INTO v_tareo;
    INSERT INTO tareo_trabajador (id_tareo, id_personal, bonos, fecha_cxp)
    VALUES (v_tareo, p_id_personal, GREATEST(COALESCE(p_bonos, 0), 0), p_fecha_cxp)
    ON CONFLICT (id_tareo, id_personal) DO UPDATE SET bonos = EXCLUDED.bonos, fecha_cxp = EXCLUDED.fecha_cxp;
END $$;

-- La cuota "Proyección de planilla" es una estimación: no se paga (se pagan las cuotas que crea el envío del tareo).
-- Si se pagara, fn_planilla_recalcular volvería a crear la proyección y se pagaría doble.
CREATE OR REPLACE FUNCTION public.fn_pagos_proteger_proyeccion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.referencia = 'Proyección de planilla' AND NEW.estado_pago = 'pagado' AND OLD.estado_pago <> 'pagado' THEN
        RAISE EXCEPTION 'La "Proyección de planilla" es una estimación y no se paga. Envía el tareo desde RRHH → Asistencia → Tareo semanal y paga las cuotas de cada trabajador.'
            USING HINT = 'PROYECCION_PLANILLA';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pagos_proteger_proyeccion ON public.pagos;
CREATE TRIGGER trg_pagos_proteger_proyeccion BEFORE UPDATE OF estado_pago ON public.pagos
    FOR EACH ROW EXECUTE FUNCTION public.fn_pagos_proteger_proyeccion();

REVOKE ALL ON FUNCTION public.fn_planilla_asegurar(bigint, text, date), public.fn_planilla_recalcular(bigint),
    public.fn_planilla_proveedor() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_planilla_proyectar_todo(), public.fn_tareo_enviar(bigint, date, jsonb, text),
    public.fn_tareo_guardar_trabajador(bigint, date, bigint, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_planilla_proyectar_todo(), public.fn_tareo_enviar(bigint, date, jsonb, text),
    public.fn_tareo_guardar_trabajador(bigint, date, bigint, numeric, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
