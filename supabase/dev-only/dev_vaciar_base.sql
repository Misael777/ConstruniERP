-- SOLO PARA LA BASE DE DESARROLLO (Dev, ref hlfaxszecrxgkbjafepv). NUNCA aplicar en Producción.
-- Por eso vive en supabase/dev-only/ y NO en supabase/migrations/ (supabase db push / migration repair no lo ven).
--
-- Herramienta del rol developer (a pedido del usuario, 22/10/2026): "Vaciar base de desarrollo" en el ERP, para
-- empezar de cero cuando se quiera. Tres candados:
--   1) la función solo existe en Dev (este archivo se aplica a mano solo ahí);
--   2) además exige la marca dev_entorno_marca, que solo se crea acá;
--   3) solo la puede ejecutar un usuario con rol 'developer' y con la confirmación exacta 'VACIAR DEV'.
-- Conserva lo necesario para seguir entrando al ERP: usuarios (auth.users), empleados, roles, permisos,
-- roles_permisos, area y los catálogos unidad_medida / recurso_familia. Todo lo demás del esquema public se vacía
-- (incluidas tablas nuevas que se agreguen en el futuro).
--
-- Aplicar (desde la raíz del repo):  psql -1 -v ON_ERROR_STOP=1 -d "<SUPABASE_DB_URL de app/.env.dev>" -f supabase/dev-only/dev_vaciar_base.sql
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.dev_entorno_marca (
    id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    descripcion text NOT NULL DEFAULT 'Base de DESARROLLO — se puede vaciar desde el ERP (rol developer)',
    creado_en   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.dev_entorno_marca (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.dev_entorno_marca ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dev_entorno_marca_leer ON public.dev_entorno_marca;
CREATE POLICY dev_entorno_marca_leer ON public.dev_entorno_marca FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.dev_entorno_marca TO authenticated;

CREATE OR REPLACE FUNCTION public.dev_vaciar_base(p_confirmacion text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_conservar text[] := ARRAY['empleados', 'roles', 'permisos', 'roles_permisos', 'area', 'unidad_medida', 'recurso_familia', 'dev_entorno_marca'];
    v_tablas text[];
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dev_entorno_marca WHERE id = 1) THEN
        RAISE EXCEPTION 'Esta base no está marcada como de desarrollo: no se vacía.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM empleados e JOIN roles r ON r.id = e.rol_id
        WHERE e.auth_user_id = auth.uid() AND e.estado = 'activo' AND r.nombre = 'developer'
    ) THEN
        RAISE EXCEPTION 'Solo un usuario con rol developer puede vaciar la base de desarrollo.' USING ERRCODE = '42501';
    END IF;
    IF p_confirmacion IS DISTINCT FROM 'VACIAR DEV' THEN
        RAISE EXCEPTION 'Confirmación incorrecta: escribe VACIAR DEV.';
    END IF;

    SELECT array_agg(format('public.%I', c.relname) ORDER BY c.relname) INTO v_tablas
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT (c.relname = ANY (v_conservar));

    IF v_tablas IS NOT NULL THEN
        EXECUTE 'TRUNCATE ' || array_to_string(v_tablas, ', ') || ' RESTART IDENTITY CASCADE';
    END IF;
    RETURN jsonb_build_object('tablas_vaciadas', coalesce(array_length(v_tablas, 1), 0), 'conservadas', v_conservar);
END $$;
REVOKE ALL ON FUNCTION public.dev_vaciar_base(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dev_vaciar_base(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
