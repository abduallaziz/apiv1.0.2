-- Expense Date (Owner-approved final implementation): expenses_v2 gains a
-- real expense_date column representing when the Expense actually happened,
-- fully independent of created_at (record entry timestamp, untouched) and
-- updated_at (last modification, untouched). DEFAULT CURRENT_DATE backfills
-- every existing row safely with no data loss.
ALTER TABLE expenses_v2
  ADD COLUMN expense_date DATE NOT NULL DEFAULT CURRENT_DATE;

CREATE INDEX idx_expenses_v2_tenant_expense_date ON expenses_v2 (tenant_id, expense_date);
