-- 240. Fixes a confirmed defect in migration 239, found via this item's
-- own required tests: fn_record_damage and fn_record_lost_item passed
-- the shipment_line's own (non-null) location_id to fn_apply_stock_
-- movement, but every other part of this WMS module (fn_create_
-- reservation, and therefore every stock_levels row picking/reservation
-- ever touches) operates at location_id=NULL — a warehouse-level
-- aggregate, never a specific bin. Passing the real location_id made
-- _lock_or_create_stock_level create/read a SEPARATE, always-empty
-- stock_levels row at that location, so every damage/lost report failed
-- with a false INSUFFICIENT_STOCK/INSUFFICIENT_COST_LAYERS regardless of
-- how much stock actually existed at the warehouse level. Fixed by using
-- NULL location for both, matching fn_create_reservation's own
-- convention exactly — the shipment_line's location_id remains available
-- on the row itself (and on the exception's notes) for picking guidance,
-- it was never meant to fragment stock_levels/cost accounting.

CREATE OR REPLACE FUNCTION fn_record_damage(
  p_shipment_line_id UUID,
  p_tenant_id        UUID,
  p_quantity         NUMERIC,
  p_reason           TEXT,
  p_actor_id         UUID
) RETURNS warehouse_exceptions AS $$
DECLARE
  v_line       shipment_lines;
  v_shipment   shipments;
  v_outstanding NUMERIC;
  v_unit_cost  NUMERIC;
  v_movement   stock_movements;
  v_exception  warehouse_exceptions;
  v_pick_list_id UUID;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a reason is required';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive, got %', p_quantity;
  END IF;

  SELECT * INTO v_line FROM shipment_lines WHERE id = p_shipment_line_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment line % not found', p_shipment_line_id;
  END IF;
  SELECT * INTO v_shipment FROM shipments WHERE id = v_line.shipment_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment line % not found', p_shipment_line_id;
  END IF;
  IF v_shipment.status <> 'picking' THEN
    RAISE EXCEPTION 'shipment % is not in a pickable state (status=%)', v_shipment.id, v_shipment.status;
  END IF;

  v_outstanding := v_line.quantity_requested - v_line.quantity_picked - v_line.quantity_exception;
  IF p_quantity > v_outstanding THEN
    RAISE EXCEPTION 'DAMAGE_EXCEEDS_OUTSTANDING: cannot report % damaged — only % outstanding on shipment line %', p_quantity, v_outstanding, p_shipment_line_id;
  END IF;

  SELECT COALESCE(SUM(unit_cost * quantity_remaining) / NULLIF(SUM(quantity_remaining), 0), 0) INTO v_unit_cost
    FROM cost_layers
   WHERE tenant_id = p_tenant_id AND warehouse_id = v_shipment.warehouse_id AND item_id = v_line.item_id
     AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_line.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND quantity_remaining > 0;

  -- NULL location — see migration header. Real bin stays on
  -- shipment_lines.location_id / the exception's notes for reference.
  v_movement := fn_apply_stock_movement(
    p_tenant_id, v_shipment.warehouse_id, NULL, v_line.item_id, v_line.variant_id, NULL,
    'damage', 'out', p_quantity, v_unit_cost, 'shipment_line', p_shipment_line_id, p_actor_id,
    false, false
  );

  IF v_line.reservation_id IS NOT NULL THEN
    PERFORM fn_reduce_reservation(v_line.reservation_id, p_quantity, p_actor_id);
  END IF;

  UPDATE shipment_lines SET quantity_exception = quantity_exception + p_quantity WHERE id = p_shipment_line_id;

  INSERT INTO warehouse_exceptions (
    tenant_id, entity_type, entity_id, exception_type, affected_quantity, reason,
    notes, actor_id, status, resolution, resolved_at, resolved_by, stock_movement_id
  ) VALUES (
    p_tenant_id, 'shipment_line', p_shipment_line_id, 'damaged', p_quantity, p_reason,
    jsonb_build_object('shipment_id', v_shipment.id, 'unit_cost', v_unit_cost, 'location_id', v_line.location_id),
    p_actor_id, 'resolved', 'backordered', NOW(), p_actor_id, v_movement.id
  ) RETURNING * INTO v_exception;

  IF NOT EXISTS (
    SELECT 1 FROM shipment_lines
     WHERE shipment_id = v_shipment.id AND quantity_picked + quantity_exception < quantity_requested
  ) THEN
    UPDATE shipments SET status = 'picked', updated_at = NOW() WHERE id = v_shipment.id AND status = 'picking';
    INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id, notes)
    VALUES (p_tenant_id, 'shipment', v_shipment.id, 'picking', 'picked', p_actor_id, 'settled with damage exception');
  END IF;

  SELECT pick_list_id INTO v_pick_list_id FROM pick_list_shipments WHERE shipment_id = v_shipment.id LIMIT 1;
  IF v_pick_list_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM shipment_lines sl2
    JOIN pick_list_shipments pls2 ON pls2.shipment_id = sl2.shipment_id
    WHERE pls2.pick_list_id = v_pick_list_id
      AND sl2.quantity_picked + sl2.quantity_exception < sl2.quantity_requested
  ) THEN
    UPDATE pick_lists SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = v_pick_list_id AND status = 'in_progress';
    INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id, notes)
    VALUES (p_tenant_id, 'pick_list', v_pick_list_id, 'in_progress', 'completed', p_actor_id, 'settled with damage exception');
  END IF;

  RETURN v_exception;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_record_lost_item(
  p_shipment_line_id UUID,
  p_tenant_id        UUID,
  p_quantity         NUMERIC,
  p_reason           TEXT,
  p_actor_id         UUID
) RETURNS warehouse_exceptions AS $$
DECLARE
  v_line        shipment_lines;
  v_shipment    shipments;
  v_outstanding NUMERIC;
  v_unit_cost   NUMERIC;
  v_movement    stock_movements;
  v_exception   warehouse_exceptions;
  v_pick_list_id UUID;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a reason is required';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive, got %', p_quantity;
  END IF;

  SELECT * INTO v_line FROM shipment_lines WHERE id = p_shipment_line_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment line % not found', p_shipment_line_id;
  END IF;
  SELECT * INTO v_shipment FROM shipments WHERE id = v_line.shipment_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment line % not found', p_shipment_line_id;
  END IF;
  IF v_shipment.status <> 'picking' THEN
    RAISE EXCEPTION 'shipment % is not in a pickable state (status=%)', v_shipment.id, v_shipment.status;
  END IF;

  v_outstanding := v_line.quantity_requested - v_line.quantity_picked - v_line.quantity_exception;
  IF p_quantity > v_outstanding THEN
    RAISE EXCEPTION 'LOST_EXCEEDS_OUTSTANDING: cannot report % lost — only % outstanding on shipment line %', p_quantity, v_outstanding, p_shipment_line_id;
  END IF;

  v_unit_cost := fn_consume_cost_layers(p_tenant_id, v_shipment.warehouse_id, v_line.item_id, v_line.variant_id, p_quantity);

  -- NULL location — see migration header.
  v_movement := fn_apply_stock_movement(
    p_tenant_id, v_shipment.warehouse_id, NULL, v_line.item_id, v_line.variant_id, NULL,
    'lost', 'out', p_quantity, v_unit_cost, 'shipment_line', p_shipment_line_id, p_actor_id,
    false, false
  );

  IF v_line.reservation_id IS NOT NULL THEN
    PERFORM fn_reduce_reservation(v_line.reservation_id, p_quantity, p_actor_id);
  END IF;

  UPDATE shipment_lines SET quantity_exception = quantity_exception + p_quantity WHERE id = p_shipment_line_id;

  INSERT INTO warehouse_exceptions (
    tenant_id, entity_type, entity_id, exception_type, affected_quantity, reason,
    notes, actor_id, status, resolution, resolved_at, resolved_by, stock_movement_id
  ) VALUES (
    p_tenant_id, 'shipment_line', p_shipment_line_id, 'lost', p_quantity, p_reason,
    jsonb_build_object('shipment_id', v_shipment.id, 'unit_cost', v_unit_cost, 'write_off', true, 'location_id', v_line.location_id),
    p_actor_id, 'resolved', 'written_off', NOW(), p_actor_id, v_movement.id
  ) RETURNING * INTO v_exception;

  IF NOT EXISTS (
    SELECT 1 FROM shipment_lines
     WHERE shipment_id = v_shipment.id AND quantity_picked + quantity_exception < quantity_requested
  ) THEN
    UPDATE shipments SET status = 'picked', updated_at = NOW() WHERE id = v_shipment.id AND status = 'picking';
    INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id, notes)
    VALUES (p_tenant_id, 'shipment', v_shipment.id, 'picking', 'picked', p_actor_id, 'settled with lost-item write-off');
  END IF;

  SELECT pick_list_id INTO v_pick_list_id FROM pick_list_shipments WHERE shipment_id = v_shipment.id LIMIT 1;
  IF v_pick_list_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM shipment_lines sl2
    JOIN pick_list_shipments pls2 ON pls2.shipment_id = sl2.shipment_id
    WHERE pls2.pick_list_id = v_pick_list_id
      AND sl2.quantity_picked + sl2.quantity_exception < sl2.quantity_requested
  ) THEN
    UPDATE pick_lists SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = v_pick_list_id AND status = 'in_progress';
    INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id, notes)
    VALUES (p_tenant_id, 'pick_list', v_pick_list_id, 'in_progress', 'completed', p_actor_id, 'settled with lost-item write-off');
  END IF;

  RETURN v_exception;
END;
$$ LANGUAGE plpgsql;
