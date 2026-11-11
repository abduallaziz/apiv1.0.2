-- Customer Domain Phase 6 (Owner-approved) — fn_adjust_loyalty_points gains
-- ledger-writing behavior, atomically, in the same function call that
-- already mutates customers.loyalty_points/lifetime_points_earned.
--
-- Current signature (migration 069): fn_adjust_loyalty_points(p_customer_id
-- UUID, p_delta NUMERIC) RETURNS TABLE(loyalty_points NUMERIC,
-- lifetime_points_earned NUMERIC), LANGUAGE sql, a single guarded UPDATE.
-- That signature/return shape is fully replaced here — DROP + CREATE, not
-- CREATE OR REPLACE, since the parameter list changes (matches the exact
-- precedent migration 069 itself set when it did the same thing to
-- migration 041's original version). All 4 production callers
-- (LoyaltyService.awardPoints/redeemPoints/awardPointsPooled/
-- redeemPointsPooled) are updated to the new signature in this same
-- change — no caller is left on the old signature.
--
-- Deliberately still takes no p_tenant_id: this preserves the exact
-- existing security model documented in LoyaltyService — the ONLY thing
-- that has ever stopped a cashier from mutating another tenant's
-- customer's balance is the separate assertCustomerInTenant check that
-- runs before this function is called, which stays unchanged. tenant_id
-- for the new loyalty_ledger row is instead read directly off the same
-- customers row this function already locks/updates (via the UPDATE's own
-- RETURNING), never a second, independently-trusted parameter.
--
-- No Customer Scope / Loyalty Scope / branch-transfer logic lives here —
-- this function only ever records the context it's given (p_branch_id,
-- p_order_id) and applies the same insufficient-balance guard the old
-- version already had. Whether a SHARED or BRANCH tenant's redemption
-- request is actually valid for the requested branch is decided entirely
-- in the application layer (LoyaltyService) before this function is ever
-- called.
DROP FUNCTION IF EXISTS fn_adjust_loyalty_points(UUID, NUMERIC);

CREATE FUNCTION fn_adjust_loyalty_points(
  p_customer_id UUID,
  p_delta        NUMERIC,
  p_type         TEXT,
  p_branch_id    UUID DEFAULT NULL,
  p_order_id     UUID DEFAULT NULL,
  p_created_by   UUID DEFAULT NULL
)
RETURNS TABLE (loyalty_points NUMERIC, lifetime_points_earned NUMERIC)
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_id               UUID;
  v_loyalty_points          NUMERIC;
  v_lifetime_points_earned  NUMERIC;
BEGIN
  IF p_type NOT IN ('earn', 'redeem', 'adjustment') THEN
    RAISE EXCEPTION 'Invalid loyalty ledger type: %', p_type;
  END IF;

  -- Same guarded UPDATE as before (migration 069): 0 matched rows means
  -- either the customer doesn't exist or the balance would go negative —
  -- both cases correctly fall through to the empty-result-set path below,
  -- exactly matching the old function's caller-visible behavior.
  UPDATE customers
     SET loyalty_points = loyalty_points + p_delta,
         lifetime_points_earned = lifetime_points_earned + GREATEST(p_delta, 0),
         updated_at = now()
   WHERE id = p_customer_id
     AND (loyalty_points + p_delta) >= 0
  RETURNING customers.tenant_id, customers.loyalty_points, customers.lifetime_points_earned
    INTO v_tenant_id, v_loyalty_points, v_lifetime_points_earned;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Same transaction as the UPDATE above — if this INSERT fails for any
  -- reason (FK violation, etc.), the exception propagates and Postgres
  -- automatically rolls back the customers UPDATE too. No half-written
  -- state is possible.
  INSERT INTO loyalty_ledger (
    tenant_id, customer_id, branch_id, order_id, type, delta, created_by
  ) VALUES (
    v_tenant_id, p_customer_id, p_branch_id, p_order_id, p_type, p_delta, p_created_by
  );

  RETURN QUERY SELECT v_loyalty_points, v_lifetime_points_earned;
END;
$$;

-- Rollback (documented, not auto-executed):
-- DROP FUNCTION IF EXISTS fn_adjust_loyalty_points(UUID, NUMERIC, TEXT, UUID, UUID, UUID);
-- CREATE FUNCTION fn_adjust_loyalty_points(p_customer_id UUID, p_delta NUMERIC)
-- RETURNS TABLE (loyalty_points NUMERIC, lifetime_points_earned NUMERIC) AS $$
--   UPDATE customers
--      SET loyalty_points = loyalty_points + p_delta,
--          lifetime_points_earned = lifetime_points_earned + GREATEST(p_delta, 0),
--          updated_at = now()
--    WHERE id = p_customer_id
--      AND (loyalty_points + p_delta) >= 0
--   RETURNING customers.loyalty_points, customers.lifetime_points_earned;
-- $$ LANGUAGE sql;
