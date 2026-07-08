-- Phase 10G — Loyalty Tiers. Builds on the loyalty points core (migration 041,
-- STATUS.md §60). A tier is a bonus-points-multiplier bracket a customer
-- unlocks by lifetime points earned — not by their current spendable
-- balance, which goes DOWN on redemption and would make tiers flicker on
-- and off every time a customer redeems. `lifetime_points_earned` tracks the
-- cumulative total separately and only ever increases.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS lifetime_points_earned NUMERIC NOT NULL DEFAULT 0;

-- Best-effort backfill: current balance is the closest proxy we have for
-- pre-existing customers (redemption/tiers didn't exist before today, so for
-- any customer who never redeemed, balance IS their lifetime total anyway).
UPDATE customers SET lifetime_points_earned = loyalty_points WHERE loyalty_points > 0;

CREATE TABLE loyalty_tiers (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name               TEXT        NOT NULL,
  min_lifetime_points NUMERIC    NOT NULL DEFAULT 0 CHECK (min_lifetime_points >= 0),
  points_multiplier  NUMERIC     NOT NULL DEFAULT 1 CHECK (points_multiplier > 0),
  sort_order         INTEGER     NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_loyalty_tiers_tenant_name_unique
  ON loyalty_tiers (tenant_id, name) WHERE deleted_at IS NULL;
CREATE INDEX idx_loyalty_tiers_tenant_threshold
  ON loyalty_tiers (tenant_id, min_lifetime_points) WHERE deleted_at IS NULL;

-- A customer's tier is deliberately NOT a stored FK on customers — it's a
-- pure function of lifetime_points_earned vs. the tenant's configured tier
-- thresholds, resolved on demand. Storing it would need a background job to
-- keep it in sync every time either the customer's points or the tenant's
-- tier definitions change; computing it avoids that entire class of drift.

-- Extends fn_adjust_loyalty_points (migration 041) to also track the
-- lifetime total. GREATEST(p_delta, 0) means only earning (positive delta)
-- grows it — redeeming (negative delta) leaves it untouched, which is the
-- whole point of tracking it separately from the spendable balance.
DROP FUNCTION IF EXISTS fn_adjust_loyalty_points(UUID, NUMERIC);

CREATE FUNCTION fn_adjust_loyalty_points(
  p_customer_id UUID,
  p_delta NUMERIC
)
RETURNS TABLE (loyalty_points NUMERIC, lifetime_points_earned NUMERIC) AS $$
  UPDATE customers
     SET loyalty_points = loyalty_points + p_delta,
         lifetime_points_earned = lifetime_points_earned + GREATEST(p_delta, 0),
         updated_at = now()
   WHERE id = p_customer_id
     AND (loyalty_points + p_delta) >= 0
  RETURNING customers.loyalty_points, customers.lifetime_points_earned;
$$ LANGUAGE sql;

GRANT ALL PRIVILEGES ON public.loyalty_tiers TO service_role;
