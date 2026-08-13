-- 188 — Split Payment Persistence (Migration Matrix item #2, approved 2026-08-11)
-- "APPROVED – Proceed with M188 ONLY". Goal: persist the real cash/card
-- breakdown of a split payment so a future accounting/shift-reconciliation
-- migration can consume it. Scope, exactly as approved: orders columns +
-- their integrity constraints only. Does NOT touch M182/M184, accounting
-- posting, TAB, loyalty, dine-in, cancel/reversal, or ShiftEngine.
--
-- Nullability decision (ambiguous per the task, resolved conservatively):
-- cash_amount/card_amount are populated ONLY for payment_method='split'.
-- Every other payment method (cash/card/wallet/mada/.../tab) stores NULL
-- for both — mirroring an order's own `total` into these columns for
-- non-split methods was not requested and would be a semantic expansion
-- beyond "persist the split breakdown", so it is deliberately not done
-- here. A future ShiftEngine/accounting migration that wants a uniform
-- per-method breakdown is a separate, later decision.
--
-- Historical-row safety: 9 existing completed orders already carry
-- payment_method='split' with no breakdown (the concept didn't exist when
-- they were created) — same situation M187 hit with sale_attempt_id, but
-- these columns are nullable, so no backfill/fabrication is technically
-- required at all. The reconciliation CHECK below is deliberately written
-- to hold trivially for NULL/NULL (never fabricates a breakdown for these
-- 9 rows), while still fully enforcing correctness for every future split
-- order (both must be present together, non-negative, and reconcile
-- exactly with `total`).
ALTER TABLE orders ADD COLUMN cash_amount NUMERIC(10,2);
ALTER TABLE orders ADD COLUMN card_amount NUMERIC(10,2);

ALTER TABLE orders ADD CONSTRAINT chk_orders_cash_amount_non_negative
  CHECK (cash_amount IS NULL OR cash_amount >= 0);

ALTER TABLE orders ADD CONSTRAINT chk_orders_card_amount_non_negative
  CHECK (card_amount IS NULL OR card_amount >= 0);

-- Non-split orders never carry a breakdown — holds trivially for all 152
-- existing rows (all currently NULL/NULL regardless of payment_method).
ALTER TABLE orders ADD CONSTRAINT chk_orders_split_amounts_only_for_split
  CHECK (payment_method = 'split' OR (cash_amount IS NULL AND card_amount IS NULL));

-- When a breakdown IS present, both components must be present together
-- (never just one) and must reconcile EXACTLY with `total` — no
-- overpayment, no underpayment. Deliberately does NOT require split orders
-- to have a breakdown (holds for NULL/NULL too), so the 9 historical split
-- orders remain valid with zero fabricated data; every order created after
-- this migration with payment_method='split' will always satisfy the
-- non-NULL branch, enforced by the application (invoices.service.ts).
ALTER TABLE orders ADD CONSTRAINT chk_orders_split_amounts_reconcile
  CHECK (
    (cash_amount IS NULL AND card_amount IS NULL)
    OR (cash_amount IS NOT NULL AND card_amount IS NOT NULL AND cash_amount + card_amount = total)
  );

-- Rollback (documented, not auto-executed):
-- ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_split_amounts_reconcile;
-- ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_split_amounts_only_for_split;
-- ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_card_amount_non_negative;
-- ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_cash_amount_non_negative;
-- ALTER TABLE orders DROP COLUMN IF EXISTS card_amount;
-- ALTER TABLE orders DROP COLUMN IF EXISTS cash_amount;
