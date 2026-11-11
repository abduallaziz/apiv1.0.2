-- ============================================================
-- 201: expenses_v2 — recurring behavior as a native Expense property
-- ============================================================
-- OWNER DECISION (Recurring Expenses Final Implementation): the previous
-- `expense_recurring_templates` design is revoked as a user-facing product
-- concept. Recurring Expense = a normal expenses_v2 row with recurring
-- behavior enabled — no separate Template entity.
--
-- `expense_recurring_templates` itself is NOT dropped by this migration
-- (explicit Owner instruction: do not delete it yet) — it becomes dead,
-- unreferenced-by-any-code legacy. `expenses_v2.recurring_template_id`
-- (the old FK to that table) is likewise left in place, untouched, and no
-- longer written to by any code path after this migration's consumers ship.
--
-- New, self-referential recurrence model on expenses_v2 itself:
--   is_recurring          — the Expense's own recurring flag
--   frequency             — only meaningful when is_recurring = true
--   next_occurrence_date  — when the next auto-generated occurrence is due
--   recurring_end_date    — optional; recurrence auto-stops past this date
--   recurring_source_expense_id — set ONLY on generated occurrences,
--     pointing back to the one Expense row that is actually recurring.
--     Self-referential FK (expenses_v2 -> expenses_v2). Generated
--     occurrences are themselves never recurring (is_recurring = false),
--     matching the already-locked "each generated Expense remains
--     independent" rule.
ALTER TABLE expenses_v2
  ADD COLUMN is_recurring BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN frequency TEXT CHECK (frequency IS NULL OR frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  ADD COLUMN next_occurrence_date DATE,
  ADD COLUMN recurring_end_date DATE,
  ADD COLUMN recurring_source_expense_id UUID REFERENCES expenses_v2(id);

-- Pairing guard: recurrence fields only make sense together with the flag.
ALTER TABLE expenses_v2
  ADD CONSTRAINT chk_expenses_v2_recurring_pairing CHECK (
    (is_recurring = false) OR (is_recurring = true AND frequency IS NOT NULL AND next_occurrence_date IS NOT NULL)
  );

CREATE INDEX idx_expenses_v2_recurring_due
  ON expenses_v2 (tenant_id, is_recurring, next_occurrence_date)
  WHERE is_recurring = true;
