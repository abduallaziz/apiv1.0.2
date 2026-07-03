-- Phase 10D critical finding fix: POS sales never touched inventory (stock_movements/
-- stock_levels/cost_layers) despite Inventory Core being fully built. See STATUS.md §61/64
-- and TASKS.md 10D for the full analysis.
--
-- Design decisions (documented in STATUS.md §64):
-- 1. branches.default_warehouse_id (new, nullable) resolves "which warehouse does a sale at
--    this branch deduct from?" explicitly and opt-in. NULL (the default for every existing
--    branch) means "this branch doesn't deduct inventory on sale" — 100% backward compatible,
--    zero behavior change for tenants who haven't configured it.
-- 2. Per-item: items.has_inventory (existing column, defaults false) decides whether a given
--    line item participates in deduction at all — no new item-level flag needed.
-- 3. Deduction is best-effort at the Node service layer (see InvoicesService.create()): a
--    stock/cost-layer problem never blocks a sale from completing. This intentionally does NOT
--    yet enforce "can't oversell" as a hard rule — see STATUS.md §64 for the follow-up
--    recommendation once data quality (real stock levels behind has_inventory=true items) is
--    validated tenant-by-tenant.

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS default_warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;

-- Deducts stock for every has_inventory=true line item of a sale, atomically (all-or-nothing
-- per call — mirrors fn_transfer_dispatch's consume-then-move pattern). Items without
-- has_inventory are silently skipped (services/non-tracked items).
CREATE OR REPLACE FUNCTION fn_process_sale_stock_deduction(
  p_tenant_id    UUID,
  p_warehouse_id UUID,
  p_order_id     UUID,
  p_actor_id     UUID,
  p_items        JSONB -- [{item_id, variant_id, quantity}, ...]
) RETURNS VOID AS $$
DECLARE
  v_item RECORD;
  v_has_inventory BOOLEAN;
  v_unit_cost NUMERIC;
BEGIN
  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_items) AS x(item_id UUID, variant_id UUID, quantity NUMERIC)
  LOOP
    SELECT has_inventory INTO v_has_inventory FROM items WHERE id = v_item.item_id;
    IF NOT COALESCE(v_has_inventory, false) THEN
      CONTINUE;
    END IF;

    v_unit_cost := fn_consume_cost_layers(
      p_tenant_id, p_warehouse_id, v_item.item_id, v_item.variant_id, v_item.quantity
    );

    PERFORM fn_apply_stock_movement(
      p_tenant_id, p_warehouse_id, NULL, v_item.item_id, v_item.variant_id, NULL,
      'sale', 'out', v_item.quantity, v_unit_cost,
      'order', p_order_id, p_actor_id
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Reverses whatever fn_process_sale_stock_deduction actually recorded for this order
-- (naturally a no-op if nothing was deducted — e.g. no default_warehouse_id at sale time,
-- or every line item was non-inventory-tracked).
CREATE OR REPLACE FUNCTION fn_reverse_sale_stock_deduction(
  p_tenant_id UUID,
  p_order_id  UUID,
  p_actor_id  UUID
) RETURNS VOID AS $$
DECLARE
  v_movement RECORD;
BEGIN
  FOR v_movement IN
    SELECT * FROM stock_movements
     WHERE tenant_id = p_tenant_id
       AND reference_type = 'order'
       AND reference_id = p_order_id
       AND movement_type = 'sale'
  LOOP
    PERFORM fn_apply_stock_movement(
      p_tenant_id, v_movement.warehouse_id, v_movement.location_id,
      v_movement.item_id, v_movement.variant_id, v_movement.batch_id,
      'sale_return', 'in', v_movement.quantity, v_movement.unit_cost,
      'order', p_order_id, p_actor_id
    );

    PERFORM fn_add_cost_layer(
      p_tenant_id, v_movement.warehouse_id, v_movement.item_id, v_movement.variant_id,
      v_movement.batch_id, v_movement.quantity, v_movement.unit_cost, NULL
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql;
