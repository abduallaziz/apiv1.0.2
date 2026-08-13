-- 185 — Remove Gift Cards feature entirely (product decision, 2026-08-11)
-- Approved: "Approved – Proceed with Implementation". Feature was built as
-- part of the original Phase 10G scope (TASKS.md) but the owner decided,
-- after the Accounting Foundation (M176-M184) investigation surfaced an
-- unresolved historical-liability question with no clean answer, to remove
-- the feature entirely rather than carry the accounting complexity forward.
--
-- Scope, exactly as approved (Option B — full removal, no trace):
--   - Drop gift_cards table entirely (9 rows, 5 active, historical balance
--     247,264.2 — all discarded intentionally per explicit approval).
--   - Drop orders.gift_card_code / orders.gift_card_amount columns,
--     including the 3 real completed orders that referenced them
--     (SSSS/SSS1 redemption history — discarded intentionally, not
--     preserved, per explicit "Option B" approval).
--   - Remove 'gift_card' from orders.payment_method's allowed values.
--   - Drop fn_redeem_gift_card (only consumer was the now-removed module).
--   - Remove the gift_cards.manage permission and its role grants.
--
-- Not affected: loyalty_tiers, coupons, customer_field_definitions (083's
-- other tables) — untouched, this migration only removes gift_cards.

DROP FUNCTION IF EXISTS fn_redeem_gift_card(UUID, NUMERIC);

DROP TABLE IF EXISTS gift_cards;

-- 'gift_card' is being removed from the allowed payment_method values below;
-- any historical order stored with that value must be reassigned first or
-- the new CHECK constraint will reject it. 'cash' is the neutral fallback —
-- these were orders where no external payment method was ever actually
-- involved (the gift card covered the total), so there is no more accurate
-- real value to substitute; this is a mechanical constraint fix, not a new
-- accounting claim about how the sale was funded.
UPDATE orders SET payment_method = 'cash' WHERE payment_method = 'gift_card';

ALTER TABLE orders DROP COLUMN IF EXISTS gift_card_code;
ALTER TABLE orders DROP COLUMN IF EXISTS gift_card_amount;

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

-- role_permissions.permission_key REFERENCES permissions(name) ON DELETE CASCADE
-- (migration 001) — deleting the permission row cascades automatically.
DELETE FROM permissions WHERE name = 'gift_cards.manage';

-- Rollback (documented, not auto-executed — data (gift_cards rows, the two
-- orders columns and their 3 historical values) is NOT recoverable from a
-- rollback of this migration; it must come from a database backup):
-- ALTER TABLE orders DROP CONSTRAINT orders_payment_method_check;
-- ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check
--   CHECK (payment_method IN ('cash','card','split','wallet','mada','visa','mastercard','stc_pay','apple_pay','tab','gift_card'));
-- ALTER TABLE orders ADD COLUMN gift_card_code TEXT;
-- ALTER TABLE orders ADD COLUMN gift_card_amount NUMERIC;
-- (gift_cards table and fn_redeem_gift_card would need to be recreated from migration 070)
