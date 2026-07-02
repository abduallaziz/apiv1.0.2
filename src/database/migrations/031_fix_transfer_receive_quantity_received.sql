-- fn_transfer_receive wrote to stock_transfer_items.quantity_received, a column
-- that was never added to the table (only purchase_order_items and
-- goods_receipt_items have it). This caused every Receive call to fail with
-- "column \"quantity_received\" does not exist". Nothing in the codebase reads
-- this column, so drop the dead write instead of adding an unused column.

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
      v_transfer.tenant_id, v_transfer.to_warehouse_id, NULL, v_line.item_id, v_line.variant_id, v_line.batch_id,
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
