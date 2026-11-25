-- Tickets #118 y #119 (24/11/2026): Tareo con aprobación del jefe inmediato, vista Proyección y pestaña Consultoría.
--
-- #119: en Personal se elige el JEFE INMEDIATO de cada trabajador (lista de usuarios del ERP). Solo su jefe inmediato (o un
--       administrador) aprueba su tareo; el jefe ve la asistencia, el monto y el botón Aprobar (no la fecha de CxP ni el envío).
-- #118: ya no hay botones de envío individuales: todo queda "Pendiente" hasta que el jefe aprueba, y solo lo aprobado se
--       envía a Cuentas por Pagar (quien tiene aprobar_tareo envía). Si después cambia el monto (asistencia o bonos), la
--       aprobación deja de valer y hay que aprobar de nuevo (decisión del usuario, 24/11/2026). Lo ya enviado no se toca.
--       Vista Proyección (Obra): "Fondo separado" por obra y semana, y "Programar reserva" por trabajador: la reserva
--       reemplaza la estimación automática en la cuota "Proyección de planilla" de la CxP (con la fecha elegida). Al
--       aprobar el tareo real, la proyección usa el monto aprobado (sin duplicar); al enviarlo, sale de la proyección.
--       Pestaña Consultoría: tareo por periodo de pago (quincenal o mensual) para el personal que no es de obra.
--
-- Columnas nuevas: personal.id_jefe_inmediato, personal.modalidad; tareo_semana.periodo, tareo_semana.fondo_separado;
-- tareo_trabajador.aprobado_* y reserva_*. No modifica datos existentes (lo enviado antes de esta versión sigue valiendo
-- como aprobado). Idempotente.

-- ───────────────────────── Personal ─────────────────────────
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS id_jefe_inmediato integer REFERENCES public.empleados(id) ON DELETE SET NULL;
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS modalidad varchar(10);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_modalidad_check') THEN
        ALTER TABLE public.personal ADD CONSTRAINT personal_modalidad_check
            CHECK (modalidad IS NULL OR modalidad IN ('presencial', 'remoto', 'hibrido'));
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS personal_jefe_inmediato_idx ON public.personal (id_jefe_inmediato);

-- ───────────────────────── Tareo: periodo y fondo ─────────────────────────
ALTER TABLE public.tareo_semana ADD COLUMN IF NOT EXISTS periodo varchar(10) NOT NULL DEFAULT 'semanal';
ALTER TABLE public.tareo_semana ADD COLUMN IF NOT EXISTS fondo_separado numeric(12,2);
ALTER TABLE public.tareo_semana DROP CONSTRAINT IF EXISTS tareo_semana_semana_inicio_check;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tareo_semana_periodo_check') THEN
        ALTER TABLE public.tareo_semana ADD CONSTRAINT tareo_semana_periodo_check CHECK (
            (periodo = 'semanal' AND extract(isodow FROM semana_inicio) = 1)
            OR (periodo = 'quincenal' AND extract(day FROM semana_inicio) IN (1, 16))
            OR (periodo = 'mensual' AND extract(day FROM semana_inicio) = 1));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tareo_semana_centro_inicio_periodo_key') THEN
        ALTER TABLE public.tareo_semana DROP CONSTRAINT IF EXISTS tareo_semana_id_centro_costo_semana_inicio_key;
        ALTER TABLE public.tareo_semana ADD CONSTRAINT tareo_semana_centro_inicio_periodo_key UNIQUE (id_centro_costo, semana_inicio, periodo);
    END IF;
END $$;

ALTER TABLE public.tareo_trabajador
    ADD COLUMN IF NOT EXISTS aprobado_monto numeric(12,2),
    ADD COLUMN IF NOT EXISTS aprobado_por varchar(200),
    ADD COLUMN IF NOT EXISTS aprobado_en timestamptz,
    ADD COLUMN IF NOT EXISTS reserva_monto numeric(12,2),
    ADD COLUMN IF NOT EXISTS reserva_fecha date,
    ADD COLUMN IF NOT EXISTS reserva_por varchar(200),
    ADD COLUMN IF NOT EXISTS reserva_en timestamptz;

-- ───────────────────────── Ayudantes ─────────────────────────
-- Último día del periodo de un tareo (semana de lunes a domingo, quincena o mes).
CREATE OR REPLACE FUNCTION public.fn_tareo_fin(p_periodo text, p_inicio date) RETURNS date
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
    SELECT CASE WHEN COALESCE(p_periodo, 'semanal') = 'semanal' THEN p_inicio + 6 ELSE (fn_planilla_periodo(p_periodo, p_inicio)).fin END;
$$;

-- Cabecera del tareo (obra/centro + inicio + periodo); la crea si no existe. Uso interno.
CREATE OR REPLACE FUNCTION public.fn_tareo_asegurar(p_id_centro_costo bigint, p_inicio date, p_periodo text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id bigint;
BEGIN
    IF COALESCE(p_periodo, '') NOT IN ('semanal', 'quincenal', 'mensual') THEN
        RAISE EXCEPTION 'Periodo de tareo no válido: %', p_periodo;
    END IF;
    INSERT INTO tareo_semana (id_centro_costo, semana_inicio, periodo) VALUES (p_id_centro_costo, p_inicio, p_periodo)
    ON CONFLICT (id_centro_costo, semana_inicio, periodo) DO UPDATE SET periodo = EXCLUDED.periodo
    RETURNING id_tareo INTO v_id;
    RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.fn_tareo_asegurar(bigint, date, text) FROM PUBLIC, anon, authenticated;

-- ¿El usuario conectado es el jefe inmediato de este trabajador?
CREATE OR REPLACE FUNCTION public.fn_tareo_es_jefe(p_id_personal bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
    SELECT EXISTS (
        SELECT 1 FROM personal p JOIN empleados e ON e.id = p.id_jefe_inmediato
        WHERE p.id_personal = p_id_personal AND e.auth_user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.fn_tareo_es_jefe(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tareo_es_jefe(bigint) TO authenticated;

-- ───────────────────────── Bonos y Fecha CxP ─────────────────────────
DROP FUNCTION IF EXISTS public.fn_tareo_guardar_trabajador(bigint, date, bigint, numeric, date);
CREATE OR REPLACE FUNCTION public.fn_tareo_guardar_trabajador(
    p_id_centro_costo bigint, p_semana_inicio date, p_id_personal bigint, p_bonos numeric, p_fecha_cxp date, p_periodo text DEFAULT 'semanal'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tareo bigint;
BEGIN
    IF NOT tiene_permiso('aprobar_tareo') THEN
        RAISE EXCEPTION 'No tienes permiso para aprobar el tareo.' USING ERRCODE = '42501';
    END IF;
    v_tareo := fn_tareo_asegurar(p_id_centro_costo, p_semana_inicio, p_periodo);
    INSERT INTO tareo_trabajador (id_tareo, id_personal, bonos, fecha_cxp)
    VALUES (v_tareo, p_id_personal, GREATEST(COALESCE(p_bonos, 0), 0), p_fecha_cxp)
    ON CONFLICT (id_tareo, id_personal) DO UPDATE SET bonos = EXCLUDED.bonos, fecha_cxp = EXCLUDED.fecha_cxp;
END $$;
REVOKE ALL ON FUNCTION public.fn_tareo_guardar_trabajador(bigint, date, bigint, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tareo_guardar_trabajador(bigint, date, bigint, numeric, date, text) TO authenticated;

-- ───────────────────────── Aprobación del jefe inmediato (#119) ─────────────────────────
-- p_items: [{id_personal, nombre, minutos, tarifa_hora, total}]. Guarda el total aprobado; si luego el total cambia, el
-- envío lo rechaza hasta que se apruebe de nuevo. No toca los bonos ni la Fecha CxP (los pone quien envía).
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
        -- La proyección de la planilla (si ya existe) pasa a usar el monto aprobado.
        SELECT pl.id_planilla INTO v_pl FROM planilla pl
        WHERE pl.id_centro_costo = p_id_centro_costo AND pl.grupo = fn_planilla_grupo(v_p.periodicidad_pago)
          AND pl.inicio = (fn_planilla_periodo(fn_planilla_grupo(v_p.periodicidad_pago), p_inicio)).inicio;
        IF v_pl IS NOT NULL THEN v_planillas := array_append(v_planillas, v_pl); END IF;
    END LOOP;
    PERFORM fn_planilla_recalcular(x) FROM (SELECT DISTINCT unnest(v_planillas) AS x) s;
    RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.fn_tareo_aprobar(bigint, date, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tareo_aprobar(bigint, date, jsonb, text) TO authenticated;

-- ───────────────────────── Envío a CxP: solo lo aprobado (#118) ─────────────────────────
DROP FUNCTION IF EXISTS public.fn_tareo_enviar(bigint, date, jsonb, text);
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
                -- Lo enviado antes de existir la aprobación (24/11/2026) sigue valiendo: se puede enviar su saldo.
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

        v_planilla := fn_planilla_asegurar(p_id_centro_costo, fn_planilla_grupo(v_p.periodicidad_pago), p_semana_inicio);
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
REVOKE ALL ON FUNCTION public.fn_tareo_enviar(bigint, date, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tareo_enviar(bigint, date, jsonb, text, text) TO authenticated;

-- ───────────────────────── Liberar envíos sin pago (#133), ahora por periodo ─────────────────────────
DROP FUNCTION IF EXISTS public.fn_tareo_liberar_envios_sin_pago(bigint, date);
CREATE OR REPLACE FUNCTION public.fn_tareo_liberar_envios_sin_pago(p_id_centro_costo bigint, p_semana_inicio date, p_periodo text DEFAULT 'semanal')
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
    r record;
    v_total numeric := 0;
BEGIN
    IF NOT tiene_permiso('aprobar_tareo') THEN
        RAISE EXCEPTION 'No tienes permiso para aprobar tareos';
    END IF;
    FOR r IN
        DELETE FROM tareo_envio e
        USING tareo_trabajador tt, tareo_semana ts
        WHERE e.id_tareo_trabajador = tt.id_tareo_trabajador
          AND tt.id_tareo = ts.id_tareo
          AND ts.id_centro_costo = p_id_centro_costo
          AND ts.semana_inicio = p_semana_inicio
          AND ts.periodo = COALESCE(p_periodo, 'semanal')
          AND e.id_pago IS NULL
        RETURNING e.id_tareo_trabajador, e.monto
    LOOP
        UPDATE tareo_trabajador SET enviado = GREATEST(enviado - r.monto, 0) WHERE id_tareo_trabajador = r.id_tareo_trabajador;
        v_total := v_total + r.monto;
    END LOOP;
    RETURN v_total;
END $$;
REVOKE ALL ON FUNCTION public.fn_tareo_liberar_envios_sin_pago(bigint, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tareo_liberar_envios_sin_pago(bigint, date, text) TO authenticated;

-- ───────────────────────── Proyección: fondo separado y reservas (#118) ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_tareo_fondo(p_id_centro_costo bigint, p_semana_inicio date, p_monto numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tareo bigint;
BEGIN
    IF NOT tiene_permiso('aprobar_tareo') THEN
        RAISE EXCEPTION 'No tienes permiso para aprobar el tareo.' USING ERRCODE = '42501';
    END IF;
    v_tareo := fn_tareo_asegurar(p_id_centro_costo, p_semana_inicio, 'semanal');
    UPDATE tareo_semana SET fondo_separado = CASE WHEN p_monto IS NULL OR p_monto < 0 THEN NULL ELSE round(p_monto, 2) END
    WHERE id_tareo = v_tareo;
END $$;
REVOKE ALL ON FUNCTION public.fn_tareo_fondo(bigint, date, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tareo_fondo(bigint, date, numeric) TO authenticated;

-- p_items: [{id_personal, monto}]. monto <= 0 quita la reserva. La reserva va a la cuota "Proyección de planilla" de la
-- CxP de la planilla del trabajador, con la fecha elegida (crea la CxP del periodo si no existe).
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
        INSERT INTO tareo_trabajador (id_tareo, id_personal, reserva_monto, reserva_fecha, reserva_por, reserva_en)
        VALUES (v_tareo, v_p.id_personal, NULLIF(GREATEST(v_monto, 0), 0), CASE WHEN v_monto > 0 THEN p_fecha END,
                CASE WHEN v_monto > 0 THEN left(p_usuario, 200) END, CASE WHEN v_monto > 0 THEN now() END)
        ON CONFLICT (id_tareo, id_personal) DO UPDATE
            SET reserva_monto = EXCLUDED.reserva_monto, reserva_fecha = EXCLUDED.reserva_fecha,
                reserva_por = EXCLUDED.reserva_por, reserva_en = EXCLUDED.reserva_en;
        IF v_monto > 0 THEN
            v_planillas := array_append(v_planillas, fn_planilla_asegurar(p_id_centro_costo, fn_planilla_grupo(v_p.periodicidad_pago), p_semana_inicio, true));
        ELSE
            -- Quitar una reserva no crea CxP: solo recalcula la planilla si ya existe.
            v_planillas := array_append(v_planillas, (
                SELECT pl.id_planilla FROM planilla pl
                WHERE pl.id_centro_costo = p_id_centro_costo AND pl.grupo = fn_planilla_grupo(v_p.periodicidad_pago)
                  AND pl.inicio = (fn_planilla_periodo(fn_planilla_grupo(v_p.periodicidad_pago), p_semana_inicio)).inicio));
        END IF;
        v_n := v_n + 1;
    END LOOP;
    PERFORM fn_planilla_recalcular(x) FROM (SELECT DISTINCT unnest(v_planillas) AS x) s WHERE x IS NOT NULL;
    RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.fn_tareo_reservar(bigint, date, jsonb, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tareo_reservar(bigint, date, jsonb, date, text) TO authenticated;

-- ───────────────────────── Proyección de la planilla en CxP ─────────────────────────
-- Igual que antes (estimación por día de cada trabajador activo + saldo sin enviar de los tareos enviados en parte), y
-- además: un trabajador con tareo APROBADO o con RESERVA en una semana/periodo (y aún sin enviar) no se estima día a día
-- en ese periodo: cuenta su monto aprobado (o, si aún no se aprueba, su reserva), en la fecha de la reserva. Puede haber
-- varias cuotas "Proyección de planilla" (una por fecha). Al enviarlo a CxP sale de la proyección (no se duplica).
CREATE OR REPLACE FUNCTION public.fn_planilla_recalcular(p_id_planilla bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
    v_pl planilla;
    v_proy numeric := 0;
    v_total numeric;
    v_pago bigint;
    v_fechas date[];
    v_montos numeric[];
    i integer;
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
      -- días cubiertos por un tareo del trabajador en esta obra: enviado, aprobado o con reserva
      AND NOT EXISTS (
            SELECT 1 FROM tareo_trabajador tt JOIN tareo_semana ts ON ts.id_tareo = tt.id_tareo
            WHERE tt.id_personal = p.id_personal AND ts.id_centro_costo = v_pl.id_centro_costo
              AND (tt.enviado > 0 OR tt.aprobado_monto IS NOT NULL OR tt.reserva_monto IS NOT NULL)
              AND g.dia::date BETWEEN ts.semana_inicio AND fn_tareo_fin(ts.periodo, ts.semana_inicio));
    -- más lo que quedó sin enviar de los tareos ya enviados en parte (periodos que empiezan en esta planilla)
    v_proy := v_proy + COALESCE((
        SELECT sum(GREATEST(tt.total - tt.enviado, 0))
        FROM tareo_trabajador tt
        JOIN tareo_semana ts ON ts.id_tareo = tt.id_tareo
        JOIN personal p ON p.id_personal = tt.id_personal
        WHERE ts.id_centro_costo = v_pl.id_centro_costo AND tt.enviado > 0
          AND fn_planilla_grupo(p.periodicidad_pago) = v_pl.grupo
          AND ts.semana_inicio BETWEEN v_pl.inicio AND v_pl.fin), 0);

    -- Cuotas de proyección deseadas: una por fecha (la estimación va al fin del periodo; cada reserva, a su fecha).
    SELECT COALESCE(array_agg(fecha ORDER BY fecha), '{}'), COALESCE(array_agg(monto ORDER BY fecha), '{}')
      INTO v_fechas, v_montos
    FROM (
        SELECT fecha, round(sum(monto), 2) AS monto FROM (
            SELECT v_pl.fin AS fecha, v_proy AS monto
            UNION ALL
            SELECT COALESCE(tt.reserva_fecha, v_pl.fin), COALESCE(tt.aprobado_monto, tt.reserva_monto)
            FROM tareo_trabajador tt
            JOIN tareo_semana ts ON ts.id_tareo = tt.id_tareo
            JOIN personal p ON p.id_personal = tt.id_personal
            WHERE ts.id_centro_costo = v_pl.id_centro_costo AND tt.enviado = 0
              AND (tt.aprobado_monto IS NOT NULL OR tt.reserva_monto IS NOT NULL)
              AND fn_planilla_grupo(p.periodicidad_pago) = v_pl.grupo
              AND ts.semana_inicio BETWEEN v_pl.inicio AND v_pl.fin
        ) x GROUP BY fecha HAVING round(sum(monto), 2) > 0
    ) s;

    FOR i IN 1 .. COALESCE(array_length(v_fechas, 1), 0) LOOP
        v_pago := NULL;
        SELECT id_pago INTO v_pago FROM pagos
        WHERE id_cuenta_pagar = v_pl.id_cuenta_pagar AND estado_pago = 'programado' AND referencia = 'Proyección de planilla'
          AND fecha_pago = v_fechas[i]
        ORDER BY id_pago LIMIT 1;
        IF v_pago IS NULL THEN
            -- reusa una cuota de proyección cuya fecha ya no se usa (no crea y borra en cada recálculo)
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

    -- Sobran: cuotas de proyección de fechas que ya no se usan, o repetidas para una misma fecha.
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

NOTIFY pgrst, 'reload schema';
