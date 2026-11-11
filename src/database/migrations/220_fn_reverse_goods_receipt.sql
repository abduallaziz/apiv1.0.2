-- 220. Inventory Stage 1 / I4 (Owner-approved) — posted goods receipt
-- reversal. Previously GoodsReceiptsRepository.cancel() only permitted
-- cancelling a receipt still in 'draft' status; once fn_post_goods_receipt
-- had run (stock deducted^H^H^Hadded, cost layers created, PO quantities
-- updated), there was no supported way to undo it — confirmed absence, not
-- just an untested gap, by grepping the whole migrations tree for a
-- companion fn_reverse_goods_receipt/fn_cancel_posted_goods_receipt, which
-- does not exist before this migration.
--
-- Mirrors the existing fn_reverse_sale_stock_deduction pattern (043):
-- for each stock_movements row this receipt created, reverse the physical
-- stock movement via fn_apply_stock_movement, and undo the cost-layer
-- effect. Unlike the sale-reversal case, cost-layer undo for a receipt is
-- NOT always safe/well-defined — deliberately scoped to only the safe
-- case:
--   * FIFO/standard/actual costing: fn_add_cost_layer always creates a
--     discrete cost_layers row with source_movement_id = the receiving
--     movement's id. If that exact layer still has quantity_remaining >=
--     what was received (i.e. nothing from it has been sold/consumed
--     since), it can be exactly undone by reducing it back down.
--   * average/moving_average costing: fn_add_cost_layer MERGES into the
--     tenant's single open layer for that item/warehouse/variant when one
--     already exists, overwriting unit_cost with a blended value — the
--     original pre-merge unit_cost is not recoverable from the row alone,
--     so an exact reversal is mathematically undefined once merged into a
--     pre-existing layer. This function detects that case (no cost_layers
--     row exists with source_movement_id = this receiving movement's id —
--     it was merged into an older layer instead) and REJECTS the reversal
--     with a clear error rather than attempting a lossy/incorrect un-merge.
--   * Partial consumption since receipt (quantity_remaining < what was
--     received): also rejected with a clear error — the physical units are
--     already gone, so "un-receiving" them would corrupt the ledger.
-- Both rejection cases require a manual inventory adjustment instead,
-- which is the correct tool for a business event this function cannot
-- safely represent as a pure reversal — not something to invent here.
--
-- Idempotent: only 'posted' receipts can be reversed (status re-checked
-- under FOR UPDATE the same way fn_post_goods_receipt guards 'draft'), so
-- a second reversal attempt on an already-'reversed' receipt is rejected
-- outright, never double-reverses.

ALTER TABLE goods_receipts DROP CONSTRAINT goods_receipts_status_check;
ALTER TABLE goods_receipts ADD CONSTRAINT goods_receipts_status_check
  CHECK (status IN ('draft', 'posted', 'cancelled', 'reversed'));

CREATE OR REPLACE FUNCTION fn_reverse_goods_receipt(
  p_goods_receipt_id UUID,
  p_actor_id         UUID
) RETURNS goods_receipts AS $$
DECLARE
  v_receipt  goods_receipts;
  v_movement RECORD;
  v_layer    cost_layers;
  v_po_total_ordered  NUMERIC;
  v_po_total_received NUMERIC;
BEGIN
  SELECT * INTO v_receipt FROM goods_receipts WHERE id = p_goods_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'goods receipt % not found', p_goods_receipt_id;
  END IF;
  IF v_receipt.status <> 'posted' THEN
    RAISE EXCEPTION 'goods receipt % is not posted (status=%) — only a posted receipt can be reversed', p_goods_receipt_id, v_receipt.status;
  END IF;

  -- Pre-flight: verify every affected cost layer is safely reversible
  -- BEFORE mutating anything, so a rejection never leaves a partially
  -- reversed receipt.
  FOR v_movement IN
    SELECT * FROM stock_movements
     WHERE tenant_id = v_receipt.tenant_id
       AND reference_type = 'goods_receipt'
       AND reference_id = p_goods_receipt_id
       AND movement_type = 'receipt'
  LOOP
    SELECT * INTO v_layer FROM cost_layers WHERE source_movement_id = v_movement.id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'GOODS_RECEIPT_REVERSAL_UNSAFE: item % on receipt % was merged into a pre-existing average-cost layer and has no discrete layer of its own — reverse via a manual inventory adjustment instead',
        v_movement.item_id, p_goods_receipt_id;
    END IF;
    IF v_layer.quantity_remaining < v_movement.quantity THEN
      RAISE EXCEPTION 'GOODS_RECEIPT_REVERSAL_UNSAFE: item % on receipt % has only % of % units remaining — some have already been consumed, reverse via a manual inventory adjustment instead',
        v_movement.item_id, p_goods_receipt_id, v_layer.quantity_remaining, v_movement.quantity;
    END IF;
  END LOOP;

  -- Safe to reverse every line.
  FOR v_movement IN
    SELECT * FROM stock_movements
     WHERE tenant_id = v_receipt.tenant_id
       AND reference_type = 'goods_receipt'
       AND reference_id = p_goods_receipt_id
       AND movement_type = 'receipt'
  LOOP
    PERFORM fn_apply_stock_movement(
      v_receipt.tenant_id, v_movement.warehouse_id, v_movement.location_id,
      v_movement.item_id, v_movement.variant_id, v_movement.batch_id,
      'adjustment_out', 'out', v_movement.quantity, v_movement.unit_cost,
      'goods_receipt', p_goods_receipt_id, p_actor_id
    );

    -- A layer with source_movement_id = this movement's id was created
    -- SOLELY by this receipt (fn_add_cost_layer never merges for
    -- fifo/standard/actual costing — only average/moving_average merges,
    -- and that case was already rejected in the pre-flight check above).
    -- The pre-flight check already proved quantity_remaining >=
    -- v_movement.quantity, and since nothing else can have added to this
    -- specific layer, quantity_received is exactly v_movement.quantity —
    -- reversing it in full means the row should cease to exist, not be
    -- UPDATEd to quantity_received=0 (which cost_layers' own
    -- CHECK (quantity_received > 0) correctly forbids — that constraint
    -- exists precisely because a zero-quantity layer isn't a real layer).
    DELETE FROM cost_layers WHERE source_movement_id = v_movement.id;

    IF v_movement.reference_type = 'goods_receipt' THEN
      -- Revert the PO line's received quantity, mirroring the increment
      -- fn_post_goods_receipt applied.
      UPDATE purchase_order_items poi
         SET quantity_received = poi.quantity_received - gri.quantity_received
        FROM goods_receipt_items gri
       WHERE gri.goods_receipt_id = p_goods_receipt_id
         AND gri.item_id = v_movement.item_id
         AND poi.id = gri.purchase_order_item_id
         AND (gri.variant_id = v_movement.variant_id OR (gri.variant_id IS NULL AND v_movement.variant_id IS NULL));
    END IF;
  END LOOP;

  UPDATE goods_receipts
     SET status = 'reversed', updated_at = NOW()
   WHERE id = p_goods_receipt_id
   RETURNING * INTO v_receipt;

  IF v_receipt.purchase_order_id IS NOT NULL THEN
    SELECT SUM(quantity_ordered), SUM(quantity_received)
      INTO v_po_total_ordered, v_po_total_received
      FROM purchase_order_items WHERE purchase_order_id = v_receipt.purchase_order_id;

    -- Same CASE structure fn_post_goods_receipt itself uses (111) — ELSE
    -- status (no forced value) rather than guessing a specific prior
    -- status this function has no way to know.
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
    v_receipt.tenant_id, 'inventory.goods_receipt.reversed', 'goods_receipt', v_receipt.id,
    jsonb_build_object('purchase_order_id', v_receipt.purchase_order_id, 'warehouse_id', v_receipt.warehouse_id)
  );

  RETURN v_receipt;
END;
$$ LANGUAGE plpgsql;
