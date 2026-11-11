-- 226. Fixes a confirmed defect in migration 225, found via real HTTP
-- runtime testing: fn_assign_pick_list and fn_cancel_pick_list both wrote
-- `updated_at = NOW()` in their UPDATE statements, but pick_lists
-- (migration 116) was never given an updated_at column — unlike
-- warehouse_tasks, which has one. The assumption of parity was wrong for
-- this one column. Confirmed via live error: 'column "updated_at" of
-- relation "pick_lists" does not exist'.
--
-- Fixed by adding the column (bringing pick_lists to genuine parity, the
-- actual intent) rather than removing updated_at tracking from the two
-- new functions.
ALTER TABLE pick_lists ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION fn_assign_pick_list(
  p_pick_list_id UUID, p_tenant_id UUID, p_assigned_to UUID, p_actor_id UUID
) RETURNS pick_lists AS $$
DECLARE
  v_pick_list pick_lists;
  v_previous_assignee UUID;
BEGIN
  SELECT * INTO v_pick_list FROM pick_lists WHERE id = p_pick_list_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pick list % not found', p_pick_list_id; END IF;
  IF v_pick_list.status NOT IN ('open', 'in_progress') THEN
    RAISE EXCEPTION 'pick list % cannot be assigned (status=%)', p_pick_list_id, v_pick_list.status;
  END IF;

  v_previous_assignee := v_pick_list.assigned_to;

  UPDATE pick_lists SET assigned_to = p_assigned_to, updated_at = NOW()
   WHERE id = p_pick_list_id RETURNING * INTO v_pick_list;

  INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id, notes)
  VALUES (
    p_tenant_id, 'pick_list', p_pick_list_id, v_pick_list.status, v_pick_list.status, p_actor_id,
    CASE WHEN v_previous_assignee IS NULL
      THEN format('assigned to %s', p_assigned_to)
      ELSE format('reassigned from %s to %s', v_previous_assignee, p_assigned_to)
    END
  );

  RETURN v_pick_list;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_cancel_pick_list(
  p_pick_list_id UUID, p_tenant_id UUID, p_reason TEXT, p_actor_id UUID
) RETURNS pick_lists AS $$
DECLARE
  v_pick_list pick_lists;
  v_old_status TEXT;
  v_reservation_id UUID;
  v_shipment_id UUID;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a cancellation reason is required';
  END IF;

  SELECT * INTO v_pick_list FROM pick_lists WHERE id = p_pick_list_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pick list % not found', p_pick_list_id; END IF;
  IF v_pick_list.status NOT IN ('open', 'in_progress') THEN
    RAISE EXCEPTION 'pick list % cannot be cancelled (status=%)', p_pick_list_id, v_pick_list.status;
  END IF;
  v_old_status := v_pick_list.status;

  FOR v_reservation_id IN
    SELECT DISTINCT sl.reservation_id
    FROM shipment_lines sl
    JOIN pick_list_shipments pls ON pls.shipment_id = sl.shipment_id
    WHERE pls.pick_list_id = p_pick_list_id AND sl.reservation_id IS NOT NULL
  LOOP
    PERFORM fn_release_reservation(v_reservation_id, 'released');
  END LOOP;

  FOR v_shipment_id IN
    SELECT shipment_id FROM pick_list_shipments WHERE pick_list_id = p_pick_list_id
  LOOP
    UPDATE shipments SET status = 'pending', updated_at = NOW()
     WHERE id = v_shipment_id AND status = 'picking';
  END LOOP;

  UPDATE pick_lists
     SET status = 'cancelled', cancellation_reason = p_reason, updated_at = NOW()
   WHERE id = p_pick_list_id
   RETURNING * INTO v_pick_list;

  INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id, notes)
  VALUES (p_tenant_id, 'pick_list', p_pick_list_id, v_old_status, 'cancelled', p_actor_id, p_reason);

  RETURN v_pick_list;
END;
$$ LANGUAGE plpgsql;
