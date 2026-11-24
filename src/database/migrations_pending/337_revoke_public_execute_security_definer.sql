-- 337_revoke_public_execute_security_definer.sql  (R-FN, found by a read-only catalog audit of production on 2026-11-24)
-- Production state: fn_create_sales_return and fn_close_shift are SECURITY DEFINER functions that the public roles
-- (PUBLIC / anon / authenticated) can EXECUTE through the REST /rpc endpoint. They trust their p_tenant_id / ids arguments
-- (the API calls them with the service_role key), so a holder of the public anon key who knows the tenant and order ids
-- could call them with elevated rights. Fix: remove the public roles' EXECUTE and keep it for service_role only.
-- Resolved by NAME so every overload is covered. Idempotent, no data touched, no body changed.
-- ROLLBACK: rollback/337_revoke_public_execute_security_definer_ROLLBACK.sql (restores the previous, exposed grants).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig
             FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('fn_create_sales_return', 'fn_close_shift')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;
