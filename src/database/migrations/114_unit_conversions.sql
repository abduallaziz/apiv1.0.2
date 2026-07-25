-- Inventory redesign — item #3 completion: units + conversion factors
-- ("1 carton = 24 pieces"). `units` (migration 093) was flat reference
-- data only, with zero connection to items and zero conversion concept.
--
-- Design: stock is always tracked in the item's storage_unit (the same
-- single unit stock_levels/stock_movements/cost_layers already use
-- today, unchanged) — purchase_unit/sale_unit are just alternate units
-- a human can enter a quantity in, each with its own conversion factor
-- back to the storage unit. Conversion happens once at the data-entry
-- boundary (goods-receipt creation); the existing, already-tested
-- fn_post_goods_receipt/fn_apply_stock_movement/fn_add_cost_layer chain
-- is never touched and never becomes unit-aware itself.

ALTER TABLE items ADD COLUMN storage_unit_id UUID REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN purchase_unit_id UUID REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN purchase_unit_factor NUMERIC(14,4) NOT NULL DEFAULT 1 CHECK (purchase_unit_factor > 0);
ALTER TABLE items ADD COLUMN sale_unit_id UUID REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN sale_unit_factor NUMERIC(14,4) NOT NULL DEFAULT 1 CHECK (sale_unit_factor > 0);

-- Audit-only: which unit the human actually entered the line in.
-- quantity_ordered/quantity_received/unit_cost on these tables keep
-- meaning exactly what they mean today (storage-unit terms) — conversion
-- already happened before the row was written, so no existing reader of
-- these tables (reports, RPCs) needs to change.
ALTER TABLE purchase_order_items ADD COLUMN unit_id UUID REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE goods_receipt_items ADD COLUMN unit_id UUID REFERENCES units(id) ON DELETE SET NULL;

-- Converts a quantity entered in p_unit_id into the item's storage-unit
-- equivalent. NULL p_unit_id (or a unit equal to the item's own
-- storage_unit_id) is a no-op passthrough — existing callers that never
-- pass a unit keep working identically. Raises if the unit given isn't
-- one of the item's configured purchase/sale/storage units, rather than
-- silently guessing a factor.
CREATE OR REPLACE FUNCTION fn_convert_to_storage_unit(
  p_item_id UUID,
  p_quantity NUMERIC,
  p_unit_id UUID
) RETURNS NUMERIC AS $$
DECLARE
  v_item items;
BEGIN
  IF p_unit_id IS NULL THEN
    RETURN p_quantity;
  END IF;

  SELECT * INTO v_item FROM items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item % not found', p_item_id;
  END IF;

  IF p_unit_id = v_item.storage_unit_id OR v_item.storage_unit_id IS NULL THEN
    RETURN p_quantity;
  ELSIF p_unit_id = v_item.purchase_unit_id THEN
    RETURN p_quantity * v_item.purchase_unit_factor;
  ELSIF p_unit_id = v_item.sale_unit_id THEN
    RETURN p_quantity * v_item.sale_unit_factor;
  ELSE
    RAISE EXCEPTION 'unit % is not configured as a storage/purchase/sale unit for item %', p_unit_id, p_item_id;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;
