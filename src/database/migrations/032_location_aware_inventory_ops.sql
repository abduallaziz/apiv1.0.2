-- Make Transfers, Stock Adjustments, and Goods Receipts location-aware.
-- Previously fn_apply_stock_movement was always called with a hardcoded
-- NULL location_id for these flows, so stock_levels.location_id never got
-- populated outside of Stock Count corrections. Add nullable, FK-checked
-- location_id columns at the line-item level so each module can optionally
-- record which bin/zone within the warehouse stock moved to/from.
--
-- The function bodies below are otherwise byte-for-byte identical to
-- 019_inventory_rpc_functions.sql — only the location_id argument passed to
-- fn_apply_stock_movement changes, from a hardcoded NULL to the new column.

ALTER TABLE stock_transfer_items
  ADD COLUMN IF NOT EXISTS from_location_id UUID REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS to_location_id   UUID REFERENCES warehouse_locations(id) ON DELETE SET NULL;

ALTER TABLE stock_adjustments
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES warehouse_locations(id) ON DELETE SET NULL;

ALTER TABLE goods_receipt_items
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES warehouse_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transfer_items_from_location ON stock_transfer_items(from_location_id) WHERE from_location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transfer_items_to_location   ON stock_transfer_items(to_location_id) WHERE to_location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_adjustments_location         ON stock_adjustments(location_id) WHERE location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_goods_receipt_items_location ON goods_receipt_items(location_id) WHERE location_id IS NOT NULL;

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
BEGIN
  SELECT * INTO v_receipt FROM goods_receipts WHERE id = p_goods_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'goods receipt % not found', p_goods_receipt_id;
  END IF;
  IF v_receipt.status <> 'draft' THEN
    RAISE EXCEPTION 'goods receipt % is not in draft status (status=%)', p_goods_receipt_id, v_receipt.status;
  END IF;

  FOR v_line IN SELECT * FROM goods_receipt_items WHERE goods_receipt_id = p_goods_receipt_id LOOP
    v_batch_id := NULL;

    IF v_line.batch_number IS NOT NULL OR v_line.serial_number IS NOT NULL THEN
      INSERT INTO item_batches (tenant_id, item_id, variant_id, batch_number, serial_number, expiration_date)
      VALUES (v_receipt.tenant_id, v_line.item_id, v_line.variant_id, v_line.batch_number, v_line.serial_number, v_line.expiration_date)
      RETURNING id INTO v_batch_id;
    END IF;

    v_movement := fn_apply_stock_movement(
      v_receipt.tenant_id, v_receipt.warehouse_id, v_line.location_id, v_line.item_id, v_line.variant_id, v_batch_id,
      'receipt', 'in', v_line.quantity_received, v_line.unit_cost,
      'goods_receipt', p_goods_receipt_id, p_actor_id
    );

    PERFORM fn_add_cost_layer(
      v_receipt.tenant_id, v_receipt.warehouse_id, v_line.item_id, v_line.variant_id, v_batch_id,
      v_line.quantity_received, v_line.unit_cost, v_movement.id
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

CREATE OR REPLACE FUNCTION fn_transfer_dispatch(
  p_transfer_id UUID,
  p_actor_id    UUID
) RETURNS stock_transfers AS $$
DECLARE
  v_transfer stock_transfers;
  v_line     RECORD;
  v_unit_cost NUMERIC;
BEGIN
  SELECT * INTO v_transfer FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transfer % not found', p_transfer_id;
  END IF;
  IF v_transfer.status <> 'draft' THEN
    RAISE EXCEPTION 'transfer % is not in draft status (status=%)', p_transfer_id, v_transfer.status;
  END IF;

  FOR v_line IN SELECT * FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id LOOP
    v_unit_cost := fn_consume_cost_layers(
      v_transfer.tenant_id, v_transfer.from_warehouse_id, v_line.item_id, v_line.variant_id, v_line.quantity
    );

    PERFORM fn_apply_stock_movement(
      v_transfer.tenant_id, v_transfer.from_warehouse_id, v_line.from_location_id, v_line.item_id, v_line.variant_id, v_line.batch_id,
      'transfer_out', 'out', v_line.quantity, v_unit_cost,
      'stock_transfer', p_transfer_id, p_actor_id
    );

    UPDATE stock_transfer_items SET dispatched_unit_cost = v_unit_cost WHERE id = v_line.id;
  END LOOP;

  UPDATE stock_transfers
     SET status = 'in_transit', dispatched_by = p_actor_id, dispatched_at = NOW()
   WHERE id = p_transfer_id
   RETURNING * INTO v_transfer;

  PERFORM _emit_domain_event(
    v_transfer.tenant_id, 'inventory.transfer.dispatched', 'stock_transfer', v_transfer.id,
    jsonb_build_object('from_warehouse_id', v_transfer.from_warehouse_id, 'to_warehouse_id', v_transfer.to_warehouse_id)
  );

  RETURN v_transfer;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_transfer_receive(
  p_transfer_id UUID,
  p_actor_id    UUID
) RETURNS stock_transfers AS $$
DECLARE
  v_transfer stock_transfers;
  v_line     RECORD;
  v_movement stock_movements;
BEGIN
  SELECT * INTO v_transfer FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transfer % not found', p_transfer_id;
  END IF;
  IF v_transfer.status <> 'in_transit' THEN
    RAISE EXCEPTION 'transfer % is not in_transit (status=%)', p_transfer_id, v_transfer.status;
  END IF;

  FOR v_line IN SELECT * FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id LOOP
    v_movement := fn_apply_stock_movement(
      v_transfer.tenant_id, v_transfer.to_warehouse_id, v_line.to_location_id, v_line.item_id, v_line.variant_id, v_line.batch_id,
      'transfer_in', 'in', v_line.quantity, v_line.dispatched_unit_cost,
      'stock_transfer', p_transfer_id, p_actor_id
    );

    PERFORM fn_add_cost_layer(
      v_transfer.tenant_id, v_transfer.to_warehouse_id, v_line.item_id, v_line.variant_id, v_line.batch_id,
      v_line.quantity, v_line.dispatched_unit_cost, v_movement.id
    );
  END LOOP;

  UPDATE stock_transfers
     SET status = 'completed', received_by = p_actor_id, received_at = NOW()
   WHERE id = p_transfer_id
   RETURNING * INTO v_transfer;

  PERFORM _emit_domain_event(
    v_transfer.tenant_id, 'inventory.transfer.completed', 'stock_transfer', v_transfer.id,
    jsonb_build_object('from_warehouse_id', v_transfer.from_warehouse_id, 'to_warehouse_id', v_transfer.to_warehouse_id)
  );

  RETURN v_transfer;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_post_stock_adjustment(
  p_adjustment_id UUID,
  p_actor_id      UUID
) RETURNS stock_adjustments AS $$
DECLARE
  v_adj stock_adjustments;
  v_unit_cost NUMERIC;
  v_movement stock_movements;
BEGIN
  SELECT * INTO v_adj FROM stock_adjustments WHERE id = p_adjustment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'adjustment % not found', p_adjustment_id;
  END IF;
  IF v_adj.status NOT IN ('pending_approval', 'approved') THEN
    RAISE EXCEPTION 'adjustment % cannot be posted from status %', p_adjustment_id, v_adj.status;
  END IF;
  IF v_adj.requires_approval AND v_adj.status <> 'approved' THEN
    RAISE EXCEPTION 'adjustment % requires approval before posting', p_adjustment_id;
  END IF;

  IF v_adj.quantity_delta > 0 THEN
    v_unit_cost := COALESCE(v_adj.unit_cost, (SELECT cost_price FROM items WHERE id = v_adj.item_id), 0);

    v_movement := fn_apply_stock_movement(
      v_adj.tenant_id, v_adj.warehouse_id, v_adj.location_id, v_adj.item_id, v_adj.variant_id, v_adj.batch_id,
      'adjustment_in', 'in', v_adj.quantity_delta, v_unit_cost,
      'stock_adjustment', p_adjustment_id, p_actor_id
    );

    PERFORM fn_add_cost_layer(
      v_adj.tenant_id, v_adj.warehouse_id, v_adj.item_id, v_adj.variant_id, v_adj.batch_id,
      v_adj.quantity_delta, v_unit_cost, v_movement.id
    );
  ELSE
    v_unit_cost := fn_consume_cost_layers(
      v_adj.tenant_id, v_adj.warehouse_id, v_adj.item_id, v_adj.variant_id, ABS(v_adj.quantity_delta)
    );

    PERFORM fn_apply_stock_movement(
      v_adj.tenant_id, v_adj.warehouse_id, v_adj.location_id, v_adj.item_id, v_adj.variant_id, v_adj.batch_id,
      'adjustment_out', 'out', ABS(v_adj.quantity_delta), v_unit_cost,
      'stock_adjustment', p_adjustment_id, p_actor_id
    );
  END IF;

  UPDATE stock_adjustments
     SET status = 'posted', posted_at = NOW()
   WHERE id = p_adjustment_id
   RETURNING * INTO v_adj;

  PERFORM _emit_domain_event(
    v_adj.tenant_id, 'inventory.adjustment.posted', 'stock_adjustment', v_adj.id,
    jsonb_build_object('item_id', v_adj.item_id, 'warehouse_id', v_adj.warehouse_id, 'quantity_delta', v_adj.quantity_delta)
  );

  RETURN v_adj;
END;
$$ LANGUAGE plpgsql;
