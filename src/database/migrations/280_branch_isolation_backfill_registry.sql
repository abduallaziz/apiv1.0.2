-- 280_branch_isolation_backfill_registry.sql  (Branch isolation P0 — docs/DESIGN_BRANCH_ISOLATION.md D4)
-- Tables that become branch-owned register themselves here (each phase migration INSERTs its tables).
-- fn_branch_isolation_backfill(tenant) assigns every unbranched row of those tables to the tenant's MAIN
-- branch. It is called when a tenant turns branch isolation ON (and is safe to call again: idempotent).
-- ROLLBACK: DROP FUNCTION IF EXISTS fn_branch_isolation_backfill(uuid); DROP TABLE IF EXISTS branch_isolation_tables;

CREATE TABLE IF NOT EXISTS branch_isolation_tables (
  table_name  TEXT PRIMARY KEY,
  -- column holding the owning branch (default branch_id)
  branch_column TEXT NOT NULL DEFAULT 'branch_id',
  -- column holding the tenant (default tenant_id); child tables without one are not registered
  tenant_column TEXT NOT NULL DEFAULT 'tenant_id',
  note        TEXT
);

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
    -- skip registrations of tables/columns that do not exist (a phase not applied yet)
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
    EXECUTE format(
      'UPDATE public.%I SET %I = $1 WHERE %I = $2 AND %I IS NULL',
      v_rec.table_name, v_rec.branch_column, v_rec.tenant_column, v_rec.branch_column
    ) USING v_main, p_tenant_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN
      v_result := v_result || jsonb_build_object(v_rec.table_name, v_count);
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION fn_branch_isolation_backfill(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_branch_isolation_backfill(uuid) TO service_role;

-- Tables that ALREADY have a nullable branch_id and must be backfilled to the main branch at enabling time
-- (nullable today: audit section 5.1). Registered here so P0 is complete on its own.
INSERT INTO branch_isolation_tables (table_name, note) VALUES
  ('orders', 'POS sales (nullable branch_id)'),
  ('attendance_records', 'check-ins'),
  ('work_schedules', 'schedules'),
  ('loyalty_ledger', 'loyalty movements'),
  ('reward_definitions', 'NULL = all branches today'),
  ('document_assets', 'document builder assets')
ON CONFLICT (table_name) DO NOTHING;
