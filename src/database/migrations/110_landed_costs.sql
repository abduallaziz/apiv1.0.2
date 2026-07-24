-- Inventory redesign — Part A item #15 continuation: Landed cost +
-- additional costing methods.

ALTER TABLE items DROP CONSTRAINT items_costing_method_check;
ALTER TABLE items ADD CONSTRAINT items_costing_method_check
  CHECK (costing_method IN ('fifo', 'average', 'moving_average', 'standard', 'actual'));
-- Note: fn_add_cost_layer/fn_consume_cost_layers only special-case 'average'
-- today (weighted-average merge vs FIFO layers). The 3 new enum values are
-- schema-level support for tenants to declare intent; wiring distinct
-- consumption behavior for moving_average/standard/actual into those
-- functions is real additional work, not done here — flagging honestly
-- rather than implying it's fully wired end-to-end.

-- One row per shipping/customs/insurance/other charge on a goods receipt,
-- allocated across that receipt's line items into their unit cost —
-- baked in AT RECEIPT TIME (not a post-hoc cost_layers correction), since
-- 'average' costing merges into an existing layer with no way to trace
-- back which layer came from which receipt line afterward.
CREATE TABLE landed_costs (
  id                 UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  goods_receipt_id   UUID          NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  cost_type          TEXT          NOT NULL CHECK (cost_type IN ('shipping', 'customs', 'insurance', 'other')),
  amount             NUMERIC(14,4) NOT NULL CHECK (amount >= 0),
  allocation_method  TEXT          NOT NULL DEFAULT 'by_value' CHECK (allocation_method IN ('by_value', 'by_quantity')),
  notes              TEXT,
  created_by         UUID          REFERENCES users(id),
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_landed_costs_receipt ON landed_costs(goods_receipt_id);

ALTER TABLE landed_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON landed_costs
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.landed_costs TO service_role;

-- landed_costs rows must exist BEFORE the receipt is posted (this is a
-- draft-only concept — once posted, cost_layers are already written and
-- retroactively editing them for 'average'-costed items isn't safely
-- traceable, per the comment above). Enforced at the application layer,
-- not a DB constraint, matching how draft-only editability is handled
-- elsewhere in this codebase (e.g. purchase_orders status gates).

-- CREATE OR REPLACE with the IDENTICAL signature as migration 019 (same
-- 2 params) — a receipt with zero landed_costs rows behaves byte-for-byte
-- as before (all the allocation math below multiplies by zero).
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

    IF v_line.batch_number IS NOT NULL OR v_line.serial_number IS NOT NULL THEN
      INSERT INTO item_batches (tenant_id, item_id, variant_id, batch_number, serial_number, expiration_date)
      VALUES (v_receipt.tenant_id, v_line.item_id, v_line.variant_id, v_line.batch_number, v_line.serial_number, v_line.expiration_date)
      RETURNING id INTO v_batch_id;
    END IF;

    v_extra_per_unit :=
      COALESCE(v_landed_by_value * (v_line.quantity_received * v_line.unit_cost) / NULLIF(v_lines_total_value, 0), 0)
      / NULLIF(v_line.quantity_received, 0)
      + COALESCE(v_landed_by_qty * v_line.quantity_received / NULLIF(v_lines_total_qty, 0), 0)
      / NULLIF(v_line.quantity_received, 0);
    v_effective_unit_cost := v_line.unit_cost + COALESCE(v_extra_per_unit, 0);

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
