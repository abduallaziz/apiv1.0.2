-- =============================================================================
-- 006: Expand orders.payment_method to prepare for future payment methods
-- Context: Phase 10B (multiple payment methods) is deferred, but the data
-- model is widened now so the POS UI / reports can start tagging the actual
-- method used at the physical terminal without a second migration later.
-- 'mada'/'visa'/'mastercard' settle identically to 'card' today (no gateway
-- integration yet — cashier just records which network was used).
-- 'stc_pay'/'apple_pay' settle identically to the existing 'wallet' value.
-- 'tab' is a new deferred-payment tag (open account against a customer) —
-- no credit/AR ledger logic is added here, only the tag itself.
-- =============================================================================

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'orders'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%payment_method%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method IN (
    'cash', 'card', 'split', 'wallet',
    'mada', 'visa', 'mastercard', 'stc_pay', 'apple_pay', 'tab'
  ));
