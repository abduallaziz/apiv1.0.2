-- Customer Domain Batch 3 Phase 12 (Owner-approved) — loyalty_points
-- trigger evaluation. Reads directly from customers.lifetime_points_earned
-- (a monotonically non-decreasing scalar, already updated atomically by
-- fn_adjust_loyalty_points — see migration 210) rather than an
-- order-scoped event, since this trigger has no natural "per order"
-- progress unit of its own. Idempotency/race-safety comes entirely from
-- the customer_reward_instances instance_ordinal UNIQUE constraint (211) —
-- no new events table needed. Same multi-ordinal-crossing loop as
-- spend_threshold (217), since a single large points award can cross
-- several thresholds at once.
--
-- Deliberately reads the customer row WITHOUT locking it — this function
-- only ever inserts into customer_reward_instances, never mutates
-- customers/loyalty_ledger, so there is nothing here for a lock to
-- protect; the ordinal UNIQUE constraint is what makes concurrent calls
-- safe, exactly as it does for the other two trigger functions.
CREATE OR REPLACE FUNCTION fn_process_loyalty_points_reward_event(
  p_tenant_id            UUID,
  p_customer_id          UUID,
  p_reward_definition_id UUID,
  p_branch_id            UUID DEFAULT NULL
)
RETURNS TABLE (
  out_instance_id      UUID,
  out_instance_ordinal INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_lifetime_points NUMERIC;
  v_threshold       NUMERIC;
  v_expiration      INTEGER;
  v_expires_at      TIMESTAMPTZ;
  v_target_ordinal  INTEGER;
  v_max_ordinal     INTEGER;
  v_ordinal         INTEGER;
  v_new_id          UUID;
BEGIN
  SELECT rd.trigger_config->>'points', rd.expiration_days
    INTO v_threshold, v_expiration
    FROM reward_definitions rd
   WHERE rd.id = p_reward_definition_id
     AND rd.tenant_id = p_tenant_id
     AND rd.is_active = true
     AND rd.deleted_at IS NULL
     AND rd.trigger_type = 'loyalty_points';

  IF v_threshold IS NULL OR v_threshold <= 0 THEN
    RETURN;
  END IF;

  SELECT c.lifetime_points_earned INTO v_lifetime_points
    FROM customers c
   WHERE c.id = p_customer_id AND c.tenant_id = p_tenant_id;

  IF v_lifetime_points IS NULL THEN
    RETURN;
  END IF;

  v_target_ordinal := FLOOR(v_lifetime_points / v_threshold)::INTEGER;
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

GRANT EXECUTE ON FUNCTION fn_process_loyalty_points_reward_event(UUID, UUID, UUID, UUID) TO service_role;
