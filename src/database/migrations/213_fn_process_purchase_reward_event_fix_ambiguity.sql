-- Customer Domain Batch 3 Phase 9 corrective — same ambiguous-column-reference
-- class of bug as migration 210 (Loyalty Phase 6): RETURNS TABLE implicitly
-- declares OUT parameters, and "instance_ordinal" collided with
-- customer_reward_instances.instance_ordinal (specifically inside the
-- ON CONFLICT target-column list, which is not qualifiable by table alias).
-- Fixed by renaming the OUT columns to out_instance_id/out_instance_ordinal —
-- names that cannot collide with any real column in this function's body —
-- rather than trying to qualify an ON CONFLICT column list, which Postgres
-- does not support. Live-validated: idempotent retry no-op and 2nd-call
-- unlock both confirmed correct after this fix (see rpc_test_qa.js run).
DROP FUNCTION IF EXISTS fn_process_purchase_reward_event(UUID, UUID, UUID, UUID, UUID);

CREATE FUNCTION fn_process_purchase_reward_event(
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
  v_progress     INTEGER;
  v_threshold    INTEGER;
  v_expiration   INTEGER;
  v_expires_at   TIMESTAMPTZ;
  v_new_id       UUID;
  v_new_ordinal  INTEGER;
BEGIN
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
