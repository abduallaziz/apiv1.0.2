-- Customer Domain Batch 3 Phase 12 (Owner-approved) — spend_threshold
-- trigger evaluation. Same idempotent/atomic shape as
-- fn_process_purchase_reward_event (213/216), but accumulates
-- SUM(order total) instead of a per-order count, and reads
-- trigger_config->>'amount' (the spend threshold) instead of 'count'.
--
-- Unlike purchase_count (always +1 per order, lands exactly on multiples),
-- cumulative spend can jump past several thresholds within a single order
-- (e.g. progress 480 -> 1620 against a 500 threshold crosses 3 multiples
-- at once) — this loops and creates every newly-crossed ordinal, not just
-- the final one, mirroring the "27 purchases -> 5 instances" accumulation
-- guarantee for the count-based trigger.
CREATE OR REPLACE FUNCTION fn_process_spend_threshold_reward_event(
  p_tenant_id            UUID,
  p_customer_id          UUID,
  p_reward_definition_id UUID,
  p_order_id             UUID,
  p_order_total          NUMERIC,
  p_branch_id            UUID DEFAULT NULL
)
RETURNS TABLE (
  out_instance_id      UUID,
  out_instance_ordinal INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id       UUID;
  v_progress       NUMERIC;
  v_threshold      NUMERIC;
  v_expiration     INTEGER;
  v_expires_at     TIMESTAMPTZ;
  v_target_ordinal INTEGER;
  v_max_ordinal    INTEGER;
  v_ordinal        INTEGER;
  v_new_id         UUID;
BEGIN
  IF p_order_total IS NULL OR p_order_total <= 0 THEN
    RETURN;
  END IF;

  INSERT INTO reward_progress_events (tenant_id, customer_id, reward_definition_id, order_id, amount)
  VALUES (p_tenant_id, p_customer_id, p_reward_definition_id, p_order_id, p_order_total)
  ON CONFLICT (tenant_id, reward_definition_id, order_id) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RETURN;
  END IF;

  SELECT rd.trigger_config->>'amount', rd.expiration_days
    INTO v_threshold, v_expiration
    FROM reward_definitions rd
   WHERE rd.id = p_reward_definition_id
     AND rd.tenant_id = p_tenant_id
     AND rd.is_active = true
     AND rd.deleted_at IS NULL
     AND rd.trigger_type = 'spend_threshold';

  IF v_threshold IS NULL OR v_threshold <= 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(rpe.amount), 0) INTO v_progress
    FROM reward_progress_events rpe
   WHERE rpe.tenant_id = p_tenant_id
     AND rpe.customer_id = p_customer_id
     AND rpe.reward_definition_id = p_reward_definition_id;

  v_target_ordinal := FLOOR(v_progress / v_threshold)::INTEGER;
  IF v_target_ordinal <= 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(MAX(cri.instance_ordinal), 0) INTO v_max_ordinal
    FROM customer_reward_instances cri
   WHERE cri.tenant_id = p_tenant_id
     AND cri.customer_id = p_customer_id
     AND cri.reward_definition_id = p_reward_definition_id;

  IF v_target_ordinal <= v_max_ordinal THEN
    RETURN;
  END IF;

  v_expires_at := CASE WHEN v_expiration IS NOT NULL THEN now() + (v_expiration || ' days')::interval ELSE NULL END;

  FOR v_ordinal IN (v_max_ordinal + 1)..v_target_ordinal LOOP
    INSERT INTO customer_reward_instances (
      tenant_id, customer_id, reward_definition_id, status,
      unlocked_branch_id, instance_ordinal, unlocked_at, expires_at
    )
    VALUES (
      p_tenant_id, p_customer_id, p_reward_definition_id, 'unlocked',
      p_branch_id, v_ordinal, now(), v_expires_at
    )
    ON CONFLICT (tenant_id, reward_definition_id, customer_id, instance_ordinal) DO NOTHING
    RETURNING customer_reward_instances.id INTO v_new_id;

    IF v_new_id IS NOT NULL THEN
      RETURN QUERY SELECT v_new_id, v_ordinal;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_process_spend_threshold_reward_event(UUID, UUID, UUID, UUID, NUMERIC, UUID) TO service_role;
