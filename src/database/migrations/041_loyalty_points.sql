-- Phase 10G — Loyalty Points: earn-on-purchase + redeem-as-discount.
-- Tiers/gift cards/coupons are out of scope for this migration (deferred, see TASKS.md 10G).

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS loyalty_points_per_currency NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS loyalty_redemption_value NUMERIC NOT NULL DEFAULT 0.01;

-- Atomic points adjustment (award = positive delta, redeem = negative delta).
-- Returns the new balance, or no row if the adjustment would take the balance negative
-- (caller treats "no row returned" as insufficient balance).
CREATE OR REPLACE FUNCTION fn_adjust_loyalty_points(
  p_customer_id UUID,
  p_delta NUMERIC
)
RETURNS TABLE (loyalty_points NUMERIC) AS $$
  UPDATE customers
     SET loyalty_points = loyalty_points + p_delta,
         updated_at = now()
   WHERE id = p_customer_id
     AND (loyalty_points + p_delta) >= 0
  RETURNING customers.loyalty_points;
$$ LANGUAGE sql;
