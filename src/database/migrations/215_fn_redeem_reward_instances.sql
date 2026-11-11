-- Customer Domain Batch 3 Phase 11 (Owner-approved) — atomic, all-or-nothing
-- redemption of one or more selected reward instances in a single call.
--
-- Race protection: SELECT ... FOR UPDATE locks every selected row before any
-- validation runs. A concurrent duplicate redemption attempt (double click,
-- retried request, two terminals) targeting the same instance blocks on that
-- lock until the first transaction commits or rolls back; when it then
-- acquires the lock it re-reads status='redeemed' and fails its own
-- validation, so at most one caller ever succeeds per instance.
--
-- Atomicity: any single instance failing validation (not found, wrong
-- tenant/customer, not unlocked, expired, wrong branch) raises an exception,
-- which aborts the whole function call as part of the caller's transaction —
-- "5 selected, only 3 succeed" cannot happen; either all requested instances
-- redeem together or none do.
CREATE OR REPLACE FUNCTION fn_redeem_reward_instances(
  p_tenant_id   UUID,
  p_customer_id UUID,
  p_branch_id   UUID,
  p_instance_ids UUID[]
)
RETURNS SETOF customer_reward_instances
LANGUAGE plpgsql
AS $$
DECLARE
  v_row       customer_reward_instances%ROWTYPE;
  v_scope     TEXT;
  v_def_branch UUID;
  v_locked_count INTEGER := 0;
BEGIN
  IF p_instance_ids IS NULL OR array_length(p_instance_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No reward instances selected';
  END IF;

  FOR v_row IN
    SELECT cri.* FROM customer_reward_instances cri
     WHERE cri.id = ANY(p_instance_ids)
     ORDER BY cri.id
     FOR UPDATE
  LOOP
    v_locked_count := v_locked_count + 1;

    IF v_row.tenant_id != p_tenant_id OR v_row.customer_id != p_customer_id THEN
      RAISE EXCEPTION 'Reward instance % does not belong to this customer', v_row.id;
    END IF;

    IF v_row.status != 'unlocked' THEN
      RAISE EXCEPTION 'Reward instance % is not available to redeem (status: %)', v_row.id, v_row.status;
    END IF;

    IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
      RAISE EXCEPTION 'Reward instance % has expired', v_row.id;
    END IF;

    SELECT rd.branch_scope, rd.branch_id INTO v_scope, v_def_branch
      FROM reward_definitions rd
     WHERE rd.id = v_row.reward_definition_id;

    IF v_scope = 'specific' AND v_def_branch != p_branch_id THEN
      RAISE EXCEPTION 'Reward instance % is not valid at this branch', v_row.id;
    END IF;
  END LOOP;

  IF v_locked_count != array_length(p_instance_ids, 1) THEN
    RAISE EXCEPTION 'One or more selected reward instances were not found';
  END IF;

  RETURN QUERY
    UPDATE customer_reward_instances cri
       SET status = 'redeemed',
           redeemed_branch_id = p_branch_id,
           redeemed_at = now()
     WHERE cri.id = ANY(p_instance_ids)
       AND cri.status = 'unlocked'
    RETURNING cri.*;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_redeem_reward_instances(UUID, UUID, UUID, UUID[]) TO service_role;

-- Best-effort post-creation enrichment only (order_id isn't known at
-- redemption time — same architectural constraint as Loyalty's redemption-
-- before-order-creation ordering, see invoices.service.ts). A plain guarded
-- UPDATE is sufficient here: it only backfills a linkage column on rows this
-- exact call just redeemed, no new validation/state-transition risk.
CREATE OR REPLACE FUNCTION fn_attach_reward_redemption_order(
  p_instance_ids UUID[],
  p_order_id     UUID
)
RETURNS VOID AS $$
  UPDATE customer_reward_instances
     SET redeemed_order_id = p_order_id
   WHERE id = ANY(p_instance_ids)
     AND status = 'redeemed';
$$ LANGUAGE sql;

GRANT EXECUTE ON FUNCTION fn_attach_reward_redemption_order(UUID[], UUID) TO service_role;
