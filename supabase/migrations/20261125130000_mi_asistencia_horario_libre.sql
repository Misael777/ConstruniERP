-- Ticket #117 (pedido de la clienta, 25/11/2026): con HORARIO LIBRE la ventana al entrar al ERP solo pregunta
-- "¿Vas a laborar hoy?". Si responde que sí, ese día cuenta como JORNADA COMPLETA (no se registra hora de ingreso);
-- si responde que no, el día queda como no laborado. La respuesta se guarda como ajuste del tareo de su obra o área
-- principal (tareo_ajuste.declarado = true): 1 día completo (8 h reconocidas) o sin pago. Si el residente o el jefe ya
-- editaron ese día, manda lo de ellos (no se pisa). Los horarios fijos o mixtos siguen con "¿Estás comenzando tu
-- jornada?" y la marca de ingreso.
-- No modifica datos existentes. Idempotente.

ALTER TABLE public.tareo_ajuste ADD COLUMN IF NOT EXISTS declarado boolean NOT NULL DEFAULT false;

-- p_labora: true = hoy labora (jornada completa); false = hoy no labora.
CREATE OR REPLACE FUNCTION public.fn_mi_asistencia_declarar(p_labora boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
    v_p personal;
    v_hoy date := (now() AT TIME ZONE 'America/Lima')::date;
    v_previo tareo_ajuste;
    v_nombre text;
BEGIN
    v_p := fn_mi_asistencia_ficha();
    IF v_p.id_personal IS NULL THEN
        RAISE EXCEPTION 'Tu usuario no está vinculado a una ficha de Personal. Pide a un administrador que lo vincule.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM horario h WHERE h.id_horario = v_p.id_horario AND h.tipo = 'libre') THEN
        RAISE EXCEPTION 'Esta respuesta es solo para horario libre.';
    END IF;
    IF v_p.id_centro_costo IS NULL THEN
        RAISE EXCEPTION 'Tu ficha de Personal no tiene obra o área principal: pide que la asignen para registrar tu jornada.';
    END IF;
    SELECT * INTO v_previo FROM tareo_ajuste WHERE id_personal = v_p.id_personal AND id_centro_costo = v_p.id_centro_costo AND fecha = v_hoy;
    IF FOUND AND NOT v_previo.declarado THEN
        -- Ya lo editó el residente o el jefe: se respeta.
        RETURN jsonb_build_object('fecha', v_hoy, 'labora', v_previo.estado = 'asistio', 'respetado', true);
    END IF;
    v_nombre := COALESCE(NULLIF(btrim(concat_ws(' ', v_p.nombres, v_p.apellidos)), ''), v_p.nombre);
    INSERT INTO tareo_ajuste (id_personal, id_centro_costo, fecha, estado, minutos_reconocidos, observacion, usuario, declarado, updated_at)
    VALUES (v_p.id_personal, v_p.id_centro_costo, v_hoy,
            CASE WHEN p_labora THEN 'asistio' ELSE 'sin_trabajo' END,
            CASE WHEN p_labora THEN 480 ELSE 0 END,
            CASE WHEN p_labora THEN 'Horario libre: declaró que labora hoy (jornada completa)' ELSE 'Horario libre: declaró que hoy no labora' END,
            left(v_nombre, 200), true, now())
    ON CONFLICT (id_personal, fecha, id_centro_costo) DO UPDATE
        SET estado = EXCLUDED.estado, minutos_reconocidos = EXCLUDED.minutos_reconocidos, observacion = EXCLUDED.observacion,
            usuario = EXCLUDED.usuario, declarado = true, updated_at = now();
    RETURN jsonb_build_object('fecha', v_hoy, 'labora', p_labora, 'respetado', false);
END $$;
REVOKE ALL ON FUNCTION public.fn_mi_asistencia_declarar(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mi_asistencia_declarar(boolean) TO authenticated;

-- fn_mi_asistencia: agrega "hoy_labora" (true/false según lo que ya respondió hoy, o lo que puso el residente; null = aún no).
CREATE OR REPLACE FUNCTION public.fn_mi_asistencia(p_desde date, p_hasta date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_p personal;
    v_hoy date := (now() AT TIME ZONE 'America/Lima')::date;
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
        'hoy_labora', (SELECT a.estado = 'asistio' FROM tareo_ajuste a
                       WHERE a.id_personal = v_p.id_personal AND a.id_centro_costo = v_p.id_centro_costo AND a.fecha = v_hoy LIMIT 1),
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

NOTIFY pgrst, 'reload schema';
