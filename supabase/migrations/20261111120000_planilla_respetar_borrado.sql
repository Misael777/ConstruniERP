-- La proyección de planilla volvía a crear la Cuenta por Pagar que el usuario eliminó (reclamo del 11/11/2026:
-- "la eliminé permanentemente 2 veces y ha vuelto a aparecer"). fn_planilla_proyectar_todo corre al iniciar
-- sesión y al abrir el tareo; al borrar la CxP, planilla.id_cuenta_pagar queda en NULL (ON DELETE SET NULL) y
-- fn_planilla_asegurar la volvía a crear.
-- Ahora: si la planilla del periodo ya existe y su CxP fue borrada, la proyección automática NO la recrea. Solo
-- se vuelve a crear si se envía un tareo real de ese periodo (fn_tareo_enviar), que sí necesita dónde registrar
-- el pago. El periodo siguiente se crea normalmente.
-- No modifica datos. Idempotente.

DROP FUNCTION IF EXISTS public.fn_planilla_asegurar(bigint, text, date);

CREATE OR REPLACE FUNCTION public.fn_planilla_asegurar(p_id_centro_costo bigint, p_grupo text, p_fecha date, p_recrear_borrada boolean DEFAULT true)
RETURNS bigint
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
    -- La planilla existe pero su CxP fue eliminada por el usuario: la proyección automática la respeta.
    IF FOUND AND NOT p_recrear_borrada THEN RETURN NULL; END IF;

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
        -- false: si el usuario eliminó la CxP de este periodo, no se vuelve a crear (fn_planilla_recalcular(NULL) no hace nada).
        PERFORM fn_planilla_recalcular(fn_planilla_asegurar(r.id_centro_costo, r.grupo, v_hoy, false));
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END $$;

-- Interna, como antes: solo la usan fn_planilla_proyectar_todo y fn_tareo_enviar (SECURITY DEFINER).
REVOKE ALL ON FUNCTION public.fn_planilla_asegurar(bigint, text, date, boolean) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
