-- 242. Fixes two confirmed defects found via live Zone-strategy testing
-- (Owner-requested verification of 7-7 §14/§15 — Zone/Wave interaction),
-- both real and both belong to 7-7.
--
-- DEFECT A: fn_record_short_pick/fn_record_damage/fn_record_lost_item all
-- located "the" pick list covering a settled shipment via
-- `SELECT pick_list_id FROM pick_list_shipments WHERE shipment_id=... LIMIT 1`
-- — correct only when a shipment belongs to exactly one pick list. A
-- zone-split shipment (fn_create_zone_pick_lists_for_shipments, 7-3)
-- inserts one pick_list_shipments row PER ZONE the shipment has lines in,
-- so a multi-zone shipment covers multiple pick lists simultaneously.
-- LIMIT 1 silently checked/completed only one of them, leaving the other
-- permanently stuck at 'in_progress' even once every line it covered was
-- genuinely settled. Fixed by looping over every pick list the shipment
-- belongs to, exactly the way multiple zones need each pick list's own
-- lines re-evaluated.
--
-- DEFECT B: fn_confirm_pick (7-2, migration 225) — genuinely unmodified
-- until now — has its own, older shipment/pick-list completion checks
-- (`quantity_picked < quantity_requested` / `quantity_picked <
-- quantity_to_pick`) that predate quantity_exception (7-7) and don't know
-- it exists. Confirmed live: after an exception is recorded on one line
-- of a multi-line shipment, a later ordinary fn_confirm_pick call on a
-- DIFFERENT line of the same shipment never detects overall settlement
-- (it still sees the exception-covered line as "not fully picked"),
-- leaving the shipment/pick list stuck even though every line is fully
-- accounted for. This is exactly a required 7-7/7-2 integration point,
-- not out-of-scope drift into 7-2: fixed by widening fn_confirm_pick's
-- own completion checks to treat quantity_picked + quantity_exception >=
-- quantity_requested as settled — the identical predicate 7-7's own
-- functions already use, so both entry points agree from now on
-- regardless of call order (pick-then-exception or exception-then-pick).
--
-- Neither fix changes any existing behavior for a shipment/pick list with
-- zero exceptions (quantity_exception is always 0 there, so the widened
-- check is mathematically identical to the original one).

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

  -- Widened (7-7, defect B): settled means fully picked OR the remainder
  -- is covered by a recorded exception (short/damaged/lost) — the exact
  -- same predicate fn_record_short_pick/fn_record_damage/fn_record_lost_
  -- item already use, so both entry points agree.
  FOR v_shipment_id IN SELECT unnest(v_shipment_ids) LOOP
    SELECT NOT EXISTS (
      SELECT 1 FROM shipment_lines WHERE shipment_id = v_shipment_id AND quantity_picked + quantity_exception < quantity_requested
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

-- ---------------------------------------------------------------------
-- fn_record_short_pick — defect A fix: loop over every pick list the
-- shipment belongs to instead of LIMIT 1.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_record_short_pick(
  p_shipment_line_id UUID,
  p_tenant_id        UUID,
  p_reason           TEXT,
  p_actor_id         UUID
) RETURNS warehouse_exceptions AS $$
DECLARE
  v_line       shipment_lines;
  v_shipment   shipments;
  v_outstanding NUMERIC;
  v_exception  warehouse_exceptions;
  v_pick_list_id UUID;
  v_pl_updated   UUID;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a reason is required';
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
    RAISE EXCEPTION 'shipment % is not in a pickable state (status=%) — short pick can only be finalized while picking', v_shipment.id, v_shipment.status;
  END IF;

  v_outstanding := v_line.quantity_requested - v_line.quantity_picked - v_line.quantity_exception;
  IF v_outstanding <= 0 THEN
    RAISE EXCEPTION 'NOT_SHORT: shipment line % has no outstanding quantity to finalize as short', p_shipment_line_id;
  END IF;

  IF v_line.reservation_id IS NOT NULL THEN
    PERFORM fn_reduce_reservation(v_line.reservation_id, v_outstanding, p_actor_id);
  END IF;

  UPDATE shipment_lines SET quantity_exception = quantity_exception + v_outstanding WHERE id = p_shipment_line_id;

  INSERT INTO warehouse_exceptions (
    tenant_id, entity_type, entity_id, exception_type, affected_quantity, reason,
    notes, actor_id, status, resolution, resolved_at, resolved_by
  ) VALUES (
    p_tenant_id, 'shipment_line', p_shipment_line_id, 'short_pick', v_outstanding, p_reason,
    jsonb_build_object('requested', v_line.quantity_requested, 'picked', v_line.quantity_picked, 'shipment_id', v_shipment.id),
    p_actor_id, 'resolved', 'backordered', NOW(), p_actor_id
  ) RETURNING * INTO v_exception;

  IF NOT EXISTS (
    SELECT 1 FROM shipment_lines
     WHERE shipment_id = v_shipment.id AND quantity_picked + quantity_exception < quantity_requested
  ) THEN
    UPDATE shipments SET status = 'picked', updated_at = NOW() WHERE id = v_shipment.id AND status = 'picking';
    INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id, notes)
    VALUES (p_tenant_id, 'shipment', v_shipment.id, 'picking', 'picked', p_actor_id, 'settled with short pick(s)');
  END IF;

  -- Defect A fix: every pick list this shipment belongs to (not just one),
  -- each independently re-evaluated on its own lines.
  FOR v_pick_list_id IN SELECT pick_list_id FROM pick_list_shipments WHERE shipment_id = v_shipment.id LOOP
    IF NOT EXISTS (
      SELECT 1 FROM shipment_lines sl2
      JOIN pick_list_shipments pls2 ON pls2.shipment_id = sl2.shipment_id
      WHERE pls2.pick_list_id = v_pick_list_id
        AND sl2.quantity_picked + sl2.quantity_exception < sl2.quantity_requested
    ) THEN
      UPDATE pick_lists SET status = 'completed', completed_at = NOW(), updated_at = NOW()
        WHERE id = v_pick_list_id AND status = 'in_progress'
        RETURNING id INTO v_pl_updated;
      IF v_pl_updated IS NOT NULL THEN
        INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id, notes)
        VALUES (p_tenant_id, 'pick_list', v_pick_list_id, 'in_progress', 'completed', p_actor_id, 'settled with short pick(s)');
      END IF;
    END IF;
  END LOOP;

  RETURN v_exception;
END;
$$ LANGUAGE plpgsql;

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
  v_pl_updated   UUID;
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

  FOR v_pick_list_id IN SELECT pick_list_id FROM pick_list_shipments WHERE shipment_id = v_shipment.id LOOP
    IF NOT EXISTS (
      SELECT 1 FROM shipment_lines sl2
      JOIN pick_list_shipments pls2 ON pls2.shipment_id = sl2.shipment_id
      WHERE pls2.pick_list_id = v_pick_list_id
        AND sl2.quantity_picked + sl2.quantity_exception < sl2.quantity_requested
    ) THEN
      UPDATE pick_lists SET status = 'completed', completed_at = NOW(), updated_at = NOW()
        WHERE id = v_pick_list_id AND status = 'in_progress'
        RETURNING id INTO v_pl_updated;
      IF v_pl_updated IS NOT NULL THEN
        INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id, notes)
        VALUES (p_tenant_id, 'pick_list', v_pick_list_id, 'in_progress', 'completed', p_actor_id, 'settled with damage exception');
      END IF;
    END IF;
  END LOOP;

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
  v_pl_updated   UUID;
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

  FOR v_pick_list_id IN SELECT pick_list_id FROM pick_list_shipments WHERE shipment_id = v_shipment.id LOOP
    IF NOT EXISTS (
      SELECT 1 FROM shipment_lines sl2
      JOIN pick_list_shipments pls2 ON pls2.shipment_id = sl2.shipment_id
      WHERE pls2.pick_list_id = v_pick_list_id
        AND sl2.quantity_picked + sl2.quantity_exception < sl2.quantity_requested
    ) THEN
      UPDATE pick_lists SET status = 'completed', completed_at = NOW(), updated_at = NOW()
        WHERE id = v_pick_list_id AND status = 'in_progress'
        RETURNING id INTO v_pl_updated;
      IF v_pl_updated IS NOT NULL THEN
        INSERT INTO warehouse_work_status_history (tenant_id, entity_type, entity_id, old_status, new_status, actor_id, notes)
        VALUES (p_tenant_id, 'pick_list', v_pick_list_id, 'in_progress', 'completed', p_actor_id, 'settled with lost-item write-off');
      END IF;
    END IF;
  END LOOP;

  RETURN v_exception;
END;
$$ LANGUAGE plpgsql;
