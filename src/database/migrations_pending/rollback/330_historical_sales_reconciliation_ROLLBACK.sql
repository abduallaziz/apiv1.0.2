-- ROLLBACK for 330_historical_sales_reconciliation.sql (exercised locally).
-- Removes the functions and views. It does NOT and CANNOT undo journal entries already posted by the apply
-- function: posted entries are immutable by design; correct them only with the normal reversal function.
-- The append-only audit table is the evidence of what was posted: it is DROPPED ONLY IF EMPTY. If it holds
-- rows it is kept (and a NOTICE says so); export it first if you really intend to remove it, then drop manually.
DROP VIEW IF EXISTS v_historical_sales_reconciliation_run;
DROP VIEW IF EXISTS v_historical_sales_reconciliation;
DROP FUNCTION IF EXISTS fn_apply_historical_sales_reconciliation(UUID[], UUID, TEXT, NUMERIC);
DROP FUNCTION IF EXISTS fn_historical_sales_dry_run(UUID[], UUID, INTEGER);
DROP FUNCTION IF EXISTS fn_historical_sales_preflight(UUID);
DO $$
BEGIN
  IF to_regclass('public.historical_sales_reconciliation_audit') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM historical_sales_reconciliation_audit) THEN
      RAISE NOTICE 'historical_sales_reconciliation_audit holds rows: KEPT (evidence). Drop it manually after export.';
    ELSE
      DROP TABLE historical_sales_reconciliation_audit;
      DROP FUNCTION IF EXISTS fn_hsra_append_only();
    END IF;
  END IF;
END $$;
