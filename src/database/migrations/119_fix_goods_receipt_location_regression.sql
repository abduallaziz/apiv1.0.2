-- Real regression found live while verifying migration 118
-- (intra-warehouse transfers): fn_post_goods_receipt was rewritten in
-- migration 111 (landed cost / serials work, earlier this session) and
-- silently hardcoded p_location_id=NULL in its fn_apply_stock_movement
-- call, instead of passing v_line.location_id through as migration 032
-- originally did. Every goods receipt posted since 111 landed its stock
-- at warehouse level (location_id NULL) even when a receiving line
-- explicitly specified a location — confirmed live: a receipt with
-- location_id=<shelf A> produced a stock_levels row with location_id=NULL
-- instead. Only the one line changed below; everything else is
-- byte-for-byte identical to the 111 version (same signature, same
-- landed-cost/serial logic, untouched).

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
      v_receipt.tenant_id, v_receipt.warehouse_id, v_line.location_id, v_line.item_id, v_line.variant_id, v_batch_id,
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
