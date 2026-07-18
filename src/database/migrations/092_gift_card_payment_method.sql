-- =============================================================================
-- 092: Add 'gift_card' as a real orders.payment_method value
-- Context: an order fully covered by a gift card (amountDueAfterGiftCard <= 0
-- in InvoicesService.create) currently still stores whatever payment_method
-- the frontend happened to have selected (defaults to 'cash') — misleading,
-- since no cash/card/etc. ever actually changed hands. This adds a real,
-- honest tag for that case instead of a placeholder value, matching the
-- expand-payment-methods pattern from migration 006.
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
    'mada', 'visa', 'mastercard', 'stc_pay', 'apple_pay', 'tab',
    'gift_card'
  ));
