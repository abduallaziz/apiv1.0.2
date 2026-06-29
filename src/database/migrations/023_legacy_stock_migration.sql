-- =============================================================================
-- 023. LEGACY STOCK MIGRATION
-- One-time backfill of item_variants.stock_quantity into the new inventory
-- source of truth (stock_levels/stock_movements/cost_layers), then enforces
-- at the database level that stock_quantity can never again be written by
-- application code — it becomes a frozen historical snapshot.
--
-- item_variants.stock_quantity has no warehouse dimension. Every tenant that
-- has any positive legacy quantity gets a single "Main Warehouse" (code
-- 'MAIN') created if it doesn't already have at least one active warehouse;
-- the backfill seeds all legacy quantity there as a 'receipt' movement with
-- reference_type 'legacy_migration', going through fn_apply_stock_movement
-- and fn_add_cost_layer exactly as a real goods receipt would, so the
-- resulting stock_levels/cost_layers rows are indistinguishable from
-- normal operation.
-- =============================================================================

DO $$
DECLARE
  v_tenant   RECORD;
  v_variant  RECORD;
  v_warehouse_id UUID;
  v_movement stock_movements;
BEGIN
  FOR v_tenant IN
    SELECT DISTINCT i.tenant_id
      FROM item_variants iv
      JOIN items i ON i.id = iv.item_id
     WHERE iv.stock_quantity > 0
       AND iv.deleted_at IS NULL
  LOOP
    SELECT id INTO v_warehouse_id
      FROM warehouses
     WHERE tenant_id = v_tenant.tenant_id
       AND deleted_at IS NULL
       AND is_active = true
     ORDER BY created_at
     LIMIT 1;

    IF v_warehouse_id IS NULL THEN
      INSERT INTO warehouses (tenant_id, code, name)
      VALUES (v_tenant.tenant_id, 'MAIN', 'Main Warehouse')
      RETURNING id INTO v_warehouse_id;
    END IF;

    FOR v_variant IN
      SELECT iv.id AS variant_id, iv.item_id, iv.stock_quantity,
             COALESCE(i.cost_price, 0) AS unit_cost
        FROM item_variants iv
        JOIN items i ON i.id = iv.item_id
       WHERE i.tenant_id = v_tenant.tenant_id
         AND iv.stock_quantity > 0
         AND iv.deleted_at IS NULL
    LOOP
      v_movement := fn_apply_stock_movement(
        v_tenant.tenant_id,
        v_warehouse_id,
        NULL,
        v_variant.item_id,
        v_variant.variant_id,
        NULL,
        'receipt',
        'in',
        v_variant.stock_quantity,
        v_variant.unit_cost,
        'legacy_migration',
        v_variant.variant_id,
        NULL,
        false
      );

      PERFORM fn_add_cost_layer(
        v_tenant.tenant_id,
        v_warehouse_id,
        v_variant.item_id,
        v_variant.variant_id,
        NULL,
        v_variant.stock_quantity,
        v_variant.unit_cost,
        v_movement.id
      );
    END LOOP;
  END LOOP;
END;
$$;

-- Freeze the legacy column: from this point on, no UPDATE may change its
-- value (application code must go through Inventory RPCs instead). The
-- backfill above ran before this trigger exists, so it is unaffected.
CREATE OR REPLACE FUNCTION fn_block_legacy_stock_quantity_write() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'item_variants.stock_quantity is legacy and frozen — use the Inventory module (stock_levels/stock_movements) instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_item_variants_freeze_stock_quantity
  BEFORE UPDATE ON item_variants
  FOR EACH ROW
  WHEN (NEW.stock_quantity IS DISTINCT FROM OLD.stock_quantity)
  EXECUTE FUNCTION fn_block_legacy_stock_quantity_write();

CREATE TRIGGER trg_item_variants_freeze_stock_quantity_insert
  BEFORE INSERT ON item_variants
  FOR EACH ROW
  WHEN (NEW.stock_quantity IS NOT NULL AND NEW.stock_quantity <> 0)
  EXECUTE FUNCTION fn_block_legacy_stock_quantity_write();

ALTER TABLE item_variants ALTER COLUMN stock_quantity SET DEFAULT 0;
