-- Inventory redesign — item #8 clarification: the user does not need
-- company-to-company transfers (explicitly declined, out of scope by
-- design — see migration 117 comment). What's actually missing:
-- location-to-location and shelf/bin-to-shelf/bin transfers WITHIN the
-- same warehouse — today blocked outright by
-- chk_transfer_different_warehouses (from_warehouse_id <> to_warehouse_id
-- on the header). Warehouse<->warehouse and branch<->branch already work
-- (confirmed: dispatch/receive never check branch_id).
--
-- from_location_id/to_location_id already exist on stock_transfer_items
-- (migration 032) and the existing fn_transfer_dispatch/fn_transfer_receive
-- already move stock at (warehouse, location) granularity via
-- fn_apply_stock_movement's p_location_id param — cost_layers stays
-- warehouse-scoped (not location-scoped) but that's fine for an
-- intra-warehouse move: consuming X and immediately re-adding X at the
-- same warehouse nets to zero change in total warehouse valuation,
-- exactly matching reality (nothing left or entered the warehouse).
-- So NO change is needed to either RPC — only the constraint blocking
-- same-warehouse transfers needs to go, replaced by a real guarantee
-- that a same-warehouse transfer always specifies two DIFFERENT real
-- locations (never a same-warehouse, same-or-no-location no-op).

ALTER TABLE stock_transfers DROP CONSTRAINT chk_transfer_different_warehouses;

-- The replacement rule spans two tables (header's warehouse ids, line's
-- location ids), which a plain CHECK can't express — enforced via
-- trigger instead, same pattern as fn_validate_location_hierarchy
-- (migration 097).
CREATE OR REPLACE FUNCTION fn_validate_transfer_item_locations() RETURNS TRIGGER AS $$
DECLARE
  v_transfer stock_transfers;
BEGIN
  SELECT * INTO v_transfer FROM stock_transfers WHERE id = NEW.stock_transfer_id;

  IF v_transfer.from_warehouse_id = v_transfer.to_warehouse_id THEN
    IF NEW.from_location_id IS NULL OR NEW.to_location_id IS NULL THEN
      RAISE EXCEPTION 'an intra-warehouse transfer line requires both from_location_id and to_location_id';
    END IF;
    IF NEW.from_location_id = NEW.to_location_id THEN
      RAISE EXCEPTION 'an intra-warehouse transfer line must move between two different locations';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_transfer_item_locations
  BEFORE INSERT OR UPDATE ON stock_transfer_items
  FOR EACH ROW EXECUTE FUNCTION fn_validate_transfer_item_locations();
