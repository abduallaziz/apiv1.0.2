-- 241. Inventory #7 / 7-7 follow-up (Owner-requested verification) — Lost
-- Item Recovery, with real cost-layer integrity.
--
-- CONFIRMED DEFECT in the 7-7 report's own claim: "recovery = a separate
-- corrective 'receipt' movement" was incomplete. Tracing the real,
-- established goods-receipt chain (fn_post_goods_receipt, migration 153)
-- shows every receipt ALWAYS pairs fn_apply_stock_movement (bumps
-- quantity_on_hand + ledger row) with fn_add_cost_layer (creates/merges
-- the cost_layers row the receipt's quantity_on_hand increase is backed
-- by, linked via source_movement_id) — never one without the other. A
-- bare fn_apply_stock_movement('receipt','in',...) call alone (which is
-- all a naive "just call receipt again" recovery would do) increases
-- quantity_on_hand with NO matching cost_layers row, so a subsequent
-- fn_consume_cost_layers for that same quantity would raise
-- INSUFFICIENT_COST_LAYERS — real, provable stock/cost inconsistency.
--
-- Fixed by fn_recover_lost_item, which reuses the exact same two-call
-- chain fn_post_goods_receipt already uses — no new stock-movement or
-- costing mechanics invented, this is 100% reuse of migration 019's
-- existing primitives. Never modifies history: the original 'lost'
-- exception/movement stays exactly as recorded; this is a distinct,
-- separate corrective event, linked back via reference_type=
-- 'warehouse_exception' on the new movement and a recovered_quantity
-- counter on the original exception row (never mutating affected_
-- quantity or the original movement).
--
-- recovered_quantity caps at the original lost quantity (CHECK) — cannot
-- "recover" more than was ever reported lost, and partial recovery
-- across multiple calls is supported (e.g. 3 of 5 lost units found today,
-- the other 2 later).

ALTER TABLE warehouse_exceptions
  ADD COLUMN recovered_quantity NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (recovered_quantity >= 0);
ALTER TABLE warehouse_exceptions
  ADD CONSTRAINT chk_warehouse_exception_recovered_le_affected
    CHECK (affected_quantity IS NULL OR recovered_quantity <= affected_quantity);

CREATE OR REPLACE FUNCTION fn_recover_lost_item(
  p_exception_id UUID,
  p_tenant_id    UUID,
  p_quantity     NUMERIC,
  p_reason       TEXT,
  p_actor_id     UUID,
  p_unit_cost    NUMERIC DEFAULT NULL
) RETURNS stock_movements AS $$
DECLARE
  v_exception warehouse_exceptions;
  v_line      shipment_lines;
  v_shipment  shipments;
  v_movement  stock_movements;
  v_remaining NUMERIC;
  v_unit_cost NUMERIC;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a reason is required';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive, got %', p_quantity;
  END IF;

  SELECT * INTO v_exception FROM warehouse_exceptions WHERE id = p_exception_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'exception % not found', p_exception_id;
  END IF;
  IF v_exception.exception_type <> 'lost' THEN
    RAISE EXCEPTION 'exception % is not a lost-item exception (type=%)', p_exception_id, v_exception.exception_type;
  END IF;

  v_remaining := COALESCE(v_exception.affected_quantity, 0) - v_exception.recovered_quantity;
  IF p_quantity > v_remaining THEN
    RAISE EXCEPTION 'RECOVERY_EXCEEDS_LOST: cannot recover % — only % of the original lost quantity remains unrecovered on exception %', p_quantity, v_remaining, p_exception_id;
  END IF;

  SELECT * INTO v_line FROM shipment_lines WHERE id = v_exception.entity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'original shipment line for exception % no longer exists', p_exception_id;
  END IF;
  SELECT * INTO v_shipment FROM shipments WHERE id = v_line.shipment_id;

  -- Default to the exact unit cost the write-off was recorded at
  -- (v_exception.notes->>'unit_cost', see fn_record_lost_item) unless the
  -- caller explicitly provides a different one (e.g. the item was found
  -- but its condition/value has genuinely changed).
  v_unit_cost := COALESCE(p_unit_cost, (v_exception.notes->>'unit_cost')::numeric, 0);

  -- Exact fn_post_goods_receipt chain (migration 153) — real ledger row,
  -- real cost layer, nothing bespoke.
  v_movement := fn_apply_stock_movement(
    p_tenant_id, v_shipment.warehouse_id, NULL, v_line.item_id, v_line.variant_id, NULL,
    'receipt', 'in', p_quantity, v_unit_cost, 'warehouse_exception', p_exception_id, p_actor_id,
    false, false
  );

  PERFORM fn_add_cost_layer(
    p_tenant_id, v_shipment.warehouse_id, v_line.item_id, v_line.variant_id, NULL,
    p_quantity, v_unit_cost, v_movement.id
  );

  UPDATE warehouse_exceptions SET recovered_quantity = recovered_quantity + p_quantity WHERE id = p_exception_id;

  RETURN v_movement;
END;
$$ LANGUAGE plpgsql;
