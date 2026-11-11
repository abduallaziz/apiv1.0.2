-- 267_reward_instance_balance.sql   (verified on a local Postgres: partial consume, over-use rejected, restore, idempotency)
-- Fixed-amount rewards keep a balance: a 20 SAR reward used on a 5.75 sale consumes 5.75 and
-- keeps 14.25 for the next sale (status stays 'unlocked' until the balance reaches 0).
-- Other reward types (percentage, coupon, free item) stay single-use (fn_redeem_reward_instances).
--
--  * customer_reward_instances.remaining_amount: NULL means "full amount of the definition"
--    (lazily initialised on first use), so existing/new instances need no backfill.
--  * reward_instance_redemptions: one row per consumption (audit + undo + idempotency).
--  * fn_consume_reward_balance / fn_attach_reward_consumption_order / fn_restore_reward_balance.
-- New table checklist: tenant_id, deleted_at, RLS policy, service_role GRANT.
-- ROLLBACK: DROP the three functions and the table; ALTER TABLE ... DROP COLUMN remaining_amount.

ALTER TABLE customer_reward_instances
  ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(12,2)
  CHECK (remaining_amount IS NULL OR remaining_amount >= 0);

CREATE TABLE IF NOT EXISTS reward_instance_redemptions (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_id     UUID          NOT NULL REFERENCES customer_reward_instances(id),
  customer_id     UUID          NOT NULL REFERENCES customers(id),
  branch_id       UUID          REFERENCES branches(id),
  order_id        UUID          REFERENCES orders(id),
  sale_attempt_id UUID,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  reversed_at     TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reward_redemptions_instance ON reward_instance_redemptions (instance_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_order ON reward_instance_redemptions (order_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reward_redemption_attempt
  ON reward_instance_redemptions (instance_id, sale_attempt_id)
  WHERE sale_attempt_id IS NOT NULL AND reversed_at IS NULL;

ALTER TABLE reward_instance_redemptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_session_isolation ON reward_instance_redemptions;
CREATE POLICY tenant_session_isolation ON reward_instance_redemptions
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.reward_instance_redemptions TO service_role;

-- Consume part (or all) of a fixed_discount instance, atomically.
CREATE OR REPLACE FUNCTION fn_consume_reward_balance(
  p_tenant_id       UUID,
  p_customer_id     UUID,
  p_branch_id       UUID,
  p_instance_id     UUID,
  p_amount          NUMERIC,
  p_sale_attempt_id UUID DEFAULT NULL
)
RETURNS TABLE (redemption_id UUID, remaining_amount NUMERIC, fully_redeemed BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE
  v_inst       customer_reward_instances%ROWTYPE;
  v_type       TEXT;
  v_cfg        JSONB;
  v_scope      TEXT;
  v_def_branch UUID;
  v_remaining  NUMERIC(12,2);
  v_new        NUMERIC(12,2);
  v_red_id     UUID;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Reward amount to consume must be positive';
  END IF;

  SELECT * INTO v_inst FROM customer_reward_instances WHERE id = p_instance_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reward instance % not found', p_instance_id;
  END IF;
  IF v_inst.tenant_id <> p_tenant_id OR v_inst.customer_id <> p_customer_id THEN
    RAISE EXCEPTION 'Reward instance % does not belong to this customer', p_instance_id;
  END IF;
  IF v_inst.status <> 'unlocked' THEN
    RAISE EXCEPTION 'Reward instance % is not available to redeem (status: %)', p_instance_id, v_inst.status;
  END IF;
  IF v_inst.expires_at IS NOT NULL AND v_inst.expires_at <= now() THEN
    RAISE EXCEPTION 'Reward instance % has expired', p_instance_id;
  END IF;

  SELECT rd.reward_type, rd.reward_config, rd.branch_scope, rd.branch_id
    INTO v_type, v_cfg, v_scope, v_def_branch
    FROM reward_definitions rd WHERE rd.id = v_inst.reward_definition_id;
  IF v_type <> 'fixed_discount' THEN
    RAISE EXCEPTION 'Reward instance % is not a fixed-amount reward', p_instance_id;
  END IF;
  IF v_scope = 'specific' AND v_def_branch IS DISTINCT FROM p_branch_id THEN
    RAISE EXCEPTION 'Reward instance % is not valid at this branch', p_instance_id;
  END IF;

  v_remaining := COALESCE(v_inst.remaining_amount, (v_cfg ->> 'amount')::NUMERIC);
  IF p_amount > v_remaining + 0.005 THEN
    RAISE EXCEPTION 'Reward instance % has only % remaining (requested %)', p_instance_id, v_remaining, p_amount;
  END IF;

  v_new := GREATEST(round(v_remaining - p_amount, 2), 0);

  UPDATE customer_reward_instances
     SET remaining_amount   = v_new,
         status             = CASE WHEN v_new <= 0 THEN 'redeemed' ELSE 'unlocked' END,
         redeemed_at        = CASE WHEN v_new <= 0 THEN now() ELSE redeemed_at END,
         redeemed_branch_id = CASE WHEN v_new <= 0 THEN p_branch_id ELSE redeemed_branch_id END
   WHERE id = p_instance_id;

  INSERT INTO reward_instance_redemptions
    (tenant_id, instance_id, customer_id, branch_id, sale_attempt_id, amount)
  VALUES (p_tenant_id, p_instance_id, p_customer_id, p_branch_id, p_sale_attempt_id, round(p_amount, 2))
  RETURNING id INTO v_red_id;

  RETURN QUERY SELECT v_red_id, v_new, (v_new <= 0);
END;
$$;

-- Best-effort linkage once the order exists.
CREATE OR REPLACE FUNCTION fn_attach_reward_consumption_order(p_redemption_ids UUID[], p_order_id UUID)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE reward_instance_redemptions
     SET order_id = p_order_id
   WHERE id = ANY(p_redemption_ids) AND order_id IS NULL;
$$;

-- Undo of one consumption (sale failed after the reward was consumed). Idempotent.
CREATE OR REPLACE FUNCTION fn_restore_reward_balance(p_tenant_id UUID, p_redemption_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_red reward_instance_redemptions%ROWTYPE;
BEGIN
  SELECT * INTO v_red FROM reward_instance_redemptions
   WHERE id = p_redemption_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND OR v_red.reversed_at IS NOT NULL OR v_red.order_id IS NOT NULL THEN
    RETURN FALSE;  -- unknown, already undone, or already tied to a completed sale
  END IF;

  UPDATE customer_reward_instances
     SET remaining_amount   = COALESCE(remaining_amount, 0) + v_red.amount,
         status             = 'unlocked',
         redeemed_at        = NULL,
         redeemed_branch_id = NULL
   WHERE id = v_red.instance_id;

  UPDATE reward_instance_redemptions SET reversed_at = now() WHERE id = p_redemption_id;
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_consume_reward_balance(UUID, UUID, UUID, UUID, NUMERIC, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION fn_attach_reward_consumption_order(UUID[], UUID) TO service_role;
GRANT EXECUTE ON FUNCTION fn_restore_reward_balance(UUID, UUID) TO service_role;
