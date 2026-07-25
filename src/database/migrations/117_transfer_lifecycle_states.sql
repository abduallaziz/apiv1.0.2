-- Inventory redesign — item #8 completion: full transfer lifecycle.
-- Today: 4 states (draft/in_transit/completed/cancelled) — no approval
-- gate before dispatch, and "received" + "completed" are conflated into
-- one step (fn_transfer_receive sets status='completed' directly).
--
-- Company-to-company transfers are explicitly OUT of scope here: this
-- system has no `companies` table — tenant_id IS the company/org
-- boundary, and a real cross-tenant transfer would mean crossing RLS
-- tenant isolation itself, a much bigger and riskier decision than
-- widening a status enum. Not guessed at; flagged for a deliberate
-- decision later. Branch-to-branch already works today (warehouses.
-- branch_id is unconstrained in the dispatch/receive RPCs), so nothing
-- new is needed there.

ALTER TABLE stock_transfers ADD COLUMN approved_by UUID REFERENCES users(id);
ALTER TABLE stock_transfers ADD COLUMN approved_at TIMESTAMPTZ;
ALTER TABLE stock_transfers ADD COLUMN completed_by UUID REFERENCES users(id);
ALTER TABLE stock_transfers ADD COLUMN completed_at TIMESTAMPTZ;

ALTER TABLE stock_transfers DROP CONSTRAINT stock_transfers_status_check;
ALTER TABLE stock_transfers ADD CONSTRAINT stock_transfers_status_check
  CHECK (status IN ('draft', 'approved', 'in_transit', 'received', 'completed', 'cancelled'));

-- New pure status gate before dispatch — no stock movement here.
CREATE OR REPLACE FUNCTION fn_transfer_approve(
  p_transfer_id UUID,
  p_actor_id    UUID
) RETURNS stock_transfers AS $$
DECLARE
  v_transfer stock_transfers;
BEGIN
  SELECT * INTO v_transfer FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transfer % not found', p_transfer_id;
  END IF;
  IF v_transfer.status <> 'draft' THEN
    RAISE EXCEPTION 'transfer % is not in draft status (status=%)', p_transfer_id, v_transfer.status;
  END IF;

  UPDATE stock_transfers
     SET status = 'approved', approved_by = p_actor_id, approved_at = NOW()
   WHERE id = p_transfer_id
   RETURNING * INTO v_transfer;

  PERFORM _emit_domain_event(
    v_transfer.tenant_id, 'inventory.transfer.approved', 'stock_transfer', v_transfer.id, '{}'::jsonb
  );

  RETURN v_transfer;
END;
$$ LANGUAGE plpgsql;

-- Dispatch now requires 'approved' instead of 'draft' — the real new
-- business rule this item exists to add. Stock-movement body (consume
-- cost layers + transfer_out) is byte-for-byte unchanged from
-- 032_location_aware_inventory_ops.sql, only the precondition and the
-- (still correct) target status 'in_transit' stay as before.
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
  IF v_transfer.status <> 'approved' THEN
    RAISE EXCEPTION 'transfer % is not approved (status=%)', p_transfer_id, v_transfer.status;
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
    v_transfer.tenant_id, 'inventory.transfer.dispatched', 'stock_transfer', v_transfer.id, '{}'::jsonb
  );

  RETURN v_transfer;
END;
$$ LANGUAGE plpgsql;

-- Receive: unchanged stock-movement body (transfer_in + add cost layer),
-- but now lands on 'received' instead of jumping straight to
-- 'completed' — physically-arrived and administratively-closed are
-- distinct facts.
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
     SET status = 'received', received_by = p_actor_id, received_at = NOW()
   WHERE id = p_transfer_id
   RETURNING * INTO v_transfer;

  PERFORM _emit_domain_event(
    v_transfer.tenant_id, 'inventory.transfer.received', 'stock_transfer', v_transfer.id, '{}'::jsonb
  );

  RETURN v_transfer;
END;
$$ LANGUAGE plpgsql;

-- New: administrative closure after receipt — no stock movement, just
-- marks the transfer document reconciled/closed.
CREATE OR REPLACE FUNCTION fn_transfer_complete(
  p_transfer_id UUID,
  p_actor_id    UUID
) RETURNS stock_transfers AS $$
DECLARE
  v_transfer stock_transfers;
BEGIN
  SELECT * INTO v_transfer FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transfer % not found', p_transfer_id;
  END IF;
  IF v_transfer.status <> 'received' THEN
    RAISE EXCEPTION 'transfer % is not received (status=%)', p_transfer_id, v_transfer.status;
  END IF;

  UPDATE stock_transfers
     SET status = 'completed', completed_by = p_actor_id, completed_at = NOW()
   WHERE id = p_transfer_id
   RETURNING * INTO v_transfer;

  PERFORM _emit_domain_event(
    v_transfer.tenant_id, 'inventory.transfer.completed', 'stock_transfer', v_transfer.id, '{}'::jsonb
  );

  RETURN v_transfer;
END;
$$ LANGUAGE plpgsql;
