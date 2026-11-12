-- SEGURIDAD (hallado en la revisión de Control Financiero, 12/11/2026): por los privilegios por defecto de Supabase,
-- el rol `anon` (cualquiera con la clave PÚBLICA que viene dentro de la app, SIN iniciar sesión) podía ejecutar las
-- funciones que mueven dinero. Todas son SECURITY DEFINER, así que además se saltan RLS: crear transacciones,
-- anularlas, confirmar cobros/pagos y revertir ventas sin estar logueado.
-- La app solo las llama con sesión iniciada (rol `authenticated`), y las herramientas de agente / Edge Functions usan
-- `service_role`: a esos dos se les mantiene el permiso explícito. No cambia ningún dato.
DO $$
DECLARE
    f regprocedure;
BEGIN
    FOR f IN
        SELECT p.oid::regprocedure
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'fn_crear_transaccion', 'fn_anular_transaccion', 'fn_reactivar_transaccion',
              'fn_confirmar_cobro', 'fn_confirmar_pago',
              'fn_recalcular_cuenta_cobrar', 'fn_recalcular_cuenta_pagar', 'fn_recalcular_saldo_cuenta_banco',
              'fn_revertir_venta_por_transaccion'
          )
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
