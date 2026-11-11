-- 260_loyalty_refund_path.sql   (PENDING — not applied, not yet verified on a database)
-- P1: give redeemed loyalty points a correct way back when a sale fails after redemption,
-- WITHOUT inflating customers.lifetime_points_earned (fn_adjust_loyalty_points adds every positive
-- delta to it, so a plain +adjustment would corrupt tier statistics).
-- Redemption becomes idempotent per sale attempt; refund happens at most once per attempt.
-- New function names (no overload of fn_adjust_loyalty_points). Reward-instance rollback is NOT
-- part of this migration (owner decision D5).

-- 1) allow a 'refund' ledger type (drop whatever CHECK currently constrains type, re-add widened)
DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.loyalty_ledger'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE public.loyalty_ledger DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE loyalty_ledger
  ADD CONSTRAINT loyalty_ledger_type_check
  CHECK (type IN ('earn', 'redeem', 'adjustment', 'refund'));

ALTER TABLE loyalty_ledger ADD COLUMN IF NOT EXISTS sale_attempt_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_redeem_attempt
  ON loyalty_ledger (tenant_id, sale_attempt_id)
  WHERE type = 'redeem' AND sale_attempt_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_refund_attempt
  ON loyalty_ledger (tenant_id, sale_attempt_id)
  WHERE type = 'refund' AND sale_attempt_id IS NOT NULL;

-- 2) redeem, keyed by sale attempt (same balance rule as fn_adjust_loyalty_points: never negative)
CREATE OR REPLACE FUNCTION fn_redeem_loyalty_points(
  p_customer_id     UUID,
  p_points          NUMERIC,
  p_sale_attempt_id UUID,
  p_branch_id       UUID DEFAULT NULL,
  p_created_by      UUID DEFAULT NULL
)
RETURNS TABLE (loyalty_points NUMERIC)
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_id UUID;
  v_balance   NUMERIC;
BEGIN
  IF p_points IS NULL OR p_points <= 0 THEN
    RAISE EXCEPTION 'p_points must be positive';
  END IF;

  UPDATE customers c
     SET loyalty_points = c.loyalty_points - p_points,
         updated_at = now()
   WHERE c.id = p_customer_id
     AND c.loyalty_points >= p_points
  RETURNING c.tenant_id, c.loyalty_points INTO v_tenant_id, v_balance;

  IF NOT FOUND THEN
    RETURN;  -- insufficient balance / unknown customer
  END IF;

  INSERT INTO loyalty_ledger (tenant_id, customer_id, branch_id, type, delta, created_by, sale_attempt_id)
  VALUES (v_tenant_id, p_customer_id, p_branch_id, 'redeem', -p_points, p_created_by, p_sale_attempt_id);
  -- a repeated attempt id raises unique_violation (uq_loyalty_redeem_attempt) and rolls the UPDATE back

  RETURN QUERY SELECT v_balance;
END;
$$;

-- 3) refund exactly what that attempt redeemed, once; lifetime_points_earned untouched
CREATE OR REPLACE FUNCTION fn_refund_loyalty_points(
  p_customer_id     UUID,
  p_sale_attempt_id UUID,
  p_branch_id       UUID DEFAULT NULL,
  p_created_by      UUID DEFAULT NULL
)
RETURNS TABLE (loyalty_points NUMERIC)
LANGUAGE plpgsql
AS $$
DECLARE
  v_redeem  loyalty_ledger%ROWTYPE;
  v_rows    INT;
  v_balance NUMERIC;
BEGIN
  SELECT * INTO v_redeem
    FROM loyalty_ledger
   WHERE customer_id = p_customer_id
     AND sale_attempt_id = p_sale_attempt_id
     AND type = 'redeem'
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;  -- nothing was redeemed under this attempt
  END IF;

  INSERT INTO loyalty_ledger (tenant_id, customer_id, branch_id, type, delta, created_by, sale_attempt_id)
  VALUES (v_redeem.tenant_id, p_customer_id, COALESCE(p_branch_id, v_redeem.branch_id),
          'refund', -v_redeem.delta, p_created_by, p_sale_attempt_id)
  ON CONFLICT (tenant_id, sale_attempt_id) WHERE type = 'refund' AND sale_attempt_id IS NOT NULL
  DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN;  -- already refunded
  END IF;

  UPDATE customers c
     SET loyalty_points = c.loyalty_points + (-v_redeem.delta),
         updated_at = now()
   WHERE c.id = p_customer_id
  RETURNING c.loyalty_points INTO v_balance;

  RETURN QUERY SELECT v_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_redeem_loyalty_points(UUID, NUMERIC, UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION fn_refund_loyalty_points(UUID, UUID, UUID, UUID) TO service_role;

-- ROLLBACK (manual; the CHECK can only be narrowed if no 'refund' rows exist):
--   DROP FUNCTION IF EXISTS fn_refund_loyalty_points(UUID, UUID, UUID, UUID);
--   DROP FUNCTION IF EXISTS fn_redeem_loyalty_points(UUID, NUMERIC, UUID, UUID, UUID);
--   DROP INDEX IF EXISTS uq_loyalty_redeem_attempt, uq_loyalty_refund_attempt;
--   -- then re-create the 3-value CHECK and DROP COLUMN sale_attempt_id
