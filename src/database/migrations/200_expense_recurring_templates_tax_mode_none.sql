-- ============================================================
-- 200: expense_recurring_templates.tax_mode — add 'none'
-- ============================================================
-- STEP 6 FINAL RECURRING TAX MODEL.
--
-- Aligns expense_recurring_templates.tax_mode with the three-value model
-- already applied to expenses_v2 (migration 199) and
-- expense_quick_definitions (migration 198): none | inclusive | exclusive.
-- Recurring Expenses (rent, government fees, subscriptions, etc.) may
-- legitimately carry any of the three, so the New Expenses domain now has
-- one consistent tax model across Normal, Quick, and Recurring.
--
-- Existing rows are all 'inclusive'/'exclusive' already, so no backfill is
-- needed — this only widens the CHECK constraint.
--
-- Forward-only: does not touch Legacy Expenses or any Accounting table.
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'expense_recurring_templates'::regclass
    AND pg_get_constraintdef(oid) ILIKE '%tax_mode%IN%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE expense_recurring_templates DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE expense_recurring_templates
  ADD CONSTRAINT expense_recurring_templates_tax_mode_check
    CHECK (tax_mode IN ('none', 'inclusive', 'exclusive'));
