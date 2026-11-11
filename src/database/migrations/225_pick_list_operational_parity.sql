-- 225. Inventory #7 / Migration Item 7-2 (Owner-approved) — Pick-List
-- Operational Parity.
--
-- Brings pick_lists up to the same operational maturity warehouse_tasks
-- already has (priority, real assignment/reassignment, cancellation with
-- a reason, and actual use of the shared warehouse_work_status_history
-- table from 7-1) — per the approved shared-capability-layer architecture:
-- picking keeps its own multi-line/multi-shipment table shape, it just
-- gains the same capabilities.
--
-- Confirmed via audit before writing this: pick_lists.assigned_to
-- (migration 116) was declared but NEVER set anywhere — no assign
-- function existed at all, not just no reassign function. And there was
-- no pick-list-level cancel function (only fn_cancel_shipment, which
-- operates on a single shipment and never touches pick_lists/its
-- reservations at all). Both are built here, not just the "reassign"
-- half implied by a narrower reading of the item name.

ALTER TABLE pick_lists ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent'));
ALTER TABLE pick_lists ADD COLUMN cancellation_reason TEXT;

-- fn_create_pick_list: CREATE OR REPLACE, identical logic, plus:
--   (a) p_priority as a new trailing parameter with a DEFAULT, so the
--       existing call site (WmsRepository.createPickList) keeps working
--       unchanged until the TS layer is updated to pass it explicitly;
--   (b) a warehouse_work_status_history row on creation — pick lists
--       previously wrote nothing into the shared history table 7-1 built,
--       which is exactly the "operational parity" gap this item closes.
CREATE OR REPLACE FUNCTION fn_create_pick_list(
  p_tenant_id        UUID,
  p_warehouse_id     UUID,
  p_shipment_ids     UUID[],
  p_strategy         TEXT,
  p_zone_location_id UUID,
  p_actor_id         UUID,
  p_priority         TEXT DEFAULT 'medium'
) RETURNS pick_lists AS $$
DECLARE
  v_pick_list pick_lists;
  v_shipment  shipments;
  v_line      RECORD;
  v_pll       pick_list_lines;
  v_reservation stock_reservations;
BEGIN
  IF array_length(p_shipment_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one shipment is required';
  END IF;
  IF p_strategy = 'single' AND array_length(p_shipment_ids, 1) <> 1 THEN
    RAISE EXCEPTION 'strategy single requires exactly one shipment';
  END IF;

  INSERT INTO pick_lists (tenant_id, warehouse_id, strategy, zone_location_id, priority, status, created_by, started_at)
  VALUES (p_tenant_id, p_warehouse_id, p_strategy, p_zone_location_id, COALESCE(p_priority, 'medium'), 'in_progress', p_actor_id, NOW())
  RETURNING * INTO v_pick_list;

  FOR v_shipment IN SELECT * FROM shipments WHERE id = ANY(p_shipment_ids) FOR UPDATE LOOP
    IF v_shipment.tenant_id <> p_tenant_id THEN
      RAISE EXCEPTION 'shipment % not found', v_shipment.id;
    END IF;
    IF v_shipment.warehouse_id <> p_warehouse_id THEN
      RAISE EXCEPTION 'shipment % does not belong to warehouse %', v_shipment.id, p_warehouse_id;
    END IF;
    IF v_shipment.status <> 'pending' THEN
      RAISE EXCEPTION 'shipment % is not pending (status=%)', v_shipment.id, v_shipment.status;
    END IF;

    INSERT INTO pick_list_shipments (tenant_id, pick_list_id, shipment_id)
    VALUES (p_tenant_id, v_pick_list.id, v_shipment.id);

    UPDATE shipments SET status = 'picking', updated_at = NOW() WHERE id = v_shipment.id;
  END LOOP;

  FOR v_line IN
    SELECT sl.item_id, sl.variant_id, sl.location_id, SUM(sl.quantity_requested) AS total_qty
    FROM shipment_lines sl
    WHERE sl.shipment_id = ANY(p_shipment_ids)
    GROUP BY sl.item_id, sl.variant_id, sl.location_id
  LOOP
    INSERT INTO pick_list_lines (tenant_id, pick_list_id, item_id, variant_id, location_id, quantity_to_pick)
    VALUES (p_tenant_id, v_pick_list.id, v_line.item_id, v_line.variant_id, v_line.location_id, v_line.total_qty)
    RETURNING * INTO v_pll;

    v_reservation := fn_create_reservation(
      p_tenant_id, p_warehouse_id, v_line.item_id, v_line.variant_id, NULL,
      v_line.total_qty, 'pick_list_line', v_pll.id, p_actor_id, NULL
    );

    UPDATE shipment_lines
       SET reservation_id = v_reservation.id
     WHERE shipment_id = ANY(p_shipment_ids)
       AND item_id = v_line.item_id
       AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_line.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_line.location_id, '00000000-0000-0000-0000-000000000000'::uuid);
  END LOOP;

  INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id)
  VALUES (p_tenant_id, 'pick_list', v_pick_list.id, NULL, 'in_progress', p_actor_id);

  RETURN v_pick_list;
END;
$$ LANGUAGE plpgsql;

-- fn_confirm_pick: CREATE OR REPLACE, identical logic, plus a history row
-- when the pick list transitions to 'completed'.
CREATE OR REPLACE FUNCTION fn_confirm_pick(
  p_pick_list_line_id UUID,
  p_quantity          NUMERIC,
  p_actor_id          UUID
) RETURNS pick_list_lines AS $$
DECLARE
  v_line pick_list_lines;
  v_remaining NUMERIC;
  v_sl RECORD;
  v_take NUMERIC;
  v_shipment_id UUID;
  v_shipment_ids UUID[];
  v_all_done BOOLEAN;
BEGIN
  SELECT * INTO v_line FROM pick_list_lines WHERE id = p_pick_list_line_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pick list line % not found', p_pick_list_line_id;
  END IF;
  IF v_line.quantity_picked + p_quantity > v_line.quantity_to_pick THEN
    RAISE EXCEPTION 'cannot pick % — only % remaining of %', p_quantity, v_line.quantity_to_pick - v_line.quantity_picked, v_line.quantity_to_pick;
  END IF;

  UPDATE pick_list_lines SET quantity_picked = quantity_picked + p_quantity WHERE id = p_pick_list_line_id
  RETURNING * INTO v_line;

  SELECT array_agg(shipment_id) INTO v_shipment_ids FROM pick_list_shipments WHERE pick_list_id = v_line.pick_list_id;

  v_remaining := p_quantity;
  FOR v_sl IN
    SELECT sl.* FROM shipment_lines sl
    JOIN shipments s ON s.id = sl.shipment_id
    WHERE sl.shipment_id = ANY(v_shipment_ids)
      AND sl.item_id = v_line.item_id
      AND COALESCE(sl.variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_line.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND COALESCE(sl.location_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_line.location_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND sl.quantity_picked < sl.quantity_requested
    ORDER BY s.created_at ASC
    FOR UPDATE OF sl
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_remaining, v_sl.quantity_requested - v_sl.quantity_picked);
    UPDATE shipment_lines SET quantity_picked = quantity_picked + v_take WHERE id = v_sl.id;
    v_remaining := v_remaining - v_take;
  END LOOP;

  FOR v_shipment_id IN SELECT unnest(v_shipment_ids) LOOP
    SELECT NOT EXISTS (
      SELECT 1 FROM shipment_lines WHERE shipment_id = v_shipment_id AND quantity_picked < quantity_requested
    ) INTO v_all_done;
    IF v_all_done THEN
      UPDATE shipments SET status = 'picked', updated_at = NOW() WHERE id = v_shipment_id AND status = 'picking';
    END IF;
  END LOOP;

  SELECT NOT EXISTS (
    SELECT 1 FROM pick_list_lines WHERE pick_list_id = v_line.pick_list_id AND quantity_picked < quantity_to_pick
  ) INTO v_all_done;
  IF v_all_done THEN
    UPDATE pick_lists SET status = 'completed', completed_at = NOW() WHERE id = v_line.pick_list_id;

    INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id)
    SELECT tenant_id, 'pick_list', id, 'in_progress', 'completed', p_actor_id FROM pick_lists WHERE id = v_line.pick_list_id;
  END IF;

  RETURN v_line;
END;
$$ LANGUAGE plpgsql;

-- fn_assign_pick_list: NEW — pick_lists.assigned_to was declared in
-- migration 116 but never set anywhere (confirmed by grep before writing
-- this). Handles both the first assignment and reassignment identically
-- (mirrors fn_assign_warehouse_task's tolerance for being called again on
-- an already-assigned item) — pick_lists has no pending/assigned status
-- distinction (it goes straight to 'in_progress' on creation), so
-- assignment doesn't move `status`; it's logged as an activity row with
-- old_status=new_status=current status and the actual change recorded in
-- `notes`, which is exactly what that column exists for.
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

-- fn_cancel_pick_list: NEW — no pick-list-level cancel existed before
-- this (only fn_cancel_shipment, which is shipment-scoped and never
-- touches pick_lists or its reservations). Mirrors fn_cancel_shipment's
-- reservation-release pattern (reused via fn_release_reservation, not
-- duplicated), additionally reverting every covered shipment still in
-- 'picking' back to 'pending' so it can be picked again in a future pick
-- list, and requires a reason (the exact "extend the cancellation path
-- with reason" requirement from the approved matrix).
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
