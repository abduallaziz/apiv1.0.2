-- Restores the pre-337 grants (the exposed state). Emergency use only.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig
             FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('fn_create_sales_return', 'fn_close_shift')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon, authenticated, service_role', r.sig);
  END LOOP;
END $$;
