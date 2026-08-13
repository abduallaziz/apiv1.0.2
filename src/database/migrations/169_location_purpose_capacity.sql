-- Migration 13.20 Part 1 — Location Management completion.
--
-- location_purpose is additive alongside the EXISTING structural
-- location_type (zone/aisle/rack/shelf/bin, migration 097) — a location
-- carries both: WHERE it sits in the hierarchy (location_type) and WHAT
-- it's used for (location_purpose). Both nullable; every existing row
-- stays valid with purpose=NULL.

ALTER TABLE warehouse_locations
  ADD COLUMN location_purpose TEXT CHECK (location_purpose IN (
    'receiving', 'storage', 'picking', 'packing', 'quality_hold', 'damaged', 'shipping'
  ));

ALTER TABLE warehouse_locations
  ADD COLUMN max_quantity NUMERIC(14,4) CHECK (max_quantity IS NULL OR max_quantity > 0),
  ADD COLUMN max_weight   NUMERIC(14,4) CHECK (max_weight IS NULL OR max_weight > 0),
  ADD COLUMN max_volume   NUMERIC(14,4) CHECK (max_volume IS NULL OR max_volume > 0);

CREATE INDEX idx_locations_purpose ON warehouse_locations(tenant_id, warehouse_id, location_purpose) WHERE location_purpose IS NOT NULL;

-- Storage restrictions: which items/categories a location is allowed to
-- hold. A location with zero rows here has no restriction (any item can be
-- stored). A row with item_id set restricts to that exact item; a row with
-- category_id set restricts to that category — same sparse-filter pattern
-- used by quality_rules/inventory_reorder_points elsewhere in this schema.
CREATE TABLE warehouse_location_restrictions (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id UUID        NOT NULL REFERENCES warehouse_locations(id) ON DELETE CASCADE,
  item_id     UUID        REFERENCES items(id) ON DELETE CASCADE,
  category_id UUID        REFERENCES categories(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_restriction_has_target CHECK (item_id IS NOT NULL OR category_id IS NOT NULL)
);
CREATE INDEX idx_location_restrictions_location ON warehouse_location_restrictions(tenant_id, location_id);
ALTER TABLE warehouse_location_restrictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_session_isolation ON warehouse_location_restrictions
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT ALL PRIVILEGES ON public.warehouse_location_restrictions TO service_role;

-- Read-only: current occupied quantity at a location, from stock_levels
-- (no new stored counter — a second copy would drift, same principle as
-- fn_get_incoming_quantity computing live rather than caching).
CREATE OR REPLACE FUNCTION fn_location_occupied_quantity(
  p_tenant_id UUID,
  p_location_id UUID
) RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(quantity_on_hand), 0)
  FROM stock_levels
  WHERE tenant_id = p_tenant_id AND location_id = p_location_id;
$$ LANGUAGE sql STABLE;

-- Read-only: is p_item_id allowed at p_location_id, given
-- warehouse_location_restrictions (no rows for the location = unrestricted).
CREATE OR REPLACE FUNCTION fn_location_allows_item(
  p_tenant_id UUID,
  p_location_id UUID,
  p_item_id UUID
) RETURNS BOOLEAN AS $$
  SELECT NOT EXISTS (SELECT 1 FROM warehouse_location_restrictions WHERE tenant_id = p_tenant_id AND location_id = p_location_id)
    OR EXISTS (
      SELECT 1 FROM warehouse_location_restrictions r
      LEFT JOIN items i ON i.id = p_item_id
      WHERE r.tenant_id = p_tenant_id AND r.location_id = p_location_id
        AND (r.item_id = p_item_id OR r.category_id = i.category_id)
    );
$$ LANGUAGE sql STABLE;
