-- Customer Domain Batch 3 Phase 9 (Owner-approved) — atomic, idempotent
-- purchase-count reward evaluation. One call per qualifying order; safe to
-- call twice for the same order (API retry, duplicate request, retried
-- transaction) because the INSERT into reward_progress_events is the
-- dedup gate — a repeat call hits the UNIQUE(tenant_id, reward_definition_id,
-- order_id) index, inserts nothing, and the function returns zero rows
-- without touching customer_reward_instances at all.
--
-- Deliberately does NOT touch loyalty_ledger or customers.loyalty_points —
-- purchase-count rewards are fully independent of Loyalty, per the
-- Critical Requirement ("Buy 5 times -> 6th item free WITHOUT Loyalty
-- points").
CREATE OR REPLACE FUNCTION fn_process_purchase_reward_event(
  p_tenant_id            UUID,
  p_customer_id          UUID,
  p_reward_definition_id UUID,
  p_order_id             UUID,
  p_branch_id            UUID DEFAULT NULL
)
RETURNS TABLE (
  instance_id      UUID,
  instance_ordinal INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id     UUID;
  v_progress     INTEGER;
  v_threshold    INTEGER;
  v_expiration   INTEGER;
  v_expires_at   TIMESTAMPTZ;
  v_new_id       UUID;
  v_new_ordinal  INTEGER;
BEGIN
  -- Idempotency gate: only a genuinely new (definition, order) pair proceeds.
  INSERT INTO reward_progress_events (tenant_id, customer_id, reward_definition_id, order_id)
  VALUES (p_tenant_id, p_customer_id, p_reward_definition_id, p_order_id)
  ON CONFLICT (tenant_id, reward_definition_id, order_id) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RETURN;
  END IF;

  SELECT rd.trigger_config->>'count', rd.expiration_days
    INTO v_threshold, v_expiration
    FROM reward_definitions rd
   WHERE rd.id = p_reward_definition_id
     AND rd.tenant_id = p_tenant_id
     AND rd.is_active = true
     AND rd.deleted_at IS NULL
     AND rd.trigger_type = 'purchase_count';

  IF v_threshold IS NULL OR v_threshold <= 0 THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_progress
    FROM reward_progress_events rpe
   WHERE rpe.tenant_id = p_tenant_id
     AND rpe.customer_id = p_customer_id
     AND rpe.reward_definition_id = p_reward_definition_id;

  IF v_progress % v_threshold != 0 THEN
    RETURN;
  END IF;

  v_new_ordinal := v_progress / v_threshold;
  v_expires_at := CASE WHEN v_expiration IS NOT NULL THEN now() + (v_expiration || ' days')::interval ELSE NULL END;

  INSERT INTO customer_reward_instances (
    tenant_id, customer_id, reward_definition_id, status,
    unlocked_branch_id, instance_ordinal, unlocked_at, expires_at
  )
  VALUES (
    p_tenant_id, p_customer_id, p_reward_definition_id, 'unlocked',
    p_branch_id, v_new_ordinal, now(), v_expires_at
  )
  ON CONFLICT (tenant_id, reward_definition_id, customer_id, instance_ordinal) DO NOTHING
  RETURNING customer_reward_instances.id, customer_reward_instances.instance_ordinal
    INTO v_new_id, v_new_ordinal;

  IF v_new_id IS NOT NULL THEN
    RETURN QUERY SELECT v_new_id, v_new_ordinal;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_process_purchase_reward_event(UUID, UUID, UUID, UUID, UUID) TO service_role;
