-- 307_branch_isolation_rebackfill_enabled_tenants.sql  (branch isolation — after phases 281..306 registered their tables)
-- A tenant may have turned isolation ON before the later migrations added branch_id to more tables
-- (items, customers, coupons, expenses lookups, suppliers, ...). Those new rows are unbranched, so they would
-- vanish from every branch view. Re-run the (idempotent) backfills for every tenant that has isolation enabled.
-- Failures are logged as warnings and never block the boot (an owner can re-enable isolation to retry).
-- ROLLBACK: nothing to undo (it only assigns unbranched rows to the main branch).

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT id FROM tenants WHERE branch_isolation_enabled = true
  LOOP
    BEGIN
      IF to_regprocedure('fn_branch_isolation_backfill_hr(uuid)') IS NOT NULL THEN
        PERFORM fn_branch_isolation_backfill_hr(t.id);
      END IF;
      PERFORM fn_branch_isolation_backfill(t.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'branch isolation re-backfill failed for tenant %: %', t.id, SQLERRM;
    END;
  END LOOP;
END $$;
