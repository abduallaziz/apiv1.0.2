-- 292_branch_isolation_registry_hardening.sql  (review fixes M-1, M-2 for 279-306)
-- M-1: branch_isolation_tables feeds a SECURITY DEFINER dynamic UPDATE; it must not be writable by the
--      anon/authenticated API roles (RLS on with no policy = deny; only service_role keeps access).
-- M-2: enabling isolation assigns unbranched rows to the main branch; if that would violate a per-branch
--      unique index (e.g. isolation was on, then off, then rows were created with the same key), the whole
--      call aborts with a READABLE error naming the table instead of an opaque 23505. The abort rolls the
--      function's updates back, so nothing half-applies and the flag is not flipped.
-- ROLLBACK: ALTER TABLE branch_isolation_tables DISABLE ROW LEVEL SECURITY; (function: re-apply 280's body)

ALTER TABLE branch_isolation_tables ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.branch_isolation_tables FROM anon, authenticated, PUBLIC;
GRANT ALL PRIVILEGES ON public.branch_isolation_tables TO service_role;

CREATE OR REPLACE FUNCTION fn_branch_isolation_backfill(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $$
DECLARE
  v_main   uuid;
  v_rec    RECORD;
  v_count  bigint;
  v_result jsonb := '{}'::jsonb;
BEGIN
  SELECT id INTO v_main
    FROM branches
   WHERE tenant_id = p_tenant_id AND is_main AND deleted_at IS NULL
   LIMIT 1;
  IF v_main IS NULL THEN
    RAISE EXCEPTION 'tenant % has no main branch', p_tenant_id;
  END IF;

  FOR v_rec IN SELECT * FROM branch_isolation_tables ORDER BY table_name LOOP
    IF to_regclass(format('public.%I', v_rec.table_name)) IS NULL THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = v_rec.table_name
         AND column_name = v_rec.branch_column
    ) OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = v_rec.table_name
         AND column_name = v_rec.tenant_column
    ) THEN
      CONTINUE;
    END IF;
    BEGIN
      EXECUTE format(
        'UPDATE public.%I SET %I = $1 WHERE %I = $2 AND %I IS NULL',
        v_rec.table_name, v_rec.branch_column, v_rec.tenant_column, v_rec.branch_column
      ) USING v_main, p_tenant_id;
      GET DIAGNOSTICS v_count = ROW_COUNT;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'Cannot assign existing % rows to the main branch: a duplicate key already exists there (resolve the duplicate names/codes first)', v_rec.table_name
        USING ERRCODE = 'unique_violation';
    END;
    IF v_count > 0 THEN
      v_result := v_result || jsonb_build_object(v_rec.table_name, v_count);
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION fn_branch_isolation_backfill(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_branch_isolation_backfill(uuid) TO service_role;
