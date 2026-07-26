-- Purchasing #9.5.6.2: fn_approve_agreement_amendment -- the single
-- atomic transition that applies an approved amendment's deltas to
-- agreement_items, updates the amendment's own status, and records
-- approval_history, all inside one Postgres transaction (a single RPC
-- call is atomic by default -- same guarantee as fn_apply_stock_movement/
-- fn_post_goods_receipt, this project's established pattern for any
-- operation that must not be allowed to partially apply).
--
-- Responsibility split (deliberate, not accidental): AmendmentsService
-- is responsible for permission checks and ApprovalEngine.canApprove()
-- (the business-eligibility question "is this transition allowed at
-- all"). This function is responsible ONLY for the atomic state mutation
-- itself -- its own internal status re-check under FOR UPDATE is a
-- concurrency guard against a second concurrent approve() call racing
-- between the Service's check and this function's execution, not a
-- duplication of the Service's business rule.
--
-- Every agreement_items row touched by 'modify'/'discontinue' is scoped
-- by BOTH tenant_id AND agreement_id = the amendment's own agreement_id
-- -- tenant_id alone is not enough to prevent an amendment from one
-- agreement mutating an agreement_item that belongs to a DIFFERENT
-- agreement within the same tenant.

CREATE FUNCTION fn_approve_agreement_amendment(
  p_tenant_id     UUID,
  p_amendment_id  UUID,
  p_approved_by   UUID,
  p_resolved_at   TIMESTAMPTZ
) RETURNS agreement_amendments
LANGUAGE plpgsql
AS $$
DECLARE
  v_amendment    agreement_amendments%ROWTYPE;
  v_item         RECORD;
  v_existing_qty NUMERIC;
  v_existing_val NUMERIC;
BEGIN
  SELECT * INTO v_amendment
  FROM agreement_amendments
  WHERE id = p_amendment_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Amendment % not found', p_amendment_id;
  END IF;

  IF v_amendment.status != 'submitted' THEN
    RAISE EXCEPTION 'Cannot approve amendment with status: %', v_amendment.status;
  END IF;

  FOR v_item IN
    SELECT * FROM agreement_amendment_items WHERE amendment_id = p_amendment_id
  LOOP
    IF v_item.action = 'add' THEN
      -- ADD initializes values directly -- there is no prior state to
      -- reconcile, this is the item's first-ever committed_quantity/value.
      INSERT INTO agreement_items (
        tenant_id, agreement_id, item_id, variant_id,
        committed_quantity, committed_value, notes, added_via_amendment_id
      ) VALUES (
        p_tenant_id, v_amendment.agreement_id, v_item.new_item_id, v_item.new_variant_id,
        v_item.delta_committed_quantity, v_item.delta_committed_value, v_item.notes, p_amendment_id
      );

    ELSIF v_item.action = 'modify' THEN
      -- Lock the target row (scoped to THIS amendment's own agreement_id,
      -- not just tenant_id) and read its CURRENT operational values
      -- before deciding anything -- protects against a concurrent writer,
      -- and lets us reject (not silently coalesce) a delta against a
      -- NULL baseline.
      SELECT committed_quantity, committed_value
      INTO v_existing_qty, v_existing_val
      FROM agreement_items
      WHERE id = v_item.agreement_item_id
        AND tenant_id = p_tenant_id
        AND agreement_id = v_amendment.agreement_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'agreement_item % not found for modify (or does not belong to agreement %)',
          v_item.agreement_item_id, v_amendment.agreement_id;
      END IF;

      IF v_item.delta_committed_quantity IS NOT NULL AND v_existing_qty IS NULL THEN
        RAISE EXCEPTION
          'Cannot apply a quantity delta to agreement_item % -- it has no existing committed_quantity (open-ended item)',
          v_item.agreement_item_id;
      END IF;

      IF v_item.delta_committed_value IS NOT NULL AND v_existing_val IS NULL THEN
        RAISE EXCEPTION
          'Cannot apply a value delta to agreement_item % -- it has no existing committed_value (open-ended item)',
          v_item.agreement_item_id;
      END IF;

      UPDATE agreement_items SET
        committed_quantity = CASE WHEN v_item.delta_committed_quantity IS NOT NULL
          THEN committed_quantity + v_item.delta_committed_quantity ELSE committed_quantity END,
        committed_value = CASE WHEN v_item.delta_committed_value IS NOT NULL
          THEN committed_value + v_item.delta_committed_value ELSE committed_value END
      WHERE id = v_item.agreement_item_id
        AND tenant_id = p_tenant_id
        AND agreement_id = v_amendment.agreement_id;

    ELSIF v_item.action = 'discontinue' THEN
      UPDATE agreement_items SET
        discontinued_via_amendment_id = p_amendment_id,
        discontinued_at = p_resolved_at
      WHERE id = v_item.agreement_item_id
        AND tenant_id = p_tenant_id
        AND agreement_id = v_amendment.agreement_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'agreement_item % not found for discontinue (or does not belong to agreement %)',
          v_item.agreement_item_id, v_amendment.agreement_id;
      END IF;
    END IF;
  END LOOP;

  UPDATE agreement_amendments SET
    status = 'approved', approved_by = p_approved_by, approved_at = p_resolved_at
  WHERE id = p_amendment_id
  RETURNING * INTO v_amendment;

  INSERT INTO approval_history (
    tenant_id, reference_type, reference_id, action, actor_id, previous_status, new_status
  ) VALUES (
    p_tenant_id, 'agreement_amendment', p_amendment_id, 'approved', p_approved_by, 'submitted', 'approved'
  );

  RETURN v_amendment;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_approve_agreement_amendment(UUID, UUID, UUID, TIMESTAMPTZ) TO service_role;
