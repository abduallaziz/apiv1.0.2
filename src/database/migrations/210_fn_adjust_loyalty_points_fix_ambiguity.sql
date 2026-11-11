-- Customer Domain Phase 6 fix (Owner-approved) — 209's function body had a
-- genuine bug: RETURNS TABLE (loyalty_points NUMERIC, lifetime_points_earned
-- NUMERIC) implicitly declares OUT parameters with those exact names, which
-- collide with the customers.loyalty_points/customers.lifetime_points_earned
-- column names referenced (unqualified) inside the function body — Postgres
-- error 42702 "column reference is ambiguous" on every call. Caught by
-- direct RPC testing against the live database before any application code
-- exercised this function. Fixed by fully qualifying every column reference
-- inside the function body with the customers table alias; no behavioral
-- change from what 209 intended, purely a naming-collision fix.
CREATE OR REPLACE FUNCTION fn_adjust_loyalty_points(
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

  UPDATE customers c
     SET loyalty_points = c.loyalty_points + p_delta,
         lifetime_points_earned = c.lifetime_points_earned + GREATEST(p_delta, 0),
         updated_at = now()
   WHERE c.id = p_customer_id
     AND (c.loyalty_points + p_delta) >= 0
  RETURNING c.tenant_id, c.loyalty_points, c.lifetime_points_earned
    INTO v_tenant_id, v_loyalty_points, v_lifetime_points_earned;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO loyalty_ledger (
    tenant_id, customer_id, branch_id, order_id, type, delta, created_by
  ) VALUES (
    v_tenant_id, p_customer_id, p_branch_id, p_order_id, p_type, p_delta, p_created_by
  );

  RETURN QUERY SELECT v_loyalty_points, v_lifetime_points_earned;
END;
$$;
