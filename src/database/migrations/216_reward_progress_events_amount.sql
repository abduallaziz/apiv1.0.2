-- Customer Domain Batch 3 Phase 12 (Owner-approved) — generalizes the
-- purchase-count progress ledger (211) to also support spend_threshold
-- (SUM(amount) instead of COUNT(*)). Purely additive: existing
-- purchase_count rows are unaffected (amount defaults to 1, so
-- SUM(amount) === COUNT(*) for them).
ALTER TABLE reward_progress_events
  ADD COLUMN amount NUMERIC NOT NULL DEFAULT 1;

-- fn_process_purchase_reward_event (213) reads progress via COUNT(*);
-- switching it to SUM(amount) is behaviorally identical for purchase_count
-- (every existing/future row has amount=1) and lets the exact same
-- function serve product_category definitions too (the eligibility
-- service pre-filters by category match before calling it — the function
-- itself doesn't need to know about categories, only "a qualifying event
-- happened").
CREATE OR REPLACE FUNCTION fn_process_purchase_reward_event(
  p_tenant_id            UUID,
  p_customer_id          UUID,
  p_reward_definition_id UUID,
  p_order_id             UUID,
  p_branch_id            UUID DEFAULT NULL
)
RETURNS TABLE (
  out_instance_id      UUID,
  out_instance_ordinal INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id     UUID;
  v_progress     NUMERIC;
  v_threshold    NUMERIC;
  v_expiration   INTEGER;
  v_expires_at   TIMESTAMPTZ;
  v_new_id       UUID;
  v_new_ordinal  INTEGER;
BEGIN
  INSERT INTO reward_progress_events (tenant_id, customer_id, reward_definition_id, order_id, amount)
  VALUES (p_tenant_id, p_customer_id, p_reward_definition_id, p_order_id, 1)
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
     AND rd.trigger_type IN ('purchase_count', 'product_category');

  IF v_threshold IS NULL OR v_threshold <= 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(rpe.amount), 0) INTO v_progress
    FROM reward_progress_events rpe
   WHERE rpe.tenant_id = p_tenant_id
     AND rpe.customer_id = p_customer_id
     AND rpe.reward_definition_id = p_reward_definition_id;

  IF MOD(v_progress, v_threshold) != 0 THEN
    RETURN;
  END IF;

  v_new_ordinal := (v_progress / v_threshold)::INTEGER;
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
