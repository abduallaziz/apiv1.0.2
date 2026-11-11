-- ============================================================
-- 198: expense_quick_definitions.tax_mode
-- ============================================================
-- STEP 5 TAX MODE CORRECTION (New Expenses / Quick Expense).
--
-- The original Step 5 implementation reused expenses_v2's two-value
-- tax_mode ('inclusive' | 'exclusive') for Quick Expense, defaulting every
-- Quick-created Expense to 'exclusive' with no way to configure it. The
-- Owner's correction adds a third mode ('none' — no tax at all) and moves
-- tax_mode onto the Quick Definition itself, configured by Admin at
-- definition-authoring time, never selected by the cashier/caller.
--
-- Existing rows default to 'exclusive' to preserve current behavior
-- exactly (matches the hardcoded default the Step 5 service was already
-- using before this correction).
ALTER TABLE expense_quick_definitions
  ADD COLUMN tax_mode TEXT NOT NULL DEFAULT 'exclusive'
    CHECK (tax_mode IN ('none', 'inclusive', 'exclusive'));
