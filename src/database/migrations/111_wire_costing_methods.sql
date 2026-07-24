-- Inventory redesign — Part A item #15: actually wire moving_average /
-- standard / actual, not just accept them in the CHECK constraint.

ALTER TABLE items ADD COLUMN standard_cost NUMERIC(14,4) CHECK (standard_cost >= 0);
ALTER TABLE item_serials ADD COLUMN unit_cost NUMERIC(14,4) CHECK (unit_cost >= 0);

-- CREATE OR REPLACE, identical signature to migration 019 — 'moving_average'
-- now takes the exact same merge-into-single-open-layer path as 'average'
-- (a perpetual weighted average recomputed on every receipt IS moving
-- average; there's no real behavioral difference to invent). 'standard'
-- and 'actual' still create distinct FIFO-ordered layers (not merged) —
-- 'actual' needs them separately addressable by batch for specific
-- identification, and 'standard' needs real purchase cost preserved per
-- layer so purchase-price variance stays visible even though consumption
-- always uses the fixed standard rate.
CREATE OR REPLACE FUNCTION fn_add_cost_layer(
  p_tenant_id     UUID,
  p_warehouse_id  UUID,
  p_item_id       UUID,
  p_variant_id    UUID,
  p_batch_id      UUID,
  p_quantity      NUMERIC,
  p_unit_cost     NUMERIC,
  p_source_movement_id UUID
) RETURNS VOID AS $$
DECLARE
  v_costing_method TEXT;
  v_layer cost_layers;
BEGIN
  SELECT costing_method INTO v_costing_method FROM items WHERE id = p_item_id;

  IF v_costing_method IN ('average', 'moving_average') THEN
    SELECT * INTO v_layer FROM cost_layers
     WHERE tenant_id = p_tenant_id AND warehouse_id = p_warehouse_id AND item_id = p_item_id
       AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND quantity_remaining > 0
     ORDER BY received_at
     LIMIT 1
     FOR UPDATE;

    IF FOUND THEN
      UPDATE cost_layers
         SET unit_cost = ROUND(
               ((unit_cost * quantity_remaining) + (p_unit_cost * p_quantity))
               / (quantity_remaining + p_quantity), 4
             ),
             quantity_remaining = quantity_remaining + p_quantity,
             quantity_received = quantity_received + p_quantity
       WHERE id = v_layer.id;
      RETURN;
    END IF;
    -- no open layer yet — fall through to create the first one
  END IF;

  INSERT INTO cost_layers (
    tenant_id, warehouse_id, item_id, variant_id, batch_id,
    source_movement_id, unit_cost, quantity_received, quantity_remaining
  ) VALUES (
    p_tenant_id, p_warehouse_id, p_item_id, p_variant_id, p_batch_id,
    p_source_movement_id, p_unit_cost, p_quantity, p_quantity
  );
END;
$$ LANGUAGE plpgsql;

-- Learning from migrations 105/106: adding a parameter via CREATE OR
-- REPLACE creates a SECOND overload instead of replacing the old one,
-- which breaks PostgREST RPC dispatch if anything ever calls this
-- directly. Dropping the old 6-arg signature explicitly before
-- recreating with 7, even though nothing currently calls this via RPC
-- (only from other plpgsql functions) — no reason to leave the same
-- landmine for later.
DROP FUNCTION IF EXISTS fn_consume_cost_layers(UUID, UUID, UUID, UUID, NUMERIC, BOOLEAN);

-- CREATE OR REPLACE with one new trailing optional parameter (p_serial_id,
-- default NULL) — every existing call site (which never passes it) keeps
-- exactly the FEFO/FIFO/average behavior from migration 108, since NULL
-- always skips the new 'actual'-with-serial branch below.
CREATE OR REPLACE FUNCTION fn_consume_cost_layers(
  p_tenant_id     UUID,
  p_warehouse_id  UUID,
  p_item_id       UUID,
  p_variant_id    UUID,
  p_quantity      NUMERIC,
  p_allow_partial BOOLEAN DEFAULT false,
  p_serial_id     UUID DEFAULT NULL
) RETURNS NUMERIC AS $$
DECLARE
  v_costing_method TEXT;
  v_standard_cost  NUMERIC;
  v_serial_cost    NUMERIC;
  v_serial_batch_id UUID;
  v_layer        RECORD;
  v_remaining_to_consume NUMERIC := p_quantity;
  v_total_cost   NUMERIC := 0;
  v_take         NUMERIC;
  v_consumed     NUMERIC;
BEGIN
  SELECT costing_method, standard_cost INTO v_costing_method, v_standard_cost FROM items WHERE id = p_item_id;

  -- ACTUAL costing, specific unit identified: true specific-identification
  -- costing — this serial's own recorded cost, not a pooled average. The
  -- matching cost layer (same batch_id) is still decremented so on-hand/
  -- available quantity stays accurate; only the RETURNED cost differs
  -- from what pooled FIFO/average would have said.
  IF v_costing_method = 'actual' AND p_serial_id IS NOT NULL THEN
    SELECT unit_cost, batch_id INTO v_serial_cost, v_serial_batch_id
      FROM item_serials WHERE id = p_serial_id AND tenant_id = p_tenant_id;
    IF v_serial_cost IS NULL THEN
      RAISE EXCEPTION 'serial % has no recorded unit_cost for actual costing', p_serial_id;
    END IF;

    IF v_serial_batch_id IS NOT NULL THEN
      UPDATE cost_layers
         SET quantity_remaining = GREATEST(quantity_remaining - p_quantity, 0)
       WHERE tenant_id = p_tenant_id AND warehouse_id = p_warehouse_id AND item_id = p_item_id
         AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
         AND batch_id = v_serial_batch_id;
    END IF;

    RETURN v_serial_cost;
  END IF;

  -- STANDARD costing: consumption ALWAYS uses the fixed standard_cost,
  -- regardless of what any layer actually cost at receipt — that gap is
  -- purchase-price variance, deliberately left visible in the layers
  -- themselves rather than absorbed silently. Real layers are still
  -- walked and decremented below so on-hand quantity stays accurate.
  IF v_costing_method = 'standard' THEN
    IF v_standard_cost IS NULL THEN
      RAISE EXCEPTION 'item % has costing_method=standard but no standard_cost set', p_item_id;
    END IF;
  END IF;

  FOR v_layer IN
    SELECT cl.*
    FROM cost_layers cl
    LEFT JOIN item_batches ib ON ib.id = cl.batch_id
     WHERE cl.tenant_id = p_tenant_id AND cl.warehouse_id = p_warehouse_id AND cl.item_id = p_item_id
       AND COALESCE(cl.variant_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND cl.quantity_remaining > 0
     ORDER BY ib.expiration_date ASC NULLS LAST, cl.received_at ASC
     FOR UPDATE OF cl
  LOOP
    EXIT WHEN v_remaining_to_consume <= 0;

    v_take := LEAST(v_layer.quantity_remaining, v_remaining_to_consume);

    UPDATE cost_layers SET quantity_remaining = quantity_remaining - v_take WHERE id = v_layer.id;

    v_total_cost := v_total_cost + (v_take * v_layer.unit_cost);
    v_remaining_to_consume := v_remaining_to_consume - v_take;
  END LOOP;

  v_consumed := p_quantity - v_remaining_to_consume;

  IF v_remaining_to_consume > 0 AND NOT p_allow_partial THEN
    RAISE EXCEPTION 'INSUFFICIENT_COST_LAYERS: could not source cost for % of item % at warehouse %',
      v_remaining_to_consume, p_item_id, p_warehouse_id;
  END IF;

  IF v_costing_method = 'standard' THEN
    RETURN v_standard_cost;
  END IF;

  IF v_remaining_to_consume > 0 THEN
    IF v_consumed = 0 THEN
      RETURN 0;
    END IF;
    RETURN ROUND(v_total_cost / v_consumed, 4);
  END IF;

  RETURN ROUND(v_total_cost / p_quantity, 4);
END;
$$ LANGUAGE plpgsql;

-- Gap discovered while wiring 'actual' costing: goods receipts already
-- create an item_batches row for a serialized line (batch_number OR
-- serial_number set) but never created the matching item_serials row —
-- so specific-identification costing had no real data to work with for
-- anything received AFTER migration 109's one-time backfill. Fixed here:
-- same signature as migration 110, additive only (a receipt line with no
-- serial_number behaves exactly as before).
CREATE OR REPLACE FUNCTION fn_post_goods_receipt(
  p_goods_receipt_id UUID,
  p_actor_id         UUID
) RETURNS goods_receipts AS $$
DECLARE
  v_receipt goods_receipts;
  v_line    RECORD;
  v_batch_id UUID;
  v_movement stock_movements;
  v_po_total_ordered NUMERIC;
  v_po_total_received NUMERIC;
  v_landed_by_value  NUMERIC;
  v_landed_by_qty    NUMERIC;
  v_lines_total_value NUMERIC;
  v_lines_total_qty   NUMERIC;
  v_extra_per_unit    NUMERIC;
  v_effective_unit_cost NUMERIC;
BEGIN
  SELECT * INTO v_receipt FROM goods_receipts WHERE id = p_goods_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'goods receipt % not found', p_goods_receipt_id;
  END IF;
  IF v_receipt.status <> 'draft' THEN
    RAISE EXCEPTION 'goods receipt % is not in draft status (status=%)', p_goods_receipt_id, v_receipt.status;
  END IF;

  SELECT COALESCE(SUM(amount) FILTER (WHERE allocation_method = 'by_value'), 0),
         COALESCE(SUM(amount) FILTER (WHERE allocation_method = 'by_quantity'), 0)
    INTO v_landed_by_value, v_landed_by_qty
    FROM landed_costs WHERE goods_receipt_id = p_goods_receipt_id;

  SELECT SUM(quantity_received * unit_cost), SUM(quantity_received)
    INTO v_lines_total_value, v_lines_total_qty
    FROM goods_receipt_items WHERE goods_receipt_id = p_goods_receipt_id;

  FOR v_line IN SELECT * FROM goods_receipt_items WHERE goods_receipt_id = p_goods_receipt_id LOOP
    v_batch_id := NULL;

    v_extra_per_unit :=
      COALESCE(v_landed_by_value * (v_line.quantity_received * v_line.unit_cost) / NULLIF(v_lines_total_value, 0), 0)
      / NULLIF(v_line.quantity_received, 0)
      + COALESCE(v_landed_by_qty * v_line.quantity_received / NULLIF(v_lines_total_qty, 0), 0)
      / NULLIF(v_line.quantity_received, 0);
    v_effective_unit_cost := v_line.unit_cost + COALESCE(v_extra_per_unit, 0);

    IF v_line.batch_number IS NOT NULL OR v_line.serial_number IS NOT NULL THEN
      INSERT INTO item_batches (tenant_id, item_id, variant_id, batch_number, serial_number, expiration_date)
      VALUES (v_receipt.tenant_id, v_line.item_id, v_line.variant_id, v_line.batch_number, v_line.serial_number, v_line.expiration_date)
      RETURNING id INTO v_batch_id;
    END IF;

    IF v_line.serial_number IS NOT NULL THEN
      INSERT INTO item_serials (tenant_id, item_id, variant_id, batch_id, warehouse_id, serial_number, unit_cost)
      VALUES (v_receipt.tenant_id, v_line.item_id, v_line.variant_id, v_batch_id, v_receipt.warehouse_id, v_line.serial_number, v_effective_unit_cost);
    END IF;

    v_movement := fn_apply_stock_movement(
      v_receipt.tenant_id, v_receipt.warehouse_id, NULL, v_line.item_id, v_line.variant_id, v_batch_id,
      'receipt', 'in', v_line.quantity_received, v_effective_unit_cost,
      'goods_receipt', p_goods_receipt_id, p_actor_id
    );

    PERFORM fn_add_cost_layer(
      v_receipt.tenant_id, v_receipt.warehouse_id, v_line.item_id, v_line.variant_id, v_batch_id,
      v_line.quantity_received, v_effective_unit_cost, v_movement.id
    );

    IF v_line.purchase_order_item_id IS NOT NULL THEN
      UPDATE purchase_order_items
         SET quantity_received = quantity_received + v_line.quantity_received
       WHERE id = v_line.purchase_order_item_id;
    END IF;
  END LOOP;

  UPDATE goods_receipts
     SET status = 'posted', received_by = p_actor_id, received_at = NOW(), updated_at = NOW()
   WHERE id = p_goods_receipt_id
   RETURNING * INTO v_receipt;

  IF v_receipt.purchase_order_id IS NOT NULL THEN
    SELECT SUM(quantity_ordered), SUM(quantity_received)
      INTO v_po_total_ordered, v_po_total_received
      FROM purchase_order_items WHERE purchase_order_id = v_receipt.purchase_order_id;

    UPDATE purchase_orders
       SET status = CASE
             WHEN v_po_total_received >= v_po_total_ordered THEN 'received'
             WHEN v_po_total_received > 0 THEN 'partially_received'
             ELSE status
           END,
           updated_at = NOW()
     WHERE id = v_receipt.purchase_order_id;
  END IF;

  PERFORM _emit_domain_event(
    v_receipt.tenant_id, 'inventory.goods_receipt.posted', 'goods_receipt', v_receipt.id,
    jsonb_build_object('purchase_order_id', v_receipt.purchase_order_id, 'warehouse_id', v_receipt.warehouse_id)
  );

  RETURN v_receipt;
END;
$$ LANGUAGE plpgsql;
