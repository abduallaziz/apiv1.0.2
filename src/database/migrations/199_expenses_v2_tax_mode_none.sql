-- ============================================================
-- 199: expenses_v2.tax_mode — add 'none'
-- ============================================================
-- STEP 5 FINAL TAX MODEL CORRECTION (New Expenses / Quick Expense).
--
-- Migration 198 added the three-value tax model ('none' | 'inclusive' |
-- 'exclusive') to expense_quick_definitions only, and the application
-- layer collapsed 'none' into a stored 'exclusive' + tax_amount = 0 on
-- expenses_v2 to avoid a schema change. The Owner rejected that semantic
-- collapse — expenses_v2.tax_mode itself must carry the real three-value
-- model, matching Quick Definitions exactly.
--
-- Existing rows are all 'inclusive'/'exclusive' already (no prior 'none'
-- value could have existed), so no data backfill is needed — this only
-- widens the CHECK constraint.
--
-- Forward-only: does not touch Legacy Expenses (`expenses`,
-- `expense_categories`) or any Accounting table.
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'expenses_v2'::regclass
    AND pg_get_constraintdef(oid) ILIKE '%tax_mode%IN%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE expenses_v2 DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE expenses_v2
  ADD CONSTRAINT expenses_v2_tax_mode_check
    CHECK (tax_mode IN ('none', 'inclusive', 'exclusive'));
